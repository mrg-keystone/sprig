# build annotate — click-to-edit a running sprig app

The build-stage analog of the prototype annotate. The prototype one keys a ⌘-click to an
**element** in a throwaway HTML file (by selector). This one keys a ⌘-click to the
**component** that owns the element in the *real, running* sprig app — and the saved note
says *"edit this component in isolation"* (with its `sprig isolate` route). No CSS selectors.

> **Prefer `sprig dev --annotate`.** When the app runs under `sprig dev`, the overlay is built
> into the dev server (no proxy) and it auto-spawns the isolate workbench alongside — one
> command for the whole loop (see `sprig:build` → SKILL.md). This standalone proxy is the
> **fallback for an app running *elsewhere*** — `sprig serve` / a prod build / another host —
> where there's no `sprig dev` to fold the overlay into. Both write the same
> `spec/ui/build-notes.json`.

## Why it can do this

sprig stamps every SSR element with its component's **view-encapsulation scope-id marker**
(`<div s1a2b3c4d …>`), where the id is `"s" + FNV-1a-32(folderPathRelativeToSrc)`. This server
reproduces that hash for every folder-component under `src/`, so a clicked element resolves
deterministically back to its component folder — even when two components share a basename
(their paths differ, so their ids differ).

## Run it

The app must already be running (`sprig dev`, or `sprig build` → `sprig serve`).

```sh
deno run -A skills/sprig:build/annotate/serve.ts \
  --app <appDir> --target http://localhost:8000 --port 4510 --open
```

- `--app <appDir>` — the sprig app dir; its `src/` is scanned for the component map.
- `--target <url>` — the running app (default `http://localhost:8000`). The proxy forwards
  everything and injects the overlay into HTML responses.
- `--port` (default 4510), `--host` (default 127.0.0.1), `--open`.

Open the printed URL (the proxy, e.g. `http://localhost:4510/ui`). **⌘/Ctrl+click any
element** → type a note → save. The pill (bottom-right) lists every component with notes and
its isolate route; "done — remove" clears an entry.

## The artifact

Notes persist to **`<appDir>/spec/ui/build-notes.json`**, component-keyed:

```json
{
  "_howto": "Each entry is a COMPONENT to edit IN ISOLATION. …",
  "src/islands/counter": {
    "component": "src/islands/counter",
    "selector": "counter",
    "kind": "island",
    "isolate": "`sprig isolate` → /components/counter/default/{three|zero} — edit src/islands/counter/ …",
    "notes": ["decrement below 0 should give feedback"]
  }
}
```

An element that carries no known scope marker is filed under `unresolved:<selector>` with a
note to locate it by selector — never silently dropped.

## How `sprig:build` consumes it

On the next `/build`, work each entry: open the component in `sprig isolate` at its route,
apply the notes by editing `src/<component>/` (`template.html` / `logic.ts` / `styles.css`),
verify in the workbench, then delete the entry. See `sprig:build` → SKILL.md.
