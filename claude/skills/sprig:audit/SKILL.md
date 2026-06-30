---
name: "sprig:audit"
description: >-
  Hunt down and FIX bugs and performance problems in a *running* sprig +
  isolate app by orchestrating a pipeline of agents: one agent hunts bugs in the
  live UI with the Playwright MCP, then in the server, then in the client;
  parallel agents root-cause each bug to a file:line across frontend AND backend;
  a fixer agent repairs them one at a time; a validator agent proves every fix
  holds — all recorded in `fixes.md`, a checklist where each section is one issue
  (what's wrong, the cause, and how it was verified fixed). Use whenever the user
  points at a built/running sprig app (one made by the build skill) and
  wants it checked, debugged, QA'd, hardened, or fixed — phrases like "find and
  fix the bugs", "do a QA pass", "audit the UI", "why is it slow/janky/broken",
  "what's wrong with this app", "go over it and fix what's broken", "make it
  production-ready", "the form/login/hydration is broken — fix it". Trigger even
  without the word "audit": handing over a build project and asking "find
  what's wrong and fix it" counts. NOT for building or styling new features
  (that's build), NOT for turning a static mock into a build spec (that's
  breakdown), and NOT for a pure source read with no app to run — this skill's
  premise is exercising the live app.
---

# audit — orchestrate hunt → root-cause → fix → verify on a running sprig app

> **Pipeline stage — audit** (end). Consumes the `sprig-app` contract
> (`../interfaces/sprig-app.md`) and leaves `fixes.md`. Full chain:
> design → prototype → breakdown → build → audit.

**You are the orchestrator. You never hunt, diagnose, edit, or verify yourself —
you delegate each stage to a named specialist** (via the Task tool), summarize what
comes back, and pass the artifact down the line. Your job is coordination: boot the
app, route to the right specialist with the right brief, assemble `fixes.md`, and
loop back on a red check.

```
HUNT ─▶ ROOT-CAUSE ─▶ FIX ─▶ VALIDATE
 1 agent   N agents     1 agent   1 agent
            └──────── fixes.md is written here, then worked ────────┘
```

## The specialists you delegate to

| Stage | Agent | What it returns |
|---|---|---|
| 1 · HUNT | **`sprig-audit-hunter`** | evidence-backed bug list (JSON: `bugs` / `needs_investigation` / `checked_healthy`) |
| 2 · ROOT-CAUSE | **`sprig-audit-root-cause`** (one per bug, parallel) | a per-bug finding (JSON: verdict + `file:line` + fix + verify) |
| 3 · FIX | **`sprig-audit-fixer`** | a summary of which issues are ☑ fixed / ☐ deferred |
| 4 · VALIDATE | **`sprig-audit-validator`** | per-issue pass/fail + regressions + overall verdict |

Each specialist owns its own procedure. **Do not restate their steps here** — hand
them their input contract and let them run. The detection playbook, MCP recipes, and
`fixes.md` format live in `references/` (the agents read them); you pass each agent
the absolute path to this skill's `references/` dir.

## The one rule every stage serves: evidence, not vibes

Each stage hands the next something it can trust only if it's backed — a reproduced
symptom with a screenshot/console line/status, a `file:line` proven by reading code,
a runnable check that passed. This is why the pipeline is staged: hunting,
diagnosing, fixing, and verifying are different jobs, each gating the next. Require
sequential reasoning of yourself (use `mcp__sequential-thinking__sequentialthinking`
between stages) and of every agent (their briefs already carry it).

## fixes.md — the artifact you assemble and flow through the pipeline

`fixes.md` lives at the **project root** (next to `deno.json` / `user-stories.md`);
evidence goes in a sibling `fixes-evidence/`. Derive both automatically; never ask.
**You assemble it** from the root-cause findings (drop refuted ones; surface notable
"Checked and healthy" / "Needs investigation"); FIX executes and ticks it; VALIDATE
confirms it. One section per issue, severity-ordered, in the checklist format in
**`references/fixes-format.md`** — read it before assembling the file. A box turns ☑
only when FIX applied the change **and** VALIDATE's check passed.

## Before stage 1 — orient and boot (your prep)

- **Confirm it's a sprig app** and read its shape: `deno.json`, `main.ts`
  (`defineRoutes`/`createRenderer`/`bootstrap`), `serve.ts` (`serveSprig`), the
  `src/` tree (`shell/`, `pages/`, `components/`, `islands/`, `services/`).
- **Read `user-stories.md` end to end** if present — each bullet is a contract the
  hunter verifies. No file? Tell the hunter to derive the story list from the route
  table + islands and note its absence.
- **Determine data ownership** — owns its data (in-app store, Deno KV, local JSON) or
  **fronts** a keep backend in-process? If it fronts one, the Backend bugs in the
  catalog are in scope (invisible from the DOM) — say so in the hunter's brief.
- **Boot a FRESH server and keep its lifecycle.** Start `sprig dev` on a known port
  (background) — fresh, not a long-poked server that can serve stale modules. For a
  "production-ready" audit also build and serve (`sprig build && sprig serve`, or
  `deno serve -A --unstable-kv serve.ts`). **After FIX edits code, restart a fresh
  server before VALIDATE.** Consider creating a dedicated git branch first so the
  whole audit is one reviewable diff.

## The flow

1. **HUNT.** Delegate to **`sprig-audit-hunter`** with its input contract: the running
   base URL, project root + map, data-ownership, `user-stories.md` (or "derive"), the
   evidence dir, and the `references/` path. It owns the browser for this stage. →
   take its `bugs[]` / `needs_investigation` / `checked_healthy`.
2. **ROOT-CAUSE.** For each `bugs[]` entry spawn one **`sprig-audit-root-cause`** —
   send them in **one message, multiple Task calls** so they run concurrently (cap
   ~6–8; cluster tightly-related bugs into one). Each returns confirmed / refuted /
   needs-repro. **For any `needs_repro`, you own the browser between stages** — run
   the named check yourself and resolve it. Then **assemble `fixes.md`** from the
   confirmed findings (dedupe ones resolving to the same `file:line`).
3. **FIX.** Delegate to **`sprig-audit-fixer`** with `fixes.md` (and the running URL
   for self-checks). It works the checklist one issue at a time and reports ☑/☐.
4. **VALIDATE.** **Restart a fresh server** (FIX edited code), then delegate to
   **`sprig-audit-validator`** with `fixes.md` + the stories. It re-runs every Verify
   check and sweeps for regressions.
   - **verdict pass** → done. `fixes.md` is fully ☑ and is the record; report the
     summary (fixed N, deferred M, all verified).
   - **any fail/regression** → reason about why (wrong root cause vs. incomplete fix
     vs. collateral), loop that issue back through FIX — or re-open ROOT-CAUSE if the
     diagnosis itself was wrong — restart a fresh server, and re-validate. Never
     declare done over a red check.

## Rules

- **You delegate; you do not perform the stage.** Each specialist runs in its own
  context with its own tools — hand it its contract, summarize its return, chain on.
- **Exercise the live app.** Findings come from a running browser session. If you
  genuinely can't boot the app, say so and stop — a static-only pass is a weaker,
  different thing; label it as such.
- **Reproduced → fix queue. Suspected → "Needs investigation."** Never let an agent
  edit code to chase a bug nobody reproduced.
- **One issue at a time in FIX**; **validate on a fresh server** and re-check
  unrelated stories for regressions.
- **Think step by step** — you between stages, and every agent in its brief.
