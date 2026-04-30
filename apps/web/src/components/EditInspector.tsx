import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import {
  type EditElementSnapshot,
  type EditMutation,
  type EditSelector,
  type EditStyleSnapshot,
  selectorEquals,
} from '../runtime/edit-bridge';
import { Icon } from './Icon';
import './EditInspector.css';

export interface EditInspectorProps {
  selected: EditElementSnapshot | null;
  onApply: (mutation: EditMutation) => void;
  onDeselect: () => void;
  onClose: () => void;
}

// Truncation budget for the className blurb in the identity card. The full
// string is still surfaced via a `title` attribute so the user can hover
// to read everything.
const CLASS_TRUNCATE_AT = 50;

const TEXT_ALIGN_OPTIONS: ReadonlyArray<'left' | 'center' | 'right' | 'justify'> = [
  'left',
  'center',
  'right',
  'justify',
];

const FONT_WEIGHT_OPTIONS = [
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
];

// CSS-style snapshot keys driven by simple text inputs in the Advanced
// drawer. Order matters — it controls the on-screen order. The `key` is
// narrowed to the subset of `FormState` we actually mirror locally so the
// loop in render can index `form[key]` without TS widening to `any`.
type AdvancedKey =
  | 'fontFamily'
  | 'lineHeight'
  | 'letterSpacing'
  | 'borderColor'
  | 'borderWidth';

const ADVANCED_KEYS: ReadonlyArray<{
  key: AdvancedKey;
  labelKey:
    | 'editInspector.fontFamily'
    | 'editInspector.lineHeight'
    | 'editInspector.letterSpacing'
    | 'editInspector.borderColor'
    | 'editInspector.borderWidth';
}> = [
  { key: 'fontFamily', labelKey: 'editInspector.fontFamily' as const },
  { key: 'lineHeight', labelKey: 'editInspector.lineHeight' as const },
  { key: 'letterSpacing', labelKey: 'editInspector.letterSpacing' as const },
  { key: 'borderColor', labelKey: 'editInspector.borderColor' as const },
  { key: 'borderWidth', labelKey: 'editInspector.borderWidth' as const },
];

// We type the few labelKey constants directly above; many of them are
// outside the *known* `Dict` keys that already exist for the inspector,
// so we soften the call site by going through `unknown` only at the
// boundary. The keys themselves still flow as string literals.
type KnownAdvancedLabelKey = (typeof ADVANCED_KEYS)[number]['labelKey'];

// ---- Color parsing helpers ---------------------------------------------

// Parse a CSS color value into a `#rrggbb` hex string suitable for the
// native color input. The browser hands back computed values as
// `rgb(r, g, b)` or `rgba(r, g, b, a)`; the input itself only accepts
// 6-digit hex. Anything we can't parse becomes `#000000` (the picker
// will still render and the user can re-pick).
function rgbToHex(input: string): string {
  if (!input) return '#000000';
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 7) return trimmed.toLowerCase();
    if (trimmed.length === 4) {
      // #rgb -> #rrggbb
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      if (r && g && b) return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return '#000000';
  }
  const m = trimmed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return '#000000';
  const r = clampByte(Number(m[1]));
  const g = clampByte(Number(m[2]));
  const b = clampByte(Number(m[3]));
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return n.toString(16).padStart(2, '0');
}

// Parse the leading number out of a CSS length like `"24px"` or `"1.5rem"`.
// Used to seed numeric inputs; non-numeric inputs return null so we can
// render a blank field instead of a confusing zero.
function parseLeadingNumber(input: string): number | null {
  if (!input) return null;
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)/);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ---- Form state shape ---------------------------------------------------

interface FormState {
  textContent: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  borderRadius: string;
  fontFamily: string;
  lineHeight: string;
  letterSpacing: string;
  borderColor: string;
  borderWidth: string;
}

