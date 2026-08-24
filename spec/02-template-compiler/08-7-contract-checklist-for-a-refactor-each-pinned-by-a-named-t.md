## 7. Contract checklist for a refactor (pinning status per item)

Not every contract below is pinned by a dedicated test — the pinning tier
column shows each item's actual evidence tier (test, source anchor, or bug
ID), not a blanket test-pinning guarantee.

Pinning tier key (owned by [00-overview §7](../00-overview/07-how-to-verify-claims-in-these-specs.md)):
(a) = pinned by a dedicated named test; (b) = source-anchor only, no dedicated
test (unpinned); (c) = bug-ID provenance, untested — falls back to its (b)
anchor.

| # | contract (what to preserve) | pinning tier | pinned by | full contract § |
|---|---|---|---|---|
| 1 | Malformed template throws at build; dev HMR may parse-with-errors but never swaps an ERROR AST in. | (b) | source anchor only, no dedicated test — `parseTemplate`'s throws-by-default contract; `reparse`'s ERROR-AST-swap suppression | [§1](02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md) (parse.ts contract), [§5](06-5-mod-ts-registry-page-assembly-renderer.md) (`reparse`) |
| 2 | Escaping asymmetry (author-raw / runtime-escaped) and single-decode of component `@input` author text. | (c) | bug ID only (bugs E, AC), no dedicated test — falls back to render.ts:590-644's `preEscaped` set (bug E) and `inputText`'s single-decode (bug AC) | [§4](05-4-render-ts-ssr-semantics.md) |
| 3 | Entity decode is single-pass, bounded, non-throwing. | (c) | bug ID only (bug AE), no dedicated test — falls back to render.ts:721-734's `decodeEntities` | [§4](05-4-render-ts-ssr-semantics.md) |
| 4 | `@let`/alias/loop-local scoping is view-local; scope clones preserve prototypes. | (a) | let-scope-leak.test.ts, control-flow-proto-scope | [§4](05-4-render-ts-ssr-semantics.md) |
| 5 | Expression interpreter: single receiver eval, `this` binding rules, non-throwing escapes, astral-safe pipes, Intl-based numeric formatting, LOCAL-midnight date-only parsing. | (c) | bug ID only (bugs G/P1) for the receiver-once/`this`-binding rules, no dedicated test — falls back to §3's call-semantics contract and Acceptance-criteria table | [§3](04-3-expr-ts-the-expression-interpreter.md) |
| 6 | Static cache: def-namespaced keys, non-finite sentinels, unkeyable refusal, impurity = outlet/island/non-native-child. | (a) hit/miss + purity exclusion; (c) key-soundness half | static-cache.test.ts pins the hit/miss, projected-content-excluded, and client-path-excluded contract; the key-soundness fixes themselves (non-finite sentinels, unkeyable refusal, def-namespacing) carry no dedicated test yet, tracked by bugs AA/Z/AD | [§4](05-4-render-ts-ssr-semantics.md) |
| 7a | Serialization: JsonNode round-trip; same-source/same-scope/same-mode JsonNode-vs-wasm serialization fidelity. | (a) | serialize-jsonnode.test.ts (round-trip); compiler.test.ts:89-99 (`fromJson === fromWasm` under the same scope, `RenderOpts`, and mode — serialization fidelity, NOT a client-vs-server byte-identity claim: §0/§2 both disclaim that reading — SSR drops event bindings and client mode emits `data-sprig-<base>` markers) | [§0](01-0-the-framing-design-fact.md), [§2](03-2-ast-wire-format.md) |
| 7b | Serialization: field first-write-wins on a repeated field name (mirrors web-tree-sitter's own `childForFieldName`). | (b) | source anchor only, no dedicated test — serialize.ts:36-41; UNPINNED — latent parity invariant, no observable consumer today: the wire format mirrors wasm's `childForFieldName` first-match semantics, but the only repeated field (pipe `argument`) is read via `namedChildren` in `evalPipe` (expr.ts:192), never via `f`, per §2 — so no existing test, nor a straightforward new render/round-trip test, would catch the `!(fname in f)` guard regressing | [§2](03-2-ast-wire-format.md) |
| 8 | CSS scoping: rightmost-compound only; host/host-context distribution; `:global` escape; opaque at-rules; folder-path-derived scope ids stable across build/SSR/hydration. | (a) rightmost-compound, `:host`/`:host(x)`, `:global`, opaque at-rules, per-component encapsulation; (c) the rest | compiler.test.ts's `scope:` tests pin the (a) group; `:host-context` distribution and the full build/SSR/hydration id-stability round trip carry no dedicated test yet, tracked by bugs T/U/AI | [§6](07-6-supporting-modules.md) |
| 9 | Registry: basename collision throws (global AND page-local); island wins selector ambiguity in `astFor`. | (b) collision-throw; (a) `astFor` ambiguity | the collision-throw (mod.ts:172-174 page-local, 178/479-486 global) is source-anchor only — UNPINNED by a dedicated test; ast-island-selector.test.ts pins the `astFor` island-wins precedence. `static-page-local-clobber.test.ts` pins a DIFFERENT contract — the CLIENT-side page-aware static resolution (bug S), a hydration/spec-03 concern — not the server-side collision-throw here. | [§5](06-5-mod-ts-registry-page-assembly-renderer.md) |
| 10 | Version stamping: pre-await snapshot; env wins; degraded → `"dev"` + warn-once. | (c) | bug ID only (bug M), no dedicated test — falls back to §4's "Version stamping" subsection | [§4](05-4-render-ts-ssr-semantics.md) |

### Known gaps — do NOT pin

The inverse of the table above: behavior this spec documents as an open refactor
decision or a DX-IDEAL-flagged defect, not a contract to freeze. A pinning test for
any of these would lock the design-out tension in as permanent behavior — none of
them belongs in the table above, ever.

- Unrecognized pipe name resolves via silent passthrough (the raw, un-piped value)
  instead of a build error — flagged [DECIDE] at
  [§3](04-3-expr-ts-the-expression-interpreter.md); DX-IDEAL's "remove the silence"
  thesis names this the same silent-inert class the rule guards against.
- Dead syntax — `*ngIf`/`*ngFor` + microsyntax, `[@anim]` bindings, `@defer` triggers/
  `prefetch`/`@placeholder`/`@loading`/`@error` — parses but silently never executes
  ([§1](02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md)) —
  DX-IDEAL rules this silence is itself the defect a post-parse semantic-lint pass
  must reject; that pass doesn't exist yet, so the current parse-then-ignore behavior
  is not a contract to preserve.
- `onServerDestroy` has no production dispatch point outside its own standalone spike
  ([§6](07-6-supporting-modules.md)) — wiring it in or dropping it is an open
  refactor decision; don't pin either the current inertness or a particular
  resolution.
- `island-infer.ts` is a prototype, not wired into the build
  ([§6](07-6-supporting-modules.md)) — adopting or deleting it is an open refactor
  decision; don't pin its current unwired status.
