# Plan — apply `feedback/fleet-token-burn/` (2026-07-09)

**Source:** `fleet-token-burn/BUG-REPORT.md` — a 40-agent `sprig:build` fleet (infra UI,
63 units) paid **608M input tokens** for 1.49M output; quadratic context growth × three
sprig-owned causes. Evidence spot-checked against this repo and it holds: `routing.md`
carries only the toy `resolve` example (no `ResolveCtx`/`RouteCtx` contract — the real one
is `framework/.sprig/core.ts:387-401`), the agent def has no screenshot or effort
discipline, and the skill has no shared pre-digestion stage.

**Convergence:** the skill-eval guestbook loop (see `tooling/skill-eval/`, memory note
`skill-eval-guestbook-loop`) independently measured the same duplication (4 reference docs
× every builder, ctx_p95 171K) and the same docs-lag failure class (the isolate test
dialect trap, fixed 2026-07-09). This plan is the union: report reasons 1–3 +
mitigations, minus what already landed.

## Already landed (don't redo — shipped in the eval-loop iterations, 2026-07-09)

- Headless isolate test dialect documented everywhere + `ran:false` tripwire; `parseReport`
  surfaces Playwright load errors; CLI `--json` never exits without a JSON verdict.
- Unattended-run synchronous waves, wave floor, compose-when-deps-green, whole-suite
  receipt, brief size caps (`sprig:build/SKILL.md`).
- Iteration budget generalized (3 identical non-green verdicts = stop); pkill banned with a
  sanctioned PID-file cleanup recipe (agent def).

## Wave A — docs / skill / agent-def text (cheap, high leverage, measurable now)

**A1. Document the resolve contract** — report reason 1, concrete item 1. `112` tool calls
reverse-engineered it from the Deno cache.
- File: `claude/skills/sprig:build/references/routing.md` (the `resolve.ts` section).
- Lift from `framework/.sprig/core.ts:387-401` + the JSDoc constraints around `:767` and
  `:815`: `ResolveCtx { params, url }` (NO headers/session — that's why sessions live in
  `RouteCtx`), `Resolve` return shape (sync or Promise `Record<string, unknown>`),
  `RouteCtx { url, params, session }` as the `logic.ts onServerLoad` twin, DI availability
  (`inject(Backend)` synchronously, guard/injector sharing), error behavior.
- Verify: grep the next eval run's transcripts for `Caches/deno` greps → expect 0.

**A2. Screenshot discipline** — reason 2 fix 1, concrete item 3a. 40 PNG reads / ~6MB paid
for hundreds of turns.
- File: `claude/agents/sprig-build-component.md` (step 6 + a Never bullet).
- Text: prefer the breakdown's **cropped per-component stills** over full-page shots; read
  images **as late as possible** (structure first, visual polish last); **never re-read an
  image already seen**; one screenshot-diff per iteration max (extends the existing
  receipt rule).
- Verify: skill-eval scorecard — add `png_reads` / `image_KB` per role (see M1), expect
  ≤1 image per case iteration and no repeats.

**A3. Pin builder reasoning effort** — concrete item 3b.
- File: `claude/agents/sprig-build-component.md` frontmatter (`model: sonnet` already
  pinned). First CONFIRM the harness honors an effort key in agent frontmatter; if yes pin
  the builder to `low`/`medium`; if not, note it in the def's fleet-hygiene line for the
  orchestrator (Workflow `agent()` calls accept `effort`).
- Verify: scorecard cost per builder request drops; no gate regression (accuracy outranks
  tightness — revert if red).
- **OUTCOME 2026-07-09: tried `effort: medium` (key confirmed supported), REVERTED after
  one measured run** — gates stayed green but cost/request rose (83K→95K ctx-weighted) and
  total input paid nearly doubled vs the un-pinned complete run. n=1 and confounded by a
  spelunking episode, so eligible for a clean re-test after the doc lifts; not shipped.

**A4. App-cheatsheet stage (shared pre-digestion)** — reason 3, concrete item 4,
mitigation 2. Nine page agents each bought the same education.
- Files: `claude/skills/sprig:build/SKILL.md` (new step between 1 and 2) + optionally a new
  `claude/agents/sprig-build-analyst.md` mirroring `rune-build-analyst` (fleet-efficiency
  convention: artifacts-on-disk, one digester → N readers).
- Shape: for multi-unit builds (≥3 units), one cheap agent digests ONCE into
  `spec/misc/build/cheatsheet.md` (≤3KB): per-component prop APIs as built, the store/DI
  seams, the resolve contract line, tokens path, the 8 fact lines. Builders get the
  cheatsheet PATH in their brief **instead of** the references list; references demote to
  failure-time-only.
