/**
 * Wrap an artifact's HTML for a sandboxed iframe. Corresponds to
 * buildSrcdoc in packages/runtime/src/index.ts — the reference version also
 * injects an edit-mode overlay and tweak bridge, which this starter omits.
 *
 * If the model returned a full document, pass it through unchanged; otherwise
 * wrap the fragment in a minimal doctype shell.
 *
 * When `options.deck` is set we also inject a `postMessage` listener that
 * lets the host advance / rewind slides without relying on the iframe
 * having keyboard focus. The host posts:
 *   { type: 'od:slide', action: 'next' | 'prev' | 'first' | 'last' | 'go', index?: number }
 * and the iframe responds with:
 *   { type: 'od:slide-state', active: number, count: number }
 * after every navigation so the host can render its own counter / dots.
 */
import { BASE_HREF } from './base-path';

export function buildSrcdoc(
  html: string,
  options: { deck?: boolean; baseHref?: string; editMode?: boolean } = {}
): string {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  const isFullDoc = head.startsWith("<!doctype") || head.startsWith("<html");
  const wrapped = isFullDoc
    ? html
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;
  // Default to the deployment BASE_HREF so artifact-emitted absolute paths
  // like `/frames/...` and `/api/projects/.../raw/...` resolve under the
  // app's mount point instead of the host root (which may be a different
  // app on shared hosts). When deployed at the root, BASE_HREF is "/" and
  // we skip injection so nothing changes.
  const effectiveBaseHref =
    options.baseHref ?? (BASE_HREF !== '/' ? BASE_HREF : undefined);
  const withBase = effectiveBaseHref
    ? injectBaseHref(wrapped, effectiveBaseHref)
    : wrapped;
  const withShim = injectSandboxShim(withBase);
  const withDeck = options.deck ? injectDeckBridge(withShim) : withShim;
  if (!options.editMode) return withDeck;
  return injectEditShim(withDeck);
}

