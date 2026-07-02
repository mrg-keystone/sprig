# sprig feedback

One folder per issue. Each holds its own write-up and, where applicable, a
self-contained `repro/` that runs against the framework code in this repo (no browser,
no mocks of sprig) and exits non-zero if the behavior it pins ever changes.

| # | Issue | Status | Contents |
|---|---|---|---|
| [01](01-stale-bundle-wedge/) | **Stale-bundle wedge** — a frozen `?v=` + unconditional `immutable` caching left a returning browser running two copies of the sprig client runtime after a redeploy; every island died with `inject() must be called synchronously…`. | Fixed in 0.14.0 | `bug-report.md`, `suggestion.md`, `response.md`, `repro/` (3 scripts) |
| [02](02-dev-prod-composition-parity/) | **Dev/prod composition parity** — `sprig dev` did not serve the real prod composition (`serveSprig`), so a `/auth` route present in prod was absent in dev and 404'd only after deploy. | Fixed on branch | `dev-prod-parity.md` (index of both deploy incidents), `composition-parity.md` |
| [03](03-guard-ssr-data-leak/) | **Guard-pass SSR data leak** — a guard-pass unconditionally renders the protected page's `Backend` data into the first document, and `resolve()` gets no auth signal, so the `?token=` login handshake leaks the payload to an anonymous visitor. | Open | `bug-report.md`, `repro/` (2 scripts) |

Issues 01 and 02 are both instances of a dev/prod-parity theme (a defect invisible
locally but live in prod); `02-dev-prod-composition-parity/dev-prod-parity.md` is the
cross-cutting index for those two.
