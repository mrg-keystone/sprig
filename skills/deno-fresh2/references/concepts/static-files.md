# Static Files

> Source: https://fresh.deno.dev/docs/concepts/static-files

## TL;DR
Files in `static/` are served at the root by `staticFiles()` middleware, streamed from disk with ETags. Files **imported in code** (CSS, icons used as JS imports) belong in a separate folder like `assets/` to avoid double-bundling.

## Two flavors
| Folder | Purpose |
|---|---|
| `static/` | Files referenced by URL only (favicon, robots.txt, fonts, PDFs). Served as-is. |
| `assets/` (or any non-`static/` folder) | Files imported in JS/TS — Vite processes/hashes them. |

> Don't put imported assets in `static/` — they'll be duplicated in the build.

## Asset helpers
- `asset(path)` — wraps a path with a one-year cache lifetime (good for downloadable PDFs, immutable assets).
- `assetSrcSet(set)` — same caching applied to `srcset` strings.

By default, Fresh adds caching headers automatically to `src` and `srcset` on `<img>` and `<source>` tags. Opt out per tag with `data-fresh-disable-lock`.

## Image optimization
Not built in. Options:
- Build-time: integrate `vite-imagetools`.
- Runtime: Cloudflare Images, imgix, Cloudinary, etc.

## Example
```tsx
import { asset } from "fresh/runtime";

<a href={asset("/whitepaper.pdf")}>Download</a>
<img src="/logo.png" />               {/* auto-cached */}
<img src="/dynamic.png" data-fresh-disable-lock />
```

## See also
- `quickstart.md` — default project layout
- `advanced/vite.md` — Vite plugin options
