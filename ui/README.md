# isolate ui/

The Fresh 2 preview app — the v0.4 persistent shell (sidebar navigator, iframe
stage, controls / console / tests dock). Scaffolded from the reference
implementation by lifting the de-stringified template the reference generator
(`reference/scaffold.ts`) emits, then wiring it to the keep `server/`.

Status: **runs** — `deno task dev` serves the shell at `http://localhost:8321/`
(verified: `GET /` → 200, renders `<title>isolate</title>` + the shell markup).

## Layout

```
main.ts                     Fresh App: staticFiles() + fsRoutes()
deno.json                   Fresh 2 + tailwind + rxjs (from @fresh/init)
vite.config.ts              preact DEDUPE (load-bearing) + isolate/ ignore + fs.allow
client.ts, utils.ts         Fresh boilerplate
assets/styles.css           the terracotta/paper design system (STYLES + SHELL_STYLES)
controls.tsx                the live controls panel + event log  (was CONTROLS_LIB)
gallery.tsx                 the flat gallery fallback            (was GALLERY_LIB)
manifest.ts                 STUB — generated per host project by the scaffold step
routes/_app.tsx             document shell                       (was APP_SHELL)
routes/index.tsx            / → <Shell/>
routes/(_islands)/Shell.tsx the v0.4 persistent shell           (was SHELL_LIB)
routes/(_islands)/RunTests.tsx run-button island                (was RUN_ISLAND)
routes/api/run.ts           proxies the test runner to the keep server
static/                     favicon, logo
```

The big UI pieces (`controls.tsx` 494, `Shell.tsx` 537, `styles.css` 407) are a
**verbatim port** of the reference's string constants — per the spec's
"port verbatim, then decompose". They type-check loosely (they were authored as
untyped strings and only ever run through Vite, which transpiles without
type-checking — the reference's own generated copies have the same `deno check`
warnings). Typing/decomposing them into clean components is the follow-up pass.
The wiring files (`main.ts`, `routes/api/run.ts`, `manifest.ts`) type-check clean.

## Template vs materialized app

This folder is the **static template**. The scaffold step
(`server/core/scaffold`) materializes it into `~/isolate/<project>` by adding the
per-project parts: the real `manifest.ts`, one preview island per component, one
route per case, and symlinks of the host's `components/`·`islands/`·`pages/`.
Standalone (with the stub `manifest.ts`) the shell renders empty.

## Wiring keep

The keep `server/` owns discovery / manifest / test execution. Two modes:

- **Now (this scaffold): HTTP proxy.** `routes/api/run.ts` forwards the run
  button to the keep server over HTTP (`ISOLATE_KEEP_URL`, default
  `http://localhost:3000`), mapping `{ tests }` → `{ files }` and keep's
  `{ testResults }` → the islands' `{ results }`. keep trusts localhost, so no
  token. Run both: `deno run -A ../server/bootstrap/mod.ts` and `deno task dev`.

- **Target (the spec's design): in-process embed.** A deno workspace
  (root `deno.json` listing `./server` + `./ui`) lets `routes/api/run.ts`
  `import { api } from "../../../server/bootstrap/mod.ts"` and call
  `api.backend.fetch("/http/post-test-run", …)` in-process, and `main.ts` can
  mount `api.handler` (forwarding conn info) for the `/docs` cake.
  **Unverified risk:** keep's danet decorators + `reflect-metadata` under a Fresh
  *production* Vite build (`deno serve _fresh/server.js`) — spike this before
  committing to the embed (see `spec/server/embedding.md`, OPEN item).

## Run

```sh
deno install          # populate node_modules (nodeModulesDir: manual)
deno task dev         # vite → http://localhost:8321/
```
