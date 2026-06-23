# `sprig isolate` — the component/page workbench

`sprig isolate` lets you develop and debug **one component at a time**, rendered standalone
instead of inside a full page. Run it from the app directory:

```sh
sprig isolate          # → http://localhost:8000/ui   (PORT env to change)
```

## What it does

1. **Discovers** every folder-component under `src` (any folder with a `template.html`,
   skipping `shell` and the generated `_isolate`).
2. For each **component**, generates a wrapper preview page that renders it in isolation —
   `src/_isolate/iso-<selector>/template.html` containing `<selector></selector>` (the
   `iso-` prefix keeps the wrapper's selector from colliding with the real component).
   **Pages** (under `pages/`) render directly.
3. Builds the app and serves it **through the dev server**, so islands get their AST
   endpoint + **HMR** — edit a component and the isolated preview hot-reloads.
4. Serves an **index picker** at `/ui` listing every component (with `page`/`component`
   tags); each links to `/ui/<selector>` where it renders alone.

Islands hydrate in isolation exactly as they would in a page (their `(event)` bindings,
`onBrowserInit`, signals all work), so you can interact with the component and watch it
behave.

## Usage

```sh
sprig isolate          # from the app dir; pick a component from the index, see it standalone
```

- Generated previews live in a gitignorable `src/_isolate/` (cleared and regenerated each
  run) — add `src/_isolate/` to `.gitignore`.
- It reuses the framework end to end — no separate workbench app or extra config.

## When to use it vs `sprig dev`

- **`sprig isolate`** — building or debugging a single component/island; you want it on its
  own, with HMR, without wiring it into a page.
- **`sprig dev`** — the whole app: real routes, pages composing many components, full
  navigation.

## Limitations (current)

It renders each component standalone with **default/empty inputs** — there is not yet a
controls panel, per-scenario cases, or an event log. To exercise a component with specific
inputs today, compose it in a throwaway page (or a `pages/` route) with the bindings you
want and use `sprig dev`. The isolation + HMR + per-component picker is the core loop.
