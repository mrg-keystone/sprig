# 10 — Known issues, tensions, and refactor drivers

> Sources: `isolate-feedback.md`, `optimize.md`, `feedback/plan.md`,
> `feedback/fleet-token-burn/BUG-REPORT.md`, `README.md` (release checklist), and the
> resolution notes embedded in those docs. Each item below is evidence-backed in its source
> doc; items marked FIXED are kept here because they reveal *structural* weak points a
> refactor should design out, not just patch.

## 1. Hydration architecture pain (from `isolate-feedback.md`, 2026-07-11)

These were real production-class bugs in the framework core. All are FIXED on `develop`,
but each exposes a design tension:

### 1.1 Late-appearing islands (BUG 1 — fixed, but the design lesson stands)
- **Was:** `hydrate.ts` scanned `sprig-island` hosts exactly once at bootstrap; the client
  re-render assumed nested islands were already live; `componentsForPage` only resolved
  islands whose chunk had already loaded. Net: any island first appearing *after* the
  bootstrap scan (data-driven nested islands, client-fetched content) was inert.
- **Fix shape (now in-tree):** `build.ts` generates an eager
  `registerIslandSelectors` (every island selector→scope known before chunks load);
  `render.ts` client child-island shells carry parent-computed inputs (+ mocks) as a
  props bridge; `hydrate.ts` `rescanIslands(el)` after every island effect render.
- **Known remaining limitation (unfixed, by design):** morph PINS live child hosts —
  a data-driven *removal* of a nested island leaves the stale child in the DOM.
- **Refactor lesson:** island discovery, chunk loading, and morphing are three separately
  patched mechanisms that must agree; a refactor should make "island lifecycle" one owned
  subsystem with an explicit state machine (registered → armed → loaded → hydrated →
  released) instead of scan + rescue passes.

### 1.2 Selector ambiguity poisoned the dev AST (fixed)
- `astFor(<bare selector>)` returned the FIRST-registered def; a page and its page-local
  island sharing a basename (`pages/workbench` + `components/workbench`) made the dev AST
  endpoint serve the PAGE template to the ISLAND chunk → self-nesting recursion / dead UI.
  Fixed via `findIslandBySelector`.
- **Refactor lesson:** component identity is the *folder path*, but several registries
  still key by bare selector. Any refactor should carry the full identity end-to-end and
  make bare-selector lookup impossible where kind (page vs island) matters.

### 1.3 daisyUI unscoped-class collisions (fixed by rename, not by design)
- `buildCss` runs every app through `@plugin "daisyui"`, which emits UNSCOPED component CSS
  for any class name appearing in sources; the workbench shell's `dock`/`badge`/`kbd`/
  `toast` collided. Fixed by renaming shell classes (`wb-dock`, …).
- **Refactor lesson:** view encapsulation covers component styles but the Tailwind/daisyUI
  layer runs globally. The scoping story has a documented hole for framework-emitted
  utility CSS.

### 1.4 IPv4/IPv6 binding (BUG 2 — fixed for the server bind; the `--open` URL is a known holdout)
- `deno serve` bound 0.0.0.0 (IPv4-only) while printed URLs said `localhost` → Chromium/
  Node resolve `localhost`→`::1` first → every request 404'd. The listener/print path is
  fixed: tooling binds and prints `127.0.0.1` explicitly.
- **Known remaining instance (unfixed):** `sprig dev --open` (spec 05 §4) still pops the
  app+annotate URL as `http://localhost:<appPort><base>` — the highest-visibility surface
  re-arms the exact bug this section documents. DX-IDEAL §3.5 ("Honest CLI verbs") calls
  for `--open` to print `127.0.0.1`; that fix has not landed.
- **Refactor rule:** never emit `localhost` in tool output or generated configs.

### 1.5 Test-events contract had no producer (BUG 3 — fixed)
- The `isolate-events` helpers (`capture()`, `waitHydrated()`) depended on
  `__isolateReady`/`__isolateEmit` that NOTHING produced. Now the stage-bridge
  (`preview-harness.ts`) is the single producer per context; the shell mirrors into the
  main frame.
- **Refactor lesson:** cross-frame test contracts need a named producer/consumer table in
  the spec, or they silently rot.

### 1.6 Operational fragility (unfixed, parked)
- Cold full-suite runs (330 cases × 3 workers) crashed the workbench
  (`ERR_CONNECTION_REFUSED`). The source report blamed "building chunks on demand", but
  no such mechanism exists in this tree — the workbench build is one up-front in-process
  `buildClient` before serving (spec 07 §1), and the dev server rebuilds only on
  file-watch events (dev.ts), never per request — so that attribution is stale and the
  crash's root cause is NOT established (parked as such in `isolate-feedback.md`).
  Mitigation is warming pages + modest worker counts.
- `.iso-stage-page` centering collapses `display:contents` components to width 0 in
  isolation (`toBeVisible()` false-negatives). Candidate fix: opt-in per-case stage width
  in `fixture.json`.
- The checked-in `app/static/` prebuilt workbench bundle goes STALE relative to `app/src`
  fixes; releases must regenerate it (manual step — no automation).
