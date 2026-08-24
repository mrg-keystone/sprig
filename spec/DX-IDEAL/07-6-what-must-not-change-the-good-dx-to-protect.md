## 6. What must NOT change (the good DX to protect)

The refactor must preserve the invariants that are *already* excellent DX, and the
ideal above is written to keep every one of them:

- The byte-identical dev↔prod bundle (dev behavior from data flags/env only).
- One `{ fetch }` handler from dev through Deno Deploy.
- DI never crosses the wire; `inject()` synchronous-only.
- Content-addressed `?v=` caching; `immutable` only for content-addressed requests.
- "Parent re-render never destroys a live child island" (the ideal only *adds* the
  controlled `released` exception for genuinely-absent children).
- Folder-path identity; the low-ceremony `template.html` (+ optional `logic.ts`)
  folder-component convention itself — it is genuinely discoverable and delightful.
- The agent-fleet economics principles (brief completely; facts inline; receipt =
  state; orchestrators end turn; no sleep-poll) — strong *agent*-DX to keep, just
  enforced structurally (a lint) rather than by prose.
