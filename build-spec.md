# sprig build-spec

> **STATUS — IMPLEMENTED.** This blueprint has been built and tested in this repo. The runtime is
> `ui/.sprig/` (not `fixtures/app/.sprig/`); the running app is the `backend/` + `ui/` workspace,
> composed by `serve.ts`. Milestones **M0–M7 are all done and tested** (31 tests, incl. headless-
> Chromium hydration, soft-nav, and per-island code-split). See [`README.md`](./README.md) for the
> as-built tour. Beyond the milestones it also ships per-component **view encapsulation** + Tailwind
> and **state-preserving HMR** (`sprig dev`, no Vite). One open follow-up: legacy `*ngIf`/`*ngFor`.

How to take the **pre-compile folder-component app** (`fixtures/app`) and make it *run* — served
by a **keep** backend, deployable to **Deno Deploy** with one `deno serve` entry, where the keep
**in-process client** reaches the app's server-side data code with **zero hand-wiring**.

This is the implementation blueprint for the stack in [`list.md`](./list.md). The runtime contract
([`fixtures/app/.sprig/core.ts`](./fixtures/app/.sprig/core.ts)) and router
([`.sprig/router.ts`](./fixtures/app/.sprig/router.ts)) already exist; `bootstrap()` is a 501
**STUB**. This spec fills the stub and adds the build + composition around it.

---

## 0. The thesis — what the framework absorbs

Today, to put a keep backend and a UI in one Deno-Deploy process you hand-write the wiring. The
reference app `leaderboard` does exactly this in its root `mod.ts` + a `backend-fetch.ts` shim. **That
hand-wiring is the black magic sprig exists to delete.** The app author should write a Deno
**workspace** + folder-components + `resolve.ts`, and the in-process client should *just work*.

| `leaderboard` hand-written "black magic" | sprig replacement (framework-owned) |
|---|---|
| `(globalThis).__backendFetch = backend.fetch` | a built-in **`Backend`** injection token bound to keep's `backend.fetch`; `resolve.ts` does `inject(Backend).fetch("/board")`. No global. |
| the `/api/*` (`path.slice(4)`) + `/docs/*` + `else frontend.fetch` dispatcher in `mod.ts` | one framework call **`serveSprig({ keep, app })`** owns all dispatch |
| `ssrBackendGet` reading the global, with a `BACKEND_URL` HTTP fallback for two-process dev | deleted — **one process**, so the in-process client is always present; nothing to fall back to |
| `import backend; import frontend; export default { fetch }` composition root | the entry is `export default serveSprig({ keep: api, app })` (4 lines) |
| non-workspace `deno.json` + `cd backend && …` / `cd frontend && …` tasks | a real **Deno workspace** of two members + `sprig dev` / `sprig build` |

Everything below is grounded in three reference apps and verified against the installed Deno:

- **`list.md`** — the stack (Preact SSR + `@11ty/is-land` hydration + `deno bundle` + Navigation API + keep).
- **`leaderboard`** — the composition / in-process-client / single-origin-Deploy pattern (the boilerplate to kill).
- **`the-vo-app`** — the proven UI build mechanics: a **single** `deno bundle` client, `?v=<contenthash>` + immutable cache + gzip, a `window.__BOOT__` data bridge the client reads.

> **Verification note.** The load-bearing Deno/keep mechanics in §3–§4 (workspace cross-member
> resolution, top-level-await ordering, `deno serve` `{fetch}` boot, `withBasePath` forwarding
> `info`, the `x-danet-internal` auth-bypass) were checked against the installed Deno runtime, not
> assumed. Where a claim is "verified" it was reproduced; where it is a design choice it is marked.

---

## 1. Target shape — a two-member Deno workspace

The whole app is **one Deno workspace** with **two members** and a plain root entry. (A third
"server" member for the entry is *not* needed: a file at the workspace root is not itself a member
and still resolves the members — verified.)

