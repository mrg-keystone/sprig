## 4. Versioning / caching contract

**Invariant 5, full statement** (00-overview §6): far-future `immutable` caching is
sound ONLY because `?v=` is a pure function of the served bytes — any byte change
changes the URL, so a stale-`immutable` response is impossible. Three stages carry
this, each computing/consuming the same hash independently:

| stage | role | timing | function | owning spec |
|---|---|---|---|---|
| 1. Build-side | computes | build-once | `shortHash` computes the hash once, at build time, over the served `.js` + `app.css` set | [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8 |
| 2. SSR-side | computes + stamps | on-demand | `versionOf`/`assetsVersioner` (below) recompute the same hash on demand, supplying the CURRENT version; the renderer is what actually STAMPS `?v=<hash>` onto every stable-named asset URL it injects, using that supplied version | here (below) — stamping itself delegated to [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md) |
| 3. Serve-side | recomputes + compares | per-request | compares the request's `?v=` to the CURRENT hash and grants `immutable` only on a match | 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md) |

- `?v=` = content hash of served `.js` + `app.css` (16 hex chars via SHA-256 over
  length-framed name+content tuples), tuples fed to the hash in ASCENDING
  lexicographic order of served name (e.g. `client.js` before `isl.foo.js`) —
  build-side `shortHash` ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8) and SSR-side `assetsVersioner` (below) both sort the
  file set this way before hashing.

  **Why these three choices:**
  - **One digest over the WHOLE set, not per-file.** All served `.js` + `app.css`
    hash together into the single version stamped on EVERY asset URL — an `app.css`
    edit demoting `client.js`'s `?v=` (even though `client.js`'s own bytes didn't
    change) is the INTENDED effect, not a defect to chase down with per-file hashes:
    one hash means one cache generation, with no partial-invalidation bookkeeping to
    get wrong.
  - **Ascending lexicographic sort.** Build-side `shortHash` and SSR-side
    `assetsVersioner` walk `outDir` independently, and directory-enumeration order
    isn't guaranteed stable across filesystems or runs. Sorting the file set before
    hashing makes the two independent walks agree regardless of enumeration order.
  - **Length-framing name+content, not a raw concat.** Framing each tuple by
    `len(name)`/`len(content)` stops two different file sets from colliding at a
    tuple boundary (an unframed concat can't distinguish `("ab","cd")` from
    `("a","bcd")`).
- **Acceptance criterion:** the build-side hash and the SSR-side hash MUST agree,
  byte-for-byte, over any file set — this is what makes the two independent stages
  agree ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8 ⇄ SSR-side, above). Concretely: `shortHash(paths)` — build-side,
  taking the sorted served-file paths, returning the bare 16-hex digest, surfaced as
  the `hash` field of `buildClient`'s returned `{islands,chunks,out,bytes,hash}`
  `BuildResult` — MUST equal `versionOf(outDir)` / `assetsVersioner(outDir)()` — SSR-side,
  each also returning the bare 16-hex digest (or `null` when the dir is degraded,
  below).

  This is pinned by `versioning-hash-parity.test.ts`, asserting the build-side hash
  and `versionOf(outDir)` agree over representative file sets — mirrors how the
  asset-cache-addressing matrix is pinned (06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md)).
- `assetsVersioner` memoizes behind a stat probe (name:size:mtime) — in-place rebuilds
  picked up, stale hash never blesses changed bytes.
- Degraded (missing/empty dir) → `versionOf`/`assetsVersioner` return `null` — NEVER
  `"dev"`; `"dev"` is a stamped-URL placeholder the caller (mod.ts) mints into asset
  URLs when it gets `null`, not a value either versioner returns. Warn-once. This
  `null`-current is the actual mechanism behind "never `immutable` while degraded": with
  current version `null`, no request's `?v=` — including a literal `?v=dev` — can ever
  equal it, so nothing matches and `immutable` is structurally unreachable (a `"dev"`
  return would wrongly let a request carrying `?v=dev` match).
