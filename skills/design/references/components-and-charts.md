# Components & charts

## Components — pull recipes from the MCP, never hand-write

For each component the artifact documents (button, card, badge, alert, input, stat, table, modal, tabs,
navbar, …), call `daisyUI-Snippets` with `{ "components": { "<name>": true } }` and copy the class
recipe. Write them into `components.md` as small, brand-voiced snippets.

**Why the MCP is non-negotiable here:** daisyUI 5 removed v4 staples, and these are exactly the classes
a model "remembers" wrong:
- `input-bordered` → gone; `input` is bordered by default.
- `form-control` / `label-text` → gone; use `fieldset` / `legend` / `label`.
- Component color/size/style class families (`btn-{primary…}`, `btn-{xs…xl}`, `btn-{outline,soft,ghost,…}`)
  are enumerated by the MCP — copy them rather than guessing.

Rules for the recipes:
- **Semantic colors only** (`btn-primary`, `bg-base-100`, `text-base-content`) so they retheme with
  `data-theme`. Never raw `gray-*` or hex.
- The classes go in `prototype`'s plain HTML with Lucide via `<i data-lucide>`.

A `templates`/`layouts` pull is also available (`{ "templates": { "dashboard": true } }`,
`{ "layouts": { … } }`) — useful when scaffolding the `showcase.html` dashboard.

## Charts — theme-native, folded from `daisyui-charts`

The `daisyui-charts` package (ApexCharts recipes for area/column/line/pie/mixed) is the model for a
data-viz layer. The key property: **its charts read the same daisyUI semantic tokens `theme.css`
defines**, so a chart inherits `data-theme="brand"` with zero extra theming — light and dark for free.

Write `charts.md` with a themed example for the prototype:

**prototype (CDN, no build):**
```html
<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
<div id="sales"></div>
<script>
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  new ApexCharts(document.getElementById('sales'), {
    chart: { type: 'area', height: 260, fontFamily: '<Display>, sans-serif', toolbar: { show:false } },
    series: [{ name: 'Ventas', data: [31,40,28,51,42,68] }],
    colors: [css('--color-primary')],                 // resolves from data-theme
    stroke: { curve: 'smooth', width: 3 }, dataLabels: { enabled: false },
    fill: { type: 'gradient', gradient: { opacityFrom: .4, opacityTo: .05 } },
  }).render();
</script>
```
Read the theme colors with `getComputedStyle` (they resolve to the hex/oklch in `theme.cdn.css`).
Don't pass an unresolved `var(--color-…)` or a raw `color-mix(...)` string straight into ApexCharts'
JS color array — read the computed value first, or use a concrete shade.

### Shade derivation
Charts that need tints (a lighter slice, a faded grid line) use the `color-mix()` shade tokens from
`theme.css` (`--color-base-content-30`, etc.) or daisyUI opacity utilities — never the runtime-JS
injection the upstream package uses.

### Folding in the library itself (optional)
If the user wants the artifact self-sufficient, copy the `daisyui-charts` skill folder
(`skills/daisyui-charts/<type>/` — the per-type `SKILL.md` + chart `.md` recipes) into the artifact and
reference it from `charts.md`. If you only fold in the *patterns* (the default), say so plainly in
`charts.md` — don't reference `skills/daisyui-charts/` paths that aren't actually present.
