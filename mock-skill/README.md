# prototype + design-lint

A focused toolkit for building **throwaway, single-file clickable prototypes** —
the kind you make to answer "what are we building" before any production work.
Two pieces that ship together:

```
mock-skill/
├── skill/prototype/     The prototype skill (one cohesive SKILL.md). Turns an
│                        app description or spec into ONE self-contained .html:
│                        every screen clickable, hardcoded data, fake in-memory
│                        interactions, plus the unglamorous states (empty,
│                        loading, error, overflow). Drop into a harness skills
│                        dir to activate.
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
agent → node …/skill/prototype/scripts/detect.mjs --json <file>.html
      → deno run …/design-lint/bin/detect.mjs <file>.html
      → detection engine (low contrast, flat hierarchy, …)
```

`detect.mjs` finds `design-lint` by, in order:
1. `$DESIGN_LINT_BIN` — absolute path to `design-lint/bin/detect.mjs`
2. `$DESIGN_LINT_DIR` — the `design-lint/` checkout
3. walking up from the skill for a sibling `design-lint/` (works out of the box
   in this package layout)

This is a gut-check only — the prototype is throwaway, so it's never blocked on
the linter.

## Requirements

- **Node** on `PATH` for the skill's optional gut-check wrapper (it just spawns
  Deno).
- **Deno** on `PATH` only if you use the gut-check; the prototype itself needs
  nothing but a browser.

## Install into a harness

```sh
./install.sh /path/to/your/project        # -> <project>/.claude/skills/prototype
```

If you install the skill where the walk-up can't reach `design-lint` (more than
~8 parent dirs away), export `DESIGN_LINT_DIR=/abs/path/design-lint`.

## Use the linter directly (CI / scripts)

```sh
cd design-lint
deno task lint src/                     # static scan, exit 2 on findings
deno task lint --json src/              # machine-readable
deno task lint:url https://example.com  # full browser scan
```
