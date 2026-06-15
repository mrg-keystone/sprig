---
name: prototype
description: Use when the user wants a fast, throwaway, single-file clickable HTML prototype to answer "what are we building" — the complete look-and-feel and main flow of an app, not a production build. Builds ONE self-contained .html with hardcoded data, fake in-memory interactions, CDN scripts only, that opens by double-clicking. Deliberately includes the unglamorous states (empty, loading, error toast, content overflow) where real requirements hide. Also use to change, extend, or iterate on a prototype that already exists — add or rework a screen, fix the flow, restyle, tweak the fake data — when the user points at a *-prototype.html or asks to improve a demo you built. Trigger for "mock up", "prototype", "demo screen", "clickable wireframe", "show me what X looks like", "add a screen to the prototype", "change/iterate on the prototype", or turning a spec/notes/rough draft into a tangible demo. NOT for production code, real backends, component libraries, or anything that must be maintained.
version: 1.2.0
user-invocable: true
argument-hint: "[app description or change to make] [source: spec, or existing -prototype.html]"
license: Apache 2.0
allowed-tools:
  - Read
  - Write
  - Bash(node *)
  - Bash(deno *)
---

Build — or iterate on — a single, self-contained HTML file that demos how an app
works — the complete clickable look-and-feel, not a production build.

This is a **THROWAWAY prototype**. Its only job is to answer "what are we
building." It will be read once and deleted. Optimize for how fast the user can
change it, not for code quality.

## First: creating, or improving an existing prototype?

This skill does both — and the second is the payoff of building it throwaway in
the first place.

- **Creating** one from a description or spec → follow **Steps 1–4** below.
- **Improving** one that already exists — the user points at a `*-prototype.html`
  (or any prototype file), or asks to *change / add a screen / fix / restyle /
  iterate on* a prototype already in play → skip to **Improving an existing
  prototype**, then re-run Steps 3–4 on the result.

If both could apply (a spec *and* an existing prototype), improve the existing
file rather than starting over — the user has already invested clicks in it.

## Step 1: Find the source of truth

The user gives an app description and optionally a source path (`source: <path>`,
or any file they point at).

- **If a path is given**, read it and treat it as the source of truth: spec,
  notes, rough draft, whatever it is. Pull the **screens**, **flows**, and
  **data shape** from it. The file wins over your assumptions.
- **If it's blank**, work from the app description in the prompt.

Spend your reading budget here, not exploring the repo. You are not integrating
with their codebase — you are dramatizing an idea. Extract:
- The **main flow**: the sequence of screens/steps a user moves through.
- Every **screen** and its key UI.
- The **data shape**: the entities and fields the screens display.

If the source is thin, make reasonable, concrete choices and move on. Don't stop
to interview unless the core flow is genuinely unknowable.

## Step 2: Build the one file

Produce exactly one `.html` file. Write it with the Write tool to a sensible
name (e.g. `<app>-prototype.html`) in the working directory.

**Hard rules — non-negotiable:**

- **ONE `.html` file.** No build step, no bundler, no separate CSS/JS files.
  CDN `<script>` tags are fine (Tailwind via CDN, Alpine, React UMD, etc. —
  whatever gets you there fastest). It must open by double-clicking in a browser.
- **All data hardcoded** as a single object/array at the **top** of the file.
  No real backend. No `fetch()`. No API calls. **Fake every interaction in
  memory** — mutate the in-memory data and re-render.
- **Copy-paste over abstraction.** Do not build reusable components or helpers.
  This code dies. Repetition is fine and preferred — it's faster to read and
  change one screen when each screen is spelled out inline.
- **Not production-grade.** No real error handling, no auth, no accessibility
  audit, no tests, no responsive perfection. Skip all of it.

## Step 3: Include every screen AND the unglamorous states

Make the **entire main flow fully clickable** — every screen and step, wired up
with fake state so the user can walk the whole thing.

Then show the states that are usually skipped, **on purpose** — this is where
the real requirements hide:

- **Empty state** — a list/screen with no data yet.
- **Loading state** — a fake spinner/skeleton (use `setTimeout` to simulate).
- **Error toast** — a visible failure message the user can trigger.
- **Overflow** — at least one spot with too-long content (a long title, a huge
  number, a wall of text) that could break the layout. Show it overflowing or
  handling it, so the user can see the seam.

Give the prototype a way to reach these (e.g. a small floating "demo states"
panel, buttons, or seeded variants) so they're all reachable by clicking.

## Step 4 (optional): Quick visual gut-check