- Cache disposition by request kind (serve-side, 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md)) —
  ETag and 304-on-`if-none-match` ride EVERY row below, addressed or not; only
  `cache-control` depends on the addressing verdict:

  | request | content-addressed? | `cache-control` |
  |---|---|---|
  | `client.js?v=<current>` | yes — `?v=` equals current hash | `immutable` |
  | `app.css?v=<current>` | yes — `?v=` equals current hash | `immutable` |
  | `isl.<sel>.js?v=<current>` | yes — same hash, same query param (island chunk URLs carry `?v=<v>` too, [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md) naming conventions) | `immutable` |
  | `chunk-<HASH>.js` matching `HASHED_CHUNK = /^chunk-[A-Z0-9]{8}\.js$/` (any `?v=`, or none) | yes — serve-side; `serveAsset`'s `addressed = (cur !== null && q === cur) \|\| HASHED_CHUNK.test(name)` (mod.ts:273,317; owned by 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md)) grants `immutable` to any name-addressed chunk matching this TIGHT regex — exactly 8 uppercase-alnum chars + `.js` — regardless of the query string. This is deliberately tight so a hand-authored file merely starting with `chunk-` can't be wrongly pinned `immutable`. It is distinct from the BUILD-side chunk identification, `files.filter((f) => f.startsWith("chunk-"))` (build.ts:292) — prefix-only, used to populate the served artifact set / hash INPUT ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8 / [§2](02-2-the-artifact-set-static.md)), not the cache grant | `immutable` |
  | `chunk-*.js` NOT matching `HASHED_CHUNK` (e.g. a hand-authored `chunk-utils.js`) | no — fails the tight regex, so `serveAsset` never name-addresses it regardless of length/case; a stale or missing `?v=` falls through to the stable-named-asset rows below | `no-cache` |
  | any stable-named asset, `?v=<stale>` | no | `no-cache` |
  | any stable-named asset, `?v=dev` | no — current version is `null` while degraded (`?v=dev` is the placeholder mod.ts stamps into URLs in that state); no `?v=` value, including `dev`, can equal a `null` current | `no-cache` |
  | any stable-named asset, no `?v=` | no | `no-cache` |

### Worked example: `?v=` end-to-end

`outDir` holds `app.css`, `chunk-A1B2C3D4.js`, `client.js`, `isl.foo.js`. Sorted
ASCENDING lexicographic by served name: `app.css`, `chunk-A1B2C3D4.js`, `client.js`,
`isl.foo.js` — `app.css` leads (`a` < `c`); `chunk-A1B2C3D4.js` precedes `client.js`
(`h` < `l` at index 1 of `"chunk"`/`"client"`); `isl.foo.js` trails (`i` > `c`).

For the first tuple, `app.css` (say 14 007 bytes of minified CSS): the preimage is
`len("app.css")` framing bytes + the 7 name bytes + `len(content)` framing bytes + the
14 007 content bytes, concatenated — this is one tuple fed into the running SHA-256;
the other three (`chunk-A1B2C3D4.js`, `client.js`, `isl.foo.js`) follow the same shape,
in sort order, into the same hash.

Both `shortHash` (build-side) and `assetsVersioner` (SSR-side) walk this same four-file
set in this same order and land on the same 16-hex digest — say `7f3c9a1e4b6d0852`
(illustrative, not a real digest). SSR injects `client.js?v=7f3c9a1e4b6d0852` and
`app.css?v=7f3c9a1e4b6d0852` into the document tail/head ([§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)). A request for
`/_assets/client.js?v=7f3c9a1e4b6d0852` matches the CURRENT hash → `immutable`.

Redeploy: `app.css` changes (a style edit ships). The four-file set now hashes to a
different digest, say `0e19d7b4f2a83c56`. `assetsVersioner`'s next recompute (past its
stat-probe memo) picks this up immediately, and the OLD URL,
`/_assets/client.js?v=7f3c9a1e4b6d0852`, no longer equals the CURRENT hash — it is
instantly demoted from `immutable` to `no-cache` + ETag, even though `client.js` itself
didn't change (it's in the same hashed set as `app.css`, so any set member's byte
change moves every URL's `?v=` together). No stale-`immutable` response is possible.
