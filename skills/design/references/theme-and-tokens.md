# Authoring `theme.css` (the canonical file)

`theme.css` is the whole system. It has three parts: the daisyUI theme blocks (color/radius/texture),
the non-color layer daisyUI doesn't cover (fonts/type/motion), and derived shade tokens.

## 1. Pull the template from the MCP — don't hand-write it

Call `daisyUI-Snippets` with `{ "themes": { "custom-theme": true, "colors": true } }`. You get:
- the **canonical custom-theme template** with the exact required variable set for the installed
  daisyUI version, and
- the **semantic color reference** (what `primary` / `base-100` / `*-content` mean).

The required variable set (verify against what the MCP returns — this is illustrative):
`--color-base-100/200/300`, `--color-base-content`, and `--color-{primary,secondary,accent,neutral,
info,success,warning,error}` each with a `-content` pair; `--radius-selector/field/box`;
`--size-selector/field`; `--border`; `--depth` (0|1); `--noise` (0|1); plus `name`, `default`,
`prefersdark`, `color-scheme`.

**Mapping brand → semantic roles** (the judgment call):
- `base-100` = page surface, `base-200/300` = elevations, `base-content` = body/heading ink.
- `primary` = the one precious CTA color (use it sparingly).
- `secondary` / `accent` = supporting + affirmative/decorative. `neutral` = warm structural color.
- `info/success/warning/error` = status. Each `*-content` must contrast its base for legibility.
- **Hex is allowed**; OKLCH is the daisyUI house style but not required. Use whatever keeps brand
  fidelity exact.

Author two blocks: `name: "brand"; default: true; color-scheme: light` and
`name: "brand-dark"; prefersdark: true; color-scheme: dark` with a darkened/adjusted palette.

## 2. The non-color layer (daisyUI covers none of this)

**Pick the fonts with a typography selector, not from memory** — see
[`typography.md`](typography.md) (google-fonts MCP / font-mcp, or hand-selection rules). It returns a
vibe-matched, contrast-classified display+body pairing + a modular scale that drop straight into the
`:root` block below. Then, in the same file, after the theme blocks:

```css
@import url('https://fonts.googleapis.com/css2?family=<Display>:wght@...&family=<Body>:wght@...&display=swap');
:root {
  --font-display: '<Display>', system-ui, sans-serif;   /* distinctive — NOT Inter/Roboto/system */
  --font-body:    '<Body>', system-ui, sans-serif;
  --step--2: .75rem; --step--1: .875rem; --step-0: 1rem; --step-1: 1.25rem;
  --step-2: 1.5rem; --step-3: 2rem; --step-4: 2.5rem; --step-5: 3.5rem;   /* modular scale */
  --ease-bounce: cubic-bezier(.34,1.56,.64,1); --ease-standard: cubic-bezier(.2,0,0,1);
  --dur-micro: 120ms; --dur-fast: 200ms; --dur-base: 320ms;
  /* derived shade tokens for charts / tints — build-free, no JS */
  --color-base-content-30: color-mix(in oklch, var(--color-base-content) 30%, transparent);
  --color-base-content-50: color-mix(in oklch, var(--color-base-content) 50%, transparent);
}
body { font-family: var(--font-body); }
h1,h2,h3,h4,.font-display { font-family: var(--font-display); }
@media (prefers-reduced-motion: reduce) {
  *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; }
}
```

Why this layer matters: both consumer skills *require* a distinctive type voice, a motion layer, and
shade tints, and daisyUI gives none of them. A brand theme block alone is not a complete system.

## 3. Shades via `color-mix`, not runtime JS

Charts and subtle fills need tints (e.g. a 30%-opacity ink). The `daisyui-charts` package injects these
as CSS vars at runtime with JS (`injectColorShades`); do it build-free with `color-mix()` defined once
in `theme.css` (above), or use daisyUI opacity utilities inline (`text-base-content/30`, `bg-primary/10`).

## 4. Flatten to `theme.cdn.css`

The prototype skill can't run a compiler, so produce a flattened twin: replace each
`@plugin "daisyui/theme" { name: "brand"; … }` with `[data-theme="brand"] { … }` (same variables),
keep the `:root` layer verbatim, and drop the `@import "tailwindcss"; @plugin "daisyui";` lines. Values
must match `theme.css` exactly.

## Lint awareness
A brand may legitimately use a pale surface (`cream-palette`), Inter (`overused-font`), or an overshoot
ease (`bounce-easing`) — all flagged by `prototype`'s design-lint. That's fine; just record the
intentional ones in `consume/prototype.md` so they read as choices, not slop.

A complete worked example of every value is in [`../assets/templates/theme.css`](../assets/templates/theme.css).