- Verify: scorecard `reads_unpassed_per_agent` 9.75 → ≤2 and `discovery_per_agent` → ~0
  on the guestbook scenario; templates.md/component-model.md read counts → ~1 each
  (the analyst's).

## Wave B — CLI / product (code; shrinks tool-result slope)

**B1. `--json` stdout hygiene** — mitigation 3, and the cause of every "first brace" hack.
- Files: `cli/commands/test.ts`, `cli/commands/list.ts` (wherever the in-process Danet
  boot logs reach stdout — DiscoveryModule/TestingModule Router lines).
- Change: in `--json` mode route ALL non-report output (Danet logger, route-audit,
  deprecation warnings) to stderr so stdout is exactly one JSON document.
- Verify: `isolate test --json | python3 -m json.tool` round-trips; the eval gate's
  first-brace scan becomes a plain `json.loads`.
- **OUTCOME 2026-07-11: SHIPPED.** The action-level reroute could never catch the
  IMPORT-TIME Danet boot logs (module-scope bootstrap runs before any action), so the fix
  is `cli/lib/json-stdout.ts` — main.ts's FIRST import, which reroutes console.log/info/
  debug → stderr when `--json`/`-j` is in Deno.args and exposes `emitJson()` (raw stdout)
  for the one report document. Verified: `isolate test --json | python3 -m json.tool`
  round-trips. (list.ts has no --json yet; the guard covers it for free when it grows one.)

**B2. Failures-only report mode** — mitigation 3. A 284-test JSON re-paid every turn.
- Files: `server/src/core/business/runner/mod.ts` (report already computed),
  `cli/commands/test.ts` (flag).
- Change: `isolate test --json --failures-only` → full counts + `testResults` filtered to
  `ok:false` (cap error text ~200 chars each, as `printReport` does). Then update the agent
  def's verify loop to use it once a unit has >5 cases.
- Verify: unit test on the trimmed shape; transcript tool-result sizes for test runs drop
  from tens of KB to <2KB.

**B3. Pixel-diff endpoint (numbers before megabytes)** — reason 2 fix 2, concrete item 5.
- Files: `server/src/core/business/` (new business module + `/http/post-case-diff` route
  beside post-test-run), CLI surface `isolate diff <unit> [case] --json`.
- Shape: input `{ unit, case, reference }` (reference defaults to the breakdown
  screenshot path from the spec folder) → `{ score, regions: [{x,y,w,h,delta}] }` via
  playwright screenshot + pixelmatch in the pre-provisioned runner.
- Agent-def integration (after it ships): "diff numerically each iteration; only Read the
  image when the score fails" — replaces most of A2's manual discipline.
- Verify: fleet `png_reads` → near 0 on green paths; guestbook eval time-per-unit drops.
- Size: the one real feature in this plan — spec it briefly in `coordinate.md` first.

## Wave C — structural / process

**C1. Release checklist: refs versioned with the framework** — reason 1 fix, concrete
item 2. `0.20.29` shipped an API expectation the refs didn't carry.
- File: `README.md` (or wherever the publish steps live — root `deno.json` `publish` block
  is the anchor) + a `deno task` lint if cheap: block publish when
  `framework/.sprig/core.ts` public types changed without a same-commit change under
  `claude/skills/*/references/`.
- Verify: dry-run the check against the 0.20.29 commit — it should have fired.

**C2. Staged build→verify/fix split (experiment)** — mitigation 1/5, concrete item 6.
Quadratic says halving the 300-turn monolith ~quarters input.
- **STATUS 2026-07-10:** implemented as skill text (SKILL.md "Long-unit split" rule +
  builder-def `checkpoint` contract) after verifying the harness does NOT expose API
  context-editing (guide-agent, code.claude.com docs) — T-cuts and slope-cuts are the only
  in-harness levers. A/B pending on the guestbook scenario; adopt-if-≥2× criterion stands.
- Prototype ONLY behind the guestbook scenario: split `sprig-build-component` into
  build (author files + isolate cases, return structured `{unit, cases, red[]}`) →
  fix (fresh agent, gets the red findings INLINED, never re-discovers). Keep the monolith
  def; add the split as an orchestrator option in SKILL.md for page compositions
  (the measured heavy class: 250–345 turns).
- Verify: A/B on skill-eval — `total_input_tokens_paid` per page unit (census metric),
  gates stay green. Adopt only if the census shows ≥2× input reduction.

## Measurement (instruments before claims)

**M1.** Extend `tooling/skill-eval/analyze/scorecard.py` with the census columns the report
already defined: `png_reads`, `image_KB`, `total_input_tokens_paid`, `final_ctx_K` per
role (the format exists in `evidence/per-agent-census.tsv`). Budgets to start: png_reads
≤ case count, image_KB ≤ 300/agent.
**M2.** Re-run `sprig-build-guestbook` after each wave; the report's infra fleet numbers
(608M input, 76M/page) are the before; the census TSV format is the comparison artifact.
**M3.** Order of landing: A1–A4 together (one eval run), then B1+B2 (one run), then B3,
then the C2 experiment. C1 is process, anytime.

## Explicitly out of scope here (report reason 4 — not sprig-owned)

Session-limit kills losing in-flight agents (journaling belongs to the Workflow harness),
and the repair-wave orchestration that fanned out 15 agents without inlining failures —
that's session conduct, already partially addressed by SKILL.md's briefing rule; the rest
lives in the harness, not this repo.
