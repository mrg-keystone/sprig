# Rebuild from a ui-breakdown — components green before pages

> A `ui-breakdown/` (produced by the **breakdown** skill) is the input for building UI in
> this skill, and this is its mechanical rebuild loop. breakdown only *specs* the design
> and the validation; build **materializes and runs** it — no design decisions happen
> here. No ui-breakdown? **Run the breakdown skill first** (decomposition and design live
> there); don't build UI freehand.

## TL;DR
A `ui-breakdown/` carries per-component specs whose **Events** sections are the validation
spec, `isolate/` proposals (`fixture.json` + `cases/`), `screenshots/`, and an `index.md`
with the build order + usage matrix. Follow `index.md`'s order, build bottom-up, and hold
the gate: a component is done only when it diffs clean against its screenshots **and**
`isolate test` is green — and a page is never assembled on top of an unproven part.

## Build order (from `index.md`)
design tokens → **shared components** (dependency order — primitives like button/badge/
avatar before composites like card/modal that embed them) → **page-local components** →
**page compositions**. Bottom-up, so every page is assembled from parts that already pass.

## Styling — Tailwind first, one CSS file per component
Style with **Tailwind utilities** (they map to the `@theme` tokens transcribed from
`design-tokens.md`); don't hand-write CSS for what utilities can express. The rare custom CSS a
component needs goes in **its own co-located `*.module.css`** — one per component, scoped, never
the global sheet or a shared component stylesheet. The global sheet holds *only* the `@theme`
tokens, `@font-face`, resets, and shared keyframes. See `concepts/css-modules.md`.

## Per component — loop until green
1. **Scaffold** it at its isolate root from the spec's Classification:
   `static`→`components/<name>/`, `island`→`islands/<name>/`,
   `page-composition`→`pages/<name>/` (file is `PascalCase(folder).tsx`).
2. **Drop in** the proposed `isolate/` folder (`fixture.json` + `cases/`) as-is, adjusting
   only where the real component API forces it.
3. **Write the tests from the Events section** — lift each `capture(page)` predicate sketch
   into `cases/<name>/tests/*.spec.ts`, mapping each predicate to the case whose state
   triggers it. This is the step breakdown leaves to you (it specs; you materialize).
4. **Run both checks:** `isolate dev` → diff the rendered case against its `screenshots/`
   (visual); `isolate test` → run the predicates (behavioral). Iterate until **both** pass
   for **every** case.

A component is **done only when its cases diff clean and `isolate test` is green.** Never
build on a red component.

## The gate
Finish **all shared components green** before starting any page. For each page, build its
**page-local components green** first; only once *every* component that page uses passes do
you build the **page composition** — wire the real layout and data, then make the
**page-level** cases/tests pass. A page is never assembled on top of an unproven part.

Once a page's components are green, wire its data to the backend (`rune-backend.md`) and run
the gap audit.

## See also
- `isolate.md` — authoring `fixture.json`/cases and the `capture(page)` test bridge
- `playwright-and-dev-loop.md` — whole-journey tests once components are green
- `rune-backend.md` — wire the page's data + the gap audit (the build's last step)
- `concepts/css-modules.md` · `icons-lucide.md` — implement the spec's tokens (global `@theme`/sheet, scoped module CSS) and icons
