# prototype + design-lint

A focused toolkit for building **throwaway, single-file clickable prototypes** —
the kind you make to answer "what are we building" before any production work.
Prototypes are styled with **daisyUI** (Tailwind component classes, loaded by CDN,
no build step) and **Lucide** icons, with correct daisyUI markup pulled from the
**daisyUI MCP** — see [daisyUI integration](#daisyui-integration-mcp) below.

Two pieces ship together in this repo:

```
skills/sprig:prototype/
├── SKILL.md             The prototype skill (one cohesive SKILL.md). Turns an
├── scripts/             app description or spec into ONE self-contained .html:
│                        every screen clickable, hardcoded data, fake in-memory
│                        interactions, plus the unglamorous states (empty,
│                        loading, error, overflow) — and iterates on a prototype
│                        that already exists (add a screen, fix the flow, restyle)
│                        in place, same file.
├── annotate/            Click-to-feedback wrapper. Serves a prototype locally and
│                        injects an overlay: cmd/ctrl+click an element, type
│                        feedback, save → written to <prototype>.feedback.json
│                        next to the file for the skill to read and apply.
└── design-lint/         Standalone Deno linter (a visual anti-pattern detector,
                         ported from impeccable, Puppeteer→Astral). The skill
                         uses it as an optional, non-blocking look-and-feel
                         gut-check on the prototype it generates.
```

design-lint is derived from [impeccable](https://github.com/pbakaus/impeccable)
(Apache-2.0). See `design-lint/NOTICE` for attribution and the list of changes.

## How the two connect

The prototype skill's job is the HTML file. As an optional final step it can
statically scan that file for visual slop via `design-lint`:

```
agent → node …/prototype/scripts/detect.mjs --json <file>.html
      → deno run …/prototype/design-lint/bin/detect.mjs <file>.html
      → detection engine (low contrast, flat hierarchy, …)
```

`detect.mjs` finds `design-lint` by, in order:
1. `$DESIGN_LINT_BIN` — absolute path to `design-lint/bin/detect.mjs`
2. `$DESIGN_LINT_DIR` — the `design-lint/` checkout
3. walking up from the skill for a `design-lint/` directory (finds the bundled
   one immediately — works out of the box in every install mode)

This is a gut-check only — the prototype is throwaway, so it's never blocked on
the linter.

## daisyUI integration (MCP)

The skill defaults to **daisyUI** for the look-and-feel of every prototype. It's a
class-based component layer on top of Tailwind, loaded entirely by CDN — so it
keeps the one-file, no-build, double-click-to-open ethos intact:

```html
<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
<link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
```

These tags are shown here as the stack at a glance; **`SKILL.md` is the canonical source**
for them (and for the daisyUI/Lucide usage gotchas — the explicit `/dist/umd/` Lucide path,
calling `lucide.createIcons()` after each render). Icons come from **Lucide** (the last tag);
browse names at <https://lucide.dev/icons/>. See `SKILL.md` → *Icons (Lucide)*.

To get the daisyUI component markup right, the skill calls the **daisyUI MCP**
(`daisyui-blueprint`):

- **`daisyUI-Snippets`** — returns up-to-date class lists, syntax, and
  copy-paste examples for components, layouts, whole-screen templates
  (`dashboard`, `login-form`), and themes. Called with nested objects, e.g.
  `{ "components": { "card": true, "modal": true } }`.
- **`Figma-to-daisyUI`** — when the source is a Figma URL, fetches the design and
  drives its conversion into daisyUI markup.

These tools are declared in the skill's `allowed-tools`. The CDN styling itself
needs nothing but a browser; the MCP only needs to be connected when you want it
to supply snippets or convert a Figma file. See `SKILL.md` → *Style with daisyUI*.

## Click-to-feedback (annotate)

`annotate/serve.ts` wraps any prototype with a cmd/ctrl+click feedback overlay
and writes the notes to `<prototype>.feedback.json` next to the file, which the
skill reads on the next iteration. See `annotate/README.md`.

```sh
deno run -A skills/sprig:prototype/annotate/serve.ts spec/ui/<your>-prototype.html --open
```

## Requirements

- **A browser** — the only hard requirement for the prototype itself (daisyUI,
  Tailwind, and Lucide load from CDN; it opens by double-clicking).
- **The daisyUI MCP** (`daisyui-blueprint`) connected, if you want the skill to
  pull component snippets or convert a Figma design. Without it, daisyUI still
  styles the page from CDN — you just write the classes directly.
- **Node** on `PATH` for the skill's optional gut-check wrapper (it just spawns
  Deno).
- **Deno** on `PATH` only if you use the gut-check or the annotate wrapper; the
  prototype itself needs nothing but a browser.

## Install

At user scope this skill is installed with the package's other skills:
`deno task install` (dev symlink) or `isolate update` (latest release) — see
the repo README. The skill is self-contained, so a per-project install is a
plain copy:

```sh
cp -R skills/sprig:prototype /path/to/project/.claude/skills/sprig:prototype
```

## Use the linter directly (CI / scripts)

```sh
cd design-lint
deno task lint src/                     # static scan, exit 2 on findings
deno task lint --json src/              # machine-readable
deno task lint:url https://example.com  # full browser scan
```
