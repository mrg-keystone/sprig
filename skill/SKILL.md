---
name: deno-fresh2
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

Fresh 2 is a Deno + Preact full-stack framework. It server-renders every page to
HTML and ships JavaScript **only** for "islands" — the components you explicitly
mark as interactive. That makes most pages ship zero JS. It's a great fit for SSR
sites, CRUD apps, and APIs; it is not an SPA framework.

This skill bundles a condensed copy of the Fresh 2 docs under `references/`. Read
the relevant leaf doc before writing code for an area you're unsure about — the
[Decision matrix](#decision-matrix--load-the-right-reference) below routes you. Each
leaf has a canonical `https://fresh.deno.dev/docs/...` URL at the top; fetch it when
the condensed note isn't enough.

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

`vite.config.ts` — replaces Fresh 1's `dev.ts`. Include the **always-full-reload** dev
plugin below: it makes an already-open browser tab refresh itself on every save, so you
never have to manually reload or open a new tab to see changes (see "The dev loop" below
for why this is needed). Pair it with reading changing data at request time.

```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

// Dev only: force the open tab to reload on every change. Trades partial-HMR (islands
// keep state) for reliability — you never see a stale page or reach for a new tab.
const alwaysFullReload = {
  name: "always-full-reload",
  handleHotUpdate({ server }) {
    server.ws.send({ type: "full-reload", path: "*" });
    return [];
  },
};

export default defineConfig({
  server: { headers: { "cache-control": "no-store" } },
  plugins: [fresh(), alwaysFullReload],
});
```

`client.ts` — browser entry; import global CSS here:

```ts
import "./assets/styles.css";
```

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
`deno serve -A _fresh/server.js`.

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
silent failure.

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
`useState`; module-level `signal()` shared as a prop keeps multiple islands in sync.

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

## Make it look good — and "good" means world-class

Every visible surface — `_app.tsx`, layouts, pages, components, islands, CSS — must
look like the work of a senior designer-developer with 20 years of taste: someone who
sweats typography, spatial rhythm, and motion, and understands UX. **Treat "plain" as
a failure.** "Clean and minimal" is *not* a license to be bland — a tidy system-font
page on a flat background is exactly the generic AI output we're avoiding. The bar is:
if this could be mistaken for a default template or an untouched starter, it isn't done.

Before writing any UI, **read `references/frontend-design.md`** and commit to a specific,
named aesthetic concept. Then deliver all four of these — they are non-negotiable:

- **Typography that carries the design.** Load a distinctive display face *and* a refined
  body face (Google Fonts via `<link>` in `_app.tsx`/`<Head>`, or self-hosted in
  `static/`). Build a real type scale — oversized display headings, deliberate
  line-height, measure, and letter-spacing. Type is the cheapest path to world-class;
  push it hard. Never ship the system font stack as the final look.
- **A motion layer, not a static page.** Choreograph a page-load entrance (staggered
  reveals via `@keyframes` + `animation-delay`), add hover/focus micro-interactions with
  real easing, and animate cross-page navigation with Fresh's **View Transitions**
  (`references/advanced/view-transitions.md`). Prefer scroll-driven and CSS-only
  animation. Motion is expected, not a bonus.
- **Depth and atmosphere.** No flat single-color voids — layer gradients/mesh, subtle
  grain/texture, considered shadows, decorative rules. Commit the palette to CSS custom
  properties.
- **A signature moment.** One memorable, intentional detail per screen that a great dev
  would be proud to ship.

Deliver this through **CSS** (pages ship zero JS) plus View Transitions for navigation,
and reserve islands for genuinely interactive flourishes. Put the global system — fonts,
palette variables, base type, keyframes — in `_app.tsx` and the CSS imported via
`client.ts` so every page inherits it. Avoid generic fonts (Inter/Roboto/Arial/system)
and clichés (purple-on-white gradients). Utilitarian prompts ("add a form", "add a
toggle") are *not* permission to be plain — hold the same bar everywhere.

## The dev loop — seeing your changes without the new-tab dance

A plain browser reload sometimes won't show your edit in Fresh 2 dev, for three reasons:
the **dev server restarted** (you edited `vite.config.ts`/`main.ts`/`deno.json`/`.env` —
inherent to any tooling), a **statically-imported JSON/data file** is cached server-side
(stale for *every* request, reload and new tab alike, until restart), or a **dead HMR
socket / stale module cache** (no auto-reload fires). Opening a fresh tab only seems to
help because it dodges these — usually a restart happened in between.

Two settings make routine editing always reflect on save:

1. The **always-full-reload** plugin in `vite.config.ts` (see Bootstrapping) → the open
   tab reloads itself on every change, killing the dead-socket/stale-cache case.
2. **Read changing data at request time** — `Deno.readTextFile(new URL("../data/x.json",
   import.meta.url))` in a handler/loader, not `import … with {type:"json"}` — so the
   reload actually serves fresh data.

With both, edits to **code and data auto-refresh the open tab** — no manual reload, no new
tab. Only editing the dev config or server entry still needs the server to restart (the
tab reconnects once it's back). Full details + the Playwright testing angle are in
`references/playwright-and-dev-loop.md`.

## Track features as user stories — and Playwright-test each one

As you build, maintain a **`user-stories.md`** at the project root: a running bulleted
list, one line per thing a user can actually *do* in the app. Add a bullet the moment you
ship the feature — this file is the living spec of what the app does.

```md
# User stories
- Visit /blog and see posts listed newest-first
- Open /blog/:slug and read the full post
- Request an unknown /blog/:slug → 404 page AND HTTP 404 (not a soft 200)
- Click the header dark-mode toggle → the footer label flips instantly
- Submit the contact form with a valid email → land on /thanks (303)
- Visit /admin logged out → redirected to /login (302)
```

Every story gets a **Playwright test** that drives the *real running app* in a browser and
asserts the user-visible outcome — no mocks or stubs. Test what Fresh actually does:
SSR content, island hydration (click/type and see the DOM react), form POST → redirect,
auth bounces, and **status codes off the navigation response** (a 404 page that returns
200 is a bug the DOM can't reveal). Keep them in lockstep: a new feature means a new
bullet **and** a new test in the same change.

Run the suite against a **freshly-started server**, not the long-lived dev server you've
been editing — Fresh/Vite keeps a module graph in memory and some edits (notably
statically-imported JSON, and config files) are not invalidated, so a stale server can
make tests lie. Start a clean `deno task dev` for the run (or test the build), and read
changing data at request time (`Deno.readTextFile`) rather than `import … with {type:"json"}`
so edits show up without a restart.

Patterns, an adaptable test file, and the full dev-loop staleness rules are in
`references/playwright-and-dev-loop.md`.

## Preview & test a component in isolation (`isolate`)

This skill bundles **`isolate`** — a small CLI that gives any component, island, or
page a standalone, Storybook-style preview with a live typed controls panel, an event
log, and a one-click Playwright runner. Reach for it when you're building or debugging
*one* component and don't want to wire it into a full page to see it react. It is
published on JSR as `@mrg-keystone/isolate`, so it runs anywhere Deno does — no
install, no local checkout needed. This skill itself ships inside that package:
`deno run -A jsr:@mrg-keystone/isolate update` reinstalls the latest skill at
`~/.claude/skills` and refreshes the global CLI.

You annotate a component with a tiny `isolate/` folder (one `fixture.json` declaring
controls + a `cases/<name>/<name>.json` per scenario), then:

```sh
deno run -A jsr:@mrg-keystone/isolate list --root .   # discovered cases + routes
deno run -A jsr:@mrg-keystone/isolate dev  --root .   # open the preview gallery
deno run -A jsr:@mrg-keystone/isolate test --root .   # run every case's tests
```

It scaffolds a real Fresh app under `~/isolate/<root>`, symlinks your
`components/`·`islands/`·`pages/` in, and serves one preview route per case. Cases can
edit props/signals live, mock or stub sub-components, and assert on the **events** a
component emits via the `capture(page)` test bridge. **Read `references/isolate.md`**
before authoring an `isolate/` folder — `fixture.json`/case JSON have non-obvious rules
(route is built from `category`/`folder`, not the path; the component file must be
`PascalCase(folder).tsx`; `signal:true` for island props; editing a control remounts
the stage). It complements `playwright-and-dev-loop.md`: that drives whole user
journeys; `isolate` exercises a single component's surface.

## Decision matrix — load the right reference

Before working in an unfamiliar area, read the matching `references/` file(s):

| Task | Read |
|---|---|
| Bootstrap a project | `quickstart.md`, `concepts/architecture.md`, `concepts/file-routing.md` |
| Add a page / route | `concepts/routing.md`, `concepts/file-routing.md`, `concepts/data-fetching.md` |
| Add interactivity | `concepts/islands.md`, `concepts/signals.md`, `advanced/serialization.md` |
| Style / design the UI (any visible surface) | `frontend-design.md` |
| Handle a form | `advanced/forms.md`, `concepts/data-fetching.md`, `advanced/define.md` |
| Middleware / auth / sessions | `concepts/middleware.md`, `concepts/context.md`, `examples/session-management.md` |
| Layouts / nested layouts | `concepts/layouts.md`, `advanced/layouts.md`, `advanced/app-wrapper.md` |
| Error / 404 / 500 pages | `advanced/error-handling.md` |
| `<head>` / SEO / meta | `advanced/head.md` |
| Env vars | `advanced/environment-variables.md` |
| No-reload nav / partial updates | `advanced/partials.md`, `advanced/view-transitions.md` |
| WebSockets | `advanced/websockets.md` |
| Static assets | `concepts/static-files.md` |
| Configure Vite | `advanced/vite.md` |
| Tracing / metrics | `advanced/opentelemetry.md` |
| Deploying | `deployment/{deno-deploy,deno-compile,docker,cloudflare-workers}.md` |
| Security headers (CSP/CSRF/CORS/IP) | `plugins/{csp,csrf,cors,ip-filter,trailing-slashes}.md` |
| Writing tests (server-side, fast) | `testing.md` |
| User stories + browser/e2e tests, dev-loop staleness | `playwright-and-dev-loop.md` |
| Preview / test one component, island, or page in isolation | `isolate.md` |
| Coming from Fresh 1 | `migration-guide.md` first |
| Stuck / weird error | `advanced/troubleshooting.md`, `advanced/api-reference.md` |
| Recipes (redirects, proxy, streaming, content negotiation, cookies) | `examples/common-patterns.md` |

`references/INDEX.md` is the full table of contents; `references/advanced/api-reference.md`
lists every public export from `"fresh"` and `"fresh/runtime"`.

## Top gotchas (the ones that bite repeatedly)

- **Function props to islands fail.** Serialization can't transfer code. Move the
  handler inside the island. (`references/advanced/serialization.md`)
- **Client-side env vars need the `FRESH_PUBLIC_` prefix** and a *literal*
  `Deno.env.get("FRESH_PUBLIC_FOO")` so Vite can inline it. Anything else stays
  `undefined` in islands — and never put secrets behind that prefix; they ship to
  the browser. (`references/advanced/environment-variables.md`)
- **Dev server won't start / `ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'npm'`** →
  version drift or a missing `nodeModulesDir`. Use the versions the official scaffold
  pins (Vite 7, `@preact/signals@^2`) and keep `"nodeModulesDir"` in `deno.json`. This
  is why you scaffold rather than hand-write the manifest.
- **Deploy fails to start** almost always means the build didn't run or the entry is
  wrong: run `deno task build`, serve `_fresh/server.js` (not `main.ts`).
- **App builder order matters.** Register `/posts/featured` before `/posts/:id`;
  register middleware before the routes it should wrap.
- **Use `<Head>` from `fresh/runtime`** for per-page title/meta — last render wins,
  so a page overrides `_app.tsx` defaults. (`references/advanced/head.md`)
- **Verify against real Fresh 2 APIs.** When unsure whether an export or signature
  exists, check `references/advanced/api-reference.md` rather than guessing — guesses
  tend to reconstruct Fresh 1.
- **Actually run it before declaring done.** Several Fresh 2 mistakes (the
  `ctx.render(data)` crash, soft 404s, version drift) only surface at *request* time,
  not at type-check. `deno task dev` and load the page (or `curl -i` it to confirm the
  status code) — type-checking alone won't catch them.
- **Statically-imported JSON/data goes stale in dev.** `import data from "./x.json" with
  {type:"json"}` is cached in Vite's SSR module graph — editing the file fires no HMR and
  every request stays stale (reload *and* new tab) until you restart the dev server. For
  data that changes, read it at request time (`Deno.readTextFile`) so a reload reflects
  edits. (`references/playwright-and-dev-loop.md`)
- **Don't gate above-the-fold content on scroll-driven reveals.** A
  `animation-timeline: view()` reveal that starts at `opacity: 0` leaves the hero/first
  content *invisible* until scrolled — and permanently blank where the scroll timeline
  doesn't run (unsupported browsers, reduced-motion, crawlers, static screenshots). Use
  scroll reveals only below the fold; animate above-the-fold with a load-time entrance,
  and author the *visible* state as the default so content is never stuck hidden.
  (`references/frontend-design.md` → Motion system)
