# Signals

> Source: https://fresh.deno.dev/docs/concepts/signals

## TL;DR
Preact signals are the preferred state primitive inside islands. Reading `signal.value` (or rendering it directly in JSX) auto-subscribes the consuming component. Mutate via `.value = …`.

## Three flavors
| API | Use for |
|---|---|
| `useSignal(initial)` | Local island state |
| `signal(initial)` | Module-level state shared across islands (singleton) |
| `useComputed(fn)` | Derived value that recomputes when its read signals change |

## Local state
```tsx
import { useSignal } from "@preact/signals";

export default function Counter() {
  const count = useSignal(0);
  return <button onClick={() => count.value++}>{count}</button>;
}
```

## Shared state across islands
```ts
// state.ts
import { signal } from "@preact/signals";
export const cart = signal<string[]>([]);
```
Pass the same signal as a prop into multiple islands; Fresh preserves the reference so they stay in sync.

## Computed
```ts
const total = useComputed(() => items.value.reduce((s, i) => s + i.price, 0));
```

## Auto-subscribe in JSX
You can render `{count}` (the signal itself) and Preact tracks the dependency. Only use `.value` when you need the underlying value (math, comparisons, mutations).

## Serialization
A signal passed from server → island has its `.value` extracted on the server and a fresh signal reconstructed on the client (preserving cycles + duplicates).

## Why signals over `useState`
- No `setState` callback boilerplate.
- Sharing across islands works (a `useState` couldn't).
- Finer-grained re-renders.

## See also
- `concepts/islands.md`
- `examples/sharing-state-between-islands.md`
- `advanced/serialization.md`
