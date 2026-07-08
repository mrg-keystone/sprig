# optimize.md — brief for the sprig skills/agents optimization pass

## The prompt (paste this to the agent)

> Read /Users/raphaelcastro/Documents/programming/tooling/sprig/optimize.md end to end and execute
> it. It contains everything you need — every path, every convention, every verification step.
> Work autonomously; verify each phase with the greps/gates it specifies before moving on; keep the
> depth-tier ledger honest (principles-applied vs eval-validated). If a fact in this brief
> contradicts what you find on disk, trust the disk, note the drift in suggestions.md, and proceed.

---

## Context: what this is and why

In July 2026 we forensically analyzed ~116K API requests of rune/sprig agent-fleet transcripts and
found the fleets wasting most of their spend on: filesystem discovery (agents re-finding what the
parent knew), broadcast megaprompts, per-test validator explosions, rate-limit retry storms, and
poll-sleeping orchestrators. We distilled the fixes into principles, applied them to the **rune**
pipeline, and validated them with a live Dockerized eval loop — result: a module build went from
620 agents (historical) to 8, all gates green, ~zero discovery in the high-volume roles.

Your job: **finish the same work for sprig** — complete the principle coverage across every sprig
skill/agent, then stand up sprig's eval scenarios and iterate until the budgets are green without
ever trading away a correctness gate.

