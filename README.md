# sprig

A folder-component web framework for Deno: **Angular-flavoured templates** compiled to
HTML, **server-rendered** with **selective island hydration**, and **view-encapsulated**
CSS — with no Vite and a state-preserving HMR dev loop.

This repo is the framework code only. The `keep` backend composition layer and any
example app live as separate packages.

## Layout

```
ui/.sprig/
  core.ts                 # signals, DI (Injector/inject), routing, bootstrap().fetch SSR
  compiler/
    parse.ts              # tree-sitter template parsing (loads grammar.wasm)
    node.ts / expr.ts     # AST helpers + expression/pipe interpreter
    render.ts             # SSR render, event binding, escaping, @let scoping
    serialize.ts          # AST (de)serialization for client hydration
    scope.ts              # CSS view-encapsulation (scopeCss / scopeId)
    mod.ts                # component registry, page assembly, static-page assert
    build.ts              # island code-split + per-component CSS scoping
    island.ts             # island definition + setup() injector wiring
    hydrate.ts            # client runtime: hydration, delegation, reactive updates, soft-nav
    dev.ts / hmr.ts       # dev server + hot template/CSS swap (SSE)
    grammar.wasm          # compiled Angular-template tree-sitter grammar
    compiler.test.ts      # framework unit tests
tree-sitter-angular-template/  # grammar source (regenerate grammar.wasm from here)
```

## Test

```
deno task test            # deno test -A ui/.sprig/compiler/compiler.test.ts
```
