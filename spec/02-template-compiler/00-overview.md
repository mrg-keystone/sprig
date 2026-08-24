# 02 — Template compiler: parse, expressions, SSR render, serialization, CSS scoping

> Subject: `framework/.sprig/compiler/` plus the grammar in `tree-sitter-angular-template/`.
> The defining architectural fact: the interpreter (`node.ts`, `expr.ts`, `render.ts`,
> `serialize.ts`, `scope.ts`, `lifecycle.ts`) carries NO tree-sitter import — identical
> code walks a live tree-sitter node (dev, or whenever no prebuilt AST is found) or a
> reconstructed `JsonNode` (prebuilt AST; always on the client) — full contract in
> [§0](01-0-the-framing-design-fact.md). `parse.ts` is the sole tree-sitter importer and
> is genuinely server-only; the interpreter modules above are ISOMORPHIC — they run
> unchanged on both sides (hydrate.ts drives client re-renders through them; spec 03).
> `mod.ts`, `hash.ts`, `perf.ts`, `island-infer.ts` are server-only orchestration
> (registry/page assembly, asset versioning, telemetry, an unwired inference prototype).
>
> This subsystem owns invariant 3 in full: **escape/entity discipline** — author text
> is always trusted raw, runtime values are always escaped, entity decode is single-pass
> and non-throwing — full contract in [§4](05-4-render-ts-ssr-semantics.md).
>
> Pinned by `let-scope-leak.test.ts`, `static-cache.test.ts`, `serialize-jsonnode.test.ts`,
> and more — full list in
> [§7](08-7-contract-checklist-for-a-refactor-each-pinned-by-a-named-t.md).

