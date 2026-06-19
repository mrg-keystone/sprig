# Contract: ui-breakdown

> **Producer:** breakdown · **Consumer:** build · Pipeline: design → prototype → breakdown → build → audit

A `ui-breakdown/` directory detailed enough that `build` can rebuild each page and component
**mechanically, without opening the source.** This is the **translation boundary**: whatever the
source used (daisyUI, inline styles, bespoke CSS), what crosses into `build` here is
framework-neutral **tokens + specs**.

## Artifact — directory shape
```
ui-breakdown/
├── index.md              # page inventory, usage matrix, build order, interaction tiers, Unassigned list
├── design-tokens.md      # palette, type, spacing, radii, shadows, easing → Tailwind 4 @theme
├── data-model.md         # the implied backend schema (entities, enums, relationships, cardinality)
├── assets/               # images/fonts/svgs lifted from source
├── shared-components/<name>/   # used on >1 page
│   ├── <name>.md         # the component spec (see "Each component spec carries")
│   ├── isolate/          # real fixture.json + cases/<state>/<state>.json
│   └── screenshots/      # the diff target (+ filmstrip.png/jank.md if animated)
└── pages/<page>/
    ├── <page>.md, screenshots/
    └── components/<name>/   # page-local components (same shape)
```

## Shape (what `build` can rely on)
- **Tokens are Tailwind 4 `@theme` custom properties** — NOT a `tailwind.config.js`, NOT daisyUI.
  Build transcribes them into the global `@theme` sheet and styles with **Tailwind utilities**
  (the daisyUI→Tailwind translation already happened *here*). Every theme variant included.
- **Each component spec carries:** classification (`static` | `island` | `page-composition`) +
  the interaction tier (form+PRG / Partial / island / client-only); anatomy; a props table (1:1
  with `fixture.json` controls); states→cases; **Events** as `capture(page)` predicate sketches;
  **Motion extracted** (real keyframes/easing + jank fixes — reproduce, don't reinvent);
  responsive; a11y.
- **`isolate/` proposals are real and runnable** (`fixture.json` + `cases/`), discoverable by
  `isolate list`; the component file resolves as `PascalCase(folder).tsx`. Case JSON carries the
  **real captured values** the screenshot shows.
- **`index.md` carries the build order** (tokens → shared components → page-local → page
  compositions), the interaction-tier summary, and an **Unassigned list that ships even empty**.

## Invariants
- A reader could rebuild from the spec alone, without the source.
- Schema only in `data-model.md` / prose; real data rows live **only** in case JSON.
- The full `fixture.json` / `capture(page)` format is the `breakdown` skill's own
  `references/isolate-format.md`.

## Validation
`isolate list` discovers every proposal; each component diffs clean vs its `screenshots/` and
`isolate test` is green before anything builds on it; `index.md` Unassigned is empty.
