---
name: "sprig:design"
description: >-
  Create a reusable design-system artifact — a daisyUI-5 brand theme plus tokens,
  component/chart recipes, and consume guides — that the prototype skill can apply with
  zero translation. Use this whenever the user wants to build or generate a design system,
  brand theme, or design tokens: phrases like "create a design system", "make a
  brand/design system", "build a theme for our brand", "turn this palette/brand/logo/Figma
  into a design system", "design tokens our prototypes and sprig apps can share", or "a
  house style we can reuse". Produces a folder whose single source of truth is one
  theme.css, with derived files, docs, preview specimens, and its own SKILL.md so the
  output is itself an invokable skill. NOT for applying an already-built design system (use
  its consume recipe, or the prototype skill), restyling a single component, or building a
  one-off throwaway mock (that's the prototype skill).
version: 1.1.0
user-invocable: true
argument-hint: "[brand brief: name, palette, fonts, vibe] [optional: Figma URL or reference screenshots]"
license: Apache 2.0
allowed-tools:
  - Task
  - Read
  - Glob
  - Grep
  - Bash
---

# design — orchestrate a brand design-system artifact

> **Pipeline stage — design** (start). Produces the `design-system` contract
> (`../interfaces/design-system.md`), consumed by `prototype`. Full chain:
> design → prototype → breakdown → build → audit.

Generate a **design-system artifact**: a self-contained, brand-themed folder at
`spec/ui/design-system/` that the **`prototype`** skill consumes directly (it pastes the
flattened twin inline). The artifact is itself an invokable skill (it ships a `SKILL.md`).
The brand then rides downstream through the rest of the pipeline, so **design only ever
talks to `prototype`**.

**You are the orchestrator. You don't author, derive, or render yourself — you delegate
each pass to a named specialist** and chain them around the one rule below.

## The one rule that matters most

**There is exactly one source of truth: `theme.css`.** `theme.cdn.css`, `css-variables.json`,
`manifest.json`, `adherence.oxlintrc.json`, and the values in `preview/*.html` are all
*derived* from it. Never let the same token be hand-maintained in two places — that drift
(pink here, green there) is the exact failure this format prevents. The
canonical-vs-derived layout is `references/structure.md`.

## The specialists you delegate to

| Agent | Pass | Owns / reads |
|---|---|---|
| **`sprig-design-author`** | author the canonical `theme.css` (daisyUI MCP) + font pairing (typography MCP) + non-color layer + `components.md`/charts | `references/theme-and-tokens.md`, `references/typography.md`, `references/components-and-charts.md`, `assets/templates/theme.css` |
| **`sprig-design-deriver`** | derive the machine files (`theme.cdn.css`, `css-variables.json`, `manifest.json`, `adherence.oxlintrc.json`) + docs (`consume/prototype.md`, `README.md`, the artifact's `SKILL.md`) | `references/structure.md`, `assets/templates/` |
| **`sprig-design-verifier`** | serve + screenshot `showcase.html` light & dark; catch the collapsed-layout failure | `references/consume-and-verify.md` |

Each specialist owns its own procedure (the MCP calls, the derivation, the render loop) —
**do not restate their steps here.**

## The flow

1. **Author.** Delegate to **`sprig-design-author`** with the brand brief (+ any Figma URL)
   and the output dir → it writes `theme.css` (light `brand` + dark `brand-dark`), picks the
   fonts, adds the non-color layer, and writes `components.md` + chart recipes. Take its
   note of the font pairing, the semantic mapping, and any brand lint-exception.
2. **Derive.** Delegate to **`sprig-design-deriver`** with the output dir (now holding
   `theme.css`) → it emits the derived machine files and the docs (incl. `showcase.html`
   and the artifact's own `SKILL.md`), byte-consistent with `theme.css`, documenting any
   flagged brand exception in `consume/prototype.md`.
3. **Verify.** Delegate to **`sprig-design-verifier`** → it serves `showcase.html` over
   HTTP and screenshots light + dark, returning a PASS/FAIL on the collapsed-layout check.
   On FAIL or an off-token result, loop back to the author (theme issue) or deriver
   (derivation issue), then re-verify. **Looking is the test** — don't declare done on
   markup alone.

## Output location & naming

Write to **`spec/ui/design-system/`** (relative to the **git root**; create `spec/ui/`
if absent) — the shared UI-pipeline home. Use a **generic theme name** (`brand`/`brand-dark`)
inside `theme.css` so the artifact stays a reusable template; refer to the brand by name
only in prose. (Copy the folder elsewhere for a standalone brand-named skill — but the
pipeline home is this fixed path.)

## Lint awareness (prototype's design-lint)

`prototype` ships a `design-lint` auditor. A brand may legitimately trip `cream-palette`,
`overused-font`, or `bounce-easing`. When a brand intentionally uses one, the author flags
it and the deriver documents it as a known exception in `consume/prototype.md` — never
ship it silently.

## Distribution

These artifacts install as skills: `npx skills add <folder>`, or drop the folder into a
project's `skills/`. The folded-in `daisyui-charts` companion installs the same way.

## Reference map (owned by the specialists)
- `references/structure.md` — file layout; canonical vs derived → **`sprig-design-deriver`**.
- `references/theme-and-tokens.md` — authoring `theme.css` → **`sprig-design-author`**.
- `references/typography.md` — font pairing + type scale → **`sprig-design-author`**.
- `references/components-and-charts.md` — component + chart recipes → **`sprig-design-author`**.
- `references/consume-and-verify.md` — consume recipe + render/verify loop → **`sprig-design-verifier`**.
- `assets/templates/` — fill-in starter files (author: `theme.css`; deriver: the rest).
