## 5. The isolate case format

**Preview eligibility** (checkable; [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)'s discoverability predicates):
- A folder previews iff it has BOTH `template.html` and `isolate/`.
- It's an **island** iff it also has `logic.ts`; otherwise it's **static**.
- No test-coverage gate: a previewable unit with zero specs raises no discovery
  problem at all — it simply has nothing to run ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)).

> **DX-IDEAL §3.7 target, NOT yet built:** a unit MUST carry ≥1 co-located
> `<name>.cy.ts` spec, enforced as a fatal `missing-test` discovery problem — the
> UI analogue of rune's fault-coverage lint — joining discovery's other fatal
> kinds. RED-first: author the spec, then build the component to green off the
> Deno-native `cy-deno` runner. **Trap today:** a builder who writes a co-located
> `.cy.ts` now gets zero discovered tests — `isolate test` reports "No matching
> tests." at exit `0`, the same as an empty project
> ([§2](02-2-the-isolate-cli-cli.md) item 2) — because the as-built test unit
> lives elsewhere (below).

```
<component>/
  template.html                 # (+ logic.ts for an island)
  isolate/
    fixture.json
    cases/<name>/
      <name>.json                # preview case (route + control data)
      tests/*.spec.ts            # Playwright specs for this case — the test unit
```

**Example** — a static component (`badge`) and an island (`counter`, has `logic.ts`);
neither sets `category`, so each defaults to its own folder name and routes at
`/components/badge/1` and `/components/counter/1`:

```
badge/                           # static — no logic.ts
  template.html
  isolate/
    fixture.json
    cases/1/
      1.json
      tests/renders.spec.ts

counter/                         # island — has logic.ts
  template.html
  logic.ts
  isolate/
    fixture.json
    cases/1/
      1.json
      tests/increments.spec.ts
```

`badge/isolate/fixture.json`:
```json
{
  "controls": {
    "label": { "type": "text", "value": "New" },
    "tone": { "type": "select", "options": ["info", "warn"], "value": "info" }
  }
}
```

`badge/isolate/cases/1/1.json` — `badge` is static, so bare keys bind to props:
```json
{ "_name": "warning badge", "label": "Low stock", "tone": "warn" }
```

`badge/isolate/cases/1/tests/renders.spec.ts` — a static case's SSR markup is final
immediately, so the test navigates straight to the route, no hydration wait:
```ts
import { test, expect } from "@playwright/test";

test("renders the label", async ({ page }) => {
  await page.goto("/components/badge/1");
  await expect(page.locator("[data-tone=warn]")).toContainText("Low stock");
});
```

`counter/isolate/fixture.json`:
```json
{
  "controls": {
    "count": { "type": "number", "signal": true, "value": 0 }
  }
}
```

`counter/isolate/cases/1/1.json` — `counter` is an island, so its case data goes
through `_signals`, not bare keys:
```json
{ "_name": "starts at 3", "_signals": { "count": 3 } }
```

`counter/isolate/cases/1/tests/increments.spec.ts` — an island case's stage-bridge
attaches post-hydration, so the test waits on the bridge's readiness handshake
before interacting ([§4](04-4-the-workbench-ui-app.md)):
```ts
import { test, expect } from "@playwright/test";
import { waitHydrated } from "isolate-events";

test("increments on click", async ({ page }) => {
  await page.goto("/components/counter/1");
  await waitHydrated(page);
  await page.locator("button").click();
  await expect(page.locator("[data-count]")).toContainText("4");
});
```

