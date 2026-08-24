## 0. The framing design fact

The interpreter (`node.ts`/`expr.ts`/`render.ts`/`serialize.ts`/`scope.ts`/
`lifecycle.ts`) has **no tree-sitter import**: the identical interpreter code walks
whichever backing satisfies the structural `Node` interface (node.ts:1-6). Backing and
tree-sitter's presence at runtime are a function of execution context:

| Context | AST backing | tree-sitter module loaded in this process |
|---|---|---|
| dev server, at boot | `JsonNode` (`sprig dev` always runs its own build before `createRenderer` boots — [§5](06-5-mod-ts-registry-page-assembly-renderer.md)/spec 05 [§6](../05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md) — so `templates.json` is already sitting in `$SPRIG_ASSETS_DIR` by the time the boot-time lookup runs) | **loaded** — the in-process build (`buildClient()`, run inside the dev server process itself) statically imports `parse.ts` → `web-tree-sitter` and parses before boot; the boot-time render path still walks the resulting `JsonNode`, not a live parse |
| dev server, after an HMR template edit | live tree-sitter node, for the reparsed component only (lazy import — [§5](06-5-mod-ts-registry-page-assembly-renderer.md)'s `reparse`, driven by spec 05 [§6](../05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md)'s `template.html` row) | loaded — resolves the module already loaded by the boot-time in-process build, not a fresh import |
| prod, `templates.json` found | `JsonNode` | not loaded — `sprig build` runs as a separate process from the deployed serving process (`deno serve serve.ts`); the serving process never imports `parse.ts` |
| prod, `templates.json` missing | live tree-sitter node (lazy import) | loaded |
| client | `JsonNode` | never loaded |

Dev and prod are not symmetric here: dev's "not loaded"-looking boot row is a build that
ran *in-process*, so tree-sitter is already resident in the dev server process at boot —
only the render/walk path stays off it. Prod's build is a genuinely separate process, so
"not loaded" there is a true claim about what a deployment can strip: the serving
process never pulls tree-sitter/wasm in at all when `templates.json` resolves.

`parse.ts` is the sole static importer of `web-tree-sitter` (top-level `import`);
`mod.ts` never statically imports it but reaches it transitively via a lazy dynamic
`import()` of `parse.ts` when a live parse is needed (mod.ts:14-15). No other module in
the interpreter imports it, statically or dynamically. The `templates.json` lookup that
decides which prod row applies is not infallible — it can miss under the composed
monorepo layout and fall back to live parse; [§5](06-5-mod-ts-registry-page-assembly-renderer.md)
(mod.ts) is authoritative for that lookup/fallback behavior.

This backing-agnostic seam is why it's §0, not a footnote: it's what the rest of this
spec leans on. One structural `Node` interface means a single interpreter produces the
same output whether it's walking a live wasm parse or a reconstructed `JsonNode`, given
the SAME source, scope, and render mode — the **serialization fidelity**
[§2](03-2-ast-wire-format.md) pins. That is NOT a claim that client-mode and
server-mode renders match each other — they don't (SSR drops event bindings; client
mode emits `data-sprig-<base>` markers) — only that one interpreter, not a
server-only/client-only fork, walks either backing. It also keeps tree-sitter/wasm out
of the browser bundle entirely: per the table above, the client only ever walks a
`JsonNode`, and `parse.ts` is server-only. A refactor must preserve that boundary:
interpreter modules must not import `parse.ts` or `web-tree-sitter`, even transitively
via a convenience re-export — an `import` of `parse.ts` from `render.ts` for
convenience would drag tree-sitter/wasm into the client bundle and couple interpreter
modules to the parse layer this seam keeps decoupled.

