# Repro: the stale-bundle wedge

Self-contained reproduction of the production incident described in
[`../bug-report.md`](../bug-report.md). Each script reproduces one link of the causal
chain **against the real framework code in this repo** (no mocks of sprig itself), and
exits non-zero if the defect is ever fixed and the expectation stops holding.

Run everything from the **repo root**:

```sh
deno run -A feedback/01-stale-bundle-wedge/repro/01-frozen-version.ts
deno run -A feedback/01-stale-bundle-wedge/repro/02-immutable-wedge.ts
deno run -A feedback/01-stale-bundle-wedge/repro/03-dual-runtime-inject.ts
```

| Script | Demonstrates | Implicated code |
|---|---|---|
| `01-frozen-version.ts` | `?v=` is computed from `SPRIG_ASSETS_DIR \|\| <cwd>/static`, not the configured `assetsDir` — degrades to the constant `"dev"` on Deno Deploy (no `static/` in cwd), or hashes an unrelated directory. Either way the asset URL is frozen across deploys. | `framework/.sprig/compiler/mod.ts:175-189` |
| `02-immutable-wedge.ts` | Assets are served `cache-control: public, max-age=31536000, immutable` unconditionally. With the frozen URL, a returning browser reuses deploy N-1's `client.js` forever (reload does not help — `immutable` skips revalidation), while freshly fetched island files come from deploy N → two runtime chunks in one document. Also reproduces the observed "the chunk the browser runs 404s on the server". | `packages/keep/mod.ts:126` |
| `03-dual-runtime-inject.ts` | Why the mixed state kills every island: the active injection context is module-scoped (`let current` in `core.ts:262`), so `inject()` called from the second runtime copy throws the exact production error — even though both copies share the same root injector via `globalThis.__sprig_root`. | `framework/.sprig/core.ts:262-268` |

`fixture-app/` is the smallest possible sprig app (shell + one page island) used by
scripts 01–02 to render real HTML through `createRenderer` + `bootstrap` + `serveSprig`.
