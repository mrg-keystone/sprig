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

`vite.config.ts` — replaces Fresh 1's `dev.ts`. Use **standard Fresh HMR** (the default —
no custom reload plugin). Keep `cache-control: no-store` so reloads/fetches aren't served
stale, and read changing data at request time.

> **Do NOT add an `always-full-reload` plugin.** Earlier versions of this skill recommended
> a plugin that does `handleHotUpdate → server.ws.send({type:"full-reload"})` "so you never
> see a stale page." It does the opposite **on Safari**: forcing a full reload re-imports the
> island modules at their stable `fresh-island::*` URLs, and Safari serves those from its
> module cache **ignoring `no-store`** — so the island you just edited renders **stale**,
> while a new tab shows it fresh. Standard HMR avoids this because it patches the changed
> module at a cache-busted `?t=` URL, which Safari refetches. (Reproduced + fixed in real
> Safari via `safaridriver`; details in `references/playwright-and-dev-loop.md` and
> `../ui-audit/references/fresh2-bug-catalog.md`.)

```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
// Optional: recover a tab whose HMR socket died while the dev server was down (Safari
// throttling a backgrounded tab, a long/again-and-again restart). On disconnect it polls
// the server and reloads the moment it's back — no permanently-stale tab. Dev-only; ships
// the snippet to the client automatically, so nothing to paste into client.ts.
import { devReconnect } from "@mrg-keystone/keep/vite";

export default defineConfig({
  server: { headers: { "cache-control": "no-store" } },
  plugins: [fresh(), devReconnect()], // devReconnect() is optional
});
```

`client.ts` — browser entry; import the **global** CSS here (design tokens, fonts,
resets, keyframes — the things every page shares):

```ts
import "./assets/styles.css";
```

A plain `.css` file — whether imported here or co-located next to a component — is
**global**: its selectors apply app-wide and collide by class name. For styles that
belong to one component, don't write a global `.css`; use a co-located **CSS Module**
(next section), which Vite scopes so the styles can't leak.

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
backend silently falls back to its default store (see `references/rune-backend.md`).

Don't put imported assets (CSS, icons used as JS imports) in `static/` — they'll be
duplicated in the build. `static/` is for URL-only files; `assets/` is for imports.

### Component-scoped CSS — co-locate a `.module.css`

Fresh's only built-in stylesheet is **global**, so a hand-written `.css` leaks across the
app. To scope styles to one component, use a **CSS Module**: name the file
`*.module.css`, put it in the component's own folder, and import it as an object of
class names. Vite rewrites every class to a hashed, collision-proof name — so two
components can both define `.card` with zero interference.

```
components/card/
  Card.tsx
  Card.module.css      ← the `.module` suffix is mandatory; `Card.css` stays global
```

```css
/* Card.module.css */
.card  { padding: 1rem; border: 1px solid var(--border); }
.title { font-weight: 800; }
```

```tsx
// Card.tsx — a server component (ships zero JS) or an island, either works
import styles from "./Card.module.css";

export function Card() {
  return (
    <div class={styles.card}>
      <h2 class={styles.title}>Scoped</h2>
    </div>
  );
}
```

Verified in a real Fresh 2 build (dev **and** production): the SSR'd HTML carries the
hashed class (`class="_card_sbtxc_1"`), Fresh auto-injects the matching
`<link rel="stylesheet">`, and the served CSS uses the scoped selector — nothing to wire
up. The hash is content-derived and **stable across renders** (same on server and
client), so islands hydrate without a class mismatch.

Rules that bite:

- **The suffix is the switch.** `Card.module.css` scopes; `Card.css` is global. Renaming
  is the entire difference — there's no config flag.
- **Reference classes through the imported object** (`styles.card`), never as a string
  literal (`class="card"`) — the literal name doesn't exist in the output, so the element
  renders unstyled. For a dynamic/conditional class, index it: `styles[variant]`.
- **A class the module never exports is `undefined`** at `styles.x` — a silent no-class.
  Typos fail quietly; check the rendered `class=""` if a style "didn't apply".
- **Keep genuinely global rules global.** Design tokens (`:root` custom properties),
  `@font-face`, resets, shared `@keyframes`, and element selectors belong in the
  `client.ts`/`_app.tsx` global sheet — a module is for *this component's* class rules.
  Custom properties defined globally are readable from inside a module (`var(--border)`
  above); only the class names are scoped, not the cascade.
- **Use kebab/camel consistently.** `styles["my-class"]` works but `styles.myClass`
  reads cleaner — pick one convention per project.

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

If this app fronts a separate service rather than owning its data, that `db.projects.find`
call is instead an in-process backend `fetch` (see *Step 0* and `references/rune-backend.md`)
— don't invent a local store to stand in for a backend that already exists.

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

