# `sprig isolate` — the component/page workbench

`sprig isolate` is a Storybook-style **workbench** for developing and debugging components in
isolation — each rendered standalone, in named states ("cases"), with live controls, a console,
and Playwright tests. Run it from the app directory:

```sh
sprig isolate          # → http://localhost:8000/   (PORT env to change; picks the next free port)
```

## A component shows only if it has an `isolate/` folder

Discovery scans **every** top-level folder under `src/` (`shared-components/`, `pages/`, or
whatever layout you use; `shell` is skipped). A folder-component (a folder with a
`template.html`) appears in the workbench **only when it also has an `isolate/` folder** — its
`fixture.json` + `cases/`. No `isolate/` → it is **not** shown (you'll see *"Nothing to isolate —
no folder-component has an isolate/ folder yet."*). There is no auto/"default" case.

A folder under `pages/` is treated as a page; anything else is a component. Author the
`isolate/` folder per **`breakdown/references/isolate-format.md`** (fixture + cases + tests):

```
src/shared-components/ui-button/
  template.html
  logic.ts
  isolate/
    fixture.json                  # category, controls (the controls panel), …
    cases/
      primary/primary.json        # one named state → one entry in the sidebar
      disabled/disabled.json
      disabled/tests/*.spec.ts     # optional Playwright tests for this case
```

## What you get

- **Sidebar** — every component/page grouped by category, each with its named cases.
  `⌘K` / "Jump to a case…" to fuzzy-find.
- **Stage** — the selected case rendered in an iframe (it hydrates exactly as in a page:
  `(event)` bindings, `onBrowserInit`, signals all work). Viewport presets (fit/360/768/1024/
  full), zoom, and a stage-background picker.
- **Controls** — edit the case's inputs/signals live (declared in `fixture.json`).
- **Console** — the component's console output.
- **Tests** — run the case's Playwright specs ("Run all tests", per-case results).
- **HMR** — edit the component's `template.html`/`styles.css`/`logic.ts` (or a case's JSON) and
  the stage hot-swaps **without a restart**.

## How it works (internals)

It builds a small workbench app (a separate sprig app shipped with the CLI) in dev mode,
copies each discovered case's component into the workbench's previews, and serves the whole
thing — UI + the in-process keep backend (discovery + test runner) — through the compiler's dev
server for HMR. None of this lands in your project (the build goes to a temp cache, not
`static/`); your `src/` only ever holds the `isolate/` folders you author.

## When to use it vs `sprig dev`

- **`sprig isolate`** — building/debugging a single component in named states, with controls +
  tests, on its own.
- **`sprig dev`** — the whole app: real routes, pages composing many components, full nav.
