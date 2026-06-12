# Active Links

> Source: https://fresh.deno.dev/docs/examples/active-links

## TL;DR
Fresh auto-applies `aria-current` on `<a>` whose `href` matches the current URL. Style via attribute selectors — no JS needed.

## Behavior
- Exact match (incl. query string) → `aria-current="page"`
- Ancestor match (e.g. `/docs` while on `/docs/intro`) → `aria-current="true"`
- If you manually set `aria-current`, Fresh leaves it alone (component-library friendly).

## Style with CSS
```css
a[aria-current="page"] { color: green; font-weight: 600; }
a[aria-current="true"] { color: green; }
```

## Style with Tailwind
```tsx
<a href="/foo" class="aria-[current]:text-green-600">Foo</a>
```

## See also
- `concepts/context.md` — `ctx.url` for manual matching if needed
