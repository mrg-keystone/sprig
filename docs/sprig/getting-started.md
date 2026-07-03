<sub>[← sprig docs](./README.md)</sub>

# Getting started

A real first-app walkthrough: install, scaffold, run, edit, build, serve.

## 1. Install Deno

sprig runs on [Deno](https://deno.com) (no Node, no npm install step for your app — Deno
resolves dependencies on demand).

```bash
curl -fsSL https://deno.land/install.sh | sh
deno --version    # 2.x
```

## 2. Scaffold an app

`sprig init` writes a minimal, runnable app. The CLI entry is `framework/cli.ts`:

```bash
deno run -A framework/cli.ts init my-app
cd my-app
```

It creates:

```
my-app/
  deno.json                 # imports (@sprig/core, @sprig/keep, …) + tasks (dev/build/start)
  build.ts                  # calls buildClient(src, static)
  serve.ts                  # serveSprig({ keep, app, base: "/ui" }) — starter uses a no-op keep
  src/
    main.ts                 # routes + createRenderer + bootstrap (the app entry)
    shell/
      template.html         # root layout — contains <router-outlet></router-outlet>
      styles.css            # document styles (:global for body/:root)
    pages/
      home/
        template.html       # the routed page
        resolve.ts          # server data loader → the page's @inputs
        styles.css          # scoped page styles
```

The generated `deno.json` sets `experimentalDecorators`/`emitDecoratorMetadata` (for
`@Injectable`) and wires three tasks: `dev`, `build`, `start`.

> The scaffold's `serve.ts` ships a **no-op keep** (a stub `{ backend, handler }`) so the app
> runs with no backend. Replace it with a real keep `api` to get an in-process `Backend` and
> the `/api/*` network channel — see [hosting.md](./hosting.md).

## 3. Run the dev server

```bash
deno task dev          # = deno run -A <framework>/cli.ts dev .
# sprig dev → http://localhost:8000/ui  (HMR on)
```

`sprig dev` builds the client bundle (the **same bytes prod serves** — no dev variant), then
serves the app behind the compiler's dev server (`Deno.watchFs` + an SSE channel), with HMR
activated on top. Open <http://localhost:8000/ui>.

## 4. Edit and see HMR

Open `src/pages/home/template.html` and change the heading:

```html
<main class="home">
  <h1>Hello, {{ name }} 👋</h1>
</main>
```

Saving a **`template.html`** or **`styles.css`** hot-swaps it in place — **island state is
preserved**, no full reload. Editing **`logic.ts`** or server code triggers a rebuild +
reload. (Details: [cli.md](./cli.md).)

`name` here comes from the page's `resolve.ts`:

```ts
// src/pages/home/resolve.ts
import type { Resolve } from "@sprig/core";
export const resolve: Resolve = () => ({ name: "sprig" });
```

## 5. Add interactivity (an island)

A folder becomes an **island** the moment it has a `logic.ts`. Pages themselves can't be
islands, so put it in `src/shared-components/` (or `pages/home/components/`):

```ts
// src/shared-components/counter/logic.ts
import { defineComponent, signal } from "@sprig/core";

export default defineComponent({
  inputs: ["start"],
  setup: (ctx) => {
    const count = signal(ctx.input<number>("start", 0)());
    return { count, inc: () => count.set(count() + 1) };
  },
});
```

```html
<!-- src/shared-components/counter/template.html -->
<button (click)="inc()">count is {{ count() }}</button>
```

Use it by folder name in the page template:

```html
<counter [start]="3"></counter>
```

Full island reference: [islands.md](./islands.md).

## 6. Build + serve for production

```bash
deno task build        # → static/{client.js, isl.<sel>.js, chunk-*.js, app.css, templates.json}
deno serve -A serve.ts # → http://localhost:8000/ui
```

`build` code-splits each island into its own chunk, scopes every `styles.css`, runs
Tailwind, and writes a content-hashed manifest (the `?v=` cache-buster). `serve.ts`'s
default export is the single-origin `{ fetch }` handler.

---

**Next:** [folder-components.md](./folder-components.md) — the folder = component model.
**See also:** [cli.md](./cli.md) · [hosting.md](./hosting.md)
