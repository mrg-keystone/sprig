# {{Brand}} Design System

> **Note on naming:** the daisyUI theme is named `brand`/`brand-dark` (generic) so the artifact stays a
> reusable template; the brand identity lives in the token *values* and in this doc.

{{One-paragraph brand positioning: who it's for, the feeling.}}

Built to be **consumed by the `prototype` skill** with zero translation. Single
source of truth: **`theme.css`** (Tailwind 4 + daisyUI 5).

## Index

| File / Folder | Purpose | Role |
| --- | --- | --- |
| `theme.css` | daisyUI 5 brand theme (light + dark) + fonts/type/motion/shades | **Canonical** |
| `theme.cdn.css` | Flattened `[data-theme]` twin for `prototype` (no build) | Derived |
| `design-tokens.md` | Human token tables (token handoff reference) | Derived |
| `components.md` | daisyUI semantic-class recipes (MCP-verified) | Reference |
| `charts.md` | Theme-native ApexCharts | Reference |
| `BUILD.md` | How this artifact was built | Process |
| `consume/prototype.md` | Apply the brand in a prototype | Reference |
| `manifest.json` · `adherence.oxlintrc.json` | Token + card index; lint allow-list | Derived |
| `preview/` | Specimens that `<link>` the canonical theme; `showcase.html` is the demo | Derived |
| `assets/` | Logos, illustrations (placeholders unless supplied) | Asset |

> **Canonical vs derived:** edit `theme.css` only; regenerate everything marked *Derived* from it.

### Quick links
- **See it:** `preview/showcase.html`
- **Apply in a prototype:** `consume/prototype.md`

## Brand voice
{{Pronoun/register, casing, pace, emoji policy, number/date locale — a few bullets.}}

## Visual foundations (the 4 pillars)
1. **Typography** — {{Display}} (display) + {{Body}} (body); {{heading tracking}}.
2. **Motion** — {{easing + durations}}; nothing over 400ms.
3. **Depth & atmosphere** — daisyUI `--depth` + {{shadow signature}}; {{glass? no}}.
4. **Signature moment** — {{the brand wink: a celebratory state, a motif}}.

### Palette at a glance
{{anchor colors with hex + role; note which is the precious primary}}.

## Caveats
- Brand name/logo/illustrations are placeholders unless supplied.
- Fonts via {{Google Fonts / self-hosted}}.
- Icons: {{Lucide, stroke}} — flag if a different set is preferred.
