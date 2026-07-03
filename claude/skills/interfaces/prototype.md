# Contract: prototype

> **Producer:** prototype · **Consumers:** breakdown (the build spec) + `rune:spec` (ratifies
> the seams — bridge 1 of [`contract.md`](../../../contract.md)) · Pipeline: design →
> prototype → breakdown → build → audit

ONE self-contained, throwaway **two-seam prototype folder** that shows the complete
look-and-feel and main flow — and carries the draft backend contract **pre-extracted**. The
thing `breakdown` decomposes into a build spec, and `rune:spec` seeds from.

## Artifact
A folder **`spec/ui/<app>-prototype/`** (the shared UI-pipeline home at the git root):

- `_test-prototype.html` — presentation ONLY (fixed name; the host serves it). CDN scripts,
  no build step, holds no data.
- `objects/<type>.json` — **seam 1, the read model**: one file per object type; the file is
  that type's collection (an array of id-related records, joined client-side).
- `commands.json` — **seam 2, the write contract**: intent verbs
  `{ type, kind, input, does }` with `kind ∈ create|set|append|adjust|remove` — never an
  editable record.
- `_start.ts` + `deno.json` — the **generic host, copied verbatim** (`deno task start` →
  `http://localhost:8723`, `PORT` overrides). Injects `window.objects`/`window.commands` +
  the annotate overlay at serve time; introspects the contract over HTTP (`GET /objects`,
  `GET /commands`, `GET /events`); appends every applied command to `events.json`.
- `feedback/` — the annotate sink (`feedback.json`).

**Legacy shape** (pre-contract): a single self-contained `spec/ui/<app>-prototype.html`
with hardcoded data — still valid breakdown input; new prototypes use the folder.

## Shape (what consumers can rely on)
- **Renderable with Playwright** — start the host (`deno task start` in the folder),
  navigate `http://localhost:8723/`; breakdown walks the DOM, extracts tokens, captures
  screenshots/filmstrips. A host restart is a clean reset (seed files stay pristine), so
  captures reproduce.
- The **design-system brand applied** — daisyUI semantic classes + `data-theme`, via the
  CDN stack (daisyUI + `@tailwindcss/browser@4` + lucide).
- **Every screen of the flow is present**, including the unglamorous states (empty,
  loading, error/toast, overflow). Multiple "pages" are expressed via client-side routing,
  so breakdown counts **views, not files**.
- **The seams ARE the draft contract** (bridge 1): each `objects/<type>.json` maps to a
  backend type + read DTO + query endpoints (`<type>.all`, `<type>.get`); each
  `commands.json` entry maps to a command verb + input DTO, its `kind` seeding
  `rune:data`'s immutability strategy. Introspectable over HTTP without opening a file.

## Invariants
- **Location:** `spec/ui/<app>-prototype/` (glob `spec/ui/*-prototype/`; legacy glob
  `spec/ui/*-prototype.html`).
- The UI holds no data and makes no `fetch` beyond the two injected seams; writes are
  intent verbs, **never an "edit-this-record"** (the waist rule).
- The host is generic and never edited per-app; seed data is deterministic (screenshots
  reproduce).
- It is **throwaway** — reference ground truth for the spec, never deliverable code. The
  seams' *content* is the one part that survives: `rune:spec` ratifies it into the
  canonical contract.

## Validation
`deno task start` serves it; every flow + unglamorous state is reachable by clicking;
`GET /objects` and `GET /commands` return the two seams.
