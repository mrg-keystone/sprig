# Suggested fix: make asset caching safe by construction

Companion to [`bug-report.md`](bug-report.md). The guiding invariant:

> **`immutable` may only ever be sent for a content-addressed URL.**
> Everything else follows from enforcing that invariant in code, not by convention.

Four layers, ordered by importance. Layers 1+2 fix the bug; 3+4 make the whole failure
class impossible to reintroduce silently. None changes public API behavior for correctly
working apps, and none requires users to clear caches (see Migration).

## 1. One source of truth for the assets dir (fixes the frozen `?v=`)

`serveSprig` already knows the real assets dir (`config.assetsDir`, resolved by the app —
alfred pins it via `import.meta` precisely because cwd is unreliable on Deploy). The
renderer's `readVersion()` must hash **that same directory**, not
`SPRIG_ASSETS_DIR || <cwd>/static` (`compiler/mod.ts:175`).

Concretely, thread it through the existing per-request `env` seam rather than adding
duplicate config:

- `serveSprig` computes the content hash of `assetsDir` once at startup (same
  `.js`+`app.css` file set, same `shortHash` — `compiler/hash.ts` already exports it).
- `SprigApp.fetch(req, info, env)` already carries `{ backend }`; extend it with
  `{ assetsVersion?: string }`. The renderer prefers `env.assetsVersion` over its own
  `readVersion()` result.
- Keep `SPRIG_ASSETS_DIR` as the `sprig dev` mechanism (dev recomputes per render today —
  unchanged), and keep the cwd fallback only for standalone renderer use.

Why this shape and not alternatives:
- **Not** `createRenderer(opts.assetsDir)`: the app would have to pass the same path twice
  (renderer + serveSprig) — a new desync footgun.
- **Not** `Deno.env.set` inside `serveSprig`: mutating process-global env from a library
  is spooky action at a distance and races with multi-app processes.

## 2. Tie the cache policy to content-addressing (makes any future degradation harmless)

In `serveAsset` (`packages/keep/mod.ts:126`), replace the unconditional header with:

```
request ?v= equals the current content hash  →  public, max-age=31536000, immutable
anything else (?v=dev, missing, stale hash)  →  no-cache
```

- `no-cache` = "revalidate before reuse". The ETag/`if-none-match`/304 path **already
  exists** in `serveAsset`, so revalidation costs one conditional request returning 304 —
  not a re-download. Dev loses nothing; broken-version prod degrades to slightly more
  requests instead of wedged users.
- The stale-hash case matters: a wedged-today browser will still request old `?v=` URLs;
  answering those `no-cache` (with current bytes) prevents re-pinning.
- This is the industry rule: Vite/Next/Rollup setups send `immutable` only for
  hash-addressed files. sprig uses a query param instead of a hashed filename — fine, but
  then the *match check* is what establishes content-addressing.

With layer 2 in place, layer 1's failure mode (and any future one — new deploy targets,
env changes) can only ever cost performance, never correctness. That is the "never happens
again" property.

## 3. Fail loud instead of silently degrading

`readVersion()`'s `"dev"` fallback (`compiler/mod.ts:184-186`) should `console.warn` once,
outside dev mode, naming the directory it tried:

```
[sprig] could not hash assets dir "<dir>" — asset URLs will not be cache-busted
(?v=dev) and long-term caching is disabled. Set assetsDir/SPRIG_ASSETS_DIR.
```

One log line at boot would have turned this multi-hour production hunt into a config fix.

## 4. Runtime self-defense: detect a second runtime copy

The injection context (`let current`, `core.ts:262`) is module-scoped, so a dual-runtime
document fails with a misleading DI error (repro 03). Don't share `current` across copies
— token `REGISTRY` and class identities are per-copy, so cross-copy resolution would fail
in stranger ways. Instead **detect and report**:

- On runtime module init: if `globalThis.__sprig_runtime` is already set by another copy,
  `console.error("[sprig] two copies of the sprig runtime are loaded — this usually means " +
  "a stale cached bundle after a redeploy; hard-reload / clear caches. Islands will fail to hydrate.")`;
  else set it.
- Optionally, in `hydrate()`'s catch: when that flag indicates a dual load, attempt a
  **one-shot** recovery reload guarded by a `sessionStorage` marker (the pattern
  Vite/Next use for stale-chunk errors) — never loop.

## Migration / rollout

- The SSR HTML is already `no-store`, so the first deploy with a real `?v=` hash points
  every returning browser at brand-new URLs — **all currently wedged clients self-heal on
  their next visit**, no cache purge, no support burden.
- Orphaned CDN entries for `?v=dev` URLs are simply never referenced again.
- No API break: `env.assetsVersion` is optional; standalone `createRenderer` users keep
  today's behavior plus the new warning.

## What NOT to do (each "fix" causes new problems)

- **Don't drop long-term caching** (`no-store` on assets): correct but punishes every
  page load; the ETag/immutable machinery is worth keeping — it just needs the invariant.
- **Don't switch to hashed filenames** (`client.<hash>.js`) as the *bugfix*: it's a larger
  build+manifest change; the `?v=` match check achieves the same correctness. (Fine as a
  later refactor; Deno Deploy's CDN keys on the full URL including the query, verified in
  the incident.)
- **Don't make `current` global** to "support" dual runtimes — cross-copy DI can't work
  (separate registries); dual load must stay an error, just a *loud, accurate* one.
- **Don't auto-reload unconditionally on hydrate failure**: a genuine app bug would loop
  users' tabs. Only the detected dual-runtime case, once per session.

## Regression tests worth adding

1. `serveAsset` header matrix: current-hash `?v=` → immutable; `?v=dev` / missing / stale
   hash → `no-cache`; conditional GET still 304s on every branch.
2. `readVersion` uses the serveSprig-provided dir when present; warns (non-dev) on
   degradation; `?v=` in rendered HTML changes when an asset file changes.
3. The repro scripts in [`repro/`](repro/README.md) inverted: 01 asserts the rendered
   `?v=` matches the hash of the *configured* assets dir regardless of cwd; 02 asserts
   visit 2 fetches the new `client.js` from the network; 03 asserts the dual-copy
   `console.error` fires.
