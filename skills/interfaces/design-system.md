# Contract: design-system

> **Producer:** design · **Consumer:** prototype · Pipeline: design → prototype → breakdown → build → audit

A self-contained, brand-themed **design-system folder** the `prototype` stage drops into a
single-file HTML mock with zero translation.

## Artifact
A folder (e.g. `<Brand> Design System/`) whose **single source of truth is `theme.css`** — a
daisyUI 5 brand theme with a light theme (`brand`) and a dark theme (`brand-dark`). Everything
else is *derived* or *doc*:

- `theme.css` — **canonical**: `@plugin "daisyui/theme"` blocks + the non-color layer
  (`--font-display`/`--font-body`, a `--step-*` type scale, `--ease-*`/`--dur-*` motion, shade tokens).
- `theme.cdn.css` — derived flattened `[data-theme]` twin (what `prototype` pastes inline; no build step).
- `manifest.json`, `adherence.oxlintrc.json` — derived token/card index + token allow-list lint.
- `design-tokens.md`, `components.md`, `charts.md`, `README.md` — docs.
- `consume/prototype.md` — how the consumer applies it.
- `preview/*` incl. `showcase.html`; `SKILL.md` (the artifact is itself invokable).

## Shape (what `prototype` can rely on)
- daisyUI 5 **semantic tokens** as CSS custom properties — `bg-base-100`, `text-base-content`,
  `btn-primary`, … retheme by `data-theme`; never raw `gray-*` or hex.
- Two themes reachable by `data-theme="brand"` / `"brand-dark"`.
- A font + type-scale + motion layer daisyUI itself doesn't ship.

## Invariants
- **One source of truth:** `theme.css`; every derived file is byte-consistent with it.
- **Brand-generic names:** the theme is `brand`/`brand-dark`, never the literal brand name.
- The consumer applies it via the CDN stack (daisyUI + `@tailwindcss/browser@4` + lucide) and the
  flattened `theme.cdn.css` — the artifact's own `consume/prototype.md` is the recipe.

## Validation
Render `preview/showcase.html` (light + dark) and look; `adherence.oxlintrc.json` forbids
off-token values in consumer code.
