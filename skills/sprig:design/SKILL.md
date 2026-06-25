---
name: "sprig:design"
description: Create a reusable design-system artifact — a daisyUI-5 brand theme plus tokens, component/chart recipes, and consume guides — that the prototype skill can apply with zero translation. Use this whenever the user wants to build or generate a design system, brand theme, or design tokens: phrases like "create a design system", "make a brand/design system", "build a theme for our brand", "turn this palette/brand/logo/Figma into a design system", "design tokens our prototypes and sprig apps can share", or "a house style we can reuse". Produces a folder whose single source of truth is one theme.css, with derived files, docs, preview specimens, and its own SKILL.md so the output is itself an invokable skill. NOT for applying an already-built design system (use its consume recipe, or the prototype skill), restyling a single component, or building a one-off throwaway mock (that's the prototype skill).
version: 1.1.0
user-invocable: true
argument-hint: "[brand brief: name, palette, fonts, vibe] [optional: Figma URL or reference screenshots]"
license: Apache 2.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(python3 *)
  - Bash(deno *)
  - mcp__daisyui-blueprint__daisyUI-Snippets
  - mcp__daisyui-blueprint__Figma-to-daisyUI
  - mcp__google-fonts__search_fonts
  - mcp__google-fonts__list_pairings
  - mcp__google-fonts__generate_typography_system
  - mcp__google-fonts__list_scales
  - mcp__google-fonts__lookup_font
  - mcp__playwright__browser_navigate
  - mcp__playwright__browser_take_screenshot
  - mcp__playwright__browser_resize
  - mcp__playwright__browser_evaluate
  - mcp__playwright__browser_wait_for
---

# design

> **Pipeline stage — design** (start). Produces the `design-system` contract
> (`../interfaces/design-system.md`), consumed by `prototype`. Full chain:
> design → prototype → breakdown → build → audit.

Generate a **design-system artifact**: a self-contained folder, themed to a brand, that the
**`prototype`** skill consumes directly (one throwaway HTML file). The artifact is also its own
invokable skill (it ships a `SKILL.md`), so once built it can be handed to `prototype` or re-invoked
on its own. The brand then rides downstream through the rest of the pipeline (prototype → breakdown
→ build), so **design only ever talks to `prototype`** — never directly to the build stage.

## Why this shape works

`prototype` natively speaks **daisyUI 5** semantic tokens expressed as CSS custom properties, so one
canonical daisyUI theme drops straight in: `prototype` pastes the flattened twin (`theme.cdn.css`)
inline. Everything else in the artifact is *derived* from that one file, which is what keeps it from
rotting. Internalize the [`references/structure.md`](references/structure.md) layout — canonical vs
derived — before you build.

## The one rule that matters most

**There is exactly one source of truth: `theme.css`.** `manifest.json`, `adherence.oxlintrc.json`,
`theme.cdn.css`, and the values inside `preview/*.html` are all *derived* from it. Never hand-maintain
the same token in two places — that drift (a palette that says pink here and green there) is the exact
failure this format exists to prevent.

## The build process

Follow these in order. Steps marked **MCP** require the daisyUI MCP (`daisyui-blueprint`) — it is the
authoritative source for the theme template and component classes, and it catches daisyUI-4-vs-5 drift
that hand-writing silently introduces. Do not skip it; "I remember the daisyUI API" is how you ship a
theme with a missing variable or a removed class.

1. **Gather the brief.** Brand name, palette (≥ a primary + neutrals), a display + body font pairing,
   voice/tone. If the user gives a **Figma URL**, call **`Figma-to-daisyUI`** (MCP) to extract palette,
   type, and structure, and seed the values from it.

2. **Author `theme.css` — MCP.** Call `daisyUI-Snippets` with
   `{ "themes": { "custom-theme": true, "colors": true } }` to pull the **complete, correctly-named**
   custom-theme variable template + the semantic-color reference. Map brand colors onto the semantic
   roles and fill the template. Author a light theme (`default: true`) and a dark one
   (`prefersdark: true`). Details + a fill-in skeleton: [`references/theme-and-tokens.md`](references/theme-and-tokens.md)
   and [`assets/templates/theme.css`](assets/templates/theme.css). **Hex values are allowed**
   (OKLCH is the house style, not a requirement).

3. **Add the non-color layer to `theme.css` (fonts, type scale, motion).** daisyUI ships none of it.
   **Pick the fonts with a typography selector, not from memory** — models default to Space Grotesk /
   Inter, which the consumers' lints warn against. Primary: the **google-fonts MCP**
   (`claude mcp add google-fonts -- uvx google-fonts-mcp`; `search_fonts` / `list_pairings` /
   `generate_typography_system` → a vibe-matched, contrast-classified display+body pairing + a modular
   scale, emitted as CSS custom properties + a Google Fonts embed). Alternative: **font-mcp** (vibe or
   reference-URL research). If neither is connected, use the hand-selection rules in
   [`references/typography.md`](references/typography.md). Then put it all in the same file:
   `@import`/`@font-face` + `--font-display`/`--font-body`, the `--step--2 … --step-5` scale,
   `--ease-*`/`--dur-*` + `@keyframes` + a `prefers-reduced-motion` block, and `color-mix()` shade
   tokens for charts/tints.

4. **Author `components.md` + `preview/*.html` — MCP.** For each component, call `daisyUI-Snippets`
   with `{ "components": { "<name>": true } }` and copy the classes verbatim. Do not hand-write daisyUI
   classes — daisyUI 5 removed v4 staples like `input-bordered` and `form-control`/`label-text`, and
   only the MCP reliably reflects that. See [`references/components-and-charts.md`](references/components-and-charts.md).

5. **Add charts.** Charts are *theme-native* — ApexCharts reading `var(--color-*)` inherit the brand
   for free (light and dark). Fold recipes from the `daisyui-charts` package. See
   [`references/components-and-charts.md`](references/components-and-charts.md).

6. **Derive the machine files from `theme.css`.** Generate `theme.cdn.css` (flattened `[data-theme]`
   twin), `manifest.json` (token + card index), `adherence.oxlintrc.json` (token allow-list + lint
   rules). Same source → identical output. See [`references/structure.md`](references/structure.md).

7. **Write the consume recipe + skill manifest.** `consume/prototype.md`, `README.md` (brand bible),
   `SKILL.md` (so the artifact is invokable). Templates in
   [`assets/templates/`](assets/templates/); the prototype recipe's CDN gotcha is in
   [`references/consume-and-verify.md`](references/consume-and-verify.md).

8. **Render to verify — don't trust the markup.** Build a `preview/showcase.html` dashboard and
   actually open it in a browser (serve over HTTP; `file://` is blocked in the Playwright MCP).
   Screenshot light and dark. The single most common failure is a **collapsed layout** because the
   page loaded the daisyUI CDN stylesheet but not the Tailwind browser compiler — see
   [`references/consume-and-verify.md`](references/consume-and-verify.md). Looking is the test.

## Output location & naming

Write the artifact to **`spec/ui/design-system/`** (relative to the project root; create `spec/ui/`
if it doesn't exist) — the shared home for every UI-pipeline artifact (`spec/ui/design-system/`,
`spec/ui/<app>-prototype.html`, `spec/ui/breakdown/`), so the downstream skills find it at one
known path. Use a generic theme name (`brand` / `brand-dark`) inside `theme.css` so the artifact
stays a reusable template; refer to the brand by name only in prose. (Copy the folder elsewhere if
you want a standalone, brand-named, reusable design-system skill — but the pipeline location is
`spec/ui/design-system/`.)

## Lint awareness (prototype's design-lint)

`prototype` ships a `design-lint` auditor. A brand may legitimately trip `cream-palette` (very pale
surface), `overused-font` (Inter/Roboto), or `bounce-easing` (overshoot curves). When a brand
intentionally uses one, document it as a known exception in `consume/prototype.md` rather than
silently shipping it.

## Distribution

These artifacts install as skills: `npx skills add <folder>` (the `saadeghi/skills` CLI), or drop the
folder into a project's `skills/`. The folded-in `daisyui-charts` companion installs the same way.

## Reference map
- [`references/structure.md`](references/structure.md) — the artifact's file layout; canonical vs derived; how to derive each machine file.
- [`references/theme-and-tokens.md`](references/theme-and-tokens.md) — authoring `theme.css`: the daisyUI MCP template, the non-color layer, shades, the flattened twin.
- [`references/typography.md`](references/typography.md) — picking the font pairing + type scale via the google-fonts MCP / font-mcp (or hand-selection rules).
- [`references/components-and-charts.md`](references/components-and-charts.md) — component recipes via the MCP (incl. v4→v5 gotchas) and theme-native ApexCharts.
- [`references/consume-and-verify.md`](references/consume-and-verify.md) — the two consume recipes (incl. the Tailwind-browser gotcha) and the serve/render/screenshot verify loop.
- [`assets/templates/`](assets/templates/) — fill-in starter files for every artifact file.
