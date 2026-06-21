# App Wrapper (`_app.tsx`)

> Source: https://fresh.deno.dev/docs/advanced/app-wrapper

## TL;DR
`routes/_app.tsx` is the outermost component. It owns `<html>`, `<head>`, `<body>` and renders `<Component />` for the page tree. One per app. Server-only.

## Signature
```tsx
import { define } from "../utils.ts";

export default define.page(({ Component, url, state }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>My App</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <Component />
    </body>
  </html>
));
```

## Programmatic alternative
```ts
app.appWrapper(MyAppWrapper);
```

## Props
Same shape as page components: `Component`, `url`, `state`, `params`, plus request data.

## What goes here
- Global meta/viewport/charset
- Stylesheets that apply to every page
- Site-wide analytics scripts
- Top-level providers if needed (rare in Fresh — most state lives in islands)

## See also
- `concepts/layouts.md` and `advanced/layouts.md` for layouts (between wrapper and page)
- `advanced/head.md` for per-page `<head>` additions via `<Head>`
