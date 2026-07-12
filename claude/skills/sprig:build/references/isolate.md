# `sprig isolate` — the component/page workbench

`sprig isolate` is a Storybook-style **workbench** for developing and debugging components in
isolation — each rendered standalone, in named states ("cases"), with live controls, a console,
and Playwright tests. Run it from the app directory:

```sh
sprig isolate          # → http://127.0.0.1:8000/   (PORT env to change; picks the next free port)
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

## Case tests under `isolate test` (headless)

`isolate test <unit> --json` (also `sprig isolate`'s "Run all tests") executes each case's
`tests/*.spec.ts` with a **Node** Playwright runner, not Deno. Two consequences, both measured
fleet-killers:

1. **The only dialect that loads** is plain Playwright. Every runnable spec starts:

   ```ts
   import { expect, test } from "@playwright/test";

   // The runner exposes the preview server as ISOLATE_BASE_URL; no playwright
   // config sets a baseURL, so resolve routes against it explicitly.
   const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

   test("case renders", async ({ page }) => {
     await page.goto(`${BASE}/pages/guestbook/message-card/with-photo`);
     await expect(page.locator("article")).toHaveCount(1);
   });
   ```

   `@std/expect`, `jsr:`/`#alias` specifiers, and any other Deno-only import **fail at load
   time**. The `isolate-events` helpers DO work under the headless runner (the stage-bridge
   produces both signals): `waitHydrated(page)` resolves once the target island's scope is
   attached **and the case's `_signals` are applied** (a static target is ready at SSR), and
   `capture(page)` — called BEFORE `page.goto` — streams the stage's DOM events:

   ```ts
   import { capture, waitHydrated } from "isolate-events";
   ```

   A lower-level alternative that also works — wait for the marker the runtime stamps on
   each hydrated island (NB: it lands before signal seeding, unlike `waitHydrated`):

   ```ts
   await page.waitForSelector(
     'sprig-island[data-sel="message-composer"][data-sprig-hydrated]',
     { state: "attached", timeout: 8000 },
   );
   ```

   Island preview props: a preview target gets NO static prop bindings — a bare prop
   renders as its default. Seed island state via `fixture.json` controls declared
   `"signal": true` and per-case `_signals.<prop>` values (`waitHydrated` gates on the
   seeding having landed; the bare hydration marker does not). Route nuance: a component folder under
   `pages/<page>/components/<name>` previews under `/pages/...` (isolate treats the subtree
   as page-scoped), not `/components/...` — always take the route from `isolate list`.

2. **Timed behaviors: assert the durable END-STATE, never a transient window.** A spec
   that waits a fixed delay and then expects an ephemeral intermediate (an `-exiting`
   class that lives ~250ms, a spinner, a focus that a later render moves) is flaky by
   construction under parallel/gate load — the window closes before the poll lands
   (measured: three separate fleet flakes, all this shape). Poll for the durable outcome
   instead (`toHaveCount(0)` after a dismiss, the posted row present, the final class set)
   with a generous timeout; test an intermediate state only by FREEZING it (a case that
   pins the state via `_signals`, or reduced-motion).

3. **`{ "ran": false, "total": 0 }` means your spec files never executed** — almost always a
   spec that failed to load (the report's `error` field names the import). Fix the spec's
   imports against the header above and re-run. It is NOT a server/port/process problem:
   do not restart servers, kill processes, or debug the runner install over this verdict.

The preview route is `/<components|pages>/<category>/<folder>/<case>` from `fixture.json` —
never derived from the source path.

**Preview generation** (how your `isolate/` files become pages — never read the compiler
for this): at test/dev time each case is materialized as a generated preview page under the
WORKBENCH app's `src/pages/_preview/pv-<path>-<case>/` (inside your `SPRIG_WB_ROOT`), with
`fixture.json` controls compiled in and `_signals` values seeded just after hydration. To
debug a wrong preview, `cat` that generated folder in YOUR OWN workbench — it shows exactly
what your fixture/case JSON produced.

**Runner facts** (everything agents have gone reading runner source for): specs execute
under the pre-provisioned Node Playwright install; each spawn has a **hard ~120s timeout**
(a hung suite comes back as `error: "timeout"`, not a hang); `ISOLATE_BASE_URL` is the only
wiring a spec needs — no `playwright.config.*` is required (one at the app root is
auto-detected IF present, otherwise defaults apply); the JSON report shape is
`{ ok, ran, total, passed, failed, testResults[], error? }` and `--failures-only` trims
`testResults` to red rows while keeping the counts.

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
