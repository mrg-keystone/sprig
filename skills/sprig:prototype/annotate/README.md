# annotate — click-to-feedback wrapper for prototypes

A tiny wrapper around any prototype this skill produces. Point at the screen and
leave feedback; everything is written **right next to the prototype**, ready for
`/prototype` to read and apply on the next iteration.

```
skills/sprig:prototype/annotate/
├── serve.ts     Deno server: serves the prototype, injects the overlay,
│                persists <prototype-basename>.feedback.json (+ screenshot PNGs)
│                next to the file
├── client.js    the injected overlay (annotate / tree / css editor / draw)
└── README.md    this file
```

## Collect feedback

```sh
deno run -A skills/sprig:prototype/annotate/serve.ts <your>-prototype.html --open
```

Three ways to leave feedback, all saved to the same place:

1. **⌘/Ctrl + click any element** → a box opens → type what should change → **save**
   (or ⌘/Ctrl+Enter). Annotated elements get a numbered outline.
2. **From inside that box**, two tools refine the note:
   - **`⌗ tree`** — a DevTools-style HTML tree. **Hover** a node to highlight it on
     the page, **click** to re-point the feedback at it. This is how you grab a
     *container* when ⌘-click only caught a child — pick exactly the element you mean.
   - **`{ } css`** — a live CSS editor (CodeMirror). Type declarations and the page
     **updates in real time**; the computed-value chips insert current values to tweak.
     **Save as feedback** records the declarations so `/prototype` can apply them.
3. **⇧⌘ (Shift+Cmd/Ctrl) + drag** → **draw** on the page. Release the keys, add an
   optional note, **save as feedback** → a **screenshot of the current view with your
   sketch on it** is written next to the prototype.

The bottom-right toolbar shows the count and `list` / `export` / `clear`. Badges for a
given screen clear themselves when you navigate away (and return when you come back), so
old outlines don't linger over the wrong view. Typing in any annotate box is sealed off
from the prototype — its own keyboard shortcuts won't fire while you're writing feedback.

> The server is what writes the files — a double-clicked `file://` page can't write next
> to itself. If you *do* open the raw file, the overlay still works and falls back to an
> **export** download (and screenshot downloads); drop those next to the prototype yourself.

## The feedback file

`<your>-prototype.feedback.json` — an object whose **keys identify the annotation** and
whose values bundle the feedback plus everything needed to find the target in source.

**Element feedback** is keyed by a unique CSS selector (DevTools "Copy selector" style —
guaranteed to resolve to exactly one element, so two same-looking nodes never collide):

```json
{
  "#app > header.topbar > button.tbtn.solid:nth-child(2)": {
    "feedback": "make this terracotta and a bit larger",
    "css": "background-color: #c2410c;\nfont-size: 18px;",
    "selector": "#app > header.topbar > button.tbtn.solid:nth-child(2)",
    "label": "button.tbtn.solid",
    "id": "",
    "classes": "tbtn solid",
    "tag": "button",
    "text": "Home",
    "html": "<button class=\"tbtn solid\" data-act=\"go-home\">Home</button>",
    "trail": "body > div#app > header.topbar > button.tbtn.solid",
    "xpath": "/html[1]/body[1]/div[1]/header[1]/button[1]"
  }
}
```

- `feedback` — the typed note (may be empty if the user only edited CSS).
- `css` — **declarations from the css editor**, ready to apply to the element. Either
  `feedback` or `css` (or both) may be present.
- `text` — the visible text the user clicked. It came from the hardcoded data, so it's
  **guaranteed to exist in source**. Grep it first.
- `label` / `classes` / `tag` — the short selector and class names appear literally in
  the render template; use them to disambiguate.
- `trail` — ancestor breadcrumb that points you at the right region / render fn.
- `selector` — unique & `querySelector`-resolvable; a collision-free identity, not
  necessarily a source location. `html` is the rendered markup; `xpath` a last resort.

**Drawing feedback** is keyed `draw:<id>` and carries a screenshot instead of a selector:

```json
{
  "draw:mqrhoifl-1": {
    "kind": "drawing",
    "feedback": "this chart needs a legend",
    "image": "my-prototype.feedback.draw-mqrhoifl-1.png",
    "viewport": { "w": 1200, "h": 948, "scrollX": 0, "scrollY": 0 }
  }
}
```

- `image` — a PNG written next to the prototype (the view + the user's sketch). **Open
  it** to see what they circled; `viewport` tells you which scroll position it was.

## Apply feedback

Re-invoke `/prototype` pointing at the prototype. It detects the sibling
`*.feedback.json` and works each entry:

- **Element entries** — locate the target in source (grep the `text`, disambiguate with
  `selector`/`trail`), apply the `feedback` note, and apply any `css` declarations to that
  element (inline, a class, or the render template — whatever fits the prototype's style).
- **Drawing entries** (`kind: "drawing"`) — open the `image` PNG, read the `feedback`
  note, and make the change the sketch indicates.

When done, **clear the file** (write `{}` or delete it, and remove the `*.png` shots) so
stale notes aren't re-applied next round.
