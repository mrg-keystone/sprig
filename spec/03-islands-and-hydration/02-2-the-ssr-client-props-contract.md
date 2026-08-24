## 2. The SSR → client props contract

This bridge is the physical embodiment of invariant 2 (spec 00
[§the invariants](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)):
DI never crosses the wire — an island gets its data as serialized inputs (this
contract) or by fetching `/api/*`; there is no third channel.

SSR emits (islandHost, render.ts:19-29):

```html
<sprig-island {scopeAttr} data-sel="<sel>" data-trigger="<trigger>">
  <script type="application/json" class="sprig-props">{...inputs, __mocks, __snapshot}</script>
  ...server-rendered inner HTML...
</sprig-island>
```

`{scopeAttr}` (the island host's own view-encapsulation marker, e.g. `s3f2a91c4`) is
pure CSS-scoping plumbing — unlike `data-sel`/`data-trigger`
([§5](05-5-reactive-update-model.md)/[§7](07-7-soft-navigation-hydrate-ts-500-727.md))
it plays no matching role in hydration; for its derivation, fallback, and CSS
compounding see [02 §6](../02-template-compiler/07-6-supporting-modules.md).

In the props JSON every `<` is the JSON escape sequence backslash-`u003c` (spec 02 [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)
— `JSON.parse` restores `<`; the text can never close the `<script>` element). Client
parses the bridge BEFORE marking hydrated (parse failure leaves the host retry-able,
hydrate.ts:747-755).

The three payload keys:

| key | what it holds | written by | read by | applied when |
| --- | --- | --- | --- | --- |
| `...inputs` (bare keys, spread first) | the island's resolved `@input`s | render.ts:19-29 (`islandHost`) | hydrate.ts, parsed off the bridge before the host is marked hydrated | seeds `entry.setup(clientCtx(inputs))` — [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step 1 |
| `__snapshot` | this render's `snapshotOf(scope)` output, ONLY emitted when the island's `IslandDef.snapshot` boolean flag is true (render.ts:307-309,321; mod.ts:301) | render.ts:19-29 | hydrate.ts:760 | applied via `restore()`, after `setup()` but before first render — [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step 2 |
| `__mocks` | isolate preview's child-component override map (stub / force-props; `MockSpec`, keyed by selector — full render semantics in spec 02 [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)), sourced from the level's `inputs.__mocks` (mod.ts:290-298) | render.ts:298 (shell), render.ts:320 (full island) | hydrate.ts:754 | threaded into every client re-render of this island (hydrate.ts:818); re-emitted by client child-island shells (render.ts:297-299) so late-mounting children keep the overrides |

Reserved-key convention: any key beginning with `__` in the props JSON is
framework-owned (`__snapshot`, `__mocks` today, and any key a later version of this
contract adds); `@input` names must not use this prefix. Both reserved keys are
written conditionally, not unconditionally — `__mocks` only when this render is
under isolate preview, `__snapshot` only when the island's `IslandDef.snapshot`
flag is true (render.ts:319-321) — so a same-named `@input` collides silently
either way, just not the same way: when the framework does emit the reserved key,
it's written after the spread (`{...inputs, __mocks, __snapshot}`, above) and
silently overwrites the colliding `@input`; when the framework does NOT emit it
(a `@input __snapshot` on a non-snapshot island, a `@input __mocks` outside
preview), the reserved key is simply never written, so the colliding `@input`
value survives on the wire under that reserved name — and the client misreads it
as framework data: `hydrate.ts:760` restores it as a snapshot, `hydrate.ts:754`
threads it as a mock map.

Decided (**TARGET, not yet built** — see [§Target](#target-ssr-throws-instead-of-silently-coercing-or-dropping-not-yet-built)
below): an `@input` name beginning with `__` is rejected at build time — the
validation matches the full convention, not just today's two reserved names, so a
future reserved key can never silently overwrite a same-named `@input` that
predates it. Consistent with the framework's existing collision discipline
(global-registry basename collisions already throw, mod.ts:178,479-486, cited here
only as an analogous precedent — no build-time guard for this reserved-key case
exists yet) — silent data loss on a naming collision is worse than a build error.

### As-built: the silent JSON round trip (today)

> **AS-BUILT.** This is what the compiler ships today, not the target below:
> the reserved-key collision above has no build-time guard, and it fails silently
> either way a framework key is or isn't actually emitted (render.ts:319-321): a
> same-named `@input` is silently overwritten when the framework does write that
> reserved key (a `__snapshot`-named `@input` on a `snapshot:true` island, a
> `__mocks`-named `@input` under isolate preview), and otherwise survives on the
> wire under the reserved name, where the client misreads it as framework data
> instead of the `@input` value it actually is. Neither case is rejected.
> `islandHost` (render.ts:19-29) also has no
> JSON-safety guard on `...inputs` — it hands the whole props object straight to
> `JSON.stringify` — and `snapshotOf`/`isSerializable` (lifecycle.ts:25-45) drop a
> non-capturable scope field rather than throwing.
> [§Target](#target-ssr-throws-instead-of-silently-coercing-or-dropping-not-yet-built),
> below, is this contract's refactor goal; none of it exists in the compiler yet.

Type handling differs per key. `...inputs` is a JSON round trip, not a structural
clone: values cross via `JSON.stringify` on the server, `JSON.parse` on the client.

| Server-side value | Arrives on client as | Signaled? |
|---|---|---|
| string / finite number / boolean / `null` | itself, unchanged | n/a — survives the round trip |
| array / plain object built from the row above | same shape, unchanged | n/a — survives the round trip |
| `Date` | ISO string (client gets a string, not a `Date`) | no — silent |
| class instance | plain object (prototype and methods lost) | no — silent |
| `NaN` / `±Infinity` | `null` | no — silent |
| `Map` / `Set` | `{}` (contents dropped) | no — silent |
| `undefined` / function / symbol, **as an object's property value** | dropped — the key is absent from the object | no — silent |
| `undefined` / function / symbol, **as an array element** | `null` — the array's length is preserved | no — silent |

Object and array positions diverge on this last case: the same unsupported value
loses its key when it's a property but leaves a `null` placeholder when it's an
array element.

`__snapshot` is a different layer, not a raw JSON round trip of the scope: it's the
output of `snapshotOf(scope)` (spec 02
[§6](../02-template-compiler/07-6-supporting-modules.md)) — a per-render payload,
computed only when `IslandDef.snapshot` (a boolean flag on the island's definition,
not the payload itself) gates it on — already produced before this contract ever
stringifies it. But `snapshotOf`'s `isSerializable` check is TOP-LEVEL only: a scope
field whose value IS itself a `NaN`/`±Infinity`, a `Set`/`Map`, a function, a symbol,
or `undefined` is dropped at CAPTURE time — that field is simply absent from
`__snapshot`, never mangled into `null` or `{}`, and on `restore()` an absent field is
never `.set()`, so the client-side signal keeps whatever default its own constructor
gave it (lifecycle-snapshot-lossy.test.ts). But a top-level object/array field passes
the check regardless of what it nests — `isSerializable` only confirms `JSON.stringify`
doesn't throw on it — so a scope field like `{open: false, seen: new Map()}` IS
captured into `__snapshot`, and the nested `Map` is then silently coerced (not dropped)
when this contract's own `JSON.stringify(propsObj)` (islandHost, render.ts:26) puts
`__snapshot` on the wire: a nested `Map`/`Set` becomes `{}`, a nested `NaN`/`±Infinity`
becomes `null`, same as the `...inputs` coercion table below. A top-level `Date` or
class instance field is captured the same way — `isSerializable` doesn't throw on
either — and coerced on that same wire stringify (ISO string / plain object with
prototype and methods lost). So `__snapshot` fields are not only cleanly dropped;
a nested or top-level-coercible value survives capture and is then mangled by the
wire stringify exactly like an `@input` — the same top-level-only gap the second
`[DECIDE]` below names.

### Target: SSR throws instead of silently coercing or dropping (not yet built)

> **TARGET, not yet built.** This section is the remove-the-silence refactor
> goal for the coercion table and the `__snapshot`-drop behavior above — it
> replaces that silent path with a located build/render error. Nothing below
> this point exists in `islandHost` or `snapshotOf` today; a builder writing
> the current emission path ships the AS-BUILT coercion/drop behavior above,
> not this throw.

Decided: when an island `@input` isn't JSON-safe, or a scope field isn't
capturable by `snapshotOf`, SSR throws a build/render-time error naming the
offending input or field, rather than silently emitting a mangled `@input`
value or silently dropping a snapshot field — an `@input` that arrives as `{}`
where the server meant a `Map`, and a snapshot field that silently falls back
to the client's own constructor default instead of the server's actual value,
are both the exact class of silent failure this contract exists to prevent.

The JSON-safe / capturable boundary this guard checks, by value type:

| Value type | Boundary verdict | Why |
|---|---|---|
| string / finite number / boolean / `null` / a plain object or array built only from these | passes — JSON-safe | exact round trip today; nothing to guard against |
| `NaN` / `±Infinity` | rejected — throws | today silently becomes `null` (`...inputs`) or is dropped at capture (`__snapshot`); no representation preserves the value |
| `Map` / `Set` | rejected — throws | today silently becomes `{}` (`...inputs`) or is dropped at capture (`__snapshot`) — total content loss |
| `undefined` / function / symbol | rejected — throws | today silently drops the key (object property) or coerces to `null` (array element) |
| `Date` / class instance | open — see below | today silently coerces to an ISO string / a plain object; unlike the rows above, the value itself survives — only its type identity is lost |

> **[DECIDE]** Does the JSON-safe boundary reject `Date`/class-instance `@input`s
> and snapshot fields (the client never gets the original type back), or treat
> today's ISO-string/plain-object coercion as an acceptable pass? Recommended
> default: reject — a `Date` silently arriving as a string is the same class of
> silent type-identity loss this contract exists to name, even though (unlike
> `Map`/`Set`) no data is discarded.
>
> **[DECIDE]** Is the guard top-level-only (checks each `@input`/scope-field
> value itself) or recursive (walks into nested object/array values, e.g. a
> `Map` two levels deep)? Recommended default: recursive — a nested unsupported
> value is exactly as silent as a top-level one, and it's what lets a nested
> `Map` slip past `isSerializable`'s existing top-level-only check today.

Golden path — a `cart-badge` island with inputs `{count: 3, label: "Item < 5"}` and a
server snapshot `{open: false}`:

1. SSR emits (shown here as the DECODED JSON value for readability; on the wire the
   `<` in `label` is not a literal `<` — it's the six-character escape sequence
   backslash-`u003c` from above, so the `<script>` tag can't be closed early):
   ```html
   <sprig-island s3f2a91c4 data-sel="cart-badge" data-trigger="load">
     <script type="application/json" class="sprig-props">{"count":3,"label":"Item < 5","__snapshot":{"open":false}}</script>
     ...server-rendered inner HTML...
   </sprig-island>
   ```
2. Client: the chunk loads, parses the bridge — `JSON.parse` restores `label` to
   `"Item < 5"` — BEFORE marking the host hydrated.
3. `entry.setup(clientCtx({count: 3, label: "Item < 5"}))` seeds the `count` and
   `label` signals ([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step 1).
4. `restore({open: false})` sets the `open` signal ([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step 2).
5. First `effect` render paints the badge with `count=3`, `label="Item < 5"`, closed —
   no `__mocks` here, since this island isn't under isolate preview.

### Acceptance criteria

The silent-failure-prevention rules this contract decides, bounded to a checkable
guarantee each. All three rows below are TARGET: the reserved-key rejection decided
above and the JSON-safety [Target](#target-ssr-throws-instead-of-silently-coercing-or-dropping-not-yet-built)
throw are not yet built; marked inline.

| Guarantee | Input | Expected outcome |
|---|---|---|
| **(target, not yet built)** An `@input` can't collide with a reserved key | an island declares `@input __snapshot` (or any other `__`-prefixed name) | build-time error naming the input — today (as-built) it fails silently instead, one of two ways: the framework's reserved key overwrites the `@input` when it's actually emitted (e.g. `__snapshot` on a `snapshot:true` island), or the `@input` value survives on the wire under the reserved name and the client misreads it as framework data (e.g. `__snapshot` on a non-snapshot island) |
| **(target, not yet built)** A non-JSON-safe `@input` never silently mangles | an `@input` bound to a `Map`, a `Set`, or another non-JSON-safe value | build/render-time error naming the offending input |
| **(target, not yet built)** A scope field `snapshotOf` can't capture never silently drops | a scope field of a type `snapshotOf` can't serialize | build/render-time error naming the offending field |
| A corrupted props bridge never permanently strands the island | truncated or invalid JSON in `script.sprig-props` | `JSON.parse` throws before the host is marked hydrated — the host stays un-hydrated and retry-able, never a dead island |
| The bridge JSON can never prematurely close its own `<script>` element | an `@input` or snapshot value containing the literal text `</script>` | every `<` is escaped to the six-character sequence backslash-`u003c` before the bridge is emitted (spec 02 [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md) criterion 7) — the literal sequence `</script>` never appears inside the bridge |

