---
name: "isolate:build"
description: >-
  Expert guidance for building web apps with Fresh 2 — the Deno + Preact full-stack
  framework (Vite builds, server-rendered, islands). Use this whenever the user is
  scaffolding, building, or modifying a Deno Fresh project:
  adding routes/pages, islands, signals, middleware, forms, API endpoints, layouts,
  error pages, sessions/auth, static assets, or deploying; or when working in a repo
  with Fresh markers (a deno.json importing "fresh"/@fresh, a routes/ + islands/
  layout, main.ts with `new App()`, or vite.config.ts using @fresh/plugin-vite).
  Also use when migrating a Fresh 1 project to Fresh 2. Fresh 2 differs sharply from
  Fresh 1 and from React/Next.js, so prefer this skill over memory of older Fresh or
  other frameworks — the main source of bugs here. Do NOT use for other frameworks that
  share concepts (Next.js, Astro, Vue, SvelteKit, Express), plain Deno scripts with no
  web server, generic Preact/React outside Fresh, conceptual framework comparisons, or
  unrelated uses of "fresh" (a git branch, produce).
---

# Building Deno Fresh 2 apps

> **Pipeline stage — build.** Consumes `ui-breakdown` (`../interfaces/ui-breakdown.md`);
> produces the `fresh-app` contract (`../interfaces/fresh-app.md`), consumed by `audit`.
> Full chain: design → prototype → breakdown → build → audit.

Fresh 2 is a Deno + Preact full-stack framework. It server-renders every page to
HTML and ships JavaScript **only** for "islands" — the components you explicitly
mark as interactive. That makes most pages ship zero JS. It's a great fit for SSR
sites, CRUD apps, and APIs; it is not an SPA framework.

