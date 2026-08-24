## 2. AST + wire format

- `Node` (node.ts:5-6) is the six-member structural interface `{ type, text,
  startIndex, endIndex, namedChildren, childForFieldName }`, satisfied by both a
  tree-sitter node and a `JsonNode`. `JsonNode` implements exactly those six and
  deliberately OMITS `childCount`/`child(i)`/`fieldNameForChild` (serialize.ts:47);
  the wasm → wire walker (`toSNode`) instead uses the complementary wasm-only
  surface — `childCount`, `child(i)`, `fieldNameForChild(i)`, `isNamed` — which a
  `JsonNode` can't supply. That asymmetry is why `serialize()` special-cases a
  `JsonNode` input: it round-trips via `toSerialized` instead of re-walking through
  `child(i)` (see below).

- `serialize.ts` wire format — `SNode = { t, s, e, c, n, f }`,
  `SerializedTemplate = { source, root }`. Every wire field is a **stored** copy
  except `text`, which is always **derived**:

  | Wire field | Node-API member it reconstructs | Stored / derived | Rule |
  | --- | --- | --- | --- |
  | `t` | `type` | stored | copied from `node.type` |
  | `s` | `startIndex` | stored | copied from `node.startIndex` |
  | `e` | `endIndex` | stored | copied from `node.endIndex` |
  | *(none)* | `text` | **derived** | `source.slice(s, e)` — never stored |
  | `c` | `child(i)` / `childCount` | stored | ALL children (named + anonymous), in source order |
  | `n` | `namedChildren` | stored | indices into `c` that are named (the named subset, in source order) |
  | `f` | `childForFieldName` | stored | field name → index into `c`; **first-write-wins** on a repeated field name (serialize.ts:36-41) |

  First-write-wins mirrors web-tree-sitter's own `childForFieldName` (also returns
  the first match) — divergence would break hydration, since pipe `argument` is a
  repeated field (worked in the round-trip example below).

  - `serialize` of a `JsonNode` round-trips via `toSerialized` rather than
    re-walking (a `JsonNode` has no `childCount`; re-walking it via `toSNode` would
    yield an empty tree — serialize-jsonnode.test.ts).

- `JsonNode` (serialize.ts:55-86) reimplements the six-member `Node` API over an
  `SNode` + the source string: `type`/`startIndex`/`endIndex` return the stored
  fields, `text` slices `source`, `namedChildren` maps `n` to child `JsonNode`s, and
  `childForFieldName` looks up `f`.

### Round-trip example

Source: `x | slice:1:2` — a pipe with two arguments, the repeated-`argument`-field
case first-write-wins exists for.

```json
{
  "source": "x | slice:1:2",
  "root": {
    "t": "pipe_expression", "s": 0, "e": 13,
    "c": [
      { "t": "identifier", "s": 0, "e": 1, "c": [], "n": [], "f": {} },
      { "t": "|",          "s": 2, "e": 3, "c": [], "n": [], "f": {} },
      { "t": "identifier", "s": 4, "e": 9, "c": [], "n": [], "f": {} },
      { "t": "pipe_argument", "s": 9, "e": 11, "n": [1], "f": {},
        "c": [
          { "t": ":",      "s": 9,  "e": 10, "c": [], "n": [], "f": {} },
          { "t": "number", "s": 10, "e": 11, "c": [], "n": [], "f": {} }
        ] },
      { "t": "pipe_argument", "s": 11, "e": 13, "n": [1], "f": {},
        "c": [
          { "t": ":",      "s": 11, "e": 12, "c": [], "n": [], "f": {} },
          { "t": "number", "s": 12, "e": 13, "c": [], "n": [], "f": {} }
        ] }
    ],
    "n": [0, 2, 3, 4],
    "f": { "expression": 0, "name": 2, "argument": 3 }
  }
}
```

The `:` in each `pipe_argument` is that node's own anonymous child (index 0),
not a root-level sibling — the grammar defines `pipe_argument: seq(":",
_expression)`, so the colon travels with its argument.

- `text` for the root: `source.slice(0, 13)` = `"x | slice:1:2"`.
- `text` for the two `pipe_argument` children: `source.slice(9, 11)` = `":1"` and
  `source.slice(11, 13)` = `":2"` — each argument's text includes its leading
  colon, since the colon is that node's own child, not a sibling's.
- `namedChildren` for the root: `n = [0, 2, 3, 4]` → `[identifier "x", identifier
  "slice", pipe_argument ":1", pipe_argument ":2"]` — the only anonymous root
  child, `|` at index 1, is skipped.
- `childForFieldName("argument")`: `f.argument = 3` → the FIRST `pipe_argument`
  (`":1"`). The second `pipe_argument` (index 4, `":2"`) carries the same field
  name in the grammar but is never written to `f` — first-write-wins means it's
  unreachable by field lookup, though still reachable via `namedChildren`. This is
  exactly why `evalPipe` (expr.ts:192) collects multi-arg pipes by filtering
  `namedChildren` for `type === "pipe_argument"` instead of relying on
  `childForFieldName`.

### Round-trip acceptance criteria (serialization fidelity)

The guarantee `serialize` → `fromSerialized` gives is **serialization fidelity**:
for the SAME source, SAME scope, and SAME render mode, walking the reconstructed
`JsonNode` behaves identically to walking the original wasm tree. It is NOT a claim
that client-mode and server-mode renders match each other — they don't (SSR drops
event bindings and skips static-cache lookups; client mode emits
`data-sprig-<base>` markers — [§4](05-4-render-ts-ssr-semantics.md)). Concretely,
for a wasm tree walked directly vs. the same tree serialized then reconstructed:

1. `text` derived by `source.slice(s, e)` equals the original `node.text`, for
   every node.
2. `namedChildren` reconstructed from `n` equals the tree-sitter `namedChildren`
   (same nodes, same order).
3. `childForFieldName` returns the first match on a repeated field name, on both
   sides.
4. The interpreter (expr.ts/render.ts) emits byte-identical HTML whether it walks
   the tree-sitter node or the reconstructed `JsonNode`, given the same inputs and
   mode.

`compiler.test.ts:89-99` pins exactly this: `fromJson === fromWasm` under the same
scope, the same `RenderOpts`, and the same (SSR, no-handlers) mode — a
serialization-fidelity check, not a client-vs-server equivalence claim.

