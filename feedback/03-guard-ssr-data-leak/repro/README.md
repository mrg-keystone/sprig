# Repro: the guard-pass SSR data leak

Self-contained reproduction of the issue in [`../bug-report.md`](../bug-report.md).
Each script runs **against the real framework code in this repo** (no mocks of sprig
itself) and asserts the current behavior — it exits non-zero if the behavior ever
changes (the fix landed, or the seam it depends on moved).

Run everything from the **repo root**:

```sh
deno run -A feedback/03-guard-ssr-data-leak/repro/01-guard-pass-leaks-ssr-data.ts
deno run -A feedback/03-guard-ssr-data-leak/repro/02-resolve-cannot-see-auth.ts
```

| Script | Demonstrates | Implicated code |
|---|---|---|
| `01-guard-pass-leaks-ssr-data.ts` | With the common `?token=` magic-link handshake guard, an **anonymous** `GET /app/overview?token=3` (no cookie) returns **HTTP 200** with the protected records embedded in the SSR HTML; the no-token control `GET /app/overview` **302**s to login. A guard-pass unconditionally runs `resolve()` against the trusted in-process `Backend` and embeds the result — the guard is the *only* gate on the render. | `framework/.sprig/core.ts` bootstrap: guard loop (`~608-626`) → `resolve()` (`~640-649`) → embed in SSR |
| `02-resolve-cannot-see-auth.ts` | Why the leak can't be closed in the app's data layer: sprig hands `resolve()` a `ResolveCtx` of `{ params, url }` **only** — no headers, no cookie — even when the request carries both. The guard (`GuardCtx.headers`) is the sole layer that sees the auth signal, so once it passes there is nothing left to re-gate on. | `framework/.sprig/core.ts:385-389` (`ResolveCtx`); `645` (`resolve` called with `{ params, url }`) |

`fixture-app/` is the smallest sprig app that exercises the real path: a public
`login` page and a `requireLogin`-guarded `overview` page whose `resolve.ts` reads
records from a bound `Backend`. `main.ts` exports `makeApp()` + `makeBackend()`; the
`SECRET_CALLS` phone numbers carry a `LEAK-MARKER` the scripts grep for in the HTML.

Both scripts drive `bootstrap()` directly via `app.fetch(req, info, { backend })` —
the same entry `serveSprig` calls per request — so nothing here is synthetic.
