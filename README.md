# isolate

> Spin up a standalone, Storybook-style preview for any component, island, or
> page in a [Fresh 2](https://fresh.deno.dev) project — with a live, typed
> controls panel, an event log, and a one-click Playwright runner. No config, no
> separate build: annotate a component with a tiny `isolate/` folder and run one
> command.

`@mrg-keystone/isolate` is a Deno CLI you run from inside a Fresh project. It
finds every component that has an `isolate/` folder, scaffolds a **real Fresh
app** under `~/isolate/<project>`, symlinks your
`components/`·`islands/`·`pages/` into it, and serves one preview route per
scenario. Each preview lets you edit props and signals live and watch the
component react, mock or stub its sub-components, read every DOM event it fires,
and run that scenario's browser tests with a click.

## Install

```sh
deno install -gA -n isolate jsr:@mrg-keystone/isolate
```

That puts an `isolate` binary on your PATH (in `~/.deno/bin`). Prefer not to
install? Run it one-off with `deno run -A jsr:@mrg-keystone/isolate <cmd>`.

**Prerequisites:** [Deno](https://deno.com); **Node/npm on PATH** (the first
`dev`/`test` run does a one-time `npm i` into `~/.isolate-runner` for
`@playwright/test`, `rxjs`, and the `isolate-events` test helper); a system
[Playwright](https://playwright.dev) install is reused if present, otherwise
`@playwright/test@latest` is fetched.

## The commands

| Command                 | What it does                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `isolate list`          | List discovered components + their cases and routes                                                                 |
| `isolate dev`           | Build & serve the preview app, open the browser (`--no-open` to skip)                                               |
| `isolate test [filter]` | Run every case's Playwright tests headlessly (`--json` for agents/CI)                                               |
| `isolate update`        | Install/refresh the bundled Claude Code skills at `~/.claude/skills` and the global CLI, both to the latest release |

The project commands take `--root <path>` to point at the Fresh project
(default: the current directory).

The package also ships **three Claude Code skills** (under `skills/`), one per
stage of the build lifecycle:

| Skill                 | Stage | What it does                                                                            |
| --------------------- | ----- | --------------------------------------------------------------------------------------- |
| `skills/prototype`    | 1     | Build a throwaway single-file clickable HTML prototype to answer "what are we building" |
| `skills/ui-breakdown` | 2     | Decompose a mock/prototype into a build-ready spec (components, tokens, fixtures)       |
| `skills/deno-fresh2`  | 3     | Expert Fresh 2 guidance for the real build, including authoring `isolate/` fixtures     |

Each skill directory is named after its SKILL.md `name:`. `isolate update`
installs all of them at user scope — for each it deletes
`~/.claude/skills/<name>` and replaces it with the latest published copy (it
refuses to delete a dir that holds a git checkout, so a dev setup is never
clobbered).

## Quickstart — your first preview in 5 minutes

Say you have a component at `components/button/Button.tsx` that exports
`Button`.

**1.** Drop an `isolate/` folder next to it with one fixture and one case:

```
components/button/
  Button.tsx
  isolate/
    fixture.json
    cases/
      primary/
        primary.json
```

```jsonc
// components/button/isolate/fixture.json — metadata + which props get controls
{
  "category": "buttons",
  "controls": { "disabled": { "type": "boolean" } }
}
```

```jsonc
// components/button/isolate/cases/primary/primary.json — one scenario
{ "_name": "Primary", "id": "primary", "_innerHtml": "Click me" }
```

**2.** From your project root, run:

```sh
isolate dev
```

**3.** The gallery opens. Click **Primary** → you land on
`/components/buttons/primary` with your button on a stage, a **`disabled`
checkbox** in the controls panel (toggle it and the button reacts live), and an
**event log** that records every click. That's it — add more cases as more
`*.json` files, or more components by giving each its own `isolate/` folder.

> Tip: run `isolate list` first to see the exact route generated for every case.

## How discovery works

Three source roots are scanned; a component is "isolatable" the moment it has an
`isolate/` subfolder:

| Source root          | Treated as                                                           | Routes under    |
| -------------------- | -------------------------------------------------------------------- | --------------- |
| `components/<name>/` | a single component (static, ships no JS)                             | `/components/…` |
| `islands/<name>/`    | a single component (island · hydrated)                               | `/components/…` |
| `pages/<name>/`      | a **page composition** (a component + the sub-components it renders) | `/pages/…`      |

**The preview URL is built from `fixture.json`, not the folder name:**

```
/<prefix>/<category>/<folder>/<case>      (the folder segment is omitted when empty)
   prefix  = "components" for components/ + islands/,  "pages" for pages/
   category, folder  come from fixture.json (category defaults to the folder name)
```

So `components/button/` with `category:"buttons"`, `folder:"regular"`, case
`primary` serves at `/components/buttons/regular/primary` — not
`/components/button/...`.

**How the component itself is resolved:** the folder name pascal-cases into the
expected export (`float-button` → `FloatButton`), the matching `.tsx` file is
imported, and the component must be its **default export or a named export with
that exact name** — nothing else. A file that matches by name but exports
neither is reported as a config problem by `list`/`dev`/`test`, and the preview
renders a visible error card (file, expected export, exports actually seen)
instead of a blank stage.

## `fixture.json`

```jsonc
{
  "category": "counter", // gallery group + URL segment (default: folder name)
  "folder": "default", // sub-group + URL segment (optional)
  "background": "#f7f3ea", // stage background behind the component (optional)

  // Controls for the TOP-LEVEL component. Each key declares a widget.
  "controls": {
    "count": { "type": "range", "min": 0, "max": 20, "step": 1, "signal": true }
  },

  // Per-SUB-component controls: widgets for the other components ON the page,
  // keyed by the sub-component's function name.
  "components": {
    "Button": { "controls": { "disabled": { "type": "boolean" } } }
  }
}
```

**Control widget types** (`type`):

| `type`    | Renders          | Extra fields         |
| --------- | ---------------- | -------------------- |
| `boolean` | checkbox         | —                    |
| `number`  | number input     | —                    |
| `text`    | text input       | —                    |
| `range`   | slider + readout | `min`, `max`, `step` |
| `select`  | dropdown         | `options: [...]`     |
| `color`   | color picker     | —                    |

Any control may carry a default `value`. Add `"signal": true` to feed the value
in as a **signal** (for island props typed `Signal<T>`) rather than a plain
prop. A bare value (`"size": "md"`) is shorthand for `{ "value": "md" }` with
the widget inferred. An undeclared prop a case sets still gets a control,
inferred from its value.

## Case JSON

A case is `cases/<name>/<name>.json`. **Bare keys become props**; `_`-prefixed
keys are specials:

| Key          | Effect                                                      |
| ------------ | ----------------------------------------------------------- |
| _(bare key)_ | passed as a prop to the component                           |
| `_name`      | human label for the case (default: the folder name)         |
| `_innerHtml` | set as the component's `dangerouslySetInnerHTML` (children) |
| `_signals`   | object of `name → value`, passed as signals                 |
| `_mocks`     | mock/force sub-components by function name                  |

```jsonc
// a signal-driven island case
{ "_name": "Starts at 3", "_signals": { "count": 3 } }

// replace every <Button> on the page with a labelled placeholder
{ "_name": "Buttons stubbed", "_mocks": { "Button": "stub" } }

// force props on every <Button>
{ "_name": "Forced disabled", "_mocks": { "Button": { "props": { "disabled": true } } } }
```

`_mocks[Name]` accepts `"stub"` (render a placeholder) or `{ "props": {...} }`
(force props on every instance). It also **seeds** that sub-component's
per-instance controls.

## Per-instance controls

A page route renders a top-level component plus the sub-components it uses. Each
sub-component declared in `fixture.components` gets a controls **group per
rendered instance**, keyed by its `id` prop (`Button #submit`,
`Button #cancel`); instances with no `id` share one group per type. Editing one
group affects only that instance.

> **Editing any control remounts the preview stage.** A component's internal
> `useState` therefore **resets** on a control edit; signal/external state
> survives. Expected, but surprising the first time.

## Event log

Every preview records the DOM events the component fires (scoped to the stage,
so the controls panel never leaks in). Only events on **enabled interactive
elements** are logged; high-frequency move/scroll/wheel are excluded. Rows show
`time · source · type · detail` (e.g. `button#submit · click · "Sign in"`).
Filter with per-type checkboxes and an addable list of regexes (AND-combined
over `source type detail`).

## Writing component tests

Put Playwright specs in `cases/<name>/tests/*.spec.ts`. They run against the
live preview — via the **▸ run** button in the gallery or
`isolate test [filter]` — at the case's route (`isolate list` shows it). Two
traps are specific to testing islands:

- **Click only after hydration.** A `.click()` fired before the island's JS
  hydrates hits inert SSR markup and silently does nothing. Wait first, with the
  bundled `waitHydrated(page)` helper:

  ```ts
  import { expect, test } from "@playwright/test";
  import { waitHydrated } from "isolate-events";

  test("increments", async ({ page }) => {
    await page.goto("/components/counter/default/three");
    await waitHydrated(page); // ← stage is now interactive
    await page.locator("#increment").click();
    await expect(page.locator(".ctrl-stage p")).toHaveText("4");
  });
  ```

  `waitHydrated(page, { timeout = 5000 })` resolves once the preview's controls
  island has mounted and wired the stage.

- **Don't `check()`/`uncheck()` controlled checkboxes.** Playwright's
  `check()`/`uncheck()` re-click when the state looks wrong mid-re-render,
  double-firing the `change` event. Use a single `.click()` and assert the
  outcome instead.

To assert on the _events_ a component emits (not just resulting DOM state), use
`capture()` — next.

## Asserting on emitted events — the `capture()` test API

Put Playwright specs in `cases/<name>/tests/*.spec.ts`; the `▸ run` button (and
`isolate test`) execute them against the live preview. Beyond asserting DOM
state, you can assert on the **events a component emits** by bridging the page's
event stream into the test with `capture(page)` (importable as `isolate-events`,
installed automatically):

```ts
import { expect, test } from "@playwright/test";
import { capture } from "isolate-events";

test("Sign in emits a click on the event stream", async ({ page }) => {
  const ev = await capture(page); // install the bridge BEFORE navigating
  await page.goto("/pages/login/auth/default");

  await page.locator("#submit").click();

  const e = await ev.expect(
    (e) => e.source === "button#submit" && e.type === "click",
    { timeout: 3000 },
  );
  expect(e.detail).toContain("Sign in");
});
```

- `capture(page) → { events$, expect }` — call **before** `page.goto`. Backed by
  a `ReplaySubject`, so `expect` matches events whether they already fired or
  fire next.
- `ev.expect(predicate, { timeout = 2000 }) → Promise<IsolateEvent>` — first
  match; rejects on timeout.
- `ev.events$` — the raw RxJS Observable, for custom pipelines.
- `IsolateEvent` = `{ time, source, type, detail }` — `source` is `tag` or
  `tag#id`.

The helper ships TypeScript types (`IsolateEvent`, `EventBridge`, `capture`), so
specs get full autocomplete and the event shape is checked at compile time.

## Gotchas

- **Route ≠ directory.** The URL comes from `category` + `folder` + case name.
  Use `isolate list` to read the real routes.
- **Name the component file `PascalCase(folder).tsx`.** Resolution PascalCases
  the _folder_ name and looks for a matching file. A miss is **reported**
  (`isolate` won't start until you fix it) — keep `button/Button.tsx`, not
  `button/btn.tsx`.
- **`signal: true` for island props.** A `Signal<T>` prop fed as a plain value
  won't be reactive — declare the control with `"signal": true` (or set it via
  `_signals`).
- **Config errors fail fast.** A malformed `fixture.json`/case JSON or an
  unresolved component file is collected and reported up front; `dev` and `test`
  refuse to start until it's fixed (`isolate dev --force` previews the valid
  components anyway).
- **Windows:** linking the source dirs prefers a symlink; without Developer Mode
  it falls back to a junction (still live), then a one-time **copy** — a
  snapshot, so re-run isolate to pick up source edits. Enable Developer Mode for
  live links.

## Where things land

- `~/isolate/<project>/` — the generated Fresh preview app (cached & reused
  between runs).
- `~/.isolate-runner/` — the npm runner (`@playwright/test`, `rxjs`,
  `isolate-events`).

## Contributing

```sh
git clone https://github.com/mrg-keystone/isolate && cd isolate
deno task list   # discover the bundled fixture app's components (fixtures/fresh-app)
deno task dev    # preview them
deno task test   # unit tests
deno task e2e    # the fixture app's Playwright suite
```

`deno task install` links every bundled skill (`skills/*`) into
`~/.claude/skills` and installs the `isolate` CLI globally from JSR.

## License

MIT
