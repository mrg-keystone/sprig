## 3. Per-subsystem ideal

### 3.1 Core runtime (spec 01)
- **Grants fail *closed*, loudly** [CLEAR WIN]. If any route declares `requiredGrant`
  and `verifyGrant` is absent, `bootstrap()` throws at wiring time
  (`route 'admin' requires grant 'admin' but no verifyGrant is configured`).
  Today it renders unverified and silent — a prod auth hole that passes smoke
  tests. Minimal `{routes}` configs still boot (assertion only fires when a route
  actually declares a grant).
- **Guards have an explicit "proceed"** [CLEAR WIN]. Return `null`/`undefined` (or a
  `proceed` sentinel) to allow; a `string[]` then *only ever* means redirect.
  Kills the `[] ≡ redirect-to-root` trap that works on `/` and silently breaks
  everywhere else. Back-compat: keep the value-comparison path — this is
  additive, not a breaking change; no existing guard needs to change on
  upgrade. `sprig migrate` (§3.10) still flags `[]`-as-redirect returns for
  manual review, as an ADVISORY lint (the pattern is a common footgun even
  though it keeps working), not a codemod rewrite.
- **Route-config validation is loud at wiring time** [CLEAR WIN]. The routing-config
  analogue of the grant hole above: `loadRoutes`/`mapRouteTable` (spec 06 §8) reads
  `RawRoute` fields structurally and has no failure mode for a value that resolves
  to nothing — a `load: "pages/dashbord"` typo pointing at no folder-component, a
  `guards: ["typo"]` pointing at no `guards/<name>/mod.ts`, or a malformed
  `routes.json` all fail silently or ambiguously today, on the daily authoring
  surface a developer edits by hand. `bootstrap()`/`loadRoutes` validate every
  route's `load` resolves to a real folder-component (or, for a layout `load`, a
  real `routers/**/routes.json`) and every `guards` entry resolves to a real
  `guards/<name>/mod.ts`, throwing at wiring time with the offending route's
  `path` + the unresolved value (`route '/dashboard' has load "pages/dashbord" —
  no such folder-component (did you mean "pages/dashboard"?)`). This is a
  validation diagnostic, distinct from §3.5's `routes.json` hot-reload item (that
  is about picking up an edit; this is about the edit being wrong).
- **The 500 names its phase** [CLEAR WIN]. Always log the caught error server-side with
  phase (`guard|grant|resolve|render`) + `matched.load`; in dev render the real
  error + stack + phase into the body; optional `x-sprig-error-phase` header for
  prod log correlation. Prod body stays the opaque string. This is the
  BUFFERED branch's controlled 500 (spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 10, the one branch wrapped
  in try/catch); the streaming branch has no controlled-500 shape to name — a
  throw before emission propagates uncaught (a host-level concern) and a throw
  after emission can never become a 500 (the head is already sent). [§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).2
  gives the streaming path its own dev/prod handling instead: a dev-only
  buffering wrapper turns a mid-stream throw into the same full-page dev-error
  document, and in prod the caught error is logged with `phase: "render"` and
  routed through `onError` ([§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).3), since the response itself can no longer be
  changed once streaming has begun.
- **`inject()` after `await` explains itself** [CLEAR WIN]. Detect the cleared-`current`
  case and throw the *true* message ("inject() called after an await — capture it
  before the first await, or use currentInjector()") instead of the misleading
  "must be called in setup/resolve/guard" that fires while the dev *is* in resolve.
  [FORK] longer-term: pass the injector on the ctx (`ResolveCtx.inject`) so there's
  no ambient global to clear — `inject` is a capability, not session, so it doesn't
  breach the leak invariant.
- **`Backend.get` is a discriminated union** [CLEAR WIN]. `{ok:true;status;data:T} |
  {ok:false;status;kind:"network"|"http"}` so `if (r.ok)` narrows `data` to `T`
  (no more `r.data!`), and network failure is a named `kind`, not the magic
  `status:0` sentinel. Add `getOrThrow<T>` so resolve code isn't wall-to-wall
  `if(!ok)` and GET/POST share one error model. `get` keeps its never-throws
  guarantee (additive). This union is the low-level primitive underneath the
  typed contract client (below) — most resolve code should never call it
  directly.
- **`resolve.ts` reads through the same generated typed client the browser
  uses, not a hand-typed `Backend.get`** [CLEAR WIN]. §3.9 already generates a
  typed contract client from the rune OpenAPI (`spec/contract/client/`) — today
  that client is wired only to the browser's `/api/*` channel, so `resolve.ts`
  still writes `inject(Backend).get<T>("/api/users/" + id)`: a hand-supplied
  `<T>` and a hand-typed path, with drift caught only by however carefully the
  developer kept the string and the type in sync by hand. Handing the SAME
  generated client the in-process `Backend` fetch (spec 09 [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md)'s SSR channel,
  not the network one) gives `resolve.ts` end-to-end typed reads —
  `client.users.get(id)` returns a typed DTO, the path and shape are both
  checked at compile time, and drift is caught by the `openapi.json` hash §3.9
  already stamps the client with — no `<T>`, no string path, on either
  channel. The two channels don't share one identical path surface, though:
  the in-process channel calls the keep's native paths directly
  (`Backend.get("/http/get-manifest")`, spec 07 [§4](../07-isolate-workbench/04-4-the-workbench-ui-app.md)), while the network channel
  is `/api`-prefixed and stripped server-side (spec 06 [§3.2 row 5](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) — the same
  endpoint is `POST /api/http/…` from an island). The generated client stays
  ONE typed surface — one schema, one set of method names — but it must be
  instantiated per-channel with the matching base/prefix, not assumed to emit
  one identical path string for both. `Backend.get`'s discriminated union
  stays the primitive the generated client is built on, not something resolve
  code reaches for directly.
- **`ResolveCtx` carries a status control** [CLEAR WIN]. `ctx.setStatus(404)` (or
  `throw new NotFound()`), so a data loader can 404 without knowing the arcane
  `setResponseStatus(currentInjector(), 404)` internals. Session stays withheld
  from resolve by design, and `resolve.ts`'s `inject(Backend)` reaches keep's
  in-process client with **auth bypassed and no session/headers** (spec 09 [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md);
  spec 06 [§3.2 row 9](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md)) — it can read public/shared data, but it cannot resolve the
  request's cookie; there is no user-scoped read available from `resolve`. The
  ctx type itself documents this and points at the one blessed
  user-scoped-SSR seam instead: a page's `logic.ts` `onServerLoad(ctx: RouteCtx)`,
  which DOES receive `session` (spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)/[§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md)) — that's where a per-user server
  read belongs. `resolve` stays provably user-agnostic; that's the point of
  withholding session from it, not a gap to route around.
- **StateService requires an explicit key** [CLEAR WIN]. `key` is mandatory (a static
  `key` field — the same field the current/scaffold shape already declares, spec 01
  [§5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md), spec 05 §3 — checked at registration); never fall back to `constructor.name`,
  which the prod minifier mangles into silent cross-state collisions/data loss.
- **One render path** [CLEAR WIN, migration-gated]. Collapse the legacy
  `config.render`/`renderStream`/`modules` precedence into `renderer`; if both a
  legacy callback and a `renderer` are supplied, throw at bootstrap. Silent
  shadowing (the code you're editing isn't the code that runs) is the worst config
  bug. The one live `modules` consumer migrates in the same change.
