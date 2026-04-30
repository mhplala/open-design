---
name: replit-deck
description: |
  Single-file horizontal-swipe HTML deck in the style of Replit Slides's
  landing-page template gallery. Eight distinct themes (helix, holm, vance,
  bevel, world-dark, world-mint, atlas, bluehouse) — each a complete visual
  system (palette + type + accent) captured from replit.com/slides. Pick one
  theme, do not mix. For pitch decks, board reports, brand memos, campaign
  reveals — when the user explicitly wants "Replit Slides style".
triggers:
  - "replit deck"
  - "replit slides"
  - "replit 风格 ppt"
  - "replit style deck"
  - "helix deck"
  - "holm memo"
  - "atlas chapter"
  - "bluehouse"
  - "bevel campaign"
od:
  mode: deck
  scenario: product
  preview:
    type: html
    entry: index.html
  design_system:
    requires: false
  inputs:
    - name: theme
      type: enum
      required: true
      default: helix
      values:
        - helix         # Modern minimal · light grey · ink + electric blue · SaaS metrics / board
        - holm          # Editorial serif · cream · ink + deep chestnut · legal / finance memo
        - vance         # Gallery · cream · cream serif on black bars · art catalog / showcase
        - bevel         # Y2K editorial · black · display type + product photo grid · campaign
        - world-dark    # Finance green dark · deep green · mint + neon yellow · policy report
        - world-mint    # Finance green light · mint · deep green + neon yellow · policy report
        - atlas         # Museum · black · serif + vermilion · long-form narrative / chapter deck
        - bluehouse     # Consumer card · deep navy · gradient cards + peach → coral · product showcase
    - name: slide_count
      type: integer
      default: 6
      min: 3
      max: 20
      # 6 is a board-update baseline. Memos and campaign decks usually land
      # at 3–4 (see example-holm / example-bluehouse). Long-form chapters
      # (atlas) can run 8–12. Don't pad to hit the default.
---

# Replit Deck Skill

Produce a single-file horizontal-swipe HTML deck in one of eight Replit-Slides themes. Every theme is a complete visual system — do not mix tokens across themes.

## Resource map

```
replit-deck/
├── SKILL.md                ← you're reading this
├── assets/
│   └── template.html       ← seed: 8 themes via [data-theme=*], proven iframe-nav script (READ FIRST)
├── references/
│   ├── themes.md           ← 8 themes: when-to-pick / do / don't / primary layouts
│   ├── layouts.md          ← 10 paste-ready slide layouts, cross-theme
│   ├── components.md       ← shared primitives (eyebrow, kpi-row, image-grid, meta-bar)
│   └── checklist.md        ← P0/P1/P2 self-review + theme lock-in gate
└── examples/               ← four reference decks across the most contrasting themes
    ├── example-helix.html       (SaaS board update · light minimal)
    ├── example-holm.html        (legal fintech memo · cream editorial serif)
    ├── example-atlas.html       (quarterly history chapter · black + vermilion)
    └── example-bluehouse.html   (real estate ROI · navy + gradient cards)
```

## Workflow

### Step 0 — Theme picker (REQUIRED first turn — overrides general discovery rules)

The eight Replit-Slides themes are not interchangeable; each is a complete visual system that touches palette, font stack, layout posture, and tone. Picking the wrong one is the single biggest cause of regressions in this skill. So **before any tool use, before reading any file, before TodoWrite**, your very first output is the theme-picker form below — unless one of the explicit skip cases applies.

**Skip ONLY if:**
- The user already declared a theme by name in their brief ("a helix-style board update", "use bluehouse"), OR
- The conversation already contains a `[form answers — replit-theme]` message, OR
- The latest message starts with `[form answers — replit-theme]`.

Otherwise emit this verbatim, then stop your turn:

