# Consume this design system in the `prototype` skill

`prototype` builds ONE self-contained `.html` (CDN-only, no build). Wire the brand in 5 steps.

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

## 5. Icons
`<i data-lucide="bell"></i>` + `lucide.createIcons()` after every render.

## Lint note (prototype's design-lint)
{{List any brand-intentional flags here, e.g. cream-palette / overused-font / bounce-easing, and why
they're deliberate. Delete if none apply.}}
