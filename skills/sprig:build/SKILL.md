---
name: "sprig:build"
description: >-
  Expert guidance for building web apps with sprig — a Deno SSR framework with
  Angular-flavored HTML templates and selective island hydration, published on JSR as
  @sprig/core. Use this whenever the user is scaffolding, building, or modifying a sprig
  app: adding pages or components, islands (interactive components), wiring data with a
  page's logic.ts class or resolve, routes, persisted state, dependency injection, or
  previewing/testing a component in isolation with `sprig isolate`; or when working in a
  repo with sprig markers (a deno.json importing "jsr:@sprig/core", folder-components made
  of template.html + optional logic.ts, a src/ tree with pages/ + a shell, or main.ts
  calling bootstrap()/createRenderer()). sprig is NOT Fresh/Preact, Next.js, or Angular —
  it borrows Angular's template syntax but is its own runtime, so prefer this skill over
  memory of those frameworks. Do NOT use for Fresh, React/Next, Vue, Svelte, plain Deno
  scripts with no web server, or unrelated uses of "sprig".
---

# Building sprig apps

sprig is a **Deno server-rendered** framework. It parses **Angular-flavored HTML
templates** at build time, renders every page to HTML on the server, and ships JavaScript
**only for islands** — components you make interactive by giving them a `logic.ts`. Most
of a page ships zero JS. It is published on JSR as **`@sprig/core`** and runs anywhere Deno
does; there is no separate runtime install.

A component is a **folder**, not a file: `template.html` (+ optional `logic.ts` and
`styles.css`). That one idea drives everything below.

