# Hearth Design System

> **Note on naming:** the daisyUI theme is named `brand`/`brand-dark` (generic) so the artifact stays a
> reusable template; the brand identity lives in the token *values* and in this doc.

**Hearth** is a community guestbook — a little warm corner of the internet where visitors leave a
message on the wall. The system feels inviting, cozy, and a touch hand-made: cream paper, espresso ink,
a terracotta welcome, and headings in a friendly handwriting.

Built to be **consumed by the `prototype` skill** with zero translation. Single
source of truth: **`theme.css`** (Tailwind 4 + daisyUI 5).

## Index

| File / Folder | Purpose | Role |
| --- | --- | --- |
| `theme.css` | daisyUI 5 brand theme (light + dark) + fonts/type/motion/shades | **Canonical** |
| `theme.cdn.css` | Flattened `[data-theme]` twin for `prototype` (no build) | Derived |
| `css-variables.json` | Plain token map a sprig app consumes (→ its `src/css-variables.json`) | Derived |
| `manifest.json` · `adherence.oxlintrc.json` | Token + card index; lint allow-list | Derived |
| `components.md` | daisyUI semantic-class recipes (MCP-verified) | Reference |
| `charts.md` | Theme-native ApexCharts | Reference |
| `consume/prototype.md` | Apply the brand in a prototype | Reference |
| `preview/showcase.html` | Full themed dashboard specimen; `<link>`s the canonical theme | Derived |
| `SKILL.md` | Makes the artifact itself an invokable skill | Doc |

> **Canonical vs derived:** edit `theme.css` only; regenerate everything marked *Derived* from it.

### Quick links
- **See it:** `preview/showcase.html`
- **Apply in a prototype:** `consume/prototype.md`

## Brand voice
- **Register:** warm, first-person, conversational — like a host welcoming you in. Never corporate.
- **Casing:** sentence case in UI; the wordmark and short warm phrases may use the handwriting display.
- **Pace:** short, kind sentences. Invite, don't instruct ("Leave a warm note…", not "Submit input").
- **Emoji:** sparing — a single celebratory beat (a posted message) is plenty.
- **Dates / numbers:** relative and human ("2 hours ago", "12 others signed today").

## Visual foundations (the 4 pillars)
1. **Typography** — Caveat (display, a handwriting script, set at weight 700) + Quicksand (body, a clean
   geometric rounded sans). Major-third (1.25) modular scale; display tracking `-0.015em`. Caveat is
   headings/wordmark only — it is not a body face.
2. **Motion** — `--ease-bounce` `cubic-bezier(0.34, 1.56, 0.64, 1)` (a warm overshoot) + `--ease-standard`
   `cubic-bezier(0.20, 0, 0, 1)`; durations 120 / 200 / 320ms. Nothing over 400ms.
3. **Depth & atmosphere** — daisyUI `--depth: 1` (a soft, cozy shadow) + `--noise: 1` (subtle grain), with
   a generous `--radius-box: 1.25rem` so cards read like notes pinned to a wall. No glass.
4. **Signature moment** — a new guestbook entry **rises gently into place** (`.animate-rise`, bounce
   easing) and a warm "Message posted!" celebration confirms the welcome.

### Palette at a glance
- `base-100` **#FBF7F0** warm cream — the page/paper surface.
- `base-content` **#3B2A1E** espresso brown — body + heading ink.
- `primary` **#C2410C** terracotta — **the one precious CTA color** (ration it to the single hero action).
- `secondary` **#5E6B47** sage · `accent` **#DA9A3E** honey gold · `neutral` **#43342A** warm brown.
- Dark theme (`brand-dark`) lifts these onto a warm near-black espresso base (`#1E1712`).

## Caveats
- Brand name/logo/illustrations are placeholders unless supplied.
- Fonts via Google Fonts (Caveat + Quicksand).
- Icons: Lucide (stroke) — flag if a different set is preferred.
- Deliberate design-lint exceptions (cream palette, grain, warm-family clustering, handwriting headings)
  are documented in `consume/prototype.md`.
