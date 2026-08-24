## 1. Template syntax (grammar: `tree-sitter-angular-template/grammar.js`)

Top-level nodes (grammar.js:73-87): `element`, `script_element`, `style_element`,
`self_closing_element`, `erroneous_end_tag`, `text`, `interpolation`, `if_block`,
`for_block`, `switch_block`, `defer_block`, `let_declaration`.

- **Interpolation** `{{ expr }}` — HTML-escaped at render; allowed inside attribute
  values.
- **Attribute forms** (grammar.js:121-222). `binding_name` is one token supporting
  `@anim` (dead syntax — see status table below), dotted (`style.width.px`,
  `attr.xlink:href`, `style.--var`), trailing `.%`:

  | form | syntax | example | note |
  |---|---|---|---|
  | Plain attribute | `attr="value"` | `title="Hello {{name}}"` | value may interpolate |
  | Property binding | `[prop]="expr"` | `[disabled]="isDisabled"` | |
  | Event binding | `(event)="stmt"` | `(click)="save(); dirty = false"` | handler = `;`-separated assignments/expressions |
  | Two-way binding | `[(twoWay)]="expr"` | `[(value)]="name"` | |
  | Structural directive | `*structural="microsyntax"` | `*ngIf="cond"` | dead syntax — see status table below |
  | Template reference | `#ref` | `#input` | dead syntax — see status table below |
  | Template-context local | `let-name` | `let-item` | dead syntax — see status table below |

- **Control flow**:

  | block | form | syntax | example | note |
  |---|---|---|---|---|
  | `@if` | if/else if/else | `@if (cond) {} @else if (cond2) {} @else {}` | `@if (loggedIn) { <p>hi</p> } @else { <p>bye</p> }` | |
  | `@if` | alias | `@if (expr; as alias) {}` | `@if (user$; as user) { {{user.name}} }` | |
  | `@for` | loop + empty | `@for (x of coll; track t) {} @empty {}` | `@for (item of items; track item.id) {} @empty { <p>none</p> }` | |
  | `@for` | local `$index` | `let i = $index` | `@for (x of xs; track x; let i = $index) {}` | |
  | `@for` | local `$count` | `let c = $count` | `@for (x of xs; track x; let c = $count) {}` | |
  | `@for` | local `$first` | `let f = $first` | `@for (x of xs; track x; let f = $first) {}` | |
  | `@for` | local `$last` | `let l = $last` | `@for (x of xs; track x; let l = $last) {}` | |
  | `@for` | local `$even` | `let e = $even` | `@for (x of xs; track x; let e = $even) {}` | |
  | `@for` | local `$odd` | `let o = $odd` | `@for (x of xs; track x; let o = $odd) {}` | |
  | `@switch` | switch/case/default | `@switch (expr) { @case (v) {} @default {} }` | `@switch (status) { @case ('ok') { <p>ok</p> } @default { <p>?</p> } }` | |
  | `@let` | binding | `@let name = expr;` | `@let total = a + b;` | |
  | `@defer` | main block | `@defer (trigger) {}` | `@defer (on viewport) { <heavy-thing/> }` | always renders eagerly, ignoring trigger — see status table below |
  | `@defer` | `@placeholder` | `@placeholder {}` | `@placeholder { <p>loading…</p> }` | dead syntax — see status table below |
  | `@defer` | `@placeholder` params | `@placeholder (minimum <duration>) {}` | `@placeholder (minimum 500ms) { <p>loading…</p> }` | dead syntax — see status table below |
  | `@defer` | `@loading` | `@loading {}` | `@loading { <spinner/> }` | dead syntax — see status table below |
  | `@defer` | `@loading` params | `@loading (minimum <duration>; after <duration>) {}` | `@loading (after 100ms; minimum 500ms) { <spinner/> }` | dead syntax — see status table below |
  | `@defer` | `@error` | `@error {}` | `@error { <p>failed</p> }` | dead syntax — see status table below |
  | `@defer` | trigger `idle` | `on idle` | `@defer (on idle) {}` | dead syntax — see status table below |
  | `@defer` | trigger `immediate` | `on immediate` | `@defer (on immediate) {}` | dead syntax — see status table below |
  | `@defer` | trigger `hover` | `on hover(ref)` — `ref` optional | `@defer (on hover(loadTrigger)) {}` | dead syntax — see status table below |
  | `@defer` | trigger `interaction` | `on interaction(ref)` — `ref` optional | `@defer (on interaction) {}` | dead syntax — see status table below |
  | `@defer` | trigger `viewport` | `on viewport(ref)` — `ref` optional | `@defer (on viewport) {}` | dead syntax — see status table below |
  | `@defer` | trigger `timer` | `on timer(<duration>)` — duration needs a `ms`/`s` unit | `@defer (on timer(2000ms)) {}` | dead syntax — see status table below |
  | `@defer` | trigger `when` | `when (expr)` | `@defer (when isReady) {}` | dead syntax — see status table below |
  | `@defer` | `prefetch` | `prefetch <trigger>` | `@defer (on idle; prefetch on hover) {}` | dead syntax — see status table below |