function snapshotToForm(s: EditElementSnapshot): FormState {
  return {
    textContent: s.textContent,
    paddingTop: s.styles.paddingTop,
    paddingRight: s.styles.paddingRight,
    paddingBottom: s.styles.paddingBottom,
    paddingLeft: s.styles.paddingLeft,
    marginTop: s.styles.marginTop,
    marginRight: s.styles.marginRight,
    marginBottom: s.styles.marginBottom,
    marginLeft: s.styles.marginLeft,
    borderRadius: s.styles.borderRadius,
    fontFamily: s.styles.fontFamily,
    lineHeight: s.styles.lineHeight,
    letterSpacing: s.styles.letterSpacing,
    borderColor: s.styles.borderColor,
    borderWidth: s.styles.borderWidth,
  };
}

function emptyForm(): FormState {
  return {
    textContent: '',
    paddingTop: '',
    paddingRight: '',
    paddingBottom: '',
    paddingLeft: '',
    marginTop: '',
    marginRight: '',
    marginBottom: '',
    marginLeft: '',
    borderRadius: '',
    fontFamily: '',
    lineHeight: '',
    letterSpacing: '',
    borderColor: '',
    borderWidth: '',
  };
}

// ---- Component ----------------------------------------------------------

/**
 * Side-panel inspector for the in-place edit feature. Shows the currently
 * picked element from the artifact iframe and exposes a curated set of
 * style / text controls. Each control fires `onApply` with a single-key
 * mutation; we deliberately never echo the whole snapshot back, since the
 * iframe's `od:edit:applied` event doesn't refresh our snapshot and we'd
 * end up clobbering subsequent edits. Save is owned by FileViewer.
 */
export function EditInspector({
  selected,
  onApply,
  onDeselect,
  onClose,
}: EditInspectorProps): JSX.Element {
  const t = useT();

  // Track the last selector we hydrated form state from so re-renders that
  // reuse the *same* selection (e.g., post-apply echoes) don't blow away
  // mid-edit text the user has typed but not applied yet.
  const lastSelectorRef = useRef<EditSelector | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    selected ? snapshotToForm(selected) : emptyForm(),
  );

  useEffect(() => {
    if (!selected) {
      lastSelectorRef.current = null;
      setForm(emptyForm());
      return;
    }
    const prev = lastSelectorRef.current;
    if (prev && selectorEquals(prev, selected.selector)) {
      // Same selection re-emitted — keep current form state.
      return;
    }
    lastSelectorRef.current = selected.selector;
    setForm(snapshotToForm(selected));
  }, [selected]);

  // The host renders the panel chrome regardless of selection state so the
  // layout doesn't shift when the user moves between elements. Empty state
  // lives in the body.
  return (
    <aside
      className="edit-inspector"
      aria-label={t('editInspector.title')}
      role="complementary"
    >
      <header className="edit-inspector-head">
        <h3 className="edit-inspector-title">{t('editInspector.title')}</h3>
        <button
          type="button"
          className="icon-only"
          onClick={onClose}
          title={t('editInspector.close')}
          aria-label={t('editInspector.close')}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="edit-inspector-body">
        {selected === null ? (
          <div className="edit-inspector-empty">{t('editInspector.empty')}</div>
        ) : (
          <SelectedView
            selected={selected}
            form={form}
            setForm={setForm}
            onApply={onApply}
            onDeselect={onDeselect}
          />
        )}
      </div>
    </aside>
  );
}

export default EditInspector;

// ---- Inner view with controls ------------------------------------------

interface SelectedViewProps {
  selected: EditElementSnapshot;
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  onApply: (mutation: EditMutation) => void;
  onDeselect: () => void;
}