- `ensureRunner`'s npm install can leave `.bin/playwright` missing; `~/.sprig` installs
  have been observed wiped between sessions in sandboxes. **Resolved by the spec 07 runner
  swap** to the Deno-native `@mrg-keystone/cy-deno@0.2.0`: there is no npm tree and no
  `~/.isolate-runner` to half-install or get wiped — provisioning is a `deno`-resolvable
  JSR module + a webview/chrome driver, and the runner executes in-process (`import { run
  }`, spec 07 §2). The cold full-suite `ERR_CONNECTION_REFUSED` above loses its
  npm-Playwright-spawn surface too (its root cause stays unestablished; the health-gated
  preview server remains the mitigation).
  - **Refactor lesson (survives the swap):** a runner that provisions an out-of-band native
    toolchain (npm + a browser download into `~/.isolate-runner`) owns a whole failure
    class — partial install, stale cache, wiped dir — that a dependency-resolved,
    Deno-native runner simply doesn't have; keep the test toolchain inside the same
    resolver the rest of the build already trusts.

## 2. Agent-fleet economics (from `optimize.md` + `feedback/`)

The repo is explicitly designed to be **driven by Claude agent fleets** (the `claude/`
skills+agents are deployed on `sprig install`). Forensic analysis of ~116K API requests
found fleets wasting most spend on: filesystem discovery, broadcast megaprompts, per-test
validator explosions, rate-limit retry storms, and poll-sleeping orchestrators. A 40-agent
`sprig:build` fleet paid **608M input tokens** for 1.49M output.

Standing principles now embedded across `claude/` (must survive a refactor of those
assets):
1. Brief completely — agents never search; missing path → `blocked`, never hunt.
2. Facts inline (≤8 lines), bulk behind on-disk artifacts structured for partial reads.
3. Verified recipes (lifted from passing fixtures) in high-volume agent defs.
4. Receipt verification — a tool's own printed/JSON output IS the state; never re-verify.
5. Orchestrators end turn after spawning; never sleep-poll; never search the filesystem.
6. Concurrency 4–6, chunked waves, one PORT per agent.
7. Model pins on fleet roles (never `inherit` except deliberate judgment/creative roles).
8. Accuracy outranks tightness — never suppress a search without a more authoritative
   replacement; doc-reality drift is a discovery *generator*.

Direct product consequences already shipped (see `feedback/plan.md`):
- `cli/lib/json-stdout.ts` — first-import console guard so `--json` stdout is exactly one
  JSON document (import-time boot logs go to stderr).
- Headless test dialect + `ran:false` tripwire. Verified on disk (2026-07-16):
  `--failures-only` (B2) LANDED — `cli/commands/test.ts` (keeps full counts, drops
  passing testResults; spec 07 §2). The pixel-diff endpoint (B3) did NOT land — the
  testing module's only endpoints are `post-test-run` + `get-runner-status`
  (`server/src/testing/entrypoints/http/mod.ts`), and discovery adds only
  `get-discovery` + `get-manifest`.
- The guardrail blocks in every agent def between
  `<!-- BEGIN sprig-agent-guardrail -->…<!-- END -->` are AUTO-SYNCED from
  `scripts/agent-guardrail.md` via `deno task sync:agent-guardrail` — **never hand-edit
  inside the markers**; `deno task check:agent-guardrail` gates it.

## 3. Docs-move-with-the-API release discipline (from `README.md`)

A measured failure: releasing `0.20.29` with an undocumented `ResolveCtx` sent build
fleets reverse-engineering the Deno cache (112 tool calls). The release checklist is now:

1. If a release changes any public runtime/compiler surface (`core.ts` exported types,
   template semantics, the isolate CLI's flags or report shape), the SAME commit must
   update the matching `claude/skills/*/references/*.md` and agent defs.
2. Run framework + runner tests and `deno check cli/main.ts`.
3. Spot-check `claude/skills/sprig:build/references/` examples still typecheck.

A refactor should consider making this mechanical (a publish-blocking lint comparing
`core.ts` public-surface changes against same-commit `claude/skills/**` changes — planned
as C1 in `feedback/plan.md`).

## 4. Structural tensions a refactor should resolve

1. **Two projects in one repo.** The framework (`framework/`, `packages/keep/`) and the
   isolate workbench (`cli/`, `server/`, `app/`) share one repo, one `deno.json` workspace,
   and one version number, but have different release cadences and consumers. The README
   itself has to explain the split in a footnote.
2. **The `.sprig` hidden directory.** The entire framework lives under
   `framework/.sprig/` (hidden), which defeats default file listings/rg and confuses
   tooling; the name exists so app scaffolds can vendor it, but it makes the framework
   source itself hard to discover.
3. **`grammar.bin` vs `.wasm`.** The tree-sitter grammar ships as `grammar.bin` because
   JSR rewrites `.wasm` imports. A refactor that touches packaging must preserve this or
   solve it properly.
4. **Dual scaffolder pins.** rune's `SPRIG_IMPORTS` literal must be bumped on breaking
   sprig releases; sprig's own scaffold pin is auto-derived from the installed CLI
   (`init` pins EXACT `cliVersion()`, `sprigRange()` fallback — spec 05 §1; no
   `SPRIG_RANGE` constant remains), so only rune's side can silently go stale (it
   already broke once at `^0.2.0`, when sprig's side was still a frozen literal).
5. **Prebuilt artifacts checked into git.** `app/static/`, `fixtures/*/static/` are built
   outputs committed to the repo and drift from source (bit the team once — §1.6).
6. **Selector-keyed registries** (§1.2) vs folder-path identity.
7. **The one-shot hydration model** grew rescue mechanisms (rescan, props bridge, eager
   selector registry) — candidates to be first-class in a redesign.
8. **Spec-root anchoring** (`coordinate.md`): CLOSED — the sprig-side `specRootOf()`
   walk is implemented (`framework/.sprig/spec-root.ts`) and wired through
   `framework/cli.ts:1666` into annotate. The remaining obligation is keeping it
   byte-compatible with rune's identical walk.
