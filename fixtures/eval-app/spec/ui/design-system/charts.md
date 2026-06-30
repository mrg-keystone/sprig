# Hearth — Chart Recipes (theme-native ApexCharts)

The guestbook needs only one small chart: **messages per day** on the host's dashboard.
The whole point of this layer is that charts read the **same daisyUI semantic tokens**
`theme.css` defines, so a chart inherits `data-theme="brand"` / `data-theme="brand-dark"`
with zero extra theming — light and dark come for free.

> This file folds in the **patterns** from the `daisyui-charts` approach, not the upstream
> package itself. There is no `skills/daisyui-charts/` folder in this artifact — everything
> you need is in the snippet below.

## Reading theme colors (the one rule that matters)

ApexCharts' JS `colors` array needs **resolved** color values, not CSS `var(--…)` strings
and not raw `color-mix(...)`. Read the computed value off `:root` first:

```js
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
```

When the user flips `data-theme`, re-read and `chart.updateOptions({ colors: [...] })` (or
just re-`render()`), since the resolved hex changes between `brand` and `brand-dark`.

## Messages per day (area, CDN — no build)

```html
<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
<div id="messages-per-day"></div>
<script>
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  new ApexCharts(document.getElementById('messages-per-day'), {
    chart: { type: 'area', height: 260, fontFamily: 'Quicksand, sans-serif', toolbar: { show: false } },
    series: [{ name: 'Messages', data: [4, 7, 5, 12, 9, 15, 11] }],
    xaxis: { categories: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    colors: [css('--color-primary')],                 // terracotta, resolves from data-theme
    stroke: { curve: 'smooth', width: 3 },
    dataLabels: { enabled: false },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.04 } },
    grid: { borderColor: css('--color-base-300') },   // warm tan grid lines
    tooltip: { theme: 'light' },                      // swap to 'dark' under brand-dark
  }).render();
</script>
```

## Where the signers came from (donut, brand hues)

Uses the warm palette across the slices — primary terracotta, secondary sage, accent honey,
neutral brown — so the chart reads as obviously Hearth:

```html
<div id="signer-sources"></div>
<script>
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  new ApexCharts(document.getElementById('signer-sources'), {
    chart: { type: 'donut', height: 260, fontFamily: 'Quicksand, sans-serif' },
    series: [48, 22, 18, 12],
    labels: ['Direct', 'Shared link', 'Search', 'Other'],
    colors: [css('--color-primary'), css('--color-secondary'), css('--color-accent'), css('--color-neutral')],
    legend: { position: 'bottom', labels: { colors: css('--color-base-content') } },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
  }).render();
</script>
```

## Shade / tint derivation

For faded fills or a soft grid line, use the `color-mix()` shade tokens defined once in
`theme.css` (`--color-base-content-30`, `--color-primary-15`, `--color-primary-30`, …) or
daisyUI opacity utilities inline (`bg-primary/10`, `text-base-content/30`). Do **not**
reach for runtime JS color injection. If you feed a shade into ApexCharts' JS `colors`,
read its computed value with the `css()` helper first — never pass an unresolved
`var(--…)` or a raw `color-mix(...)` string into the color array.
