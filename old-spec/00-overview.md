# 00 — Overview: what this project is

> Ground truth for this spec set: the working tree at
> `~/Documents/programming/tooling/sprig/main`, version `0.20.36-beta.1`
> (`@mrg-keystone/sprig` on JSR), read July 2026. Every numbered spec cites
> `file:line` anchors into that tree.

## One paragraph

**sprig** is a folder-component web framework for Deno: Angular-flavoured templates
compiled via a tree-sitter grammar, rendered to HTML on the server, with **selective
island hydration** (only folders with a `logic.ts` ship JS, one code-split chunk per
island, loaded on a trigger), view-encapsulated CSS, request-scoped dependency
injection, no Vite, a state-preserving HMR dev loop, and a single `{ fetch }` handler
from dev through Deno Deploy. The same repo also contains **isolate** — a
Storybook-style component-testing workbench for sprig apps (itself built ON sprig) —
and the **Claude agent toolchain** (skills + subagent defs) that sprig deploys to
`~/.claude` on install, because the framework is explicitly designed to be driven by
agent fleets.

## The three products in this repo

| product | code | ships via |
|---|---|---|
| the sprig framework | `framework/cli.ts`, `framework/.sprig/**`, `packages/keep/mod.ts` | JSR (`@mrg-keystone/sprig`) + the GitHub `runtime-latest` bundle → `~/.sprig` |
| the isolate workbench | `cli/`, `server/`, `app/`, root `serve.ts`/`serve-dev.ts` | inside the runtime bundle (NOT on JSR) |
| the agent toolchain | `claude/skills/**`, `claude/agents/**` | copied to `~/.claude/*` by `sprig install`/`update` |

Plus: `docs/` (user guide), `fixtures/` (test/eval apps), `rnd/proto` (the two-seam
prototype host), `scripts/` (sync tools), coordination docs at the root
(`coms.md`, `coordinate.md`, `contract.md`) and feedback/optimization briefs
(`optimize.md`, `isolate-feedback.md`, `feedback/`).

## The mental model (request path)

```
request → serveSprig (keep composition, one origin)
  /api/*  → keep network handler (token-gated, prefix stripped)
  /docs*  → keep Swagger UI
  /auth/* → session gateway (httpOnly cookie)
  <base>/_assets/* → built static files (ETag / immutable-by-content-address)
  <base>/*         → the sprig SSR app:
      match route → guards (parent-first) → grants → resolve.ts (DI, in-process
      Backend) → renderer (page → layouts → shell) → HTML with island hosts
→ browser: client.js boots → each <sprig-island> hydrates its logic.ts on its
  trigger → signals re-render islands (string render + DOM morph) → soft-nav swaps
  <sprig-outlet> levels on same-origin navigation
```

## Repo map

```
framework/
  cli.ts                 # the `sprig` CLI (init/dev/build/serve/isolate/install/…)  → spec 05
  .sprig/                # (hidden dir!) the framework runtime
    core.ts              # signals, DI, routing, bootstrap().fetch — THE public API  → spec 01
    auth.ts              # httpOnly-cookie auth client                               → spec 01 §6
    spec-root.ts         # the git-root spec/ walk                                   → spec 09 §2
    install.ts skills.ts annotate.ts annotate-client.js                              → spec 08
    compiler/
      parse.ts node.ts expr.ts render.ts serialize.ts scope.ts mod.ts
      hash.ts lifecycle.ts perf.ts island-infer.ts                                   → spec 02
      island.ts hydrate.ts                                                           → spec 03
      build.ts                                                                       → spec 04
      dev.ts hmr.ts                                                                  → spec 05 §6
      grammar.bin        # tree-sitter wasm bytes (renamed — JSR rewrites .wasm)     → spec 02 §1
      *.test.ts          # ~60 unit tests pinning behavior
packages/keep/mod.ts     # serveSprig/sprigUi — the one-origin composition root      → spec 06
tree-sitter-angular-template/  # grammar source → grammar.bin                        → spec 02 §1
cli/ server/ app/        # the isolate workbench                                     → spec 07
claude/                  # skills + agents deployed on install                       → spec 08 §2
docs/guide.md            # the user-facing framework guide (framework only)
fixtures/                # sprig-app, guarded-app, auth, bullshit-app (audit eval),
                         # eval-app (breakdown golden), eval/ (gates) — no spec owns
                         # this dir; the isolate CASE format inside them is spec 07 §5
rnd/proto/               # the two-seam prototype host                               → spec 09 §3
coms.md coordinate.md contract.md   # rune⇄sprig contracts                           → spec 09
optimize.md isolate-feedback.md feedback/   # refactor drivers                       → spec 10
```

## Core concepts (glossary)

- **Folder-component**: a folder with `template.html` (required) + optional
  `styles.css` (scoped), `logic.ts` (⇒ island), `resolve.ts` (pages only, server data
  loader). Identity = folder path; selector = folder basename.
