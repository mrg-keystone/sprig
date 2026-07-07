# Proposal: three shapes, zero composition file

**Thesis (from Rafa):** every project is exactly one of **three** shapes —

1. **rune** — a `server/` rune backend, no UI
2. **ui** — a sprig `ui/` app, no backend
3. **monorepo** — `server/` (rune) + `ui/` (sprig)

The entire composition is **determined by which shape it is**. So there should be **no
`ui/bootstrap/mod.ts`** — nothing for an app to hand-write, and therefore nothing for an
app to get wrong. (Alfred's whole `assetsDir` outage was a hand-written composition
forgetting one line. Delete the file, delete the bug class.)

**Is zero-composition possible? Yes — and every primitive already exists.** This is a
wiring + codegen change, not new machinery.

---

## Everything derives from the shape

Detection already lives in `cli.ts`:
- `resolveSprigUiDir()` finds the `ui/` package
- `detectBackendDir(gitRoot, uiRel)` finds the `server/` rune backend
- `assetsRel` derives the built-assets dir (`ui/static`)

So the shape is a two-bit fact of the filesystem:

| `server/`? | `ui/`? | shape | generated `serve.ts` (the WHOLE composition) |
|---|---|---|---|
| yes | yes | **monorepo** | `export default serveSprig({ keep: api })` |
| no  | yes | **ui**       | `export default sprigUi()` |
| yes | no  | **rune**     | `export default api.handler` |

Every path is derived — **nothing is passed**, because the runtime anchor is already known:
`Deno.mainModule` is the git-root `serve.ts` (`--rune` hoists it there). From that one fact
plus the filesystem shape, serveSprig/sprigUi derive everything:
- **git root** → `dirname(Deno.mainModule)`
- **srcDir** → `<root>/ui/src` (monorepo/ui) — never a param; it's always `ui/src`, exactly as you said
- **assetsDir** → `<root>/ui/static`, pinned from the same anchor (never the cwd-relative `"static"` default — the exact thing that broke alfred)
- **base** → convention: `/ui` for a monorepo (the UI is a *section*), `/` for ui-only (the UI *is* the app). One optional `deno.json` field overrides it.
- **app** → composed from `srcDir` the same way `sprig dev` already does (folder tables `routers/root/routes.json`, else a `src/mod.ts` `routes` export) — see "dev == prod" below.
- **host redirects** → derived from `base` (below)

The **only** thing the generated `serve.ts` names is `keep: api` — an *imported value* (the
bootstrapped rune backend) that has to be a real import, not a path. Everything else is
derivation. (Even that could be a dynamic `import("./server/bootstrap/mod.ts")` for a truly
zero-arg `serveSprig()`, but importing `api` explicitly keeps the backend entry honest and
tree-shakeable — a fair line to draw.)

All three serving functions **already exist**: `serveSprig` (packages/keep/mod.ts:568),
`sprigUi` (:707), and rune's `bootstrapServer` → `api.handler`. The generator just picks
one by shape and emits **one line**. Nothing new to build in the serving layer.

---

## What has to change

### 1. `serveSprig` / `sprigUi` derive their own paths and compose the app themselves

Today they take a pre-built `app` (and a `assetsDir` you can forget), so folder-composed
apps (alfred) must hand-run `createRenderer` + `loadRoutes` + `bootstrap` **and** hand-pin
`assetsDir` — which is *why* `ui/bootstrap/mod.ts` exists and *how* it broke.

Instead, derive everything from `Deno.mainModule` + shape:
- **srcDir / assetsDir** are `<root>/ui/src` and `<root>/ui/static` — computed, not passed.
  The app can't forget `assetsDir` because it never touches it. No `srcDir` param — the
  path is a fixed convention, not an input.
- The app is composed **from `srcDir`** internally (the exact composition `sprig dev` runs),
  so **both** app styles (folder-composed and code-composed) work with the same generated
  `serve.ts` — no shape needs a hand-owned composition.

`app` and `assetsDir` stay accepted as explicit overrides for the rare advanced case; the
derived path is the default and the only thing the generator (or a normal app) ever uses.

### 2. The two host redirects are DERIVED from `base` — not config, not options