- **Dual-runtime recovery is visible** [CLEAR WIN]. In dev, a banner ("two runtime
  copies — clear the Deno cache / check the import map; DI is disabled") instead of
  one easily-missed console line + a silent one-shot reload.
- **Drop the inert `inputs` contract** [CLEAR WIN]. `ComponentDef.inputs` currently
  reads nothing; either implement it (validate/whitelist bridged attrs, dev-warn on
  undeclared/typo'd) or remove it so no one writes a no-op that manufactures false
  confidence.
- **Side-effect-free import — the auth half only** [INTERIM, FORK]. Move
  `seedTokenFromUrl()` behind an explicit `initAuth()`/bootstrap flag so
  importing a signal doesn't rewrite the URL + fire a network call. (Cost: the
  magic-link "works on any page load" needs one explicit call.) This is
  interim discipline on the built-in-auth surface §3.6 rules is being removed
  once the `Frontend` contract lands (§3.6; spec 06 §4; spec 09 §5) — it
  becomes moot the moment `auth.ts`/`seedTokenFromUrl` are deleted and auth
  becomes a pluggable guard layer, not a durable investment in `initAuth()`
  itself. `detectDualRuntime()` is NOT the same kind of
  side effect and stays unconditional: it is a DI-integrity guardrail that works
  ONLY by running at every copy's import time — a second runtime copy is caught
  because its import-time run finds `globalThis.__sprig_runtime` already stamped
  by the first (spec 01 [§7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)). Gating it behind an auth opt-in means a no-auth app
  never runs it, so a dual-runtime break goes UNDETECTED — the exact silent-DI-
  failure this document otherwise crusades against. Keep `detectDualRuntime()`
  unconditional at module-init (or move it earlier, into bootstrap/hydrate, if
  that proves cleaner) and gate ONLY the auth network side effect behind
  `initAuth()`.

### 3.2 Template compiler (spec 02)
- **Templates are type-checked** [FORK, highest ceiling]. Emit a per-component
  `.d.ts` binding every interpolation/binding to `logic.ts`'s scope type and
  `resolve.ts`'s return type, so `deno check` catches `{{ user.naem }}` and
  prop-bridge typos before the page ever renders. If the team instead intends
  templates to stay dynamically typed, that non-goal must be *stated*, not left
  silent. The silence is the defect.
- **An editor language service over `template.html`** [FORK]. Batch `deno check`
  against the `.d.ts` emission above only catches template typos at build time;
  the daily authoring loop needs the same live signal Angular/Vue/Svelte give for
  free: autocomplete inside `{{ }}` and `(click)="…"`, hover types, go-to-definition
  from `<user-card>` to its folder, red squiggles as you type. This is the bigger
  authoring lever — orthogonal to the runtime bundle (invariant 4 untouched, it's
  editor tooling, never shipped code) — with the `.d.ts`/`deno check` emission as
  the floor beneath it, not a substitute for it. *Recommend: build the language
  service once the `.d.ts` emission (previous bullet) exists to drive it — the
  type information is the hard part; the LSP wrapper is comparatively
  mechanical.*
- **A post-parse semantic-lint pass** [CLEAR WIN for the pass; FORK on `@defer`].
  Walk the clean AST and reject/located-warn on parseable-but-inert constructs:
  `*ngIf`/`*ngFor` (`use @if`), `[@anim]`, and especially `@defer` (which parses as
  first-class but renders *eagerly* — a silent perf cliff that looks correct in
  dev). The fork: implement `@defer` vs reject it — but shipping it half-parsed with
  no signal is the one option that must not survive. *Recommend: reject it* —
  a located build error naming `@defer` as unsupported (not a silent eager
  render) until a real deferred-rendering strategy is designed and built,
  consistent with this pass's own reject/located-warn treatment of the other
  inert constructs above; implementing `@defer` for real is a separate,
  larger feature this bullet doesn't scope.
- **Unknown pipe is a build error** [CLEAR WIN]. The pipe vocabulary is closed and
  known at compile time; `{{ price | curency }}` → `unknown pipe 'curency'; did you
  mean 'currency'?`, not silent passthrough. Zero runtime cost.
- **Expression limits announce themselves** [FORK]. Either expand the interpreter's
  safe-global set to the members that are PURE/DETERMINISTIC — `JSON`, `Number`,
  and the deterministic slice of `Math` (`Math.max`/`min`/`round`/`floor`/…, NOT
  `Math.random`) — so ordinary formatting just works, and/or have the
  semantic-lint pass say "`Math` is not available in template expressions; use
  the `number` pipe or compute in logic.ts" and "use single quotes" for `"`. `Date`
  (`Date.now()`, `new Date()`) and `Math.random()` stay OUT of the safe-global set
  regardless of which fork wins: the same interpreter runs template expressions
  BOTH server-side (SSR) and client-side on first hydration, and that render must
  be byte-identical (spec 02 [§2](../02-template-compiler/03-2-ast-wire-format.md)) — a nondeterministic global evaluated once at SSR
  and again at hydration produces a hydration mismatch, the exact SSR/client-drift
  class the `date` pipe already contorts around (local-midnight parsing — spec 02
  §3) rather than a mere "never serialized, no wire-format risk" concern. Time
  belongs in `logic.ts`/a pipe (computed once, passed as an input or formatted
  through `date`), never read live from an expression. The current *small
  language + silent/cryptic rejection* combination is what to kill.
- **Component-tag resolution is loud on miss, and native collisions are impossible**
  [CLEAR WIN / FORK]. A registry miss for a non-native tag → `no component
  'user-crad' (did you mean 'user-card'?)`. Native-name shadowing (`components/button`
  silently never renders because `<button>` is native) is prevented by requiring a
  hyphen in component selectors (custom-element convention) or at least warning at
  build. [FORK] enforce-hyphen (clean invariant, breaks single-word selectors) vs
  warn-only. *Recommend: warn-only* — enforcing the hyphen is a breaking rename for
  every existing single-word selector, and a build-time warning naming the
  shadowed native tag already turns the silent no-render into a located diagnostic
  without forcing a rename sweep across every app on upgrade.
- **Framework-emitted utility CSS is namespaced, not user class names** [FORK].
  Component-to-component class collision is ALREADY solved: the compiler's
  attribute view-encapsulation compounds every component class to `[sX]`
  (`.toast` → `.toast[sX]`, `scope.ts` — spec 02 [§6](../02-template-compiler/07-6-supporting-modules.md)), so two components can both
  author `.toast` without colliding. The actual leak sits ABOVE that layer:
  `buildCss` runs every app through `@plugin "daisyui"`, which emits UNSCOPED
  component/utility CSS for any class name appearing anywhere in sources — this
  is what collided the workbench shell's own `dock`/`badge`/`kbd`/`toast`
  classes against daisyUI's identically-named components (spec 10 [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).3), fixed
  only by manually renaming the shell's classes around it, not by design.
  Rewriting USER class names CSS-Modules-style targets the wrong layer: it never
  reconciles with the `[sX]` model already in place, sacrifices readable
  devtools class names app-wide, and leaves the daisyUI/utility collision hole
  exactly as open. Namespacing daisyUI's own EMISSION (a build-time prefix on
  its generated selectors) sounds cheaper but understates its cost: daisyUI's
  classes (`.btn`/`.dock`/`.toast`/…) aren't just emitted CSS, they're the
  vocabulary a developer authors DIRECTLY in markup
  (`<button class="btn btn-primary">`) — prefixing the emission means every
  app-wide daisyUI usage must be rewritten to match (`d-btn d-btn-primary`),
  which is exactly the app-wide class-reference rewrite this document rejects
  for user classes, just relocated onto daisyUI's own. So "user class names stay
  untouched" is only true for a component's own `styles.css`, not for its
  daisyUI usage. *Recommend instead: keep daisyUI global, warn on collision at
  build* — an app class name shadowing a daisyUI-emitted one becomes a located
  dev diagnostic (naming the colliding selector and both sources) instead of a
  silent style bug, bare daisyUI markup (`class="btn"`) keeps working exactly as
  documented upstream, and the proven `[sX]` attribute-scoping still owns every
  component-to-component collision — trading "structurally impossible" for
  "loud when it happens," consistent with this document's own thesis that most
  of sprig's silence is fixed by surfacing it, not by re-architecting around it.

### 3.3 Islands & hydration (spec 03)
- **One owned lifecycle state machine** [CLEAR WIN, rides a planned refactor].
  Replace "one-shot scan + three rescue mechanisms that must agree" (eager selector
  registry, props bridge, `rescanIslands`) with a single subsystem owning the full
  six states [§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).3 stamps on the host (`registered|armed|loaded|hydrated|failed|released`)
  and their transitions:
  - `registered → armed` — the host is scanned and its trigger condition wired
    (`scheduleLoad`).
  - `armed → loaded` — the trigger fires and the island's chunk `import()` resolves.
  - `loaded → hydrated` — `setup()`, `__snapshot` restore, synchronous
    `restoreState()`, first render, and the browser lifecycle hook all complete
    without throwing (spec 03 [§4](../03-islands-and-hydration/04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)).
  - `loaded → failed` — any hydration catch site throws: a props-bridge parse
    failure, a `setup()` throw, or a first-render throw (next bullet).
  - `failed → armed` — **recoverable only for a props-parse failure**: spec 03 [§2](../03-islands-and-hydration/02-2-the-ssr-client-props-contract.md)
    pins the parse failure as leaving the host "retry-able" (hydrate.ts:747-755),
    so a subsequent rescan/trigger may re-attempt it. A `setup()`/first-render
    throw is deterministic island code failing, not a transient parse race — that
    `failed` is terminal; no auto-retry.
  - `{registered, armed, loaded, hydrated, failed} → released` — the child's
    absence at its keyed position in the parent's rendered string (the data-driven
    removal invariant, next bullet) releases it regardless of which state it was
    in when the parent stopped rendering it.
  - `released` is terminal: a later re-appearance at that keyed position starts a
    NEW instance at `registered`, never a revival of the released one.

  The developer reasons about one lifecycle, not an invisible handshake.
- **`released` is a real transition** [CLEAR WIN]. A data-driven removal
  (`@if (show()) { <chart/> }` → false) actually tears the child down, instead of
  the morph pinning it as a stale DOM ghost. Discriminator: the child's absence at
  its keyed position in the parent's rendered string. Invariant preserved — a
  *present* child is still never destroyed by a parent re-render; an *absent* one is
  finally released.
- **Hydration failure is loud and visible** [CLEAR WIN]. Every catch site (props
  parse, `setup()` throw, first-render throw) becomes a dev diagnostic naming
  selector + folder + failing stage; the host is stamped `data-sprig-island-state="failed"`
  with a reason; a dev overlay lists armed-but-never-fired triggers after N seconds
  ("`chart` armed on `visible` 8s ago, never entered viewport"). No more silent dead
  UI — the exact class of bug spec 10 [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).1 documents.
- **A wired-but-unwired template is loud, not silently static** [CLEAR WIN]. A
  template with `(click)`/`[(twoWay)]` bindings but no sibling `logic.ts`
  compiles fine, SSRs fine, and does *nothing*: SSR drops the events (spec 02
  [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)), there's no client chunk, no island, no signal — nothing in today's
  output says so, and it looks like a working interactive control until a
  developer clicks it. In dev, a compile-time diagnostic ("`toggle`'s template
  binds `(click)` but has no `logic.ts` — it will render static and never
  hydrate") closes this. The detection is exactly what the unwired
  `island-infer.ts` prototype already does (syntactic inference of island-ness
  from template bindings/browser hooks — spec 02 [§6](../02-template-compiler/07-6-supporting-modules.md), spec 03 [§1](../03-islands-and-hydration/01-1-the-island-model.md)). [FORK]:
  adopt `island-infer.ts` as the shipping island-classification rule (template
  shape decides island-ness, `logic.ts` presence becomes redundant) vs. keep
  file-presence as the sole rule and use the inference ONLY as a dev lint (flag
  the mismatch, never reclassify). *Recommend: dev-lint only* — file presence
  is a simpler, more discoverable mental model ("add a `logic.ts`, it's an
  island") than syntactic inference, and silently reclassifying based on
  template contents would be its own surprise; the inference pass earns its
  keep as a diagnostic, not as the shipping rule.
- **The props bridge validates serialization** [CLEAR WIN]. In dev, walk the
  `inputs`/snapshot and warn on every dropped/coerced field ("input 'items' (Map) is
  not JSON-serializable across the bridge and was dropped"). Namespace framework keys
  (`__snapshot`/`__mocks`) under one envelope so a user field can't collide. [FORK]:
  keep JSON-only + warn, or offer an opt-in typed (de)serializer for Date/Map/Set.
  *Recommend: JSON-only + warn* — a typed (de)serializer is a second wire format
  to keep in sync across the bridge on top of the one that already exists, and
  the located warning already gives the developer everything needed to work
  around a drop (serialize the field explicitly, or move it into `logic.ts`)
  without the framework taking on a second serialization contract.
- **`inject(Backend)` in an island server hook explains itself** [CLEAR WIN]. The
  throw names the boundary and the fix ("islands run in a fresh injector with no
  request bindings — pass server data as an input from the page's resolve.ts, or
  fetch /api/*"). [FORK]: give island server hooks a ctx type that doesn't expose
  `inject(Backend)` so the mistake fails at author time (preserves "DI never crosses
  the wire").
- **A failed soft-nav says why before it falls back** [CLEAR WIN]. Every soft-nav
  commit-test failure — a non-ok response, a redirect, non-HTML content-type, or a
  transport failure (spec 03 [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)) — silently does a full `location.assign()`,
  wiping in-flight SPA state with no signal that anything degraded; it looks like
  an ordinary navigation happened. In dev, log a diagnostic naming the destination
  and the reason ("soft-nav to /x fell back to full navigation: response was
  redirected/non-HTML/!ok") before the fallback fires. Prod behavior — the silent
  fallback itself, which is the correct recovery — is untouched; only its
  invisibility in dev is the defect.
- **One great form, not two at parity** [FORK]. Keeping both island forms "at
  parity" forever is itself the DX cost — two mental models, two doc sets, and
  the `{setup}` capability cliff ([§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).4) is a symptom of maintaining a second
  form at all, not a one-off gap to patch. The ideal picks ONE blessed
  authoring form and deprecates the other via `sprig migrate` (§3.10) instead
  of chasing permanent parity forever. [FORK]: the functional `{setup}` form
  (no decorators, no `emitDecoratorMetadata`, no `reflect-metadata@0.1.13`
  -EXACT double-load footgun — spec 05 §3, spec 09 [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md)) vs the class form.
  *Recommend: the functional form* — extended to full lifecycle parity
  (non-`load` trigger, snapshot, resolve, whatever the class form has today)
  so nothing is lost in the deprecation — with `sprig migrate` shipping the
  class→functional codemod and the class form becoming documented-legacy, then
  removed. The `load` default is surfaced in the inspector so "why is this
  eager?" answers itself regardless of which form wins.
- **Client `output()` fails loud** [CLEAR WIN]. The cross-island `output()` no-op is
  a known gap; in dev it should `console.error`/throw ("cross-island client outputs
  are not implemented; use a shared signal/store or fetch /api/*") instead of
  silently swallowing an emit the developer clearly intended.
- **Drop the inert `onServerDestroy` hook (and the dead `hydrateOnClient`/
  `destroyOnClient` exports)** [CLEAR WIN]. `onServerDestroy` is a DECLARED
  class-island lifecycle hook (`lifecycle.ts`) with NO production dispatch
  point — its only caller is `lifecycle.ts`'s own standalone `renderOnServer`
  spike; the real render path discards server instances without ever calling it
  (spec 02 [§6](../02-template-compiler/07-6-supporting-modules.md)). A developer who writes `onServerDestroy() { …cleanup… }` gets a
  silent no-op — the same "declared surface manufactures false confidence"
  class the inert `inputs` contract (§3.1) targets. `hydrateOnClient`/
  `destroyOnClient` are the same spike's client-side siblings, exported with no
  production caller (hydrate.ts owns the real client lifecycle). Either wire
  `onServerDestroy` into the real server render/discard path so cleanup
  actually runs, or remove it (and the two dead exports) from the documented
  hook set so `lifecycle.ts` names only hooks the framework dispatches.
- **Node-level fine-grained reactivity is the reactivity target** [FORK, highest
  ceiling]. sprig's signals are already `@preact/signals-core` — a fine-grained
  primitive — but every write re-renders the WHOLE island subtree to a string
  and morphs it in (spec 03 [§5](../03-islands-and-hydration/05-5-reactive-update-model.md)), discarding the granularity the primitive
  already provides. The ideal binds a signal write to the specific node(s) it
  feeds (an interpolation, an attribute, a `@for` item) instead of re-walking
  the subtree, closing the largest of the genuinely architectural builds this
  document names ([§0](01-0-the-one-line-thesis.md)). This is a real compiler/runtime redesign — the
  interpreter would need to compile expression→node dependency edges, not just
  re-evaluate a tree — so the fork is on scope/sequencing, not on whether to do
  it. *Recommend: commit to node-level reactivity as the target; sequence it
  after the diagnostics floor ([§5](06-5-build-order-max-dx-leverage-first.md)) since it's the largest single investment in
  the runtime.* Until it lands, a dev render-count/cost badge in the inspector
  ("`editor` re-rendered 47× this interaction, ~3ms/render") is the interim
  diagnostic that makes the whole-island-subtree granularity visible — not a
  substitute for fixing it.

### 3.4 Build pipeline (spec 04)
- **Stale artifacts are eliminated or caught, not shipped silently** [FORK]. Two
  designs, not one — they trade off against the load-bearing fact that a
  committed `app/static/**` with NO build step is what makes Deno Deploy work
  today (spec 08 [§5](../08-install-skills-annotate/05-5-this-repo-hosts-its-own-composed-app.md): this repo's own composed app ships exactly that way). (a)
  **Stop committing build output** and require a CI/deploy build step instead —
  this eliminates the whole drift class outright (there's no stale artifact to
  detect), but costs every deployment target a build step it doesn't have
  today. (b) **Keep committed artifacts, add an INPUT fingerprint**:
  `buildClient` writes a hash over every source input; `sprig serve` and deploy
  recompute it at boot and hard-fail with the exact culprit file (`static/ is
  stale — dashboard/logic.ts changed since last build`), auto-rebuilding
  instead of failing in dev. This only DETECTS drift rather than eliminating
  the class — the fingerprint is itself one more artifact that goes stale if
  the check is ever skipped — but it needs no deploy-pipeline change. The `?v=`
  OUTPUT hash is untouched either way — this is the missing INPUT half that
  content-addressing never provided. *Recommend (b) as the immediate default*
  — a strict improvement with zero deploy-model cost — *and (a) as the best-DX
  end state once a build-on-deploy story exists*; these are not equivalent
  "clear wins," and shipping (a) first would break the no-build-step Deno
  Deploy path this document elsewhere protects.
- **Build errors point at the developer's own file** [CLEAR WIN]. Sourcemap/rewrite
  synthetic entry paths (`isl.dashboard.ts:14`) back to real source
  (`island dashboard: your logic.ts:14`); locate template parse errors
  (`pages/dashboard/template.html:8:12 — unexpected token`).
- **`sprig build` is not a black box** [CLEAR WIN]. Phased progress with timings and a
  summary (per-island chunk size, shared chunk size, `app.css` size, total bytes,
  `?v=`); `--json` build receipt agents trust (the "output IS the state" principle).
  The numbers already exist in the return value.
- **Source maps served in dev** [CLEAR WIN]. Keep "dev bundle IS prod bundle" byte-for-byte
  *and* serve the already-produced `.map` sidecars in dev so devtools resolve to
  `logic.ts` instead of minified frames. Maps are sidecars, not bundle bytes.
- **Incremental dev rebuild** [CLEAR WIN]. Hold a persistent esbuild context and rebuild
  only the changed entry's graph; re-run Tailwind only when the class surface
  changed. Cost: dev tooling (esbuild-incremental) diverges from prod (`deno bundle`),
  so OUTPUT must be proven byte-identical to preserve invariant 4.
- **Versioning degrades loudly** [CLEAR WIN]. When the assets dir misresolves, say so
  (`assets dir not found at <path>; set SPRIG_ASSETS_DIR — caching disabled, serving
  v=dev`) instead of a scroll-past warning; record the served `?v=` into
  `build-info.json` as the one inspectable source of truth.
- **One token file, not two** [CLEAR WIN]. Collapse `css-variables.json`
  (legacy, watched by dev HMR, forwarded to the isolate workbench) and
  `css-tokens.json` (preferred, unwatched, not forwarded — spec 04 [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md) step 5,
  spec 05 [§6](../05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md), spec 07 [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md)) into ONE token source. Today's shape is two files
  where the RECOMMENDED one is the one the dev loop and the workbench both
  ignore; adding a per-file HMR branch and forwarding parity to
  `css-tokens.json` (as previous drafts of this document proposed) would only
  entrench two files that must be kept in lockstep forever. Deprecate
  `css-variables.json` (a one-release compat read, then a build-time warning,
  then removal) and make `css-tokens.json` the ONLY token source `dev.ts`
  watches and `generate-previews.ts` forwards — §3.5's scaffold and §3.7's
  workbench-theming items are consequences of this consolidation, not two
  separate patches that keep both files alive.

### 3.5 CLI, dev loop, HMR (spec 05)
- **State-preserving HMR for `logic.ts`** [FORK]. The file a developer edits *most*
  currently triggers a full reload + total state wipe, disproving the "state-preserving
  HMR" headline. The ideal re-imports only the changed island's chunk (cache-busted
  dynamic import) and re-hydrates in place, preserving signal state via the existing
  snapshot/restoreState path, falling back to full reload only when a change crosses
  island boundaries.
- **The server-code restart doesn't have to lose client state too** [FORK].
  `resolve.ts`, guards, and services are edited as often as `logic.ts`, but a
  server-side `.ts` change can't take the per-island HMR path above — ESM can't
  evict a cached module subgraph, so `dev.ts` restarts the whole supervisor
  (exit 75) and the client's late `onopen` handler does a bare
  `location.reload()` (spec 05 [§6](../05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md)): every mounted island's live signal state
  and scroll/focus position is gone, even though `StateService` itself
  survives the reload via `localStorage`. The ideal re-runs the server, then
  re-hydrates the current page in place — snapshotting each mounted island's
  signal state + scroll/focus before the reload, restoring it via the existing
  snapshot/restoreState path once the new server answers — instead of a bare
  reload. If that round-trip proves too costly to build reliably, name it
  explicitly as accepted friction (server-code edits reload the page; only
  `StateService`-backed state survives) rather than leaving the gap silent
  under the "state-preserving HMR" headline. *Recommend: state-preserving
  restart* — the file a developer edits second-most (after `logic.ts`)
  shouldn't have a worse story than the file edited most.
- **A compile-error overlay in the loop** [CLEAR WIN]. Add an `{type:"error"}` SSE +
  overlay: a bad template shows the located error and keeps the last-good page +
  state; a `.ts` compile error holds the previous good server up (don't kill the
  serving child until the replacement is proven bootable) and shows the boot error —
  instead of today's silent-stale template or dead tab + dead terminal.
- **Honest CLI verbs** [CLEAR WIN]. `--clean` means clean-*then*-build (not
  delete-and-build-nothing); `sprig serve` on a composition root dispatches through
  `deno serve` (or warns) instead of silently no-opping; `--open` prints
  `127.0.0.1` (not `localhost`, which re-arms the project's own documented
  IPv4/IPv6 404 bug on the highest-visibility surface — an auto-opened tab); drop
  the vestigial `--rune` no-op flag.
- **`base` is a flag, not a silent positional** [CLEAR WIN]. `sprig dev myapp --base
  /admin`, not `sprig dev myapp somethingextra` silently reconfiguring routing so
  every link 404s. Flags are discoverable in `--help` and typo-safe.
- **A real dev-process registry** [FORK, incremental CLEAR WINs inside]. Record the
  actual bound port + owner pid + a heartbeat in the registry; verify pid-owns-socket
  before any `killPort` (never SIGKILL a socket you can't prove you own — today a
  port-hash collision murders an unrelated repo's or your own workbench's server);
  pick ports by scanning from a per-repo base, not a bare hash; treat a stale
  heartbeat as reclaimable and HTTP-probe the port before declaring "attached,
  healthy" (pid-liveness answers "does a process exist," not "is my dev loop
  working"). The full version is a daemon that hands out ports and owns liveness.
- **Dev never rewrites the user's tracked files** [CLEAR WIN]. Pass the merged import map
  via `--import-map`/env at spawn instead of writing `deno.json`s into the repo that a
  SIGKILLed dev leaves mangled until the next run "heals" them. Deletes both
  `withMergedConfig`'s artifact and `healLegacyLocalPins`.
- **`sprig init` scaffolds the blessed layout** [FORK, cross-repo]. Scaffold the
  preferred `bootstrap/` shell + the single consolidated `css-tokens.json` (§3.4)
  — today `init` produces the deprecated `src/shell/` and a token file the dev
  loop doesn't watch at all; once §3.4's consolidation lands, `dev.ts` watches
  `css-tokens.json` because it's the only token file, not because of a
  bolted-on second HMR branch. (Coordinated with rune's `init` overlay.)
- **Watched config files never silently no-op** [CLEAR WIN]. A `routes.json` edit
  either restarts the child or pushes a "routes changed; restart required" overlay
  notice — never silent-no-op-until-an-unrelated-restart.

### 3.6 Keep / serving / composition (spec 06)

> **The auth items below are INTERIM, not an open fork.** The user ruled
> (2026-07-18, `tooling/coms.md`; recorded in spec 06 [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md), restated in
> spec 09 [§5](../09-ecosystem-contracts/05-5-history-the-retired-cross-framework-record-legacy.md)): once the `Frontend` contract (spec 06 §1) lands, built-in auth is
> removed 100% and becomes a pluggable guard layer owned by neither sprig nor any
> backend. TODAY the `/auth` gateway and `auth.ts` client are still live, so the
> bullets below are DX polish on that live, soon-to-be-deleted surface — not a
> design fork on whether to keep and grow built-in auth; that question is already
> closed, in favor of removal.
>
> **Settled: DX-IDEAL invests only in the pure fail-loud/located-error
> discipline on the EXISTING surface, not in new auth mechanism.** The
> bullets below split into two kinds, not one: pure discipline bullets —
> **"Session mode is declared and fails loud on mismatch"** and **"Actionable
> auth errors"**, neither of which proposes new auth mechanism, only surfaces
> an existing failure mode loudly — and mechanism-adding bullets —
> **"Auth is opt-in; `infraUrl` is required when on"** (flips the default
> from auto-mount to opt-in and adds `auth: {infraUrl}` gating that doesn't
> exist today) and **"One auth story across all entry points"** (adds a new
> `auth` config slice to `sprigUi({ app, auth })`, which takes no such slice
> today). This document ships the two pure-discipline bullets — a real bug
> is worth surfacing loudly even on code with a deletion date, and they cost
> nothing once the pluggable-guard-layer target lands — and drops the two
> mechanism-adding bullets outright: building new auth config surface on a
> subsystem that's being deleted once the `Frontend` contract lands is the
> deeper investment the removal ruling argues against.

- **Auth is opt-in; `infraUrl` is required when on** [INTERIM — dropped:
  mechanism the removal ruling deletes]. `serveSprig({ keep })` mounts no
  `/auth/*` (or returns `501 "auth not configured"`); auth turns on with
  `serveSprig({ keep, auth: { infraUrl } })`. Today it silently mounts a
  gateway pointed at a baked-in `DEFAULT_INFRA_URL` (a stranger's infra) — a
  silent cross-org network dependency invisible at the call site. Today,
  MRG's own generated `serve.ts` is `serveSprig({ keep: api })` with NO
  infra argument at all — infra resolves via the `INFRA_URL` env var →
  `DEFAULT_INFRA_URL` (spec 05 §5's `writeRuneServe`, spec 06 §3), the same
  invisible-at-the-call-site path everyone else is on; nothing in the field
  passes `infraUrl` explicitly today. This is real mechanism — a default
  flip plus new `auth: {infraUrl}` gating that doesn't exist today — on a
  subsystem the removal ruling above deletes outright once the `Frontend`
  contract lands, so DX-IDEAL does not build it; the silent-mount problem
  stays as-is on the interim surface.
- **Session mode is declared and fails loud on mismatch** [INTERIM, CLEAR WIN — ship]. `auth: { mode:
  "session" }` throws at compose if the keep lacks session members
  ("requires a keep with sessions — KEEP_SESSION_KV not bound?"), instead of silently
  downgrading the whole app's auth channel from cookie to bearer with only an
  opt-in stderr trace. `mode:"auto"` stays the inferring default but warns on
  fallback.
- **Paths are validated at compose time** [CLEAR WIN]. `stat()` the derived
  `assetsDir`/`srcDir` at boot and fail with the resolved path
  (`assetsDir <path> is empty/missing — run the build or pass assetsDir`), instead
  of a blank page + N devtools 404s from an invisible derivation (and a hard throw
  when `entryRoot` is null for `jsr:`/`https:` entries). Extends the good instinct
  already used for `base === apiPrefix`.
- **The prebuilt-AST lookup gets the same `assetsDir` the rest of serving does**
  [CLEAR WIN]. `serveSprig` threads its per-request `assetsVersion` to the
  renderer but never threads `assetsDir` into `templates.json`'s lookup (spec 02
  [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)) — under the composed monorepo's git-root start task (cwd = git root, build
  output at `ui/static/` — spec 05 [§5](../05-cli-dev-hmr/05-5-sprig-build-rune-composition-emission.md)) the lookup MISSES its default
  (`<cwd>/static`) and prod SSR silently live-parses every template with
  tree-sitter at boot, a real perf cliff with no signal it's happening unless
  `SPRIG_ASSETS_DIR` happens to be set. Thread the resolved `assetsDir` through
  so the prebuilt ASTs are found automatically under the composed layout, and
  loud-warn at boot when a composed prod app falls back to live-parsing
  (`templates.json not found at <path> — SSR is live-parsing every template
  with tree-sitter; run the build or set SPRIG_ASSETS_DIR`) instead of leaving
  it a silent, undocumented gap.
- **Rename `keep` → `compose`** [FORK, cross-repo breaking change].
  `packages/keep/mod.ts` is *not* a keep — a keep is rune's backend, published as
  `@mrg-keystone/rune` (sprig retargeted from the abandoned `@mrg-keystone/keep`
  name — spec 09 [§5](../09-ecosystem-contracts/05-5-history-the-retired-cross-framework-record-legacy.md) Q2). One word now points at three things and the docs
  spend two paragraphs on "it is named after keep, it is not keep." The rename
  itself (`@mrg-keystone/sprig/compose`, keeping the `KeepApi` seam name and the
  `{keep, app}` argument) is the right target — but it is NOT a clean
  unilateral win: the public specifier `@mrg-keystone/sprig/keep` is a LOCKED
  cross-repo interface (spec 06, spec 09 [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md)) imported by rune's
  hand-maintained `SPRIG_IMPORTS` literal (`rune init`'s scaffolder) and by
  every already-generated `serve.ts` in the field (spec 09 [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md)'s
  scaffold-seam / version-pin duality — exactly the class of thing a refactor
  must not silently change). Landing it requires: (1) coordinating the new
  specifier into rune's `SPRIG_IMPORTS` in the same window, not after; (2) a
  deprecation cycle on the old `/keep` export — re-export it as a thin
  deprecated alias of `/compose` for at least one breaking-release window,
  with a dev-time warning, instead of deleting it outright, so existing
  generated `serve.ts` files and un-migrated rune scaffolds keep working
  through the transition; and (3) a `sprig migrate` codemod (§3.10) that
  rewrites the import specifier in app code. *Recommend: do the rename, on
  this coordinated timeline* — the naming collision is real and worth fixing,
  it just isn't a same-repo, same-release change.
- **One auth story across all entry points** [INTERIM — dropped: mechanism
  the removal ruling deletes]. `sprigUi({ app, auth })` accepts the same
  `auth` slice as `serveSprig`, mounting `sprigAuth` internally, so moving an
  app between `serveSprig` and `sprigUi` doesn't require rewiring auth from a
  different config vocabulary. Unlike the pure-discipline bullets above, this
  adds new auth config surface — dropped, per the header ruling above, since
  the surface it'd extend is slated for full removal.
- **One body-gateway policy** [CLEAR WIN]. "Too big" is `413` everywhere (not 413 on
  `/auth` but 400 on `/api`); content-type policy is consistent; differing caps
  (64 KB login vs 4 MiB API) stay only if documented — so one client mental model
  serves the whole origin.
- **sprigUi keeps the vendor guarantee** [FORK]. `sprigUi` serves the same `VENDOR`
  map (or 404s vendor paths with an explanatory body), so a chart that works under
  `serveSprig` doesn't silently 404 its `apexcharts` script under a Hono/Oak mount.
  *Recommend: serve the same `VENDOR` map* — matching `serveSprig`'s behavior
  exactly is what lets a component move between the two mounts with zero
  behavior change, which is the whole point of the guarantee; fall back to
  the explanatory 404 only where mounting vendor assets under a foreign host
  genuinely isn't feasible.
- **Actionable auth errors** [INTERIM, CLEAR WIN — ship]. An unparseable `/auth/login` body → `"request
  body is not valid JSON"`, not the misleading `"idToken required"` that sends the
  developer chasing a field that's plainly present.

### 3.7 Isolate workbench (spec 07)
> **The runner ideals here are largely MET by the `@mrg-keystone/cy-deno@0.2.0` swap
> (spec 07).** Replacing the npm-Playwright runner with the Deno-native cy-deno realizes
> three of the bullets below outright — the honest exit code, the test-events sequencing
> seam (retired entirely, not just fixed), and the self-healing/no-npm runner — and
> substantially advances a fourth, machine-readable faults (the `llm/` bundle), without
> fully closing it: the heal-rule mapping of cy-deno's new `no-specs`/`driver-unavailable`
> fault kinds onto `no-match`/`runner-unavailable` is still outstanding. The remaining
> bullets (quarantine-don't-blank, island case-data shape, the `display:contents` stage
> bug, token forwarding, cold-`run all` defense, less case ceremony, and that outstanding
> fault-kind mapping) are still open.

- **The test exit code is honest** [CLEAR WIN — **MET**]. Exit non-zero whenever
  `!report.ok`; a spec that fails to *load* is a failure, not a green run with a note in
  `error`. cy-deno's stable `report.ok`/exit-code contract (0 pass / 1 fail / 2 no-specs /
  3 driver-unavailable) counts a load failure as a failed test, so `!report.ok` ⇒ non-zero
  (spec 07 [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md)) — the old "exit 0 while a sibling spec is silently broken" (an agent fleet
  recording it green, the "receipt IS the state" contract broken) is closed.
- **One bad fixture quarantines, it doesn't blank the workbench** [CLEAR WIN]. Generate
  previews for every healthy entry, skip the broken one, and surface it in the
  navigator with a red badge + the exact `Problem` kind + `file:line`. Never let a
  trailing comma in component 41 cost you components 1–40 (and never hide the cause
  behind a `{}` fallback under `--force`).
- **Island case data uses one shape** [CLEAR WIN]. Bare case-JSON props reach an island
  (route them to signals for island targets) instead of silently seeding only the
  dock while the island renders its default — the most-used target type currently has
  the least discoverable data path, and the intuitive path silently no-ops.
- **The test-events seam can't be sequenced wrong** [CLEAR WIN — **MET by removal**].
  The original ideal was to ship a Playwright fixture (`test.extend`) wiring
  `exposeBinding` + hydration before navigation so `capture()`-must-precede-`goto()`
  couldn't be misused. cy-deno retires the seam outright: retry-able `cy.get().should()`
  waits on the DOM directly, so there is no `exposeBinding`/`waitHydrated` to pre-arm and
  no `__isolateReady`/`__isolateEmit` for a spec to race — the footgun can't be misused
  because it no longer exists (spec 07 [§5](../07-isolate-workbench/05-5-the-isolate-case-format.md); the stage-bridge keeps those globals only for
  the interactive `dev` dock).
- **The runner self-heals** [CLEAR WIN — **MET by removal**]. The original ideal was to
  make `ensureRunner` gate on the *artifact* and wipe-and-retry the npm/`~/.isolate-runner`
  install. cy-deno removes the thing that needed healing: no npm tree and no
  `~/.isolate-runner` — the runner is a `deno`-resolved JSR module + a webview/chrome
  driver, provisioned inside the same resolver as the rest of the build, so partial
  install / stale cache / wiped dir stop being a failure class (spec 07 [§1](../07-isolate-workbench/01-1-what-isolate-is-end-to-end.md) step 2, spec 10
  [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).6). `get-runner-status` still probes the artifact, now "cy-deno resolvable + driver
  usable" instead of `playwright --version`.
- **The stage never manufactures a false negative** [CLEAR WIN]. Fix the `.iso-stage-page`
  layout so a `display:contents` component can't collapse to width 0 (false
  `toBeVisible()` failures); keep a per-case width knob as an escape hatch, not the
  primary fix. A harness that fails good components on presentation is a credibility
  hole.
- **The workbench themes every app** [CLEAR WIN]. Forward the single
  `css-tokens.json` (§3.4's consolidation) instead of maintaining separate
  forwarding logic for a legacy file, so apps on the recommended path don't
  stage completely unthemed and send the developer chasing phantom style
  regressions.
- **Cold `run all` is defended** [CLEAR WIN]. Health-gate the preview server before each
  worker batch, auto-cap/shard workers, and classify a connection-refused as a
  bounded *infra* result kind (never counted in `failed`) — so the default action
  isn't the one that crashes and infra flakes don't masquerade as assertion failures.
- **Every fault slug resolves to a remediation** [CLEAR WIN — **advanced by cy-deno**].
  The heal-rules discipline stands (no slug is a dead end; the fault table still maps
  cy-deno's `no-specs`/`driver-unavailable` onto `no-match`/`runner-unavailable`, spec 07
  §3), and cy-deno adds a machine-readable fault surface beyond a single note: every
  failure carries the `llm/` bundle (failures-first `index.md`, per-command DOM deltas,
  per-command console, a repro command, near-miss locators, distilled DOM at failure — ~2
  KB per failing test) that the fixer/heal loop reads directly instead of decoding a
  screenshot (spec 07 [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md)/§3). Note `timeout` changes meaning under cy-deno (the in-process
  `run()` has no Playwright-spawn `AbortController`), so the old
  `ISOLATE_SPAWN_TIMEOUT_MS`/hung-`waitHydrated` remediation no longer applies as written.
- **Less case ceremony** [CLEAR WIN / FORK]. Accept `cases/<name>/case.json` (name
  inferred from the dir) instead of forcing `cases/<name>/<name>.json`; replace the
  `controls`-key-presence heuristic with an explicit discriminator so a control
  legitimately named `controls` can't silently vanish.

### 3.8 Install / skills / annotate (spec 08)
- **`init` works from zero, no install required first** [FORK]. Today the very
  first command a new machine can run — `deno run -A jsr:@mrg-keystone/sprig
  init` — can't even scaffold: `installRoot()` has no `import.meta.dirname` on
  a remote run and prints "run `sprig install`" and exits (spec 08 [§1](../08-install-skills-annotate/01-1-why-a-local-install-exists-at-all.md)), so the
  actual on-ramp is install → init, not init. The ideal makes `init`
  self-contained: an embedded scaffold (the text `sprig init` emits doesn't
  need the on-disk runtime, only the CLI module itself) that works from a bare
  `jsr:` run, then bootstraps the local `~/.sprig` runtime on the first
  `dev`/`build` that actually needs on-disk `node_modules`/grammar bytes — so
  `deno run -A jsr:@mrg-keystone/sprig init` scaffolds a project on a
  completely fresh machine in one command. Pair it with naming the
  four-channel distribution split (JSR publish set, GitHub runtime bundle,
  GitHub skills release, and the standalone `~/.isolate` channel — spec 08
  [§6](../08-install-skills-annotate/06-6-refactor-notes.md).2) as the install-simplicity target: fewer channels a new machine has to
  reason about is what makes "just run this" true end to end, not just true
  for `init`.
- **A manifest + `sprig doctor`/`--repair`** [CLEAR WIN]. Install writes a manifest
  (checksums of runtime files, the workbench parts, cy-deno resolvability + driver
  usability, launcher path, deployed skills/agents, channel + version); `sprig
  doctor` verifies it and names exactly what's missing/corrupt; `--repair`
  re-fetches only the missing pieces. Collapses today's N cryptic, misplaced
  failures (wiped `~/.sprig`, a stale/unresolvable cy-deno driver, missing install
  root) into one command that names and fixes.
- **`update` never silently destroys user edits** [CLEAR WIN / FORK]. Diff each managed
  entry against the shipped-hash manifest; back up any locally-changed file to
  `~/.claude/.sprig-overwritten/<ts>/` and print a one-line summary, instead of a
  silent `rm -rf`. Split runtime update from `~/.claude` deployment so a runtime fix
  doesn't re-clobber agent defs.
- **`annotate` is its own verb** [CLEAR WIN / FORK]. `sprig annotate <html>` for the
  throwaway prototype overlay; bare `sprig dev` stays BUILD mode — instead of an
  overloaded `--annotate` flag that silently *replaces* the server and changes where
  notes persist (component-keyed vs selector-keyed).
- **PATH + channel legibility** [CLEAR WIN / FORK]. Post-install, detect whether the
  bin dir is on `PATH` and print the exact `export` line; `sprig doctor` names which
  `isolate` is active (`~/.sprig` vs `~/.isolate`) and its version, so bare `isolate`
  and `sprig isolate` can't silently run different code.
- **`docs/guide.md` moves with the API too, and a real getting-started path
  exists** [CLEAR WIN]. Today `docs/guide.md` has NO isolate content at all
  (only a root README blurb — spec 07 §8), and both it and `cli/README.md`
  describe stale architecture (a Vite/Fresh-era description survives in
  `discovery.rune`'s TYP descriptions too — spec 07 §8, spec 10 §3) — exactly
  the "doc-reality drift" the release checklist (spec 10 §3) already treats as
  a discovery generator for everything ELSE. Extend that same discipline — any
  release changing a public runtime/compiler/CLI surface updates the matching
  docs in the SAME commit — to `docs/guide.md` explicitly, not just
  `claude/skills/*/references/*.md`, and fold it into the same publish-blocking
  lint (below). Pair it with an actual getting-started path in
  `docs/guide.md` (init → dev → first component → first island → `sprig
  isolate` → build/deploy, one command per step, each runnable as written) —
  today the closest thing to onboarding is `sprig init`'s scaffold output
  (§3.5) with no narrative connecting the steps; a human's first hour with
  sprig shouldn't be reverse-engineered from a scaffold.
- **Agent-fleet economics are structural, not prose** [FORK]. A `check:agent-def` lint
  (folded into the guardrail gate): every def must carry the guardrail block, a
  "missing input → blocked" clause, an explicit input list, and a pinned model unless
  whitelisted — moving "just know" into "the gate says." Land the planned
  publish-blocking surface-vs-docs lint so API/doc drift is caught mechanically
  instead of costing a fleet a 112-tool-call reverse-engineering episode. Make
  `detect.mjs` resolve deterministically (an env the installer sets) and Deno-native
  rather than a filesystem walk that contradicts "agents never search."
- **`.sprig-app.json` isn't a config-shaped trap** [CLEAR WIN]. Write the machine-only
  merged-config artifact to a gitignored cache dir, or at least `.gitignore` it and
  stamp `"_generated": "do not edit"`, so a contributor doesn't edit or commit
  machine-specific absolute paths.

### 3.9 Ecosystem / the diamond (spec 09)
> **AGREED (coms.md, 2026-07-18).** Four of the ideals below are no longer just
> [FORK]s — they are ratified cross-repo decisions in `tooling/coms.md` (the neutral
> `spec/`-artifact contract at the shared parent of both repos): (1) the **committed,
> hash-stamped `spec/contract/{openapi.json,client/}`** sprig reads (never generating
> it live, never invoking rune); (2) the **golden-vector `.git`-walk `specRoot`** —
> settled as shared fixtures, not a runtime cross-import, and *scoped* to the `.git`-walk
> resolver (rune's engine `resolveRoot`, spec-path-anchored, stays separate); (3) a
> **versioned, self-describing `spec/manifest.json`** with a `durable`/`merge`/`derived`
> classification + a `formatVersion` range both repos fail loud on; and (4) a **durable
> `spec/runes/`** — rune stops the `Deno.rename` that relocated the spec out of the shared
> tree. Spec 09 §[§2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md)–3 carry sprig's half as-built; the sub-bullets below are annotated
> where the negotiation settled them.
- **Every cross-repo seam detects drift by a hash/typed signal, not by a human
  remembering or a string match** [CLEAR WIN — the unifying move]. This one principle
  (the doc's own "receipt IS the state," applied uniformly) knocks out four separate
  footguns:
  - **The scaffolder pin** collapses to a single source: the installed sprig CLI emits
    the exact import block (`sprig imports`), and `rune init` pastes it — so rune's
    hand-bumped `SPRIG_IMPORTS` literal can't silently go stale (it already broke once
    at `^0.2.0`).
  - **Session capability** is a typed flag on `KeepApi` (`sessions: false | { read }`),
    not a match on keep's human-readable error string — so a cosmetic reword can't
    silently downgrade auth.
  - **The generated contract client** is stamped with the `openapi.json` hash it came
    from; `sprig:build` refuses/warns on mismatch — so a semantically-changed-but-
    structurally-compatible DTO can't ship a UI reading the wrong thing. **AGREED
    (coms.md, 2026-07-18):** both `openapi.json` and `client/` are now **committed
    `derived` files** the backend build emits + hash-stamps as an explicit step; sprig
    **reads** them and **fails loud** on mismatch with no rune backend present — no live
    cross-repo generation. The same
    generated client now powers both channels — `/api/*` for islands and the
    in-process `Backend` fetch for `resolve.ts` (§3.1) — one typed surface
    instead of two, instantiated per-channel with the matching base/prefix
    (§3.1) since the network channel is `/api`-prefixed-then-stripped and the
    in-process channel calls the keep's native paths directly.
  - **The `spec/` git-root walk** is one shared module (or shared golden-vector
    fixtures both repos run in CI), not two hand-kept-equal copies that can split-brain.
    **AGREED (coms.md, 2026-07-18):** settled on the **golden-vector fixture**
    (`spec/tests/spec-root-vectors.json`, both CIs run it) over a runtime cross-import,
    and **scoped** to the shared `.git`-walk resolver — collapsing sprig's two copies
    (`specRootOf` + `sprig:breakdown`'s `git rev-parse`) into one; rune's engine
    `resolveRoot` (spec-path-anchored, not a `.git` walk) is deliberately out of scope.
- **A diamond status/orchestrator** [FORK]. `diamond status` walks the artifact chain
  (draft ← prototype, runes ← draft, openapi ← backend, client ← openapi) by content
  hash and prints exactly which seam is stale and the one command that refreshes it —
  so building across three repos isn't a DAG driven from memory. `diamond doctor`
  preflights all three toolchains before `rune init` touches disk. The full `diamond`
  driver that spawns and wires both dev loops is the larger fork. **AGREED (coms.md,
  2026-07-18):** the "home repo" ownership question is settled — the composed app is its
  **own** git repo (neither rune nor sprig), and both `init`s are idempotent contributors
  that never hard-fail on the other's absence; so the remaining fork is only the driver's
  build, not who owns the tree.
- **Command semantics live at the point of choice** [CLEAR WIN]. The prototype host lints
  `commands.json` and documents, per `kind` (`create|set|append|adjust|remove`), what
  it seeds below the waist — so a dev doesn't pick `set` vs `adjust` blind and misbehave
  under concurrency far downstream.

### 3.10 Upgrading existing apps (`sprig migrate`)
- **A codemod per breaking change, plus dev-time deprecation diagnostics**
  [CLEAR WIN]. The ideal above lands ~6 breaking app-facing changes: the
  collapsed `render`/`renderStream`/`modules` → `renderer` path (§3.1), the
  mandatory `StateService` key (§3.1), the reshaped `Backend.get` union that
  breaks `r.data!` call sites (§3.1), `keep` → `compose` (§3.6), `initAuth()`
  replacing the auth side-effect import (§3.1) — INTERIM: this codemod's
  target, `auth.ts`/`seedTokenFromUrl`, is itself slated for full removal once
  the `Frontend` contract lands (§3.6), so the codemod is a throwaway bridge
  for apps upgrading before that removal ships, not a permanent part of the
  migration surface — and, if the one-form fork
  (§3.3) is taken, the class-form island deprecation. The guard-proceed
  sentinel (§3.1) is deliberately NOT on this list: it's additive/back-compat
  (the old value-comparison path keeps working), so no existing guard breaks
  on upgrade. Shipping any one of these ~6 without an upgrade path punishes
  every existing app the moment it upgrades the framework — the same silence
  this whole document exists to remove, just relocated to install time. `sprig
  migrate [--dry-run]` ships ONE codemod per breaking change: rewrite
  `config.render`/`renderStream`/`modules` call sites onto `renderer`; add a
  static `key` to every undecorated `StateService` subclass (named from the
  class, flagged for review, never silently guessed); rewrite `r.data!`/bare
  `if (r.ok)` call sites onto the discriminated union; rewrite
  `@mrg-keystone/sprig/keep` imports to `/compose`; wrap a bare auth-module
  import with `initAuth()`; and, once §3.3's form fork lands, rewrite
  class-form islands onto the functional `{setup}` form
  (trigger/snapshot/resolve moved onto the setup return), flagging any hook
  with no functional equivalent for manual review instead of guessing one.
  Alongside the codemods, `sprig migrate` also flags `[]`-as-redirect guard
  returns for manual review — an ADVISORY lint, not a codemod: the old return
  value still works, and whether a given `[]` means "redirect to root on
  purpose" or the `[] ≡ redirect` trap is a semantic judgment call no
  automated rewrite can make safely. Each codemod is
  idempotent and reports a `file:line` diff — never a silent rewrite. Paired
  with **dev-time deprecation diagnostics** — the [§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md) diagnostics layer aimed at
  soon-to-break constructs (`r.data!` on a non-narrowed `Backend.get` result, a
  `StateService` subclass with no static `key`, an import of the old `/keep`
  specifier) — so an app running the new framework against un-migrated code gets
  a located dev warning, not a surprise prod break. This is the "upgrading"
  phase of the developer journey the rest of this document otherwise skips:
  §3.8 covers runtime/install repair (`sprig doctor`/`--repair`), not app-code
  migration — `sprig migrate` is app code's equivalent.

### 3.11 Testing app logic (browserless)
- **A `@mrg-keystone/sprig/testing` module for unit-testing server logic** [FORK].
  Every "testing" ideal named so far (§3.7's isolate workbench, the harness hooks
  in [§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).3/§3.3) is the VISUAL workbench — now the Deno-native cy-deno runner (§3.7,
  spec 07), in-browser, testing a rendered COMPONENT or PAGE. There is no story for
  unit-testing a plain `resolve.ts`, a guard, a
  `StateService` subclass, a service, or a pipe in `deno test`. sprig's
  ambient-injector architecture makes this hard to hand-roll: `inject()`
  resolves off a module-level `current` injector that only exists inside
  `runInInjector(...)` (spec 01 [§2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md)), and guards/resolve run on a request-scoped
  child injector with `Backend` bound per request by the host (spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md),
  spec 09 [§1](../09-ecosystem-contracts/01-1-the-composition-seam.md)) — wiring all of that up by hand for a five-line guard test is
  real ceremony, and today nothing ships to remove it. The ideal adds a small,
  explicit testing surface: `testInjector({ providers })` builds an
  `Injector("server","route")` pre-populated with whatever the test provides
  (a mock `Backend`, a stubbed service) so `inject()` resolves inside the test
  the same way it does inside a real request; a mock `Backend` provider
  implementing the real `BackendClient` shape (`{ fetch, get<T> }`, spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md))
  so a `resolve.ts` under test never touches the network; `runGuard(guard,
  ctx)` runs a guard function inside `runInInjector` against a caller-built
  `GuardCtx`; `renderComponentToString(def, { inputs })` renders a component
  through the real server interpreter (spec 02) without a browser, so a pipe or
  template binding can be asserted on the returned HTML string; and a
  `SessionProfile`/`GuardCtx`/`RouteCtx` builder so a guard or `onServerLoad`
  test doesn't hand-assemble those shapes field-by-field. This is deliberately
  the BROWSERLESS complement to §3.7's cy-deno runner, not a replacement — the two
  split cleanly by axis and neither conflates with the other: cy-deno tests a rendered
  **component/page** in a real browser (DOM/hydration/visual, `*.cy.ts`), this module
  unit-tests **logic** (a `resolve.ts`, a guard, a service, a pipe) in `deno test` with
  no browser. An app dev or an agent-fleet validator gets a `deno test`-speed loop for the
  logic that currently has none, and reaches for the isolate workbench only when a test
  actually needs a rendered DOM/hydration/visual assertion. *Recommend: ship
  the module scoped to exactly these five primitives* — `testInjector`, the
  mock `Backend`, `runGuard`, `renderComponentToString`, and the ctx builders —
  the fork is on how much further to grow it (a full component-hydration-in-
  `deno test` story is a much bigger investment than unit-testing server
  logic, and isn't what this gap is asking for).

