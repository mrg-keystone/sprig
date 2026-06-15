# Wire to a rune/keep backend — and propose what's missing

deno-fresh2 builds the **frontend**; rune generates the **backend** it talks to.
This file is the mechanics for the two-input build: consume the runes, and emit
suggested runes for whatever the UI needs that the backend doesn't have yet. The
SKILL.md section is the summary; this is the detail.

Backend specifics here are rune/keep's contract — when the exact API matters,
defer to the **rune** and **keep** skills rather than reconstructing it.

## Inputs & detection

Two inputs:

- `ui-breakdown/` — the UI spec + the `isolate/` fixtures (the source of *what
  the UI needs* and the *fake data* each screen shows).
- the **rune server dir** — where `.rune` files + their generated keep backend
  live (`src/<module>/`, `mod-root.ts`, `bootstrap/`).

Take both as args when given; otherwise auto-detect:

- ui-breakdown → the sibling `ui-breakdown/` of the source (its own convention).
- server dir → the nearest ancestor/sibling dir containing `**/*.rune` **and**
  `bootstrap/modules.ts` (the generated keep registry). No such dir → treat the
  whole backend as missing (see *No backend yet*, below).

## The endpoint catalog — what the frontend may call

A rune module exposes HTTP only through its **`[ENT]` surfaces**. For each, rune
generates a keep controller at `src/<module>/entrypoints/<surface>/mod.ts`:

```ts
@EndpointController("orders")
class OrdersController {
  @Endpoint({ input: PlaceOrderDto, output: ReceiptDto, order: 1 })
  place(body: PlaceOrderDto) { return placeOrder(body); }   // → coordinator in mod-root.ts
}
```

Read the catalog from, in order of preference:

1. **The generated controllers** — every `@Endpoint` gives you path
   (`@EndpointController("orders")` + method/`path`), `input`/`output` DTO, and
   `order`/`dependsOn`/`bind`. This is the typed, authoritative list.
2. **The running cake** — `GET /docs/<module>/json` is the OpenAPI for the
   module; `/docs/_map` is the whole composed app as one graph. Use when the
   server is already running.
3. **The `.rune` source** — the `[ENT]`/`[REQ]` lines, if you only have specs
   and not a generated tree.

A `[REQ]` with no `[ENT]` is **internal** (a step of some other endpoint, a
cron/queue job) — it is not callable over HTTP and is not part of this catalog.

## Share the DTO types — don't redeclare them

Import the generated DTOs instead of hand-writing frontend types: each module
re-exports them through `mod-root.ts`.

```ts
import type { PlaceOrderDto, ReceiptDto } from "../../server/src/checkout/mod-root.ts";
```

**deno.json reconciliation (the gotcha).** rune writes the *server* project's
import map: `"@/": "./"` (project root), plus `class-validator`,
`class-transformer`, `reflect-metadata`, and `#assert` → `@mrg-keystone/keep/assert`.
The Fresh app has its own Vite-flavored map. For an **embedded** build (one
project, keep mounted under Fresh) the two maps must merge — carry over
`class-validator`/`class-transformer`/`reflect-metadata`/`#assert` and the
`experimentalDecorators` + `emitDecoratorMetadata` compiler options the DTO
classes need, or the imported DTOs won't type-check. For a **separate-service**
build, prefer generating a thin client from the OpenAPI (`/docs/<module>/json`)
over importing across the boundary.

## Call it in-process

keep is built to be embedded under Fresh and called without a network hop: an
SSR loader uses the in-process backend client (`api.backend.fetch(...)` — no
listen, no token), and keep's `embed`/`withBasePath` mount its handler under the
Fresh app. The exact wiring (where `api` comes from, how to mount) is the **keep
skill's deployment reference** — read it there; don't invent the API.

```tsx
export const handler = define.handlers({
  async GET(ctx) {
    const res = await api.backend.fetch("/orders");   // in-process, see keep skill
    return page({ orders: await res.json() as ReceiptDto[] });
  },
});
```

## Consuming a separate backend in-process — the setup gotchas

