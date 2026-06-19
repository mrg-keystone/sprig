---
name: isolate-breakdown
description: >-
  Decompose a UI mock into a build-ready spec — page inventory, shared/page-local
  components, design tokens, the implied data model, the interaction-tier map
  (which regions are static forms, Fresh Partials, or islands) with feedback and
  liveness, motion specs with jank findings, cropped screenshots and animation
  filmstrips, and ready-to-drop-in isolate fixture proposals — so a Fresh 2 +
  isolate build session can rebuild the UI mechanically. Use whenever the user points at a mock, prototype,
  reference UI, or finished HTML/screenshot/PDF design and wants it broken down,
  spec'd out, decomposed, reverse-engineered, or turned into components —
  phrases like "break this down", "do a ui-breakdown", "spec this mock", "turn
  this into components", "prep this for the rebuild". Trigger even when they
  don't say "spec": pointing at an HTML mock and asking how to rebuild it in
  Fresh counts.
---

# breakdown — from mock to build spec

> **Pipeline stage — breakdown.** Consumes `prototype` (`../interfaces/prototype.md`);
> produces the `ui-breakdown` contract (`../interfaces/ui-breakdown.md`), consumed by `build`.
> Full chain: design → prototype → breakdown → build → audit.

Read the source mock and produce a `ui-breakdown/` directory that a later build
session can work through **mechanically**: scaffold a component, drop in its
proposed `isolate/` folder, run `isolate dev`, diff against the screenshots,
write tests from the Events section, run `isolate test`, repeat. Every artifact
below exists to make that loop dumber and safer — judge every formatting
decision by that standard. The spec must be detailed enough that someone could
rebuild each page and component from the spec alone, **without opening the
source**.

Create the output directory as a sibling of the source named `ui-breakdown/`
(source `/foo/bar/app.html` → output `/foo/bar/ui-breakdown/`). Derive the
output path automatically; never ask for it.

The rebuild target is **Fresh 2 (Preact + Tailwind 4)**. Source JS/CSS is
reference ground truth, not deliverable code — what survives translation lives
in `design-tokens.md` and the component specs.

## Target structure

```
ui-breakdown/
├── index.md                    # page inventory, usage matrix, build order, unassigned list
├── design-tokens.md            # palette, type, spacing, radii, shadows, easing, breakpoints,
│                               #   per-theme token sets → tailwind mapping
├── data-model.md               # the implied backend schema extracted from the mock data
├── assets/                     # images/fonts/svgs lifted from the source
├── shared-components/          # components used on MORE THAN ONE page
│   └── <component-name>/       # kebab-case (see isolate naming rule below)
│       ├── <component-name>.md # the component spec (anatomy below)
│       ├── isolate/            # PROPOSED fixture.json + cases/<state>/<state>.json — real files
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

## Interactivity, data flow & component tiers

A mock is static HTML with inline data — it **always performs well and never
reveals a runtime cost**. So this skill does **not** spec data loaders, profile,
or plan performance; that belongs to the build session, against a real backend.
What the mock *does* reveal — and what you must decide here — is the **runtime
architecture**: which regions ship JS, who owns each interaction, and how
feedback flows. Get these wrong and the build inherits slow, reload-heavy,
over-hydrated pages.

**Classify every interaction by the question that actually matters** — not "is
it interactive?" (almost everything is), but **"does it mutate server state, or
is it client-only?"** That answer picks a tier:

- **Server mutation, full re-render is fine** → a `<form method="POST">` +
  **Post/Redirect/Get**: POST mutates, 303-redirects, the GET re-renders the new
  state. **Zero JS — static.** Most buttons (enable/disable, save, delete,
  toggle, submit, run) are this.
- **Server mutation, but no full reload** (preserve scroll/focus, feel instant)
  → a **Fresh Partial** (`f-partial`): the click hits the server, the server
  re-renders just that fragment, it's swapped in. **Minimal JS, no client fetch
  code, no `reload()`.** The sweet spot for "mutate + re-render this region".
- **Client-only** — no server round-trip, or must feel optimistic: dropdowns,
  modals, command palette, a client-side filter/sort, inline validation,
  drag-drop → **island**. This bucket is small.
- **Pure display** → static.

The **dominant interaction is `click → server mutates → page re-renders the new
state`**, with feedback (a toast) riding along as a **flash message** on the
redirect — the toast is a *passenger*, the re-rendered state is the cargo. Spec
feedback as that SSR-native pattern (a flash cookie consumed and cleared on the
next render), **never** a client-held toast + a `setTimeout` before
`location.reload()` — that band-aid is precisely what you're designing out.

**Defaults & smells:** default to static / form / Partial; an **island must be
justified by a genuine client-only need.** A whole view wrapped in one island
that takes server data as frozen props and `reload()`s after actions is THE
anti-pattern — flag it. Islands own *client* state and refresh in place; they
never `location.reload()` to re-read server state.

**Liveness:** mark each live-looking panel **request-response** (re-rendered on
nav/action) vs **pushed** (updates on its own — an activity feed, a queue,
cross-client changes). Pushed panels need a stream (SSE) at build time; a mock
faking liveness with `setInterval` signals *intent*, not a mechanism.

**Honest-empty:** the mock always has data; note each panel's real backing
source, and where there is none, spec a **placeholder, never fabricated data**.

**The one performance thing a static mock CAN tell you** — not by measuring, but
from the data model: flag expensive data **shapes** as design-time hazards. "A
count/aggregate over a collection rendered globally" or "a list rendered in a
layout (every page pays for it)" can't be timed here, but they *can* be marked
so the builder treats them carefully. A hazard annotation, never a benchmark.

## The passes, in order

Work through these in order — later passes depend on earlier ones, and the
final audit catches what slipped.

### 1 · Survey & page census

Read every source file **end to end** before decomposing anything. Then count
pages — and a page is *not* the same thing as an HTML file:

- A folder of HTML files → each file is a page candidate.
- **A single file can contain many pages.** Look for client-side routing: hash
  routers (`location.hash`, `href="#/..."` links, `hashchange` listeners),
  History-API routers, or view containers toggled by class/attribute
  (`.view.active`, `[data-view]`, `hidden`). Each route/view is its own page
  under `pages/`. A one-file mock app with five hash routes yields five pages.
- Overlays that cover the whole screen (modals, command palettes, drawers) are
  **components**, not pages — they belong to whichever page(s) summon them, or
  to `shared-components/` if global.

### 2 · Design tokens & data model

**`design-tokens.md`** — palette, type scale, spacing scale, radii, shadows,
easing curves, z-index layers, breakpoints, and a proposed Tailwind mapping.
Fresh 2 scaffolds **Tailwind 4**: tokens map to a CSS-first `@theme` block of
custom properties (`--color-accent: #4f46e5;`), not a `tailwind.config.js`
theme extension — emitting a Tailwind-3-style config hands the build session
something its toolchain can't use. If the source defines **theme
variants** (e.g. a `[data-theme="dark"]` block re-declaring custom properties),
capture every variant as parallel columns of the same token table — the build
session must get both palettes, not just the default. Record how
`prefers-reduced-motion` is handled; the rebuild must preserve it.