- **fixture.json** fields:

  | field | type | required? | default | meaning |
  |---|---|---|---|---|
  | `category` | string | no | folder name | gallery group + URL segment |
  | `folder` | string | no | — | folder segment inserted into the route, `[<folder>/]` |
  | `background` | string | no | — (legacy `controls._background` honored) | stage background |
  | `controls` | `{ <prop>: ControlDef }` | no | `{}` | control definitions for the target itself |
  | `components` | `{ <name>: {controls, target?} \| ControlDef map }` | no | `{}` | per-child-component control overrides (shorthand rule below) |

  **ControlDef** = `{ type?: "select"|"range"|"color"|"boolean"|"number"|"text",
  options?, min?, max?, step?, signal?, value? }`. Which of `options`/`min`/`max`/
  `step` apply depends on `type`; `signal` and `value` apply to every type:

  | type | options | min / max / step | signal | value |
  |---|---|---|---|---|
  | `select` | choices list | — | ✓ | initial selection |
  | `range` | — | bounds + step | ✓ | initial number |
  | `number` | — | optional bounds | ✓ | initial number |
  | `boolean` | — | — | ✓ | initial `true`/`false` |
  | `color` | — | — | ✓ | initial color string |
  | `text` | — | — | ✓ | initial string |

  `signal: true` marks the control as an island signal control rather than a prop
  control; a bare (non-object) value is shorthand for `{value}`.

  **Seeding**: every DECLARED control is seeded into the case even when the case's
  own JSON omits it — case values always win. Where a control lands depends on its
  shape: `signal: true` seeds `signals`; a control named `_innerHtml` seeds
  `innerHtml` (its `value` verbatim, `""` when absent — no type-based fallback);
  everything else seeds `props`. The one exception is `_background`: a control
  named `_background` is the legacy form of the top-level `background` field
  above — it is consumed for the stage background and stripped from the control
  set before seeding runs, so it never becomes a seeded prop, dock control, or
  query-override. When neither the control's own `value` nor the
  case supplies a value, the seed falls back by `type`: `boolean` → `false`;
  `number`/`range` → `min ?? 0`; `select` → `options[0] ?? ""`; `color` →
  `"#000000"`; `text` (or no `type`) → `""`. A fixture author can predict which
  controls exist and each control's seeded default — the fallback applied when
  neither the control's `value` nor the case sets one — from `fixture.json`
  alone; a given case's rendered props and dock control state are those seeded
  defaults merged with the case JSON's overrides, case values winning wherever
  the case sets a value.

  **Shorthand vs. full form** (`components.<name>`): read as controls map UNLESS it
  carries a `controls` key, in which case it's the full wrapper `{controls, target?}`:

  ```json
  "components": {
    "icon":   { "size": { "type": "range", "min": 8, "max": 32, "value": 16 } },
    "avatar": { "controls": { "src": { "type": "text", "value": "" } }, "target": "#avatar" }
  }
  ```

  `icon` has no `controls` key → read as its controls map (shorthand). `avatar` has a
  `controls` key → read as the full wrapper, the only way to reach `target`.
  Consequence: a control literally named `controls` must use the full-form wrapper,
  or it's read as the wrapper itself. The shorthand has no `target`; `target: "#css"`
  (direct-DOM instance control) is only reachable via the full form — no target means
  the mock/re-render path.
- **case json** reserved keys:

  | key | shape | effect |
  |---|---|---|
  | bare key | any | becomes a prop |
  | `_name` | string | case label |
  | `_innerHtml` | string | innerHTML override |
  | `_signals` | `{name: value}` | island signal values |
  | `_mocks` | `{name: "stub" \| true \| {stub?, props?}}` | mocks/stubs a child component |

  `_mocks`'s `true` form is discovery's intent-alias for `"stub"`, but it is currently
  render-side inert — `"stub"` is the working spelling; drift tracked in
  [§8](08-8-known-drift-refactor-targets.md) item 3.

  Binding matrix (target kind decides where a key lands):

  | case key | static target | island target |
  |---|---|---|
  | bare keys (props) | bind to the target's props | never reach the island (its tag carries no input bindings, [§2](02-2-the-isolate-cli-cli.md)) — merely seed the dock's prop-control values (edits reload the iframe without touching the island) |
  | `_innerHtml` | bind directly | never reach the island |
  | `_signals` | n/a | applied live by the bridge ([§4](04-4-the-workbench-ui-app.md)) |
  | `_mocks` | applies to the target's children | applies to the target's children |
- **tests**: per-case **Playwright `*.spec.ts` specs** under
  `isolate/cases/<name>/tests/` — the unit `collectTests`
  ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)) actually scans, one
  spec set per CASE (not per component/page). A spec imports `test`/`expect` from
  `@playwright/test` and navigates to the case's generated route
  (`/components|pages/<category>/[<folder>/]<name>`). Hydration and async DOM settle
  isn't automatic — an island case's target attaches post-hydration, so its spec
  awaits the `isolate-events` helper's `capture()`/`waitHydrated()` against the
  stage-bridge's `__isolateReady`/`__isolateEmit` globals before asserting (a static
  case's SSR markup is final immediately, so its spec skips the wait — both worked
  examples above). Runner mechanics — provisioning, spawn, report shape, exit codes
  — are [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)'s and
  [§2](02-2-the-isolate-cli-cli.md)'s to define, not repeated here.

  > **DX-IDEAL §3.7 target, NOT yet built:** a co-located `<name>.cy.ts`, run
  > in-process by the Deno-native `cy-deno` runner, retires this handshake — its
  > retry-able `cy.get().should()` waits on the DOM directly, so a spec needs
  > neither the globals nor the helper. Runner API surface and rollout are
  > [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)'s to define.

