## 4. The annotate overlay (`annotate.ts` + `annotate-client.js`)

A ⌘/Ctrl+click feedback overlay injected into served HTML, in one of two
mutually exclusive modes — never layered, never both running at once. How
`sprig dev` selects and serves each one (bare invocation vs `--annotate
<html>`, the standalone-server swap) is
[05 §4](../05-cli-dev-hmr/04-4-sprig-dev-the-three-layer-architecture.md)'s
wiring, not restated here.

**Modes:**

| | keyed to | persists to | extras | consumer |
|---|---|---|---|---|
| **BUILD** (`makeAnnotate` — always on under bare `sprig dev`) | the COMPONENT owning the clicked element, resolved via its view-encapsulation scope id (`componentScopeId` from the compiler) | `<specRoot>/spec/ui/build-notes.json` | none | the sprig:build agent fleet — each island entry (`isolateUrl` present) names a component to open in `sprig isolate` and fix; static/page entries (no `isolateUrl`) are fixed directly via `relDir` in the app source |
| **PROTOTYPE** (`makePrototypeAnnotate` — `sprig dev --annotate <html>`) | the ELEMENT, by CSS selector | a sibling `<name>.feedback.json` | inline source patch (`/__annotate/inline` writes `data-note`/`data-note-css` onto the matched opening tag) + SSE hot-reload on external edits | a human |

This is sprig's ONE load-bearing `spec/ui` path — `specRoot` computed by
`specRootOf()` ([01 §8](../01-core-runtime/08-8-spec-root-ts.md)); the
write discipline `spec/ui` falls under is owned by
[09 §2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md).

**`build-notes.json` schema:**
- top-level `_howto` header (usage note for whoever opens the file by hand)
- entries keyed by scope-id, not path or component name
- each entry: `component`, `relDir`, `selector`, `kind: static|island|page`
  (page = folder directly under `pages/`; island = has `logic.ts`; static =
  neither — [00 §5](../00-overview/05-core-concepts-glossary.md)'s
  Folder-component/Page/Island definitions), `isolate`/`isolateUrl` (present
  when `kind: island`; derived from `isolate/fixture.json` + its cases — the
  "edit in isolation" hint), note text, screenshot ref, timestamp
- `scanComponents(srcDir)` is what produces the `component`/`relDir`/
  `selector`/`kind`/`isolate`/`isolateUrl` fields — it maps a scope-id back
  to a component at write time
- screenshots: `build-notes.<key>.png`, beside the json (`<key>` = the
  entry's scope-id)

**Golden path (BUILD mode).** A dev ⌘-clicks the cart badge — an island,
`CartBadge`, isolate-enabled — in the running app. The client reads its
`componentScopeId` off the DOM (say `s3f8a1`) and the dev attaches a
screenshot before typing the note: it `POST`s to `/__annotate/shot` with
`{key: "s3f8a1"}`; the server captures the component's view and writes
`build-notes.s3f8a1.png` beside the notes file, returning the screenshot
ref. The dev then types a note — "badge count doesn't reset after
checkout." — and the client `POST`s to `/__annotate/save` with `{key:
"s3f8a1", note: "badge count doesn't reset after checkout.", screenshot:
"build-notes.s3f8a1.png"}`. The server resolves `s3f8a1` via
`scanComponents(srcDir)` to `{component: "CartBadge", relDir: "cart/badge",
selector: "...", kind: "island", isolate: true, isolateUrl: "..."}` and
writes/updates the `s3f8a1`-keyed entry (screenshot ref included) in
`<specRoot>/spec/ui/build-notes.json`. Later, the sprig:build agent fleet
reads that entry and opens `CartBadge` in `sprig isolate` to fix it.

**HTTP API:**

| endpoint | method | trigger | request payload | server effect | response |
|---|---|---|---|---|---|
| `/__annotate/ping` | GET | CLI startup — detecting whether an annotate server is already running on this port, to reuse it | none | none — pure identity check | identity marker |
| `/__annotate/state` | GET | overlay client loads/reconnects in the browser | none | none — read-only | current notes (BUILD: `build-notes.json`; PROTOTYPE: `<name>.feedback.json`), so the overlay re-renders existing marks |
| `/__annotate/clear` | POST | user clears a mark in the overlay UI | the mark's key (scope-id or selector) | clears that mark from the overlay's live state — never deletes a written entry (the persisted file only ever grows, `merge` durability, [09 §2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md)) | ok |
| `/__annotate/save` | POST | user submits a note | key (scope-id in BUILD / CSS selector in PROTOTYPE) + note text (+ screenshot ref if `/shot` already ran) | BUILD: resolves the key via `scanComponents`, writes/updates the keyed entry in `build-notes.json`; PROTOTYPE: writes/updates the selector-keyed entry in `<name>.feedback.json` | the saved entry |
| `/__annotate/shot` | POST | user attaches a screenshot to the current note | key | captures the element/component view, writes the PNG beside the notes file — `build-notes.<key>.png` in BUILD (`<key>` = scope-id); `<name>.<key>.png` in PROTOTYPE (`<key>` = the CSS selector with every non-filename-safe character replaced by `_`) | screenshot ref |
| `/__annotate/reload` **(prototype only)** | GET (SSE) | an external edit to the throwaway HTML or its dir | none | opens a long-lived event stream | pushes a reload event per external edit |
| `/__annotate/inline` **(prototype only)** | POST | user applies the inline-patch action | selector + note | writes `data-note`/`data-note-css` onto the matched opening tag in the source HTML | ok |

Injection: `inject(res)` splices
`<script>window.__SPRIG_ANNOTATE__=<cfg></script>` + the client JS before `</body>`;
`annotate-client.js` (~76KB) is loaded as text via a module-relative URL (works
file:// and https://).