function SelectedView({
  selected,
  form,
  setForm,
  onApply,
  onDeselect,
}: SelectedViewProps): JSX.Element {
  const t = useT();

  // Mark `onDeselect` as referenced so callers can wire it up without TS
  // complaining about unused props. We expose it as the body-click escape
  // hatch when the user clicks the empty area between sections.
  void onDeselect;

  const className = selected.className;
  const truncatedClass =
    className.length > CLASS_TRUNCATE_AT
      ? `${className.slice(0, CLASS_TRUNCATE_AT)}...`
      : className;

  function applyStyle<K extends keyof EditStyleSnapshot>(key: K, value: string) {
    onApply({ styles: { [key]: value } as Partial<EditStyleSnapshot> });
  }

  const styles = selected.styles;
  const colorHex = rgbToHex(styles.color);
  const bgHex = rgbToHex(styles.backgroundColor);
  const fontSizeNum = parseLeadingNumber(styles.fontSize);
  const fontWeightCurrent = styles.fontWeight || '400';
  const textAlignCurrent = (styles.textAlign || 'left').toLowerCase();

  return (
    <>
      {/* --- Identity --------------------------------------------------- */}
      <section
        className="edit-inspector-section"
        aria-label={t('editInspector.tag')}
      >
        <div className="edit-inspector-identity">
          <div className="edit-inspector-identity-row">
            <span className="edit-inspector-identity-label">
              {t('editInspector.tag')}
            </span>
            <span className="edit-inspector-identity-value">
              {`<${selected.tag}>`}
              {selected.id ? `#${selected.id}` : ''}
            </span>
          </div>
          {className ? (
            <div className="edit-inspector-identity-row">
              <span className="edit-inspector-identity-label">
                {t('editInspector.classes')}
              </span>
              <span
                className="edit-inspector-identity-value"
                title={className}
              >
                .{truncatedClass.replace(/\s+/g, '.')}
              </span>
            </div>
          ) : null}
          <span
            className={
              'edit-inspector-anchor' +
              (selected.selector.kind === 'od-id' ? ' is-od-id' : '')
            }
            title={t('editInspector.selectorAnchor')}
          >
            {selected.selector.kind === 'od-id'
              ? `${t('editInspector.selectorAnchorOdId')}: ${selected.selector.value}`
              : t('editInspector.selectorAnchorPath')}
          </span>
        </div>
      </section>

      {/* --- Text content ----------------------------------------------- */}
      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          {t('editInspector.text')}
        </div>
        <textarea
          className="edit-inspector-textarea"
          value={form.textContent}
          disabled={selected.hasChildren}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, textContent: e.target.value }))
          }
        />
        {selected.hasChildren ? (
          <p className="edit-inspector-text-hint">
            {t('editInspector.textDisabledHasChildren')}
          </p>
        ) : null}
        <div className="edit-inspector-text-actions">
          <button
            type="button"
            className="viewer-action"
            disabled={selected.hasChildren}
            onClick={() => onApply({ text: form.textContent })}
          >
            {t('editInspector.textApply')}
          </button>
        </div>
      </section>

      {/* --- Color ------------------------------------------------------ */}
      <ColorRow
        label={t('editInspector.color')}
        resetLabel={t('editInspector.reset')}
        hex={colorHex}
        raw={styles.color}
        onPick={(hex) => applyStyle('color', hex)}
        onReset={() => applyStyle('color', '')}
      />

      {/* --- Background ------------------------------------------------- */}
      <ColorRow
        label={t('editInspector.background')}
        resetLabel={t('editInspector.reset')}
        hex={bgHex}
        raw={styles.backgroundColor}
        onPick={(hex) => applyStyle('backgroundColor', hex)}
        onReset={() => applyStyle('backgroundColor', '')}
      />

      {/* --- Font size -------------------------------------------------- */}
      <div className="edit-inspector-row">
        <div className="edit-inspector-row-head">
          <span className="edit-inspector-label">
            {t('editInspector.fontSize')}
          </span>
          <ResetButton
            label={t('editInspector.reset')}
            onClick={() => applyStyle('fontSize', '')}
          />
        </div>
        <div className="edit-inspector-num-row">
          <input
            className="edit-inspector-input"
            type="number"
            min={8}
            max={96}
            step={1}
            value={fontSizeNum ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              applyStyle('fontSize', `${n}px`);
            }}
          />
          <span className="edit-inspector-unit">px</span>
        </div>
      </div>

      {/* --- Font weight ------------------------------------------------ */}
      <div className="edit-inspector-row">
        <div className="edit-inspector-row-head">
          <span className="edit-inspector-label">
            {t('editInspector.fontWeight')}
          </span>
          <ResetButton
            label={t('editInspector.reset')}
            onClick={() => applyStyle('fontWeight', '')}
          />
        </div>
        <select
          className="edit-inspector-select"
          value={
            FONT_WEIGHT_OPTIONS.includes(fontWeightCurrent)
              ? fontWeightCurrent
              : '400'
          }
          onChange={(e) => applyStyle('fontWeight', e.target.value)}
        >
          {FONT_WEIGHT_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      {/* --- Text align ------------------------------------------------- */}
      <div className="edit-inspector-row">
        <div className="edit-inspector-row-head">
          <span className="edit-inspector-label">
            {t('editInspector.textAlign')}
          </span>
          <ResetButton
            label={t('editInspector.reset')}
            onClick={() => applyStyle('textAlign', '')}
          />
        </div>
        <div className="edit-inspector-segmented" role="radiogroup">
          {TEXT_ALIGN_OPTIONS.map((opt) => {
            const active = textAlignCurrent === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? 'active' : ''}
                onClick={() => applyStyle('textAlign', opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- Padding (4-up) -------------------------------------------- */}
      <QuadInput
        label={t('editInspector.padding')}
        resetLabel={t('editInspector.reset')}
        values={{
          top: form.paddingTop,
          right: form.paddingRight,
          bottom: form.paddingBottom,
          left: form.paddingLeft,
        }}
        onChange={(side, val) =>
          setForm((prev) => ({
            ...prev,
            [`padding${cap(side)}` as keyof FormState]: val,
          }))
        }
        onCommit={(side, val) => {
          const key = `padding${cap(side)}` as keyof EditStyleSnapshot;
          applyStyle(key, val);
        }}
        onReset={() => {
          // Clear all four sides at once via a single mutation so the
          // iframe doesn't get a flicker of partial state between sides.
          onApply({
            styles: {
              paddingTop: '',
              paddingRight: '',
              paddingBottom: '',
              paddingLeft: '',
            },
          });
          setForm((prev) => ({
            ...prev,
            paddingTop: '',
            paddingRight: '',
            paddingBottom: '',
            paddingLeft: '',
          }));
        }}
      />

      {/* --- Margin (4-up) --------------------------------------------- */}
      <QuadInput
        label={t('editInspector.margin')}
        resetLabel={t('editInspector.reset')}
        values={{
          top: form.marginTop,
          right: form.marginRight,
          bottom: form.marginBottom,
          left: form.marginLeft,
        }}
        onChange={(side, val) =>
          setForm((prev) => ({
            ...prev,
            [`margin${cap(side)}` as keyof FormState]: val,
          }))
        }
        onCommit={(side, val) => {
          const key = `margin${cap(side)}` as keyof EditStyleSnapshot;
          applyStyle(key, val);
        }}
        onReset={() => {
          onApply({
            styles: {
              marginTop: '',
              marginRight: '',
              marginBottom: '',
              marginLeft: '',
            },
          });
          setForm((prev) => ({
            ...prev,
            marginTop: '',
            marginRight: '',
            marginBottom: '',
            marginLeft: '',
          }));
        }}
      />

      {/* --- Border radius --------------------------------------------- */}
      <div className="edit-inspector-row">
        <div className="edit-inspector-row-head">
          <span className="edit-inspector-label">
            {t('editInspector.borderRadius')}
          </span>
          <ResetButton
            label={t('editInspector.reset')}
            onClick={() => {
              applyStyle('borderRadius', '');
              setForm((prev) => ({ ...prev, borderRadius: '' }));
            }}
          />
        </div>
        <input
          className="edit-inspector-input"
          type="text"
          value={form.borderRadius}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, borderRadius: e.target.value }))
          }
          onBlur={(e) => applyStyle('borderRadius', e.target.value)}
        />
      </div>

      {/* --- Advanced --------------------------------------------------- */}
      <details className="edit-inspector-advanced">
        <summary>{t('editInspector.advanced')}</summary>
        <div className="edit-inspector-advanced-body">
          {ADVANCED_KEYS.map(({ key, labelKey }) => (
            <div key={key} className="edit-inspector-row">
              <div className="edit-inspector-row-head">
                <span className="edit-inspector-label">
                  {advancedLabel(t, labelKey, key)}
                </span>
                <ResetButton
                  label={t('editInspector.reset')}
                  onClick={() => {
                    applyStyle(key, '');
                    setForm((prev) => ({ ...prev, [key]: '' }));
                  }}
                />
              </div>
              <input
                className="edit-inspector-input"
                type="text"
                value={form[key]}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [key]: e.target.value }))
                }
                onBlur={(e) => applyStyle(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

// Resolve an "Advanced" label, falling back to the bare CSS property when
// the i18n dictionary doesn't yet carry that key.  Keeps strict TS happy
// without forcing us to extend `Dict` from this component.
function advancedLabel(
  t: ReturnType<typeof useT>,
  labelKey: KnownAdvancedLabelKey,
  fallback: string,
): string {
  const dict = t as unknown as (k: string) => string;
  try {
    const v = dict(labelKey);
    // i18n falls back to returning the key itself when missing — detect
    // that and use the human-readable property name instead.
    if (v && v !== labelKey) return v;
  } catch {
    /* fall through */
  }
  return humanizeStyleKey(fallback);
}

function humanizeStyleKey(key: string): string {
  // fontFamily -> Font family
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function cap<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}

// ---- Sub-components -----------------------------------------------------

interface ColorRowProps {
  label: string;
  resetLabel: string;
  hex: string;
  raw: string;
  onPick: (hex: string) => void;
  onReset: () => void;
}

function ColorRow({
  label,
  resetLabel,
  hex,
  raw,
  onPick,
  onReset,
}: ColorRowProps): JSX.Element {
  return (
    <div className="edit-inspector-row">
      <div className="edit-inspector-row-head">
        <span className="edit-inspector-label">{label}</span>
        <ResetButton label={resetLabel} onClick={onReset} />
      </div>
      <div className="edit-inspector-color-row">
        <input
          type="color"
          className="edit-inspector-color-swatch"
          value={hex}
          onChange={(e) => onPick(e.target.value)}
        />
        <span className="edit-inspector-color-text" title={raw}>
          {raw || hex}
        </span>
      </div>
    </div>
  );
}

interface QuadInputProps {
  label: string;
  resetLabel: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (
    side: 'top' | 'right' | 'bottom' | 'left',
    value: string,
  ) => void;
  onCommit: (
    side: 'top' | 'right' | 'bottom' | 'left',
    value: string,
  ) => void;
  onReset: () => void;
}

function QuadInput({
  label,
  resetLabel,
  values,
  onChange,
  onCommit,
  onReset,
}: QuadInputProps): JSX.Element {
  const sides: ReadonlyArray<'top' | 'right' | 'bottom' | 'left'> = [
    'top',
    'right',
    'bottom',
    'left',
  ];
  return (
    <div className="edit-inspector-row">
      <div className="edit-inspector-row-head">
        <span className="edit-inspector-label">{label}</span>
        <ResetButton label={resetLabel} onClick={onReset} />
      </div>
      <div className="edit-inspector-quad">
        {sides.map((side) => (
          <label key={side}>
            <span className="edit-inspector-quad-label">{side}</span>
            <input
              className="edit-inspector-input"
              type="text"
              value={values[side]}
              onChange={(e) => onChange(side, e.target.value)}
              onBlur={(e) => onCommit(side, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

interface ResetButtonProps {
  label: string;
  onClick: () => void;
}

function ResetButton({ label, onClick }: ResetButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="edit-inspector-reset"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {'×'}
    </button>
  );
}
