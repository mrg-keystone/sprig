# Bug report: sprig build fleets burn ~600M input tokens per wave — measured causes and fixes

**Date:** 2026-07-09
**Reporter:** Claude Code session `3155ff9c` (infra UI rebuild, `infra/ui-rework` worktree)
**Subject:** the `sprig:build` skill + `sprig-build-component` agent, as exercised by a
40-agent workflow fleet building/repairing the infra control-plane UI (63 units, 9 pages)
**sprig version:** 0.20.29 (published 2026-07-09 12:46 EDT), CLI + skills installed via `sprig install`

## TL;DR

One fleet run (workflow `wf_7fcf9c0f-c9a`, 40 agent transcripts) produced **1.49M output
tokens** but paid **608M input tokens** across its agent loops (551M cache-reads, 12.2M
cache-writes). The output isn't the cost — **re-sending ever-growing context on every turn
is**. The heaviest single agent (the `env-detail` page composition) ran **308 API turns**,
its context growing **17K → 374K tokens** (avg 247K/turn), for a total of **76M input
tokens to build one page**.

Three of the cost drivers are sprig-owned (reference docs lagging the framework API,
unbounded screenshot reads, no shared pre-digestion across agents); the report quantifies
each and proposes fixes. Raw numbers per agent: `evidence/per-agent-census.tsv`.

## Cost model (why this compounds)

An agent re-sends its whole history on every API turn. If a loop runs **T** turns and the
context grows roughly linearly (every tool result stays forever), total input ≈
**T² × growth-rate / 2 — quadratic in loop length**. Everything below is a slope or a
length; the quadratic multiplies them.

Cache softens the price (551M of the 608M was cache-reads at ~0.1× rate; 30-minute agents
keep the 5-minute cache TTL warm continuously) — but it still counts against session
limits, and this fleet hit the limit mid-wave twice, losing 17 in-flight agents' work with
nothing journaled.

## Measured anatomy of the burn

From `evidence/per-agent-census.tsv` (all 40 agents):

| observation | number |
|---|---|
| page-composition agents (the heavy class) | 250–345 turns, 118–207 tool calls, ~30 min, 60–132K output each |
| headless test runs per page agent | **only 1–6** — testing is NOT where the turns go |
| final contexts | 160–374K tokens |
| tool calls grepping hashed files in `~/Library/Caches/deno` | **112** (see `evidence/deno-cache-spelunking.txt`) |
| `.png` Reads across the fleet | **40**, ~6MB of image payload in transcripts |
| worst screenshot timing | `org-detail`: 7 images (1.1MB) read at turn 52 of 345 → re-paid ~293 turns |
| same reference docs re-read across the 5 heaviest agents | routing.md ×5, templates.md ×4, component-model.md ×4, serving.md ×4 (see `evidence/payload-breakdown.txt`) |
| biggest single tool results | 554KB / 429KB / 353KB / 345KB / 246KB — all full-page breakdown screenshot Reads |

## Reason 1 (sprig) — reference docs lag the framework: agents reverse-engineer from the Deno cache

The shipped references (`claude/agents/` + `skills/sprig:build/references/`, 539 lines
total) mention `resolve.ts` in ~6 passing lines with a toy example — **there's no
ResolveCtx contract documented anywhere**. Meanwhile 0.20.29 shipped expecting pages to
use it. That gap is exactly what sent every page agent grepping hashed files in
`~/Library/Caches/deno` — **112 tool calls** like:

```
rg -n "Resolve" ~/Library/Caches/deno/remote/https/jsr.io/473205fd…/fra…
grep -o "ResolveCtx[^;]*;" ~/Library/Caches/deno/remote/https/jsr.io/473205fd…
```

