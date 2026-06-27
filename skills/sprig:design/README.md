# design

A skill that **generates design-system artifacts** — a self-contained, brand-themed folder written to
`spec/ui/design-system/` (the shared UI-pipeline home), which the `prototype` skill consumes with zero
translation.

Each artifact's single source of truth is one `theme.css` (a daisyUI-5 brand theme); everything else
(`theme.cdn.css`, `manifest.json`, `adherence.oxlintrc.json`, preview specimens) is derived from it.
The build process is **MCP-driven** — it pulls the canonical theme template and component classes from
the `daisyui-blueprint` MCP so the output matches the installed daisyUI version — folds in theme-native
ApexCharts, and ends by rendering a showcase to verify.

- **Entry point:** [`SKILL.md`](SKILL.md) — the process.
- **`references/`** — structure (canonical vs derived), theme authoring, components & charts, consume & verify.
- **`assets/templates/`** — fill-in starter files for every artifact file.

Output location: **`spec/ui/design-system/`** (relative to the **git root** — the dir containing
`.git`, falling back to the project dir outside a git repo). The folder is brand-generic
(`brand` / `brand-dark`) so it can be lifted out and reused as a standalone design-system skill.
