# Contract: ui-breakdown

> **Producer:** breakdown · **Consumer:** build · Pipeline: design → prototype → breakdown → build → audit

A **`spec/ui/breakdown/`** directory detailed enough that `build` can rebuild each page and
component **mechanically, without opening the source.** This is the **translation boundary**:
whatever the source used (daisyUI, inline styles, bespoke CSS), what crosses into `build` here is
framework-neutral **tokens + specs**.

## Artifact — directory shape
```
spec/ui/breakdown/
├── index.md              # page inventory, usage matrix, build order, interaction tiers, Unassigned list
├── design-tokens.md      # palette, type, spacing, radii, shadows, easing → Tailwind 4 @theme
├── data-model.md         # LEGACY fallback only (no ratified contract) — the implied backend schema;
│                         #   with a contract, the data seam is spec/contract/binding.md instead (see Shape)
├── assets/               # images/fonts/svgs lifted from source
├── shared-components/<name>/   # used on >1 page
│   ├── <name>.md         # the component spec (see "Each component spec carries")
│   ├── isolate/          # real fixture.json + cases/<state>/<state>.json
│   ├── screenshots/      # the diff target (+ filmstrip.png/jank.md if animated)
│   └── source.html       # the unit's extracted markup region (+ js//css/) — breakdown-internal
│                         #   reference ground truth; build diffs against screenshots, not this
└── pages/<page>/
    ├── <page>.md, isolate/, screenshots/   # pages isolate too: real fixture.json + cases/
    └── components/<name>/   # page-local components (same shape)
```

## Shape (what `build` can rely on)
- **The data seam is a BINDING, not a re-derived schema** (bridge 2 of the cross-repo
  [`contract.md`](../../../contract.md)): when a ratified contract exists at the git root
  (`spec/contract/openapi.json`, or `spec/runes/*.rune` / a running keep's `/docs/<m>/json`),
  breakdown writes **`spec/contract/binding.md`** — every component/page data-need bound to a
  real endpoint + DTO (reads → **query** endpoints, writes → **command** verbs). A data-need
  with **no matching endpoint/DTO is a drift error**, listed in the binding and surfaced in
  `index.md` — checkable at breakdown time, not a runtime surprise. `data-model.md` is the
  **legacy fallback**, written only when no contract exists (standalone mock breakdowns).
- **Tokens are Tailwind v4 `@theme` custom properties** — NOT a `tailwind.config.js`, NOT daisyUI.
  Build puts them in a `:global(...)` `@theme` block (usually `shell/styles.css`) and styles with
  **Tailwind utilities** + component-scoped `styles.css` (the daisyUI→Tailwind translation already
  happened *here*); `sprig build` runs Tailwind v4 over the templates + CSS. Every theme variant included.
- **Each component spec carries:** classification (`static` | `island` | `page-composition`) +
  the interaction tier (static / island; server writes are **optimistic UI**, realtime where
  needed); anatomy; a props table (1:1 with `fixture.json` controls, `signal: true` for island
  state); states→cases; **Events** as `capture(page)` predicate sketches; **Motion extracted**
  (real keyframes/easing + jank fixes — reproduce, don't reinvent); responsive; a11y; and an
  **Isolate build plan** — the build-in-isolation recipe (folder + selector, the preview route(s),
  per case the screenshot to diff against, the Events→`tests/` mapping, and the `sprig isolate` →
  diff → test → iterate loop) so the build session can stand the thing up alone from the spec.
- **`isolate/` proposals are real and runnable** (`fixture.json` + `cases/<state>/<state>.json`),
  discoverable by `sprig isolate`, for **every component AND every page** (pages isolate too); a
  component is a **folder** (`template.html` + optional `logic.ts`), its **basename the selector**
  — no `.tsx`. Case JSON carries the **real captured values** the screenshot shows.
- **`index.md` carries the build order** (tokens → shared components → page-local → page
  compositions), the interaction-tier summary, and an **Unassigned list that ships even empty**.

## Invariants
- **Location:** `spec/ui/breakdown/` (sibling to `spec/ui/design-system/` and the
  `spec/ui/<app>-prototype/` folder — or the legacy `spec/ui/<app>-prototype.html`).
- A reader could rebuild from the spec alone, without the source.
- Schema only in the binding (`spec/contract/binding.md`) or legacy `data-model.md` / prose;
  real data rows live **only** in case JSON.
- The full `fixture.json` / `capture(page)` format is the `breakdown` skill's own
  `references/isolate-format.md`.

## Validation
`sprig isolate` discovers every proposal; each component **and page** diffs clean vs its
`screenshots/` and its `isolate/` cases are green before anything builds on it; every component/page
carries an **Isolate build plan** the builder can follow without the source; `index.md` Unassigned
is empty; with a ratified contract, the binding exists and its **Drift list is empty** (or every
entry is a deliberate, user-acknowledged gap).
