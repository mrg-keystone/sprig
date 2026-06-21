# design

A skill that **generates design-system artifacts** — self-contained, brand-themed folders that the
sibling `prototype` skill consumes with zero translation.

Each artifact's single source of truth is one `theme.css` (a daisyUI-5 brand theme); everything else
(`theme.cdn.css`, `manifest.json`, `adherence.oxlintrc.json`, preview specimens) is derived from it.
The build process is **MCP-driven** — it pulls the canonical theme template and component classes from
the `daisyui-blueprint` MCP so the output matches the installed daisyUI version — folds in theme-native
ApexCharts, and ends by rendering a showcase to verify.

- **Entry point:** [`SKILL.md`](SKILL.md) — the process.
- **`references/`** — structure (canonical vs derived), theme authoring, components & charts, consume & verify.
- **`assets/templates/`** — fill-in starter files for every artifact file.

Reference example output: the "Sabor Design System" folder this skill was modeled on.
