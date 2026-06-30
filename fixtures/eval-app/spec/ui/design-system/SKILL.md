---
name: hearth-design
description: Use this skill to generate well-branded interfaces and assets for Hearth (a warm, cozy, a-little-hand-made community guestbook — a small corner of the internet where visitors leave a message on the wall), for production or throwaway prototypes/mocks. Ships a daisyUI-5 brand theme plus a consume recipe for the prototype skill.
user-invocable: true
---

This design system is built to be **consumed by the `prototype` skill** with zero
translation. Its single source of truth is **`theme.css`** — a Tailwind 4 + daisyUI 5 brand theme.

## To apply the brand
- **In a `prototype` (single-file HTML):** follow `consume/prototype.md` — paste `theme.cdn.css`,
  set `<html data-theme="brand">`, build with daisyUI semantic classes.
- **Component patterns:** `components.md` (daisyUI class recipes, MCP-verified).
- **Charts / data-viz:** `charts.md` (theme-native ApexCharts).
- **Token map for a sprig app:** `css-variables.json` (copy to its `src/css-variables.json`).
- **Brand voice, the 4 pillars, palette:** `README.md`.
- **See it rendered:** `preview/showcase.html`.

## What's canonical vs derived
- **Canonical (edit here):** `theme.css`.
- **Derived (regenerate, never hand-edit):** `theme.cdn.css`, `css-variables.json`, `manifest.json`,
  `adherence.oxlintrc.json`, and the values in `preview/*.html`.

Brand voice: warm, first-person, inviting — a host welcoming you in, never corporate. Palette: cream
`base-100` #FBF7F0 + espresso `base-content` #3B2A1E, with terracotta `primary` #C2410C as the one
precious CTA, sage `secondary` #5E6B47, and honey-gold `accent` #DA9A3E. Type: Caveat (display,
handwriting, headings only) + Quicksand (body). Generous radii (`--radius-box: 1.25rem`), a soft
`--depth: 1` shadow + subtle `--noise: 1` grain, and a gentle bounce-in (`.animate-rise`) for new entries.

If invoked without guidance, ask what to build, then act as an expert designer outputting either an
HTML artifact (via `prototype`), applying the theme above.
