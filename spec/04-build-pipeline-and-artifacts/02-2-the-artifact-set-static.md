## 2. The artifact set (`static/`)

*Canonical catalog of `static/` — emission mechanics → [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md), HTML injection → [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md), `?v=`/caching → [§4](04-4-versioning-caching-contract.md), serving/hardening → [06 §5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md).*

### Example: a small app (two islands + a font)

```
static/
  client.js              <base>/_assets/client.js?v=7f3a9c21e08b44d1
  isl.counter.js          <base>/_assets/isl.counter.js?v=7f3a9c21e08b44d1
  isl.chart.js             <base>/_assets/isl.chart.js?v=7f3a9c21e08b44d1
  chunk-A1B2C3D4.js         <base>/_assets/chunk-A1B2C3D4.js            # content-addressed, no ?v= needed
  app.css                    <base>/_assets/app.css?v=7f3a9c21e08b44d1
  templates.json              (not fetched — SSR reads it off disk)
  build-info.json              (not fetched — keep's injectHeadMeta reads it)
  fonts/
    inter.woff2                 <base>/_assets/fonts/inter.woff2
```
One hash (`7f3a9c21e08b44d1`) stamps every `?v=` URL above (`client.js`, both `isl.*.js`, `app.css`) — `chunk-<HASH>.js` carries no `?v=`, being content-addressed by filename instead, even though it still feeds the hash's INPUT set (full accounting: [§4](04-4-versioning-caching-contract.md)).

### Catalog

Two axes cut across every row below: whether the file **lands in `static/`** (the
served output directory) and whether it's **git-tracked / committed** by an app that
checks in its build output. The closed set (Closure, below) is every row with
`lands in static/? = yes`; the committed set is every row with `committed? = yes`.

| path (contents) | served address | produced by `buildClient`? | consumed by | versioned? | lands in `static/`? | git-tracked / committed? |
|---|---|---|---|---|---|---|
| `client.js` — eager loader (config, island selector registry, baked static templates, bootstrap + soft-nav); imports the shared chunk | `<base>/_assets/client.js?v=…` — modulepreload in the head, module `<script>` in the document tail ([§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md).1, .4) | yes — §1.2 (entry gen) → §1.3 (bundle emit) | browser | `?v=` hash ([§4](04-4-versioning-caching-contract.md)) | yes | yes |
| `isl.<sel>.js` — one chunk per island: shared-chunk import + logic + `registerIsland(sel, {setup, template, scope})` | `<base>/_assets/isl.<sel>.js?v=…` — dynamic-imported on the island's trigger | yes — §1.2 → §1.3 | browser | `?v=` hash | yes | yes |
| `chunk-<HASH>.js` — the shared runtime (core + signals + interpreter + hydrate), dedup'd once | `<base>/_assets/chunk-<HASH>.js` — imported by client.js and every isl.*.js | yes — §1.3 (deno bundle's code-splitting) | browser | content-addressed filename, detected by the `chunk-` prefix (`startsWith("chunk-")` on any `.js`; e.g. `chunk-A1B2C3D4.js` — the 8-char hash shape is esbuild's, not pinned by this repo) — immutable regardless of `?v=` | yes | yes |
| `app.css` — Tailwind v4 layers + daisyUI (`themes:false`) + globalReset + per-component scoped rules (`[s<hash>]` on key compounds) | `<base>/_assets/app.css?v=…` | yes — §1.5 (`buildCss`) | browser | `?v=` hash | yes | yes |
| `templates.json` — serialized ASTs keyed by relDir + `"shell"` | `<base>/_assets/templates.json` — servable like any `static/` file, but never fetched: SSR reads it straight off disk | yes — §1.6 | SSR-only | neither (outside §4's `.js`+`app.css` hash set) | yes | yes |
| `build-info.json` — `{repo, commit, branch, buildTime}` | `<base>/_assets/build-info.json` — read server-side, not fetched by the browser as a file | no — the deploy/stamp step, from `.infra/git.json` ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)'s closing note) | SSR-only (keep's `injectHeadMeta` → `<meta name="git-*">` tags) | neither | yes | yes |
| `import-map.json` — the forced map fed to `deno bundle --import-map` | never served — written to `outDir/.gen/import-map.json` (build.ts:75, :232-233), a build-time temp path outside served `static/` | yes — §1.3, removed right after the bundle (build.ts:242) | build-time-only — that one bundler invocation, never read again | n/a | no — deleted before the build finishes; never reaches `static/` | no |
| assets copied verbatim from `ui/assets/` (e.g. `fonts/x.woff2`) | `<base>/_assets/<path relative to assets/>` (e.g. `<base>/_assets/fonts/x.woff2`) | yes — §1.7 (asset copy) | browser (whatever app markup/CSS references it) | neither | yes | yes, when the app has a `ui/assets/` dir (n/a otherwise) |
| `vendor/apexcharts.js` † — vendored chart lib, text-loaded from package source | `<base>/_assets/vendor/apexcharts.js` | no — not build-emitted; served straight from keep's VENDOR map ([06 §6](../06-keep-serving-composition/06-6-vendored-browser-libs.md)) | browser (`<script defer>` in the head, [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md).1) | neither — its own fixed `cache-control: public, max-age=86400` (06 §6), outside the `?v=` hash set | no | no |

† never written to `static/` — listed here only because it's served at the same `<base>/_assets/` prefix; see Closure below.

### Closure

**Conformance rule:** a build's `static/` conforms iff its contents match, file for file,
the catalog rows with `lands in static/? = yes` — `client.js`, one `isl.<sel>.js` per island,
one-or-more `chunk-<HASH>.js` ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).3), `app.css` (§1.5), `templates.json` (§1.6), and whatever `ui/assets/`
contains copied verbatim (§1.7), plus `build-info.json` from the separate deploy/stamp step
(not `buildClient`). Any file under `static/` matching none of these is a build defect.
`import-map.json` is NOT in the closed set — it lands in `outDir/.gen/`, not `static/`
(above) — and `<base>/_assets/vendor/*` is outside the closure entirely too (served from
keep's VENDOR map, never touches `static/`).

The isolate workbench's `static/` has no `ui/assets/` dir, so per this closure rule it
commits exactly eight files (`client.js`, its three `isl.*.js`, one `chunk-*.js`, `app.css`,
`templates.json`, `build-info.json`) — its full closed set, since it has no `ui/assets/` to
copy. `import-map.json` is excluded from that set on this document's own authority: it's
written to `outDir/.gen/import-map.json` (build.ts:75, :232-233) and deleted right after the
bundle (build.ts:242), so it never persists past `buildClient` and never lands in `static/` —
it's not a file that landed in `outDir` and got excluded from the commit, it was never a
candidate for commit at all. *(Cross-doc note: [08 §5](../08-install-skills-annotate/05-5-this-repo-hosts-its-own-composed-app.md)'s
table currently lists `app/static/import-map.json` as landing in `static/`; that row is stale
against the fact above and needs its own correction — out of scope here.)*
An app that does have a `ui/assets/` dir commits those copied files too.

