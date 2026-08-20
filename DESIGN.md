---
name: pi-annotate — The Redline Proof
description: A calm rendered-markdown annotation surface where marks live on the text and in the margin.
colors:
  # Theme-bound: referenced via daisyUI CSS variables; the active theme
  # (nord) supplies the concrete values. See "Theme-Bound, Not Hard-Coded".
  base-100: "var(--color-base-100)"
  base-200: "var(--color-base-200)"
  base-300: "var(--color-base-300)"
  base-content: "var(--color-base-content)"
  primary: "var(--color-primary)"
  primary-content: "var(--color-primary-content)"
  neutral: "var(--color-neutral)"
  neutral-content: "var(--color-neutral-content)"
  warning: "var(--color-warning)"
  error: "var(--color-error)"
  # The Redline Proof's own material tokens — the few values the page owns
  # beyond the daisyUI role set. Ink is never pure black; the ground drifts
  # near-white; the redline is the one earned saturated accent.
  ink: "oklch(22% 0.01 250)"
  paper: "oklch(98% 0.003 90)"
  paper-warm: "oklch(97% 0.006 70)"
  paper-cool: "oklch(97% 0.004 220)"
  hairline: "oklch(90% 0.005 250)"
  redline: "oklch(52% 0.18 28)"
typography:
  body:
    fontFamily: "var(--font-sans)"
    fontSize: "var(--text-base)"
    fontWeight: "400"
    lineHeight: "1.7"
    letterSpacing: "normal"
  doc-h1:
    fontFamily: "var(--font-sans)"
    fontWeight: "700"
    letterSpacing: "-0.02em"
    lineHeight: "1.15"
  doc-h2:
    fontFamily: "var(--font-sans)"
    fontWeight: "600"
    letterSpacing: "-0.01em"
  label:
    fontFamily: "var(--font-mono)"
    fontSize: "0.6875rem"
    fontWeight: "600"
    letterSpacing: "0.08em"
  note-meta:
    fontFamily: "var(--font-mono)"
    fontSize: "0.625rem"
    fontWeight: "600"
    letterSpacing: "0.06em"
rounded:
  proof: "2px"
spacing:
  gutter: "1.75rem"
  section: "1.5rem"
  note-pad: "0.5rem 0.6rem"
components:
  block-marker:
    backgroundColor: "transparent"
    textColor: "{colors.neutral}"
    rounded: "{rounded.proof}"
  range-marker:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.redline}"
    rounded: "{rounded.proof}"
  note-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.base-content}"
    rounded: "{rounded.proof}"
  proof-stamp:
    backgroundColor: "{colors.redline}"
    textColor: "oklch(98% 0.01 70)"
    rounded: "{rounded.proof}"
---

# Design System: pi-annotate — The Redline Proof

## Overview

**Creative North Star: "The Redline Proof"**

pi-annotate opens a rendered markdown file so a developer mid-coding-session can
mark what the agent should change and stamp "Send to agent." The differentiator
is that the marks land on the *rendered* text like a print-shop redline proof —
the doc leads, the marks recede — and the payload closes the loop inside the
same pi session that produced or read the markdown.

The visual system follows from that product truth. Because the page exists to be
read and marked calmly, it is **quiet**: neutral and trustworthy, no urgency
theater. Color is semantic — the single saturated redline accent earns its
place only on a hand-placed mark or the proof stamp; the rest is near-white
drifting ground and ink that is never pure black. daisyUI's role palette provides
the semantic vocabulary (primary, neutral, base, warning, error); the active
theme (nord) supplies the concrete cool, editorial values. The page is
flat-by-default — hairline rings, no bevels, no theatrical shadows — because a
proof is a surface to be read, not a dashboard to be scanned. Typography is one
system sans family for the doc, with a mono for labels and metadata (the
end-label, note meta, proof stamp) — mono as print-shop material, not as
"technical" costume.

**Key Characteristics:**
- Calm, rendered, doc-leads — no urgency theater; the document is the focus.
- One earned accent: the redline mark and the proof stamp are the only saturated color.
- Ink is never pure black; the ground drifts near-white (warm + cool).
- Flat-by-default: hairline rings, no bevels, no theatrical shadows.
- Theme-bound: colors live as daisyUI CSS variables; the page never hard-codes theme hues.
- Self-contained: the compiled Tailwind + daisyUI bundle is inlined; no runtime npm deps.

## Colors

The palette is the daisyUI semantic role set, referenced by CSS variable so the
page stays live-bound to the active theme (nord). The Redline Proof owns exactly
one accent beyond the roles — the redline — and it earns every appearance.

### Primary
- **primary** (`var(--color-primary)`): daisyUI's primary role. Reserved for future
  semantic use; currently the page's earned accent is the Redline Proof's own
  `redline` token, not `primary`. Kept live-bound for consistency.

### Neutral
- **neutral** (`var(--color-neutral)`): the ink role for daisyUI UI chrome.
- **neutral-content** (`var(--color-neutral-content)`): text on a neutral fill.