```
app/                              # workspace ROOT — NOT a workspace member
  deno.json                       # { "workspace": ["./backend","./ui"], imports, tasks, deploy{org,app} }
  deno.lock                       # ONE shared lock for the whole workspace
  serve.ts                        # THE deno-serve entry (author writes — 4 lines, §3)
  static/                         # sprig BUILD OUTPUT: hashed island bundles + shared core chunk + app.css + manifest

  backend/                        # MEMBER  @app/backend  — a normal keep app
    deno.json                     # { "name":"@app/backend", "version":"0.0.0", "exports":"./mod.ts" }
    mod.ts                        # export const api = await bootstrapServer("app", AppModule, { swagger:true })
    src/**                        # keep @Endpoint controllers / modules (+ DENO_DEPLOYMENT_ID-gated cron)

  ui/                             # MEMBER  @app/ui  — the sprig folder-component app (today's fixtures/app)
    deno.json                     # { "name":"@app/ui", "version":"0.0.0", "exports":"./src/main.ts",
                                  #   imports:{ "@sprig/core": "...", "@sprig/keep": "..." } }
    .sprig/core.ts                # the runtime (exists today; this spec fills its bootstrap() stub)
    .sprig/router.ts              # the route engine (exists today)
    src/main.ts                   # export const routes = defineRoutes([...]); export const app = bootstrap({ routes, base })
    src/shell/**                  # folder-components: template.html (+ optional logic.ts/styles.css/resolve.ts)
    src/services/**               # @Injectable services (server ones become thin Backend clients)
```

The fixture (`fixtures/app`) becomes the **`ui/`** member essentially unchanged — its `main.ts` keeps
the route table and now also `export const app = bootstrap({ routes })` (it already calls
`bootstrap`; we stop calling `Deno.serve` there because the entry is `serve.ts`).

### 1.1 The workspace-resolution rule (LOAD-BEARING — verified)

Cross-member bare-name imports (`import { api } from "@app/backend"`) resolve **only when Deno
discovers the ROOT `deno.json`**. Verified: `deno check --config <root>/deno.json serve.ts` passes;
resolving a member's own `deno.json` first yields `TS2307 "@app/backend" is not a dependency`.

**Mitigation, baked into the tasks:** every command runs with **cwd = workspace root** (so Deno walks
up to the root config), and the root `deno.json` + shared `deno.lock` ship. On Deno Deploy the whole
repo is uploaded, so the root config is always present.

### 1.2 Root `deno.json` (scaffolded once)

```jsonc
{
  "workspace": ["./backend", "./ui"],
  "imports": {
    "@sprig/core": "jsr:@sprig/core@^0.1",       // or a vendored ./ui/.sprig/core.ts path during bootstrap
    "@sprig/keep": "jsr:@sprig/keep@^0.1",
    "@mrg-keystone/keep": "jsr:@mrg-keystone/keep@^1"
  },
  "tasks": {
    "dev":   "sprig dev",                         // ONE process: build-watch + deno serve --watch
    "build": "sprig build ui --out static",       // compile templates + bundle islands -> static/
    "start": "deno serve -A --unstable-kv serve.ts"
  },
  "deploy": { "org": "...", "app": "..." }
}
```

> `nodeModulesDir` must be reconciled at the root: the UI wants it **off** (the Deno-native,
> no-`node_modules` path that is the whole reason for this stack — `list.md`), so do not inherit the
> backend's `"manual"`.

---

## 2. The integration spine (the crux)

### 2.1 The entry — `serve.ts` (author writes, 4 lines, `deno serve`-compatible)

```ts
// serve.ts  (workspace root)  — run: deno serve -A --unstable-kv serve.ts
import { serveSprig } from "@sprig/keep";
import { api } from "@app/backend";   // bootstrapServer already awaited at backend module scope (ready before this body runs)
import { app } from "@app/ui";        // bootstrap({ routes }) -> SprigApp
export default serveSprig({ keep: api, app, base: "/ui" });   // -> { fetch(req, info) } : Deno.ServeDefaultExport
```

- `deno serve` requires the entry to **`export default` an object with `fetch(req, info)`** — verified
  it boots with this shape.
- **`serveSprig` is synchronous**: it closes over the keep handlers and returns `{ fetch }`. The
  *only* top-level await in the program is the backend member's `await bootstrapServer(...)`, which
  fully resolves before the entry body runs — verified by an ordering log — so `api.backend` is a live
  client at import time and there is no TLA-deadlock class.

