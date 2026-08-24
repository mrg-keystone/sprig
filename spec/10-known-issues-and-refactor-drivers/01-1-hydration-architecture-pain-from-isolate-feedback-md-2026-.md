## 1. Framework-core pains from isolate-feedback.md (2026-07-11)

These were real production-class bugs in the framework core. The numbered production bugs
are FIXED on `develop`, except the parked/known-holdout items in §1.4 and §1.6; each still
exposes a design tension. This section is a refactor DRIVER, not a fix log: it
names each pain and hands off — mechanism to the owning subsystem spec, resolution to
DX-IDEAL — it does not re-derive either.

### 1.1 Late-appearing islands (BUG 1 — fixed, but the design lesson stands)
- **Pain:** `hydrate.ts` scanned `sprig-island` hosts exactly once at bootstrap; the client
  re-render assumed nested islands were already live; `componentsForPage` only resolved
  islands whose chunk had already loaded. Net: any island first appearing *after* the
  bootstrap scan (data-driven nested islands, client-fetched content) was inert — island
  discovery, chunk loading, and morphing are three separately patched mechanisms that must
  agree, a scan + rescue-passes model, not one owned lifecycle. Known remaining limitation
  (unfixed, by design): morph PINS live child hosts, so a data-driven *removal* of a nested
  island leaves the stale child in the DOM.
