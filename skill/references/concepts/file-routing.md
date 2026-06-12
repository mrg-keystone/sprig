# File Routing

> Source: https://fresh.deno.dev/docs/concepts/file-routing

## TL;DR
Filename in `routes/` ⇒ URL pattern. Square brackets are dynamic params. Underscored files are special (`_app`, `_layout`, `_error`, `_middleware`). Parenthesized folders don't appear in URLs (route groups).

## Path mapping table
| File | URL pattern | Matches |
|---|---|---|
| `index.tsx` | `/` | `/` |
| `about.tsx` | `/about` | `/about` |
| `blog/index.tsx` | `/blog` | `/blog` |
| `blog/[slug].tsx` | `/blog/:slug` | `/blog/foo`, `/blog/bar` |
| `blog/[slug]/comments.tsx` | `/blog/:slug/comments` | `/blog/foo/comments` |
| `old/[...path].tsx` | `/old/:path*` | `/old/foo`, `/old/a/b/c` |
| `docs/[[version]]/index.tsx` | `/docs{/:version}?` | `/docs`, `/docs/latest` |
| `[[name]].tsx` | `/{:name}?` | `/`, `/foo` |

## Dynamic syntax
- `[id]` — required dynamic segment.
- `[...path]` — catch-all (zero+ segments).
- `[[opt]]` — optional segment.

## Special filenames
| File | Role |
|---|---|
| `_app.tsx` | Outer HTML shell (one per app) |
| `_layout.tsx` | Layout wrapper for this dir + descendants |
| `_error.tsx` | Error / 404 / 500 page (Fresh 2 unified) |
| `_middleware.ts` | Middleware scoped to this dir + descendants |
| `index.tsx` | Index page for the directory |

## Special directories
- `(group)/` — **route group**: parens hide the folder from URL but still scope `_layout.tsx` / `_middleware.ts` to children. Use to share layouts without affecting URLs.
- `(_islands)/` — co-located islands. Files inside are treated as islands.
- `(_components)/` — convention for non-island components co-located with routes.

## Example tree
```
routes/
  _app.tsx
  _error.tsx
  _layout.tsx                ← root layout
  index.tsx                  ← /
  blog/
    index.tsx                ← /blog
    [slug].tsx               ← /blog/:slug
    _layout.tsx              ← layout just for /blog/*
  (marketing)/
    _layout.tsx              ← layout, doesn't affect URL
    pricing.tsx              ← /pricing
    about.tsx                ← /about
  api/
    [...path].ts             ← /api/*
```

## See also
- `concepts/routing.md` — programmatic counterpart + priority rules
- `concepts/layouts.md`
- `advanced/error-handling.md`
