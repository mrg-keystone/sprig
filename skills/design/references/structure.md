# Artifact structure — canonical vs derived

The output is a self-contained folder. Three categories of file: **canonical** (the one you author),
**derived** (regenerate from the canonical — never hand-edit), and **docs/reference**.

```
<Brand> Design System/
  theme.css                 ★ CANONICAL — the only source of truth
  theme.cdn.css             derived — flattened [data-theme] twin for the prototype skill
  manifest.json             derived — token + card index
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
Use the theme names `brand` / `brand-dark` (not the brand's literal name) so the artifact is a reusable
template. The brand's identity lives in the *values* and in prose (`README.md`), not in the token names.
