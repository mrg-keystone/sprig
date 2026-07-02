# sprig

**sprig** is a folder-component web framework for Deno. You write Angular-flavoured
`template.html` files and small TypeScript files in convention-named folders; sprig
compiles the templates (a tree-sitter grammar, no JSX), renders them to HTML on the
server, and hydrates only the interactive **islands** on the client. Styles are
view-encapsulated, data is loaded through dependency injection, and the whole app
serves from one `{ fetch }` handler.

```
request → serveSprig → bootstrap → match route → resolve.ts (load data via DI)
        → renderer: page template.html → shell <router-outlet> → HTML document
        → browser: client.js → each <sprig-island> hydrates its logic.ts on its trigger
```

## 5-minute quickstart

```bash
deno run -A jsr:.../cli.ts init my-app   # or: deno run -A framework/cli.ts init my-app
cd my-app
deno task dev                            # → http://localhost:8000/ui  (HMR on)
```

Edit `src/pages/home/template.html` and the page hot-swaps with island state preserved.
Then ship it:

```bash
deno task build                          # code-split islands + scoped CSS → static/
deno serve -A serve.ts                   # one-origin handler
```

→ Full walkthrough: **[getting-started.md](./getting-started.md)**

## Topics

| topic | what it covers |
|---|---|
| [getting-started.md](./getting-started.md) | install Deno, `sprig init`, the scaffold, `dev`/`build`/`serve`, your first edit |
| [folder-components.md](./folder-components.md) | folder = component; the four files; page vs shared vs page-local; identity-by-path |
| [templates.md](./templates.md) | full template syntax: interpolation, `@if`/`@for`/`@switch`/`@let`, bindings, events, pipes — and the single-quote rule |
| [islands.md](./islands.md) | `defineComponent`, signals/computed/effect, inputs/outputs/model, triggers, the server+client setup duality |
| [styling.md](./styling.md) | view encapsulation, `:global`, scope ids across SSR/CSS/hydrate, Tailwind `@apply` |
| [data-and-di.md](./data-and-di.md) | `resolve.ts`, `@Injectable` + scope, `inject`, the `Backend` token, `setResponseStatus` for 404s |
| [routing.md](./routing.md) | `defineRoutes`, `:params`, route guards (302 redirects), the shell `<router-outlet>`, method gating, soft-nav |
| [cli.md](./cli.md) | `init` / `dev` / `build` / `serve` and the HMR loop |
| [hosting.md](./hosting.md) | `serveSprig` dispatch, assets/cache, the `/api` hardening gateway |
| [testing.md](./testing.md) | the three seams: unit compiler, SSR/HTTP, browser hydration |
| [architecture.md](./architecture.md) | (contributor) the compile pipeline, the registry/scope model, code-splitting + manifest |

> A single-file overview also lives at [`../guide.md`](../guide.md). This set supersedes it
> in depth; start here.
