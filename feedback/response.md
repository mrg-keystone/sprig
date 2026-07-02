# Response: fixed — all four layers implemented (2026-07-01)

All three defects were confirmed by running your repro scripts against the framework
as-is, then fixed per `suggestion.md`. The invariant is now enforced in code:
**`immutable` is only ever sent for a content-addressed request.**

## What changed

### Layer 1 — one source of truth for the assets dir
- `serveSprig` and `sprigUi` compute the content hash of **the dir they actually serve**
  (`assetsDir`) and thread it into the app as `env.assetsVersion`
  (`packages/keep/mod.ts`). The hash is memoized behind a cheap stat probe
  (name/size/mtime of the same `.js`+`app.css` set), so an in-place rebuild — dev HMR, or
  `sprig build` under a running server — is picked up on the next request. (A
  startup-frozen memo would have re-created the wedge for in-place rebuilds; probing was
  chosen over your "once at startup" for that reason.)
- `renderDocument`/`renderStream` accept `ropts.assetsVersion`, which **wins** over the
  renderer's own `readVersion()` guess (`framework/.sprig/compiler/mod.ts`,
  `core.ts` bootstrap threads it). `SPRIG_ASSETS_DIR` + the cwd fallback remain for
  `sprig dev` / standalone use, exactly as you suggested.

### Layer 2 — cache policy tied to content-addressing
`serveAsset` (`packages/keep/mod.ts`) now sends:
- `?v=` **equal to the current content hash** → `public, max-age=31536000, immutable`
- content-hash-**named** chunks (`chunk-XXXXXXXX.js`, esbuild's 8-char names — fetched via
  bare relative imports, no `?v=`) → `immutable` (addressed by filename; the pattern is
  tight so a hand-authored `chunk-utils.js` can't be pinned)
- everything else — `?v=dev`, missing, stale hash — → `no-cache`; the existing ETag/304
  path makes revalidation one conditional request. A wedged browser asking for an old
  `?v=` gets current bytes, revalidatable — no re-pinning.

### Layer 3 — fail loud
The degraded `"dev"` fallback now `console.warn`s **once, at first use in a non-dev
render**, naming the directory it tried. Not at boot — that would false-alarm
serveSprig apps whose env supplies the real version per request. (Your repro 01 output
now shows the warning.)

### Layer 4 — dual-runtime self-defense
- `core.ts` detects a second runtime copy at module init (browser-gated via
  `globalThis.__sprig_runtime`), `console.error`s the *actual* cause (stale cached
  bundle), and flags `__sprig_runtime_dual`. Server-side double instances stay silent
  (legitimate — your repro 03 itself is one).
- `hydrate.ts`: on a hydrate/import failure **with the dual flag set**, a one-shot
  `sessionStorage`-guarded `location.reload()` — never loops, and a genuine app bug
  (flag unset) never reloads.
- Cross-copy `inject()` remains an error by design, per your "what NOT to do".

## Verification

- `deno run -A feedback/repro/02-immutable-wedge.ts` now **exits 1**: visit 1 stamps a
  real hash, the redeploy changes it, visit 2 fetches deploy 2 from the network — the
  mixed-runtime document can no longer form. Repro 01 still shows the (intentional)
  standalone fallback, now with the loud warning; repro 03 still shows per-copy DI
  (by design) — the browser-side detection it asked for is test-covered instead.
- 15 new regression tests (your suggested matrix, plus the chunk-name rule, the
  in-place-rebuild case, and the dual-runtime module-load path):
  `packages/keep/asset-cache-addressing.test.ts`,
  `framework/.sprig/compiler/render-version-env.test.ts`,
  `framework/.sprig/dual-runtime.test.ts`,
  `framework/.sprig/compiler/hydrate-dual-recovery.test.ts`.
- Full suites green: 195 passed (framework + packages), 44 passed (server + app).

## Migration

As you noted: SSR HTML is `no-store`, so the first deploy carrying this fix points every
returning browser at fresh content-addressed URLs — currently-wedged clients self-heal on
their next visit with no cache purge. For alfred specifically, no app change is needed
once it runs a sprig version with this fix; the `Deno.env.set("SPRIG_ASSETS_DIR", …)`
workaround from the bug report also works today and becomes redundant after upgrading.