### 2.2 `serveSprig` — the single-origin dispatcher (framework-owned)

```ts
// @sprig/keep
serveSprig(config: {
  keep: { backend: BackendClient; handler: FetchHandler; docs?: SwaggerDocEntry[] };
  app:  SprigApp;
  base?:    string;                        // UI mount, default "/ui" (decided §12); keep owns /api + /docs
  apiPrefix?: string;                      // default "/api"
  docs?:    boolean;                       // default true
  assets?:  { dir?: string; prefix?: string };  // default { dir: "static", prefix: "/static" }
}): { fetch(req: Request, info: Deno.ServeHandlerInfo): Promise<Response> }
```

Per request, **in order** (the author writes none of this):

1. **`/api/*`** → `withBasePath(apiPrefix, api.handler)(req, info)`. `withBasePath` strips the prefix
   **and forwards `info`** (verified `mount/mod.ts` does `handler(new Request(url, req), info)`), so
   keep's localhost-trust + `/_mint` survive. Goes through **`handler`** (token-gated) — **never**
   `backend.fetch`.
2. **`/docs`, `/docs/*`** → `api.handler(req, info)` **unstripped** (the Swagger UI references
   `/docs/*` absolutely). `serveSprig` builds the OpenAPI `servers: [{ url: apiPrefix }]` rewrite from
   keep's **typed `api.docs`** array (not by intercepting the `/json` response string), so "Try it
   out" targets the real `/api` mount.
3. **assets** (`assets.prefix`, default `/static/*`) → `serveDir` over `assets.dir` using the
   content-hashed filenames in the build manifest, `Cache-Control: immutable`.
4. **everything else** → `app.fetch(req, info, { backend: api.backend })` — the sprig SSR renderer
   (§5), with the in-process client threaded in (§2.4).
5. **At construction**, `serveSprig` **validates the route table** against the reserved prefixes
   (`apiPrefix`, `/docs`, assets prefix) and **throws early** on collision.

### 2.3 The auth boundary (do not get this wrong)

keep has two surfaces and they are **not** interchangeable:

- **`api.backend.fetch`** — the in-process client. It stamps `x-danet-internal: <internalKey>` and
  **bypasses token auth**; dispatches the full pipeline with no TCP. **Reachable only via
  `inject(Backend)` during SSR.**
- **`api.handler(req, info)`** — the network surface. It does **not** stamp; it **enforces** tokens
  (network) and localhost trust (via `info.remoteAddr`).

`serveSprig` routes inbound network `/api/*` through **`handler`** and SSR data through **`backend`**.
Routing inbound `/api` through `backend.fetch` would expose the entire API unauthenticated — the
single most important invariant.

### 2.4 In-process wiring — no `globalThis` (the answer to "make it just work")

```
keep api.backend  ──(closure arg)──►  serveSprig  ──app.fetch(req, info, { backend })──►  SprigApp
        │                                                                                     │
        │                                          binds Backend token in the per-request     │
        │                                          SERVER root injector, then runInInjector   │
        ▼                                                                                     ▼
  in-process client                                                  resolve.ts: inject(Backend).fetch("/board")
  (x-danet-internal, no TCP, no token)                               server service: inject(Backend) ...
```

1. `serveSprig` closes over `api.backend` and passes it **as a function argument** into
   `app.fetch(req, info, { backend })` — never a process global.
2. `SprigApp.fetch` builds the fresh **request-scoped server root `Injector`** (it already does this
   per `core.ts`), **binds the built-in `Backend` token to the passed `backend` value**, then runs the
   matched route's `resolve.ts` (and any `scope:"server"` service it injects) inside `runInInjector`.
3. In `resolve.ts`: `const be = inject(Backend); await be.fetch("/board")` → in-process, token-free,
   relative path.
4. `Backend` is **`scope:"server"`**, so injecting it in island code **throws** — the existing
   contract rule "DI never crosses the wire — data does." Islands get their data only as serialized
   `@input`s returned by `resolve.ts`.

`BackendClient` is a stateless process singleton (it just wraps `handler` + the internal key), so
binding the same instance every request is correct and cheap.

### 2.5 Developer-facing data API

