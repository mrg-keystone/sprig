## One paragraph

**sprig** is a folder-component web framework for Deno: Angular-flavoured templates
compiled via a tree-sitter grammar, rendered to HTML on the server, with **selective
island hydration** (only folders with a `logic.ts` ship JS, one code-split chunk per
island, loaded on a trigger), view-encapsulated CSS, request-scoped dependency
injection, no Vite, an HMR dev loop (state-persistence semantics in
[05-cli-dev-hmr](../05-cli-dev-hmr/00-overview.md) and
[01-core-runtime §5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)),
and a single `{ fetch }` handler
from dev through Deno Deploy. The same repo also contains **isolate** — a
Storybook-style component-testing workbench for sprig apps (itself built ON sprig) —
and the **Claude agent toolchain** (skills + subagent defs) that sprig deploys to
`~/.claude` on install, because the framework is explicitly designed to be driven by
agent fleets.