Read these first (in order, they're short):
1. `/Users/raphaelcastro/Documents/programming/tooling/suggestions.md` — the full findings ledger,
   every principle with its measured evidence, rounds 1–5.
2. `/Users/raphaelcastro/Documents/programming/tooling/skill-eval/README.md` — the eval harness.
3. `/Users/raphaelcastro/Documents/programming/tooling/rune/claude/skills/rune:build/SKILL.md` +
   `rune/claude/agents/rune-build-{validator,test-author,scaffold}.md` — the fully-treated
   reference examples of what "done" looks like.

## The principles (each has measured evidence in suggestions.md)

1. **Brief completely; agents never search.** Every path passed absolute, copied verbatim from a
   stage return. Missing path → agent returns `blocked: <path> missing`, never hunts.
2. **Facts inline, bulk behind pointers.** Shared facts (ports, binaries, postures, alias names)
   resolved ONCE upstream and inlined (≤8 lines) into every fleet prompt; big shared content lives
   in artifacts structured for partial reads (sectioned, per-unit).
3. **Verified recipe in the def.** High-volume agents carry a 10–20-line REAL code example (lifted
   from a fixture that passes, never invented) covering the API questions they'd otherwise
   research. Knowledge boundary: "your def + your slice + named references — never another skill's
   SKILL.md."
4. **Receipt verification.** A tool's own printed/JSON output IS the state (isolate runner
   verdicts, build output, a writer's own write-list). Never re-`ls`/re-shoot/re-run to confirm
   what a receipt already says. The designated lister builds the census once; everyone reads it.
5. **Orchestrator conduct.** End turn after spawning (notifications re-invoke; never sleep-poll —
   measured 32% of wall time). Never search the filesystem (a measured orchestrator ran `find /`).
   Ledger in plan text for ≤15-agent fleets (measured: 20 API turns of TaskCreate ceremony).
   Mid-build fixes re-route through the owning specialist, never run inline.
6. **Concurrency 4–6, chunked waves; PORT per agent** (measured: 10+ concurrent tripped org rate
   limits → whole-agent re-execution, ×4.2 waste; 174 `pkill`s from port wars).
7. **Model pins, never `inherit`, on fleet roles** (sonnet mechanical / opus judgment; measured:
   444 validators inherited the priciest tier for 7 real bounces). Seqthink MCP only on genuine
   judgment roles.
8. **Accuracy outranks tightness.** Never suppress a search by prohibition alone — replace it with
   a MORE authoritative source. A run failing any correctness gate FAILS, whatever its token
   profile. Doc-reality drift (docs claiming what the tool doesn't do) is a discovery generator —
   fix the doc or the tool, never paper over.

## What is ALREADY DONE for sprig — verify, don't redo

Run these from `/Users/raphaelcastro/Documents/programming/tooling/sprig/claude/`:

- `grep -l "BUILD BRIEF" agents/sprig-build-scaffolder.md skills/sprig:build/SKILL.md` — scaffolder
  emits a fact-pack; sprig:build inlines it.
- `grep -l "The recipe (verified" agents/sprig-build-component.md agents/sprig-breakdown-spec-writer.md`
  — verified recipes (from `fixtures/sprig-app`) are in.
- `grep -l "Knowledge boundary" agents/sprig-build-component.md agents/sprig-breakdown-spec-writer.md agents/sprig-audit-root-cause.md`
- `grep -l "SERVE" agents/sprig-breakdown-capture.md skills/sprig:breakdown/SKILL.md` — serve facts
  passed, not rediscovered; capture also owns per-unit `source.html` extraction.
- Conduct/no-sleep/never-search blocks exist in `sprig:build`, `sprig:breakdown`, `sprig:audit`
  SKILLs; briefing rules + resolved-path contracts in component/spec-writer/hunter/root-cause/
  cake-equivalents; model pins on all agents (design-author, prototype-builder, audit-hunter stay
  `inherit` deliberately — low-volume judgment/creative).
- `interfaces/ui-breakdown.md` documents `source.html` in the unit folder.

## Phase A — complete the coverage (mirror rune's round 5)

1. **Conduct blocks** for the two skills that lack them: `skills/sprig:design/SKILL.md` and
   `skills/sprig:prototype/SKILL.md`. Use the same 3-bullet block as the other skills (grep one to
   copy the exact text); tailor: sprig:design runs a 3-stage chain (author → deriver → verifier) —
   add a bullet that the orchestrator passes the artifact dir + theme.css path down the chain;
   sprig:prototype is a single builder — the never-search bullet + "the proto-host template lives
   at `~/.claude/skills/sprig:prototype/assets/proto-host/` — pass that path, never find it".
2. **Blocked-don't-search contracts** (one sentence at the end of each Input-contract section, same
   wording as `agents/sprig-audit-root-cause.md`'s) for the agents missing them:
   `sprig-design-author`, `sprig-design-deriver`, `sprig-design-verifier`,
   `sprig-prototype-builder`, `sprig-audit-fixer`, `sprig-audit-validator`,
   `sprig-breakdown-analyst`, `sprig-build-scaffolder`.
3. **Knowledge boundaries** for the same list (their def + their inputs + named references; never
   another skill's SKILL.md).
4. **Receipt rules** for the design chain: deriver's receipt = its own byte-consistency checks
   against theme.css; verifier's receipt = its screenshots (looking IS the test — one shot per
   theme, never re-shot on a verdict it holds). Audit-fixer: fixes.md checkboxes + its own verify
   command output are the receipt; audit-validator: its re-run results.
5. **Seqthink removal** from the two mechanical audit roles' `tools:` lines —
   `sprig-audit-fixer.md`, `sprig-audit-validator.md` (checklist-appliers). KEEP it on hunter and
   root-cause (judgment). Soften any "think step by step with the MCP" body line to "reason
   inline".
6. **CAUTION:** the `<!-- BEGIN sprig-agent-guardrail -->…<!-- END -->` blocks are AUTO-SYNCED by
   `deno task sync:agent-guardrail` from `scripts/agent-guardrail.md` — never hand-edit inside the
   markers. Don't reformat anything you aren't changing. Verify Phase A with greps mirroring the
   "already done" section, and run `deno task check:agent-guardrail` at the repo root if present.

## Phase B — eval loop (this is what promotes "principles-applied" to "validated")

Harness: `/Users/raphaelcastro/Documents/programming/tooling/skill-eval/` — read its README.
Mechanics you should NOT rediscover:
- `runner/run.sh <scenario> [-n N] [--ref SHA] [--model M] [--build]` — orchestrator defaults to
  opus; repo snapshots rsync from the working tree per run (skill edits need no rebuild; entry.sh
  edits DO need `--build`); auth is exported from the macOS Keychain per run; results land in
  `results/<scenario>/<run-id>/` (scorecard.json, gates.json, transcripts/, workspace.tgz,
  stream.jsonl); `tail -f` the stream to watch live; every run appends to the scenario's index.md.
- `analyze/scorecard.py` scores per-role discovery/prompts/ctx/retries against
  `analyze/thresholds.json` (sprig role budgets already exist). Role names come from the agents'
  meta `agentType` (see AGENT_TYPE_ROLES in scorecard.py).
- Cost: mini-scale runs ≈ $3–5 each on the user's plan (overage billing — keep scenarios SMALL).

Build in this order:
1. **`docker/Dockerfile.sprig`** — extend Dockerfile.rune's pattern: + `npx playwright install
   chromium --with-deps` and PRE-PROVISION `~/.isolate-runner` (the isolate CLI's `ensureRunner()`
   npm-installs `@playwright/test` + `rxjs@^7` on first use — do it at image build so eval runs
   don't npm-install; see `sprig/cli/lib/runner.ts`). sprig needs Node+npm on PATH (base image has
   them). The sprig CLI runs from the mounted snapshot: `deno run -A /repos/sprig/framework/cli.ts`
   (shim it like the rune shim); the standalone isolate CLI is `/repos/sprig/cli/main.ts`
   (`isolate test [filter] --json` = the headless gate; it spawns its own server, or `--base-url`).
2. **Scenario `sprig-breakdown-hearth`** — fixture:
   `sprig/fixtures/eval-app/spec/ui/hearth-prototype.html` (20K self-contained mock). GOLDEN
   expected output exists at `sprig/fixtures/eval-app/spec/ui/breakdown/` (guestbook page +
   message-card/message-composer components + isolate cases). Gates: ui-breakdown contract shape
   (index.md with Unassigned list; per-unit `<name>.md` + parsable `isolate/fixture.json` +
   `source.html`); unit census ≥90% name-match vs the golden; spec-writers' transcripts show zero
   full-mock reads (grep the scorecard's unpassed-reads).
3. **Scenario `sprig-build-guestbook`** — seed the golden breakdown + a scaffolded app shell; build
   the guestbook units to green; gates: `deno task build` exit 0 in the app, `isolate test --json`
   all green, no `pkill` in any transcript.
4. **Scenario `sprig-audit-bullshit`** — fixture `sprig/fixtures/bullshit-app` (boot:
   `deno serve -A --unstable-kv serve.ts` after `sprig build .`; mounts `/ui`; no README). Planted
   bugs are documented in its `fixes.md`: B1 soft-404 on `/ui/widget/:id`, B2 dead like-button
   island (no logic.ts), B3 counter hydration wipe, B4 favicon 404. Gates: recall ≥3/4 with real
   `file:line`s, zero fabricated locations, hunter never `lsof`/restarts the server.
5. **Iterate**: after each run, read the failing budgets, spot-read those agents' transcripts in
   `results/.../transcripts/`, fix the SKILL/agent def (or the scenario/harness if the finding is
   environmental), append the finding + fix to `suggestions.md` (rounds continue from 5), re-run.
   n=1 wiggles in per-role numbers are noise; fix only what the transcript shows as a mechanism.

## Rules of engagement

- Evidence discipline: every claim you write into suggestions.md cites a run-id + transcript
  behavior. Historical baselines for sprig fleets (for your before/after tables) are in
  suggestions.md rounds 1–2 (652 "glob for it" prompts, 207 full-mock reads, 174 pkills).
- Don't touch: `sprig/claude/skills/sprig:prototype/design-lint/` (a bundled engine),
  `proto-host/` template internals, anything under `fixtures/` except ADDING eval fixtures,
  model pins, and the auto-synced guardrail blocks.
- The user's spend cap can trip mid-run ("You've hit your monthly spend limit") — a run that dies
  harvests its workspace; resume with `--resume-from <run-dir>` + a continuation scenario rather
  than rebuilding (see `scenarios/rune-build-mini-resume/` for the pattern).
- Update `/Users/raphaelcastro/.claude/projects/-Users-raphaelcastro-Documents-programming-tooling/memory/fleet-efficiency-conventions.md`
  with any NEW convention a round establishes.
- When done, report: coverage greps (Phase A), the run ledger + final scorecards (Phase B), the
  updated suggestions.md rounds, and the honest depth-tier statement (what's validated vs applied).