## Step 0 — where does the data come from?

Before any design work, answer one question: **does this app own its data, or front a
separate backend?** It sets the build order, and getting it wrong is expensive.

- **Owns its data** (in-app store, Deno KV, local files) → the patterns above are the
  whole story. Proceed to design.
- **Fronts a real service** (a keep/danet API, a rune backend, any HTTP backend) →
  **wire the data spine first.** Identify the endpoints, build the typed client /
  in-process adapter, and make page handlers read *real* data from request one. Style
  *after* the data is real, not before.

The failure this prevents: building the entire UI against fixtures, making it world-class,
and only then trying to wire the server — ending with a beautiful production-looking
console showing 100% fake numbers while a fully-working backend sits unused beside it. When
a Fresh app's job is to be a frontend for a real service, **"shows real data" outranks
"looks world-class"** — design is Step *last*, not Step zero.

Fixtures are legitimate only for endpoints the backend genuinely *lacks*, and those must be
**labeled** — a `live: boolean` the page surfaces — so "real vs placeholder" is never
invisible. Never pass a stub off as real data. (The live-first / fixture-fallback adapter
is in `references/rune-backend.md`.)

If you're fronting a backend, read **`references/rune-backend.md` before wiring** — the
in-process call, the Deno-workspace setup, loading the backend's env, the literal-import /
`deno check` trap, and the production-build crash are all non-obvious and each costs real
debugging time.

## Make it look good — and "good" means world-class

