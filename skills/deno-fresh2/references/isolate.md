# isolate — preview & test components in isolation

> A small CLI for Fresh 2 projects: spin up a standalone, Storybook-style preview
> for any component/island/page, with a live controls panel, an event log, and a
> one-click Playwright runner. Published as `@mrg-keystone/isolate` on JSR — this
> skill ships inside that same package (under `skill/`) and `isolate update`
> refreshes both.

## TL;DR

You annotate a component with a tiny `isolate/` folder (one `fixture.json` + a
`cases/` dir). `isolate` discovers every such folder, scaffolds a **real Fresh app**
under `~/isolate/<root>`, symlinks your `components/`·`islands/`·`pages/` into it,
and generates a gallery + one preview route per case. Each preview gives you a
**live, typed controls panel** (edit props/signals and watch the component react),
an **event log** (every DOM event the component fires), and a **▸ run** button that
executes that case's Playwright tests against the live app.

The commands:

| Command | Does |
|---|---|
| `isolate list` | List discovered components + their cases (add `--json` is not needed; plain) |
| `isolate dev` | Build/serve the preview app, open the browser (`--no-open` to skip) |
| `isolate test [filter]` | Run all cases' Playwright tests headlessly (`--json` for agents) |
| `isolate update` | Reinstall the latest skill at `~/.claude/skills` (delete + re-download) and refresh the global CLI |

The project commands take `--root <path>` (default: cwd) to point at the Fresh project.

## Install / invoke

It's a Deno program with no dependencies to vendor. Pick one:

```sh
# A) Straight from JSR, no install — the canonical form, works on any machine:
deno run -A jsr:@mrg-keystone/isolate dev --root .

# B) Global install so the `isolate <cmd>` form in the help text works:
deno install -gA -n isolate jsr:@mrg-keystone/isolate
isolate dev

# C) Hacking on the tool itself — clone the repo (this skill lives at skill/
#    inside it) and run main.ts from the repo root:
git clone https://github.com/mrg-keystone/isolate && deno run -A isolate/main.ts dev --root .
```

**Prerequisites:** Deno; **Node/npm on PATH** (first `dev`/`test` run does a one-time
`npm i` into `~/.isolate-runner` for `@playwright/test`, `rxjs`, and the
`isolate-events` test helper); a system **Playwright** install is matched by version
if present, else `@playwright/test@latest` is fetched. The scaffold also runs
`jsr:@fresh/init --tailwind` once. Without npm, the runner setup fails (today with a
warning, not a hard error).

## Quickstart — first preview in 5 minutes

Given `components/button/Button.tsx` exporting `Button`:

```
components/button/isolate/
  fixture.json                              # { "category": "buttons",
                                            #   "controls": { "disabled": { "type": "boolean" } } }
  cases/primary/primary.json                # { "_name": "Primary", "id": "primary", "_innerHtml": "Click me" }
```

Then from the project root: `isolate dev` → the gallery opens → click **Primary** →
preview at `/components/buttons/primary` with a live `disabled` toggle and an event log.
Add cases as more `*.json` files; add components by giving each its own `isolate/` folder.
Run `isolate list` first to see the exact route for every case.

## The `isolate/` folder convention

Discovery scans three roots; a component is "isolatable" the moment it has an
`isolate/` subfolder:

| Source root | Treated as | Routes under |
|---|---|---|
| `components/<name>/` | a single component (static) | `/components/…` |
| `islands/<name>/` | a single component (island · hydrated) | `/components/…` |
| `pages/<name>/` | a **page composition** (component + the sub-components it renders) | `/pages/…` |

```
islands/counter/
  Counter.tsx                     ← the component (named export or default)
  isolate/
    fixture.json                  ← metadata + control declarations
    cases/
      three/
        three.json                ← this case's prop/signal values
        tests/*.spec.ts           ← Playwright tests for this case
      zero/
        zero.json
```

**The preview URL is built from `fixture.json`, not the directory name:**

```
/<prefix>/<category>/<folder>/<case>     (folder segment omitted when empty)
   prefix  = "components" for components/ + islands/, "pages" for pages/
   category, folder come from fixture.json (default category = the folder name)
```

