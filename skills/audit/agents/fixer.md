# Fixer — stage 3 agent brief

Spawn **one** agent with this brief plus `fixes.md`. It works the checklist
**top-down, one issue at a time**, editing the app's source to apply each fix and
ticking the box. One-at-a-time is deliberate: parallel edits collide, and doing them
in sequence lets each be sanity-checked before the next so a later change can't mask
whether an earlier one worked. The validator re-proves everything afterward; the
fixer's job is to make correct, minimal, anchored changes — not to guess.

## The brief to paste

```
You are the fixer on a Fresh 2 app audit. Apply the fixes in fixes.md, ONE AT A
TIME, top-down (blocker → low). Think step by step: for each issue, re-read its root
cause, make the smallest correct change, confirm the immediate path, tick the box,
then move to the next.

PROJECT ROOT: <abs path>
FIXES: <project>/fixes.md   (each section has Root cause @ file:line, Fix, Verify)
SERVER: <running base URL — for a quick self-check only; full validation is a later
  stage on a fresh server>

FOR EACH issue, in order:
1. Re-read the section's Root cause and Fix. Open the cited build reference
   (e.g. references/advanced/error-handling.md) and apply THAT canonical pattern —
   do not invent a Fresh API or reach for a Fresh-1 / Next.js habit. The fix should
   be minimal and match the surrounding code's style.
2. Make the edit at the named file:line. Keep the change scoped to this issue; don't
   opportunistically refactor unrelated code.
3. Quick self-check that the immediate path works (the page renders, the type
   checks, `deno check` is clean for the file you touched). You don't need to run the
   full Verify here — the validator does that on a fresh server — but don't leave the
   app broken.
4. Tick the box: change `### ☐` → `### ☑` and append a one-line `**Fixed**` note
   under Verify saying what you changed (file:line) so the diff is self-documenting.
5. Next issue.

GUARDRAILS
- A fix that is risky, ambiguous, or where the root cause looks wrong: do NOT
  guess-edit. Leave the box ☐ and append `**Deferred** — <why; what you'd need>`.
  A correct unfixed issue beats a confident wrong edit.
- Adding or removing an island/route file means the dev server's island registry
  drifts — note `**Needs server restart**` on that issue so the validator restarts
  fresh (it does anyway, but flag structural changes).
- Don't touch anything not tied to a fixes.md issue. Don't delete the evidence dir.
- Structural changes (new files, moved routes) are fine when the fix requires them;
  say so in the Fixed note.

When done, return a short summary: which issues are ☑ fixed, which are ☐ deferred
(and why). Ideally you are on a dedicated branch so the whole audit is one diff.
```

## Notes for the orchestrator

- The fixer edits the user's real source. A dedicated git branch (created before
  spawning it) keeps the audit reviewable and reversible — prefer it.
- Deferred issues don't fail the pipeline; they surface in the final report as
  "fixed N, deferred M (reasons)". Decide whether to re-open ROOT-CAUSE for a
  deferred-because-misdiagnosed item.
