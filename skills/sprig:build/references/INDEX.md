# References — table of contents

Condensed sprig docs. Read the leaf that matches what you're building before writing code
for an area you're unsure about. Start from `../SKILL.md`.

| File | Covers |
|---|---|
| `component-model.md` | Folder-components; `logic.ts` as a class vs `defineComponent({ setup })`; lifecycle hooks (`onServerInit`/`onBrowserInit`/`onServerDestroy`/`onBrowserDestroy`) + the server→client snapshot; signals; **Optimistic UI** (mandatory: snapshot → mutate → call → roll back); dependency injection (`@Injectable`/`inject`/`Backend`); `StateService` persisted state |
| `templates.md` | Angular-flavored HTML: `{{ }}` interpolation, `[prop]` inputs, `(event)` handlers, `@if`/`@else`/`@for`/`@empty`, composing child components by selector, `<content>` projection (self-close + fallback; `<ng-content>` alias), `<router-outlet>`, scoped `styles.css` |
| `routing.md` | `defineRoutes` + `load`; auto-loading a page's `logic.ts`/`resolve.ts` data (no module map); `createRenderer` + `bootstrap` |
| `serving.md` | `serveSprig` single-origin composition (the scaffold default: keep backend + UI, in-process `Backend`, `deno serve serve.ts`) + `sprigUi` middleware to mount under an existing host; the `static/` build output |
| `isolate.md` | `sprig isolate` — the Storybook-style workbench: components that have an `isolate/` folder (fixture + named cases), with a controls panel, console, tests, and HMR |

## Task → file

| Task | Read |
|---|---|
| Scaffold, project shape, the `sprig` CLI | `../SKILL.md` |
| Add a page or component; load its data; lifecycle | `routing.md`, `component-model.md` |
| Make a component interactive (island) | `component-model.md`, `templates.md` |
| A user action that writes to the server (optimistic by default) | `component-model.md` (Optimistic UI) |
| Write template bindings / control flow / projection | `templates.md` |
| Persist state across navigation | `component-model.md` (StateService) |
| Serve the app / mount in a host framework | `serving.md` |
| Preview or debug one component alone | `isolate.md` |