### Base (surfaces and ink)
- **base-100** (`var(--color-base-100)`): the page background baseline.
- **base-200** (`var(--color-base-200)`): inset surfaces (code blocks, note inputs).
- **base-300** (`var(--color-base-300)`): borders and dividers.
- **base-content** (`var(--color-base-content)`): the primary ink for body text.

### The Redline Proof's own tokens
- **ink** (`oklch(22% 0.01 250)`): the softened black the page actually uses for
  all rendered text and headings. Never pure `#000`; the slight cool chroma makes
  the ink read as printed, not rendered.
- **paper** (`oklch(98% 0.003 90)`): the near-white ground.
- **paper-warm** (`oklch(97% 0.006 70)`) / **paper-cool** (`oklch(97% 0.004 220)`): the
  ground drifts warm at one corner and cool at the other via two radial gradients
  over `paper`, so the sheet is never neutral.
- **hairline** (`oklch(90% 0.005 250)`): the single border/rule color — gutters,
  note rows, code blocks, comment forms.
- **redline** (`oklch(52% 0.18 28)`): the one earned saturated accent. Used on
  the on-text redline highlight, the range bracket button, the proof stamp, and
  links. Its rarity is the point.

### State (semantic)
- **warning** (`var(--color-warning)`) / **error** (`var(--color-error)`): reserved
  for future state; currently no UI element uses them (annotations are ephemeral,
  no error surfaces).

### Named Rules

**The Earned-Redline Rule.** The `redline` accent appears only on a hand-placed
mark — the on-text highlight, the range bracket, the proof stamp — or on a link.
Never on decoration, never on quiet rows, never on the chrome. If everything is
red, nothing is.

**The Theme-Bound, Not Hard-Coded Rule.** daisyUI roles are referenced as
`var(--color-<role>)`, never by concrete theme values. The Redline Proof's own
tokens (`ink`, `paper`, `redline`) are the page's material identity and are
hard-coded in OKLCH by design — they are not theme roles and must not drift with
the theme. Do not freeze daisyUI's oklch into component CSS.

**The Never-Pure-Black Rule.** All rendered text uses `--color-ink`
(`oklch(22% …)`), never `#000`. Pure black on a near-white sheet reads as
rendered, not printed.

## Typography

**Body / Display Font:** the system sans stack (`var(--font-sans)`). One family
for the doc; hierarchy is size + weight + tracking, not a second face.
**Mono Font:** `var(--font-mono)` — used for the end-label strip, note meta, the
proof stamp, and code. Mono is print-shop material (labels, stamps), not a
"technical" costume.

**Character:** Quiet, system-native, editorial. No web fonts (the page is
self-contained). The reader notices hierarchy, not type.

### Hierarchy
- **Doc h1** (bold, `-0.02em`, `1.15` line-height): the file-name title at the
  top of the doc column.
- **Doc h2** (semibold, `-0.01em`): section headings inside the rendered doc.
- **Body** (regular, `var(--text-base)`, `1.7` line-height): the rendered
  markdown paragraphs and list items. Max measure ~70ch (`max-width: 70ch`).
- **Label** (mono, `0.6875rem`, semibold, `0.08em` tracking, uppercase): the
  end-label strip (file path + count) and the "ANNOTATIONS" panel heading.
- **Note meta** (mono, `0.625rem`, semibold, `0.06em` tracking, uppercase): the
  kind prefix on a note row (`NOTE`, `BLOCK #6`, `range: "…"`).

### Named Rules

**The One-Family Rule.** One sans stack for the doc; one mono for labels and
code. Do not introduce a second font family or a web font. Hierarchy is size +
weight + tracking, not typeface contrast.

**The Mono-Is-Material Rule.** Mono marks labels, metadata, and the proof stamp
— the print-shop furniture of a proof sheet — never body text. Do not set
paragraphs or headings in mono to look "technical."

## Layout

A two-column grid (`grid-template-columns: minmax(0,1fr) 22rem`) with a `2rem`
gap: the rendered doc (with its left gutter of block crosshairs) on the left, a
right margin rail holding the annotation panel. It collapses to a single column
below `860px`. The doc column is capped at `max-width: 70ch` for measure. A
monospaced end-label strip spans the top (file path + live annotation count),
separated from the body by a hairline. Vertical rhythm is carried by the
markdown's own block spacing plus `1.7` line-height, not by extra section
margins. The page is mobile-aware (`@media (max-width: 860px)`) but optimized
for the desktop glance, since a briefing-to-the-agent is composed at the desk.

## Elevation & Depth

Depth is **flat-by-default**. Every surface — note rows, comment forms, code
blocks — is a flat fill with a `1px` hairline (`--color-hairline`) and no shadow.
No bevels, no inner highlights, no gradient fills. The proof stamp carries a
single inset 1px ring (`box-shadow: 0 0 0 1px … inset`) to read as inked, not
raised. Depth conveys "this is a surface," never "this is elevated."

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest — a hairline ring, no
shadow, no bevel. No shadow grows on hover; depth is not a state signal. The
only "lift" is the proof stamp's `-1px` translateY on hover, and it is a press,
not a float.

