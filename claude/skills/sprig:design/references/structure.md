# Artifact structure — canonical vs derived

The output is a self-contained folder. Three categories of file: **canonical** (the one you author),
**derived** (regenerate from the canonical — never hand-edit), and **docs/reference**.

```
spec/ui/design-system/
  theme.css                 ★ CANONICAL — the only source of truth
  theme.cdn.css             derived — flattened [data-theme] twin for the prototype skill
  manifest.json             derived — token + card index
  css-variables.json        derived — plain token map a SPRIG app consumes (→ src/css-variables.json)
  adherence.oxlintrc.json   derived — token allow-list + lint rules
  design-tokens.md          doc — human token tables (token handoff reference)
  components.md             doc — daisyUI semantic-class recipes (MCP-verified)
  charts.md                 doc — theme-native ApexCharts recipes
  BUILD.md                  doc — how this artifact was built (a copy of the process)
  README.md                 doc — brand bible (voice, the 4 pillars, palette, caveats)
  SKILL.md                  doc — makes the artifact itself an invokable skill
  consume/
    prototype.md            doc — apply the brand in a prototype (single-file HTML)
  preview/
    *.html                  derived — specimens that <link> theme.cdn.css (colors, type, components…)
    showcase.html           derived — the full themed dashboard you render to verify
  assets/                   brand logos / illustrations (placeholders unless supplied)
```

## What "derived" means in practice

Everything derived is a mechanical transform of `theme.css`. When `theme.css` changes, regenerate
them; never edit them by hand. Each carries a `_generated`/`_note` header (JSON) or a comment (CSS/HTML)
saying so.

### `theme.cdn.css` — flattened twin (for `prototype`)
`theme.css` uses the build-time `@plugin "daisyui/theme" { name: "brand"; --color-…: … }` form. The
prototype skill has no build step, so it needs the same variables as a plain
`[data-theme="brand"] { --color-…: … }` block plus a `[data-theme="brand-dark"]` block and the
`:root` non-color layer. daisyUI 5 reads those `--color-*` vars at runtime, so components retheme with
no compiler. Keep the values byte-identical to `theme.css`.

### `manifest.json` — token + card index
A machine index. Top-level: `_generated: true`, `_source: "theme.css"`, `namespace`, `source:
"daisyui-theme"`, `globalCssPaths: ["theme.css"]`, `cdnCssPath: "theme.cdn.css"`, `themes[]` (name /
colorScheme / default|prefersdark), `brandFonts[]`, `tokens[]`, `cards[]`. Each `tokens[]` entry is
`{ name, light?, dark?, value?, kind }` where `kind ∈ color|radius|border|texture|font|easing|
duration|shade`. Each `cards[]` entry is `{ path, group, viewport, name, subtitle }` and must list
every file in `preview/`.

### `css-variables.json` — the sprig token map
`prototype` speaks daisyUI; **sprig** (`sprig:build`) does not — its build has no daisyUI plugin, so
it consumes a **plain** `src/css-variables.json` and compiles it into a global `@theme` (utility
tokens) + `:root` (the rest) + `[data-theme]` (variants). Derive this twin from `theme.css` so a sprig
app gets the brand with zero translation. Shape:

```json
{
  "default": "brand-dark",
  "themes": {
    "brand-dark": { "color-scheme": "dark",  "--color-primary": "…", "--radius-box": "…", "--step-0": "…", "--color-base-content-30": "color-mix(…)" },
    "brand":      { "color-scheme": "light", "--color-primary": "…" }
  }
}
```

Derivation rules:
- **Default theme = every token** — the daisyUI theme-block colors/radii AND the whole `:root`
  non-color layer (fonts, the `--step-*` scale, `--ease-*`, `--dur-*`, the `color-mix` tints) +
  `color-scheme`. **Each other theme = only what differs** (the colors) + `color-scheme`; the rest
  cascades from the default.
- **`default`** is the theme that renders with **no `data-theme` attribute**. For sprig SSR (the
  document `<html>` can't carry the attribute) a dark-first app sets it to `brand-dark` to avoid a
  light flash — this may differ from `theme.css`'s daisyUI `default: true`, and that's fine (different
  consumers).
- **Variables only.** Keys must be custom properties (`--*`) or the reserved `color-scheme` — the sprig
  build **rejects** anything else. So **drop** `--size-*`, `--border`, `--depth`, `--noise` (daisyUI
  plugin params the plain sprig build can't use).
- Tokens in a Tailwind utility namespace (`--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--ease-*`)
  also generate utilities (`bg-primary`, `text-step-2`, `rounded-box`). Keep values byte-identical to
  `theme.css`.

### `adherence.oxlintrc.json` — token allow-list + lint
An oxlint config that forbids raw hex / raw px / off-system fonts in code (so consumers use tokens),
plus an `x-ds` block cataloging the legal token names (`fontFamilies`, `semanticColors`, `radii`,
`typeScale`, `easing`, `shades`) and a `prototypeDesignLint.knownBrandExceptions` list. Derive the
allow-list from the tokens actually defined in `theme.css`.

## Preview specimens
Each `preview/*.html` is self-contained but **links the canonical theme** (`../theme.cdn.css`) — it
never inlines a private copy of the tokens, so a specimen can't drift from the source. A specimen sets
`<html data-theme="brand">`, loads the daisyUI CDN **and the Tailwind browser compiler** (see
`consume-and-verify.md`), and uses daisyUI semantic classes. `showcase.html` is the one full-page
dashboard you render to prove the system holds together.

## Brand-agnostic by construction
The folder lives at the fixed pipeline path `spec/ui/design-system/`, but its contents stay a reusable
template: use the theme names `brand` / `brand-dark` (not the brand's literal name) so it can be lifted
out and reused elsewhere. The brand's identity lives in the *values* and in prose (`README.md`), not in
the folder name or the token names.
