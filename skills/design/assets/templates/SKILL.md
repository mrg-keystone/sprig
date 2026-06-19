---
name: {{brand-slug}}-design
description: Use this skill to generate well-branded interfaces and assets for {{Brand}} ({{one-line audience/positioning}}), for production or throwaway prototypes/mocks. Ships a daisyUI-5 brand theme plus a consume recipe for the prototype skill.
user-invocable: true
---

This design system is built to be **consumed by the `prototype` skill** with zero
translation. Its single source of truth is **`theme.css`** — a Tailwind 4 + daisyUI 5 brand theme.

## To apply the brand
- **In a `prototype` (single-file HTML):** follow `consume/prototype.md` — paste `theme.cdn.css`,
  set `<html data-theme="brand">`, build with daisyUI semantic classes.
- **Component patterns:** `components.md` (daisyUI class recipes, MCP-verified).
- **Charts / data-viz:** `charts.md` (theme-native ApexCharts).
- **Token reference / handoff:** `design-tokens.md`.
- **Brand voice, the 4 pillars, do/don't:** `README.md`.
- **See it rendered:** `preview/showcase.html`.

## What's canonical vs derived
- **Canonical (edit here):** `theme.css`.
- **Derived (regenerate, never hand-edit):** `manifest.json`, `adherence.oxlintrc.json`,
  `theme.cdn.css`, and the values in `preview/*.html`.

Brand voice: {{voice in one line}}. Palette: {{anchor colors + roles}}. Type: {{Display}} (display) +
{{Body}} (body). {{radii/shadow signature}}.

If invoked without guidance, ask what to build, then act as an expert designer outputting either an
HTML artifact (via `prototype`), applying the theme above.
