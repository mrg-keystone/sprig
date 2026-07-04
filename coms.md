# coms.md — rune ⇄ sprig native integration

- \*Coordination doc between the `rune`/`keep` repo and the `sprig` repo.\*\*
  Owner of this file: the rune-side work (`/Users/raphaelcastro/Documents/programming/rune`).
  Started: 2026-06-26.

Goal (user's words): _"this repo [rune] used to be made to integrate with fresh. Change it so it
integrates with sprig natively. sprig should run off the app and not `Deno.serve()`, come wired
natively to the in-process client, and the build skill should integrate via the in-process client,
not HTTP."_

---

## TL;DR — most of the runtime is already built

The hard part is **already shipped on the sprig side**. `serveSprig()` already:

- runs under **`deno serve serve.ts`** — sprig never calls `Deno.serve()` in production;
- routes `/api/*` + `/docs*` → keep's **token-gated network `handler`**;
- sends everything else → the sprig SSR app with keep's **in-process `backend.fetch`** threaded in,
  bound to the `Backend` DI token so `resolve.ts` reads data with **no TCP, no token**.

So requirements 1 ("run off the app, not `Deno.serve`") and 2 ("wired natively to the in-process
client") are **met by the current `serve.ts` + `@mrg-keystone/sprig/keep`**. The remaining work is mostly on the
**rune side** (drop the Fresh story, fix the package name) plus **doc/skill alignment** so a _user's_
freshly-built app gets this wiring by default.

---

## The as-built contract (the seam both sides depend on)

This is the agreed interface. Do not break it without updating both sides + this doc.

### rune/keep produces (per `bootstrapServer`)

`keep/src/foundation/domain/coordinators/bootstrap-server/mod.ts:1076`

```ts
const api = await bootstrapServer(appName, Module, { port?, swagger? });
// → { listen, stop, backend, handler, docs }
```

- `api.backend.fetch: typeof fetch` — **in-process**. Stamps `x-danet-internal: <process-private key>`,
  resolves relative paths, dispatches the full pipeline with **no TCP and auth bypassed** (trusted).
  `keep/.../backend-client/mod.ts`. SSR-only.
- `api.handler: (req, info?) => Response | Promise<Response>` — **network**. `stripInternalHeader`
  removes any forged trust marker, then dispatches; deny-by-default credential guard applies.
  `keep/.../http-adapter/mod.ts:52` (`handler` vs `inProcessHandler`).
- Trust model: in-process (header) OR localhost (loopback `remoteAddr`, needs `info` forwarded) are
  trusted; all other network traffic needs a credential. `keep/.../token-auth/mod.ts`.

### sprig consumes (`@mrg-keystone/sprig/keep`)

`packages/keep/mod.ts`

```ts
export interface KeepApi {
  backend: { fetch: typeof fetch };                                  // in-process (SSR)
  handler: (req, info?) => Response | Promise<Response>;             // network (islands, /api/*)
}
serveSprig({ keep, app, base, apiPrefix?="/api", docsPrefix?="/docs", assetsDir?="static" })
  : { fetch(req, info): Promise<Response> }   // a Deno.ServeDefaultExport — hand to `deno serve`
```

- `Backend` DI token: `framework/.sprig/core.ts:320` — server-scoped, bound per request to
  `backendClient(keep.backend.fetch)`. `inject(Backend)` in `resolve.ts`/services = in-process read.
  Injecting it client-side **throws by design** (DI never crosses the wire).
- `sprigUi(config)`: `packages/keep/mod.ts:253` — framework-agnostic middleware (returns
  `Response | null`) to mount the sprig UI under ANY host (Deno.serve / Danet / Hono).

### The two-channel reality (do NOT "fix" this)

- **SSR / `resolve.ts` / server services** → `inject(Backend)` → in-process, no token. ✅
- **Islands (browser)** → `fetch("/api/...")` over the network channel, token-gated. This HTTP hop is
  **unavoidable**: a browser cannot make in-process calls, and `Backend` is server-scoped. Server data
  reaches islands as serialized `@inputs`; anything an island fetches _after_ mount goes via `/api/*`.

---

## Status matrix

| #   | Requirement                                            | State               | Where                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | sprig runs off the app, not `Deno.serve()`             | ✅ DONE             | `serve.ts` + `deno serve` task; `serveSprig` returns `{fetch}`                                                                                                                                                                                          |
| 2   | sprig wired natively to the in-process client          | ✅ DONE             | `serveSprig` binds `Backend` to `keep.backend.fetch`                                                                                                                                                                                                    |
| 3   | build skill integrates via in-process client, not HTTP | ✅ DONE (by design) | sprig:build teaches `inject(Backend)` for SSR; islands keep `/api/*` (unavoidable — see standing note). rune:framework docs reframed to match                                                                                                           |
| 4   | rune stops shipping the Fresh story                    | ✅ DONE             | rune side: `embed`/`EmbeddableBackend`/`KeepState`/`EmbedContext` removed; `examples/fresh-project` deleted; `rune:framework` SKILL+deployment+auth + `keep/README` rewritten to sprig; keep `2.0.0` (breaking)                                         |
| 5   | package name the sprig scaffold imports resolves       | ✅ DONE             | sprig retargeted `@mrg-keystone/keep` → `@mrg-keystone/rune` (server source + both lockfiles + `framework/.sprig/core.ts` comment)                                                                                                                      |
| 6   | `rune init` scaffolds the sprig composition            | ✅ DONE             | `rune init` now emits `serve.ts` (serveSprig) + `app/src/main.ts` + `app/src/pages/home` + `@mrg-keystone/sprig/*` imports + `deno serve serve.ts` task. Verified: generated app `deno check`s clean against published `@mrg-keystone/sprig@^0.12` + `@mrg-keystone/rune@^1` |

---

## BLOCKER — package name mismatch (`rune` vs `keep`)

Evidence:

- rune publishes **`@mrg-keystone/rune`** — `keep/deno.json:2` (`"name": "@mrg-keystone/rune"`, v1.22.3).
- sprig's rune-generated backend imports **`@mrg-keystone/keep`** — `server/bootstrap/mod.ts:6`,
  `server/deno.json` → `jsr:@mrg-keystone/keep@^1`.
- rune's own `rune:framework` deployment docs _also_ already say `@mrg-keystone/keep`
  (`skills/rune:framework/references/deployment.md:40`), but `examples/in-process-client/server.ts`
  still imports `@mrg-keystone/rune`, and `rune init` writes `jsr:@mrg-keystone/rune@^1`.

Rune-side memory note says the **cutover to `keep` is "pending."** Until rune publishes (or aliases)
`@mrg-keystone/keep@^1`, a freshly `rune sync`'d sprig project **will not resolve its backend import.**

**Decision needed:** finish the rune→keep package rename (publish `@mrg-keystone/keep`), or change the
sprig scaffold to import `@mrg-keystone/rune`? (Recommendation: finish rune→keep; sprig + rune docs
already assume it.)

---

## Task split

### RUNE side (`/Users/raphaelcastro/Documents/programming/rune`)

1. **Resolve the package name** so `@mrg-keystone/keep@^1` resolves (the blocker above).
2. **De-Fresh the docs/skills/examples** (scope TBD — replace vs keep-alongside):
   - `skills/rune:framework/SKILL.md` (lines ~15,17,45,68,186,192–216) + `references/deployment.md`
     (lines ~31–63): replace the "Embedded under a Fresh 2 frontend / `embed`" section with the sprig
     story — `serveSprig`/`sprigUi`, the `KeepApi` contract, in-process SSR vs `/api/*` islands.
   - `keep/README.md:1040–1163`: same swap.
   - `examples/fresh-project/` → replace with (or add) `examples/sprig-project` showing
     `serveSprig({ keep: api, app, base })` + a `resolve.ts` using `inject(Backend)`.
3. **Fresh-specific keep exports** — `embed`, `EmbeddableBackend`, `KeepState`, `EmbedContext`
   (`keep/.../mount/mod.ts`). Decide: remove (breaking — major version), or keep as generic. Note
   `withBasePath` is framework-agnostic and worth keeping regardless; sprig uses `serveSprig`/`sprigUi`,
   not keep's `embed`.
4. **Scaffolding** (`rune init` / `rune sync`): confirm/define what rune writes for a sprig project —
   the keep backend (`server/bootstrap/*`, generated `server/src/<module>`) is rune's; `serve.ts` +
   `app/` (UI) ownership is the open question below.

### SPRIG side (`/Users/raphaelcastro/Documents/programming/sprig`)

1. Confirm the `@mrg-keystone/sprig/keep` `KeepApi` contract stays pinned to `{ backend, handler }` (it does).
2. Confirm `sprig init`'s scaffold mounts via `sprigUi`/`serveSprig` against a user keep backend
   (the framework `cli.ts init` currently scaffolds a Danet host + `sprigUi`; the all-in-one is
   `serveSprig`). Decide the default for a rune-backed app.
3. Confirm/keep the sprig:build + sprig:audit skills' dual-channel guidance (SSR in-process, islands
   `/api/*`) — align wording with rune:framework so the two skills agree.
4. Point the sprig scaffold's backend import at whatever rune publishes (see blocker).

---

## Decisions (LOCKED 2026-06-26)

- **Q1 (Fresh scope): REPLACE (breaking).** Delete `examples/fresh-project`, remove the Fresh-shaped
  keep exports (`embed`, `EmbeddableBackend`, `KeepState`, `EmbedContext`), and rewrite
  `rune:framework` + `keep/README.md` to teach only the sprig story. `withBasePath` stays (generic).
  This is a breaking keep major.
- **Q2 (package name): KEEP `@mrg-keystone/rune` — retarget sprig to it.** No rune→keep rename. The
  rune ENGINE already emits `@mrg-keystone/rune` everywhere (`src/rune/entrypoints/sync/mod.ts:404,644`,
  stubs, manifest). **Sprig-side action:** change `server/bootstrap/mod.ts` + `server/deno.json` from
  `@mrg-keystone/keep` → `@mrg-keystone/rune`, and align the `@mrg-keystone/sprig/keep`/skill docs. (rune-side: fix
  the one stale `@mrg-keystone/keep` line in `skills/rune:framework/references/deployment.md:40`, which
  is in the Fresh section being rewritten anyway.)
- **Q3 (scaffold ownership): `rune init` scaffolds the WHOLE sprig+keep app.** One command produces the
  keep backend (`bootstrap/` + generated `src/<module>`), the sprig UI (`app/`), and the `serve.ts`
  `serveSprig` composition root, plus a `deno.json` wired with `@mrg-keystone/sprig` + `@mrg-keystone/rune` and
  a `deno serve serve.ts` start task. Proposed layout for a user app (flat, matching rune's existing
  convention — NOT the sprig monorepo's workspace layout):
  ```
  <root>/
    deno.json            # @mrg-keystone/sprig + @mrg-keystone/rune; tasks: start = deno serve serve.ts
    serve.ts             # export default serveSprig({ keep: api, app, base: "" })
    bootstrap/mod.ts     # api = await bootstrapServer(name, modules, {...})  (dev-owned)
    bootstrap/modules.ts # GENERATED module registry
    bootstrap/config.ts
    app/src/main.ts      # bootstrap({ routes, renderer }); createRenderer(...)
    app/src/pages/...    # sprig UI pages (resolve.ts uses inject(Backend))
    src/<module>/...     # rune-generated keep modules
    spec/runes/...       # .rune specs
    spec/ui/...          # sprig UI prototype + design system
  ```
  **NEEDS SPRIG-SIDE CONFIRMATION:** the exact `app/` layout + the `createRenderer`/`bootstrap` import
  surface a generated `app/src/main.ts` should use, so rune's emitted scaffold stays byte-compatible
  with what `@mrg-keystone/sprig` expects. (See `app/src/main.ts` + `serve.ts` in this repo as the template.)

### Standing note (not a blocker)

- "In-process for SSR, `/api/*` for islands" is the **final** shape of "don't use HTTP." The island
  HTTP hop is unavoidable (browser can't do in-process; `Backend` is server-scoped). We make it
  explicit/ergonomic, we don't remove it. SSR/resolve/services = in-process; islands = `/api/*`.

---

## Side-finding (not in scope, flagged for accuracy)

rune's docs (`keep/README.md`, skills) still reference `GET /_mint` + `signToken`/`MANUAL_KEY`, but the
current keep source has **no `/_mint` route and no `signToken`/`MANUAL_KEY` export** — it implements
`POST /_token` (opaque→session-bearer exchange) + `verifyToken`, an infra-centralized model. The mint
docs are stale. Mentioning here only so the sprig-side auth assumptions stay correct.

---

## Append log

- 2026-06-26 — rune side: initial mapping of both repos; wrote this contract. Awaiting decisions Q1–Q3.
- 2026-06-26 — decisions locked: Q1 REPLACE (breaking), Q2 keep `@mrg-keystone/rune` (retarget sprig),
  Q3 `rune init` scaffolds all. rune-side starting Fresh removal + scaffolder. **Sprig-side TODO:**
  (a) `server/bootstrap/mod.ts` + `server/deno.json`: `@mrg-keystone/keep` → `@mrg-keystone/rune`;
  (b) align `@mrg-keystone/sprig/keep` + sprig:build/sprig:audit/interfaces skill docs to the `rune` package name;
  (c) confirm the `app/src/main.ts` scaffold surface for Q3.
- 2026-06-26 — **IMPLEMENTED + VERIFIED (rune side did the sprig-side edits too).**

  - rune: removed all Fresh exports + `examples/fresh-project`; `keep/deno.json` → `2.0.0` (breaking)
    - description de-Freshed; `withBasePath` kept (generic, doc reframed). `rune:framework`
      (SKILL/deployment/auth, incl. installed copy) + `keep/README` rewritten to the sprig story.
      `mount` test = 7 passed/0 failed; `keep/src/bootstrap/mod.ts` + the scaffolder `deno check` clean.
  - rune: `rune init` scaffolds the whole sprig+keep app (`serve.ts`, `app/src/main.ts`,
    `app/src/pages/home/{template.html,resolve.ts}`, `@mrg-keystone/sprig/*` imports + `deno serve serve.ts` task).
    Smoke test: generated app `deno check`s clean against PUBLISHED `@mrg-keystone/sprig@^0.12` (the `./keep`
    subpath has `serveSprig`+`createRenderer`) and `@mrg-keystone/rune@^1`. The `KeepApi` contract
    (rune's `bootstrapServer` result satisfies `{backend,handler}`) holds structurally.
  - sprig: retargeted `@mrg-keystone/keep` → `@mrg-keystone/rune` (server source + `framework/.sprig/
core.ts` comment); refreshed `deno.lock` + `server/deno.lock` (keep=0, rune resolved). Sprig:build/
    audit/interfaces skills referenced only `@mrg-keystone/sprig/keep`/conceptual "keep" — no package edits needed.
  - Sprig-side TODO (a)+(b) DONE; (c) CONFIRMED working via the smoke `deno check`.

- 2026-06-26 — sprig-side scaffold work (in progress): found `sprig init` (framework/cli.ts `init()`)
  scaffolds the OLD shape — a Danet host + `sprigUi` middleware that `app.listen()`s, NO keep backend,
  NO in-process client (violates all three goals) — and pins a STALE `SPRIG_RANGE = "^0.2.0"` while
  JSR latest is **0.12.7** (so the scaffold predates `serveSprig`; effectively broken). The repo's own
  `serve.ts` already uses the native `serveSprig` composition. Rewriting `sprig init` to match:
  serveSprig + a minimal keep backend (`@mrg-keystone/rune`) + `deno serve serve.ts`, pin `^0.12.0`.
- 2026-06-26 — **`sprig init` rewritten to native + VERIFIED.** `framework/cli.ts init()` now emits:
  `serve.ts` (`serveSprig({ keep: api, app: sprigApp, base: "/ui" })`), `bootstrap/mod.ts`
  (`await bootstrapServer("<name>", [], {})` — the keep backend, imported not listened), a `deno.json`
  with `@mrg-keystone/sprig@^0.12.0` + `@mrg-keystone/rune@^1` + `reflect-metadata@0.1.13` (EXACT — a range
  double-loads the Reflect polyfill and wipes decorator metadata) + `start: deno serve -A --unstable-kv
serve.ts`. Dropped `@danet/core`. **Also fixed a latent bug:** the shell was written to
  `bootstrap/template.html`, which the renderer NEVER discovers (it scans `src/` for a folder named
  `shell`) — pages rendered with no shell + no body CSS. Moved it to `src/shell/{template.html,styles.css}`.
  Kept base `/ui` (the `sprig dev` HMR task hardcodes `/ui` and silently drops `""`; base `""` is only
  viable for `deno serve`, used by `rune init`). Verified end-to-end on a freshly scaffolded app:
  `deno check serve.ts` clean vs published packages; the empty keep backend BOOTS (`api.backend.fetch`

  - `handler` present, in-process 404 works, clean `stop()`); `sprig build .` succeeds and `templates.json`
    now carries the `shell` selector + `app.css` carries the shell styles; `deno serve serve.ts` →
    `/ui`=200 (shell + page + client.js), `/`=404, `/docs`=200, `/api/*`=404.
    Skill docs aligned (repo + installed): `sprig:build` SKILL.md "Serving the app", `serving.md`,
    `INDEX.md` now lead with `serveSprig` + in-process; `sprigUi` demoted to "mount under an existing host".

  ### Still open / sprig-side follow-ups

  1. **`@mrg-keystone/sprig` version pin** lives in TWO scaffolders — rune `src/rune/entrypoints/init/mod.ts`
     (`SPRIG_IMPORTS`, `^0.12`) and sprig `framework/cli.ts` (`SPRIG_RANGE`, now `^0.12.0`). Bump BOTH
     when sprig moves to `0.13+`/`1.x`. (sprig's was stale at `^0.2.0` — fixed.)
  2. **Post-`2.0.0`-publish pin migration:** keep is staged at `2.0.0` but NOT yet published; the
     `@mrg-keystone/rune@^1` pins (rune `REQUIRED_IMPORTS`, examples, sprig `server/deno.json`) still
     resolve to `1.22.x`. AFTER `2.0.0` is on JSR, bump those to `@^2` (publish-before-pin). The breaking
     change (removed `embed`) does NOT affect sprig — sprig only needs `{backend,handler}`, unchanged.
  3. ~~Decide whether sprig's own `framework cli.ts init` should defer to `rune init` or stay no-backend.~~
     RESOLVED: `sprig init` now scaffolds the native serveSprig + a minimal (empty-module) keep backend,
     so a UI-first app is in-process-wired out of the box and grows endpoints by adding modules (or
     `rune sync`). `rune init` remains the spec-driven, full-app path. Both produce the same serveSprig
     runtime shape; they differ only in dev task (`sprig dev` HMR @ `/ui` vs `deno serve --watch` @ `/`).

- 2026-06-27 — **`spec/` relocation spun out to its own doc: [`coordinate.md`](./coordinate.md).**
  Decision: `spec/` is the shared contract and must resolve at the **git root** (sibling of
  `.git`) so a monorepo's frontend (sprig) + backend (rune) read/write ONE `spec/`. Shared rule:
  walk up to the nearest `.git` ancestor (project-dir fallback); **only `spec/` relocates** —
  generated code stays per-package. This **supersedes the flat-root assumption in Q3 above**
  (Q3 only covered the single-package case where `spec/` and `src/` share one root). **Sprig-side
  TODO (in coordinate.md):** add a `specRoot` walk-up helper; anchor `framework/.sprig/annotate.ts:151`
  on it via `framework/cli.ts:399`; reword the five skill docs ("project root" → "git root, with
  fallback"). **Rune side DONE (mostly no-op):** the engine already anchors on the spec path, so
  `resolveRoot` `spec-root.ts:22-33` + the LSP mirror `main.rs:52-62` ALREADY return the git root
  for a `spec/runes/` spec — unchanged; the only fix was the cwd-based runtime seam keep
  `fixturesDir()` `fixtures-store/mod.ts` (now walks to `.git`, prefers `<gitRoot>/spec/misc`; pure
  helper + 2 unit tests). lint's per-`deno.json` root stays; split-package output via `--root`.

- 2026-07-03 — **Fresh/Vite dead-code sweep (the 2026-06-26 cutover's stragglers). keep `3.1.0` →
  `4.0.0` (breaking export removal).** The `embed`-era purge missed four Fresh/Vite survivors; all
  had ZERO consumers in either repo (verified by grep across rune + sprig, tests excluded):
  - Deleted `keep/src/vite/dev-reconnect.ts` + the `./vite` package export — a **Vite HMR plugin for
    Fresh+Vite apps**. sprig reloads via `KEEP_DEV` + `assetsVersioner`, never Vite HMR.
  - Deleted `keep/src/foundation/domain/business/no-code-cache/` (`noCodeCache` + `NoCodeCache*`
    types) — a **Fresh middleware**; `serveSprig`/`serveAsset` own cache-control now (immutable vs
    `no-cache` by content-address). Removed from both export barrels.
  - Removed the `@deprecated` `SESSION_BEARER_HEADER` / `SESSION_BEARER_CONTEXT_KEY` consts
    (token-auth) — "kept only for import stability"; nothing imported them.
  - De-Freshed stale docstrings (bootstrap-server `handler`, emulator-ui, map-ui, swagger-builder,
    exercise-harness): "mounted under Fresh" → "under a host" / `serveSprig`/`sprigUi`.
  `withBasePath` stays (framework-agnostic, as decided 2026-06-26). Verified: keep `deno check` clean,
  token-auth + mount tests 46/0. **Pin note:** supersedes "still open #2" — keep is now staged at
  `4.0.0`; after publish, bump `@mrg-keystone/rune` pins to `@^4`. Still no impact on sprig (needs
  only `{backend,handler}`).
  - **RESOLVED (behavior, by design): `rune dev` stays backend-only.** `dev/mod.ts:232` spawns
    `deno run bootstrap/mod.ts` → `api.listen()` (backend + emulator + `/docs` live-reload via
    `KEEP_DEV`, NO sprig UI at `/`) — this is deliberate: `rune dev` is the spec→emulator loop. For the
    full composed app + UI, users run `rune init`'s scaffolded `deno task dev` (`deno serve --watch
    serve.ts` = serveSprig). Two intentional dev paths; not folding them. (User decision 2026-07-03.)

- 2026-07-04 — **reconcile: the ship-bot (`b48f112`, `infra-ship-mrg-keystone[bot]`) independently
  landed the Fresh/Vite sweep + keep `4.0.0` + the keep→rune ENGINE retarget while the above was
  in-flight.** So the two items above are IN `develop`, and the `@^4` pin note is moot for now: the
  engine now emits `@mrg-keystone/rune@^3` for ALL generated code (`REQUIRED_IMPORTS`, `renderMain`,
  the manifest/stubs/e2e emitters) — `@^3` resolves against the PUBLISHED `rune@3.1.0`; `keep/deno.json`
  is staged at `4.0.0` but unpublished, so pins stay `@^3` (correct publish-before-pin posture). This
  also **retires coms.md's BLOCKER** (package-name mismatch): generated backends no longer import the
  abandoned `@mrg-keystone/keep@1.22.0` — they import `@mrg-keystone/rune`, the same name sprig's
  scaffold + serve.ts + fixtures use. One framework, one name.

- 2026-07-04 — **`rune init` now DELEGATES the UI to the sprig CLI (branch
  `feat/rune-init-delegate-sprig-cli`).** sprig is CLI-compilation now, and rune's hand-rolled sprig
  scaffold had gone stale (pinned `@mrg-keystone/sprig@^0.12`, hand-written createRenderer `serve.ts`, **no
  build step** → islands never got a client bundle). Fix: `rune init` runs `sprig init <dir>` (sprig
  owns serve.ts + the src/ UI + the `sprig dev`/`sprig build` tasks + its own pins), then OVERLAYS the
  spec-driven keep backend — replaces the empty `bootstrap/mod.ts` with the registry-driven `renderMain`
  (its `api` export is what the sprig-written `serve.ts` imports; the `import.meta.main` listen keeps
  `rune dev` backend-only), adds the module registry + config + `spec/` layout, and merges rune's engine
  import map into sprig's `deno.json` additively (sprig's `@mrg-keystone/rune` pin preserved).
  **Corrects the line above:** the composed UI dev task is now `sprig dev` (via `deno task dev`), NOT
  `deno serve --watch`. Requires the sprig CLI installed (errors with `deno run -A jsr:@mrg-keystone/sprig/cli
  install` guidance; sprig can't run from `jsr:` — needs the on-disk `~/.sprig` runtime). The pure
  overlay is `overlayRuneBackend()`, unit-tested against a fixture sprig scaffold (no CLI/network).
  Verified end-to-end: `rune init` → `deno check serve.ts` clean → `sprig build .` emits
  `static/{client.js, isl.*.js, chunk-*.js, templates.json, app.css}` vs published
  `@mrg-keystone/sprig@0.20.2` + `@mrg-keystone/rune@3.1.0`; init tests 4/4. **Sprig-side note:** no change
  needed — this consumes `sprig init` + `sprig dev`/`sprig build` as-is.