`base: "/ui"` makes bare `/` a 404 and `/favicon.ico` unserved. But these aren't a knob to
turn — they're a pure consequence of the base serveSprig already knows:

- **bare `/` → `base`** whenever `base` is non-root. serveSprig *is* the thing mounted at
  `/ui`; a request for `/` on a UI deploy can only mean "take me to the app." No
  `rootRedirect` option — it's automatic from `base`.
- **`/favicon.ico` → `<base>/_assets/favicon.svg`** whenever a UI is served (the build
  always copies the favicon there). Automatic.

**The "if it's not /api" case is the shape, not a condition.** A **rune-only** app never
runs serveSprig/sprigUi at all — its `serve.ts` is `api.handler`, so `/` is the backend by
construction. There's nothing to special-case: the redirect logic only exists where a UI
exists, and a UI always has a `base` to redirect to. `base: "/"` (ui-only) → no redirect
needed, the app is already at root.

So both redirects are *derived*, zero config — the same principle as `assetsDir`, `srcDir`,
and the keep import. These were the *only* two things alfred hand-owned a composition to
add; derived, the host wrapper has nothing left to do.

### 3. `writeRuneServe` generates by shape → no `bootstrap/mod.ts`, no re-export shim

Today `writeRuneServe` has a "hand-owned `ui/bootstrap/mod.ts` present → emit a bare
re-export" branch. **Delete that branch.** With (1)+(2), the generator emits the full
composition for whichever of the three shapes it detected, always correct, always
`assetsDir`-pinned. `bootstrap/mod.ts` stops being a thing sprig knows about.

**Alfred after this:** delete `ui/bootstrap/mod.ts`. Entrypoint is the generated `serve.ts`
— **one line**, `export default serveSprig({ keep: api })`. The only deploy input the app
authors is `deno.json` (the `deploy` block + an optional `base`) and the rune backend it
already has. (Rafa is deleting `main.ts` separately.)

---

## Two follow-through details

**Dev == prod, by construction.** `sprig dev` already composes folder-table apps
(`appRoutes()` + `createRenderer`). Once `serveSprig`/`sprigUi` compose from `srcDir` too,
dev and the generated `serve.ts` run the **identical** composition — killing the current
split (dev uses folder tables; prod's generated file assumes an exported `sprigApp`) that
forced the hand-owned branch in the first place.

**Guardrail, as a safety net (ships independently, no API change).** Even with the easy
path fixed, keep the escape hatch honest: at serveSprig/sprigUi startup, `stat` the
resolved `assetsDir`; if it's absent/empty **and** `SPRIG_DEV` is unset (a prod launch),
emit one loud line —
```
serveSprig: assetsDir "<path>" has no built assets — ?v= + <meta> provenance degraded.
```
Today a misconfigured prod deploy is *indistinguishable* from "not built yet" (a missing
assets dir is the intended degraded-dev state, `versionOf` → null by design), so prod
misconfig has to be surfaced by context (`SPRIG_DEV` unset), not by the absence itself.
This one line would have caught alfred's outage in the first deploy log instead of hours
later in a browser.

---

## Why this is the endpoint

- **Zero app-authored composition** for all three shapes. The class of bug that hit alfred
  (a hand-written composition getting a derivable value wrong) can't be written, because
  the app doesn't author composition at all.
- **The three shapes are the whole taxonomy** — there's no fourth. So "derive everything
  from the shape" is total, not a 90% heuristic with a hand-owned tail.
- **Config that genuinely can't be derived is data, not code** — it lives in `deno.json`
  (a `base` override, a favicon path), declarative, not a `mod.ts` full of wiring.
- **Nothing new in the serving layer** — `serveSprig`/`sprigUi`/`api.handler` and the
  shape detection all exist. This is: derive paths from `Deno.mainModule` + shape (no
  `srcDir`/`assetsDir` params), redirects derived from `base` (no options), codegen by
  shape, and deleting the re-export branch. **Zero new inputs — only removals.**

---

*Filed from the alfred session: a missing `assetsDir` in a hand-owned composition silently
shipped `?v=dev` + no provenance tags to prod. One-line fix — but the app should never
have been able to author the line. Three shapes, zero composition file.*
