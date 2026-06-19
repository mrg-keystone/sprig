# Layouts

> Source: https://fresh.deno.dev/docs/concepts/layouts

## TL;DR
A `_layout.tsx` file in any `routes/` directory wraps every page in that directory and its subdirectories. Layouts nest automatically by folder hierarchy. Render the child via `<Component />`.

## Signature
```tsx
export default function Layout({ Component, state, url }) {
  return (
    <div class="page">
      <nav>...</nav>
      <Component />
    </div>
  );
}
```
Async layouts get `ctx.Component` instead.

## Render order (outside-in)
For a request to `/blog/my-post`:
1. `routes/_app.tsx` (HTML shell)
2. `routes/_layout.tsx`
3. `routes/blog/_layout.tsx`
4. The page component

## Opting out of inherited layouts
```ts
export const config = { skipInheritedLayouts: true };
```
Useful for full-bleed pages (login, dashboards with custom chrome).

## App wrapper vs layout
- `_app.tsx`: outermost `<html>`/`<head>`/`<body>` shell. **One per app.**
- `_layout.tsx`: reusable UI shell between app wrapper and page. Many can nest.

## See also
- `advanced/layouts.md` — opting out, dynamic skipping, advanced patterns
- `advanced/app-wrapper.md`
- `concepts/file-routing.md` — route groups for sharing layouts without affecting URLs
