# Bug-fix working conventions (read this first)

Goal: for EVERY bug assigned to you, (1) write a test that **fails on the current
code**, (2) fix the source so the test passes, (3) confirm it passes. A bug is only
"done" when its test exists, fails-before / passes-after, and the fix is real.

## Where the bug specs live
`buglist.md` (repo root). `bugs/INDEX.txt` maps each bug number to exact line ranges:
```
<n> report=<start>-<end> rca=<start>-<end>
```
Read the `report=` range for symptom/repro/expected/actual, and the `rca=` range for
the precise root cause + **Root locus** (file:line of the real defect). Use the Read
tool with offset/limit on `buglist.md` — do NOT read the whole 680KB file.

## Test files
- Put ALL your tests in ONE file named `bugs/<your-group-id>.test.ts` (e.g.
  `bugs/g1-scope.test.ts`). One `Deno.test(...)` per bug, named `bug NN: <short>`.
- Run ONLY your own file while iterating: `deno test -A bugs/<your-group-id>.test.ts`.
  (Running the whole suite concurrently with other agents causes noise.)
- Prefer the **smallest real seam**:
  - compiler/CSS/pipe/interpreter bugs → import the function directly and assert.
    Patterns: see `ui/.sprig/compiler/compiler.test.ts` (parseTemplate, evalExpr,
    renderNodes, scopeCss, etc.).
  - HTTP/SSR/asset/method/status bugs → `import handler from "../serve.ts"` and drive
    `handler.fetch(new Request(...))`. Patterns: see `spine.test.ts`.
  - backend logic bugs → boot in-process. Patterns: `backend/src/board/entrypoints/http/e2e.test.ts`.
  - genuinely browser-only bugs (real DOM focus/observer/soft-nav) → follow
    `hydration.test.ts` (playwright). Only use a browser if the bug is impossible to
    observe at a smaller seam.
- Each test MUST be a true regression test: assert the corrected behavior. Before
  writing the fix, run the test and SEE it fail (paste the failure into your notes).
  After the fix, SEE it pass. Never write a test that passes against buggy code.

## Editing rules
- Edit ONLY the source files your group owns (listed in your prompt). If a fix
  genuinely requires a file owned by another group, DO NOT edit it — record it in
  your returned `notes` as a cross-file dependency for the reconciliation phase.
- Keep fixes minimal and in the style of surrounding code. Match existing idioms.
- Do not weaken or delete existing passing tests (`spine.test.ts`, `compiler.test.ts`,
  `hydration.test.ts`, `e2e.test.ts`, `int.test.ts`). They must all still pass.

## Definition of done for your group
`deno test -A bugs/<your-group-id>.test.ts` is fully green, every assigned bug has a
dedicated failing-before/passing-after test, and you did not break existing tests.

## Use sequential-thinking
Per repo instruction, reason step by step with the sequential-thinking MCP, and back
every "fixed" claim with the actual test output (evidence, not assertion).
