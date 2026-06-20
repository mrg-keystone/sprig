---
name: "isolate:prototype"
description: Use when the user wants a fast, throwaway, single-file clickable HTML prototype to answer "what are we building" — the complete look-and-feel and main flow of an app, not a production build. Builds ONE self-contained .html with hardcoded data, fake in-memory interactions, CDN scripts only, that opens by double-clicking. Deliberately includes the unglamorous states (empty, loading, error toast, content overflow) where real requirements hide. Also use to change, extend, or iterate on a prototype that already exists — add or rework a screen, fix the flow, restyle, tweak the fake data — when the user points at a *-prototype.html or asks to improve a demo you built. Trigger for "mock up", "prototype", "demo screen", "clickable wireframe", "show me what X looks like", "add a screen to the prototype", "change/iterate on the prototype", or turning a spec/notes/rough draft, or a Figma URL, into a tangible demo. NOT for production code, real backends, component libraries, or anything that must be maintained.
version: 1.4.0
user-invocable: true
argument-hint: "[app description or change to make] [source: spec, Figma URL, or existing -prototype.html]"
license: Apache 2.0
allowed-tools:
  - Read
  - Write
  - Bash(node *)
  - Bash(deno *)
  - mcp__daisyui-blueprint__daisyUI-Snippets
  - mcp__daisyui-blueprint__Figma-to-daisyUI
---

> **Pipeline stage — prototype.** Consumes `design-system` (`../interfaces/design-system.md`);
> produces the `prototype` contract (`../interfaces/prototype.md`), consumed by `breakdown`.
> Full chain: design → prototype → breakdown → build → audit.

Build — or iterate on — a single, self-contained HTML file that demos how an app
works: the complete clickable look-and-feel, not a production build.

This is a **THROWAWAY prototype**. Its only job is to answer "what are we
building." It will be read once and deleted. Optimize for how fast the user can
change it, not for code quality.

## Three ways in

Figure out which path you're on — they share the build rules but start differently:

1. **Create** a new prototype from a description, spec, or Figma URL → do **Create**
   below (find source → build the file → every screen + the unglamorous states).
2. **Improve** an existing prototype — the user points at a `*-prototype.html` (or
   any prototype file) and asks to *change / add a screen / fix / restyle / iterate* →
   do **Improve an existing prototype**.
3. **Apply click-feedback** — a sibling `<prototype-basename>.feedback.json` sits next
   to the file (the user marked it up with the **annotate** wrapper). Those notes are
   the change list → do **Improve**, starting from **Applying click-feedback**.

If both a spec *and* an existing prototype are in play, improve the existing file
rather than starting over — the user has already invested clicks in it.

## Create

### Find the source of truth

The user gives an app description and optionally a source (`source: <path>`, any
file they point at, or a Figma URL).

- **If a path is given**, read it and treat it as the source of truth — spec, notes,
  rough draft, whatever it is. Pull the **screens**, **flows**, and **data shape**
  from it; the file wins over your assumptions.
- **If it's a Figma URL**, call the `Figma-to-daisyUI` MCP tool on it. It returns the
  design's structure (frames, layout, text, colors); follow its workflow — read the
  structure, pull the matching daisyUI snippets (see **Style with daisyUI**), and
  recreate the screens as daisyUI markup. Figma is the source of truth for *look*; you
  still add the flow, fake data, and unglamorous states.
- **If it's blank**, work from the app description in the prompt.

Spend your reading budget here, not exploring the repo. You are not integrating with
their codebase — you are dramatizing an idea. Extract the **main flow** (the sequence
of screens a user moves through), every **screen** and its key UI, and the **data
shape** (the entities and fields the screens display). If the source is thin, make
reasonable, concrete choices and move on — don't stop to interview unless the core
flow is genuinely unknowable.

### Build the one file

Produce exactly one `.html` file. Write it with the Write tool to a sensible name
(e.g. `<app>-prototype.html`) in the working directory.

**Hard rules — non-negotiable:**

- **ONE `.html` file.** No build step, no bundler, no separate CSS/JS files. CDN
  `<script>` tags are fine (Tailwind, Alpine, React UMD — whatever gets you there
  fastest). It must open by double-clicking in a browser.