When the backend is a **separate sibling package** (its own `@/`-rooted imports and deps —
a hand-written keep/danet service, not just a rune module you import), wiring it in-process
is very doable but has a cluster of non-obvious traps. Each one below cost real debugging
time on a real build — handle them up front.

**Wire the data spine first.** The build order that goes wrong: UI-against-fixtures →
world-class → *then* wire the server, ending with a beautiful console of 100% fake numbers.
Build page handlers that read **live** data from request one; fixtures are only for
endpoints that genuinely don't exist yet, and they get labeled (see *live-first adapter*,
below).

### The in-process call

The backend's `bootstrapServer(...)` exports an `api` whose `api.backend.fetch(input,
init)` is `typeof fetch` and dispatches **through the real server pipeline with no port, no
TCP, no token**. Build the typed client over it with an empty base URL:

```ts
const client = new QbInterfaceClient({ baseUrl: "", fetch: api.backend.fetch });
```

(keep also ships an `embed()` Fresh middleware — cross-link the **keep skill** for the
mount API; don't reinvent it.)

### It needs a Deno workspace — and the workspace rules bite

To import a sibling package cleanly, make the repo a Deno **workspace** and import the
backend by its package `name`:

```jsonc
// root deno.json
{ "workspace": ["./console", "./server"] }
```

Three keys **only work at the workspace root** — putting them in a member warns and is
ignored:

- **`nodeModulesDir`** — root only.
- **`unstable`** — root only.
- **`compilerOptions`** — must be at the root to reach a *dependency's* source. This one is
  brutal: a danet dep uses **parameter decorators**
  (`constructor(@Inject(X) private y: string)`) that **fail to parse** without
  `experimentalDecorators` — you get `SyntaxError: Invalid or unexpected token` at the `@`,
  in a file you don't own. Put `experimentalDecorators` + `emitDecoratorMetadata` in the
  **root** `deno.json`.

Also: members imported by name need their own `name` (+ `exports`) or Deno warns; keep one
`deno.lock` and one `node_modules` at the root and delete the members'.

### Decorators work under Fresh's Vite SSR — and survive the build

Conventional wisdom says esbuild strips decorator metadata, so a danet/keep app "can't run
under Vite." It can. Fresh 2's Vite plugin runs SSR through Deno, which honors
`emitDecoratorMetadata` from the (root) `deno.json` — the danet DI container, controllers,
and DTO validation all bootstrap in `deno task dev`. And they **survive `deno task build`
too**: every controller registers in the bundled `server-entry.mjs`. Don't pre-emptively
avoid the approach.

### Literal dynamic import + what it does to `deno check`

A real tension, and the literal form is mandatory:

- Vite's SSR runner resolves a **literal** dynamic import (`import("@pkg/name")`) but
  **silently fails a non-literal one** (`import(fn())`) at request time — *"dynamic import
  cannot be analyzed by Vite."* `@vite-ignore` does **not** rescue the non-literal form at
  runtime. Use a literal specifier.
- But a literal/static import makes **`deno check` traverse the dependency's source** under
  *your* tsconfig, surfacing the dep's own type needs. A single missing `Deno.openKv` /
  `Deno.KvKey` type cascaded into ~15 errors via broken ternary narrowing. Fix by giving
  `deno check` what the dep needs: add `deno.unstable` to the consuming app's `lib` and
  `@types/node` to its imports.

### Load the backend's env from the runtime, not in code

The backend usually picks its datastore (Firestore vs Deno KV vs …) **from env at bootstrap
/ first call**, so env must be set *before* the server module loads. Two approaches fail:

- ❌ `vite` loads **no** env, so the in-process backend silently falls back to an **empty
  default store** — every read comes back empty, which looks exactly like "the database is
  broken" when the database is fine. (A days-of-your-life bug.)
- ❌ `loadSync(new URL("../server/.env", import.meta.url))` in code works in dev but
  **breaks in the build** — `import.meta.url` resolves against the *bundled* file, so the
  path is wrong. (And static `import`s hoist above top-level code, so you can't `loadSync`
  then import a module that reads env at load.)
- ✅ Put **`--env-file` on the tasks** so the runtime sets env before any module — works
  identically in dev and prod:

  ```jsonc
  // member deno.json
  "dev":   "deno run -A --env-file=../server/.env npm:vite",        // NOT bare "vite"
  "start": "deno serve -A --env-file=../server/.env _fresh/server.js"
  ```

### The live-first / fixture-fallback adapter

A real backend is often **thinner than the UI** (no write-queue list, no activity feed, no
hit-rate stats). The honest pattern: **one centralized adapter** that tries the live
endpoint and falls back to the fixture, exposing a `live: boolean` the page surfaces — so
gaps are *visible*, never silently faked. Pair each fallback with a `TODO(suggested-rune):`
and the gap audit (below).

```ts
async function loadStats(): Promise<{ data: Stats; live: boolean }> {
  try {
    const res = await api.backend.fetch("/stats");
    if (res.ok) return { data: await res.json() as Stats, live: true };
  } catch { /* fall through */ }
  return { data: STUB_STATS, live: false };       // surface `live:false` in the UI
}
```

### The production build is the real test (run it before "done")

`deno task dev` passing proves **nothing** about production: dev transpiles through Deno;
the build runs esbuild/rollup and bundles the **entire backend** into `_fresh/server/`. A
dev-verified setup that crashed in the built server taught these:

- ✅ **Decorators survive the build** (DI container bootstraps in `server-entry.mjs`).
- ❌ **`import.meta.url`-relative file reads break in the bundle** (the path points at the
  bundled file). The classic chain: env not found → store fell back to Deno KV →
  `Deno.openKv is not a function` (no `--unstable-kv` under `deno serve`) → 500 on every
  call, *silently swallowed by the fixture fallback*. Fix via `--env-file` on the task.
- ⚠️ **Read the build warnings** — e.g. a `class-validator` `isStrongPassword` "not exported
  by validator" interop wrinkle is harmless until that path runs, then it's fatal.
- ✅ **`deno serve -A`** (full perms) is required — the in-process backend needs net, env,
  and read; no narrower set works.
- ⚠️ **Operational, not wiring:** correct wiring still shows nothing if the datastore is
  empty/unreachable — e.g. the Firestore emulator must be running and the data actually
  populated (discover → enable → sync).

**Required step:** `deno task build` → `deno serve -A _fresh/server.js` → hit a real
endpoint, before declaring the build done — especially when a backend is bundled in.

### Do-it-right-from-the-start checklist

1. Make the repo a Deno **workspace**; put `nodeModulesDir`, `unstable`, and decorator
   `compilerOptions` in the **root** `deno.json`.
2. Import the backend by package name; call it in-process via `api.backend.fetch` wrapped
   in the typed client with `baseUrl: ""` (a **literal** dynamic import).
3. Load the backend's `.env` via **`--env-file` on dev *and* start** — never via
   `import.meta.url` paths.
4. Write handlers that read **live data from request one**; stub only genuinely-missing
   endpoints and surface `live` vs `placeholder`.
5. Add `deno.unstable` / `@types/node` to lib/imports so `deno check` survives the imported
   backend; restart dev when you add an island.
6. **Run the production build and hit a real endpoint** — dev passing proves nothing.
7. *Then* style it.

## Reconcile fixtures — the rune DTO wins

ui-breakdown's `isolate/` cases carry **fake, UI-shaped** data; the rune DTO is
the **real** shape. As you wire each screen, re-type its fixture against the DTO
and **report mismatches loudly** — they are bugs, not noise:

- a fixture field the DTO lacks → the UI shows data the backend never returns
  (drop it, or it's a *gap*: the backend should provide it — see the audit).
- a required DTO field the fixture omits → the screen will break on real data.
- a type/enum disagreement → the contract drifted between mock and backend.

Don't paper over these by widening types; surface them so the data-model stays
single-sourced.

## Gap audit → suggested runes

Run this **last**, after the app is wired. The backend is frequently *thinner
than the UI*; this step makes the missing pieces explicit instead of faking them
silently.

**Compute the gap.** `needed − existing`:

- **needed** = every UI operation: each data-mutating interaction in a
  component's **Events** section (create/update/delete/submit/toggle…) and each
  view that **loads** an entity from the data-model.
- **existing** = the endpoint catalog above, matched by operation — usually by
  the `(input, output)` DTO pair, falling back to noun.verb intent.

Anything in **needed** that matches nothing in **existing** is a gap.

For each gap, do three things:

### 1. Write a suggested spec

`<git-root>/spec/suggested/<name>.rune` (resolve the root with
`git rev-parse --show-toplevel`; `mkdir -p` the dir). Build it from material you
already have — the data-model gives the DTOs/`[TYP]`s, the UI interaction gives
the endpoint. Mark every inference; leave boundaries and faults as honest
guesses to verify, not invented certainty.

```
[MOD] <module>

