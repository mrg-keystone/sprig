# daisyUI

> Source: https://fresh.deno.dev/docs/examples/daisyui

## TL;DR
Install daisyUI via npm and load it as a Tailwind plugin in your stylesheet. Then use
semantic classes (`btn`, `card`, etc.) in components.

**Fast path:** the `daisyui-blueprint` **MCP** (`daisyUI-Snippets` + `Figma-to-daisyUI`)
gives you accessible markup, the class vocabulary, screenshots, and CSS-only
(zero-island) interactive components — and the custom-theme bridge to keep it from
looking generic. Read **`../daisyui-mcp.md`** before building UI with daisyUI; this
page is just the install.

## Steps
```
deno i -D npm:daisyui@latest
```
In `assets/styles.css` (the global sheet imported from `client.ts`):
```css
@import "tailwindcss";
@plugin "daisyui";
```
daisyUI 5 / Tailwind 4 — the `@plugin` directive, **not** a `tailwind.config.js`
`plugins:` array (that's the v3 shape). Replace the bare `@plugin "daisyui"` with a
**custom `@plugin "daisyui/theme"`** so it isn't the default look (`../daisyui-mcp.md`).

## Use it
```tsx
<button class="btn btn-primary">Save</button>
<div class="card bg-base-100 shadow-xl">
  <div class="card-body">…</div>
</div>
```
Keep `class` (Preact takes it verbatim). Use **semantic** colors (`bg-base-100`,
`btn-primary`), never raw `gray-*`, so themes/dark mode work without `dark:`.

## See also
- `../daisyui-mcp.md` — the MCP catalog, CSS-only components, custom theming, Figma → daisyUI
- `../advanced/vite.md` — Tailwind via `@tailwindcss/vite`
- daisyUI docs: https://daisyui.com/
