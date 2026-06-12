# daisyUI

> Source: https://fresh.deno.dev/docs/examples/daisyui

## TL;DR
Install daisyUI via npm and load it as a Tailwind plugin in your stylesheet. Then use semantic classes (`btn`, `card`, etc.) in components.

## Steps
```
deno i -D npm:daisyui@latest
```
In `assets/styles.css`:
```css
@import "tailwindcss";
@plugin "daisyui";
```

## Use it
```tsx
<button class="btn btn-primary">Save</button>
<div class="card bg-base-100 shadow-xl">
  <div class="card-body">…</div>
</div>
```

## See also
- `advanced/vite.md` — Tailwind via `@tailwindcss/vite`
- daisyUI docs: https://daisyui.com/