The baseline this skill came from was a visual-design linter, and it still ships
alongside as **design-lint**. If a fast sanity check on the look-and-feel is
useful, statically scan the file:

```
node .claude/skills/prototype/scripts/detect.mjs --json <file>.html
```

It flags visual slop (low contrast, flat type hierarchy, etc.). Treat it as a
**non-blocking gut-check only** — glance at it, fix anything embarrassing in
ten seconds, and ship. Never run an a11y pass, never add tests, never block
delivery on it. That would violate the throwaway ethos. Skip this step entirely
if it isn't obviously worth it.

## Improving an existing prototype

The file was built to be changed fast — this is that moment. It's one
self-contained file, so load it whole and work *with* its existing shape rather
than rebuilding from scratch.

**First, check for click-to-feedback notes.** If a sibling
`<prototype-basename>.feedback.json` exists next to the file, the user marked up
the prototype with the **annotate** wrapper — treat those notes as the change
list and apply them (see **Visual feedback loop** below) before anything else.

1. **Read the whole file first.** Find the hardcoded data block at the top, the
   screens, the fake-interaction wiring, and the demo-states panel. Match what's
   already there — its stack (Tailwind / Alpine / React-UMD / vanilla), its
   naming, its structure. Don't reformat or "clean up" code you weren't asked to
   touch; a giant diff on a throwaway file just slows the next change.
2. **Make the change surgically, keeping the ethos.** Still ONE file, still
   hardcoded data at the top, still fake-in-memory interactions, still copy-paste
   over abstraction. Adding one screen is not a reason to refactor the whole thing
   into reusable components — that fights the format and the speed.
3. **Keep the flow and the unglamorous states whole.** If you add a screen, wire
   it into the main flow *and* give it the empty / loading / error / overflow
   variants (Step 3), reachable from the demo-states panel. If you change the data
   shape, update every screen that reads it so nothing silently breaks.
4. **Write it back to the same file** (same name) unless the user wants a new one
   — overwriting in place is what preserves their clicks. Then re-run the optional
   gut-check (Step 4) if it's worth it.

## Visual feedback loop (annotate)

The prototype is for *looking at*, so the fastest feedback is pointing at the
screen. The bundled **annotate** wrapper (`annotate/`) turns any prototype this
skill produces into a click-to-comment surface — no edits to the prototype file.

**To collect feedback**, run the wrapper on the prototype and let the user mark
it up:

```
deno run -A .claude/skills/prototype/annotate/serve.ts <prototype>.html --open
```

It serves the prototype locally and injects an overlay: the user **cmd/ctrl +
clicks any element**, types what should change, and saves. Each note is written
to `<prototype-basename>.feedback.json` **next to the prototype**.

**Launch it by default.** Every time you create or update a prototype, end by
starting this wrapper (see **Output**) so the feedback loop is always one
⌘-click away — the user shouldn't have to ask for it. Skip only if the user
explicitly says not to, or the environment has no `deno`.

**To apply feedback**, read that JSON. It's an object keyed by a **unique CSS
selector** (collision-free identity); each value carries the `feedback` plus
context to find the element in source:

- `text` — the visible text the user clicked. Prototypes hardcode their data at
  the top and render with JS, so this string is **guaranteed to exist in source**
  (a positional path into the rendered DOM usually is *not*). Grep it first.
- `label` / `classes` / `tag` — the short selector and class names appear
  literally in the render template; use them to disambiguate when `text` matches
  in several places.
- `trail` — ancestor path (`body > div#app > header.topbar > button.tbtn`) that
  points you at the right region / render function.
- `html` — the element's rendered markup (with any `data-act` hooks).
- `selector` / `xpath` — exact locators into the *live* DOM; positional
  fallbacks, useful mainly to confirm which one of several matches is meant.

For each entry: locate the target (static HTML *or* the function that renders it),
apply the feedback, then re-run Steps 3–4. When done, **clear the file** (write
`{}` or delete it) so stale notes aren't re-applied next round. See
`annotate/README.md` for the full format.

## Output

Output the HTML file (and, if you ran Step 4, one line on what it flagged).
Do not explain the code.

Then **launch the annotate wrapper so the user can immediately give feedback** —
this is the default ending for every create/iterate, not something to wait to be
asked for:

```
deno run -A .claude/skills/prototype/annotate/serve.ts <prototype>.html --open
```

Run it in the background, then tell the user the URL and that they can **hold ⌘
and click any element** to leave feedback (saved to `<prototype>.feedback.json`,
which you'll apply on the next run). Skip only if the user opted out or `deno`
isn't available — in that case just name the command so they can run it.