- **Mechanism (→ subsystem spec):** now in-tree — `build.ts` generates an eager
  `registerIslandSelectors` (every island selector→scope known before chunks load);
  `render.ts` client child-island shells carry parent-computed inputs (+ mocks) as a props
  bridge; `hydrate.ts` `rescanIslands(el)` after every island effect render. Owning spec:
  03-islands [§2](../03-islands-and-hydration/02-2-the-ssr-client-props-contract.md)/[§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)/[§5](../03-islands-and-hydration/05-5-reactive-update-model.md)/[§6](../03-islands-and-hydration/06-6-nested-islands-the-zz-contracts.md).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).3 ("One owned lifecycle
  state machine") replaces scan + rescue with a single subsystem owning six explicit states.
- **Status:** fixed (BUG 1); known-holdout (morph-pin removal; the lifecycle-machine
  redesign itself).

### 1.2 Selector ambiguity poisoned the dev AST (fixed)
- **Pain:** `astFor(<bare selector>)` returned the FIRST-registered def; a page and its
  page-local island sharing a basename (`pages/workbench` + `components/workbench`) made
  the dev AST endpoint serve the PAGE template to the ISLAND chunk → self-nesting
  recursion / dead UI. Component identity is the *folder path*, but several registries
  still key by bare selector.
- **Mechanism (→ subsystem spec):** fixed via `findIslandBySelector`. Owning spec: spec 02
  §5 (`mod.ts` — registry, page assembly, renderer).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).2 ("Component-tag
  resolution is loud on miss") + this spec's own [§4](04-4-structural-tensions-a-refactor-should-resolve.md)'s
  "Selector-keyed registries vs folder-path identity" tension —
  carry the full identity end-to-end and make bare-selector lookup impossible where kind
  (page vs island) matters.
- **Status:** fixed (this bug); known-holdout (the underlying bare-selector registries).

### 1.3 daisyUI unscoped-class collisions (fixed by rename, not by design)
- **Pain:** `buildCss` runs every app through `@plugin "daisyui"`, which emits UNSCOPED
  component CSS for any class name appearing in sources; the workbench shell's
  `dock`/`badge`/`kbd`/`toast` collided. View encapsulation covers component styles but the
  Tailwind/daisyUI layer runs globally — a documented hole for framework-emitted utility
  CSS.
- **Mechanism (→ subsystem spec):** fixed by renaming shell classes (`wb-dock`, …), not by
  design. Owning spec: spec 02 §6 (`scope.ts`'s attribute view-encapsulation, `[sX]`).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).2 ("Framework-emitted
  utility CSS is namespaced").
- **Status:** fixed (this collision, by rename); known-holdout (the scoping hole itself).

### 1.4 IPv4/IPv6 binding (BUG 2 — fixed for the server bind; the `--open` URL is a known holdout)
- **Pain:** `deno serve` bound 0.0.0.0 (IPv4-only) while printed URLs said `localhost` →
  Chromium/Node resolve `localhost`→`::1` first → every request 404'd. `sprig dev --open`
  (spec 05 [§4](../05-cli-dev-hmr/04-4-sprig-dev-the-three-layer-architecture.md)) still pops the app+annotate URL as
  `http://localhost:<appPort><base>` — the highest-visibility surface re-arms the exact bug
  this section documents.
- **Mechanism (→ subsystem spec):** the listener/print path is fixed: tooling binds and
  prints `127.0.0.1` explicitly. Owning spec: spec 05 (CLI, dev loop, HMR).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).5 ("Honest CLI verbs")
  calls for `--open` to print `127.0.0.1`; that fix has not landed. Refactor rule: never
  emit `localhost` in tool output or generated configs.
- **Status:** fixed (server bind); known-holdout (`--open` URL).

### 1.5 Test-events contract had no producer (BUG 3 — fixed)
- **Pain:** the `isolate-events` helpers (`capture()`, `waitHydrated()`) depended on
  `__isolateReady`/`__isolateEmit` that NOTHING produced — cross-frame test contracts need
  a named producer/consumer table in the spec, or they silently rot.
- **Mechanism (→ subsystem spec):** now the stage-bridge (`preview-harness.ts`) is the
  single producer per context; the shell mirrors into the main frame. Owning spec: spec 07
  §4 (the workbench UI).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7 ("The test-events
  seam can't be sequenced wrong — MET") — cy-deno retires the seam outright, so there is no
  `exposeBinding`/`waitHydrated` left to sequence wrong.
- **Status:** fixed.

### 1.6 Operational fragility (unfixed, parked)
- **Pain:** cold full-suite runs (330 cases × 3 workers) crashed the workbench
  (`ERR_CONNECTION_REFUSED`); `.iso-stage-page` centering collapses `display:contents`
  components to width 0 in isolation (`toBeVisible()` false-negatives); the checked-in
  `app/static/` prebuilt workbench bundle goes STALE relative to `app/src` fixes and
  releases must regenerate it (manual step — no automation); `ensureRunner`'s npm install
  can leave `.bin/playwright` missing, and `~/.sprig` installs have been observed wiped
  between sessions in sandboxes.
- **Mechanism (→ subsystem spec):** the cold-crash source report blamed "building chunks
  on demand", but no such mechanism exists in this tree — the workbench build is one
  up-front in-process `buildClient` before serving (spec 07 §1), and the dev server
  rebuilds only on file-watch events (dev.ts), never per request — so that attribution is
  stale and the crash's root cause is NOT established (parked as such in
  `isolate-feedback.md`); today's mitigation is warming pages + modest worker counts.
  Owning spec: spec 07 (isolate workbench).
- **Resolution (→ DX-IDEAL):** [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7 covers the cold-run
  crash ("Cold `run all` is defended") and the stage-width bug ("The stage never
  manufactures a false negative", candidate fix: opt-in per-case stage width in
  `fixture.json`); [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).4 ("Stale artifacts are eliminated or
  caught, not shipped silently") covers the checked-in `app/static/` drift; the
  `ensureRunner` npm install is resolved by the spec 07 §2 runner swap to the Deno-native
  `@mrg-keystone/cy-deno@0.2.0`, carried by [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7 ("The
  runner self-heals").
- **Status:** parked (cold-full-suite root cause); known-holdout (`.iso-stage-page` width,
  checked-in static staleness); fixed (`ensureRunner` npm install, via the cy-deno runner
  swap).

