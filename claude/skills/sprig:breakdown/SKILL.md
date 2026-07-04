---
name: "sprig:breakdown"
description: >-
  Decompose a UI mock into a build-ready spec — page inventory, shared/page-local
  components, design tokens, the contract binding (component → endpoint → DTO
  against the ratified backend contract; the implied data model only when no
  contract exists), the interaction-tier map
  (which regions are static vs islands) with feedback and
  liveness, motion specs with jank findings, cropped screenshots and animation
  filmstrips, and ready-to-drop-in isolate fixture proposals — so a sprig +
  isolate build session can rebuild the UI mechanically. Use whenever the user points at a mock, prototype,
  reference UI, or finished HTML/screenshot/PDF design and wants it broken down,
  spec'd out, decomposed, reverse-engineered, or turned into components —
  phrases like "break this down", "do a ui-breakdown", "spec this mock", "turn
  this into components", "prep this for the rebuild". Trigger even when they
  don't say "spec": pointing at an HTML mock and asking how to rebuild it in
  sprig counts.
---

# breakdown — orchestrate mock → build spec

> **Pipeline stage — breakdown.** Consumes `prototype` (`../interfaces/prototype.md`);
> produces the `ui-breakdown` contract (`../interfaces/ui-breakdown.md`), consumed by `build`.
> Full chain: design → prototype → breakdown → build → audit.

Produce a `spec/ui/breakdown/` directory a later build session can work through
**mechanically**: scaffold a component, drop in its proposed `isolate/`, run
`sprig isolate`, diff against the screenshots, write tests from the Events section,
repeat. The spec must let someone rebuild each page/component **without opening the
source** — judge every decision by that standard.

**You are the orchestrator. You don't survey, render, or write specs yourself — you
delegate each pass to a named specialist**, hand it its input contract, and chain the
artifacts. The rebuild target is **sprig** (Deno SSR, Angular-flavored templates,
folder-components, island hydration, Tailwind v4) — **not Fresh/Preact/Next/Angular**;
source JS/CSS is reference ground truth, not deliverable.

## The specialists you delegate to

| Agent | Pass | Returns |
|---|---|---|
| **`sprig-breakdown-analyst`** | survey, page+component census, static/island classification + tiers, `design-tokens.md`, the contract **binding** (`spec/contract/binding.md`; legacy `data-model.md` when no contract) (opening); `index.md` + completeness audit (closing) | the written docs + a structured **inventory** of pages/components |
| **`sprig-breakdown-capture`** | render the mock: cropped stills, breakpoint/theme shots, motion extraction, filmstrips, `jank.md`, jank lints, extracted `js/`/`css/` | evidence files + extracted motion specs, jank findings, real data values |
| **`sprig-breakdown-spec-writer`** | per component/page: the `.md` anatomy + the real runnable `isolate/` fixtures | the unit's spec files + case list |

Each specialist owns its own procedure — **do not restate the classification rubric,
capture recipes, or component anatomy here.** They live in the agents and in
`references/{capture-recipes,isolate-format}.md` (the agents read them).

## Input & output

- **Input** — the prototype this skill consumes: by default the two-seam
  `spec/ui/<app>-prototype/` folder (glob `spec/ui/*-prototype/`; legacy
  `spec/ui/*-prototype.html`). If the user points at a different mock (any
  HTML/screenshot/PDF), use that. When a ratified contract exists at the git root
  (`spec/contract/`, or `spec/runes/*.rune`), it is ALSO input — the data seam binds
  against it (bridge 2).
- **Output** — always `<git-root>/spec/ui/breakdown/`, and nowhere else. Resolve the git
  root **once** with `git rev-parse --show-toplevel` and build the path from it
  (`"$(git rev-parse --show-toplevel)"/spec/ui/breakdown`); create `spec/ui/` if absent.
  Derive the path automatically; never ask. Every artifact this skill and its agents
  produce — the `.md` specs, `isolate/` folders, and **every screenshot / filmstrip PNG** —
  lives under that one directory. The directory shape is the `ui-breakdown` contract
  (`../interfaces/ui-breakdown.md`).
- **NEVER search the filesystem for a breakdown artifact.** You always know where it is:
  under `<git-root>/spec/ui/breakdown/`. Do not run `find /`, `find ~`, or any whole-disk
  / home-dir scan to locate a screenshot or output file — that pins every CPU core for
  minutes. If a file you expect isn't at its known path, it wasn't written there; re-derive
  the path from the git root or re-run the step that writes it. Scope any legitimate lookup
  to `<git-root>/spec/ui/breakdown` (e.g. `find "$(git rev-parse --show-toplevel)/spec/ui/breakdown" -name '*.png'`).

## The flow

1. **Analyze (opening).** Delegate to **`sprig-breakdown-analyst`** (phase `opening`) with
   the source + output dir → it surveys, does the page/component census, classifies every
   region (static vs island vs page-composition, with tiers), and writes `design-tokens.md`
   + the contract **binding** (`spec/contract/binding.md`; legacy `data-model.md` when no
   contract exists). Take its **inventory** (every page/component with classification,
   tier, shared/local, renderable?) and surface any **drift errors** it reports.
2. **Capture** (renderable sources only). For the renderable units in the inventory,
   delegate to **`sprig-breakdown-capture`** (fan out per unit in one message, multiple
   Task calls) → stills/breakpoints/themes, extracted motion specs, filmstrips, `jank.md`,
   jank findings, extracted `js/`/`css/`, and the real captured data values. (Skip for
   image/PDF sources — there's nothing to render.)
3. **Write specs.** For each component and page, delegate to **`sprig-breakdown-spec-writer`**
   (fan out per unit) with that unit's classification (from step 1) + its evidence (from
   step 2) → its `<name>.md` (anatomy + Isolate build plan) and its real, runnable
   `isolate/` folder.
4. **Close.** Delegate to **`sprig-breakdown-analyst`** (phase `closing`) with the list of
   specs produced → `index.md` (inventory, usage matrix, build order, tier summary,
   Unassigned) + the completeness audit. The **Unassigned list ships even when empty.**

Independent units within steps 2 and 3 run concurrently; respect that step 3 needs step
1's classification and step 2's evidence for each unit.

## Source-type routing

- **Self-contained HTML / folder of HTML files** — the full pipeline above.
- **Images / PDF** — visual analysis only: tell the analyst to describe instead of extract,
  **skip the capture stage entirely**, and tell the spec-writer to mark every inferred
  section "described, not extracted — verify during build" and never fabricate evidence.
  Scale the whole output to the evidence available (one screenshot → one page folder).

## Rules

- **You delegate; you do not perform a pass.** Hand each specialist its contract and
  summarize its return between hops.
- Classify by **does it need a `logic.ts`**, not "interactive vs not": default **static**,
  justify every island, spec server writes as **optimistic UI** (snapshot → mutate → call
  → roll back). Performance is the build's job; here only flag expensive data *shapes*.
- Page-local by default; promote to `shared-components/` only with evidence.
- **Bind, don't re-derive** (bridge 2): with a ratified contract at the git root, every
  data-need binds to a real endpoint + DTO in `spec/contract/binding.md`; a mismatch is a
  **drift error** surfaced in `index.md`, never papered over with an invented schema.
- **Extract over describe** wherever the source is readable; schema (never data rows) in
  the binding / legacy `data-model.md` and prose — case JSON is the one place real
  captured values belong.
- Proposed `isolate/` folders are **real files** `sprig isolate` discovers, not docs.
- The `index.md` audit list ships even when empty ("Unassigned: none").
