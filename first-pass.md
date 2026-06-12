# ui-breakdown — first pass

Decompose a UI mock into an isolate-native build spec that a Fresh 2 + isolate
build session can work through mechanically.

## Prompt

Read the source file(s) at <SOURCE_PATH> and produce a detailed UI breakdown
spec. Create the output directory as a sibling of the source named
`ui-breakdown` (e.g. source `/foo/bar/app.html` → output `/foo/bar/ui-breakdown/`).
Derive the output path automatically; never ask for it.

Go through the source thoroughly and decompose it into pages and components.
The spec's consumer is a build session creating Fresh 2 components with
isolate previews — every artifact below exists to make that step dumber and
safer.

### Target structure

```
ui-breakdown/
├── index.md                    # page inventory, shared-component usage matrix, build order
├── design-tokens.md            # palette, type scale, spacing, radii, shadows, breakpoints → tailwind mapping
├── assets/                     # images/fonts/svgs lifted from the source
├── shared-components/          # components used on MORE THAN ONE page
│   └── <component-name>/
│       ├── <component-name>.md # the component spec (anatomy below)
│       ├── isolate/            # PROPOSED fixture.json + cases/<state>/<state>.json — real files, ready to drop in
│       ├── screenshots/        # cropped still(s); filmstrip.png + jank.md if animated
│       ├── js/                 # extracted source JS (reference, not deliverable)
│       └── css/                # extracted source CSS (reference, not deliverable)
└── pages/
    └── <page-name>/
        ├── <page-name>.md      # page purpose, layout, sections, composition order
        ├── screenshots/
        ├── js/
        ├── css/
        └── components/         # components used ONLY on this page
            └── <component-name>/   (same shape as shared-components/<name>/)
```

### Component .md anatomy

Every component markdown contains, in order:

1. **Classification** — `static` | `island` | `page-composition`, with a
   one-line justification. Island ⇔ it needs client-side JS. This decides
   `components/` vs `islands/` vs `pages/` in the Fresh project.
2. **Anatomy** — DOM/visual structure sketch; slots/children it accepts.
3. **Props table** — `name · type · default · control widget · signal?`.
   Each row maps 1:1 to a `fixture.json` control
   (`boolean`/`number`/`text`/`range`/`select`/`color`); props that should be
   signal-backed in an island get `signal: true`.
4. **States → cases** — one row per visual state (default, disabled, error,
   loading, filled, …). Each becomes a `cases/<state>/<state>.json`.
5. **Events** — what it emits and when → the `capture(page)` assertions for
   its eventual tests.
6. **Motion** — extracted, not described (see capture passes): trigger,
   animated properties, duration/easing/delay, keyframes; jank lint findings;
   pointer to `screenshots/filmstrip.png`.
7. **Responsive** — behavior per breakpoint.
8. **A11y** — roles, labels, focus order, keyboard interactions.
9. **Used on** — list of pages (this is the shared vs page-local evidence).

The .md files must be detailed enough that someone could rebuild each
page/component from the spec alone.

### Capture passes (HTML sources)

Render the source with Playwright and capture:

- **Stills** — one cropped screenshot per component and per page, into the
  relevant `screenshots/`.
- **Motion** — for each animated component:
  - extract the spec via `document.getAnimations()` +
    `effect.getKeyframes()` (trigger, properties, duration, delay, easing);
  - scrub deterministically (`anim.pause(); anim.currentTime = t`) to
    0/20/40/60/80/100% of duration, screenshot each, composite a
    `filmstrip.png`; use Playwright clock emulation for rAF-driven animation
    that can't be scrubbed;
  - one live (unscrubbed) run instrumented with rAF deltas,
    `long-animation-frame`, and layout-shift observers → dropped-frame %,
    max frame time, CLS delta into `jank.md`;
  - static jank lints, recorded in the Motion section: keyframes animating
    layout properties (height/width/top/margin) instead of
    transform/opacity, `transition: all`, missing `will-change` on heavy
    animations, animated `box-shadow`.

### Source-type fallbacks

- **Self-contained HTML / folder of HTML files** — full extraction +
  screenshots + motion pass. Treat each HTML file as a page candidate.
- **Images / PDF** — visual analysis only: describe instead of extract, skip
  `js/`/`css/` and the motion pass, and mark every inferred section
  **"described, not extracted — verify during build"**.

### Rules

- One folder per page under `pages/`, named after the page.
- A component used on one page lives in that page's `components/`; used on
  more than one page → `shared-components/`. When in doubt, page-local (it
  can be promoted later).
- Extract the actual JS/CSS from the source into `js/`/`css/` rather than
  only describing it — it is reference ground truth, not deliverable code
  (the rebuild is Preact + Tailwind; what survives translation lives in
  `design-tokens.md`).
- The proposed `isolate/` folders are real files, not JSON blocks in
  markdown. They hypothesize the component's API; the build session may
  adjust, but it starts from something executable.
- `index.md` prescribes build order: design tokens → shared components →
  page-local components → page compositions.

## Phase 2 (not built yet — design constraint only)

The follow-up command points a Fresh project at `ui-breakdown/` and works
through `index.md`'s build order: scaffold component → copy its proposed
`isolate/` folder → `isolate dev` → diff against `screenshots/` (stills +
filmstrip at the same scrub timestamps) → write tests from the Events
section → `isolate test`. Every formatting decision above is judged by
whether it makes that loop dumber/safer.

## Open questions

- Command name: `/ui-breakdown` vs something shorter.
- What the mocks actually are in practice (HTML vs Figma/screenshots) — if
  non-HTML dominates, the fallback path needs to grow.
- Distribution: personal skill first (`~/.claude/skills/ui-breakdown/`);
  promote into the isolate package's skill payload once the format survives
  a real mock (requires teaching the installer multi-skill layouts).
