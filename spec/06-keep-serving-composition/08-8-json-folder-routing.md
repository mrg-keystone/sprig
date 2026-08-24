## 8. JSON folder routing

`loadRoutes(srcDir)` (mod.ts:101-109) runs at renderer construction — inside
`composeApp`/`createRenderer`'s lazy composition
([§9](09-9-zero-composition-derivation.md)'s `resolveAppRoutes`) — not per request. The
`Route[]` it produces is what
[§3](03-3-the-servesprig-composition-current-as-built.md).2's SSR fall-through (row 9)
resolves every subsequent request against; request-time dispatch is entirely
[§3](03-3-the-servesprig-composition-current-as-built.md)'s. Everything below is that
one construction-time read.

Entry `<srcDir>/routers/root/routes.json`, read as a `RawRoute[]` — an ARRAY of route
entries, never a single route object. The entry file itself never IS the top-level
route: `loadRoutes` synthesizes that as a WRAPPER, `{ path: "", load: "routers/root" }`
(mod.ts:106), and pulls the entry file's array into that wrapper's `children` the same
way any other layout pulls its own `routers/<name>/routes.json` (mod.ts:79-91) — so the
produced top-level `Route` has `path: ""`, not `"/"`. Legacy flat fallback
`<srcDir>/root.json` (the source comment's "src/root.json" reads `src` AS the srcDir —
there is no extra `src/` segment) is ALSO a `RawRoute[]`, but with NO wrapper: its
entries become the top-level `Route[]` directly (mod.ts:108).

**Why `srcDir` is the one anchor:** `loadRoutes` recurses through router directories
nested arbitrarily deep under it — a layout's own `routers/<name>/routes.json` may pull
further layouts in turn. None of those nested directories know their own position in the
tree, so resolving a `guards[]` module or a layout's children against the CALLING
router's own directory (or `cwd`) would silently shift with nesting depth or a move.
Anchoring every resolution below — the entry file, every `guards[]` module, every
layout's children pull — to the single `srcDir` `loadRoutes` was invoked with is what
keeps a router's `routes.json` relocatable without rewriting its `load`/`guards` values.

`RawRoute` (mod.ts:41-48) is the FULL JSON surface: `{ path, load?, guards?: string[],
requiredGrant?: string, meta?: RouteMeta, children?: RawRoute[] }`. Mapping →
`Route` (mod.ts:75-96) — `mapRouteTable` reads exactly these six keys; any OTHER key is
silently ignored:

| `RawRoute` field | handling |
|---|---|
| `path` | copied verbatim |
| `requiredGrant?` | copied verbatim |
| `meta?` | copied verbatim |
| `load?` | see load decision below |
| `guards?: string[]` | each `"<name>"` resolves from `<srcDir>/guards/<name>/mod.ts` (legacy `guard.ts`), accepting `default`/`guard`/first function export |
| `children?: RawRoute[]` | mapped recursively through this same table |

`load` decision (`isLayoutLoad`):

| `load` value | treatment |
|---|---|
| STARTS WITH `routers/` (e.g. `"routers/main"`, never a `pages/*` leaf) | a layout: `load` is copied verbatim onto the Route (mod.ts:79) AND treated as a directory — additionally pulls children from `<srcDir>/<load>/routes.json`. The retained `load` is not a spent pointer: `matchRoute` builds its render chain from it (core.ts:619/634), so a layout route keeps `load` and gains children — it never loses one for the other |
| anything else (e.g. `"pages/overview"`) | plain module reference, copied verbatim — no `routes.json` lookup attempted |

TS `defineRoutes` produces the same `Route[]` as the JSON form it mirrors
(json-routing.test.ts) — but only per form: a bare `defineRoutes([...])` of an
entry array matches legacy `root.json`'s unwrapped entries; matching
`routers/root/routes.json` requires the TS side to include the synthesized
`{ path: "", load: "routers/root", children: [...] }` wrapper too (see
Acceptance criteria below).

### Golden path: one `routes.json` end to end

Entry `<srcDir>/routers/root/routes.json` — an ARRAY of route entries, not a single
route object:

```json
[
  { "path": "/app", "load": "routers/main", "guards": ["auth"] },
  { "path": "/about", "load": "pages/overview" }
]
```

Traced in file-read order:

1. `loadRoutes(srcDir)` finds `<srcDir>/routers/root/routes.json` exists, so it calls
   `mapRouteTable([{ path: "", load: "routers/root" }], srcDir)` — a single SYNTHESIZED
   wrapper entry, nothing read from disk yet.
2. Mapping that wrapper entry: `path` copies verbatim (`""`); `load: "routers/root"`
   copies verbatim onto the Route and, STARTING WITH `routers/`, triggers the layout
   pull — `<srcDir>/routers/root/routes.json` (file 1) is read and parsed as a
   `RawRoute[]`. Its entries map through the RawRoute→Route rules above, in array order,
   and become this wrapper's `children`:
   - `{ path: "/app", load: "routers/main", guards: ["auth"] }`: `path` copies verbatim;
     `guards: ["auth"]` resolves `<srcDir>/guards/auth/mod.ts` (file 2), accepting its
     `default`/`guard`/first function export; `load` copies verbatim and, STARTING WITH
     `routers/`, pulls its own children from `<srcDir>/routers/main/routes.json` (file
     3), say a single leaf `{ path: "/app/dash", load: "pages/dashboard" }`, copied
     verbatim (no further file read — `pages/dashboard` doesn't start with `routers/`).
   - `{ path: "/about", load: "pages/overview" }`: `load` doesn't start with `routers/`
     → copied verbatim as a plain module reference — no `routes.json` lookup attempted.
3. Final `Route[]`: a single top-level Route — the synthesized wrapper
   `{ path: "", load: "routers/root", children: [...] }` (path `""`, NOT `"/"`) — with
   two children: `/app` (`load: "routers/main"`, `guards: [<resolved auth module>]`, its
   own child `/app/dash`) and `/about` (leaf, `load: "pages/overview"` untouched).

Three real files read, in order: `<srcDir>/routers/root/routes.json` →
`<srcDir>/guards/auth/mod.ts` → `<srcDir>/routers/main/routes.json`.

### Missing input

| case | caught where (this doc vs §9) | throws or silent | resulting `Route[]` |
|---|---|---|---|
| Entry missing (no `routers/root/routes.json`, no legacy `root.json`) | §9's `resolveAppRoutes`, upstream of `loadRoutes` | throws — naming both route-source options | never produced — `loadRoutes` is never called |
| Unresolved `guards[]` entry | here — `resolveGuards` (mod.ts:59-73) | throws — failed dynamic import, or sprig's own "must export a guard function" error | never produced — resolution always throws before `Route[]` returns |
| Missing layout `routes.json` | here — `mapRouteTable`'s `routeFileExists` probe (mod.ts:75-96) | **silent** — no throw, no read attempt | produced, minus that subtree — the layout keeps only its inline `children` (if any) |

- **Entry missing** — neither `<srcDir>/routers/root/routes.json` nor legacy
  `<srcDir>/root.json` exists: not reached from `loadRoutes` directly —
  [§9](09-9-zero-composition-derivation.md)'s `resolveAppRoutes` gates entry presence
  before ever calling `loadRoutes`; if neither the JSON entry nor `<srcDir>/mod.ts`'s
  exported `routes` exists either, `resolveAppRoutes` throws, naming both options
  ([§9](09-9-zero-composition-derivation.md)).
- **Unresolved guard** — `guards: ["x"]` with no `<srcDir>/guards/x/mod.ts` and no
  legacy `guard.ts`: `resolveGuards` (mod.ts:59-73) checks only `mod.ts`'s existence;
  when it's absent, resolution falls through to `guard.ts` UNCHECKED and imports it
  directly, so a genuinely missing guard throws via the failed dynamic import (Deno's
  own module-not-found error), naming the single `<srcDir>/guards/x/guard.ts` path
  attempted — not both candidates. (A module that DOES resolve but exports no callable
  throws sprig's own error instead: `guard "x" — <path> must export a guard function
  (default or named)`.) Either way an unprotected route can never ship silently —
  resolution always throws before `Route[]` returns.
- **Missing layout `routes.json`** — a layout `load` (e.g. `"routers/main"`) whose
  target directory has no `routes.json`: `mapRouteTable` (mod.ts:75-96) probes with
  `routeFileExists` before ever reading the table; when the probe is false, the pull is
  skipped — no throw, no read attempt. The route keeps only whatever `children` it
  declared inline (none, if it declared none), and the layout's undeclared subtree is
  simply absent from the resulting `Route[]`.

### Acceptance criteria

| Guarantee | Check | Expected result |
|---|---|---|
| Relocation invariance | Move a router's directory (e.g. `routers/main` → `routers/app-main`) and update only the parent's `load` to match | The produced subtree is structurally identical — no other `routes.json`/`guards[]` value needs touching |
| Guard totality | A route anywhere in the tree declares `guards: ["x"]` where `x` resolves to no callable | `loadRoutes` throws before returning any `Route[]` — no route with an unresolvable guard ever reaches `bootstrap()` |
| Six-key fidelity | Any `RawRoute` in any `routes.json` | Exactly `path`/`load`/`guards`/`requiredGrant`/`meta`/`children` survive onto the produced `Route` — every other JSON key is silently ignored |
| TS/JSON parity — legacy `root.json` | The same route tree expressed once via bare `defineRoutes([...])` and once via legacy `root.json` (no wrapper — see [Entry](#8-json-folder-routing) above) | Structurally identical `Route[]` (pinned by json-routing.test.ts) |
| TS/JSON parity — `routers/root/routes.json` | The same route tree expressed once via `routers/root/routes.json` and once via its TS equivalent | Identical only if the TS side reproduces the synthesized wrapper too — `defineRoutes([{ path: "", load: "routers/root", children: [...] }])`. A bare `defineRoutes([...])` of just the entries (no wrapper) is NOT structurally identical to this JSON form — the wrapper boundary means parity holds per-form, not across it |
| Layout fail-soft | A layout `load` (`routers/*`) whose target directory has no `routes.json` | That subtree is silently absent from the produced `Route[]` — `loadRoutes` doesn't throw |