```ts
// ui/src/shell/components/board/resolve.ts
import { inject, Backend, type ResolveCtx } from "@sprig/core";

export const resolve = async (_ctx: ResolveCtx) => {
  const be = inject(Backend);                          // keep in-process client, token-free, SSR-only
  const { data } = await be.get<BoardVM>("/board");    // get<T> sugar replaces ssrBackendGet
  return { groups: data!.groups, project: data!.project };   // -> the page @inputs
};
```

A `scope:"server"` service can inject `Backend` once and expose typed methods; `resolve.ts` then
injects the service (the fixture's current `inject(BoardService)` shape keeps working — `BoardService`
just swaps its inline arrays for `inject(Backend).fetch(...)`). Both are supported; pick per service.

---

## 3. Framework API — exact additions

> **`.sprig/core.ts` already exists** (the 305-line runtime). These **extend** it; they do not
> redefine it. `core.ts` stays **backend-agnostic** (it must not `import @mrg-keystone/keep`), so the
> keep-coupled pieces live in a **new `@sprig/keep`** package — a UI-only app importing only
> `@sprig/core` never pulls the danet/keep dependency.

### `@sprig/core` — extend the existing contract

| symbol | change | signature |
|---|---|---|
| `bootstrap` | fill the **STUB** | `bootstrap(config: { routes: Route[]; base?: string }): SprigApp` |
| `SprigApp.fetch` | add `info` + a **narrow** `env` arg | `fetch(req: Request, info?: Deno.ServeHandlerInfo, env?: { backend?: BackendClient }): Promise<Response>` |
| `Backend` | **new** built-in token | `export const Backend = token<BackendClient>("sprig:Backend", { scope: "server", providedIn: "root" })` |
| `BackendClient` | **new** structural type (no keep import) | `type BackendClient = { fetch: typeof fetch; get<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T }> }` |

`SprigApp.fetch` binds `env.backend` to the `Backend` token in the per-request injector before
`runInInjector`. Use the **narrow `{ backend }`** env — not a general `providers[]` arg — `core` needs
nothing more. Everything else in `core.ts` (`defineRoutes`, `Injectable`, `inject`, `token`,
`runInInjector`, `Router`, `ResolveCtx`, `defineComponent`, the accessors) is unchanged.

### `@sprig/keep` — the new composition + build package

| symbol | signature / role |
|---|---|
| `serveSprig` | §2.2 — the single-origin dispatcher; returns `Deno.ServeDefaultExport`. |
| `Backend` re-export | re-export `core`'s `Backend` token for ergonomic import next to `serveSprig`. |
| `sprig build <member> --out <dir>` | compile every `template.html` → a Preact render fn; per-island `deno bundle --platform browser`; emit ONE shared `@sprig/core` chunk; content-hash; write the manifest. |
| `sprig dev` | `build --watch` + `deno serve -A --watch --unstable-kv serve.ts` in **one process** + an SSE live-reload snippet. |
| `sprig new` | scaffold the two-member workspace (root `deno.json`, `serve.ts`, `backend/`, `ui/`). |

---

## 4. The compile pipeline (the big new piece)

`the-vo-app` proves the *mechanics* (one `deno bundle`, `?v=` hash, boot bridge); sprig adds the
*compiler* (`template.html` → Preact), because folder-components are declarative, not hand-written.

### 4.1 Discovery

Walk `ui/src/**` for component folders (a folder with a `template.html`), exactly as the walker in
`ui/.sprig/compiler/{mod,build}.ts` does. For each: classify **static** / **static+parametrized** /
**island** (presence of `logic.ts`), read `styles.css`/`resolve.ts` if present, and resolve child tags
to folders by the resolution order (local `components/` → `shared-components/` → built-ins → native).

### 4.2 Template → Preact render function

Parse `template.html` with the in-repo **`tree-sitter-angular-template`** grammar. Build-time parse via
**`web-tree-sitter`** (WASM) — produce the WASM once with `tree-sitter build --wasm` (a build
prerequisite; document it). Emit one Preact module per folder (codegen, AOT) so the **server runs TS
directly** for SSR and the **client bundle** imports only the island modules.

AST node → Preact `h(...)` mapping:

| template construct | compiles to |
|---|---|
| text | string child (HTML-escaped) |
| `{{ expr }}` | `escape(String(<expr>))` — see the expression emitter below |
| `<div [class.x]="e" (click)="f()">` | `h("div", { class: cx(...), onClick: <stmt> }, ...children)` |
| `[prop]="e"` / `[attr.x]="e"` / `[style.x.unit]="e"` / `[class]="e"` / `[style]="e"` | DOM prop / `attributes` / `style` object / class map |
| `(event)="stmt"` / `[(two-way)]="acc"` | `onEvent` handler / `value` + `onChange` (island only) |
| `<counter>` (island tag) | an `<is-land>` wrapper around the SSR'd component + its JSON prop bridge (§4.3) |
| `<info-card>` (static tag) | inline the child's render fn with bound `@input`s |
| `<router-outlet [name]>` | a persistent boundary element; the matched child renders inside (the one tag-swap exception) |
| `@if/@else if/@else` | conditional expression |
| `@for (x of xs; track t)` / `@empty` | `xs.map(...)` keyed by `t` / empty fallback |
| `@switch/@case/@default` | `switch`/if-chain |
| `@defer (on …)` | SSR the `@placeholder`; client `<is-land>` swaps to the deferred content on the trigger (`on:visible`/`idle`/`interaction`/…) |
| `*ngIf/*ngFor/*ngSwitch`, `<ng-template>`, `*ngTemplateOutlet`, `<ng-content select>` | desugar to the same conditional / map / projection primitives |
| `x \| pipe:arg` | `$pipes.pipe(x, arg)` from a small pipe registry |
| `$any(x)` → `x`, `$event`, `$index/$first/...` | cast-through / event arg / loop locals |

**Expression emitter.** Walk the grammar's expression sub-AST → a JS expression evaluated against a
single `scope` object = `{ ...inputs, ...setupReturn, ...loopLocals }`. Free identifiers become
`scope.<id>`; **islands read signals by calling** (`count()`), so the scope holds the callable
accessors `defineComponent`'s `setup()` returns. Static components have **no** `setup()`; their free
names are the implied `@input`s (already inferred by `tree-sitter-angular-template/scripts/implied-inputs.ts`).

### 4.3 Islands: prop bridge + is-land + one client bundle

- **Prop bridge** — per island instance, emit `<script type="application/json" data-island="<id>">`
  holding the serialized `@input`s (the `the-vo-app` `__BOOT__` idea, but per-island so multiple
  islands compose). The client reads it, `hydrate(h(Component, props), islandEl)`.
- **is-land** — wrap each island's SSR HTML in `<is-land on:visible|idle|interaction>` so hydration is
  *lazy by trigger*. (`@defer` maps to the matching `on:` trigger.)
- **Client bundle** — **one** `deno bundle --platform browser --minify --sourcemap=linked
  ui/.sprig/client-entry.ts -o static/client.js && gzip -kf static/client.js` (the `the-vo-app`
  shape). `client-entry.ts` imports every island module + the sprig client runtime (§7) and registers
  islands by selector. **Milestone-later:** split per-island chunks (`list.md`'s full `deno bundle`
  per island) for smaller initial JS; the single bundle is the simple first cut.
- **Shared core chunk** — `@sprig/core` + `providedIn:"root"` services must emit as **one shared
  chunk** all islands import (per `list.md`), or the client root injector diverges and "singletons"
  (Router, Prefs, Notify) split.

### 4.4 CSS + manifest