- **Page**: folder directly under `pages/`. Pages and islands are unified — a page's
  own `logic.ts` may carry a browser hook and hydrate exactly like any other island
  (`assertStaticPage` is a build-time no-op kept only so old call sites resolve, spec
  04 §1). Page-local components (`pages/<p>/components/<n>/`) shadow same-named
  globals within that page.
- **Island**: component with `logic.ts`; hydrates on trigger
  (`load|idle|visible|interaction`); ships as `isl.<sel>.js`; props cross SSR→client
  as a JSON script bridge inside `<sprig-island>`.
- **Shell**: the persistent document layout containing the outermost `<sprig-outlet
  data-level>` — the same element type that Layout routes nest, so the shell's outlet
  is the top (outer) link in the soft-nav diff chain, not a separate mechanism. With a
  `bootstrap/template.html` shell its raw `<head>` is injected verbatim; a scanned
  `src/shell/` component (the scaffold's form) is body-only and gets the framework
  default head (spec 02 §5).
- **Layout route**: a folder-component whose path starts with `routers/` — wraps
  children in its own outlet; matched routes produce a `chain` (outer→inner) that
  soft-nav diffs by `<sprig-outlet data-level>` (spec 01).
- **grants**: parent-first collected `requiredGrant` strings on matched routes,
  verified in bootstrap after guards and before resolve via `config.verifyGrant`; an
  absent `verifyGrant` skips the check entirely and the route renders unverified
  (spec 01 §3).
- **resolve**: server-only data loader run in the request injector, called with
  `{params, url}` as its only arguments (no session — deliberate leak-surface design);
  it may still reach the in-process `Backend` through ambient `inject()`, since it runs
  inside the same request injector guards/grants share — only *session* is withheld
  from resolve, not DI.
- **keep**: the rune-generated Deno backend framework, published as
  `@mrg-keystone/rune` (sprig retargeted from the abandoned `@mrg-keystone/keep`
  name — spec 09 §5 Q2; rune is the separate generator tool — see "rune side" /
  rune⇄sprig contracts below, not a package sprig imports). sprig consumes keep via
  the `KeepApi` `{backend, handler}` seam — in-process for SSR, token-gated `/api/*`
  for islands ("token-gated" = keep's deny-by-default credential guard; the
  credential is the httpOnly session cookie in session mode, a client-held bearer in
  legacy mode — spec 06 §4). Not to be confused with `packages/keep/mod.ts` in this
  repo: that's sprig's own composition-root module (ships under `@mrg-keystone/sprig`,
  spec 06) that wires up a `KeepApi` instance — it is named after keep, it is not
  keep.
- **The diamond**: the product pipeline — prototype/design (sprig side) and
  spec/data/build (rune side) converging on one queries+commands contract and one
  composed app (`serveSprig({keep, app})`).
- **isolate case**: `<component>/isolate/fixture.json` + `cases/<n>/<n>.json` +
  a co-located `<component>/*.cy.ts` (Cypress spec run by the Deno-native
  `@mrg-keystone/cy-deno`, ≥1 required per component/page) — the workbench's
  preview/test unit.

## The invariants that define the system (full versions in each spec)

1. **One runtime copy per document.** DI/registry identity breaks with two — defended
   at build (`assertSingleRuntime`), config (forced import map, workspace hoisting),
   and runtime (one-shot recovery reload). (specs 01 §7, 04, 03 §8)
2. **DI never crosses the wire.** `Backend` is server-scoped; islands get data as
   serialized inputs or fetch `/api/*`. `inject()` is synchronous-only. (spec 01)
3. **Escape/entity discipline** in render: author text trusted, runtime values
   escaped, entity decode single-pass and non-throwing. (spec 02 §4)
4. **The dev bundle IS the prod bundle** — byte-identical; dev behavior comes from
   data flags (`cfg.hmr`) and env (`SPRIG_DEV`, `SPRIG_ASSETS_DIR`). (specs 04, 05)
5. **Content-addressed caching**: `?v=` = hash of served assets; `immutable` only for
   content-addressed requests. (specs 04 §4, 06 §5)
6. **Parent re-renders never destroy live child islands** (pin + shell + rescan);
   hydration order setup → snapshot → sync restoreState → paint → browser hook.
   (spec 03)
7. **The scaffold and the `KeepApi`/`spec/` contracts are cross-repo interfaces** with
   rune — locked in coms.md/coordinate.md/contract.md. (spec 09)
8. **Agent-fleet economics are a design constraint**: docs move with the API in the
   same commit; agent defs carry synced guardrails; JSON stdout is exactly one
   document. (specs 08, 10 §2)

## How to verify claims in these specs

```bash
deno test -A framework/.sprig/compiler/compiler.test.ts   # framework unit tests
deno test -A framework/.sprig/*.test.ts                   # core runtime tests
deno test -A packages/keep/*.test.ts                      # composition tests
deno test -A app/spine.test.ts                            # workbench SSR/API spine
deno check cli/main.ts
```
