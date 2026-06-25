# Contract: sprig-app

> **Producer:** build · **Consumer:** audit · Pipeline: design → prototype → breakdown → build → audit

A **running sprig app** the `audit` stage can exercise live, hunt bugs in, and harden. sprig is a
Deno SSR framework with Angular-flavored HTML templates and selective island hydration — **not
Fresh/Preact, Next, or Angular.**

## Artifact
A buildable sprig project (see `sprig:build`):
- `src/` — `shell/` (the document layout, holds `<router-outlet>`), `pages/<name>/`,
  `components/<name>/`, `islands/<name>/`, optional `services/`, and `main.ts`
  (`defineRoutes` + `createRenderer` + `bootstrap`). A component is a **folder**
  (`template.html` + optional `logic.ts` + optional `styles.css`), **never a `.tsx`**.
- `serve.ts` — the host: `serveSprig({ keep, app, base: "/ui" })` folds the keep backend +
  the sprig UI into one `{ fetch }` handler and binds keep's in-process client to the `Backend`
  DI token. `deno.json` carries `dev` / `build` / `start` tasks.
- **Styles:** each component's own `styles.css` is **view-encapsulated** (scoped by folder path);
  document-level rules use `:global(...)` (usually in `shell/styles.css`). `sprig build` runs
  **Tailwind v4** over the component CSS + templates → one scoped, minified `static/app.css`.
- `user-stories.md` (one line per thing a user can do) + per-story Playwright tests; each
  component's `isolate/` cases green (`sprig isolate`).

## Shape (what `audit` can rely on)
- `sprig dev` (HMR, no Vite) serves it; `sprig build` then `sprig serve` (or
  `deno serve -A --unstable-kv serve.ts`) runs the production path.
- **Real data wired** through `resolve.ts` / `@Injectable` services and the in-process `Backend`
  (SSR-only); islands reach the backend over the token-gated `/api/*` network channel. Any
  unavoidable fixture is **labeled** (`live: boolean`) — not a console of 100% fake numbers.
- **sprig-native interaction:** static folders ship zero JS; an **island** (folder with a
  `logic.ts`) owns client state. **Server writes are optimistic by default** (snapshot → mutate →
  call → roll back) — **no whole-page island, nothing `location.reload()`-ing server state**.
  Correct HTTP status (a missing resource is a real 404 via `setResponseStatus`, not a 200 page).

## Invariants
- The app actually **builds and boots** — the prod path (`sprig build` → `sprig serve`), not just
  `sprig dev`.
- `user-stories.md` is the coverage map; each story has a browser test.
- A `StateService` carries a `static key` (class names are minified in prod).

## Validation
The prod build boots and serves; the suite runs green against a freshly-started server. The audit
records findings + fixes in `fixes.md`.