So `components/button/` with `category:"buttons"`, `folder:"regular"` and a case
`primary` serves at **`/components/buttons/regular/primary`** — *not*
`/components/button/...`. Run `isolate list` to see the exact route for every case.

## `fixture.json` reference

```jsonc
{
  "category": "counter",          // groups cases in the gallery + URL segment (default: folder name)
  "folder": "default",            // sub-group + URL segment (optional)
  "background": "#f7f3ea",        // stage background behind the component (optional)

  // Controls for the TOP-LEVEL component. Each key declares a widget (argTypes).
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

**Control widget types** (the `type` field):

| `type` | Renders | Extra fields |
|---|---|---|
| `boolean` | checkbox | — |
| `number` | number input | — |
| `text` | text input | — |
| `range` | slider + readout | `min`, `max`, `step` |
| `select` | dropdown | `options: [...]` |
| `color` | color picker | — |

Any control may carry a default `value`. Add `"signal": true` to route the value
into the component as a **signal** (`_signals`) rather than a plain prop — required
for island props typed `Signal<T>`. A bare value (`"size": "md"`) is shorthand for
`{ "value": "md" }` with the widget inferred from the value's type. An undeclared
prop that a case sets still gets a control, inferred from its value.

## Case JSON reference

A case file is `cases/<name>/<name>.json`. **Bare keys become props**; keys starting
with `_` are specials:

| Key | Effect |
|---|---|
| *(bare key)* | passed as a prop to the component |
| `_name` | human label for the case (default: the folder name) |
| `_innerHtml` | set as the component's `dangerouslySetInnerHTML` (children content) |
| `_signals` | object of `name → value`, passed as signals |
| `_mocks` | mock/force sub-components by function name (see below) |

Worked examples from the bundled fixture:

```jsonc
// components/button/isolate/cases/primary/primary.json
{ "_name": "Primary", "id": "primary", "_innerHtml": "Click me" }

// islands/counter/isolate/cases/three/three.json   (count is a signal)
{ "_name": "Starts at 3", "_signals": { "count": 3 } }

// islands/counter/.../stubbed.json   (replace every <Button> with a placeholder)
{ "_name": "Buttons stubbed", "_signals": { "count": 3 }, "_mocks": { "Button": "stub" } }

// islands/counter/.../disabled-subs.json   (force props on every <Button>)
{ "_name": "Buttons forced disabled", "_signals": { "count": 5 },
  "_mocks": { "Button": { "props": { "disabled": true } } } }
```

`_mocks[Name]` accepts `"stub"` (render a labelled placeholder instead of the real
component) or `{ "props": {...} }` (force those props on every instance). `_mocks`
also **seeds** the initial values of that sub-component's per-instance controls.

## Per-instance controls

A page route renders a top-level component plus the sub-components it uses. Each
sub-component declared in `fixture.components` gets a controls **group per rendered
instance**, keyed by its `id` prop (`Button #submit`, `Button #cancel`); instances
without an `id` share one group per type. Editing one group affects only that
instance — the controls reach the sub-component live via Preact's vnode hook.

```tsx
// pages/login/Login.tsx renders two <Button id="submit"> / <Button id="cancel">
// → the controls panel shows: Login · Button #submit · Button #cancel
```

> **Editing any control remounts the preview stage.** Sub-component overrides are
> applied as the children re-render, so the stage is re-keyed on each edit. A
> component's internal `useState` therefore **resets** when you move a control;
> signal/external state survives. Expected, but surprising the first time.

## Event log

Every preview captures the DOM events the component fires (scoped to the stage, so
the controls panel never leaks in). Only events on **enabled interactive elements**
(`a, button, input, select, textarea, label, summary, [role], [tabindex]`) are
logged; high-frequency move/scroll/wheel events are excluded. Each row shows
`time · source · type · detail` (e.g. `button#submit · click · "Sign in"`). Filter
with per-type checkboxes and an addable list of regexes (AND-combined, applied to
`source type detail`).

## The `capture()` test API — assert on emitted events

The page exposes its event stream as one RxJS Observable. From a Playwright spec,
`capture(page)` bridges it into Node so you can assert on the **events a component
emits**, not just resulting DOM state. Import from `"isolate-events"` (installed
into the runner automatically):