**`data-model.md`** — in a self-contained mock, **the mock data is the implied
backend schema**. Extract it instead of letting it die inside the prototype:

- Each entity: fields, types, value sets (enums like `priority: high|med|low`),
  relationships (foreign keys like `task.assignee → user.id`), and counts at
  load (cardinality matters for perf decisions — a table over 800 rows gets
  pagination; one over 12 doesn't).
- How the data is generated: seeded/deterministic PRNG? hardcoded? fetched?
  Determinism is worth recording — it makes screenshot diffs reproducible.
- Which components consume which entity (a reverse index of the props tables).
- **Data-shape hazards** — flag access patterns that turn expensive once wired
  to a real backend: a count/aggregate over a collection rendered globally (e.g.
  a sidebar total), a list rendered in a layout (every page pays for it), a
  cross-entity rollup. You can't time them here — the mock is instant — but mark
  them so the build treats them carefully (cache / point-read, don't scan).

Never copy data **rows** into specs — schema and generation rules only.

### 3 · Component census

Walk each page's DOM and carve it into components. For each one, decide:

- **Shared vs page-local**: used on more than one page → `shared-components/`;
  otherwise it lives in that page's `components/`. Usage counts are not the
  only evidence — **authorial signals count too**: the mock's own comments
  ("shared:", "common"), a shared/common CSS section grouping the component's
  styles, or a global DOM mount outside any page container all say the author
  *designed* it as shared, even if only one page calls it today (a generic
  confirm modal with one current caller is still a shared primitive). When
  usage and authorial intent disagree, follow the authorial signal and note
  the single-caller fact in "Used on". Only when *both* are ambiguous, default
  page-local — promotion later is cheap, demotion is churn. Record the
  evidence either way in the component's "Used on" section.
- **Classification** — `static` | `island` | `page-composition` (this picks the
  Fresh folder). Decide it with the **Interactivity, data flow & component
  tiers** rules above. The test for `island` is *needs client JS the server
  can't re-render*, **NOT** *looks interactive*:
  - `static`: pure display **or a server-mutating button** — a form+PRG
    submission, or a region the server re-renders as a **Partial** on action.
    No client JS owned → Fresh `components/`. Most "interactive" buttons land
    here.
  - `island`: genuine client-only state — dropdown/modal/command-palette,
    client-side filter/sort, optimistic toggle, inline validation, drag-drop →
    Fresh `islands/`. A CSS-only hover is static; a button that just POSTs is a
    form. **Justify every island; a whole-page island is a smell.**
  - `page-composition`: a page-level arrangement of other components → Fresh
    `pages/` in isolate terms.
  Record the finer **interaction tier** (form+PRG / Partial / island /
  client-only) and its data/feedback/liveness in the component's Behavior
  section (anatomy below), not just the folder bucket.

Name component folders **kebab-case** such that `PascalCase(folder)` is the
intended component name (`command-palette` → `CommandPalette.tsx`) — isolate
resolves the component file by exactly that rule, so the proposed `isolate/`
folder only drops in cleanly if the names line up.

### 4 · Capture passes (renderable HTML sources)

Render the source with Playwright and capture evidence. **Read
`references/capture-recipes.md` before writing any capture code** — it has
verified, copy-adaptable recipes for everything below, plus where to find a
Playwright install.

- **Stills** — one cropped screenshot per component (its `screenshots/`) and a
  full-page shot per page. Let entrance animations settle first. Capture at a
  desktop viewport *and* at the source's own breakpoints (read the
  `@media` queries — don't guess widths). If themes exist, capture the
  non-default theme at least once per page.
- **Motion** — for each animated component:
  - **Extract the spec, don't describe it**: `document.getAnimations()` +
    `effect.getKeyframes()` + `getComputedTiming()` give trigger, properties,
    keyframes, duration, delay, easing for CSS/WAAPI animation.
  - **`getAnimations()` is blind to rAF and canvas animation.** Find those by
    reading the code (`requestAnimationFrame`, canvas 2D calls, manual
    `style.transform` writes in scroll handlers) and capture them with
    Playwright clock emulation instead.
  - **Scrub deterministically** (`anim.pause(); anim.currentTime = t`) to
    0/20/40/60/80/100% of duration, screenshot each, composite a
    `filmstrip.png`; use clock emulation for rAF-driven motion that can't be
    scrubbed.
  - **One live (unscrubbed) run** instrumented with rAF deltas,
    `long-animation-frame`, and layout-shift observers → dropped-frame %, max
    frame time, CLS delta into `jank.md`.
- **Jank lints** — run the static checklist in `capture-recipes.md` over the
  extracted CSS *and* JS. The CSS side catches layout-property keyframes,
  `transition: all`, animated `box-shadow`/`filter`, missing `will-change`;
  the **JS side** catches forced synchronous layout (layout reads like
  `offsetTop`/`getBoundingClientRect` inside scroll/rAF handlers, especially
  per-element loops), unthrottled non-passive scroll handlers, and
  `setTimeout`-driven animation. Record findings in each component's Motion
  section — these are the bugs the rebuild must *not* reproduce, so say what
  to do instead (e.g. "animates `height`; rebuild with `transform: scaleY` or
  grid-template-rows").

### 5 · Component specs

Write each `<component-name>.md` with the anatomy below. Extract the
component's actual JS/CSS from the source into its `js/`/`css/` dirs rather
than only describing it.

### 6 · isolate proposals

For every `static`/`island` component, write a **real, executable**
`isolate/` folder — `fixture.json` plus one `cases/<state>/<state>.json` per
row of the States table. Real files, not JSON blocks in markdown: they
hypothesize the component's API, and the build session starts from something
it can run, adjusting as needed. **Follow `references/isolate-format.md`** —
the format has non-obvious rules (route built from `category`/`folder`, the
`PascalCase(folder).tsx` naming rule, `signal: true` for island props,
`_signals`/`_mocks`/`_innerHtml` specials) and an invalid proposal is worse
than none, because `isolate dev` fails fast on malformed fixtures.

**Case values must be the real captured data, never invented stand-ins.**
The build session's core check is *render the case → diff against your
screenshot* — that only works if the case reproduces exactly what the
screenshot shows: the actual titles, names, dates, ids, and series values
from the source (extract them; with a seeded mock they're deterministic).
For big data sets, the case carries the exact **visible slice** — the 25 rows
of table page 1, the actual sprint cards, the real 30-point series — not the
whole 800-row set and not a lookalike. The "schema, never data rows" rule
governs `data-model.md` and spec prose; case JSON is the one place real
values belong, *because* the screenshots show them.

### 7 · `index.md` & build order

- Page inventory (one line per page: purpose + its components).
- Shared-component **usage matrix** (component × page).
- **Interaction/tier summary** — the runtime architecture at a glance: which
  regions are forms (PRG), which are Partials, which are islands (and why);
  the pushed/SSE panels; and the flagged data-shape hazards.
- **Build order**: design tokens → shared components (dependency order:
  primitives like button/badge/avatar before composites like card/modal that
  embed them) → page-local components → page compositions.
- Risks/unknowns the build session should verify early.

### 8 · Completeness audit

Before declaring done, walk each page's top-level DOM regions and check each
one maps to exactly one component or composition entry; walk the source JS and
check every behavior (each listener, timer, observer, animation) is owned by
some component's Events or Motion section. Also check every **interaction has a
tier** (form+PRG / Partial / island / client-only), every **`island` is
justified** by a genuine client-only need (no whole-page islands, nothing
`location.reload()`-ing server state), and every live panel is marked
request-response vs pushed and has an honest-empty note. Anything unmapped goes
in an **"Unassigned"** list at the bottom of `index.md` — an empty list is the
goal, a populated one is honest; silence is the only failure.

## Component .md anatomy

Every component markdown contains, in order:

1. **Classification & behavior** — the folder bucket (`static` | `island` |
   `page-composition`) **plus the interaction tier and data contract**: for each
   interaction its tier (form+PRG mutation / Partial / island / client-only);
   for server mutations, the action + redirect target + **flash** feedback
   (never a client toast + `reload()`); for islands, the **client state owned**
   and how it refreshes in place (re-fetch / Partial — never `location.reload()`
   on server state); each region's **data source** with honest-empty where there
   is none; **liveness** (request-response vs pushed/SSE); and any **data-shape
   hazard** flagged for the builder. One-line justification per island
   ("island — owns the drag pointer listeners").
2. **Anatomy** — DOM/visual structure sketch; slots/children it accepts.
3. **Props table** — `name · type · default · control widget · signal?`.
   Each row maps 1:1 to a `fixture.json` control
   (`boolean`/`number`/`text`/`range`/`select`/`color`); props that should be
   signal-backed in an island get `signal: true`.
4. **States → cases** — one row per state (default, hover, disabled, error,
   loading, filled, empty, …). Include *behavioral* states, not just visual
   ones: a toast queue's "capped at 4", an async field's
   idle → checking → invalid sequence. Each row becomes a
   `cases/<state>/<state>.json`.
5. **Events** — what it emits and when (clicks, input, keyboard shortcuts,
   custom events), each written as a **concrete `capture(page)` predicate
   sketch**, not prose — e.g.
   `ev.expect(e => e.source === "button#confirm" && e.type === "click")`
   (event shape in `references/isolate-format.md`). The build session turns
   these into `tests/*.spec.ts` verbatim; a prose description makes it
   re-derive what you already knew.
6. **Motion** — extracted, not described: trigger, animated properties,
   duration/easing/delay, keyframes; jank findings + the fix the rebuild
   should use; pointer to `screenshots/filmstrip.png`.
7. **Responsive** — behavior per breakpoint, against the source's real
   `@media` values.
8. **A11y** — roles, labels, focus order/trapping, keyboard interactions,
   reduced-motion behavior.
9. **Used on** — list of pages (the shared vs page-local evidence).

## Source-type fallbacks

- **Self-contained HTML / folder of HTML files** — the full treatment above.
- **Images / PDF** — visual analysis only. Describe instead of extract; skip
  `js/`, `css/`, and the motion pass entirely; approximate tokens by sampling
  pixels. **Every sampled value records its sample coordinates**
  (`#4f46e5 @ (312,88)`) so the claim is replicable — un-sourced pixel claims
  are where reviews catch errors. Treat a first read as a hypothesis: claim an
  exact match ("Tailwind indigo-600", "rounded-full", "gap-5") only after
  re-sampling confirms it; otherwise state the measured value and mark it
  approximate. Mark **every inferred section** with
  **"described, not extracted — verify during build"**. Still propose
  `isolate/` folders — they're hypotheses either way — but never fabricate
  evidence: no invented event lists, no motion specs for motion you cannot
  see, no fake jank findings. A thinner, honest spec beats a padded one. Scale
  the whole output to the evidence available: one screenshot of one page
  yields one page folder, not an imagined app.

## Rules

- One folder per page under `pages/`, named after the page.
- Classify interactions by **server-mutation vs client-only**, not "interactive
  vs not": default form-PRG / Partial / static, justify every island, and spec
  action feedback as **flash/PRG**, never a client toast + `location.reload()`.
  Performance is the build's job, not the breakdown's (the mock is always fast);
  here you only flag expensive data *shapes*.
- Page-local by default; promote to `shared-components/` only with evidence
  (the "Used on" list).
- Extract over describe, everywhere the source is readable: real keyframes,
  real CSS, real event wiring. Reserve prose for what extraction can't reach.
- Proposed `isolate/` folders are real files that would pass `isolate list`
  discovery, not documentation.
- Schema, never data rows, in `data-model.md` and spec prose. Case JSON is
  the deliberate exception: it carries the real captured values its
  screenshot shows.
- The audit list in `index.md` ships even when empty ("Unassigned: none").
