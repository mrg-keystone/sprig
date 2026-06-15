# annotate — click-to-feedback wrapper for prototypes

A tiny wrapper around any prototype this skill produces. It lets you
**cmd/ctrl + click any element**, type feedback into a small box, and **save** —
the feedback is written to a JSON file **right next to the prototype**, ready for
`/prototype` to read and apply on the next iteration.

```
skills/prototype/annotate/
├── serve.ts     Deno server: serves the prototype, injects the overlay,
│                persists <prototype-basename>.feedback.json next to the file
├── client.js    the injected overlay (cmd/ctrl+click → input box → save)
└── README.md    this file
```

## Collect feedback

```sh
deno run -A skills/prototype/annotate/serve.ts <your>-prototype.html --open
```

Then in the browser: **cmd/ctrl + click** an element → type what should change →
**save** (or ⌘/Ctrl+Enter). The bottom-right toolbar shows the count, a `list`
of all notes, `export`, and `clear`. Annotated elements get a numbered outline.

The wrapper writes/updates `<your>-prototype.feedback.json` in the same directory
as the prototype. Ctrl+C to stop the server.

> The server is what writes the file — a double-clicked `file://` page can't write
> next to itself. If you *do* open the raw file, the overlay still works and falls
> back to an **export** download; drop that JSON next to the prototype yourself.

## The feedback file

An object whose **keys are unique CSS selectors** (DevTools "Copy selector"
style — guaranteed to resolve to exactly one element, so two same-looking nodes
never collide) and whose values bundle the feedback plus everything needed to
find the element in source:

```json
{
  "#app > header.topbar > button.tbtn.solid:nth-child(4)": {
    "feedback": "make this terracotta and a bit larger",
    "selector": "#app > header.topbar > button.tbtn.solid:nth-child(4)",
    "label": "button.tbtn.solid",
    "id": "",
    "classes": "tbtn solid",
    "tag": "button",
    "text": "Run all tests",
    "html": "<button class=\"tbtn solid\" data-act=\"run-all\">…</button>",
    "trail": "body > div#app > header.topbar > button.tbtn.solid",
    "xpath": "/html[1]/body[1]/div[1]/header[1]/button[2]"
  }
}
```

**The key (`selector`)** is unique and `querySelector`-resolvable, so it's a
collision-free identity for the annotation. **To find it in source**, lean on the
content fields, because prototypes hardcode their data at the top and render the
DOM with JS — a positional path points at a runtime-only node:

- `text` — the visible text the user clicked. It came from the hardcoded data, so
  it's **guaranteed to exist in source**. Grep it first.
- `label` / `classes` / `tag` — the short selector and class names appear
  literally in the render template; use them to disambiguate.
- `trail` — ancestor breadcrumb that points you at the right region / render fn.
- `html` — the element's rendered markup (with any `data-act` hooks).
- `xpath` — positional fallback only.

## Apply feedback

Re-invoke `/prototype` pointing at the prototype. It detects the sibling
`*.feedback.json`, finds each target in source (grep the `text`, disambiguate
with `selector`/`trail`), applies the change, then clears the file.