function injectBaseHref(doc: string, baseHref: string): string {
  const safeHref = escapeAttr(baseHref);
  const tag = `<base href="${safeHref}">`;
  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  if (/<html[^>]*>/i.test(doc)) {
    return doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  }
  return tag + doc;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Inverse of buildSrcdoc — recover the user's HTML by stripping anything
 * we injected at runtime. Used by the Edit-mode Save flow before writing
 * the iframe's serialized DOM back to disk so the on-disk file doesn't
 * accumulate sandbox shims, edit-mode outlines, or deck nav stubs.
 *
 * Targets:
 *   - <script data-od-injected="..."> ... </script>  (sandbox / deck / edit)
 *   - <style  data-od-injected="..."> ... </style>   (deck-fix / edit-style)
 *   - <base ...>                                     (base href for subpath)
 *   - data-od-edit-hover / data-od-edit-selected     (hover + selection markers)
 */
export function stripInjections(html: string): string {
  return html
    .replace(/<script\s+data-od-injected="[^"]*"[^>]*>[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style\s+data-od-injected="[^"]*"[^>]*>[\s\S]*?<\/style>\s*/g, '')
    .replace(/<base\b[^>]*\/?>\s*/gi, '')
    .replace(/\s+data-od-edit-(?:hover|selected)(?:="[^"]*")?/g, '');
}

// Sandboxed iframes (we use `sandbox="allow-scripts"`) without
// `allow-same-origin` raise a SecurityError on first `localStorage` /
// `sessionStorage` access. Many freeform-generated decks call
// `localStorage.getItem(...)` at the top of their IIFE without a
// try/catch — when it throws, the whole script aborts and the deck
// becomes a static, unnavigable preview. We install a same-origin
// in-memory shim BEFORE any user script runs so those decks degrade
// gracefully (position just doesn't persist across reloads).
function injectSandboxShim(doc: string): string {
  const shim = `<script data-od-injected="sandbox-shim">(function(){
  function makeStore(){
    var data = {};
    var api = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; },
      clear: function(){ data = {}; },
      key: function(i){ return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
    return api;
  }
  function tryShim(name){
    var works = false;
    try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
    catch (_) { works = false; }
    if (works) return;
    try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
    catch (_) { try { window[name] = makeStore(); } catch (__) {} }
  }
  tryShim('localStorage');
  tryShim('sessionStorage');
})();</script>`;
  if (/<head[^>]*>/i.test(doc))
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  if (/<body[^>]*>/i.test(doc))
    return doc.replace(/<body[^>]*>/i, (m) => `${m}${shim}`);
  return shim + doc;
}

// The deck bridge supports three deck conventions found across our skills
// and freeform-generated artifacts:
//   1. Horizontal scroll decks (simple-deck, guizang-ppt) — slides laid out
//      side-by-side, navigation = scrollTo({ left }).
//   2. Class-toggle decks (deck-framework, freeform pitches) — one slide
//      carries `.active` or `.is-active`; siblings are display:none. Their
//      own JS listens for ArrowRight/Left, so we drive them by dispatching
//      synthetic KeyboardEvents.
//   3. Visibility-only decks — no class toggle, slides hidden via inline
//      style. We fall back to keyboard dispatch + visibility detection.
//
// All three report `{ active, count }` back to the host so the toolbar can
// render a unified counter. A MutationObserver on each `.slide` lets us
// catch class changes from the deck's own keyboard handler.
//
// We also inject a small CSS override that fixes a common authoring
// mistake in fixed-canvas decks: a `.stage { display: grid; place-items:
// center }` only centers items within their grid cells, but the track
// itself stays `start`-aligned, so the 1920x1080 canvas top-lefts at
// (0,0) of the stage. Combined with `transform-origin: center center`,
// the scaled canvas ends up offset toward the bottom-right of any
// preview that's smaller than 1920x1080 — exactly what users see in the
// sandbox iframe. `place-content: center` centers the track itself.
function injectDeckBridge(doc: string): string {
  const styleFix = `<style data-od-injected="deck-fix">
.stage, .deck-stage, .deck-shell { place-content: center !important; }
</style>`;
  const docWithStyle = /<\/head>/i.test(doc)
    ? doc.replace(/<\/head>/i, styleFix + "</head>")
    : /<head[^>]*>/i.test(doc)
    ? doc.replace(/<head[^>]*>/i, (m) => m + styleFix)
    : styleFix + doc;
  doc = docWithStyle;
  const script = `<script data-od-injected="deck-bridge">(function(){
  function slides(){ return document.querySelectorAll('.slide'); }
  function scroller(){
    if (document.body && document.body.scrollWidth > document.body.clientWidth + 1) return document.body;
    return document.scrollingElement || document.documentElement;
  }
  function isScrollDeck(){
    var sc = scroller();
    return !!(sc && sc.scrollWidth > sc.clientWidth + 1);
  }
  function findActiveByClass(list){
    for (var i=0; i<list.length; i++) {
      var cl = list[i].classList;
      if (cl && (cl.contains('is-active') || cl.contains('active') || cl.contains('current'))) return i;
    }
    return -1;
  }
  function findActiveByVisibility(list){
    for (var i=0; i<list.length; i++) {
      try {
        var cs = window.getComputedStyle(list[i]);
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return i;
      } catch (_) {}
    }
    return -1;
  }
  function activeIndex(list){
    if (!list || !list.length) return 0;
    if (isScrollDeck()) {
      var w = Math.max(1, window.innerWidth);
      return Math.max(0, Math.min(list.length - 1, Math.round(scroller().scrollLeft / w)));
    }
    var byClass = findActiveByClass(list);
    if (byClass >= 0) return byClass;
    var byVis = findActiveByVisibility(list);
    if (byVis >= 0) return byVis;
    return 0;
  }
  function dispatchKey(key){
    // Bubbles so any listener on window picks it up too. We dispatch on
    // document only — dispatching on window/body in addition would cause
    // bubbling to fire the same document-level listener twice.
    var init = { key: key, code: key, bubbles: true, cancelable: true, composed: true };
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', init));
      document.dispatchEvent(new KeyboardEvent('keyup', init));
    } catch (_) {}
  }
  function scrollGo(i){
    var list = slides();
    var next = Math.max(0, Math.min(list.length - 1, i));
    scroller().scrollTo({ left: next * window.innerWidth, behavior: 'smooth' });
    setTimeout(report, 380);
  }
  function go(action){
    var list = slides();
    if (!list.length) return;
    if (isScrollDeck()) {
      var i = activeIndex(list);
      if (action === 'next') scrollGo(i + 1);
      else if (action === 'prev') scrollGo(i - 1);
      else if (action === 'first') scrollGo(0);
      else if (action === 'last') scrollGo(list.length - 1);
      return;
    }
    if (action === 'next') dispatchKey('ArrowRight');
    else if (action === 'prev') dispatchKey('ArrowLeft');
    else if (action === 'first') dispatchKey('Home');
    else if (action === 'last') dispatchKey('End');
    setTimeout(report, 280);
  }
  function gotoIndex(i){
    var list = slides();
    if (!list.length) return;
    var target = Math.max(0, Math.min(list.length - 1, i));
    if (isScrollDeck()) { scrollGo(target); return; }
    var current = activeIndex(list);
    var diff = target - current;
    if (!diff) { report(); return; }
    var key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
    var n = Math.abs(diff);
    for (var k = 0; k < n; k++) dispatchKey(key);
    setTimeout(report, 320);
  }
  function report(){
    try {
      var list = slides();
      window.parent.postMessage({
        type: 'od:slide-state',
        active: activeIndex(list),
        count: list.length,
      }, '*');
    } catch (e) {}
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:slide') return;
    if (data.action === 'go' && typeof data.index === 'number') gotoIndex(data.index);
    else go(data.action);
  });
  // Report once on load and on every scroll-end so the host stays in sync.
  window.addEventListener('load', function(){ setTimeout(report, 200); });
  document.addEventListener('scroll', function(){
    clearTimeout(window.__odReportT);
    window.__odReportT = setTimeout(report, 120);
  }, { passive: true, capture: true });
  // Nudge the deck's own fit/resize listener after layout settles. Fixed-canvas
  // decks (e.g. ".canvas { width: 1920px }" + "transform: scale(...)") compute
  // their scale on first run, which fires when the iframe is still 0x0 in
  // sandboxed previews — the deck's fit() then resolves to scale(0) / scale(1)
  // and never recovers. Re-firing 'resize' lets the deck recompute, and a
  // ResizeObserver picks up later layout settles (zoom toggle, sidebar drag).
  function nudgeResize(){
    try { window.dispatchEvent(new Event('resize')); }
    catch (_) {}
  }
  // Aggressively nudge during the first second so the deck catches the
  // iframe's first non-zero size; bail out early once the iframe reports a
  // real width. Without this loop, fixed-canvas decks render at scale(0).
  function chaseFirstLayout(){
    var attempts = 0;
    function tick(){
      attempts += 1;
      var w = window.innerWidth;
      nudgeResize();
      if (w > 0 && attempts >= 2) return; // one extra nudge after first non-zero
      if (attempts < 30) setTimeout(tick, 50);
    }
    tick();
  }
  if (document.readyState === 'complete') chaseFirstLayout();
  else window.addEventListener('load', chaseFirstLayout);
  // Re-nudge whenever the iframe itself is resized by the host (e.g.
  // user toggles zoom, resizes the chat sidebar, exits Present).
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var ro = new ResizeObserver(function(){ nudgeResize(); });
      ro.observe(document.documentElement);
    } catch (_) {}
  }
  // For class-toggle decks the deck's own keyboard handler updates classes
  // on the slide elements; an attribute observer translates that into the
  // host counter without depending on scroll events.
  function observeSlides(){
    var list = slides();
    if (!list.length) { setTimeout(observeSlides, 150); return; }
    try {
      var mo = new MutationObserver(function(){
        clearTimeout(window.__odReportT2);
        window.__odReportT2 = setTimeout(report, 60);
      });
      for (var i = 0; i < list.length; i++) {
        mo.observe(list[i], { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
    } catch (e) {}
    setTimeout(report, 100);
  }
  observeSlides();
})();</script>`;
  if (/<\/body>/i.test(doc))
    return doc.replace(/<\/body>/i, `${script}</body>`);
  return doc + script;
}

// Edit-mode shim. When the host enables "edit" on the FileViewer it sets
// `editMode: true` on buildSrcdoc; we inject a <style> + <script> pair that:
//   * highlights the element under the cursor (via `data-od-edit-hover`)
//   * tracks the currently-selected element (via `data-od-edit-selected`)
//   * intercepts clicks (preventDefault + stopPropagation) so links / buttons
//     don't fire navigation while editing
//   * speaks the `od:edit:*` postMessage protocol defined in edit-bridge.ts
//
// The protocol helpers (`selectorFor`, `resolveSelector`, `buildPathSelector`,
// `cssEscape`) are inlined verbatim from edit-bridge.ts because the iframe
// runs in its own JS world and can't `import` from the host bundle. Keep them
// in sync by hand if the protocol module changes.
//
// EDIT_STYLE_KEYS is also inlined as a literal array — adding a new key
// requires updating both the TS const and this string. Same caveat as the
// deck bridge: any divergence shows up as missing fields in the snapshot.
function injectEditShim(doc: string): string {
  const style = `<style data-od-injected="edit-style">
[data-od-edit-hover] { outline: 2px dashed #2F6FEB; outline-offset: -2px; cursor: pointer; }
[data-od-edit-selected] { outline: 2px solid #2F6FEB; outline-offset: -2px; }
</style>`;
  const script = `<script data-od-injected="edit-shim">(function(){
  var VERSION = 1;
  var STYLE_KEYS = [
    'color','backgroundColor','fontFamily','fontSize','fontWeight',
    'lineHeight','letterSpacing','textAlign',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft',
    'borderRadius','borderColor','borderWidth'
  ];
  function envelope(type, data){ return { type: type, version: VERSION, data: data }; }
  function isEditMessage(msg){
    if (!msg || typeof msg !== 'object') return false;
    return typeof msg.type === 'string' && msg.type.indexOf('od:edit:') === 0 && msg.version === VERSION;
  }
  function cssEscape(value){
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/(["\\\\])/g, '\\\\$1');
  }
  function buildPathSelector(node){
    var segments = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      var parent = cur.parentElement;
      if (!parent) break;
      var nth = 1;
      var sibling = cur.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === cur.tagName) nth++;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + nth + ')');
      cur = parent;
    }
    return segments;
  }
  function selectorFor(node){
    var odId = node.getAttribute && node.getAttribute('data-od-id');
    if (odId && odId.trim().length > 0) return { kind: 'od-id', value: odId };
    return { kind: 'path', segments: buildPathSelector(node) };
  }
  function resolveSelector(root, selector){
    if (!selector) return null;
    if (selector.kind === 'od-id') {
      return root.querySelector('[data-od-id="' + cssEscape(selector.value) + '"]');
    }
    if (!selector.segments || !selector.segments.length) return null;
    try { return root.querySelector(selector.segments.join(' > ')); }
    catch (_) { return null; }
  }
  function post(type, data){
    try { window.parent.postMessage(envelope(type, data), '*'); } catch (_) {}
  }
  function snapshot(el){
    var cs = null;
    try { cs = window.getComputedStyle(el); } catch (_) {}
    var styles = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      styles[k] = cs ? (cs[k] || '') : '';
    }
    var text = '';
    try { text = (el.textContent == null ? '' : String(el.textContent)).slice(0, 4000); } catch (_) {}
    return {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.getAttribute('class') == null ? '' : el.getAttribute('class'),
      textContent: text,
      hasChildren: el.childElementCount > 0,
      styles: styles
    };
  }

  var enabled = false;
  var hoverEl = null;
  var selectedEl = null;
  // Inline-style snapshots so disable() can restore link/button defaults
  // (we set pointer-events:auto + cursor:pointer-style overrides via the
  // hover attribute; nothing else is mutated, so disable just clears attrs).
  function clearHover(){
    if (hoverEl) {
      try { hoverEl.removeAttribute('data-od-edit-hover'); } catch (_) {}
      hoverEl = null;
    }
  }
  function clearSelected(){
    if (selectedEl) {
      try { selectedEl.removeAttribute('data-od-edit-selected'); } catch (_) {}
      selectedEl = null;
    }
  }
  function isEditableTarget(el){
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (!el.parentElement) return false;
    return true;
  }
  function onMouseOver(ev){
    if (!enabled) return;
    var t = ev.target;
    if (!isEditableTarget(t)) { clearHover(); return; }
    if (t === hoverEl) return;
    clearHover();
    hoverEl = t;
    try { hoverEl.setAttribute('data-od-edit-hover', ''); } catch (_) {}
  }
  function onMouseOut(ev){
    if (!enabled) return;
    // related target outside iframe -> clear; otherwise let mouseover swap it
    var related = ev.relatedTarget;
    if (!related) clearHover();
  }
  function onClick(ev){
    if (!enabled) return;
    var t = ev.target;
    if (!isEditableTarget(t)) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Best-effort: stop other listeners on the same target from firing.
    if (typeof ev.stopImmediatePropagation === 'function') {
      try { ev.stopImmediatePropagation(); } catch (_) {}
    }
    if (selectedEl && selectedEl !== t) {
      try { selectedEl.removeAttribute('data-od-edit-selected'); } catch (_) {}
    }
    selectedEl = t;
    try { selectedEl.setAttribute('data-od-edit-selected', ''); } catch (_) {}
    post('od:edit:select', snapshot(selectedEl));
  }
  function onKeyDown(ev){
    if (!enabled) return;
    if (ev.key === 'Escape') {
      if (selectedEl) {
        clearSelected();
        post('od:edit:deselect', null);
      }
    }
  }
  // Capture-phase so the iframe's own click handlers (links, buttons,
  // custom navs) don't get a chance to fire while editing.
  function enable(){
    if (enabled) return;
    enabled = true;
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }
  function disable(){
    if (!enabled) return;
    enabled = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    clearHover();
    clearSelected();
  }
  function selectBySelector(selector){
    var el = resolveSelector(document, selector);
    if (!el) {
      post('od:edit:error', { code: 'not-found', message: 'selector did not resolve' });
      return;
    }
    if (selectedEl && selectedEl !== el) {
      try { selectedEl.removeAttribute('data-od-edit-selected'); } catch (_) {}
    }
    selectedEl = el;
    try { selectedEl.setAttribute('data-od-edit-selected', ''); } catch (_) {}
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (_) {}
    post('od:edit:select', snapshot(el));
  }
  function applyMutation(selector, mutation){
    var el = resolveSelector(document, selector);
    if (!el) {
      post('od:edit:error', { code: 'not-found', message: 'selector did not resolve' });
      return;
    }
    if (mutation && typeof mutation.text === 'string') {
      if (el.childElementCount > 0) {
        post('od:edit:error', { code: 'has-children', message: 'cannot replace text on container with element children' });
        return;
      }
      try { el.textContent = mutation.text; }
      catch (e) {
        post('od:edit:error', { code: 'apply-failed', message: String(e && e.message || e) });
        return;
      }
    }
    if (mutation && mutation.styles && typeof mutation.styles === 'object') {
      for (var i = 0; i < STYLE_KEYS.length; i++) {
        var k = STYLE_KEYS[i];
        if (Object.prototype.hasOwnProperty.call(mutation.styles, k)) {
          var v = mutation.styles[k];
          try { el.style[k] = (v == null ? '' : String(v)); } catch (_) {}
        }
      }
    }
    post('od:edit:applied', { selector: selector });
  }
  function getHtml(requestId){
    var html = '';
    try { html = document.documentElement.outerHTML; } catch (_) {}
    post('od:edit:html', { html: html, requestId: requestId });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!isEditMessage(data)) return;
    var d = data.data;
    switch (data.type) {
      case 'od:edit:enable': enable(); break;
      case 'od:edit:disable': disable(); break;
      case 'od:edit:select-by-selector':
        if (d && d.selector) selectBySelector(d.selector);
        break;
      case 'od:edit:apply':
        if (d && d.selector) applyMutation(d.selector, d.mutation || {});
        break;
      case 'od:edit:get-html':
        getHtml(d && typeof d.requestId === 'string' ? d.requestId : '');
        break;
    }
  });
  // Initial signal so the host can flush any queued commands.
  post('od:edit:ready', { url: location.href });
})();</script>`;
  // Style goes at the top of <head> so the highlight selectors win against
  // late-defined artifact CSS (specificity ties resolve to last-declared).
  let withStyle = doc;
  if (/<head[^>]*>/i.test(doc)) {
    withStyle = doc.replace(/<head[^>]*>/i, (m) => `${m}${style}`);
  } else if (/<body[^>]*>/i.test(doc)) {
    withStyle = doc.replace(/<body[^>]*>/i, (m) => `${style}${m}`);
  } else {
    withStyle = style + doc;
  }
  if (/<\/body>/i.test(withStyle))
    return withStyle.replace(/<\/body>/i, `${script}</body>`);
  return withStyle + script;
}
