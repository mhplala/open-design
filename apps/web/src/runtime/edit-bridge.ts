/**
 * Protocol between the host page and the sandboxed artifact iframe for the
 * in-place Edit feature. The iframe-side shim (in `srcdoc.ts`) and the
 * host-side Inspector / FileViewer wiring all import from this single file
 * so message names, payload shapes, and selector resolution stay in sync.
 *
 * Multiplexing note: the existing deck bridge uses `od:slide-*` message
 * types; everything here uses `od:edit:*`. Both can coexist on one iframe.
 */

export const EDIT_BRIDGE_VERSION = 1;

// All edit-bridge messages share this envelope so the host can filter
// foreign postMessage traffic and reject stale-version events cleanly.
export interface EditEnvelope<TKind extends string, TData = unknown> {
  type: TKind;
  version: typeof EDIT_BRIDGE_VERSION;
  data: TData;
}

// ---- Selector ------------------------------------------------------------

// Stable identifier for a DOM node inside the iframe. `data-od-id` is the
// canonical anchor (the OD prompt instructs every <section> to carry one);
// for everything else we fall back to a structural nth-of-type path from
// the document root.
export type EditSelector =
  | { kind: 'od-id'; value: string }
  | { kind: 'path'; segments: string[] };

// ---- Element snapshot sent to host on select ----------------------------

export interface EditElementSnapshot {
  selector: EditSelector;
  tag: string;          // lowercased tag name, e.g. "h1", "section"
  id: string | null;    // value of the id attribute, if any
  className: string;    // raw class attribute (space-separated)
  textContent: string;  // .textContent — truncated to 4k chars to keep payload small
  hasChildren: boolean; // true if any element children — text edit becomes risky
  styles: EditStyleSnapshot;
}

// Curated subset of computed styles. We deliberately keep this list short
// so the Inspector UI fits into one panel and the postMessage payload
// stays tiny. Add new keys here AND in the iframe shim's collector AND in
// the Inspector controls — all three must agree.
export interface EditStyleSnapshot {
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  borderRadius: string;
  borderColor: string;
  borderWidth: string;
}

export const EDIT_STYLE_KEYS: readonly (keyof EditStyleSnapshot)[] = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'borderRadius',
  'borderColor',
  'borderWidth',
];

// ---- Mutations: host -> iframe ------------------------------------------

export interface EditMutation {
  // Replace the element's textContent. Only honoured if !hasChildren on
  // last snapshot — applying to a container would obliterate child nodes.
  text?: string;
  // Inline-style overrides written via element.style.setProperty. Pass an
  // empty string to remove a previously-set inline style (falls back to
  // the stylesheet's value).
  styles?: Partial<EditStyleSnapshot>;
}

// ---- Message kinds ------------------------------------------------------

// iframe -> host
export type EditEventToHost =
  | EditEnvelope<'od:edit:ready', { url: string }>
  | EditEnvelope<'od:edit:select', EditElementSnapshot>
  | EditEnvelope<'od:edit:deselect', null>
  | EditEnvelope<'od:edit:applied', { selector: EditSelector }>
  | EditEnvelope<'od:edit:error', { code: string; message: string }>
  | EditEnvelope<'od:edit:html', { html: string; requestId: string }>;

// host -> iframe
export type EditCommandToIframe =
  | EditEnvelope<'od:edit:enable', null>
  | EditEnvelope<'od:edit:disable', null>
  | EditEnvelope<'od:edit:select-by-selector', { selector: EditSelector }>
  | EditEnvelope<'od:edit:apply', { selector: EditSelector; mutation: EditMutation }>
  | EditEnvelope<'od:edit:get-html', { requestId: string }>;

// ---- Helpers ------------------------------------------------------------

export function envelope<K extends string, D>(type: K, data: D): EditEnvelope<K, D> {
  return { type, version: EDIT_BRIDGE_VERSION, data };
}

export function isEditMessage(
  msg: unknown,
): msg is EditEventToHost | EditCommandToIframe {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as { type?: unknown; version?: unknown };
  return (
    typeof obj.type === 'string' &&
    obj.type.startsWith('od:edit:') &&
    obj.version === EDIT_BRIDGE_VERSION
  );
}

// ---- Selector serialization / resolution --------------------------------

// Build a structural path from <html> down to the target node. Used as a
// fallback when there's no data-od-id. Segments look like
// `div:nth-of-type(2)` so we can rebuild a unique CSS selector with `>`.
export function buildPathSelector(node: Element): string[] {
  const segments: string[] = [];
  let cur: Element | null = node;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
    const parentEl: HTMLElement | null = cur.parentElement;
    if (!parentEl) break;
    let nth = 1;
    let sibling = cur.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === cur.tagName) nth++;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${nth})`);
    cur = parentEl;
  }
  return segments;
}

export function selectorFor(node: Element): EditSelector {
  const odId = node.getAttribute('data-od-id');
  if (odId && odId.trim().length > 0) return { kind: 'od-id', value: odId };
  return { kind: 'path', segments: buildPathSelector(node) };
}

export function resolveSelector(
  root: Document | Element,
  selector: EditSelector,
): Element | null {
  if (selector.kind === 'od-id') {
    return root.querySelector(`[data-od-id="${cssEscape(selector.value)}"]`);
  }
  if (selector.segments.length === 0) return null;
  return root.querySelector(selector.segments.join(' > '));
}

export function selectorEquals(a: EditSelector, b: EditSelector): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'od-id' && b.kind === 'od-id') return a.value === b.value;
  if (a.kind === 'path' && b.kind === 'path') {
    return a.segments.length === b.segments.length &&
      a.segments.every((seg, i) => seg === b.segments[i]);
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, '\\$1');
}
