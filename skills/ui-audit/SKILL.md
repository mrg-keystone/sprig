---
name: ui-audit
description: >-
  Hunt down and FIX bugs and performance problems in a *running* Fresh 2 +
  isolate app by orchestrating a pipeline of agents: one agent hunts bugs in the
  live UI with the Playwright MCP, then in the server, then in the client;
  parallel agents root-cause each bug to a file:line across frontend AND backend;
  a fixer agent repairs them one at a time; a validator agent proves every fix
  holds — all recorded in `fixes.md`, a checklist where each section is one issue
  (what's wrong, the cause, and how it was verified fixed). Use whenever the user
  points at a built/running Fresh app (one made by the deno-fresh2 skill) and
  wants it checked, debugged, QA'd, hardened, or fixed — phrases like "find and
  fix the bugs", "do a QA pass", "audit the UI", "why is it slow/janky/broken",
  "what's wrong with this app", "go over it and fix what's broken", "make it
  production-ready", "the form/login/hydration is broken — fix it". Trigger even
  without the word "audit": handing over a deno-fresh2 project and asking "find
  what's wrong and fix it" counts. NOT for building or styling new features
  (that's deno-fresh2), NOT for turning a static mock into a build spec (that's
  ui-breakdown), and NOT for a pure source read with no app to run — this skill's
  premise is exercising the live app.
---

# ui-audit — hunt, root-cause, fix, and verify a running Fresh 2 app

You are the **orchestrator**. You take a running deno-fresh2 app from "something's
wrong" to "fixed and verified" by running a four-stage pipeline of focused agents,
leaving **`fixes.md`** as the record. You don't hunt, diagnose, or edit yourself —
you **spawn an agent for each stage**, hand it the right brief, and pass the
artifact down the line.

```
HUNT ─▶ ROOT-CAUSE ─▶ FIX ─▶ VALIDATE
 1 agent   N agents     1 agent   1 agent
 (browser, (parallel,   (one at   (re-verify
  server,   one per      a time)   on a fresh
  client)   bug)                   server)
            └──────── fixes.md is written here, then worked ────────┘
```

1. **HUNT** — one agent drives the app in a real browser with the **Playwright
   MCP** to find bugs and perf issues in the **UI**, then corroborates each
   against the **server** code, then the **client** code. → a bug list with
   reproducible evidence.
2. **ROOT-CAUSE** — one agent **per bug, in parallel**, traces each symptom to a
   `file:line` across frontend and backend. → a confirmed cause + the fix + how to
   verify, for each. You assemble these into **`fixes.md`**.
3. **FIX** — one agent works `fixes.md` **one issue at a time**, applies each fix,
   and ticks its box.
4. **VALIDATE** — one agent re-runs **every** issue's verification against a
   freshly-started server and confirms the whole checklist is green (loops back to
   FIX for anything that still fails).

The targets are apps the **deno-fresh2** skill produced, so assume its
conventions and exploit them: `routes/`+`islands/`+`components/`, a typed
`define`/`State` in `utils.ts`, a `user-stories.md` at the root (the living spec of
what the app *should* do — the hunter's oracle), per-story Playwright tests,
`isolate/` folders for component-level checks, an optional rune/keep backend called
in-process. Every fix anchors to the canonical pattern in the **deno-fresh2**
skill's `references/` — no Fresh-internals guesswork.

## Think step by step — you and every agent

This work fails when someone jumps to a conclusion: a "fix" for a misdiagnosed
cause, a bug declared dead that was never reproduced. So **reason sequentially**
and require it of every agent you spawn. Use the **sequential-thinking MCP**
(`mcp__sequential-thinking__sequentialthinking`) for your own planning between
stages, and end every agent brief with the instruction to think step by step
sequentially (the briefs in `agents/` already carry it). One careful chain of
reasoning per stage beats four hasty ones.

## The one rule every stage serves: evidence, not vibes

Each stage hands the next something it can trust only if it's backed:

- **The hunter reproduces every bug** and captures the proof — a screenshot, a
  console line, a network entry, an HTTP status, a measured number. A symptom it
  can describe but not reproduce goes to a **"Needs investigation"** list, never
  into the fix queue (you don't want an agent editing code to chase a phantom).
- **Root-cause names a `file:line` and the mechanism**, proven by reading that
  code. Unpinnable → it stays out of the fix queue with what's missing noted.
- **The validator confirms with a runnable check**, not an opinion. "Looks fixed"
  is not validation; `curl -i … → 404` is.

This is why the pipeline is staged: hunting, diagnosing, fixing, and verifying are
different jobs, and each gates the next.

## fixes.md — the artifact that flows through the pipeline

`fixes.md` is written at the **project root** (next to `deno.json` /
`user-stories.md`); evidence goes in a sibling `fixes-evidence/`. Derive both
automatically; never ask. The same file is **written by ROOT-CAUSE, executed and
ticked by FIX, and confirmed by VALIDATE** — so at the end it's both the changelog
and the proof. One section per issue, severity-ordered, in the checklist format in
**`references/fixes-format.md`** (read it before assembling the file):

```md
### ☐ [BLOCKER · bug] Unknown /product/:id returns HTTP 200 (soft 404)

**What's wrong** — A missing product shows the "not found" page but responds 200,
so crawlers and the browser treat a missing page as real.
**Evidence** — `fixes-evidence/soft-404.png`; nav to `/product/nope` → `200`.
**Root cause** — `routes/product/[id].tsx:18` — renders a not-found branch with
`page({...})` instead of throwing; status is only set by a thrown `HttpError`.
**Fix** — `throw new HttpError(404)` → `routes/_error.tsx`. (deno-fresh2 →
`references/advanced/error-handling.md`)
**Verify fixed** — `curl -i …/product/nope | head -1` → `HTTP/1.1 404`.
```

The box turns ☑ only when FIX applied the change **and** VALIDATE's check passed.

## Before stage 1 — orient and boot (the orchestrator's prep)

Think through this first; it aims the whole pipeline:

- **Confirm it's a Fresh 2 app** and read its shape: `deno.json` (tasks, imports),
  `main.ts` (the `App` builder order), `utils.ts` (`State`/`define`),
  `vite.config.ts`, the `routes/` tree, `islands/`, `components/`.
- **Read `user-stories.md` end to end** if present — each bullet is a contract the
  hunter verifies (often naming the HTTP fact: status, redirect). No file? The
  hunter derives the story list from routes/islands and notes its absence.
- **Determine data ownership** — owns its data (in-app store, Deno KV, local JSON)
  or **fronts** a rune/keep backend in-process (`api.backend.fetch(...)`, a
  live-first/fixture-fallback adapter)? If it fronts one, the backend failure modes
  in deno-fresh2's `references/rune-backend.md` (silent empty-store fallback,
  `live:false` shown as real) are in scope — invisible from the DOM.
- **Boot a FRESH server and keep its lifecycle.** Start `deno task dev` on a known
  port (background) — *fresh*, not a long-lived server you've been poking, which
  serves stale modules and makes the audit lie (deno-fresh2 →
  `playwright-and-dev-loop.md`). For a "production-ready" audit also build and serve
  (`deno task build && deno serve -A _fresh/server.js`) — some bugs exist only in
  the build. **After FIX edits code, restart a fresh server before VALIDATE** — the
  Vite module graph caches, so validating against the edited-but-stale server lies.

## Stage 1 — HUNT (one agent: UI → server → client)

Spawn **one** agent with **`agents/hunter.md`** as its brief, plus the running base
URL, the project map, and `user-stories.md`. It owns the Playwright MCP browser for
this stage (one driver, no contention). Its job, in order: hunt the **UI** live
(drive every story/route, check status codes, island hydration, forms, console,
network, perf), **then** read the **server** code for the causes those symptoms
imply (handlers, `main.ts`, middleware, the backend adapter), **then** the
**client** code (islands, serialization, listeners, CSS). It returns a **bug list**
— each with evidence, the suspected layer, and a one-line lead — and writes
evidence files to `fixes-evidence/`. It does **not** fix anything.

The Fresh-2-specific detection playbook (what to hunt, how to detect it,
thresholds) is `references/fresh2-bug-catalog.md`; the exact MCP call sequences are
`references/playwright-mcp-recipes.md`. The brief points the agent at both.

## Stage 2 — ROOT-CAUSE (parallel, one agent per bug)

For each bug the hunter returned, spawn an agent with **`agents/rca.md`** as its
brief plus that bug's record and evidence. Send them in **one message, multiple
Agent calls** so they run concurrently (cap ~6–8; cluster tightly-related bugs into
one). Each does read-only code tracing — no browser, no edits — to **confirm**
(pin the `file:line` + mechanism), **refute** (prove it's actually correct — a
false positive removed is as valuable as a bug found), or mark **needs-repro** (real
but needs a browser check). Use `subagent_type: "Explore"` for pure tracing.

Collect the findings. For any **needs-repro**, you own the browser between stages —
run the named check at the MCP and resolve it. Then **assemble `fixes.md`** from the
confirmed findings (drop refuted ones; if a reader would worry about one, note it
under "Checked and healthy"). Now you have the fix queue.

## Stage 3 — FIX (one agent, one issue at a time)

Spawn **one** agent with **`agents/fixer.md`** as its brief plus `fixes.md`. It
works the checklist **top-down, one issue at a time** — apply the fix from that
section (editing app source, anchored to the cited deno-fresh2 reference), confirm
it didn't break the immediate path, tick the box ☑, move on. One-at-a-time is
deliberate: parallel edits collide and a later fix can mask whether an earlier one
worked. A fix that's risky or underspecified is left **unticked with a note**
rather than guess-edited — VALIDATE and you will handle it. Ideally it works on a
branch so the whole audit is one reviewable diff.

## Stage 4 — VALIDATE (one agent, fresh server)

Restart a **fresh** server (FIX edited code; the old server is stale), then spawn
**one** agent with **`agents/validator.md`** plus `fixes.md`. It re-runs **every**
issue's "Verify fixed" check (a `curl -i` status, a Playwright interaction via the
MCP, `isolate test`, a perf re-measure) and — importantly — re-checks a few
*unrelated* stories to catch regressions the fixes introduced. It reports each issue
green or still-failing.

- **All green** → the audit is done. `fixes.md` is fully ☑ and is the record.
- **Anything red** → think about why (a wrong root cause? an incomplete fix?), loop
  that issue back through FIX (or re-open ROOT-CAUSE if the diagnosis was wrong),
  then re-validate. Don't declare done over a red check.

## Rules

- **Exercise the live app.** Findings come from a running browser session, not a
  cold read. If you genuinely can't boot the app, say so and stop — a static-only
  pass is a different, weaker thing; label it as such.
- **Reproduced → fix queue. Suspected → "Needs investigation."** Never let an agent
  edit code to chase a bug nobody reproduced.
- **Causes proven from code; fixes cite the canonical pattern.** The deno-fresh2
  references are right there — don't reconstruct Fresh internals from memory (that's
  how Fresh-1 habits creep in).
- **One issue at a time in FIX**, each verified before the next.
- **Don't "fix" correct code.** Refute false positives before they reach the fixer;
  a clean pattern verified as fine is a credit in "Checked and healthy", not a diff.
- **Validate on a fresh server**, and re-check unrelated stories for regressions.
- **Think step by step** — you between stages, and every agent in its brief.
