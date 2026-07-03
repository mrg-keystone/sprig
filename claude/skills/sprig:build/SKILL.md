---
name: "sprig:build"
description: >-
  Expert guidance for building web apps with sprig — a Deno SSR framework with
  Angular-flavored HTML templates and selective island hydration, published on JSR as
  @sprig/core. Use this whenever the user is scaffolding, building, or modifying a sprig
  app: adding pages or components, islands (interactive components), wiring data with a
  page's logic.ts class or resolve, routes, route guards (auth redirects), persisted state,
  dependency injection, or
  previewing/testing a component in isolation with `sprig isolate`; or when working in a
  repo with sprig markers (a deno.json importing "jsr:@sprig/core", folder-components made
  of template.html + optional logic.ts, a src/ tree with pages/ + a shell, or main.ts
  calling bootstrap()/createRenderer()). sprig is NOT Fresh/Preact, Next.js, or Angular —
  it borrows Angular's template syntax but is its own runtime, so prefer this skill over
  memory of those frameworks. Do NOT use for Fresh, React/Next, Vue, Svelte, plain Deno
  scripts with no web server, or unrelated uses of "sprig".
---

# Building sprig apps — orchestration playbook

> **Pipeline stage — build.** Consumes the `ui-breakdown` contract
> (`../interfaces/ui-breakdown.md`) — and, when the backend is spec-driven, the ratified
> cross-repo contract (`spec/contract/` at the git root: OpenAPI + the generated typed
> client — bridge 2 of the sprig repo's `contract.md`); produces the `sprig-app` contract
> (`../interfaces/sprig-app.md`), consumed by `audit`. Full chain:
> design → prototype → breakdown → build → audit.

sprig is a **Deno server-rendered** framework: Angular-flavored HTML templates parsed at
build time, every page rendered to HTML on the server, JavaScript shipped **only for
islands** (folders with a `logic.ts`). A component is a **folder** (`template.html` +
optional `logic.ts` + `styles.css`), **not a `.tsx`** — there is no JSX, no filesystem
routing, no Vite, no manifest. It borrows Angular's *syntax*, not its runtime. This
"not-Fresh/Next/Angular" framing is the single biggest source of bugs — keep it front of
mind when routing work and remind every specialist of it.

**You are the orchestrator. You do not write app code inline — you delegate building to a
named specialist** and coordinate the order, the running servers, and the iteration loop.
(The one exception: a *pure conceptual question* with no file to produce — "how do islands
hydrate?" — you may answer by reading the relevant `references/` leaf yourself. Anything
that creates or edits code is delegated.)

## The specialists you delegate to

| Agent | Owns | Reads |
|---|---|---|
| **`sprig-build-scaffolder`** | app skeleton: `sprig init`, `main.ts` routes/renderer/bootstrap, `serve.ts` host, the shell, `src/css-variables.json` tokens, the prod-build smoke | `references/routing.md`, `references/serving.md` |
| **`sprig-build-component`** | building ONE component/page/island to green in isolation (template + `logic.ts` + scoped styles + `isolate/` cases + the diff/test loop) | `references/component-model.md`, `references/templates.md`, `references/isolate.md`, and (cross-skill) `sprig:breakdown/references/isolate-format.md` |

Each specialist owns its own procedure — **do not restate their steps here.** Pass each
one its input contract and summarize what it returns.

## Where to start (the three entry modes)

- **No args, app already built** (runnable `src/`, nothing pending in `spec/ui/breakdown/`
  or `spec/ui/build-notes.json`) → enter the **annotate review loop** (below).
- **No args, pending work** — a `spec/ui/breakdown/` to implement, or a
  `spec/ui/build-notes.json` with open entries → do that work (implement the spec
  component-by-component, or apply the notes), then fall back to the annotate loop.
- **With args** (add a page/component/island, wire data, fix X) → route to the right
  specialist, then verify by running it.

## The flow

1. **Skeleton first.** If the app isn't stood up (or routes/serving/tokens need wiring),
   delegate to **`sprig-build-scaffolder`** with the project root, the routes to register
   (from the breakdown `index.md` build order, or the user's ask), the base path, whether
   a `spec/ui/design-system/css-variables.json` exists to copy in, and whether
   `spec/contract/openapi.json` exists at the git root (→ it generates/refreshes the
   **typed client** in `spec/contract/client/`).
2. **Build each unit in isolation, in build order.** Walk the breakdown `index.md` build
   order — **tokens → shared components (primitives before composites) → page-local
   components → page compositions** — and for each unit delegate to **`sprig-build-component`**
   with its breakdown spec (`.md` + proposed `isolate/` + `screenshots/`). Each unit must
   be green in `sprig isolate` **before** the units that compose it. Independent units can
   be delegated in parallel (one message, multiple Task calls), but respect the dependency
   order. Without a breakdown spec, the same specialist authors a minimal `isolate/` and
   runs the same loop.
3. **Verify the whole app.** After units are green, have the scaffolder run the prod-build
   smoke (`deno task build` → `deno task start`, hit a real URL). Deeper QA of the running
   app — hunting bugs, perf, regressions — is the **`sprig:audit`** stage downstream, not
   this skill.

## The annotate review loop (the user owns the server)

Once the app runs, feedback is collected **on the real app**, keyed to components. This
loop spans many turns, so **the server is the USER's** — ask them to run
`sprig dev --annotate` in their **own terminal** (they can paste it here with a leading
`!`). It picks a **stable port hashed from the app name**, prints both URLs (app +
annotate, and the isolate workbench), and opens them; re-running is **idempotent**
(it reprints, never duplicates or drifts the port). **Don't start it as your own
background task** — that's what makes "the server keeps dropping." If it's down, ask the
user to restart that one command.

Run each round autonomously off `spec/ui/build-notes.json` (a fixed path — you don't need
the port):
1. **Read** `build-notes.json`. Each entry is keyed to a **component** + its `isolateUrl`,
   and each note line is tagged with the specific element clicked. Nothing new? Tell the
   user the app URL and wait.
2. **Delegate the fix** to **`sprig-build-component`** for the component that owns the
   clicked element — passing the entry (element tag + note + `isolateUrl`). It edits only
   that folder, verifies in the isolate workbench, and reports.
3. **Clear** that entry from `build-notes.json` once the specialist confirms it green. An
   `unresolved:<selector>` entry didn't map to a component — locate the owner by selector
   and delegate that.
4. **Report, don't relaunch.** HMR already pushed the edits live. Tell the user "applied N
   — review and ⌘/Ctrl+click the next round," and repeat. Don't restart the server.

(`sprig dev --annotate <html>` is the single-prototype variant — that's `sprig:prototype`.
A prototype handed to you may carry inline `data-note`/`data-note-css` annotations; the
component specialist applies them as behavior/scoped-styles and strips them from output.)

## Decision matrix — route the task

| Task | Delegate to / read |
| --- | --- |
| Scaffold / project shape / CLI / routes + guards / serving / global tokens | **`sprig-build-scaffolder`** |
| A page/component/island: data + lifecycle, signals, DI, optimistic write, template, scoped styles, isolate | **`sprig-build-component`** |
| Apply a `build-notes.json` entry | **`sprig-build-component`** (the owning component) |
| Pure conceptual question (no file produced) | read the matching `references/` leaf yourself (`INDEX.md` is the table of contents) |

## Top gotchas (enforce across specialists)

- **Server writes are optimistic by default** (mandatory): update the UI now, call in the
  background, roll back on failure — never spinner-and-`location.reload()`. Spinner-and-wait
  only when the result is unknowable client-side or a `data-note` says so.
- **Data crosses the waist through the generated typed client** when one exists
  (`spec/contract/client/`, generated from the rune OpenAPI): `resolve.ts`/services and
  islands import its DTO types and endpoint wrappers — no hand-typed DTO shapes, no bare
  string routes. Reads are **queries**, writes are **commands** (intent verbs) — never an
  edit-this-record call (the waist rule; the sprig repo's `contract.md`).
- **A component is a folder, not a `.tsx`**; **`logic.ts` = island** (static folders ship
  no JS and their `(event)` bindings never fire).
- **`inject()` synchronously**, serializable island props/state only, **`static key`** on a
  `StateService`, **design tokens variables-only** in `src/css-variables.json`.
- **Run it in a browser and run the production build** before declaring done — `sprig dev`
  passing ≠ production working.
- **`sprig` feels stale after an update?** `sprig update` re-resolves to latest.
