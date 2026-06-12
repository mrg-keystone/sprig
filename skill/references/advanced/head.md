# `<Head>` Element

> Source: https://fresh.deno.dev/docs/advanced/head

## TL;DR
`<Head>` from `fresh/runtime` lets any component contribute `<title>`, meta, link, script tags. Works in routes and islands; in islands, head updates as state changes. Last-rendered with the same key wins (so child routes can override `_app.tsx` defaults).

## Import + use
```tsx
import { Head } from "fresh/runtime";

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About me</title>
        <meta name="description" content="A page about me" />
      </Head>
      <h1>About</h1>
    </>
  );
}
```

## Deduplication priority (top wins)
1. `<title>` — sets `document.title` directly
2. matching `key` prop
3. matching `id` attribute
4. `<meta name="…">` matching `name`
5. `<link rel="…">` matching `rel`
6. otherwise appended

When two `<Head>`s render the same element, the **last rendered** wins — so `_app.tsx` sets the default and a page can override.

## Dynamic from islands
```tsx
const title = useSignal("Untitled");
// ...
<Head><title>{title}</title></Head>
```
Updating `title.value` updates `document.title`.

## See also
- `advanced/app-wrapper.md` — for site-wide head defaults
- `concepts/static-files.md` — referencing static asset URLs from head