```
<question-form id="replit-theme" title="Pick a Replit Slides theme" submitLabel="Use this theme">
{
  "description": "Each is a complete visual system. The whole deck uses one theme's tokens — no mixing.",
  "questions": [
    {
      "id": "theme",
      "label": "Theme",
      "type": "direction-cards",
      "required": true,
      "options": ["helix", "holm", "vance", "bevel", "world-dark", "world-mint", "atlas", "bluehouse"],
      "cards": [
        {
          "id": "helix",
          "label": "Helix — Modern Minimal",
          "mood": "Light grey background, electric blue accent. Clean grids, mono numerics. Built for SaaS metrics, product board updates, neutral modern.",
          "references": ["Linear dashboard", "Stripe annual report", "Vercel briefings"],
          "palette": ["#fafafa", "#19191c", "#5889fe", "#6e6e73", "#e4e4e7"],
          "displayFont": "-apple-system, 'Inter Display', system-ui, sans-serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "holm",
          "label": "Holm — Editorial Serif",
          "mood": "Cream background, deep chestnut accent, large serif display. Reads like a legal memo or investor pre-read — quiet, institutional, dignified.",
          "references": ["Wachtell legal memo", "Bridgewater quarterly", "FT Weekend pre-read"],
          "palette": ["#e4dfd7", "#0f0f0e", "#52311d", "#7c7e84", "#c7c1b7"],
          "displayFont": "'Iowan Old Style', 'Charter', Georgia, serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "vance",
          "label": "Vance — Gallery Catalog",
          "mood": "Cream / black bars, serif over plates, zero ornament. Built for art portfolios, design studios, photographer / sculptor showcases.",
          "references": ["Wallpaper magazine", "Apartamento", "Hauser & Wirth catalog"],
          "palette": ["#f1ede2", "#171815", "#171815", "#6e6b62", "#d6d2c5"],
          "displayFont": "'Iowan Old Style', 'Charter', Georgia, serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "bevel",
          "label": "Bevel — Y2K Editorial",
          "mood": "Black canvas, neon-yellow outline, condensed display type, dashed framing. Fashion campaign / lookbook attitude — intentionally loud.",
          "references": ["Diesel SS26 lookbook", "Jacquemus deck", "032c magazine"],
          "palette": ["#0d0d0b", "#eae6dd", "#c8ff00", "#a29e95", "#2a2a28"],
          "displayFont": "'Antonio', 'Bebas Neue', Impact, sans-serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "world-dark",
          "label": "World Dark — Finance Report",
          "mood": "Deep forest green, neon-yellow data accent. Premium dark dashboard for policy reports, finance analyses, central-bank reads.",
          "references": ["Bridgewater Daily Observations", "Pictet quarterly", "BlackRock investment outlook"],
          "palette": ["#0d3a2b", "#bcd6cd", "#e8f615", "#789f91", "#1d4c3c"],
          "displayFont": "-apple-system, 'Inter Display', system-ui, sans-serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "world-mint",
          "label": "World Mint — Light Sustainability",
          "mood": "Mint background, deep-green ink, neon-yellow accent. Lighter cousin of World Dark — ESG, wellness finance, sustainability narratives.",
          "references": ["Patagonia annual benefit report", "Allbirds sustainability", "B Corp impact decks"],
          "palette": ["#bcd6cd", "#0d3a2b", "#e8f615", "#527567", "#9abbac"],
          "displayFont": "-apple-system, 'Inter Display', system-ui, sans-serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "atlas",
          "label": "Atlas — Museum Narrative",
          "mood": "Black with vermilion serif accent. Long-form narrative chapter deck, museum or archive aesthetic — built to be read.",
          "references": ["Met Museum chapter deck", "Princeton University Press", "Phaidon archive"],
          "palette": ["#111010", "#e7e6e2", "#de3f40", "#827d78", "#2a2826"],
          "displayFont": "'Iowan Old Style', 'Charter', Georgia, serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        },
        {
          "id": "bluehouse",
          "label": "Bluehouse — Consumer Cards",
          "mood": "Deep navy with peach → coral gradient cards. Real estate, lifestyle product showcase, consumer brand decks — colorful but composed.",
          "references": ["Compass listing book", "Sotheby's portfolio", "Airbnb host deck"],
          "palette": ["#0b1524", "#ffffff", "#fb675d", "#ff8f68", "#1a2c46"],
          "displayFont": "-apple-system, 'Inter Display', system-ui, sans-serif",
          "bodyFont": "-apple-system, 'Inter', system-ui, sans-serif"
        }
      ]
    }
  ]
}
</question-form>
```

After `</question-form>`, **stop your turn**. Do not Read, do not Bash, do not TodoWrite. Wait for the user to submit.

When the user replies (the message starts with `[form answers — replit-theme]`), the chosen theme id is your answer. Bind it as `<body data-theme="<id>">` in Step 3 below. Move on to Step 1 (pre-flight reads).