- **All data hardcoded** as a single object/array at the **top** of the file. No real
  backend, no `fetch()`, no API calls. **Fake every interaction in memory** — mutate
  the in-memory data and re-render.
- **Copy-paste over abstraction.** Don't build reusable components or helpers. This
  code dies. Repetition is fine and preferred — it's faster to read and change one
  screen when each screen is spelled out inline.
- **Not production-grade.** No real error handling, no auth, no accessibility audit,
  no tests, no responsive perfection. Skip all of it.

**Default look — daisyUI + Lucide.** Not a hard rule, just the fastest way to look
designed instead of unstyled: a full themeable component library plus a clean icon
set, zero build, pure CSS/JS (so they compose with vanilla, Alpine, or React UMD).
Drop these in `<head>` (the single source for these tags):

```html
<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
<link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
```

Set the palette with `data-theme` on `<html>` (e.g. `<html data-theme="corporate">`),
build screens from daisyUI components (`btn`, `card`, `modal`, `navbar`, `table`,
`badge`, `alert`…) plus Tailwind utilities for layout, and add icons with Lucide. Swap
the whole stack if a prototype genuinely needs something else.

### Style with daisyUI

With the tags above in place, don't write daisyUI's classes from memory — pull the
real markup from the **`daisyUI-Snippets`** MCP tool. It returns up-to-date class
lists, syntax, and copy-paste examples, so you don't guess or hallucinate class names.

- **Call it with nested objects, not arrays** — request everything a screen needs in
  one call:

  ```
  daisyUI-Snippets({ "components": { "card": true, "modal": true, "navbar": true } })
  ```

  Top-level keys are categories (`components`, `layouts`, `templates`, `themes`,
  `component-examples`); set each snippet to `true`. Pull `component-examples` (keyed
  `<component>.<example>`) when the bare class list isn't enough, and
  `layouts`/`templates` for whole page shells.
- **Pick a stock `data-theme` that fits the vibe** and set it once on `<html>`:
  `corporate`/`winter`/`nord` (clean SaaS), `business`/`dim`/`night` (dark tools),
  `cupcake`/`pastel` (soft/consumer), `synthwave`/`cyberpunk` (bold). Stock themes are
  exactly right here *because* this is throwaway — there's no custom-theme build to set
  up. `themes.css` enables all 35; ask `daisyUI-Snippets` for the `themes` category for
  the full list.
- **Use daisyUI's semantic colors** (`primary`, `accent`, `base-100/200/300`,
  `base-content`, `info`/`success`/`warning`/`error`) rather than raw Tailwind palette
  colors (`bg-blue-500`) — they retheme together and keep contrast and hierarchy clean
  for free.
- **CDN caveat:** the drawer classes `is-drawer-open` / `is-drawer-close` aren't in the
  CDN build — toggle drawers with a checkbox or a little JS instead.

### Icons (Lucide)

Lucide is loaded by the CDN tag above; it swaps any `<i data-lucide="…">` placeholder
for an inline SVG when you call `lucide.createIcons()`:

```html
<i data-lucide="shopping-cart" class="w-5 h-5"></i>
<script>lucide.createIcons()</script>
```

- **Call `lucide.createIcons()` after every render, not just on load.** Prototypes
  mutate data and re-render, and a freshly-injected `<i data-lucide>` stays an empty
  `<i>` until `createIcons()` runs again — so call it at the end of each render
  function.
- **Use the explicit `/dist/umd/lucide.min.js` path** (as in the `<head>`) — the bare
  `npm/lucide` URL serves a non-browser build that won't define `lucide`.
- **Size with `w-_ h-_`, color with daisyUI `text-*`.** Lucide strokes with
  `currentColor`, so `text-primary` / `text-error` theme the icon for free. Icon names
  are the kebab-case slug (`circle-alert`, `arrow-right`, `trash-2`), browsable at
  <https://lucide.dev/icons/>.

### Every screen AND the unglamorous states

Make the **entire main flow fully clickable** — every screen and step, wired with fake
state so the user can walk the whole thing.

Then show the states that usually get skipped, **on purpose** — this is where the real
requirements hide:

- **Empty state** — a list/screen with no data yet (daisyUI: a muted `card` or `hero`
  with an icon + call to action).