Each of the nine page agents independently re-derived the same contract from compiled
framework source, at ~250K context per turn. (Same failure mode as the earlier
`tooling/feedback/rouge_agents/` incident — an information need the agent's own docs
create but can't satisfy.)

**Fix:** document the full resolve contract in `references/routing.md`, and treat the
reference docs as **versioned with the framework** — a release that changes the API
surface updates the refs in the same commit. A release checklist item ("did the agent-facing
docs change with this API?") would have prevented this class entirely.

## Reason 2 (sprig) — no screenshot discipline: full-page PNGs read early, re-paid for hundreds of turns

The `sprig-build-component` agent def says "diff each case against the breakdown
screenshot" with **no guidance on which screenshot or when**. Agents read 0.3–0.55MB
full-page PNGs early and re-paid them for hundreds of turns:

- `account` agent: 12 images (1.7MB) starting at turn 100 of 258
- `org-detail` agent: 7 images (1.1MB) at turn 52 of 345 — each image re-sent ~293 more times
- fleet total: 40 PNG reads, ~6MB of image payload

**Fixes**, in escalating order of leverage:
1. Skill text: prefer the **cropped per-component stills** (the breakdown capture stage
   already produces them) over full-page shots; read images **as late as possible** in the
   loop; never re-read an image already seen.
2. Structural (better): the isolate workbench exposes a **pixel-diff endpoint** that
   returns a score/heatmap for `<case> vs <breakdown screenshot>`, so agents only *look*
   at an image when the diff fails. The agent loop then contains numbers, not megabytes.

## Reason 3 (half sprig) — every agent buys the same education

The skill's flow ("read your spec fully → read references as needed → compose
already-built components") makes each of the 9 page agents **independently** buy the same
education: the same 4 reference docs, the same sibling component prop APIs (app-shell
template ×5, backend.ts ×5 across the heavy agents), the same 27KB contract binding.

**Fix (sprig-level):** the pattern the rune pipeline already uses — one cheap analyst
writes a **per-app cheatsheet artifact** (component prop APIs, framework gotchas, the
resolve contract) that every builder reads instead of excavating. One agent digests 50KB
of sources into ~3KB once; N agents read the digest.

The other half — agents *choosing* to read 12 sibling templates — is inherent model
behavior under a "compose existing components" instruction; the cheatsheet removes most of
the need.

## Reason 4 (context) — the remaining burn is orchestration + harness, not sprig

For completeness of attribution (details in the session, not sprig-actionable):
- Session-limit kills discarded two waves of in-flight agents (17 agents × ~9 min each in
  this run) with no journaled results — pure re-spend on resume.
- The orchestrating workflow fanned out 15 repair agents at once without inlining each
  unit's failing tests/errors — re-triggering the discovery loops above.
- Workflow concurrency (`min(16, cores−2)` = 14 here) concentrates the burn but doesn't
  increase it.

## Recommended mitigations (general, for the skill/agent design)

### 1. Split long loops into staged agents with structured handoffs (biggest lever)
A fresh agent restarts the meter at ~17K. Instead of one 300-turn
build-diagnose-fix-verify agent, run *diagnose* (returns a structured finding) → *fix*
(gets the finding inlined, never re-discovers). Because the cost is quadratic, cutting
loop length in half roughly halves-to-quarters the input bill even though you run more
agents. The rune pipeline already does this instinctively (analyst → test-author →
method-impl → validator, each fresh); **the sprig build agent is one monolith loop**.

### 2. Front-load knowledge so discovery turns never happen
Every fact the agent has to go find costs turns × the context it drags behind it. Inline
into the prompt: the exact failing tests with error text, the file paths, the component
prop APIs, the framework gotchas. This is the cheatsheet/module-map pattern — one cheap
agent digests the 50KB of sources into 3KB *once*, and N agents read the digest. In this
run, nine page agents each independently re-read the same four reference docs and
reverse-engineered `resolve.ts` from the Deno cache — all of that was front-loadable.

### 3. Shrink what tools return (lower the slope)
A KB of tool output isn't paid once — it's paid on *every remaining turn*. So: test
commands that print only failures (not keep boot logs + a full 284-test JSON), `rg` over
`cat`, partial file reads, `--json | jq .failed` pipelines. This is also an argument for
smarter endpoints over raw output — e.g., a workbench pixel-diff route that returns a
score instead of making the agent look at screenshots.

### 4. Late-load the heavy stuff (change the curve's shape)
Position in the loop matters as much as size. The `org-detail` agent read 1.1MB of
screenshots at turn 52 of 345 — paid ~293 more times. The same images read at turn 300
would cost ~6× less. Concretely: build structure first, do visual polish (images) as the
*last* phase of the loop, and never re-read an image you've already seen.

### 5. Checkpoint-and-respawn instead of marathon agents
When an agent's context passes a threshold, have it write its state to a file and return;
the orchestrator spawns a successor that reads the checkpoint. In a Workflow script that's
just chaining `agent()` calls where each prompt includes the predecessor's structured
return. This also fixes the other bleed: when a session-limit kill lands, a 60-turn agent
loses 60 turns of work, not 300.

## Concrete change list for this repo

1. `skills/sprig:build/references/routing.md` — document the full `resolve.ts` /
   `ResolveCtx` contract (params, return shape, error behavior, `inject(Backend)` usage).
2. Release process — agent-facing reference docs update in the same commit as any
   framework API-surface change.
3. `claude/agents/sprig-build-component.md` — add screenshot discipline (cropped stills,
   late, never re-read) and pin `reasoningEffort` (it already pins `model: sonnet`;
   effort currently inherits the session's, which can be `high`/`max`).
4. `sprig:build` skill — add an opening "app cheatsheet" analyst stage for multi-unit
   builds; builders receive the cheatsheet path instead of re-deriving shared knowledge.
5. Isolate workbench — a pixel-diff endpoint (`POST /http/post-case-diff` → score +
   region summary) so visual verification is numeric until it actually fails.
6. Consider splitting `sprig-build-component` into build → verify/fix stages with a
   structured handoff (mitigation #1).

## Evidence

- `evidence/per-agent-census.tsv` — all 40 agents: turns, tool calls, test runs, PNG
  reads, image KB, output tokens, total input paid, final context, duration.
- `evidence/deno-cache-spelunking.txt` — 30 sample tool calls (of 112) reverse-engineering
  the framework from `~/Library/Caches/deno`.
- `evidence/payload-breakdown.txt` — most re-read files and all >8KB tool results across
  the 5 heaviest page agents.
- Full transcripts: `~/.claude/projects/-Users-raphaelcastro-Documents-programming-infra-main/3155ff9c-9e25-463f-b4c3-93a4df1cc116/subagents/workflows/wf_7fcf9c0f-c9a/agent-*.jsonl`