### Step 1 — Pre-flight (mandatory reads, after theme is locked)

1. Read `assets/template.html` end-to-end. The `[data-theme]` blocks carry the tokens; the `<script>` at the bottom solves five iframe nav bugs — **do not rewrite it**.
2. Read `references/themes.md` → confirm the theme's do/don't and best-fit layouts.
3. Read `references/layouts.md` → you'll copy `<section>` blocks from here.
4. Read `references/checklist.md` → P0 must pass before emit.

### Step 2 — Confirm theme + write the plan

The theme is already locked from the form answer (or from the user's explicit name in their brief). Confirm it in one sentence in the TodoWrite or plan section: *"Going with `helix` because the user asked for a board update with metrics."* Once committed, **every slide uses that theme's tokens only**. No swapping mid-deck. The `<body data-theme="helix">` attribute is the single source of truth.

Quick reminder of when each theme fits (use this only as a sanity check against the form answer):

| Theme | Pick when |
|---|---|
| `helix` | SaaS board update, product metrics, neutral modern |
| `holm` | Legal memo, investor pre-read, serious / institutional |
| `vance` | Art portfolio, design catalog, photographer / sculptor |
| `bevel` | Fashion campaign, lookbook, Y2K / editorial attitude |
| `world-dark` | Policy report, finance analysis, premium dark |
| `world-mint` | Lighter companion of world-dark — ESG, wellness finance, sustainability |
| `atlas` | Long-form narrative, chapter deck, museum / archive aesthetic |
| `bluehouse` | Consumer product, real estate, lifestyle, colorful cards |

### Step 3 — Plan slide rhythm before writing HTML

Default 6 slides. Write the rhythm BEFORE any HTML, for example (helix, 6 slides):

```
01  cover           hero + title + subtitle
02  kpi-row-6       6 metrics with ▲/▼ deltas
03  split-insight   left stat + right paragraph
04  chapter-plate   section divider
05  three-up        three parallel columns
06  closing         one bold number or CTA
```

Show this to the user. Redirecting at this stage is cheap.

### Step 4 — Copy seed, bind theme

1. Copy `assets/template.html` to project root as `index.html`.
2. Set `<body data-theme="<chosen>">`.
3. Replace `<title>`.
4. Delete the placeholder slides in the body (the seed ships with 3 demo slides). Keep the chrome (counter / progress / hint).

### Step 5 — Paste layouts, fill real copy

For each planned slide, copy the matching `<section>` from `references/layouts.md`. Replace every `[REPLACE]` with specific copy — never leave placeholders, never use lorem. If a slide feels empty, pick a different layout.

Tag each slide with `data-screen-label="01 Cover"`, `"02 Metrics"`, etc., in presentation order.

### Step 6 — Self-check

Run `references/checklist.md` silently before emit: the **P0 theme-lock gate** plus the five-dimension 1–5 critique (Philosophy / Hierarchy / Execution / Specificity / Restraint). Any dimension ≤ 3 → re-do before emit.

The P0 theme-lock grep is non-negotiable:

```bash
grep -E 'data-theme|style="--' index.html | head
```

If any `style="--accent:..."` or theme override appears on individual slides, revert. One theme per deck.

### Step 7 — Emit artifact

```
<artifact identifier="deck-<slug>" type="text/html" title="<Deck title>">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact. Stop after `</artifact>`.

## Hard rules

- **One theme per deck.** `data-theme` set on `<body>` — never override per-slide.
- **Numbers are real or absent.** No invented metrics. Use `—` or a grey block as an honest placeholder.
- **Display face follows theme.** helix/world-dark/world-mint/bluehouse use the sans Display; holm/vance/atlas use the serif Display; bevel uses the Y2K display. Do not swap. (Authoritative source: the `--font-display` token of each theme in `assets/template.html` — if this list ever disagrees with the template, the template wins.)
- **Accent appears 1–2× per slide max.** Never a gradient-spam.
- **Never rewrite the nav script.** Five iframe bugs it solves are not obvious.
- **Keep it one HTML file.** Inline all CSS. No external fonts — the system stack in each theme is deliberate.
- **`data-screen-label` on every slide.**
- **No Replit logo / brand lockup.** These are template styles, not a Replit-brand deck.

---

## When to pick `replit-deck` vs. peer skills

| Skill | Pick when |
|---|---|
| `simple-deck` | Plain, single-theme deck bound to the project's `DESIGN.md` tokens. When the deck should *match* the host brand, not assert its own. (`designSystemRequired: true`.) |
| `magazine-web-ppt` | Editorial "magazine × e-ink" aesthetic (WebGL fluid background, serif titles, chapter plates). When the brief asks for a keynote / launch / sharing-style deck and calls out Monocle / WIRED / Kinfolk / Domus. |
| `replit-deck` | The brief explicitly asks for Replit-Slides gallery aesthetic, or needs one of the 8 token-frozen visual identities (SaaS board, editorial memo, gallery catalog, Y2K campaign, policy report, museum chapter, consumer cards). No dependency on `DESIGN.md`. |

If the user just says "make me a deck" without further guidance, default to `simple-deck` — it respects their design system. Pick `replit-deck` only when the brief is explicit about the aesthetic or names a theme.

---

## Scope & provenance

- **Eight themes = the full replit.com/slides landing-page gallery at the time of snapshot.** Not a curated subset — every theme card currently published on replit.com/slides is represented here (helix, holm, vance, bevel, world-dark, world-mint, atlas, bluehouse). If Replit ships a ninth template, it is **not** automatically reflected in this skill.
- **Snapshot date: 2026-04-29.** All hex values were sampled from the actual replit.com/slides PNGs on that date with ImageMagick — no guessed colors, no memory substitutions. See `references/themes.md` → *Contributing a new theme* for the exact sampling procedure.
- **Maintenance: one-time snapshot, not tracked.** Replit Slides is a live product and may drift. This skill does not auto-sync. If you notice Replit has updated colors or added a theme and want it reflected here, open an issue on `nexu-io/open-design` titled `replit-deck: re-sync to replit.com/slides (YYYY-MM-DD)` and attach the updated screenshots. There is no designated owner monitoring the upstream.
- **No Replit branding.** These are gallery-style templates, not a Replit-brand deck. The checklist (P0) forbids inserting a Replit logo or wordmark.

---

## Browser / runtime support

- **Target**: modern evergreen desktop browsers (Chrome 110+ / Safari 16+ / Firefox 115+) and modern mobile Safari / Chrome.
- **Features used**: CSS scroll-snap (horizontal), `color-mix()`, CSS custom properties, `text-wrap: balance`. All ≥ 93% Baseline.
- **Not supported**: IE 11, Safari < 15, any browser without `color-mix()` (would need a fallback `--accent-soft` if you want to support older Safari; out of scope for this skill).
- **Mobile**: horizontal scroll-snap works on iOS Safari 16+ and Android Chrome. Keyboard nav is desktop-only by design.
- **Nav script behavior**: reused verbatim from `skills/simple-deck` — survives iframe embedding (the daemon preview surface), dual listener races, focus loss, and position persistence across reloads. **Do not rewrite it.**

---

## Verification

The skill auto-registers with the daemon on filesystem scan (no manual wiring). Confirmed against a running daemon on `localhost:7456` after adding this skill:

```bash
$ curl -s localhost:7456/api/skills \
    | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf-8')); \
               console.log(JSON.stringify(d.skills.find(s=>s.id==='replit-deck'), null, 2));"
{
  "id": "replit-deck",
  "name": "replit-deck",
  "description": "Single-file horizontal-swipe HTML deck in the style of Replit Slides's\nlanding-page template gallery. Eight distinct themes …",
  "triggers": [
    "replit deck",
    "replit slides",
    "replit 风格 ppt",
    "replit style deck",
    "helix deck",
    "holm memo",
    "atlas chapter",
    "bluehouse",
    "bevel campaign"
  ],
  "mode": "deck",
  "platform": null,
  "scenario": "product",
  "previewType": "html",
  "designSystemRequired": false,
  "defaultFor": [],
  "upstream": null,
  "featured": null,
  "fidelity": null,
  "speakerNotes": null,
  "animations": null,
  "examplePrompt": "Single-file horizontal-swipe HTML deck in the style of Replit Slides's landing-page template gallery.",
  "hasBody": true
}
```

All four example decks (`examples/example-{helix,holm,atlas,bluehouse}.html`) open directly in a browser. Keyboard nav (← / → / Space / Home / End) and horizontal scroll-snap work in Chrome 129 and Safari 18.
