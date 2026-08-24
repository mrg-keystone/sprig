## The mental model (request path)

This is the whole system traced as one request's lifetime: a **server arc**
(request → HTML, top of the block below) and a **client arc** (HTML →
interactive, everything after `→ browser:`), split at that seam. Read this
before any numbered subsystem spec — it's the map into them, not a
replacement for them.

```
request → serveSprig (keep composition, one origin)
  /api/*  → keep network handler (token-gated, prefix stripped)
  /docs*  → keep Swagger UI
  /auth/* → session gateway (httpOnly cookie)
  <base>/_assets/* → built static files (ETag / immutable-by-content-address)
  <base>/*         → the sprig SSR app:
      match route → DI / in-process Backend → guards (parent-first) → grants →
      resolve(params, url) (core.ts) → renderer (page → layouts → shell) → HTML with island hosts
→ browser: client.js boots → each <sprig-island> hydrates its logic.ts on its
  trigger → signals re-render islands (string render + DOM morph) → soft-nav swaps
  <sprig-outlet> levels on same-origin navigation
```

Each hop's owning spec:

| hop | owning spec |
|---|---|
| `serveSprig` (one-origin composition) | spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) |
| `/api/*` (token-gated) | spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) row 5, [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `/docs*` (Swagger UI, forwarded unstripped) | spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) row 6, [§2](../06-keep-serving-composition/02-2-the-keepapi-seam-session-types-current-as-built.md) |
| `/auth/*` | spec 06 [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `<base>/_assets/*` | spec 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md), spec 04 [§4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md) |
| match route → guards → grants | spec 01 [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md) |
| DI / in-process Backend | spec 01 [§2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md), [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) |
| `resolve` (server data load, run in the request injector with `{params, url}`) | glossary [`resolve`](05-core-concepts-glossary.md), spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 7 |
| renderer (page → layouts → shell) | spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md) |
| HTML with island hosts | spec 04 [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md) |
| client.js boots + trigger hydrate | spec 03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md) |
| signals re-render (string render + DOM morph) | spec 03 [§5](../03-islands-and-hydration/05-5-reactive-update-model.md) |
| soft-nav | spec 03 [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md) |

