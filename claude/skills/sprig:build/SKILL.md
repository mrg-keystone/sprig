---
name: "sprig:build"
description: >-
  Expert guidance for building web apps with sprig — a Deno SSR framework with
  Angular-flavored HTML templates and selective island hydration, published on JSR as
  @mrg-keystone/sprig. Use this whenever the user is scaffolding, building, or modifying a sprig
  app: adding pages or components, islands (interactive components), wiring data with a
  page's logic.ts class or resolve, routes, route guards (auth redirects), persisted state,
  dependency injection, or
  previewing/testing a component in isolation with `sprig isolate`; or when working in a
  repo with sprig markers (a deno.json importing "jsr:@mrg-keystone/sprig", folder-components made
  of template.html + optional logic.ts, a ui/src/ tree with pages/ + a shell, or main.ts
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
| **`sprig-build-scaffolder`** | app skeleton: `sprig init`, `main.ts` routes/renderer/bootstrap, `serve.ts` host, the shell, `ui/src/css-variables.json` tokens, the prod-build smoke | `references/routing.md`, `references/serving.md` |
| **`sprig-build-component`** | building ONE component/page/island to green in isolation (template + `logic.ts` + scoped styles + `isolate/` cases + the diff/test loop) | `references/component-model.md`, `references/templates.md`, `references/isolate.md`, and (cross-skill) `sprig:breakdown/references/isolate-format.md` |

Each specialist owns its own procedure — **do not restate their steps here.** Pass each
one its input contract and summarize what it returns.

## Where to start (the three entry modes)

- **No args, app already built** (runnable `ui/src/`, nothing pending in `spec/ui/breakdown/`
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
   **typed client** in `spec/contract/client/`). It returns a **BUILD BRIEF** (app root,
   alias names, tokens path, isolate command, port base, contract + browser posture) —
   **inline those ≤8 fact lines into every component prompt** so no builder re-derives
   them; facts inline, bulk behind paths.
   **Then, for any multi-unit build (≥3 units): spawn `sprig-build-analyst` ONCE** (before
   the first wave, synchronously) with the app root, breakdown root, the facts block, and
   the unit list — it digests the specs' prop/event APIs, the store/DI seams, and the
   framework gotchas into `spec/misc/build/cheatsheet.md` (≤3KB). Every builder brief then
   carries the CHEATSHEET PATH instead of a references reading list — one agent buys the
   education, N read the digest (measured without it: nine page agents each re-read the
   same four reference docs and twelve sibling templates).
   **The delegation is MANDATORY, and it caps YOUR OWN reading: before Wave 1 you open
   `index.md` and the scaffolder's BUILD BRIEF — nothing else.** If you catch yourself
   opening a unit spec, a reference doc, extracted source, or a fixture app "to brief the
   builders accurately", you are doing the analyst's job on the expensive tier: STOP and
   spawn it (measured: an orchestrator spent ~16 serial reading steps building the
   cheatsheet itself and the run hit the wall clock with two units never started). A
   builder-returned gotcha propagates by APPENDING one line to the cheatsheet — never by
   fattening later briefs. Before a page-composition wave, optionally re-spawn the analyst
   to refresh the sheet against as-built props.
2. **Build each unit in isolation, in build order.** Walk the breakdown `index.md` build
   order — **tokens → shared components (primitives before composites) → page-local
   components → page compositions** — and for each unit delegate to **`sprig-build-component`**
   with its breakdown spec as **resolved ABSOLUTE paths you looked up in `index.md` /
   the breakdown tree ONCE**: the unit's breakdown folder, its `<name>.md`, `isolate/`,
   `screenshots/`, and the target src dir. Never brief a specialist with just a name and
   "glob for it" — a measured fleet did that 652 times and every agent re-searched the
   tree the orchestrator already held. Each unit must
   be green in `sprig isolate` **before** the units that compose it — and start each
   composition the moment ITS OWN direct children are green, never parked behind unrelated
   stragglers (three measured runs died with every leaf green and the page never composed).
   Independent units run
   in parallel, **capped at 4–6 concurrent, in chunked waves — and floored at 4 while ≥4
   units are unblocked** (measured: waves of 1–2 stretched a 7-unit build past its wall
   clock) — measured on real fleets,
   10+ concurrent builders saturate the org's tokens-per-minute quota, agents die on
   429/529 and re-execute from scratch (one fleet: 78 units → 329 executions, one unit
   built 6× over 16 hours). In a Workflow script:
   `for (const wave of chunks(units, 5)) await parallel(wave.map(…))`; if a wave still
   dies of rate limits, halve the chunk size before resuming — never relaunch the full
   fan-out. **Assign each parallel agent its own PORT** (e.g. `4100 + index`) **and its own
   workbench root** (`SPRIG_WB_ROOT=/tmp/wb-<port>`, exported on every `isolate` call) in its
   prompt so isolate servers and workbench regenerations never collide (the pkill-a-sibling
   wars and the shared-workbench preview race are both measured failure modes). Without a breakdown spec, the same specialist authors a minimal
   `isolate/` and runs the same loop.
   **Long-unit split (the quadratic rule).** An agent loop re-sends its whole history
   every turn — input cost grows with the SQUARE of loop length, so one 150-turn
   build-diagnose-fix-verify marathon costs ~4× two 75-turn agents. When a builder stops
   at its iteration budget (or returns `checkpoint`), do NOT tell it to keep going:
   spawn a FRESH `sprig-build-component` whose brief inlines the predecessor's exact
   findings — the red rows verbatim, the files it wrote, its root-cause notes — with the
   instruction "fix exactly these; do not re-discover". A fresh agent restarts the meter
   at ~17K and its early turns are its cheapest. **Page compositions are STRUCTURALLY two
   spawns, always** (the measured 250–345-turn monolith class). Two rules learned the
   hard way about briefing them: a "split when stuck" trigger never fires (agents can't
   observe their own turn count), and a "build green but stop after one fix pass" caveat
   loses to the green-seeking goal (measured: spawn-1 ran to 244K ctx past its contract).
   So spawn #1's brief carries a DIFFERENT GOAL, not a limited version of the same one:
   its deliverable IS the checkpoint — "compose the template, author the cases, run the
   suite ONCE, write `spec/misc/build/<page>.checkpoint.md`, return. Reds in the
   checkpoint are EXPECTED output, not your failure; fixing them is the next agent's
   job, and fixing them yourself is exceeding your brief." Spawn #2 (only if reds) gets
   the checkpoint inlined and owns green.
   **Seam safety (how the split cannot cost accuracy):**
   - **Validate the checkpoint before spawning.** Required sections: greens; reds with
     exact failing assertions; root-cause notes; files written; RULED-OUT list; next
     step. A checkpoint missing any of these is a wrong brief — bounce it back one turn
     ("complete the checkpoint"), never hand a successor a vague seam.
   - **Predecessor greens are pinned.** The successor's definition of done is the FULL
     case set green — its brief says so explicitly; a fix that breaks a predecessor's
     green case is a regression, not progress.
   - **Escalate, don't repeat.** Successor #1 is a FIXER (findings inlined). If it
     checkpoints on the SAME failing assertions, that repetition is the ping-pong
     signal — the bug is deeper than a patch. Successor #2 is then a DIAGNOSER: its
     brief forbids code edits until it states a root-cause hypothesis that explains ALL
     evidence from BOTH checkpoints (it reads them plus the diff of prior changes),
     then it fixes against that hypothesis.
   - **Cap = 3 agents, and a capped-out unit returns RED carrying its checkpoint
     trail** — two diagnoses and a hypothesis history is a well-documented bug report
     for the human, not silent churn.
3. **Verify the whole app.** After units are green: first the whole-suite receipt — one
   `SPRIG_WB_ROOT=/tmp/wb-final isolate test --json` at the app root, every case in a single
   run (units were only ever proven one at a time; a composition can break a sibling's case
   and per-unit verdicts won't show it) — then have the scaffolder run the prod-build smoke
   (`deno task build` → `deno task start`, hit a real URL). Deeper QA of the running
   app — hunting bugs, perf, regressions — is the **`sprig:audit`** stage downstream, not
   this skill.

**Fleet hygiene (you own this):** specialists are pinned to `sonnet` in their agent defs —
don't override to `inherit` (an inherited fleet ran hundreds of mechanical builders on the
session's expensive tier). Collect each unit's ≤20-line summary; never paste isolate/test
dumps into the session. Run a big build in a FRESH session and let the workflow return
counts + red-unit ids — long-lived sessions measured at 400–570K tokens of context re-pay
that context on every turn.

**Orchestrator conduct:** after spawning agents, END YOUR TURN and let task notifications
re-invoke you — never `sleep`-poll between stages (measured on a rune build: 32% of wall time
was orchestrator sleeps). **Unattended runs are the exception** (headless `claude -p`, CI,
evals — any brief that says "work fully autonomously"): there, end-turn-and-wait is FATAL —
the CLI terminates the whole run when background tasks are still running ~600s after your
turn ends (measured: a fleet died mid-wave exactly this way, page never composed). In an
unattended run spawn each wave SYNCHRONOUSLY — all of the wave's Agent calls in ONE message
with `run_in_background: false`, so they run concurrently and your turn continues when the
wave returns — and still never sleep-poll. Verify by RECEIPT: a builder's isolate verdicts and the scaffolder's
smoke result ARE the state — don't re-run their checks inline or re-walk their file trees; a
mid-build fix re-routes through the owning specialist. For fleets ≤ ~15 units, track the queue
in your plan text — don't burn an API turn per task-ledger update (measured: 20 bookkeeping
turns on a 10-agent build). And never search the filesystem yourself — every skill reference
lives at `~/.claude/skills/<skill>/references/<file>`; read exact paths (an orchestrator was
measured running `find /` for a reference file whose path it knew).

**Briefing rule (root cause of fleet waste):** a specialist that has to SEARCH was
under-briefed. Before delegating, YOU resolve — absolute, copied verbatim from `index.md`
/ stage returns, never retyped by hand — every path the specialist touches (spec folder,
evidence files, target dir), plus its PORT and any running-server URL. If a specialist
returns `blocked: missing path`, the brief was wrong: fix the brief and re-delegate; never
answer "search for it". **Spec-pending units** (regions with no written spec) get the
breakdown's extracted-source folder path for their region passed EXPLICITLY — without it,
builders hunt the original prototype file across the tree (measured: `find -name
*prototype*` hunts in an otherwise clean run). Briefs stay lean — facts inline (≤8 lines), spec content by PATH: a
builder brief past ~5KB (scaffolder ~2.5KB) is inlining prose the specialist should read
from disk (measured: an orchestrator pre-digested each unit's spec into 5–7KB briefs and
blew every prompt budget while the specialists re-read the specs anyway).

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
  `StateService`, **design tokens variables-only** in `ui/src/css-variables.json`.
- **Run it in a browser and run the production build** before declaring done — `sprig dev`
  passing ≠ production working.
- **`sprig` feels stale after an update?** `sprig update` re-resolves to latest.