This skill bundles a condensed copy of the Fresh 2 docs under `references/`. Read
the relevant leaf doc before writing code for an area you're unsure about — the
[Decision matrix](#decision-matrix--load-the-right-reference) routes you, and
`references/INDEX.md` is the full table of contents. Each leaf has a canonical
`https://fresh.deno.dev/docs/...` URL at the top; fetch it when the condensed note
isn't enough.

## You are writing Fresh 2, not Fresh 1 — and not Next.js

This is the single biggest source of bugs. Pretrained instincts skew toward Fresh 1,
Next.js, or generic Preact, and those patterns silently break in Fresh 2. Anchor on
these differences before writing anything:

- **No `dev.ts`, no `fresh.gen.ts`, no `fresh.config.ts`, no manifest.** Builds run
  through **Vite** (`vite.config.ts` + `@fresh/plugin-vite`). If you find yourself
  reaching for a manifest or `dev.ts`, stop — that's Fresh 1.
- **Handlers and middleware take a single `ctx`**, not `(req, ctx)`. Read the
  request via `ctx.req`. Pages are `(props)`, not `(req, ctx)`.
- **One unified `routes/_error.tsx`** handles 404 and 500 — there is no `_404.tsx`
  or `_500.tsx`. Throw `new HttpError(404)` instead of `ctx.renderNotFound()`.
- **Handlers return data via `page({...})`, never `ctx.render(data)`.** In Fresh 2
  `ctx.render` takes JSX; passing it a data object crashes at runtime with
  `Non-JSX element passed to ctx.render()`. Wrap data with `page({...})` or return a
  raw `Response`.
- **Type everything through `define`** (`createDefine<State>()`), not the old
  `AppContext`/`RouteContext`/`LayoutContext` types — those collapsed into one
  `Context` type.
- **Production runs the built server**: `deno serve -A _fresh/server.js` after
  `deno task build`. There is no on-demand build; the build step is mandatory in
  every deploy pipeline.

If a project still has `dev.ts` / `fresh.gen.ts`, it's a Fresh 1 app — run the
auto-migrator (`deno run -Ar jsr:@fresh/update`) and read `references/migration-guide.md`.

## Bootstrapping a project

**Always scaffold greenfield projects with the official initializer — do not hand-write
`deno.json`.** It runs non-interactively with a directory arg and flags:

```
deno run -Ar jsr:@fresh/init ./my-app --tailwind --vscode
```

This matters more than it looks: the initializer pins a set of **mutually-compatible
versions** and writes a `deno.lock`. Hand-writing `deno.json` with guessed versions is
the single biggest cause of an app that won't boot — e.g. pinning `vite@^6` against a
current Fresh (2.3+) crashes during SSR with
`ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'npm'`. Fresh 2.3+ needs **Vite 7**,
**`@preact/signals@^2`**, **`preact@^10.29+`**, and the deno.json must set
**`"nodeModulesDir"`** (the scaffold uses `"manual"` + a lockfile) or the Vite dev
server won't start at all. When in doubt, scaffold a throwaway project and copy its
`deno.json`/`vite.config.ts` rather than inventing version numbers.

The files below show the **shape** of a Fresh 2 project so you can read and edit one
confidently — but let the initializer generate `deno.json` and the lockfile.

`main.ts` — server entry. The `App` builder is **order-sensitive**: middleware
registered after a route does not apply to it, so register cross-cutting middleware
(like `staticFiles()`) first and `.fsRoutes()` last.

```ts
import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";

export const app = new App<State>()
  .use(staticFiles())
  .fsRoutes();
```

`utils.ts` — your typed `define` helpers + the app-wide `State`. Import `define`
from here in every route/middleware/layout file so `ctx.state` and `props.data`
autocomplete.

```ts
import { createDefine } from "fresh";

export interface State {
  // per-request state set by middleware, e.g. user?: { id: string };
}

export const define = createDefine<State>();
```

`vite.config.ts` — replaces Fresh 1's `dev.ts`. Use **standard Fresh HMR** (the default —
no custom reload plugin), keep `cache-control: no-store` so reloads aren't served stale, and
read changing data at request time. (Why standard HMR, and why **not** an `always-full-reload`
plugin — it breaks Safari — is in [The dev loop](#the-dev-loop--testing-each-feature) and
`references/playwright-and-dev-loop.md`.)

```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  server: { headers: { "cache-control": "no-store" } },
  plugins: [fresh()],
});
```

`client.ts` — browser entry; import the **global** CSS here (design tokens, fonts,
resets, keyframes — the things every page shares):

```ts
import "./assets/styles.css";
```

A plain `.css` file — imported here or co-located next to a component — is **global**: its
selectors apply app-wide and collide by class name. To scope styles to one component, use a
co-located **CSS Module** (`*.module.css`), which Vite hashes so they can't leak — see
`references/concepts/css-modules.md`.

**Project layout** (and what each folder is for):

| Path | Purpose |
|---|---|
| `routes/` | Filesystem-routed pages + API endpoints |
| `routes/_app.tsx` | Outer `<html>`/`<head>`/`<body>` shell (one per app) |
| `routes/_error.tsx` | Unified 404/500 page |
| `islands/` | Interactive components, hydrated client-side |
| `components/` | Server-only components (ship no JS) |
| `static/` | Assets referenced by URL only (favicon, robots.txt) |
| `assets/` | Assets *imported in code* (CSS, etc.) — Vite hashes these |
| `utils.ts` | `createDefine<State>()` + shared `State` |
| `main.ts` / `client.ts` / `vite.config.ts` / `deno.json` | Entries + config |

**Tasks:** dev = `deno task dev` (runs `vite`); build = `vite build`; run prod =
`deno serve -A _fresh/server.js`. **If the app consumes a backend that reads env at load**
(e.g. an embedded keep/danet service picking its datastore from env), add `--env-file=…`
to the **dev and start** tasks — bare `vite` loads no env into the SSR process, so the
backend silently falls back to its default store (`references/rune-backend.md`).

Don't put imported assets (CSS, icons used as JS imports) in `static/` — they'll be
duplicated in the build. `static/` is for URL-only files; `assets/` is for imports.

## The patterns you'll reach for most

Each pattern below is the minimal correct shape. Open the linked reference for depth,
gotchas, and variations.

**A page with data** (`references/concepts/data-fetching.md`, `advanced/define.md`).
The handler's return flows into `props.data`; `define.page<typeof handler>` types it:

```tsx
import { define } from "../utils.ts";
import { page } from "fresh";

export const handler = define.handlers({
  async GET(ctx) {
    const project = await db.projects.find(ctx.params.id);
    return page({ project });
  },
});

export default define.page<typeof handler>(({ data }) => <h1>{data.project.name}</h1>);
```

Returning from `GET` without `page()` or a `Response` renders nothing — a common
silent failure. If this app *fronts a separate service* rather than owning its data, that
`db.projects.find` call is instead an in-process backend `fetch` (see [Step 0](#step-0--where-does-the-data-come-from)
and `references/rune-backend.md`) — don't invent a local store for a backend that exists.

**File routing** (`references/concepts/file-routing.md`). `routes/blog/[slug].tsx`
→ `/blog/:slug` (read via `ctx.params.slug`); `[...path]` is catch-all; `[[opt]]` is
optional. `(group)/` folders scope a `_layout.tsx`/`_middleware.ts` without appearing
in the URL. Static routes beat dynamic ones; among dynamic, registration order wins.

**An island** (`references/concepts/islands.md`, `concepts/signals.md`). Put it in
`islands/` (or a `(_islands)/` folder), default-export it, and keep state in signals:

```tsx
import { useSignal } from "@preact/signals";

export default function Counter() {
  const count = useSignal(0);
  return <button onClick={() => count.value++}>{count}</button>;
}
```

Props crossing into an island must be **serializable** — never pass functions or
class instances. Event handlers live *inside* the island. Prefer signals over
`useState`. To **share** state across islands, create one signal **in a server parent
(per request)** and pass it as a prop — *not* a module-level singleton, which leaks across
requests when read during SSR (`references/examples/sharing-state-between-islands.md`).

**Middleware** (`references/concepts/middleware.md`). A function `(ctx) => Response`;
`await ctx.next()` to continue. Drop `_middleware.ts` in any `routes/` dir to scope
it to that subtree. Forgetting to `await ctx.next()` silently breaks everything
downstream. Store per-request data in `ctx.state`, never module-level variables.

**A form** (`references/advanced/forms.md`). Plain `<form method="post">` → POST
handler; read `await ctx.req.formData()`; redirect with **303** after success so a
reload doesn't resubmit. Validate server-side; add CSRF in production
(`references/plugins/csrf.md`).

**An API route** (`references/examples/api-routes.md`). A file under `routes/api/`
that exports only `handlers` (no default page) and returns `Response.json(...)`.

**Error handling** (`references/advanced/error-handling.md`). Throw
`new HttpError(status)` to short-circuit; render `routes/_error.tsx` based on
`props.error instanceof HttpError`. This keeps the **HTTP status correct** — a
missing record returns a real 404. Rendering a "not found" page some other way (e.g. a
leftover Fresh 1 `_404.tsx`, or a normal page with 200) produces a *soft 404*: looks
right to humans, lies to crawlers. Always go through `HttpError` + `_error.tsx`.

## Step 0 — where does the data come from?

Before building any UI, answer one question: **does this app own its data, or front a
separate backend?** It sets the build order, and getting it wrong is expensive.

- **Owns its data** (in-app store, Deno KV, local files) → the patterns above are the
  whole story. Proceed to the UI build.
- **Fronts a real service** (a keep/danet API, a rune backend, any HTTP backend) →
  **wire the data spine first.** Identify the endpoints, build the typed client /
  in-process adapter, and make page handlers read *real* data from request one. Build the
  UI *after* the data is real.

The failure this prevents: building the entire UI against fixtures, fully styling it,
then wiring the server last — ending with a polished production-looking console showing
100% fake numbers while a fully-working backend sits unused beside it. When a Fresh app's
job is to be a frontend for a real service, **"shows real data" outranks "looks
finished."** Fixtures are legitimate only for endpoints the backend genuinely *lacks*,
and they must be **labeled** (a `live: boolean` the page surfaces) so "real vs placeholder"
is never invisible. The wiring mechanics, the live-first/fixture-fallback adapter, and the
setup gotchas are all in `references/rune-backend.md` — read it before wiring.

## Build the UI from the spec — don't design it

This skill is **pure implementation.** The aesthetic is already decided upstream: the
**breakdown** stage (its contract: `../interfaces/ui-breakdown.md`) hands you `design-tokens.md`,
per-component specs (anatomy, props, states, *captured* motion, a11y), `isolate/` proposals, and
screenshots. Your job is to **materialize that spec faithfully** — **don't pick fonts, palettes,
layouts, or motion here**; those are inputs, not decisions. (What you produce — a runnable Fresh
app — is the `fresh-app` contract, `../interfaces/fresh-app.md`.)

- **Tokens → Tailwind 4 `@theme`, in the global sheet only.** Transcribe `design-tokens.md`
  (palette, type scale, spacing, radii, shadows, easing) into the CSS-first `@theme` block of
  custom properties in `client.ts` / `assets/styles.css`, every theme variant included. The
  global sheet holds **only** that — `@theme` tokens, `@font-face`, resets, shared keyframes —
  never component styling.
- **Style with Tailwind utilities first; custom CSS is the exception.** The `@theme` tokens are
  exposed as Tailwind utilities, so build each component with utility classes and **don't
  hand-write CSS for anything Tailwind can express.** When a component genuinely needs custom CSS
  (something utilities can't do — a component-specific keyframe, an intricate selector), it lives
  in **that component's own co-located `ComponentName.module.css`**: one CSS file per component,
  scoped by the module — **never** the global sheet, **never** a shared component stylesheet
  (`references/concepts/css-modules.md`).
- **Each component → its spec.** Build the exact anatomy, props, and states listed; implement
  motion **as captured** (the spec carries real keyframes/easing plus jank fixes — reproduce
  them, don't reinvent); render icons via `references/icons-lucide.md`.
- **Gate on the spec's checks.** Diff each rendered case against its `screenshots/` and hold
  `isolate test` green before anything builds on it — the bottom-up loop is in
  [Rebuild from a ui-breakdown](#rebuild-from-a-ui-breakdown) and
  `references/rebuild-from-ui-breakdown.md`.

No spec, just a mock? **Run the breakdown skill first** — decomposition and design happen
there; implementation happens here. (If the app also fronts a real backend, do
[Step 0](#step-0--where-does-the-data-come-from) first — real data before UI.)

## The dev loop & testing each feature

**Seeing your edits.** With **standard Fresh HMR** (the default) plus reading changing data
at request time (`Deno.readTextFile`, not `import … with {type:"json"}`), edits to code *and*
data auto-refresh the open tab — no manual reload, no new-tab dance. Two things still need a
server **restart**: editing the dev config / server entry (`vite.config.ts`/`main.ts`/
`deno.json`/`.env`), and **adding or removing an island/route file** (the island registry is
built from a one-shot startup scan and drifts on a structural add → a bare
`fresh-island::Name.tsx` specifier kills hydration for the whole page). *Editing* an existing
island is fine. **Do not** add an `always-full-reload` plugin to "force" reloads — it makes
Safari serve edited islands stale. The full staleness rules, the Safari detail, and the
optional `devReconnect()` plugin are in `references/playwright-and-dev-loop.md`.

**Tracking + testing features.** Maintain a **`user-stories.md`** at the project root: one
line per thing a user can actually *do*. Add a bullet the moment you ship the feature, and
in the same change add a **Playwright test** that drives the *real running app* and asserts
the user-visible outcome — SSR content, island hydration, form POST → redirect, auth
bounces, and **status codes off the navigation response** (a 404 page that returns 200 is a
bug the DOM can't reveal). Run the suite against a **freshly-started** server, not the
long-lived dev server you've been editing (a stale module graph can make tests lie). Patterns
and an adaptable test file are in `references/playwright-and-dev-loop.md`.

## Preview & test a component in isolation (`isolate`)

This skill bundles **`isolate`** — a small CLI that gives any component, island, or page a
standalone, Storybook-style preview with a live typed controls panel, an event log, and a
one-click Playwright runner. Reach for it when you're building or debugging *one* component
and don't want to wire it into a full page. It's published on JSR, so it runs anywhere Deno
does. (This skill itself ships inside that package: `deno run -A jsr:@mrg-keystone/isolate
update` reinstalls the latest skill at `~/.claude/skills` and refreshes the CLI.)

Annotate a component with a tiny `isolate/` folder (a `fixture.json` declaring controls + a
`cases/<name>/<name>.json` per scenario), then:

```sh
deno run -A jsr:@mrg-keystone/isolate list --root .   # discovered cases + routes
deno run -A jsr:@mrg-keystone/isolate dev  --root .   # open the preview gallery
deno run -A jsr:@mrg-keystone/isolate test --root .   # run every case's tests
```

It scaffolds a real Fresh app under `~/isolate/<root>`, symlinks your `components/`·
`islands/`·`pages/` in, and serves one preview route per case. **Read `references/isolate.md`**
before authoring an `isolate/` folder — `fixture.json`/case JSON have non-obvious rules
(route built from `category`/`folder`, the component file must be `PascalCase(folder).tsx`,
`signal:true` for island props, editing a control remounts the stage). It complements
`playwright-and-dev-loop.md`: that drives whole user journeys; `isolate` exercises a single
component's surface.

## Rebuild from a ui-breakdown

When the input is a `ui-breakdown/` (from the **breakdown** skill), rebuild it
**mechanically**: build bottom-up (design tokens → shared components → page-local components
→ page compositions), and gate each component on **both** a screenshot diff and `isolate
test` green before anything builds on it. The full loop — scaffold, drop in the `isolate/`
proposal, lift the Events section into tests, hold the gate — is in
`references/rebuild-from-ui-breakdown.md`.

## Wire to a rune/keep backend — and propose what's missing

When the build fronts a rune/keep backend, build takes a **second input** beside the
`ui-breakdown/`: the **rune server dir** (`.rune` files + their generated keep backend).
Point the skill at both; absent explicit paths, auto-detect a sibling `ui-breakdown/` and
the nearest dir holding `*.rune` + `bootstrap/`. The headline moves: **type loaders off the
real generated DTOs** (don't redeclare them), **call the backend in-process**
(`api.backend.fetch(...)`, no listen/no token), and **let the rune DTO win** over the
fixture's UI-shaped data (surface every mismatch loudly).

The last step of the build is a **gap audit**: a backend is often thinner than the UI, so
diff UI-needed operations against the rune endpoint catalog and, for each gap, write a
**suggested `.rune`** to `<git-root>/spec/suggested/`, stub the call so the app still runs,
and index it — **review-only, never `rune sync` it yourself.** Consuming a separate backend
in-process also has a cluster of setup traps (Deno workspace + root config, decorators under
Vite, literal dynamic import + `deno check`, env via `--env-file`, the production-build
crash). **All of this — the catalog, in-process embedding, the gap-audit skeleton, and the
setup gotchas — is in `references/rune-backend.md`; read it before wiring.**

## Decision matrix — load the right reference

Before working in an unfamiliar area, read the matching `references/` file(s). These are the
core routes; the **full task→file matrix and complete table of contents are in
`references/INDEX.md`**.

| Task | Read |
|---|---|
| Bootstrap a project | `quickstart.md`, `concepts/architecture.md`, `concepts/file-routing.md` |
| Add a page / route | `concepts/routing.md`, `concepts/file-routing.md`, `concepts/data-fetching.md` |
| Add interactivity | `concepts/islands.md`, `concepts/signals.md`, `advanced/serialization.md` |
| Handle a form | `advanced/forms.md`, `advanced/define.md` |
| Implement the spec's tokens / styles / components | `rebuild-from-ui-breakdown.md`, `concepts/css-modules.md`, `icons-lucide.md` |
| Error / 404 / 500 pages | `advanced/error-handling.md` |
| Middleware / auth / sessions | `concepts/middleware.md`, `examples/session-management.md` |
| Deploying | `deployment/{deno-deploy,deno-compile,docker,cloudflare-workers}.md` |
| Wire to a rune/keep backend | `rune-backend.md` |
| Preview / test one component | `isolate.md`; whole journeys → `playwright-and-dev-loop.md` |
| Coming from Fresh 1 | `migration-guide.md` first |
| Stuck / weird error | `advanced/troubleshooting.md`, `advanced/api-reference.md` |

## Top gotchas (the ones that bite repeatedly)

Quick index — each points at where the full story lives; don't re-derive these.

- **Function props to islands fail.** Serialization can't transfer code — move the handler
  inside the island. (`advanced/serialization.md`)
- **Client-side env needs the `FRESH_PUBLIC_` prefix** and a *literal*
  `Deno.env.get("FRESH_PUBLIC_FOO")` so Vite inlines it; never put secrets behind that prefix
  (they ship to the browser). (`advanced/environment-variables.md`)
- **Dev server won't start / `ERR_UNSUPPORTED_ESM_URL_SCHEME … protocol 'npm'`** → version
  drift or a missing `nodeModulesDir`. Use the scaffold's pinned versions — that's why you
  scaffold rather than hand-write `deno.json`. (see *Bootstrapping*)
- **Deploy fails to start** almost always means the build didn't run or the entry is wrong:
  `deno task build`, then serve `_fresh/server.js` (not `main.ts`).
- **App builder order matters.** Register `/posts/featured` before `/posts/:id`, and
  middleware before the routes it should wrap.
- **Use `<Head>` from `fresh/runtime`** for per-page title/meta — last render wins.
  (`advanced/head.md`)
- **When unsure an export/signature exists, check `advanced/api-reference.md`** rather than
  guessing — guesses tend to reconstruct Fresh 1.
- **Actually run it before declaring done — including the production build.** Several
  mistakes (the `ctx.render(data)` crash, soft 404s, version drift) surface only at *request*
  time, not at type-check. And `deno task dev` passing proves nothing about production: the
  build runs a different transform and bundles any consumed backend. Run `deno task build` →
  `deno serve -A _fresh/server.js` → hit a real endpoint. (`rune-backend.md`)
- **Dev-loop staleness.** Statically-imported JSON goes stale until restart (read changing
  data at request time); adding an island/route needs a restart; never add an
  `always-full-reload` plugin (breaks Safari). (`playwright-and-dev-loop.md`)
- **Preact/JSX pasted from HTML.** Keep `class` (not `className`); inline `onclick="…()"`
  strings are dead in JSX — use a real island `onClick`, or a CSS-only pattern for
  interactivity the server can re-render.
- **Don't gate above-the-fold content on scroll-driven reveals** — when implementing a
  captured scroll animation, a `view()` reveal starting at `opacity:0` leaves the hero
  invisible where the scroll timeline doesn't run. Animate above the fold with a load-time
  entrance instead.
