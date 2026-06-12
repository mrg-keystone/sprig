---
name: prototype
description: Use when the user wants a fast, throwaway, single-file clickable HTML prototype to answer "what are we building" — the complete look-and-feel and main flow of an app, not a production build. Builds ONE self-contained .html with hardcoded data, fake in-memory interactions, CDN scripts only, that opens by double-clicking. Deliberately includes the unglamorous states (empty, loading, error toast, content overflow) where real requirements hide. Trigger for "mock up", "prototype", "demo screen", "clickable wireframe", "show me what X looks like", or turning a spec/notes/rough draft into a tangible demo. NOT for production code, real backends, component libraries, or anything that must be maintained.
version: 1.0.0
user-invocable: true
argument-hint: "[app description] [source: path/to/spec]"
license: Apache 2.0
allowed-tools:
  - Read
  - Write
  - Bash(node *)
  - Bash(deno *)
---

Build a single, self-contained HTML file that demos how an app works — the
complete clickable look-and-feel, not a production build.

This is a **THROWAWAY prototype**. Its only job is to answer "what are we
building." It will be read once and deleted. Optimize for how fast the user can
change it, not for code quality.

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

## Output

Output the HTML file (and, if you ran Step 4, one line on what it flagged).
Do not explain the code.
