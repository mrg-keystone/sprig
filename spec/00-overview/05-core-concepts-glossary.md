## Core concepts (glossary)

One-line orientation per term, kept at this doc's altitude — no mechanism lives
here. Every entry ends with a trailing arrow naming the spec section that owns the
concept's full treatment; follow the arrow, not this glossary, for how it works.

### Core primitives

- **signals**: sprig's reactive primitive — wrapped `@preact/signals-core` callable
  accessors (`signal`/`computed`/`effect`); templates read them as calls (`count()`),
  and each island's single `effect()` is what turns a tracked write into a re-render.
  → spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md) owns the full treatment.
- **Backend**: the server-scoped DI token (`Token<BackendClient>`) the host binds
  per request (`root.provide(Backend, env.backend)`); its default factory throws
  ("Backend is not bound") until bound. An island runs in a fresh server injector
  that never sees request-root bindings, so `inject(Backend)` in an island server
  hook throws that same unbound-factory error, not a scope guard; client-side
  `inject(Backend)` throws on the scope guard instead — either way, the concrete
  embodiment of invariant 2, DI never crosses the wire. → spec 01
  [§2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md)/[§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) own the full treatment.

### Component model

Page, island, shell, and layout route are all **specializations of one primitive,
folder-component** — the same folder-identity and file conventions
(`template.html`/`styles.css`/`logic.ts`/`resolve.ts`), differing only in where the
folder sits (`pages/`, `routers/`, `bootstrap/`/`src/shell/`) and what it's allowed
to do (a data loader, a route wrapper, a document root).

- **Folder-component**: a folder with `template.html` (required) + optional
  `styles.css` (scoped), `logic.ts` (⇒ island, unless the `logic.ts` is server-only —
  see Island below), `resolve.ts` (pages only, server data loader). Identity = folder
  path; selector = folder basename. → spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md) owns the full treatment.
- **Page**: folder directly under `pages/`. Pages and islands are unified — a page's
  own `logic.ts` may carry a browser hook and hydrate exactly like any other island
  (`assertStaticPage` is a build-time no-op kept only so old call sites resolve, spec
  04 [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)). Page-local components (`pages/<p>/components/<n>/`) shadow same-named
  globals within that page. → spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md) owns the full treatment.
- **Island**: component with `logic.ts` that declares a browser hook (`onBrowserLoad`
  or `onBrowserInit`); hydrates on trigger (`load|idle|visible|interaction`); ships as
  `isl.<sel>.js`; props cross SSR→client as a JSON script bridge inside
  `<sprig-island>`. A `logic.ts` with only `onServerLoad` (no browser hook) is
  server-only: it runs at SSR and is skipped for client purposes — no chunk, no
  hydration boundary (spec 04 [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)).
  → spec 03 [§1](../03-islands-and-hydration/01-1-the-island-model.md) owns the full treatment.
- **`<sprig-island>`**: the custom element an island host renders as — carries the
  `data-sel`/`data-trigger` hydration markers and the `<script class="sprig-props">`
  JSON bridge that ferries `@input`s and the server snapshot from SSR to client.
  → spec 03 [§2](../03-islands-and-hydration/02-2-the-ssr-client-props-contract.md) owns the full treatment.
- **Shell**: the persistent document layout containing the outermost `<sprig-outlet
  data-level>` — the same element type that Layout routes nest, so the shell's outlet
  is the top (outer) link in the soft-nav diff chain, not a separate mechanism. With a
  `bootstrap/template.html` shell its raw `<head>` is injected verbatim; a scanned
  `src/shell/` component (the scaffold's form) is body-only and gets the framework
  default head. → spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md) owns the full treatment.
- **Layout route**: a folder-component whose path starts with `routers/` — wraps
  children in its own `<router-outlet>` (authored; renders as `<sprig-outlet data-level>`); matched routes produce a `chain` (outer→inner) that
  soft-nav diffs by `<sprig-outlet data-level>`. → spec 01 [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md) owns the full treatment.
- **`<sprig-outlet>`**: the custom element a Shell or Layout route's `<router-outlet>`
  renders as, stamped `data-level` = the matched level's `load` string; soft-nav pairs
  outlet chains position-by-position by this key to decide what swaps.
  → spec 03 [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md) owns the full treatment.