**As built — per-component CSS with view encapsulation (Angular "Emulated" model, no Shadow DOM,
correcting this spec's original "global BEM").** Each component folder may carry a `styles.css`. The
build gives every component a stable scope id (`scopeId(selector)`, a sync FNV-1a → `s<8hex>`), and:
(1) at SSR every native element a component's template emits carries that id as a bare marker
attribute (`render.ts` threads `scopeAttr`; islands re-emit it on their client re-render too);
(2) the build rewrites each rule in the component's `styles.css` so its **key (rightmost) compound
selector** also requires `[<scopeId>]` (`scope.ts`). Result: a component's styles can only land on its
own elements — they never leak to or clobber another component. `:host` → the scope marker; `:global(…)`
opts out. Styling is **Tailwind v4**: the scoped CSS (authored with `@apply` + utilities) is concatenated
with `@import "tailwindcss"` and run through the Tailwind CLI (`deno run npm:@tailwindcss/cli`, from a
cache dir outside the workspace so `node_modules` resolves) → `static/app.css`, served immutable, linked
in `<head>` with `?v=`. The `m7:`/encapsulation tests + the `scope:` unit tests lock the model.

**As built:** the manifest (`static/manifest.json`) is `{ v, client, islands, chunks }` — `v` is the
build content-hash (64-bit), `client` the loader filename, `islands` the island selectors, `chunks`
the esbuild shared-runtime chunk(s). The SSR head reader (`createRenderer` in `mod.ts`) consumes only
`v`, threading it into the document as `client.js?v=<v>` + the `__sprig_config` bridge; the client
loader builds each island's chunk URL by convention — `<base>/_assets/isl.<sel>.js?v=<v>`. The shared
runtime chunk is content-hashed in its filename (esbuild) so it's immutable-safe; `client.js` and the
`isl.*.js` entries keep stable names and are busted by `?v=`. (A fuller manifest — explicit
island-id→entry and asset→hashed-filename maps, content-hashed island entries — is a possible
enrichment, but the convention + `?v=` is what ships and is what the `m7:` test locks.)

---

## 5. SSR — filling `bootstrap()` (the 501 stub)

`bootstrap({ routes, base })` returns a `SprigApp` whose `fetch(req, info, { backend })`:

1. **Base-path** — strip `base` from the pathname (when `base !== "/"`).
2. **Match** — `resolve(routes, pathname)` from `router.ts` → a `MatchedRoute` tree (primary chain +
   named outlets, params).
3. **Resolve** — build the request-scoped server `Injector`, bind `Backend` ← `backend`, and for each
   matched route run its `resolve.ts` (if any) inside `runInInjector` → the route's `@input`s. Server
   services resolve here (and may `inject(Backend)`).
4. **Render** — Preact `renderToString` of the matched tree (root `shell` → page → named/primary
   outlets), islands wrapped per §4.3, the matched component rendered into each `<router-outlet>`.
5. **Document** — wrap in the HTML shell (the `the-vo-app` `buildMainHtml` shape): `<head>` with
   `<link rel="stylesheet" href="<base>/static/app.css?v=…">`, `<link rel="modulepreload">` +
   `<script type="module" src="<base>/static/client.js?v=…">`, the per-island prop-bridge `<script>`s,
   and a `@view-transition { navigation: auto }` opt-in. Return `text/html`.

Same-origin, in-process: `resolve.ts` only ever calls `inject(Backend).fetch(<relative>)` — never the
app's own public URL — so Deno Deploy returns no **508 Loop Detected**.

---

## 6. Client runtime (hydration + soft-nav)

The single bundle (`@sprig/core` client side) provides:

- **`clientRoot()`** document-level injector (exists in `core.ts`) + `client`/`both` services, from the
  one shared chunk.
- **Hydration** — for each `<is-land>`, read its prop-bridge JSON, look up the component def by
  selector, `hydrate(h(Component, props), islandEl)` on the is-land trigger.
- **Soft-nav (Navigation API)** — intercept same-origin `<base>/*` link clicks → `fetch(dest, { signal })`
  → parse → replace **only** the `<router-outlet>` `innerHTML` inside `document.startViewTransition()`,
  guarded on `!signal.aborted`. Islands **outside** the outlet stay mounted; islands inside re-arm on
  insertion. `scroll: "manual"` + explicit restore. Unsupported → full nav (cross-document
  `@view-transition`). The named-outlet `=`-segment URL scheme (`router.ts`) drives per-outlet swaps.
- **Scope enforcement** — injecting a `server` token (e.g. `Backend`) client-side throws.

---

## 7. Data — the keep backend modules

Per the chosen model ("keep is host **+** in-process data backend"), the fixture's `server`-scoped
data (`BoardService`/`UserService`) moves into **keep `@Endpoint`/`@Get` controllers** that return
ready-to-render **view-models** (the `leaderboard` rule: "the frontend computes nothing; every loader
calls the backend for a view-model"). sprig's `resolve.ts` / server services consume them via
`inject(Backend)`. The backend member owns its own KV/data and its `DENO_DEPLOYMENT_ID`-gated cron;
`serveSprig` starts **no** background work.

---

## 8. Dev & deploy

**Dev** — `deno task dev` → `sprig dev` = **one process**: `deno serve -A --watch --unstable-kv
serve.ts` (cwd = root) + the island/template build-watch + an SSE live-reload. Because the deploy entry
*is* the dev entry, `inject(Backend)` is bound from the moment `bootstrapServer` resolves — the
`leaderboard` `BACKEND_URL` two-process fallback is **deleted**; there is no `dev:backend`/`dev:frontend`.
(Honest gap, per `list.md`: rebuild-and-reload, not state-preserving HMR.)

**Deploy** — **prebuild then serve**: `sprig build ui --out static` (templates + island bundles cannot
compile at request time on Deploy) → `deno serve -A --unstable-kv serve.ts`. Whole repo uploaded so the
root workspace config resolves the members. Single origin, single process, one outward fetch → no 508.
Set keep env (`MANUAL_KEY`, optionally `FIREBASE_PROJECT_ID`) so network `/api/*` is token-verified;
`/_mint` auto-403s off-localhost. Cron/queue gated on `DENO_DEPLOYMENT_ID` in the backend member.

---

## 9. Milestones (each with a gate the repo can already run)

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Workspace + compose** — two-member workspace, `serve.ts`, `serveSprig` skeleton (dispatch only; UI returns a static placeholder). | `deno serve serve.ts` boots; `GET /api/<x>` reaches keep (token-gated), `GET /docs` serves Swagger, `GET /` serves the placeholder; `info.remoteAddr` reaches keep. |
| **M1** | **In-process `Backend`** — `Backend` token + `app.fetch(...,{backend})` binding; one `resolve.ts` reads data in-process. | `inject(Backend).fetch("/board")` in a resolver returns data with **no token, no TCP**; injecting `Backend` in island code throws; no `globalThis`. |
| **M2** | **Template compiler (SSR)** — `template.html` → Preact; render the full matched tree to HTML (static + parametrized + control-flow + bindings + pipes + projection). | every route renders correct HTML; `tree-sitter parse` + `deno test` stay green; an SSR golden snapshot per route matches. |
| **M3** | **Islands + hydration** — prop bridge + `<is-land>` + single `deno bundle` + shared core chunk + `hydrate`. | `counter`, `star-rating`, `theme-toggle`, `toast-host` are interactive in a real browser (Playwright). |
| **M4** | **Routing + soft-nav** — Navigation API outlet-only swap + view transitions; the `=`-segment named outlets live. | clicking nav swaps the outlet without full reload; islands outside persist; deep-linked `/settings/main=…/sidebar=…/` SSR-renders. |
| **M5** | **Data via keep** — fixture data moves to keep `@Endpoint` view-models; `resolve.ts` consumes them. | board/issue/user render real keep-served data; `exerciseEndpoints` (keep) green. |
| **M6** | **Assets + dev/deploy** — hashed CSS/JS, immutable cache + `?v=`, gzip, SSE reload; `deno serve` on Deno Deploy. | correct cache headers; one-command deploy; no 508; cron only on `DENO_DEPLOYMENT_ID`. |
| **M7** ✅ | **Per-island code-split** — `deno bundle --code-splitting` (one shared `@sprig/core` chunk + a chunk per island, lazy-loaded by trigger). | initial JS drops to per-island chunks; `deno test` (incl. the `m7:` per-island Playwright test in `hydration.test.ts`) still green. |

---

## 10. Acceptance checks (verified-style, copyable into tests)

- `deno serve -A --config <root>/deno.json serve.ts` boots; `export default serveSprig(...)` is an
  object with `fetch(req, info)`.
- The backend member's `await bootstrapServer(...)` completes **before** `serve.ts`'s body and before
  the first request (`api.backend` is a live client at import).
- `inject(Backend).fetch("/board")` in `resolve.ts` returns in-process data with **no token, no TCP**;
  **no `globalThis`** anywhere.
- Inbound network `GET /api/board` is dispatched via `withBasePath("/api", api.handler)` (token-gated),
  **never** `backend.fetch`; `info.remoteAddr` reaches keep (localhost trust + `/_mint` work).
- Cross-member `import { api } from "@app/backend"` resolves when cwd = workspace-root / `--config root`
  and **fails `TS2307`** when the root config is not discovered → tasks pin cwd = root.
- `serveSprig` throws at construction if any UI route collides with `apiPrefix`, `/docs`, or the assets
  prefix.
- `@sprig/core` does **not** import `@mrg-keystone/keep` (the `Backend` token + `serveSprig` live in
  `@sprig/keep`); a UI-only app importing only `@sprig/core` pulls no danet/keep dependency.
- `tree-sitter parse` on every `template.html` exits 0 and `deno test` is green after each milestone.

---

## 11. Risks

- **Workspace resolution depends on cwd = root** (§1.1) — verified it fails otherwise. Tasks enforce
  cwd; the whole repo is uploaded on Deploy.
- **Top-level-await order** — `serveSprig` must receive a *resolved* `api`. The one TLA is the
  backend's `await bootstrapServer`; if an author forgets `await`, `api.backend` is a Promise — assert
  a resolved `KeepApi` at `serveSprig()` time.
- **Auth boundary** (§2.3) — network `/api` through `handler` only, never `backend.fetch`. A slip
  exposes the API unauthenticated.
- **`info` forwarding** — thread `info` through `withBasePath`/`handler` or localhost trust + `/_mint`
  + `/docs` tooling break (`withBasePath` already forwards it; do not hand-roll a `Request` without it).
- **Prebuild ordering** — island bundles + manifest must exist before `deno serve`; missing build →
  404 bundles, hydration fails. The manifest is the contract.
- **Shared core chunk** — duplicate `@sprig/core` per island splits the client root injector.
- **`deno serve` entry shape** — must be `export default { fetch(req, info) }`, not a bare function.
- **Base-path rebasing (`/ui`)** — with the chosen `base: "/ui"`, three things must agree: the router
  strips `/ui` inbound, the compiler prefixes every generated `href`/asset URL with `/ui`, and the
  soft-nav interception is scoped to `/ui/*`. A half-applied base yields broken links or soft-nav. (Root
  would avoid this entirely; it's the cost of the `/ui` choice and is isolated to one `base` value.)
- **508** — only returns if a resolver fetches the app's own public URL; the relative-only `Backend`
  API steers away from it. Document "never fetch your own public URL — use `inject(Backend)`."

---

## 12. Decisions & open questions

**Decided (this spec):**
- **UI mounts at `/ui`** (your choice); keep owns `/api` + `/docs`. `base: "/ui"` is the framework
  default; the router, the compiler's link/asset URLs, and the Navigation API soft-nav are base-aware
  (strip `/ui` inbound, prefix it outbound) — see the base-path risk in §11.
- two-member workspace (no third "server" member) · `serveSprig` synchronous, backend holds the only
  TLA · `Backend` token in `@sprig/keep`, `core` stays keep-agnostic · in-process client threaded via
  `app.fetch(req, info, { backend })` (narrow env, not a general `providers[]`) · network `/api` via
  `handler`, SSR via `backend.fetch` · one client bundle first, per-island split at M7 · `/docs`
  `servers`-rewrite built from typed `api.docs`.

**Open — your call (none block the plan):**
1. **`Backend` bind: per-request env arg (canonical here) vs a one-shot `app.provide(Backend, …)`?**
   Per-request is more general (lets us also inject a per-request trace id later); a one-shot is
   cheaper. Spec uses per-request; flag if you want the one-shot.
2. **Data layer: delete `BoardService`/`UserService` and call `Backend` straight from `resolve.ts`, or
   keep them as thin typed `inject(Backend)` wrappers?** The wrappers preserve the fixture's DI
   ergonomics/testability; recommended to keep.
3. **`@sprig/core` / `@sprig/keep` distribution** — vendored into `ui/.sprig/` (as today) vs published
   to JSR. Vendored is simplest to start; JSR when stable.