> Read the matching `references/` leaf before writing code for an area you're unsure
> about — the [decision matrix](#decision-matrix) routes you, and `references/INDEX.md` is
> the full table of contents. **Verify by running it** (`sprig dev`, `sprig isolate`) and
> looking in a browser — several sprig behaviors (island hydration, persisted state, page
> data) only show up at request time, never at type-check.

## sprig is not Fresh / Next / Angular

This is the biggest source of bugs — pretrained instincts reach for the wrong framework:

- **A component is a folder of `template.html` + optional `logic.ts` + `styles.css`** —
  NOT a `.tsx` file. There is no JSX, no `routes/` filesystem routing, no `islands/` magic
  dir, no Vite. The template is **HTML with Angular-style bindings**, not Preact.
- **`logic.ts` is the unit of behavior.** A folder with a `logic.ts` is an **island**
  (it hydrates on the client); a folder with only `template.html` is **static** (zero JS).
- **You don't hand-write a route→module map.** `routes` declare each page's folder via
  `load`; the framework auto-loads that folder's `logic.ts`/`resolve.ts`. No `modules: {}`.
- **The CLI is `sprig`** (`init`/`dev`/`build`/`isolate`/`serve`/`update`), installed from
  `jsr:@sprig/core/cli`. There's no `_fresh/`, no `vite.config.ts`, no manifest.
- **It's Angular's _syntax_, not Angular.** `{{ }}`, `[prop]`, `(event)`, `@if`/`@for`,
  `<router-outlet>`, `<content>` — but no NgModules, decorators-on-components, RxJS, or
  the Angular runtime. Bindings evaluate against the component's `logic.ts` scope.

## Optimistic UI (MANDATORY)

**Every user action that writes to the server MUST be optimistic by default.** Do not make
the user watch a spinner waiting to learn if their action worked. The UI **acts as if the
action already succeeded**, then reconciles:

1. On the `(event)`, **apply the change to local island state immediately** and render it.
2. **Fire the server call in the background** (don't `await` it before updating the UI).
3. **On failure, roll back** to the pre-action state and surface the error (toast/inline).

This requires the component be an **island** (it needs a `logic.ts`). The full pattern —
snapshot → mutate → call → roll back — is in `references/component-model.md`
(**Optimistic UI**).

```ts
async toggleDone(item) {
  const prev = item.done;          // 1. snapshot for rollback
  item.done = !item.done;          // 2. update the UI now (optimistic)
  try {
    await inject(Api).setDone(item.id, item.done);   // 3. server, in the background
  } catch {
    item.done = prev;              //    rolled back — and tell the user
    this.error = "Couldn't save — reverted.";
  }
}
```

**Use optimism whenever humanly possible.** Only fall back to a **waiting/pending** UI when
optimism is genuinely impossible — i.e. the outcome is unknowable on the client and *must*
come from the server before you can show anything correct (a server-generated id you must
display, a payment authorization, a search result set). When in doubt, be optimistic.

**Exceptions — and only these:**
- An **inline `data-note` says otherwise** (e.g. "wait for the server", "show a spinner
  until confirmed"). The note wins — do exactly what it says for that element.
- An **inline `data-note` says it must be an island with realtime updates** → build it as a
  realtime island (live server-pushed updates), not a one-shot optimistic write.

## Install + scaffold

The CLI lives on JSR. Install it once, then scaffold:

```sh
deno install -gAf -n sprig jsr:@sprig/core/cli   # the `sprig` command (re-run / `sprig update` to upgrade)
sprig init myapp
cd myapp
deno task dev        # state-preserving HMR dev server → http://localhost:8000/ui
```

`sprig init` writes a runnable app whose `deno.json` pulls everything from
`jsr:@sprig/core` — no hand-writing versions. Tasks: **`deno task dev`** (HMR),
**`deno task build`** (code-split islands + scope CSS → `static/`), **`deno task start`**
(the production host). `sprig isolate` previews one component at a time (below).

## Project shape

```
src/
  shell/template.html        ← the document layout; contains <router-outlet>
  pages/home/
    template.html            ← the page view
    logic.ts                 ← (optional) the page's class: data + behavior
    styles.css               ← (optional) component-scoped styles
  components/<name>/          ← reusable components (static = no logic.ts)
  islands/<name>/            ← interactive components (have logic.ts)
  services/state/mod.ts      ← (optional) persisted StateService
  main.ts                    ← routes + renderer + bootstrap (the app)
serve.ts                     ← the host (mounts the UI at /ui)
deno.json
```

Folder names under `components/`/`islands/` are just convention — what makes a folder an
**island** is the presence of `logic.ts`, and what makes it a **page** is living under
`pages/`. The folder's **basename is its selector** (the custom tag other templates use:
`components/badge/` → `<badge>`).

`src/main.ts` is the whole app — three declarations, no boilerplate:

```ts
import { bootstrap, defineRoutes, type SprigApp } from "@sprig/core";
import { createRenderer } from "@sprig/keep";
import { dirname, fromFileUrl } from "@std/path";

export const routes = defineRoutes([{ path: "", load: "pages/home" }]);
export const renderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)),
  "/ui",
  {
    dev: !!Deno.env.get("SPRIG_DEV"),
  },
);
export const app: SprigApp = bootstrap({ routes, base: "/ui", renderer });
```

`routes` drive everything: `load: "pages/home"` names the page folder, and the framework
auto-loads its `logic.ts` (or a `resolve.ts`) for data — **adding a page is adding a
route**, nothing else.

## Pages, components, islands — and `logic.ts`

A page (or any component) is `template.html` + an optional `logic.ts` **class**. The class
is the component's data and behavior; the template binds to it.

```ts
// pages/home/logic.ts
import { inject } from "@sprig/core";
import State from "../../services/state/mod.ts";

export default class Home {
  name = "(loading…)";
  state = inject(State); // DI resolves in field initializers (server AND client)

  onServerInit() {
    // runs on the SERVER before the page renders — load data here
    this.name = "sprig";
  }
  onBrowserInit() {
    // runs on the CLIENT after hydration — wire browser-only things
  }
}
```

```html
<!-- pages/home/template.html — {{ name }} comes from logic.ts -->
<main><h1>Hello, {{ name }} 👋</h1></main>
```

**Lifecycle hooks** (all optional): `onServerInit` (data load, server) · `onBrowserInit`
(after hydration, client) · `onServerDestroy` · `onBrowserDestroy`. The instance's
serializable fields are **snapshotted** after `onServerInit` and re-seeded on the client
before `onBrowserInit`, so a value set on the server is there in the browser. A folder with
a `logic.ts` becomes an **island** and hydrates client-side; a folder with only
`template.html` ships **no JS**. Full lifecycle + the simpler `defineComponent({ setup })`
alternative: **`references/component-model.md`**.

## Templates (Angular-flavored HTML)

The most-reached-for bindings — full reference in **`references/templates.md`**:

- `{{ expr }}` — interpolate (HTML-escaped). Expressions can call scope methods/signals:
  `{{ count() }}`, `{{ ok ? '✓' : '✗' }}`.
- `[prop]="expr"` — one-way bind a property/input: `[disabled]="busy()"`,
  `[value]="count()"`, `[innerHTML]="trustedHtml"`.
- `(event)="handler()"` — bind a DOM event to a scope method: `(click)="inc()"`. Event
  handlers run **only after hydration** (so they need a `logic.ts`).
- `@if (cond) { … } @else { … }`, `@for (x of list; track x.id) { … } @empty { … }` —
  control flow blocks.
- `<router-outlet>` — in the shell, where the matched page renders.
- `<content>` — projects a component's children into its template (may self-close, `<content/>`;
  its own children are the fallback when nothing is projected; `<ng-content>` is an alias).
- `<child-selector [in]="x" (ev)="f()">` — compose another folder-component by its
  selector (basename).

## State that survives navigation (`StateService`)

`@sprig/core` ships a `StateService` base for per-app persisted state: subclass it, mark it
`@Injectable`, and `inject()` it anywhere. The framework serializes it to **localStorage**
on navigation + reload and restores it on load; `reset()` restores defaults **and** clears
the saved copy. Set a `static key` (class names are minified in prod).

```ts
// src/services/state/mod.ts
import { Injectable, StateService } from "@sprig/core";

@Injectable({ providedIn: "root", scope: "both" })
export default class State extends StateService {
  static key = "app";
  count = 0;
}
```

Signals (`signal`/`computed`/`effect`/`isSignal`) and DI (`@Injectable`/`inject`/`Backend`)
round out the runtime — see `references/component-model.md`.

## Serving the app

`sprig dev` serves the app with HMR (no host file needed). For production, the scaffold's
`serve.ts` mounts the UI as **middleware** at `/ui` via `sprigUi({ app, base: "/ui" })`,
which returns a `Response` for anything under `/ui` or `null` to pass through — so it drops
into any host. The scaffold uses a Danet host (`app.use(ui)`); `serveSprig` is the
all-in-one alternative. The host owns every other route; sprig owns `/ui`. Details:
**`references/serving.md`**.

## Preview & test one component in isolation (`sprig isolate`)

`sprig isolate` is a Storybook-style **workbench**: it discovers every folder-component that
has an `isolate/` folder (its `fixture.json` + named `cases/`) and serves a sidebar of
components + cases, a live stage, a controls panel, a console, and per-case Playwright tests —
with **HMR** (edit a component or a case and the stage hot-swaps).

```sh
sprig isolate          # from the app dir → http://localhost:8000/ : pick a case, see it alone
```

A component shows **only if it has an `isolate/` folder** (no `isolate/` → *"Nothing to
isolate"*). Author cases per **`breakdown/references/isolate-format.md`**; the workbench + its
internals are in **`references/isolate.md`**.

## The dev loop

1. `sprig dev` (or `sprig isolate` for one component) — HMR is on; editing a `template.html`
   or `styles.css` hot-swaps in place keeping island state; editing `logic.ts` rebuilds.
2. **Open it in a browser and look.** Island hydration, persisted state, and page data are
   request-time behaviors — a passing type-check proves nothing. Confirm the page renders,
   islands hydrate (interactive), and data shows.
3. **Run the production path before declaring done**: `deno task build` then
   `deno task start`, and hit a real URL — the build code-splits + scopes CSS and the host
   differs from the dev server.

## Building from an annotated prototype (`data-note`)

A prototype handed to you may carry **inline annotations** left with the `sprig:prototype`
annotate tool (its "save: inline" mode writes them straight onto the element):

- **`data-note="…"`** — a change/instruction for *that specific element*: what it should do,
  say, or become. Treat it as a per-element requirement from the user.
- **`data-note-css="…"`** — CSS declarations the user wants applied to that element
  (e.g. `color:#c2410c; font-size:18px`). Fold them into the component's `styles.css`
  (scoped), not inline.

How to consume them when translating the mock into sprig components:

1. **Find them first.** `grep -rn 'data-note' <prototype>.html` — each hit is a pending
   instruction tied to a concrete element. Build a checklist before writing components.
2. **Apply to the right component.** The annotated element maps to a folder-component
   (`template.html` + `logic.ts` + `styles.css`); apply `data-note` as behavior/markup and
   `data-note-css` as scoped styles on that component.
   - A `data-note` **overrides the optimistic-UI default** (above): if it says "wait for the
     server" / "show a spinner", do that for this element; if it says it must be an **island
     with realtime updates**, build it that way instead of a one-shot optimistic write.
3. **Strip the attributes from the output.** `data-note` / `data-note-css` are *authoring
   instructions, not markup* — never emit them into the built `template.html`.

(The other annotate mode writes a sibling `<prototype>.feedback.json` instead — same intent,
keyed by CSS selector; see `sprig:prototype`. Inline `data-note` lives on the element itself.)

## Decision matrix

| Task                                                                       | Read                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| Scaffold / project shape / CLI                                             | this file (above)                              |
| A page/component's data + lifecycle; signals; DI                           | `references/component-model.md`                |
| Optimistic UI for a server write (snapshot → mutate → call → roll back)     | `references/component-model.md` (Optimistic UI) |
| Template syntax (bindings, control flow, projection, composing components) | `references/templates.md`                      |
| Routes & data loading                                                      | `references/routing.md`                        |
| Persisted state                                                            | `references/component-model.md` (StateService) |
| Serve / mount the UI / Danet host                                          | `references/serving.md`                        |
| Preview / test a component alone                                           | `references/isolate.md`                        |

## Top gotchas

- **Server writes are optimistic by default** (mandatory) — update the UI now, call in the
  background, roll back on failure. Spinner-and-wait only when the result is unknowable
  client-side, or an inline `data-note` says otherwise. See **Optimistic UI** above.
- **A component is a folder, not a `.tsx`.** `template.html` (+ `logic.ts` + `styles.css`).
- **`logic.ts` = island.** Want client interactivity (events, `onBrowserInit`)? The folder
  needs a `logic.ts`. Static folders ship no JS and their `(event)` bindings never fire.
- **`inject()` must be called synchronously** in a constructor / field initializer /
  `onServerInit` / `setup` — not after an `await`. Capture deps into fields first.
- **Island props/state must be serializable** (they cross the SSR→client wire as JSON) —
  no functions or class instances as inputs; methods live inside the component.
- **Set a `static key` on a `StateService`** — class names are minified in production, so
  the default `constructor.name` key isn't stable across builds.
- **Run it in a browser, and run the production build.** `sprig dev` passing ≠ production
  working: `deno task build` → `deno task start` → hit a real URL.
- **`sprig` feels stale after an update?** The global install pins a version in a lockfile;
  `sprig update` (or `rm -f ~/.deno/bin/.sprig/deno.lock && deno install --reload=jsr:@sprig/core -gAf -n sprig jsr:@sprig/core/cli`) re-resolves to latest.