- **Loading state** — a fake spinner/skeleton via `setTimeout` (daisyUI: `skeleton`
  blocks, or `loading loading-spinner`).
- **Error toast** — a visible failure the user can trigger (daisyUI: `alert
  alert-error` inside a `toast`).
- **Overflow** — at least one spot with too-long content (a long title, a huge number,
  a wall of text) shown overflowing or handled, so the user sees the seam (Tailwind
  `truncate` / `line-clamp-*`).

Give the prototype a way to reach these — a small floating "demo states" panel,
buttons, or seeded variants — so they're all reachable by clicking.

## Improve an existing prototype

The file was built to be changed fast — this is that moment. It's one self-contained
file, so load it whole and work *with* its existing shape rather than rebuilding.

1. **Read the whole file first.** Find the hardcoded data block at the top, the
   screens, the fake-interaction wiring, and the demo-states panel. Match what's
   already there — its stack (daisyUI / Lucide / Tailwind / Alpine / React-UMD /
   vanilla), its `data-theme`, its naming, its structure. If it uses daisyUI, stay in
   daisyUI and pull any new components from `daisyUI-Snippets`. Don't reformat or "clean
   up" code you weren't asked to touch; a giant diff on a throwaway file just slows the
   next change.
2. **Make the change surgically, keeping the ethos.** Still ONE file, still hardcoded
   data at the top, still fake-in-memory interactions, still copy-paste over
   abstraction. Adding one screen is not a reason to refactor into reusable components.
3. **Keep the flow and the unglamorous states whole.** If you add a screen, wire it
   into the main flow *and* give it the empty / loading / error / overflow variants,
   reachable from the demo-states panel. If you change the data shape, update every
   screen that reads it so nothing silently breaks.
4. **Write it back to the same file** (same name) unless the user wants a new one —
   overwriting in place is what preserves their clicks. Then re-run the optional
   gut-check below if it's worth it, and re-launch annotate (see **Output**).

### Applying click-feedback

When a sibling `<prototype-basename>.feedback.json` exists, the user marked up the
prototype with the **annotate** wrapper — apply those notes as the change list before
anything else. It's a JSON object keyed by a unique CSS selector; each value carries
the `feedback` plus context to locate the element in source.

The one heuristic that matters: **grep the `text` field first.** Prototypes hardcode
their data at the top and render with JS, so the visible text the user clicked is
**guaranteed to exist in source** — whereas a positional `selector` / `xpath` points
at a runtime-only node and usually is *not* in source. Use the other fields
(`label` / `classes` / `tag` / `trail`) to disambiguate when the text matches in
several places. See `annotate/README.md` for the full field schema.

For each entry: locate the target (static HTML *or* the function that renders it),
apply the feedback, then re-check the flow and states. When done, **clear the file**
(write `{}` or delete it) so stale notes aren't re-applied next round.

## Optional: visual gut-check (design-lint)

This skill grew out of a visual-design linter, which still ships alongside as
**design-lint**. For a fast sanity check on the look-and-feel, statically scan the
file:

```
node .claude/skills/prototype/scripts/detect.mjs --json <file>.html
```

It flags visual slop (low contrast, flat type hierarchy, etc.). Treat it as a
**non-blocking gut-check only** — glance at it, fix anything embarrassing in ten
seconds, and ship. Never run an a11y pass, never add tests, never block delivery on it;
that would violate the throwaway ethos. Skip it entirely if it isn't obviously worth
it.

## Output

Output the HTML file (and, if you ran the gut-check, one line on what it flagged). Don't
explain the code.

Then **launch the annotate wrapper** so the user can give feedback by pointing at the
screen — the fastest feedback on something you look at is clicking it, so make this the
default ending for every create/iterate rather than waiting to be asked:

```
deno run -A .claude/skills/prototype/annotate/serve.ts <prototype>.html --open
```

Run it in the background, then tell the user the URL and that they can **hold ⌘ and
click any element** to leave feedback. The wrapper serves the prototype, injects a
click-to-comment overlay, and writes each note to `<prototype>.feedback.json` next to
the file — which you apply on the next run (see **Applying click-feedback**). Skip only
if the user opted out or `deno` isn't available; in that case just name the command so
they can run it themselves.
