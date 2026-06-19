# isolate fixture format — what a valid proposal looks like

Condensed from the isolate package's own reference (`@mrg-keystone/isolate`,
`skill/references/isolate.md` in its repo). A proposed `isolate/` folder must
pass `isolate list` discovery unchanged — `dev`/`test` fail fast on malformed
fixtures, so an invalid proposal is worse than none.

## Folder shape

The build session will place each component at one of isolate's three roots —
your **Classification** decides which:

| Classification | Lands in | Routes under |
|---|---|---|
| `static` | `components/<name>/` | `/components/…` |
| `island` | `islands/<name>/` | `/components/…` |
| `page-composition` | `pages/<name>/` | `/pages/…` |

```
islands/counter/
  Counter.tsx                  ← the component file
  isolate/
    fixture.json               ← metadata + control declarations
    cases/
      three/
        three.json             ← cases/<name>/<name>.json — names MUST match
        tests/*.spec.ts        ← (build session writes these from your Events section)
```

**Naming rule that bites:** isolate resolves the component file as
`PascalCase(folder).tsx` — folder `command-palette` → `CommandPalette.tsx`.
Propose kebab-case folder names whose PascalCase form is the component name
you spec'd. A mismatch is a discovery error that blocks `isolate dev`.

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

  // Optional: controls for sub-components rendered by a page-composition,
  // keyed by the sub-component's function name.
  "components": {
    "Button": { "controls": { "disabled": { "type": "boolean" } } }
  }
}
```

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
- **`"signal": true`** routes the value in as a Preact signal — required for
  island props typed `Signal<T>`; a signal prop fed as a plain value is not
  reactive. Mirror the `signal?` column of your Props table.
- A bare value (`"size": "md"`) is shorthand for `{ "value": "md" }` with the
  widget inferred.

## Case JSON — `cases/<state>/<state>.json`

One case per row of the component's **States → cases** table. Bare keys are
props; `_`-prefixed keys are specials:

| Key | Effect |
|---|---|
| *(bare key)* | passed as a prop |
| `_name` | human label for the case (default: folder name) |
| `_innerHtml` | the component's children content (`dangerouslySetInnerHTML`) |
| `_signals` | `{ name: value }` passed as signals (island state) |
| `_mocks` | stub or force sub-components by function name |

```jsonc
// cases/default/default.json
{ "_name": "Default", "title": "Save changes?", "tone": "default" }

// cases/danger-open/danger-open.json — island state via signals
{ "_name": "Danger, open", "tone": "danger", "_signals": { "open": true } }

// cases/stubbed/stubbed.json — isolate from a heavy child
{ "_name": "Chart stubbed", "_mocks": { "Sparkline": "stub" } }

// force props on every instance of a child
{ "_mocks": { "Button": { "props": { "disabled": true } } } }
```

`_mocks[Name]` accepts `"stub"` (labelled placeholder) or
`{ "props": {...} }` (force those props on every instance).

**Case values are the real captured data.** The build session diffs the
rendered case against your screenshot — so the case must reproduce exactly
what the screenshot shows (actual titles, names, dates, ids, series). For
large data sets, carry the exact visible slice, not the full set and not
invented lookalikes.

## Events → `capture(page)` predicates

isolate's test bridge exposes every DOM event a component fires as
`IsolateEvent = { time, source, type, detail }` — `source` is `tag` or
`tag#id` (`"button#confirm"`, `"input#email"`), `detail` carries the input
value / pressed key / element label. A spec gets them via:

```ts
const ev = await capture(page);          // install BEFORE page.goto
await ev.expect(e => e.source === "button#confirm" && e.type === "click");
```

Write each row of a component's **Events** section as one of these predicate
sketches against the real `source`/`type`/`detail` values you observed — the
build session lifts them into `tests/*.spec.ts` unchanged.

## Gotchas to encode in proposals

- **Route ≠ directory.** The preview URL is
  `/<components|pages>/<category>/<folder>/<case>` from `fixture.json`, not
  the source path. Don't write specs that assume path-derived URLs.
- **Editing a control remounts the stage** — internal `useState` resets,
  signal-backed state survives. Prefer signal-backed props for anything a
  reviewer will toggle while inspecting state.
- Props crossing into an island must be **serializable** — no functions, no
  class instances. If the source passes a callback, redesign the prop as an
  event the island emits (and note it in the Events section).
