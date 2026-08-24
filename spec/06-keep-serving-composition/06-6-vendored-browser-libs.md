## 6. Vendored browser libs

**The `VENDOR` map** — one row per vendored lib, each a pinned copy (the `source`
column's pinned version is what makes a CVE audit or a reproducibility check
possible):

| name | served key | content-type | cache-control | source |
|---|---|---|---|---|
| `apexcharts.js` | `apexcharts.js` | `text/javascript; charset=utf-8` | `public, max-age=86400` | package source, pinned `4.4.0` |

The served key is the exact string looked up in the map (see "Request-key handling"
below). Today's full served URL prefixes that key with the asset prefix —
`<base>/_assets/vendor/apexcharts.js` (`assetPrefix = ${base}/_assets`,
`mod.ts:782,853`). Once the target `Frontend` model lands
([§3](03-3-the-servesprig-composition-current-as-built.md).3), the `base` prefix
drops and the same lib serves at the root-relative `/_assets/vendor/apexcharts.js`.
The content-type is the same mapping `serveAsset`'s `.js` case uses
([§5](05-5-asset-serving-serveasset-hardening-contract.md)).

A `VENDOR` entry is never build-emitted and never lands in `static/` — [04 §2](../04-build-pipeline-and-artifacts/02-2-the-artifact-set-static.md)
owns that closed artifact set and back-links here for the map.

**The guarantee**, as a host × request → observable-outcome table (`serveSprig`'s
dispatch checks this map at [§3](03-3-the-servesprig-composition-current-as-built.md).2
row 5, one step before `serveAsset`'s row 6):

| host | request | observable outcome |
|---|---|---|
| `serveSprig` | `<base>/_assets/vendor/*`, key present in `VENDOR` | `200` — the entry's `body`/content-type/`cache-control` |
| `serveSprig` | `<base>/_assets/vendor/*`, key absent from `VENDOR` | plain `404`, decided by this step alone — `assetsDir` is never touched |
| `serveSprig` | any `<base>/_assets/vendor/*` request, hit or miss | a miss consults no disk at all — the map lookup runs BEFORE any disk access, full stop |
| `sprigUi` | any `<base>/_assets/vendor/*` URL | `404` — `sprigUi` has **no vendor step at all** ([§3](03-3-the-servesprig-composition-current-as-built.md).4); reachable only if the host copies the vendored lib into `assetsDir/vendor` itself |

**Request-key handling.** The lookup key is the literal remainder of the path after
`<base>/_assets/vendor/`, matched exactly against the `VENDOR` map's served keys — a
plain in-memory lookup, not a filesystem read. It does NOT reuse `serveAsset`'s
percent-decode/traversal normalization ([§5](05-5-asset-serving-serveasset-hardening-contract.md)):
that normalization exists to make a decoded segment SAFE to hand to the filesystem, and
the vendor step never hands anything to the filesystem — an exact-key miss (including
one produced by an encoded or malformed segment that simply fails to match any key)
returns `404` without ever constructing a disk path, so there is no traversal surface
for that normalization to protect here.

**Why vendored, not bundled or CDN'd.** A CDN load adds a network dependency and puts
the exact served bytes outside sprig's control (offline/air-gapped builds break, and a
CDN-side version bump becomes an unreviewed supply-chain change); bundling the lib into
every app's own `client.js` means every app pays that bundle's cost for a lib that never
changes per-app. Vendoring solves both: one pinned copy lives in the package source and
is served once for every app + the isolate workbench to share. A lib earns a `VENDOR`
slot when it's a browser-global every app/isolate needs without paying to bundle it.
Apps still declare it in `deno.json`, but only for typecheck — the vendored copy is the
one that actually runs.

**Loading mechanism.** Each map entry's body is read once from this module's own
location, as TEXT: `Deno.readTextFile` when running from a `file:` install, `fetch`
when running from the published JSR module — so the same code ships the lib whether
sprig runs locally or straight off JSR.

