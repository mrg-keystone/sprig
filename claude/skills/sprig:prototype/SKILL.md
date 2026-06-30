---
name: "sprig:prototype"
description: Use when the user wants a fast, throwaway, single-file clickable HTML prototype to answer "what are we building" — the complete look-and-feel and main flow of an app, not a production build. Builds ONE self-contained .html with hardcoded data, fake in-memory interactions, CDN scripts only, that opens by double-clicking. Deliberately includes the unglamorous states (empty, loading, error toast, content overflow) where real requirements hide. Also use to change, extend, or iterate on a prototype that already exists — add or rework a screen, fix the flow, restyle, tweak the fake data — when the user points at a *-prototype.html or asks to improve a demo you built. Trigger for "mock up", "prototype", "demo screen", "clickable wireframe", "show me what X looks like", "add a screen to the prototype", "change/iterate on the prototype", or turning a spec/notes/rough draft, or a Figma URL, into a tangible demo. NOT for production code, real backends, component libraries, or anything that must be maintained.
version: 1.6.0
user-invocable: true
argument-hint: "[app description or change to make] [source: spec, Figma URL, or existing -prototype.html]"
license: Apache 2.0
allowed-tools:
  - Task
  - Read
  - Glob
  - Grep
  - Bash
---

# prototype — orchestrate a throwaway clickable mock

> **Pipeline stage — prototype.** Consumes `design-system` (`../interfaces/design-system.md`);
> produces the `prototype` contract (`../interfaces/prototype.md`), consumed by `breakdown`.
> Full chain: design → prototype → breakdown → build → audit.

A **THROWAWAY** prototype answers "what are we building" — read once, then deleted. There is
**one specialist** that does all the building/iterating:

- **`sprig-prototype-builder`** — create or surgically change the single self-contained
  `spec/ui/<app>-prototype.html`: CDN-only, hardcoded data, fake in-memory interactions,
  every screen + the unglamorous states; applies a brand design-system if present and any
  click-feedback. It owns the whole build procedure.

**You are the orchestrator: pick the entry path, delegate the build to the builder, and
manage the annotate server. You never author or edit the HTML inline.**

## Four ways in — route the request

Disambiguate on **whether the prompt carries an instruction**:

0. **Annotate only** — the args are *just a path to an existing `.html`* with **no
   description and no change request** (e.g. `/prototype foo.html`). There's nothing to
   build. **Do NOT invoke the builder** and do not read/edit/rebuild the file — skip
   straight to **launching annotate** on it (below) and stop.
1. **Create** — a description, spec, or Figma URL → delegate to **`sprig-prototype-builder`**
   (Create) with the request, source, output path, and whether `spec/ui/design-system/` exists.
2. **Improve** — the user points at a `*-prototype.html` *and* asks to change/add/fix/restyle
   → delegate to **`sprig-prototype-builder`** (Improve) with the file + the change.
3. **Apply click-feedback** — a sibling `<basename>.feedback.json` exists (and/or inline
   `data-note`s) → delegate to **`sprig-prototype-builder`** (Improve, feedback-first),
   telling it the feedback artifacts to apply.

If both a spec *and* an existing prototype are in play, improve the existing file (the user
already invested clicks). The builder owns the how — don't restate its rules here.

## Output & annotate (you manage the server; the user clicks)

After a **Create**, the builder returns the written `spec/ui/<app>-prototype.html` (and one
line if it ran the gut-check). Then **make sure annotate is running** so the user can give
feedback by pointing at the screen — the default ending for the first create:

```
sprig dev --annotate spec/ui/<app>-prototype.html
```

- It auto-picks a **stable port hashed from the file name** (same file → same URL every run)
  and **opens the browser**. (`PORT` overrides; `--no-open` suppresses.) It is **idempotent**
  — re-running detects the live server and just **reprints the URL**.
- **It's a long-lived server: have the user keep it running in their terminal** (they can
  paste it here with a leading `!`) so it outlives your turns — **don't keep relaunching a
  background copy** (that's what drops). On **Improve** iterations the running server
  **hot-reloads** the rewritten file — **don't relaunch**.
- **Point it at the `spec/ui/*-prototype.html` only — NEVER at an HTML file under
  `spec/ui/design-system/`** (annotate refuses a `design-system/` path outright).
- Skip launching only if the user opted out or `deno` isn't available; then just name the command.

Tell the user how to leave feedback: **⌘/Ctrl+click any element** → type a note → save
(split button **`inline | json`**: *inline* writes `data-note=`/`data-note-css=` onto the
element; *json* writes the sibling `<prototype>.feedback.json`); **⇧⌘+drag** → draw → save a
screenshot note; windows drag by their header; **⌘+Ctrl** toggles a clean view. On the next
run the builder applies either kind (path 3).

## Hard rule

The build/iterate work — finding the source, writing the one HTML file, applying feedback,
the optional design-lint gut-check — is **`sprig-prototype-builder`**'s. The main session
only routes, launches/announces annotate, and relays the result.
