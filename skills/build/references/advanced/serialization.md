# Serialization

> Source: https://fresh.deno.dev/docs/advanced/serialization

## TL;DR
Fresh's serializer handles more than JSON for the server→island prop transport. Functions, class instances, symbols, weak collections, promises, and streams cannot cross the boundary.

## Supported
- **Primitives:** string, number, boolean, bigint, null, undefined
- **Special numbers:** `NaN`, `Infinity`, `-Infinity`, `-0`
- **Collections:** arrays (incl. sparse), plain objects, `Map`, `Set`, `Uint8Array`
- **Built-ins:** `Date`, `URL`, `RegExp` (flags preserved)
- **Temporal:** `Instant`, `ZonedDateTime`, `PlainDate`, etc.
- **Reactive:** `Signal`, computed signals
- **JSX:** server-rendered JSX nodes (passed as children/props)
- **Cycles:** circular and duplicate references restored on the client

## NOT supported
- Functions / closures (no way to transfer code)
- Class instances (only the explicitly-supported types)
- Symbols
- `WeakMap` / `WeakSet`
- Promises / streams

## Signals across the wire
- Server reads with `.peek()` so reading doesn't fire effects.
- Client receives a fresh `signal()` initialized to that value.
- Same signal passed into multiple islands stays synchronized — Fresh preserves identity.

## Best practices
- Pass IDs / small slices, not whole datasets.
- Fetch additional data inside the island if needed.
- Keep handlers (functions) inside the island, not as props.

## See also
- `concepts/islands.md`
- `concepts/signals.md`
- `examples/sharing-state-between-islands.md`
