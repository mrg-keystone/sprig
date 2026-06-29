# isolate fixture format — what a valid proposal looks like

The format `sprig isolate` discovers (see `sprig:build` → `references/isolate.md`). A proposed
`isolate/` folder must be discoverable unchanged — `sprig isolate` fails fast on malformed
fixtures, so an invalid proposal is worse than none.

## Component = folder, not a file

A sprig component is a **folder**: `template.html` + an optional `logic.ts` (its presence makes
the folder an **island** that hydrates) + an optional `styles.css`. **There is no `.tsx` file.**
The folder's **basename is its selector** — the custom tag other templates use
(`command-palette/` → `<command-palette>`). Propose kebab-case folder names that read as the tag
you spec'd.

## Folder shape

The build session places each component at one of three `src/` roots — your **Classification**
decides which:

| Classification | Lands in | Routes under |
|---|---|---|
| `static` (no `logic.ts`) | `components/<name>/` | `/components/…` |
| `island` (has `logic.ts`) | `islands/<name>/` | `/components/…` |
| `page-composition` | `pages/<name>/` | `/pages/…` |

```
islands/counter/
  template.html                ← the view (Angular-flavored bindings)
  logic.ts                     ← defineComponent({ setup }) — makes it an island
  styles.css                   ← (optional) view-encapsulated styles
  isolate/
    fixture.json               ← metadata + control declarations
    cases/
      three/
        three.json             ← cases/<name>/<name>.json — names MUST match
        tests/*.spec.ts        ← (build session writes these from your Events section)
```

## `fixture.json`

```jsonc
{
  "category": "overlays",        // gallery group + URL segment (default: folder name)
  "folder": "modal",             // optional sub-group + URL segment
  "background": "#f4f5f7",       // optional stage background

  // Controls for the top-level component — one per Props-table row.
  "controls": {
    "open":  { "type": "boolean", "value": true, "signal": true },
    "title": { "type": "text", "value": "Delete workspace?" },
    "tone":  { "type": "select", "options": ["default", "danger"], "value": "danger" }
  },

  // Optional: controls for sub-components the component renders, keyed by the
  // sub-component's SELECTOR (its folder basename / custom tag).
  "components": {
    "ui-button": { "controls": { "disabled": { "type": "boolean" } } }
  }
}
```

The preview route is `/<components|pages>/<category>/<folder>/<case>` (e.g.
`/components/overlays/modal/danger-open`).

Control `type` values — each Props-table row maps to exactly one:

| `type` | Widget | Extra fields |
|---|---|---|
| `boolean` | checkbox | — |
| `number` | number input | — |
| `text` | text input | — |
| `range` | slider | `min`, `max`, `step` |
| `select` | dropdown | `options: [...]` |
| `color` | color picker | — |

- Any control may carry a default `value`.
- **`"signal": true`** routes the value in as a **sprig signal** — use it for island state a
  reviewer will toggle live (it survives a control-edit remount; a plain value does not). Mirror
  the `signal?` column of your Props table.
- A bare value (`"size": "md"`) is shorthand for `{ "value": "md" }` with the widget inferred.

## Case JSON — `cases/<state>/<state>.json`

One case per row of the component's **States → cases** table. Bare keys are props; `_`-prefixed
keys are specials:

| Key | Effect |
|---|---|
| *(bare key)* | passed as a prop / `@input` |
| `_name` | human label for the case (default: folder name) |
| `_innerHtml` | the component's projected children (sprig `<content>`) |
| `_signals` | `{ name: value }` seeded as island signals (the island's state) |
| `_mocks` | stub or force props on sub-components, keyed by **selector** |

```jsonc
// cases/default/default.json
{ "_name": "Default", "title": "Save changes?", "tone": "default" }

// cases/danger-open/danger-open.json — island state via signals
{ "_name": "Danger, open", "tone": "danger", "_signals": { "open": true } }

// cases/stubbed/stubbed.json — isolate from a heavy child by selector
{ "_name": "Chart stubbed", "_mocks": { "sparkline": "stub" } }

// force props on every instance of a child (keyed by selector)
{ "_mocks": { "ui-button": { "props": { "disabled": true } } } }
```

`_mocks[selector]` accepts `"stub"` (labelled placeholder) or `{ "props": {...} }` (force those
props on every instance of that sub-component).

**Case values are the real captured data.** The build session diffs the rendered case against
your screenshot — so the case must reproduce exactly what the screenshot shows (actual titles,
names, dates, ids, series). For large data sets, carry the exact visible slice, not the full set
and not invented lookalikes.

## Events → `capture(page)` predicates

isolate's test bridge (`isolate-events`) exposes every DOM event a component fires as
`IsolateEvent = { time, source, type, detail }` — `source` is `tag` or `tag#id`
(`"button#submit"`, `"input#email"`), `detail` carries the input value / pressed key / element
label. A spec gets them via:

```ts
import { capture, waitHydrated } from "isolate-events";

const ev = await capture(page);          // install BEFORE page.goto
await page.goto("/components/overlays/modal/danger-open");
await waitHydrated(page);                 // a click before hydration is a silent no-op
await page.locator("#confirm").click();
await ev.expect(e => e.source === "button#confirm" && e.type === "click", { timeout: 3000 });
```

Write each row of a component's **Events** section as one of these predicate sketches against the
real `source`/`type`/`detail` values you observed — the build session lifts them into
`tests/*.spec.ts` unchanged.

## Gotchas to encode in proposals

- **Route ≠ directory.** The preview URL is
  `/<components|pages>/<category>/<folder>/<case>` from `fixture.json`, not the source path.
  Don't write specs that assume path-derived URLs.
- **Editing a control remounts the stage** — `setup()` re-runs and its plain local state resets;
  **signal-backed** state (`signal: true` controls / `_signals` cases) survives. Prefer
  signal-backed for anything a reviewer will toggle while inspecting state.
- **Hydration is async** — interacting before it completes is a silent no-op; gate island
  interactions on `waitHydrated(page)`.
- Props crossing into an island must be **serializable** — no functions, no class instances. If
  the source passes a callback, redesign the prop as an event the island emits (`ctx.output`) and
  note it in the Events section.
