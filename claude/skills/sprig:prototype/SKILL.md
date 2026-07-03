---
name: "sprig:prototype"
description: Use when the user wants a fast, throwaway clickable prototype to answer "what are we building" — the complete look-and-feel and main flow of an app, not a production build. Builds ONE two-seam prototype folder (spec/ui/<app>-prototype/) — a presentation-only HTML (CDN scripts, no build step) plus the two seams that ARE the draft backend contract: objects/<type>.json (the read model) and commands.json (intent verbs) — served by a generic copied host (deno task start). Deliberately includes the unglamorous states (empty, loading, error toast, content overflow) where real requirements hide. Also use to change, extend, or iterate on a prototype that already exists — add or rework a screen, fix the flow, restyle, tweak the seed data — when the user points at a *-prototype/ folder (or legacy *-prototype.html) or asks to improve a demo you built. Trigger for "mock up", "prototype", "demo screen", "clickable wireframe", "show me what X looks like", "add a screen to the prototype", "change/iterate on the prototype", or turning a spec/notes/rough draft, or a Figma URL, into a tangible demo. NOT for production code, real custom backends, component libraries, or anything that must be maintained.
version: 2.0.0
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

- **`sprig-prototype-builder`** — create or surgically change the two-seam prototype
  `spec/ui/<app>-prototype/`: a presentation-only `_test-prototype.html` (CDN-only,
  every screen + the unglamorous states) plus the two seams — `objects/<type>.json`
  (the read model) and `commands.json` (intent verbs) — served by the generic host
  (`_start.ts`, copied verbatim, never edited); applies a brand design-system if
  present and any click-feedback. It owns the whole build procedure. The seams ARE
  the draft backend contract that seeds `rune:spec` (bridge 1 — see `contract.md` at
  the repo root).

**You are the orchestrator: pick the entry path, delegate the build to the builder, and
manage the annotate server. You never author or edit the HTML inline.**

## Four ways in — route the request

Disambiguate on **whether the prompt carries an instruction**:

0. **Serve only** — the args are *just a path to an existing prototype* (a
   `*-prototype/` folder or legacy `.html`) with **no description and no change
   request** (e.g. `/prototype foo-prototype/`). There's nothing to build. **Do NOT
   invoke the builder** and do not read/edit/rebuild anything — skip straight to
   **serving it** (below) and stop.
1. **Create** — a description, spec, or Figma URL → delegate to **`sprig-prototype-builder`**
   (Create) with the request, source, output path, and whether `spec/ui/design-system/` exists.
2. **Improve** — the user points at a `*-prototype/` folder (or legacy `*-prototype.html`)
   *and* asks to change/add/fix/restyle → delegate to **`sprig-prototype-builder`**
   (Improve) with the prototype + the change.
3. **Apply click-feedback** — the folder's `feedback/feedback.json` has entries (the
   host's annotate sink), or a legacy sibling `<basename>.feedback.json` / inline
   `data-note`s exist → delegate to **`sprig-prototype-builder`** (Improve,
   feedback-first), telling it the feedback artifacts to apply.

If both a spec *and* an existing prototype are in play, improve the existing prototype (the
user already invested clicks). The builder owns the how — don't restate its rules here.

## Output & serve (you manage the server; the user clicks)

After a **Create**, the builder returns the written `spec/ui/<app>-prototype/` folder, the
seams it declared (object types + command verbs), and one line if it ran the gut-check.
Then **make sure the prototype host is running** so the user can click and leave feedback —
the default ending for the first create:

```
cd spec/ui/<app>-prototype && deno task start     # → http://localhost:8723 (PORT overrides)
```

- The generic host (`_start.ts`) serves the UI with the two seams (`window.objects` /
  `window.commands`) and the **annotate overlay** injected, and exposes the contract over
  HTTP: `GET /objects` (read model), `GET /commands` (write contract), `GET /events` (the
  append-only log). A restart is a **clean reset** — seed files stay pristine.
- **It's a long-lived server: have the user keep it running in their terminal** (they can
  paste the command here with a leading `!`) so it outlives your turns — **don't keep
  relaunching a background copy** (that's what drops). After an **Improve**, a browser
  refresh picks up the rewritten HTML; restart the host only if `objects/`/`commands.json`
  changed (they're seeded at boot).
- Skip launching only if the user opted out or `deno` isn't available; then just name the
  command.

Tell the user how to leave feedback: **⌘/Ctrl+click any element** → type a note → it lands
in the folder's `feedback/feedback.json` (the badge bottom-right counts notes). On the next
run the builder applies it (path 3).

**Legacy single-file prototypes** (`spec/ui/<app>-prototype.html`): serve with
`sprig dev --annotate spec/ui/<app>-prototype.html` as before — stable hashed port,
hot-reload on rewrite, `inline | json` feedback + **⇧⌘+drag** drawings; never point it at
an HTML file under `spec/ui/design-system/` (it refuses the path outright).

## Hard rule

The build/iterate work — finding the source, writing the prototype files (HTML + the two
seams), applying feedback, the optional design-lint gut-check — is
**`sprig-prototype-builder`**'s. The main session only routes, launches/announces the
server, and relays the result.
