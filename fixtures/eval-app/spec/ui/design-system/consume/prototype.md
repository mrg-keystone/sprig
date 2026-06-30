# Consume this design system in the `prototype` skill

`prototype` builds ONE self-contained `.html` (CDN-only, no build). Wire the Hearth brand in 5 steps.

## 1. Head — CDN stack (BOTH tags required)
```html
<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
```
> The daisyUI link gives component + color classes; `@tailwindcss/browser@4` gives layout utilities
> (`flex`, `grid`, `w-60`, `gap-6`, `md:flex`). **Omit the Tailwind script and the layout collapses** —
> components theme but sidebars stack and grids linearize. Both are required.

## 2. Paste the brand theme inline
Copy the entire contents of `theme.cdn.css` into a `<style>` in `<head>`. It defines
`[data-theme="brand"]` / `[data-theme="brand-dark"]` + the font/type/motion/shade vars. daisyUI v5
reads the `--color-*` variables at runtime — no compiler needed for the theme itself.

## 3. Set the theme
```html
<html data-theme="brand">     <!-- or data-theme="brand-dark" -->
```

## 4. Build with semantic daisyUI classes
`btn-primary`, `bg-base-100`, `text-base-content`, `card`, `badge-success`, `alert-error`, etc. See
`components.md` and `charts.md`. Never raw `gray-*` or hex — semantic classes retheme.

> **Ration the terracotta.** `primary` (terracotta) is the one precious CTA color — one hero action
> per view ("Leave a message" / "Sign the guestbook"). Everything else leans on `base-*`, `secondary`
> (sage), `accent` (honey), `neutral` (warm brown), or `soft`/`ghost`/`outline` styles.

## 5. Icons
`<i data-lucide="bell"></i>` + `lucide.createIcons()` after every render.

## Lint note (prototype's design-lint)
These four flags are **deliberate Hearth brand choices**, not accidents — `design-lint` will surface
them, but they are sanctioned. Do not "fix" them.

- **`cream-palette`** — `base-100` is `#FBF7F0`, an intentionally pale, warm cream (the cozy
  paper/guestbook surface). It is meant to read warm, not as an accidental off-white. Deliberate.
- **`noise-texture`** — `--noise: 1` adds a subtle grain on purpose, leaning into the hand-made,
  pinned-to-the-wall feel. Deliberate.
- **`warm-family clustering`** — `primary` (terracotta), `accent` (honey gold), and `warning` (amber)
  intentionally cluster in the warm color family. The earthy "hearth" palette is the brand identity,
  so the hues sit close together by design. Deliberate.
- **`overused-font` / handwriting display** — Caveat is a handwriting script used for **headings and
  the wordmark only** (`h1–h4` / `.font-display`, set at weight 700). Body and all UI text use
  Quicksand. Caveat appearing across every heading is intended, not font overuse. Deliberate.