*(If the app fronts a real backend, do Step 0 first — wire real data, then make it
world-class. The bar below is non-negotiable, but it comes **after** the data is real.)*

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
`client.ts` so every page inherits it; keep each component's *own* rules in a co-located
`*.module.css` (see *Component-scoped CSS*) so they never leak. Avoid generic fonts (Inter/Roboto/Arial/system)
and clichés (purple-on-white gradients). Utilitarian prompts ("add a form", "add a
toggle") are *not* permission to be plain — hold the same bar everywhere.

**daisyUI via the MCP is a structure accelerator, not a shortcut past the bar.** The
`daisyui-blueprint` MCP (`daisyUI-Snippets` + `Figma-to-daisyUI`) hands you accessible
component markup, the class vocabulary, and screenshots — and in Fresh its CSS-only
dropdowns, collapses, drawers, tabs, and **theme/dark-mode toggles work with zero
islands** (modals too, in their checkbox variant), which is exactly how you want
interactivity here. But daisyUI delivers **none** of this section's four
non-negotiables — typography, motion, depth, a signature moment — only the accessible
structure beneath them; shipped as its default theme it's the generic look the bar
forbids. So pull the structure, then **re-theme with a custom `@plugin "daisyui/theme"`**
and supply your own typography, motion, depth, and signature moment. **Read
`references/daisyui-mcp.md`**
before building UI with it — the nested-object call syntax, the CSS-only-vs-island
choice, the `class`/inline-`onclick` Preact gotchas, and the custom-theme bridge are all
there.

## The dev loop — seeing your changes without the new-tab dance

A plain browser reload sometimes won't show your edit in Fresh 2 dev, for three reasons:
the **dev server restarted** (you edited `vite.config.ts`/`main.ts`/`deno.json`/`.env` —
inherent to any tooling), a **statically-imported JSON/data file** is cached server-side
(stale for *every* request, reload and new tab alike, until restart), or a **dead HMR
socket / stale module cache** (no auto-reload fires). Opening a fresh tab only seems to
help because it dodges these — usually a restart happened in between.

Two things make routine editing reliably reflect on save:

1. **Standard Fresh HMR** (the default — no custom reload plugin). Island edits hot-patch
   in place at a cache-busted `?t=` URL; route/server edits trigger a full reload. Do **not**
   add an `always-full-reload` plugin to "force" reloads — it makes Safari render edited
   islands stale (see Bootstrapping). If a tab's HMR socket dies during a server restart, add
   keep's optional `devReconnect()` plugin (`@mrg-keystone/keep/vite`), which reloads the tab
   the moment the server is back.
2. **Read changing data at request time** — `Deno.readTextFile(new URL("../data/x.json",
   import.meta.url))` in a handler/loader, not `import … with {type:"json"}` — so the
   reload actually serves fresh data.

With both, edits to **code and data auto-refresh the open tab** — no manual reload, no new
tab. Two things still need a server restart: editing the dev config or server entry (the
tab reconnects once it's back), and **adding or removing an island/route file** — Fresh
builds the island registry from a one-shot scan at startup and patches it incrementally
from file-watcher events, which drifts out of sync on a structural add (symptom: a bare
`fresh-island::Name.tsx` specifier → no hydration for *any* island on the page). *Editing*
an existing island hot-reloads fine; a structural add still needs a restart. Full details +
the Playwright testing angle are in `references/playwright-and-dev-loop.md`.

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

## Rebuild from a ui-breakdown — components green before pages

A `ui-breakdown/` (from the **ui-breakdown** skill) is built to be rebuilt
**mechanically**: per-component specs whose **Events** sections are the
validation spec, `isolate/` proposals (`fixture.json` + `cases/`), `screenshots/`,
and an `index.md` with the build order + usage matrix. ui-breakdown only *specs*
the validation; **deno-fresh2 materializes and runs it.** Follow `index.md`'s
order and hold the gate.

**Order (from `index.md`):** design tokens → **shared components** (dependency
order — primitives like button/badge/avatar before composites like card/modal
that embed them) → **page-local components** → **page compositions**. Build
bottom-up so every page is assembled from parts that already pass.

**Per component — loop until green:**

1. **Scaffold** it at its isolate root from the spec's Classification:
   `static`→`components/<name>/`, `island`→`islands/<name>/`,
   `page-composition`→`pages/<name>/` (file is `PascalCase(folder).tsx`).
2. **Drop in** the proposed `isolate/` folder (`fixture.json` + `cases/`) as-is,
   adjusting only where the real component API forces it.
3. **Write the tests from the Events section** — lift each `capture(page)`
   predicate sketch into `cases/<name>/tests/*.spec.ts`, mapping each predicate
   to the case whose state triggers it. This is the step ui-breakdown left to
   you (it specs; you materialize).
4. **Run both checks:** `isolate dev` → diff the rendered case against its
   `screenshots/` (visual); `isolate test` → run the predicates (behavioral).
   Iterate the component until **both** pass for **every** case.

A component is **done only when its cases diff clean and `isolate test` is
green.** Never build on a red component.

**The gate:** finish **all shared components green** before starting any page.
For each page, build its **page-local components green** first; only once *every*
component that page uses passes do you build the **page composition** — wire the
real layout and data, then make the **page-level** cases/tests pass. A page is
never assembled on top of an unproven part.

Once a page's components are green, wire its data to the backend (next section)
and run the gap audit.

## Wire to a rune/keep backend — and propose what's missing

When the build has a backend, deno-fresh2 takes a **second input** beside the
`ui-breakdown/` spec: the **rune server directory**, where the `.rune` files and
their generated keep backend live. Point the skill at both; absent explicit
paths, auto-detect a sibling `ui-breakdown/` and the nearest dir holding
`*.rune` + `bootstrap/`. **Read `references/rune-backend.md` before wiring** — it
carries the catalog, in-process embedding, and the suggested-`.rune` skeleton;
this is just the shape.

1. **Type loaders off the real DTOs — don't redeclare them.** The callable
   surface is the runes' `[ENT]` endpoints (the generated
   `entrypoints/<surface>/mod.ts` `@Endpoint` controllers). Import the generated
   `dto/*.ts` (via each module's `mod-root.ts`) so handlers share the exact
   class-validator contracts the backend asserts — the frontend data-model stops
   being a hand-copy. *(A rune with no `[ENT]` has no HTTP edge; there's nothing
   to call.)*
2. **Call it in-process.** keep ships an in-process backend client and Fresh
   embedding — an SSR loader calls `api.backend.fetch("/orders")` during render,
   no listen, no token (the **keep skill's** deployment reference covers
   `embed`/`withBasePath`; don't re-derive it).
3. **The rune DTO wins.** ui-breakdown's isolate fixtures carry fake, UI-shaped
   data; the rune DTO carries the real shape. Re-type each fixture against its
   DTO and **surface every mismatch loudly** — a fixture field the DTO lacks (or
   vice-versa) is the exact seam where frontend and backend silently drift.

Beyond these three, **consuming a separate backend in-process has a cluster of setup
gotchas** that each cost real time — a Deno **workspace** with `nodeModulesDir`/`unstable`/
decorator `compilerOptions` at the **root** (param decorators in a danet dep fail to parse
otherwise), a **literal** dynamic import so Vite resolves it (which also makes `deno check`
re-type-check the dep's source), loading the backend's env via **`--env-file` on the
tasks** (never `import.meta.url`-relative), and verifying the **production build**, not
just dev. All of these are in `references/rune-backend.md`; read it before wiring.

### Gap audit → suggested runes (the last step of the build)

A backend is often **thinner than the UI** — the mock implies operations no
`[ENT]` covers. The frontend build is where you find out, because it's where you
try to call them. So once the app is wired, diff **UI-needed operations**
(ui-breakdown's per-component Events sections + the data-model) against the
**rune endpoint catalog**. Every operation with no home is a gap. For each gap:

- **Write a suggested spec** to `<git-root>/spec/suggested/<name>.rune`
  (`git rev-parse --show-toplevel`; create `spec/suggested/` if absent): DTOs
  from the shared data-model, the `[REQ]`/`[ENT]` inferred from the UI
  interaction, validation/faults **inferred-and-flagged** ("verify during
  build"). Skeleton in `references/rune-backend.md`.
- **Stub the call so the app still runs.** Back the Fresh loader/action with the
  isolate fixture's data and leave
  `// TODO(suggested-rune): spec/suggested/<name>.rune — <what it must do>`. The
  page must not crash — deno-fresh2's "actually run it before done" bar applies
  to gaps too.
- **Index it** in `spec/suggested/README.md`: which UI feature needs it, why
  it's missing, how to promote (review → move the spec into the server dir →
  `rune sync`).

**Suggestions are review-only — never `rune sync` them yourself.**
`spec/suggested/` is an inbox a human/rune session promotes; a frontend build
must never silently grow the backend.

**No server dir at all is the same code path:** every UI operation is a gap, so
the audit emits a *complete* suggested backend — you can deliberately build
frontend-first and let deno-fresh2 propose the whole rune spec. (Backend
endpoints with no UI caller are the inverse: note them in the index, generate
nothing.)

## Decision matrix — load the right reference

Before working in an unfamiliar area, read the matching `references/` file(s):

| Task | Read |
|---|---|
| Bootstrap a project | `quickstart.md`, `concepts/architecture.md`, `concepts/file-routing.md` |
| Add a page / route | `concepts/routing.md`, `concepts/file-routing.md`, `concepts/data-fetching.md` |
| Add interactivity | `concepts/islands.md`, `concepts/signals.md`, `advanced/serialization.md` |
| Style / design the UI (any visible surface) | `frontend-design.md` |
| Build UI from daisyUI (accessible components, CSS-only interactivity, theming, Figma→UI) | `daisyui-mcp.md` |
| Scope CSS to one component (vs. global) | *Component-scoped CSS* above (co-located `*.module.css`) |
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
| Wire to a rune/keep backend / propose missing endpoints | `rune-backend.md` |
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
- **Actually run it before declaring done — including the production build.** Several
  Fresh 2 mistakes (the `ctx.render(data)` crash, soft 404s, version drift) only surface
  at *request* time, not at type-check: `deno task dev` and load the page (or `curl -i` it
  to confirm the status code). And **`deno task dev` passing proves nothing about
  production** — the build runs a different transform (esbuild/rollup, and it bundles any
  consumed backend into `_fresh/server/`). Run `deno task build` → `deno serve -A
  _fresh/server.js` → hit a real endpoint. Things that pass in dev and crash only in the
  build: `import.meta.url`-relative file reads (the path math changes in the bundle), env
  not loaded (put `--env-file` on the task), and the build *warnings* you didn't read.
  (Backend details: `references/rune-backend.md`.)
- **Adding an island while `deno task dev` runs breaks hydration — restart.** A newly
  added island can emit a bare `fresh-island::Name.tsx` specifier (the browser reads
  `fresh-island:` as a URL scheme → CORS/404), and a single broken specifier kills
  hydration for *every* island on the page. Restart the dev server after adding an island
  or route file; *editing* an existing one is fine. (`references/playwright-and-dev-loop.md`)
- **Statically-imported JSON/data goes stale in dev.** `import data from "./x.json" with
  {type:"json"}` is cached in Vite's SSR module graph — editing the file fires no HMR and
  every request stays stale (reload *and* new tab) until you restart the dev server. For
  data that changes, read it at request time (`Deno.readTextFile`) so a reload reflects
  edits. (`references/playwright-and-dev-loop.md`)
- **daisyUI snippets paste into Preact, but with two catches.** Keep `class` (don't
  rewrite to `className`); and inline string handlers like `onclick="my_modal.showModal()"`
  are **dead in JSX** — use daisyUI's CSS-only variant (checkbox/`<details>`/`<dialog>`, no
  island) or move the trigger into an island with a real `onClick` function. Also: never
  ship the **default** daisyUI theme — define a custom `@plugin "daisyui/theme"`, or you've
  shipped the exact generic look the design bar forbids. (`references/daisyui-mcp.md`)
- **Don't gate above-the-fold content on scroll-driven reveals.** A
  `animation-timeline: view()` reveal that starts at `opacity: 0` leaves the hero/first
  content *invisible* until scrolled — and permanently blank where the scroll timeline
  doesn't run (unsupported browsers, reduced-motion, crawlers, static screenshots). Use
  scroll reveals only below the fold; animate above-the-fold with a load-time entrance,
  and author the *visible* state as the default so content is never stuck hidden.
  (`references/frontend-design.md` → Motion system)
