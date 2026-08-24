## 5. Asset serving (`serveAsset`) — hardening contract

sprig's serving pipeline serves `/_assets/*` via `serveAsset` (as built in
`packages/keep/mod.ts`; runs today inside `serveSprig`/`sprigUi`'s dispatch, and
would continue inside the target `Frontend` once landed — [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)):

Every rejected input, in the order `serveAsset` checks it:

| attack vector | defense mechanism | result | pinned by |
|---|---|---|---|
| non-GET/HEAD request | method allowlist, checked first | 405 + `allow: GET, HEAD` | — |
| malformed percent-escape in the file segment (e.g. a lone `%`) | percent-decode BEFORE disk lookup; a decode failure is caught | 400 | `asset-percent-decode.test.ts` |
| `..` segment after decoding, incl. the `..%5c` backslash variant (decodes to `..\`) | reject any real `..` path segment, split on BOTH `/` and `\` | 403 | `asset-traversal.test.ts` |
| extension read across a `/` (a directory segment spoofing a later extension) | extension derived from the BASENAME only, never across a `/` | resolves via basename-only lookup — the leaf name alone decides content-type | — |

Order matters, and neither ordering choice is arbitrary: decode runs BEFORE the traversal
check because an encoded separator (`%5c`, which decodes to `\`) would otherwise smuggle a
`..` segment past a check that only ever saw the still-encoded string — decoding first is
what makes `..%5c` catchable at all. The check then splits on BOTH `/` and `\` because that
decoded `\` byte is a real path separator on the serving target, not a Windows curiosity to
skip — a builder tempted to "optimize" by checking before decoding, or by splitting on `/`
alone, would reopen this exact hole.

**Content-type** — a fixed lookup table keyed on the basename's extension (case-insensitive;
the basename-only rule from the defense table above is what feeds it — [§6](06-6-vendored-browser-libs.md)
points here as the canonical mapping for its own `.js` vendor entries):

| extension | content-type |
|---|---|
| `.js` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.map` | `application/json; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.json` | `application/json; charset=utf-8` |
| any other (or none) | `application/octet-stream` |

**Cache addressing** — WHICH requests are content-addressed is [§4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md)'s
call (invariant 5's home); `serveAsset` APPLIES the verdict, and only the verdict, to the
response below. `serveAsset` itself is the enforcement point for TWO independent ways a
request earns that verdict: `?v=` equals `dir`'s current content hash, OR — regardless of
`?v=`, and true even with no `?v=` at all — the requested file's basename matches
`HASHED_CHUNK = /^chunk-[A-Z0-9]{8}\.js$/`: EXACTLY 8 uppercase-alphanumeric characters: a
lowercase or wrong-length name does NOT match and does NOT earn `immutable` this way. This
covers esbuild's content-hashed chunk output, fetched via bare relative imports that don't
inherit the importer's `?v=` — the filename itself is the address, since new bytes always
produce a new chunk name. The match is on the BASENAME alone (the same basename-only rule
the defense table above already establishes for extension lookup), and it holds even in a
degraded/null-version `dir`: a `chunk-XXXXXXXX.js` present on disk still matches by name and
still earns `immutable`, independent of whether `?v=`-based addressing has anything to
compare against.

**Response disposition** — keyed on the resolved condition, checked in this order:

| condition | status | cache-control | etag | last-modified | body |
|---|---|---|---|---|---|
| found, content-addressed | 200 | `public, max-age=31536000, immutable` | present (`W/"<size>-<mtime>"`, hex) | present | bytes on GET; none on HEAD |
| found, non-addressed | 200 | `no-cache` | present (`W/"<size>-<mtime>"`, hex) | present | bytes on GET; none on HEAD |
| found, revalidation hit | 304, no body | same as the addressing verdict above | present, repeated | present, repeated | none (GET or HEAD) |
| missing path, or a disk-read failure | 404 | none | none | none | error text |

A found response's headers are identical on GET and HEAD — the method only decides
whether bytes ride the body. `Last-Modified` rides every found-file response alongside
the ETag, on both `cache-control` branches. A revalidation hit fires on either of two
checks, but they are NOT symmetric: `if-none-match` has strict precedence. If the request carries
`if-none-match`, that header alone decides the outcome — it matching the current ETag is
a hit, and it NOT matching is a miss (full 200), even if the request also carries an
`if-modified-since` whose date would otherwise have matched. `if-modified-since` is
consulted ONLY when `if-none-match` is absent from the request, and then a hit requires
its date to be at or after the file's `Last-Modified` time (floored to the second). Only
`cache-control` depends on the addressing verdict; the ETag/`Last-Modified`/304 mechanics
are identical on both branches. A well-formed request (valid method, clean decode, no
`..`) for a file absent from `dir` — a genuinely missing path, not just a degraded/empty
dir — falls to the same catch-all as a disk-read failure: `serveAsset` never reaches the
`stat` that would produce a size/mtime to build an ETag or `Last-Modified` from, so the
404 carries no cache-control, ETag, or `Last-Modified` header — there is nothing to
validate against.

**Test matrix** — pinned by `asset-cache-addressing.test.ts`, one row per pinned behavior:

| scenario | request + dir state | expected disposition | header |
|---|---|---|---|
| 304 branch, content-addressed | `?v=<current hash>` refetched with `if-none-match` = the first response's `etag` | 304, no body | `cache-control: public, max-age=31536000, immutable`, same `etag` |
| 304 branch, non-addressed | `?v=dev` (or any non-matching `?v=`) refetched with `if-none-match` = the first response's `etag` | 304, no body | `cache-control: no-cache`, same `etag` |
| redeploy inversion | dir's content hash changes (a tracked file's bytes change); request still carries the OLD `?v=<hash>` | instantly demoted — CURRENT bytes served, revalidatable, never `immutable` again | `cache-control: no-cache` |
| in-place rebuild tracking | same server instance, same dir, a file rewritten in place (new bytes, same path, past the stat-probe memo) | pre-rebuild `?v=` no longer addressed; post-rebuild `?v=` is | `cache-control: no-cache` (old `?v=`) / `public, max-age=31536000, immutable` (new `?v=`) |
| degraded empty dir | dir starts missing/empty (no version); a file appears afterward — `GET /_assets/late.js?v=dev` | 200; no version invented, `?v=`-based addressing gives nothing `immutable` | `cache-control: no-cache` |

The "nothing `immutable`" result above is specific to `late.js` — a non-chunk-named file, so
only `?v=`-based addressing was ever in play. A `chunk-XXXXXXXX.js` present on disk in that
same degraded/null-version `dir` still matches `HASHED_CHUNK` by name and still gets
`immutable`: name-addressing doesn't depend on the version being resolvable at all.

### Worked example: one dir, three requests

Reusing [§4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md)'s digest — `outDir`'s current content hash is `7f3c9a1e4b6d0852`.

- **Golden path** — `GET /_assets/client.js?v=7f3c9a1e4b6d0852`: method is GET (passes the
  allowlist); `client.js` carries no percent-escapes to decode; the decoded segment has no
  `..`; the basename extension is `.js` → `text/javascript; charset=utf-8`; `?v=` equals the
  current hash → content-addressed. Response: `200`, `content-type: text/javascript;
  charset=utf-8`, `cache-control: public, max-age=31536000, immutable`, `etag:
  W/"<size>-<mtime>"` (an ETag rides even the `immutable` branch — only `cache-control`
  is addressing-dependent).
- **Traversal attempt** — `GET /_assets/..%5cclient.js?v=7f3c9a1e4b6d0852`: decodes to
  `..\client.js`; splitting on `/` and `\` yields the segment `..` → `403` before any disk
  lookup.
- **Stale revalidation** — `GET /_assets/client.js?v=0123456789abcdef` (a prior deploy's
  hash), carrying `if-none-match` set to that file's current `etag`: `?v=` no longer equals
  the current hash → not content-addressed → the `no-cache` path; the `etag` still matches
  (the bytes haven't moved since) → `304`, no body, same `etag`.

