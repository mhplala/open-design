import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { artifactRendererRegistry } from '../artifacts/renderer-registry';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import {
  fetchProjectFilePreview,
  fetchProjectFileText,
  projectFileUrl,
  projectRawUrl,
  writeProjectTextFile,
} from '../providers/registry';
import type { ProjectFilePreview } from '../providers/registry';
import {
  envelope,
  isEditMessage,
  type EditElementSnapshot,
  type EditEventToHost,
  type EditMutation,
  type EditSelector,
} from '../runtime/edit-bridge';
import { exportAsHtml, exportAsPdf, exportAsZip } from '../runtime/exports';
import { buildSrcdoc } from '../runtime/srcdoc';
import { saveTemplate } from '../state/projects';
import type { ProjectFile } from '../types';
import { EditInspector } from './EditInspector';
import { Icon } from './Icon';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

interface Props {
  projectId: string;
  file: ProjectFile;
  liveHtml?: string;
  isDeck?: boolean;
  onExportAsPptx?: ((fileName: string) => void) | undefined;
  streaming?: boolean;
}

export function FileViewer({
  projectId,
  file,
  liveHtml,
  isDeck,
  onExportAsPptx,
  streaming,
}: Props) {
  const rendererMatch = artifactRendererRegistry.resolve({
    file,
    isDeckHint: Boolean(isDeck),
  });

  if (rendererMatch?.renderer.id === 'html' || rendererMatch?.renderer.id === 'deck-html') {
    return (
      <HtmlViewer
        projectId={projectId}
        file={file}
        liveHtml={liveHtml}
        isDeck={rendererMatch.renderer.id === 'deck-html'}
        onExportAsPptx={onExportAsPptx}
        streaming={Boolean(streaming)}
      />
    );
  }
  if (file.kind === 'image') {
    return <ImageViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'sketch') {
    return <ImageViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'text' || file.kind === 'code') {
    return <TextViewer projectId={projectId} file={file} />;
  }
  if (
    file.kind === 'pdf' ||
    file.kind === 'document' ||
    file.kind === 'presentation' ||
    file.kind === 'spreadsheet'
  ) {
    return <DocumentPreviewViewer projectId={projectId} file={file} />;
  }
  return <BinaryViewer projectId={projectId} file={file} />;
}

function FileActions({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer-toolbar-actions">
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        download={file.name}
      >
        {t('fileViewer.download')}
      </a>
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('fileViewer.open')}
      </a>
    </div>
  );
}

function BinaryViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer binary-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.binaryMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        <div className="viewer-empty">
          {t('fileViewer.binaryNote', { size: file.size })}
        </div>
      </div>
    </div>
  );
}

function DocumentPreviewViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    void fetchProjectFilePreview(projectId, file.name).then((next) => {
      if (!cancelled) {
        setPreview(next);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime]);

  return (
    <div className="viewer document-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {documentMetaLabel(file, t)} · {humanSize(file.size)}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        {loading ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : preview ? (
          <div className="document-preview">
            <h2>{preview.title}</h2>
            {preview.sections.map((section, idx) => (
              <section key={`${section.title}-${idx}`}>
                <h3>{section.title}</h3>
                {section.lines.map((line, lineIdx) => (
                  <p key={`${lineIdx}-${line}`}>{line}</p>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        )}
      </div>
    </div>
  );
}

function HtmlViewer({
  projectId,
  file,
  liveHtml,
  isDeck,
  onExportAsPptx,
  streaming,
}: {
  projectId: string;
  file: ProjectFile;
  liveHtml?: string;
  isDeck: boolean;
  onExportAsPptx?: ((fileName: string) => void) | undefined;
  streaming: boolean;
}) {
  const t = useT();
  const [mode, setMode] = useState<'preview' | 'source' | 'edit'>('preview');
  const [source, setSource] = useState<string | null>(liveHtml ?? null);
  const [zoom, setZoom] = useState(100);
  const [presentMenuOpen, setPresentMenuOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  // Edit mode runtime state. `editSelected` is the snapshot of the element
  // currently outlined in the iframe; the Inspector reads from it.
  // `editSaveState` drives the Save button label / colour.
  const [editSelected, setEditSelected] = useState<EditElementSnapshot | null>(null);
  const [editSaveState, setEditSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  // Pending HTML-serialization requests we sent to the iframe — keyed by
  // requestId so the Save handler can await the response.
  const editHtmlRequests = useRef(new Map<string, (html: string) => void>());
  // Template save UX. We surface a transient "Saved" pill in the share
  // menu so the user gets feedback without a noisy toast layer.
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [inTabPresent, setInTabPresent] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Slide deck nav state: the iframe posts the active index + total count
  // back to the host every time a slide settles. Host renders prev/next
  // controls in the toolbar and reflects the count beside them.
  const [slideState, setSlideState] = useState<{ active: number; count: number } | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shareRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (liveHtml !== undefined) {
      setSource(liveHtml);
      return;
    }
    setSource(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((text) => {
      if (!cancelled) setSource(text);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, liveHtml, reloadKey]);

  // Detect deck-shaped HTML even when the project's skill didn't declare
  // `mode: deck`. Freeform projects often produce a deck because the user
  // asked for one in plain prose; without this, prev/next and Present
  // never surface and the deck becomes a static, unnavigable preview.
  const looksLikeDeck = useMemo(() => {
    if (!source) return false;
    return /class\s*=\s*['"][^'"]*\bslide\b/i.test(source);
  }, [source]);
  const effectiveDeck = isDeck || looksLikeDeck;

  const srcDoc = useMemo(
    () => (source ? buildSrcdoc(source, {
      deck: effectiveDeck,
      baseHref: projectRawUrl(projectId, baseDirFor(file.name)),
      editMode: mode === 'edit',
    }) : ''),
    [source, effectiveDeck, projectId, file.name, mode],
  );

  useEffect(() => {
    if (!effectiveDeck) {
      setSlideState(null);
      return;
    }
    function onMessage(ev: MessageEvent) {
      const data = ev?.data as
        | { type?: string; active?: number; count?: number }
        | null;
      if (!data || data.type !== 'od:slide-state') return;
      if (typeof data.active !== 'number' || typeof data.count !== 'number') return;
      setSlideState({ active: data.active, count: data.count });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [effectiveDeck]);

  function postSlide(action: 'next' | 'prev' | 'first' | 'last') {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'od:slide', action }, '*');
  }

  // ---- Edit mode bridge -------------------------------------------------
  // Listens for od:edit:* messages from the iframe shim (see
  // runtime/edit-bridge.ts for the protocol). Sends commands back via
  // editPost, which is also used by the Inspector's onApply.

  const editPost = useCallback((msg: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(msg, '*');
  }, []);

  useEffect(() => {
    if (mode !== 'edit') {
      // Leaving edit mode — clear panel state. The iframe srcDoc itself
      // rebuilds (without the shim) when `mode` changes via the useMemo
      // dep, so no explicit od:edit:disable is needed.
      setEditSelected(null);
      return;
    }
    function onMessage(ev: MessageEvent) {
      const data = ev?.data;
      if (!isEditMessage(data)) return;
      const msg = data as EditEventToHost;
      switch (msg.type) {
        case 'od:edit:ready':
          // Shim is up — turn on edit capture. We don't enable inside
          // editPost on iframe load because Next.js's iframe might fire
          // load before the shim's IIFE finishes.
          editPost(envelope('od:edit:enable', null));
          break;
        case 'od:edit:select':
          setEditSelected(msg.data);
          break;
        case 'od:edit:deselect':
          setEditSelected(null);
          break;
        case 'od:edit:html': {
          const resolver = editHtmlRequests.current.get(msg.data.requestId);
          if (resolver) {
            editHtmlRequests.current.delete(msg.data.requestId);
            resolver(msg.data.html);
          }
          break;
        }
        case 'od:edit:applied':
          // Optimistic — Inspector already reflected the change locally.
          break;
        case 'od:edit:error':
          // Surface in console; full-screen toast feels heavy for the V2
          // ship. Most likely cause: 'has-children' from text edit on a
          // container element, which the Inspector already disables.
          console.warn('[od:edit] error from iframe:', msg.data);
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mode, editPost]);

  const editApply = useCallback(
    (selector: EditSelector, mutation: EditMutation) => {
      editPost(envelope('od:edit:apply', { selector, mutation }));
    },
    [editPost],
  );

  // Save flow: ask the iframe for its current serialized HTML, then PUT
  // it through the project files API so the on-disk file matches what
  // the user sees. The daemon writes index.html atomically; the file
  // tree picks up the new mtime on the next refresh.
  const editSave = useCallback(async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    setEditSaveState('saving');
    const requestId = `od-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const html = await new Promise<string | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        editHtmlRequests.current.delete(requestId);
        resolve(null);
      }, 5000);
      editHtmlRequests.current.set(requestId, (h) => {
        window.clearTimeout(timeout);
        resolve(h);
      });
      editPost(envelope('od:edit:get-html', { requestId }));
    });
    if (!html) {
      setEditSaveState('error');
      window.setTimeout(() => setEditSaveState('idle'), 2500);
      return;
    }
    const written = await writeProjectTextFile(projectId, file.name, html);
    if (!written) {
      setEditSaveState('error');
      window.setTimeout(() => setEditSaveState('idle'), 2500);
      return;
    }
    // Sync local state to the saved HTML so re-entering preview mode
    // doesn't briefly flash the old render.
    setSource(html);
    setEditSaveState('saved');
    window.setTimeout(() => setEditSaveState('idle'), 1500);
  }, [editPost, projectId, file.name]);

  const exitEditMode = useCallback(() => {
    setMode('preview');
    setEditSelected(null);
  }, []);

  // Keyboard nav on the host, so the user can press ←/→ even when focus
  // is on the chat composer or any other host control.
  useEffect(() => {
    if (!effectiveDeck || mode !== 'preview') return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        postSlide('next');
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        postSlide('prev');
      } else if (e.key === 'Home') {
        e.preventDefault();
        postSlide('first');
      } else if (e.key === 'End') {
        e.preventDefault();
        postSlide('last');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveDeck, mode]);

  useEffect(() => {
    if (!presentMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.present-wrap')) return;
      setPresentMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [presentMenuOpen]);

  useEffect(() => {
    if (!shareMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!shareRef.current) return;
      if (!shareRef.current.contains(e.target as Node)) setShareMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareMenuOpen]);

  useEffect(() => {
    if (!inTabPresent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInTabPresent(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inTabPresent]);

  function openInNewTab() {
    if (!source) return;
    const blob = new Blob([source], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Snapshot this project as a reusable template. The daemon snapshots
  // EVERY html/text/code file in the project (not just the file open in
  // the viewer), so the template captures the whole design, not a single
  // page. Surfaced here in the Share menu because that's where the user's
  // share / export mental model already lives.
  async function handleSaveAsTemplate() {
    setShareMenuOpen(false);
    const defaultName =
      file.name.replace(/\.html?$/i, '') || t('fileViewer.templateNameDefault');
    const name = window.prompt(t('fileViewer.templateNamePrompt'), defaultName);
    if (!name || !name.trim()) return;
    const description = window.prompt(
      t('fileViewer.templateDescPrompt'),
      '',
    );
    setSavingTemplate(true);
    setTemplateNote(null);
    try {
      const tpl = await saveTemplate({
        name: name.trim(),
        description: description?.trim() || undefined,
        sourceProjectId: projectId,
      });
      setTemplateNote(
        tpl
          ? t('fileViewer.savedTemplate', { name: tpl.name })
          : t('fileViewer.savedTemplateFail'),
      );
    } finally {
      setSavingTemplate(false);
      // Auto-clear the note so the menu doesn't keep stale state next open.
      setTimeout(() => setTemplateNote(null), 4000);
    }
  }

  function presentInThisTab() {
    setPresentMenuOpen(false);
    setInTabPresent(true);
  }

  function presentFullscreen() {
    setPresentMenuOpen(false);
    const el = previewBodyRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setInTabPresent(true));
    } else {
      setInTabPresent(true);
    }
  }

  function presentNewTab() {
    setPresentMenuOpen(false);
    openInNewTab();
  }

  function bumpZoom(delta: number) {
    setZoom((z) => Math.max(25, Math.min(200, z + delta)));
  }

  const showPresent = effectiveDeck && source !== null;
  const canShare = source !== null;
  const exportTitle = file.name.replace(/\.html?$/i, '') || file.name;
  const canPptx = canShare && Boolean(onExportAsPptx) && !streaming;
  const previewScale = zoom / 100;

  return (
    <div className="viewer html-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reload')}
            aria-label={t('fileViewer.reloadAria')}
          >
            <Icon name="reload" size={14} />
          </button>
          {effectiveDeck ? (
            <span
              className="deck-nav"
              role="group"
              aria-label={t('fileViewer.slideNavAria')}
            >
              <button
                type="button"
                className="icon-only"
                onClick={() => postSlide('prev')}
                title={t('fileViewer.previousSlide')}
                aria-label={t('fileViewer.previousSlide')}
                disabled={slideState !== null && slideState.active <= 0}
              >
                <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="deck-nav-counter">
                {slideState
                  ? `${slideState.active + 1} / ${slideState.count}`
                  : '— / —'}
              </span>
              <button
                type="button"
                className="icon-only"
                onClick={() => postSlide('next')}
                title={t('fileViewer.nextSlide')}
                aria-label={t('fileViewer.nextSlide')}
                disabled={
                  slideState !== null &&
                  slideState.active >= slideState.count - 1
                }
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </span>
          ) : null}
          <button
            type="button"
            className="viewer-toggle"
            disabled
            data-coming-soon="true"
            title={t('fileViewer.tweaks')}
            aria-pressed={false}
            onClick={(e) => e.preventDefault()}
          >
            <Icon name="tweaks" size={13} />
            <span>{t('fileViewer.tweaks')}</span>
            <span className="switch" aria-hidden />
          </button>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          <span className="viewer-divider" aria-hidden />
          <button
            className="viewer-action"
            type="button"
            disabled
            data-coming-soon="true"
            title={t('fileViewer.comment')}
          >
            <Icon name="comment" size={13} />
            <span>{t('fileViewer.comment')}</span>
          </button>
          <button
            className={`viewer-action ${mode === 'edit' ? 'active' : ''}`}
            type="button"
            disabled={streaming || source === null}
            title={t('fileViewer.edit')}
            onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
            aria-pressed={mode === 'edit'}
          >
            <Icon name="edit" size={13} />
            <span>{t('fileViewer.edit')}</span>
          </button>
          {mode === 'edit' ? (
            <>
              <button
                className="viewer-action"
                type="button"
                onClick={() => void editSave()}
                disabled={editSaveState === 'saving'}
                title={t('fileViewer.editSave')}
                style={
                  editSaveState === 'saved'
                    ? { color: 'var(--success, #17A34A)' }
                    : editSaveState === 'error'
                      ? { color: 'var(--danger, #DC2626)' }
                      : undefined
                }
              >
                <Icon name="check" size={13} />
                <span>
                  {editSaveState === 'saving'
                    ? t('fileViewer.editSaving')
                    : editSaveState === 'saved'
                      ? t('fileViewer.editSaved')
                      : editSaveState === 'error'
                        ? t('fileViewer.editSaveFailed')
                        : t('fileViewer.editSave')}
                </span>
              </button>
              <button
                className="viewer-action"
                type="button"
                onClick={exitEditMode}
                title={t('fileViewer.editExit')}
              >
                <Icon name="close" size={13} />
                <span>{t('fileViewer.editExit')}</span>
              </button>
            </>
          ) : null}
          <button
            className="viewer-action"
            type="button"
            disabled
            data-coming-soon="true"
            title={t('fileViewer.draw')}
          >
            <Icon name="draw" size={13} />
            <span>{t('fileViewer.draw')}</span>
          </button>
          <span className="viewer-divider" aria-hidden />
          <button
            type="button"
            className="icon-only"
            onClick={() => bumpZoom(-25)}
            title={t('fileViewer.zoomOut')}
            aria-label={t('fileViewer.zoomOut')}
          >
            <Icon name="minus" size={14} />
          </button>
          <button
            type="button"
            className="viewer-action"
            onClick={() => setZoom(100)}
            title={t('fileViewer.resetZoom')}
            style={{ minWidth: 60 }}
          >
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{zoom}%</span>
          </button>
          <button
            type="button"
            className="icon-only"
            onClick={() => bumpZoom(25)}
            title={t('fileViewer.zoomIn')}
            aria-label={t('fileViewer.zoomIn')}
          >
            <Icon name="plus" size={14} />
          </button>
          <span className="viewer-divider" aria-hidden />
          {showPresent ? (
            <div className="present-wrap">
              <button
                className="viewer-action present-trigger"
                aria-haspopup="menu"
                aria-expanded={presentMenuOpen}
                onClick={() => setPresentMenuOpen((v) => !v)}
              >
                <Icon name="present" size={13} />
                <span>{t('fileViewer.present')}</span>
                <Icon name="chevron-down" size={11} />
              </button>
              {presentMenuOpen ? (
                <div className="present-menu" role="menu">
                  <button role="menuitem" onClick={presentInThisTab}>
                    <span className="present-icon"><Icon name="eye" size={13} /></span>{' '}
                    {t('fileViewer.presentInTab')}
                  </button>
                  <button role="menuitem" onClick={presentFullscreen}>
                    <span className="present-icon"><Icon name="play" size={13} /></span>{' '}
                    {t('fileViewer.presentFullscreen')}
                  </button>
                  <button role="menuitem" onClick={presentNewTab}>
                    <span className="present-icon"><Icon name="share" size={13} /></span>{' '}
                    {t('fileViewer.presentNewTab')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {canShare ? (
            <div className="share-menu" ref={shareRef}>
              <button
                className="viewer-action primary"
                aria-haspopup="menu"
                aria-expanded={shareMenuOpen}
                onClick={() => setShareMenuOpen((v) => !v)}
              >
                <span>{t('fileViewer.shareLabel')}</span>
                <Icon name="chevron-down" size={11} />
              </button>
              {shareMenuOpen ? (
                <div className="share-menu-popover" role="menu">
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setShareMenuOpen(false);
                      exportAsPdf(source ?? '', exportTitle, { deck: effectiveDeck });
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="file" size={14} /></span>
                    <span>
                      {effectiveDeck
                        ? t('fileViewer.exportPdfAllSlides')
                        : t('fileViewer.exportPdf')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={!canPptx}
                    title={
                      onExportAsPptx
                        ? streaming
                          ? t('fileViewer.exportPptxBusy')
                          : t('fileViewer.exportPptxHint')
                        : t('fileViewer.exportPptxNa')
                    }
                    onClick={() => {
                      setShareMenuOpen(false);
                      if (onExportAsPptx) onExportAsPptx(file.name);
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="present" size={14} /></span>
                    <span>{t('fileViewer.exportPptx') + '…'}</span>
                  </button>
                  <div className="share-menu-divider" />
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setShareMenuOpen(false);
                      exportAsZip(source ?? '', exportTitle);
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="download" size={14} /></span>
                    <span>{t('fileViewer.exportZip')}</span>
                  </button>
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setShareMenuOpen(false);
                      exportAsHtml(source ?? '', exportTitle);
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="file-code" size={14} /></span>
                    <span>{t('fileViewer.exportHtml')}</span>
                  </button>
                  <div className="share-menu-divider" />
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={savingTemplate}
                    onClick={() => {
                      void handleSaveAsTemplate();
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="copy" size={14} /></span>
                    <span>
                      {savingTemplate
                        ? t('fileViewer.savingTemplate')
                        : templateNote
                          ? templateNote
                          : t('fileViewer.saveAsTemplate')}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div
        className={`viewer-body ${mode === 'edit' ? 'viewer-body-edit' : ''}`}
        ref={previewBodyRef}
        style={mode === 'edit' ? { display: 'flex', flexDirection: 'row' } : undefined}
      >
        {source === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : mode === 'source' ? (
          <pre className="viewer-source">{source}</pre>
        ) : (
          // preview AND edit share the iframe — only difference is the
          // shim injected into srcDoc and the side panel below.
          <>
            <div
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                width: mode === 'edit' ? 'auto' : `${100 / previewScale}%`,
                height: mode === 'edit' ? '100%' : `${100 / previewScale}%`,
                transform: mode === 'edit' ? undefined : `scale(${previewScale})`,
                transformOrigin: '0 0',
              }}
            >
              <iframe
                ref={iframeRef}
                data-testid="artifact-preview-frame"
                title={file.name}
                sandbox="allow-scripts"
                srcDoc={srcDoc}
              />
            </div>
            {mode === 'edit' ? (
              <EditInspector
                selected={editSelected}
                onApply={(mutation) => {
                  if (!editSelected) return;
                  editApply(editSelected.selector, mutation);
                }}
                onDeselect={() => setEditSelected(null)}
                onClose={exitEditMode}
              />
            ) : null}
          </>
        )}
      </div>
      {inTabPresent && source ? (
        <div
          className="present-overlay"
          role="dialog"
          aria-label={t('fileViewer.exitPresentation')}
        >
          <button
            className="present-exit"
            onClick={() => setInTabPresent(false)}
            aria-label={t('fileViewer.exitPresentation')}
          >
            <Icon name="close" size={13} /> {t('fileViewer.exitPresentation')}
          </button>
          <iframe title="present" sandbox="allow-scripts" srcDoc={srcDoc} />
        </div>
      ) : null}
    </div>
  );
}

function baseDirFor(fileName: string): string {
  const idx = fileName.lastIndexOf('/');
  return idx >= 0 ? fileName.slice(0, idx + 1) : '';
}

function ImageViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const url = `${projectFileUrl(projectId, file.name)}?v=${Math.round(file.mtime)}`;
  return (
    <div className="viewer image-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            download={file.name}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className="viewer-body image-body">
        <img alt={file.name} src={url} />
      </div>
    </div>
  );
}

function TextViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((t) => {
      if (!cancelled) setText(t ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  const lineCount = text ? text.split('\n').length : 0;

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left" />
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            disabled
            title={t('fileViewer.saveDisabled')}
          >
            <Icon name="check" size={13} />
            <span>{t('fileViewer.save')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : lineCount > 0 ? (
          <CodeWithLines text={text} />
        ) : (
          <pre className="viewer-source">{text}</pre>
        )}
      </div>
    </div>
  );
}

function CodeWithLines({ text }: { text: string }) {
  const lines = text.split('\n');
  // Trailing newline produces a phantom empty line — keep gutter aligned.
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{text}</code>
    </pre>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentMetaLabel(file: ProjectFile, t: TranslateFn): string {
  if (file.kind === 'pdf') return t('fileViewer.pdfMeta');
  if (file.kind === 'document') return t('fileViewer.documentMeta');
  if (file.kind === 'presentation') return t('fileViewer.presentationMeta');
  if (file.kind === 'spreadsheet') return t('fileViewer.spreadsheetMeta');
  return t('fileViewer.binaryMeta', { size: humanSize(file.size) });
}
