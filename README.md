# sprig

A folder-component web framework for Deno: **Angular-flavoured templates** compiled to
HTML, **server-rendered** with **selective island hydration**, **view-encapsulated** CSS,
and dependency injection — no Vite, a state-preserving HMR dev loop, and a single
`deno serve` to production (Deno Deploy ready).

```bash
deno run -A framework/cli.ts init my-app   # scaffold
cd my-app && deno task dev                  # → http://localhost:8000/ui  (HMR)
```

## Why

- **Folder = component.** A folder with a `template.html` is a component; add a `logic.ts`
  and it becomes an interactive **island**. No imports to wire, no registration.
- **Server-first.** Pages render to HTML on the server (`resolve.ts` loads data via DI);
  only islands ship JS, code-split one chunk per island, hydrated on their trigger.
- **Encapsulated.** Each component's `styles.css` is scoped to its own markup — no leakage.
- **One origin.** `serveSprig(...)` composes a [keep](packages/keep/mod.ts) backend (an
  in-process `Backend` for SSR + a token-gated `/api/*` channel) with the UI under one
  `{ fetch }` handler.

## The CLI

```
sprig init  [dir]              scaffold a minimal, runnable sprig app
sprig dev   [appDir] [entry]   state-preserving HMR dev server (no Vite)
sprig build [appDir]           code-split islands + scope CSS + Tailwind → static/
sprig serve [entry]            boot a serve.ts's default { fetch } handler
```

Run it as `deno run -A framework/cli.ts <cmd>` (or `deno task sprig <cmd>` in this repo).

## Repository layout

```
framework/
  cli.ts                  # the `sprig` CLI (init/dev/build/serve)
  .sprig/
    core.ts               # signals, DI (Injector/inject), routing, bootstrap().fetch SSR
    compiler/             # the template compiler (parse → render → serialize → hydrate)
      parse.ts            #   tree-sitter template parsing (loads grammar.wasm)
      expr.ts / node.ts   #   expression + pipe interpreter, AST helpers
      render.ts           #   SSR render: bindings, events, escaping, @let scoping
      serialize.ts        #   AST (de)serialization for client hydration
      scope.ts            #   CSS view-encapsulation (scopeCss / componentScopeId)
      mod.ts              #   component registry + page assembly + SSR renderer
      build.ts            #   island code-split + per-component CSS scoping
      island.ts           #   island definition + setup() injector wiring
      hydrate.ts          #   client runtime: hydration, delegation, reactive updates, soft-nav
      dev.ts / hmr.ts     #   dev server + hot template/CSS swap (SSE)
      compiler.test.ts    #   framework unit tests
packages/keep/mod.ts      # @sprig/keep — serveSprig(): the one-origin composition root
app/                      # the isolate workbench, an example app built ON sprig
tree-sitter-angular-template/  # grammar source (regenerate grammar.wasm from here)
```

> The `cli/`, `server/`, `ui/`, and `skills/` directories are the **isolate** project (a
> component testing workbench). `app/` is isolate's UI rebuilt on sprig — a worked example
> of a real sprig app. See [`docs/guide.md`](docs/guide.md) for the full framework guide.

## Documentation

- **[docs/guide.md](docs/guide.md)** — the full guide: project layout, folder-components,
  template syntax, islands & hydration, dependency injection, the CLI, and hosting.

## Test

```bash
deno test -A framework/.sprig/compiler/compiler.test.ts   # framework unit tests
deno test -A app/spine.test.ts                            # the example app's SSR/API spine
```