# Suggested by deno-fresh2 gap audit — UI needs this, backend has no [ENT] for it.
# INFERRED — verify boundary, faults, and validation before sync.
[REQ] task.create(CreateTaskDto): TaskDto
    # from UI: "Add task" submit on /board (BoardComposer → onSubmit)
    [NEW] task
    task.fill(title): task
    db:task.save(TaskDto): void          # boundary INFERRED — confirm the store
      write-failed                       # fault INFERRED from the UI's error toast
    task.toDto(): TaskDto

[ENT] http.createTask(CreateTaskDto): TaskDto

[DTO] CreateTaskDto: title
    input to create a task
[DTO] TaskDto: id, title, done
    a persisted task
[TYP:nonempty] title: string             # INFERRED from the form field
    the task title
[TYP] id: string
    a unique identifier
[TYP] done: boolean
    whether the task is complete
```

Keep the spec valid rune (it should pass `rune check`): DTO names end in `Dto`,
the last `[REQ]` step returns the output DTO, indentation is exact (`[REQ]`=0,
steps=4, faults=6), lines ≤ 80. See the **rune skill** for the full rules.

For a value the UI implies but no module produces yet, prefer rune's own
`[TYP:ext]` (a ghost-stub input) over fabricating a producer — that's the native
"depends on something not built yet" escape hatch.

### 2. Stub the call so the app still runs

The page must render end-to-end on fakes. Back the loader/action with the
isolate fixture's data and point a TODO at the spec you just wrote:

```tsx
import { define } from "../utils.ts";
import { page } from "fresh";