## Shapes

Form language is restrained and consistent: a single small radius
(`--radius-proof: 2px`) across every control and surface — note rows, comment
forms, code blocks, the proof stamp, the range bracket. Corners are barely
rounded, reading as cut paper, not as pills. No clipping, no angled corners, no
circular silhouettes. The geometry is quietly modern — the eye reads content,
not shape.

## Components

For each, the character line first, then shape, color, and states.

### The end-label strip
- **Character:** the page's only banner — monospaced, like a printed box end-label.
- **Shape:** full width, hairline `border-bottom`, small padding.
- **Color:** `--color-ink` at 60% opacity; the live count chip is `--color-redline`
  with `tabular-nums`.

### Block markers (left gutter)
- **Character:** a hairline crosshair glyph in the left gutter, not a filled chip.
  Absence is drawn: the glyph is quiet (`--color-ink` at 30%) until hovered/active.
- **Shape:** absolute-positioned 14×14 authored SVG (1.2 stroke, `currentColor`),
  transparent background, no border.
- **Hover/Active:** color shifts to `--color-redline`.

### Range bracket
- **Character:** focus brackets tightening around a selection — `[Add comment]`.
- **Shape:** absolute-positioned, paper background, hairline border, `2px` radius.
- **Color:** `--color-redline` text, mono, semibold. `::before`/`::after` supply
  the brackets.

### The on-text redline
- **Character:** the one hand-placed mark on the rendered text — a highlight +
  underline, like a redline stroke on a proof.
- **Style:** `span.pi-annotate-redline` with a bottom gradient wash (30%→88%
  height) and a `2px` solid `--color-redline` bottom border. Best-effort anchored
  by the selected quote text; does not re-resolve across edits.

### Note rows (margin rail)
- **Character:** flat, hairline ring, no shadow. The annotation list.
- **Shape:** `2px` radius, `0.5rem 0.6rem` padding, `0.5rem` margin between.
- **Color:** `--color-paper` fill, `--color-hairline` border, `--color-ink` text.
- **Meta:** mono `0.625rem` uppercase (`NOTE`, `BLOCK #6`, `range: "…"`), ink at 50%.
- **Delete:** authored hairline SVG × (1.2 stroke), ink-dim → redline on hover.

### The note input + comment form
- **Character:** quiet, inline, no modal friction.
- **Style:** `--color-paper` tinted 4% ink, hairline border, `2px` radius. Focus
  shifts the border to 60% redline.
- **Save action:** the proof-stamp treatment (redline fill, ink-on-red text).
- **Cancel/ghost:** transparent, hairline outline, ink at 70%.

### The proof stamp (submit)
- **Character:** the single saturated, human-signed accent on the page. Its
  rarity is the point.
- **Shape:** full-width button, `2px` radius, `2px` redline border, inset 1px ring.
- **Color:** `--color-redline` fill, `oklch(98% 0.01 70)` text, mono uppercase.
- **Hover:** darkens 8% black, lifts `-1px`. **Active:** settles to 0. **Disabled:**
  50% opacity.

### The done state
- **Character:** a quiet confirmation, no celebration.
- **Style:** paper tinted 6% redline, hairline border, mono `0.85rem`.

## Do's and Don'ts

### Do:
- **Do** reference daisyUI roles as `var(--color-<role>)` so the page stays
  live-bound to the active theme.
- **Do** reserve `redline` for the on-text highlight, the range bracket, the
  proof stamp, and links — the one earned accent.
- **Do** use `--color-ink` (never pure black) for all rendered text and headings.
- **Do** keep every surface flat + hairline-defined: `2px` radius, `1px`
  hairline, no shadow, no bevel.
- **Do** keep the page self-contained: the compiled Tailwind + daisyUI bundle
  inlined into `htmlShell()`, no runtime npm deps, no `<script src>`.
- **Do** keep the doc column at `max-width: 70ch` so the rendered markdown
  reads at a human measure.

### Don't:
- **Don't** hard-code daisyUI theme oklch/hex values in component CSS. The roles
  are the system; freezing them drifts from the theme.
- **Don't** use `redline` for decoration or chrome. If a row, border, or label
  is colored, it must be an actual mark or a link.
- **Don't** add a second font family, a web font, or a display face. One sans
  for the doc, one mono for labels and code.
- **Don't** set body text or headings in mono to look "technical." Mono is for
  labels, metadata, and the proof stamp — the print-shop furniture.
- **Don't** lift surfaces on hover, add bevels, or use hard offset shadows.
  Depth is flat-by-default; the only hover motion is the proof stamp's press.
- **Don't** use Unicode/emoji glyphs as icons. Icons are authored SVG in one
  consistent 1.2 stroke (the block crosshair, the delete ×).
- **Don't** replace daisyUI's role palette with bespoke token names. The roles
  (primary, neutral, base-100, …) are the system; renaming them breaks live-binding.
