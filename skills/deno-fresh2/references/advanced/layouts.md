# Layouts (Advanced)

> Source: https://fresh.deno.dev/docs/advanced/layouts

## TL;DR
Two opt-out flags on a layout config: `skipInheritedLayouts` (replace all ancestor layouts with this one) and `skipAppWrapper` (also skip `_app.tsx`).

## skipInheritedLayouts
Replace ancestor layouts entirely:
```ts
const app = new App()
  .layout("*", MainLayout)
  .layout("/landing", LandingLayout, { skipInheritedLayouts: true });
```
The `/landing` route uses only `LandingLayout`.

In a `_layout.tsx` file form:
```ts
export const config = { skipInheritedLayouts: true };
```

## skipAppWrapper
Bypass `_app.tsx` for a given path:
```ts
app.layout("/foo/bar", MyComponent, { skipAppWrapper: true });
```
Useful for embeddable widgets, OG image rendering routes, or anything that shouldn't share the global HTML shell.

## When to use these
- Marketing/landing pages with very different chrome
- Login/auth flows
- Widget/iframe targets
- Admin dashboards that need a totally different shell

## See also
- `concepts/layouts.md` — basics
- `advanced/app-wrapper.md`