export const handler = define.handlers({
  async GET(ctx) {
    // TODO(suggested-rune): spec/suggested/board.rune — list tasks; backend has no endpoint yet.
    // Stubbed from ui-breakdown/pages/board/components/task-list/isolate/cases/filled/filled.json
    const tasks = STUB_TASKS;
    return page({ tasks });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    // TODO(suggested-rune): spec/suggested/board.rune — persist a task; stubbed in-memory for now.
    STUB_TASKS.push({ id: crypto.randomUUID(), title: String(form.get("title")), done: false });
    return new Response(null, { status: 303, headers: { location: "/board" } });
  },
});
```

Use the **real captured values** from the fixture (the same ones the screenshot
shows) so the stubbed screen still diffs clean against ui-breakdown's evidence.

### 3. Index it

Append to `<git-root>/spec/suggested/README.md` (create with the header on first
write):

```markdown
# Suggested backend specs

Auto-generated by deno-fresh2's gap audit. **Proposals, not synced.** Review,
then promote: move the spec into the server dir and `rune sync` it. Never
synced automatically.

| Spec | UI feature that needs it | Why it's missing | Promote |
|---|---|---|---|
| board.rune | "Add task" + task list on /board | no `[ENT]` accepts CreateTaskDto / returns TaskDto | move to server/src/board/, `rune sync` |
```

## Rules

- **Review-only.** Never `rune sync` a suggested spec from the frontend build —
  generate, stub, index, report. Promotion is a deliberate human/rune step.
- **App stays runnable.** Every gap gets a stub + TODO; a gap must never crash a
  page or fail the build's own "run it" check.
- **Inferences are flagged**, never disguised as certainty — same discipline as
  ui-breakdown's "described, not extracted — verify during build."
- **No backend yet** → every UI operation is a gap, so the audit emits a
  complete suggested backend in `spec/suggested/`. Frontend-first is a supported
  flow, not an error.
- **Inverse mismatch** (an `[ENT]` no screen calls) is not a gap — list it in
  the index under "backend endpoints with no UI caller" and generate nothing.