```ts
import { expect, test } from "@playwright/test";
import { capture } from "isolate-events";

test("Sign in emits a click on the event stream", async ({ page }) => {
  const ev = await capture(page);            // install the bridge BEFORE navigating
  await page.goto("/pages/login/auth/default");

  await page.locator("#submit").click();

  const e = await ev.expect(
    (e) => e.source === "button#submit" && e.type === "click",
    { timeout: 3000 },
  );
  expect(e.detail).toContain("Sign in");
});
```

API surface:

- `capture(page) → { events$, expect }` — call **before** `page.goto` (it installs a
  page binding first). Backed by a `ReplaySubject`, so `expect` matches events whether
  they already fired or fire next.
- `ev.expect(predicate, { timeout = 2000 }) → Promise<IsolateEvent>` — first event
  matching `predicate`; rejects on timeout.
- `ev.events$` — the raw RxJS Observable, for custom pipelines.
- `IsolateEvent` = `{ time, source, type, detail }` — `source` is `tag` or `tag#id`
  (`"input#email"`), `detail` carries the input value / pressed key / element label.

The helper ships a `.d.ts`, so specs get autocomplete on `capture`, `ev.expect`,
`ev.events$`, and the `IsolateEvent` shape (checked under `tsc --strict`).

## Writing case tests — two footguns

Specs live in `cases/<name>/tests/*.spec.ts` and run via the ▸ run button or
`isolate test`. Two island-specific traps:

- **Click islands only after hydration.** A `.click()` before the island hydrates is
  a no-op against the SSR HTML. Use the bundled `waitHydrated(page)` helper after
  `goto`, before interacting:

  ```ts
  import { waitHydrated } from "isolate-events";
  await page.goto("/components/counter/default/three");
  await waitHydrated(page);                 // stage is now interactive
  await page.locator("#increment").click();
  ```

  `waitHydrated(page, { timeout = 5000 })` resolves once the preview's controls island
  has mounted and wired the stage.
- **Don't use `check()`/`uncheck()` on controlled checkboxes.** They re-click if the
  state looks wrong mid-re-render, double-firing the event. Use `.click()` once and
  assert the outcome (the fixture's `events.spec.ts` does exactly this).

## Where things land

- `~/isolate/<basename-of-root>/` — the generated Fresh preview app (cached/reused
  between runs; symlinks your source dirs in).
- `~/.isolate-runner/` — the npm runner (`@playwright/test`, `rxjs`, `isolate-events`).

## Gotchas

- **Route ≠ directory.** The URL comes from `category` + `folder` + case name, not
  the source path. Use `isolate list` to read the real routes.
- **Component file must be `PascalCase(folder).tsx`.** Resolution PascalCases the
  *folder* name and looks for a matching file. A miss (e.g. folder `float-button` but
  file `Float-button.tsx`, since `FloatButton` matches neither) is now **reported as a
  config problem** and blocks startup — rename to `FloatButton.tsx`, or `Button.tsx`
  for `button/`.
- **`signal: true` matters for island props.** A `Signal<T>` prop fed as a plain
  value won't be reactive — declare the control with `"signal": true` (or set it via
  `_signals`).
- **Control edits reset internal `useState`** (stage remount); keep state you want to
  persist in signals.
- **Windows:** linking the source dirs prefers a symlink, falls back to a junction
  (no elevation, still live), then a one-time copy (a snapshot — re-run to pick up
  edits). Enable Developer Mode for live symlinks.
- **Config errors fail fast.** Malformed `fixture.json`/case JSON and unresolved
  component files are collected during discovery and reported up front; `dev`/`test`
  refuse to start until fixed (`isolate dev --force` previews the valid ones anyway).

## See also
- `playwright-and-dev-loop.md` — the project's broader user-stories + real-browser testing stance
- `concepts/islands.md`, `concepts/signals.md` — what isolate is previewing
- `testing.md` — Fresh's fast server-side handler tests (complementary to these browser previews)
- Tool source + its own README: `isolate/` (bundled), repo `github.com/mrg-keystone/isolate`
