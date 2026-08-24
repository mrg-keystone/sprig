# 06 — Serving & composition: `serveSprig`/`KeepApi` (current) + the `Frontend` target

> Subject: sprig's serving & composition surface. **[§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) describes the `Frontend`
> handler — the refactor TARGET for this surface ([§10](10-10-refactor-notes.md).0: "Land it"), NOT YET BUILT.**
> No `mod.ts:N` anchor exists for `Frontend` itself — every other claim in this spec
> cites one. **[§2](02-2-the-keepapi-seam-session-types-current-as-built.md)–[§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) are the CURRENT, as-built record** of the `serveSprig`-era
> composition (the `KeepApi` seam, the dispatch table, the auth gateway) — this is
> what every composed app's actual `serve.ts` runs today (07 [§1](../07-isolate-workbench/01-1-what-isolate-is-end-to-end.md) step 6, 08 [§5](../08-install-skills-annotate/05-5-this-repo-hosts-its-own-composed-app.md)), not
> legacy history; it stays the live contract until [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) lands. **[§5](05-5-asset-serving-serveasset-hardening-contract.md)–[§9](09-9-zero-composition-derivation.md) are current** —
> sprig's own serving pipeline, unaffected either way. Source file:
> `packages/keep/mod.ts` (~990 lines, the `@mrg-keystone/sprig/keep` export); every bare
> `mod.ts:N` cite in this spec points into it (the package name is historical — [§2](02-2-the-keepapi-seam-session-types-current-as-built.md)).
>
> **The one-origin thesis.** Every section here is a consequence of one design
> choice: the UI, `/api/*`, `/auth/*`, and assets are composed behind a SINGLE
> origin, so an island's same-origin `fetch("/api/*")` carries the httpOnly
> `sprig_session` cookie automatically — no CORS, no token client code has to
> attach itself. [§3](03-3-the-servesprig-composition-current-as-built.md)'s `base`
> prefix exists ONLY to carve room for `/api`+`/docs` at that one origin;
> [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s cookie is
> minted with `Path=/` precisely so it rides every same-origin request, not just
> `/auth/*`; [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s
> target keeps `/api/*` foreign to sprig by rule but never forwards it elsewhere
> (Rule 1) — the one origin still answers it, sprig just isn't the one dispatching.
>
> 06 owns no system invariant in full, but
> [§5](05-5-asset-serving-serveasset-hardening-contract.md) is the serve-side
> ENFORCEMENT leg of invariant 5 (content-addressed `?v=`): `serveAsset`
> recomputes the current hash per request and grants `immutable` only on a
> match. The hash's computation and stamping — the other two legs — live in
> 04 [§4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md),
> which names this section back ("serve-side enforcement of `immutable`/
> `no-cache`… is 06 §5").
>
> Pinned by nine test files: `sprig-ui`, `auth-exchange`, `session-thread`,
> `asset-cache-addressing`, `asset-percent-decode`, `asset-traversal`, `body-byte-cap`,
> `json-routing`, `framework-logging`.

Section index — the ten fragments' live-vs-aspirational status as data:

| § | the one thing it owns | status | pinned-by test |
|---|---|---|---|
| [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) | The `Frontend` handler contract | TARGET | — (not yet built) |
| [§2](02-2-the-keepapi-seam-session-types-current-as-built.md) | The `KeepApi` seam + session types | CURRENT-live-contract | — |
| [§3](03-3-the-servesprig-composition-current-as-built.md) | The `serveSprig`/`sprigUi` dispatch table | CURRENT-live-contract | `sprig-ui` |
| [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) | The `/auth` gateway + `/api` body gateway | CURRENT-live-contract | `auth-exchange`, `session-thread`, `body-byte-cap` |
| [§5](05-5-asset-serving-serveasset-hardening-contract.md) | `serveAsset` hardening (traversal, cache addressing) | current-independent | `asset-cache-addressing`, `asset-percent-decode`, `asset-traversal` |
| [§6](06-6-vendored-browser-libs.md) | The `VENDOR` map (vendored browser libs) | current-independent | — |
| [§7](07-7-head-meta-provenance-logging.md) | `injectHeadMeta` provenance tags + framework logging | current-independent | `framework-logging` |
| [§8](08-8-json-folder-routing.md) | `loadRoutes` JSON folder routing | current-independent | `json-routing` |
| [§9](09-9-zero-composition-derivation.md) | Zero-config derivation (`entryRoot` → `routes`) | current-independent | — |
| [§10](10-10-refactor-notes.md) | Refactor notes | refactor notes | — |