- **Components**: any non-native tag resolves through the registry; selector = folder
  basename. A `NATIVE` tag set (render.ts:131-142) always renders native (the
  web-component rule). Component-tag attrs become the child's `@inputs`
  (property bindings + two-way + literal attributes — render.ts:243-257).
- **Projection**: `<content>` (may self-close) and `<ng-content>` are aliases; `select`
  attr supports `[attr]`, `.class`, tag; default slot = unmatched nodes; slot children
  are fallback (render.ts:534-572). `<ng-container>` groups without a DOM element.
  `<router-outlet>` → `<sprig-outlet data-level=…>` wrapping `opts.outlet`.
- **Expression atoms**: identifiers, **single-quoted strings only** (double quotes in
  expressions are a deliberate grammar limitation — grammar.js:510-513), decimal/
  scientific numbers, booleans.

### Live/dead status

Every form above either executes at SSR or parses inert — this table is the single
lookup for the refactor's survival contract; nothing outside it is live:

| form | parses? | runs at SSR? | where (non-)execution is owned |
|---|---|---|---|
| Interpolation `{{ expr }}` | yes | yes | HTML-escaped at render — [§4](05-4-render-ts-ssr-semantics.md) |
| Plain attribute, `[prop]` bindings | yes | yes | processed as bindings — [§4](05-4-render-ts-ssr-semantics.md) |
| `(event)` bindings; `[(twoWay)]` on a **native** element | yes | no | events are collected only in CLIENT mode (`opts.handlers`) and wire at hydration; native `[(twoWay)]` is a no-op at SSR — [§4](05-4-render-ts-ssr-semantics.md) |
| `@if`/`@else if`/`@else`, `@for` (loop body), `@switch`/`@case`/`@default`, `@let`, `@defer` (main block) | yes | yes | only `@`-block forms run at SSR — [§4](05-4-render-ts-ssr-semantics.md) |
| Components (non-native tags); `[(twoWay)]` on a **component** tag | yes | yes | resolves through registry; property/two-way bindings + literal attrs become child `@inputs` — render.ts:243-257 |
| Projection (`<content>`/`<ng-content>`, `<ng-container>`, `<router-outlet>`) | yes | yes | slot/child assembly — render.ts:534-572 |
| `*ngIf`/`*ngFor` structural directives + microsyntax | yes | no | no render handler — [§4](05-4-render-ts-ssr-semantics.md) |
| `[@anim]` bindings | yes | no | ignored — no render.ts handler |
| `@defer` triggers (+ `prefetch`) and `@placeholder`/`@loading`/`@error` clauses | yes | no | no code on either side reads them; main block always renders eagerly — [§4](05-4-render-ts-ssr-semantics.md) |
| `#ref`, `let-name` | yes | no | never consulted by render.ts — [§4](05-4-render-ts-ssr-semantics.md)'s binding/control-flow enumeration has no read of either |

This section documents the grammar and runtime as they exist today. DX-IDEAL
[§3.2](../DX-IDEAL/04-3-per-subsystem-ideal.md) rules that this silence is itself the
defect: a post-parse semantic-lint pass must reject or located-warn on
`*ngIf`/`*ngFor`, `[@anim]`, and `@defer`'s triggers/`@placeholder`/`@loading`/`@error`
as build errors, not let them parse silently and never execute. That pass does not
exist yet; until it ships, the inert behavior in the table above is what actually runs.

### Grammar packaging: why `grammar.bin` not `.wasm`

JSR/`deno publish` treats any `.wasm` as a Wasm ES module and rewrites its `env` import
to `./env` on ingest; web-tree-sitter's `Language.load` instantiates raw bytes and
throws on the rewritten form. A non-`.wasm` filename ships as opaque bytes
(parse.ts:21-27). `grammar.bin` is byte-identical to the built
`tree-sitter-angular_template.wasm` (85,949 bytes). Grammar source: `grammar.js` + a
hand-written external C scanner (`src/scanner.c`: open-tag stack, raw-text
script/style, implicit end tags — adapted from tree-sitter-html). Build:
`tree-sitter generate` → `tree-sitter build` → rename.

### parse.ts contract
- `Parser.init()` + `Language.load(bytes)` memoized; bytes read via `Deno.readFile`
  (file:) or `fetch` (served from JSR) (parse.ts:12-37).
- `parseTemplate` **throws on a dirty parse by default** (malformed template never
  ships); `{allowError:true}` for the dev-HMR reparse path. `parseCached` memoizes by
  source string.

