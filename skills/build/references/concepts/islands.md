# Islands

> Source: https://fresh.deno.dev/docs/concepts/islands

## TL;DR
An island is an interactive Preact component that hydrates client-side. Place it in `islands/` (root) or any `(_islands)/` folder inside `routes/`. Use PascalCase or kebab-case filenames. Props must be serializable; functions cannot be passed.

## Defining an island
```tsx
// islands/Counter.tsx
import { useSignal } from "@preact/signals";

export default function Counter() {
  const count = useSignal(0);
  return <button onClick={() => count.value++}>{count}</button>;
}
```
Use it from any route or component:
```tsx
import Counter from "../islands/Counter.tsx";
export default () => <main><Counter /></main>;
```

## Co-located islands
Place islands next to the routes that use them via `(_islands)`:
```
routes/
  dashboard/
    index.tsx
    (_islands)/
      Chart.tsx
```

## Serializable props (summary)
Props crossing into an island are serialized, so they must be **data, not code**. Supported:
primitives, `Date`/`URL`/`RegExp`, `Map`/`Set`/`Uint8Array`, `Temporal.*`, Preact
**Signals**, server-rendered **JSX** (as children/props), plain objects/arrays of these, and
cycles. **Not** supported: **functions** (keep event handlers inside the island), class
instances, symbols, promises, streams. Full spec + best practices in
`advanced/serialization.md`.

## Nesting
Islands can render other islands. JSX passed as `children` from a server component is rendered server-side and embedded as static HTML inside the island.

## Gotchas
- File must be a default export.
- Importing an island from a non-route file is fine; what matters is that it lives under an islands directory.
- If you accidentally pass a function prop, the build/runtime will error — move the handler inside the island.

## See also
- `concepts/signals.md` — preferred state primitive inside islands
- `advanced/serialization.md` — full serialization spec