- **soft-nav**: same-origin client-side navigation that intercepts the Navigation
  API, fetches the destination, and swaps only the shallowest differing
  `<sprig-outlet>` position — any skip/commit-fail condition falls back to a full
  browser navigation. → spec 03 [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md) owns the full treatment.

### Route processing

Guards, grants, and resolve are the three request-pipeline steps bootstrap runs, in
that order, inside the route injector — guards and grants each collect parent-first
across the matched chain, but resolve is leaf-only: a single resolver keyed off the
matched route's own `load`, never a collected chain. See [00-overview
§3](03-the-mental-model-request-path.md) for where this sits in the whole request
path.

- **guards**: parent-first collected `(ctx) => string[]` checks on matched routes, run
  BEFORE grants; each guard's return is the target route as path segments, compared by
  VALUE (never array identity) against the request path's own segments normalized the
  same way — an equal-valued return (including a rebuilt `[...ctx.path]`) means
  "proceed," anything else (including `[]`, which normalizes to root) means REDIRECT to
  that target. The `[]`-as-redirect-to-root reading is a footgun: a guard
  meaning "no objection" must echo the request's own segments back, not return `[]`.
  → spec 01 [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md) owns the full treatment.
- **grants**: parent-first collected `requiredGrant` strings on matched routes,
  verified in bootstrap after guards and before resolve via `config.verifyGrant`; an
  absent `verifyGrant` skips the check entirely and the route renders unverified.
  → spec 01 [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md) owns the full treatment.
- **resolve**: server-only data loader run in the request injector, called with
  `{params, url}` as its only arguments (no session — deliberate leak-surface design);
  it may still reach the in-process `Backend` through ambient `inject()`, since it runs
  inside the same request injector guards/grants share — only *session* is withheld
  from resolve, not DI. → spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) owns the full treatment.

### Ecosystem

- **keep**: the rune-generated Deno backend framework, published as
  `@mrg-keystone/rune` (sprig retargeted from the abandoned `@mrg-keystone/keep`
  name — spec 09 §5 Q2; rune is the separate generator tool — see rune
  below, not a package sprig imports). sprig consumes keep via
  the `KeepApi` `{backend, handler}` seam — in-process for SSR, token-gated `/api/*`
  for islands ("token-gated" = keep's deny-by-default credential guard; the
  credential is the httpOnly session cookie in session mode, a client-held bearer in
  legacy mode — spec 06 [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md)). Not to be confused with `packages/keep/mod.ts` in this
  repo: that's sprig's own composition-root module (ships under `@mrg-keystone/sprig`,
  spec 06) that wires up a `KeepApi` instance — it is named after keep, it is not
  keep. → spec 06 [§2](../06-keep-serving-composition/02-2-the-keepapi-seam-session-types-current-as-built.md) owns the full treatment.
- **rune**: the counterpart code-generation tool — sprig's design/prototype half meets
  rune's spec/data/build half to produce a keep-shaped backend from a `.rune` spec
  (coordinators → business → data layering); a separate generator tool, not a package
  sprig imports. → spec 07 [§3](../07-isolate-workbench/03-3-the-server-server-a-rune-generated-keep-backend.md) owns the full treatment.
- **The diamond**: the product pipeline — prototype/design (sprig side) and
  spec/data/build (rune side) converging on one queries+commands contract and one
  composed app (`serveSprig({keep, app})`). → spec 09
  [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md) owns the composition
  seam the diamond converges on; the queries+commands contract half is spec 09
  [§3](../09-ecosystem-contracts/03-3-the-waist-rule-sprig-s-half.md); the composed
  app itself is spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md).
- **isolate case**: `<component>/isolate/fixture.json` + `cases/<n>/<n>.json` +
  a co-located `<component>/*.cy.ts` (Cypress spec run by the Deno-native
  `@mrg-keystone/cy-deno`, ≥1 required per component/page) — the workbench's
  preview/test unit. → spec 07 [§5](../07-isolate-workbench/05-5-the-isolate-case-format.md) owns the full treatment.

