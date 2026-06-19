# Signals

> Source: https://fresh.deno.dev/docs/concepts/signals

## TL;DR
Preact signals are the preferred state primitive inside islands. Reading `signal.value` (or rendering it directly in JSX) auto-subscribes the consuming component. Mutate via `.value = …`.

## Three flavors
| API | Use for |
|---|---|
| `useSignal(initial)` | Local island state |
| `signal(initial)` | A standalone signal. To **share** it across islands, create it **per request in a server parent** and pass it as a prop — see below. |
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
Create the signal **per request in a server-rendered parent** and pass it as a prop into
each island; Fresh serializes it once and preserves the reference, so the islands stay in
sync:
```tsx
// routes/index.tsx — server component, runs per request
export default define.page(() => {
  const cart = signal<string[]>([]);          // per-request, server-side
  return <><AddToCart cart={cart} /><Cart cart={cart} /></>;
});
```
**Do NOT hoist that signal to module scope** (`export const cart = signal()` in a
`state.ts`). A module-level signal is created **once per server process**, so when it is
read during SSR every visitor shares — and can see — the same value. Module scope is only
safe for state that never touches the server render (purely client-side, set after
hydration). The per-request-parent pattern is the canonical one — full example in
`examples/sharing-state-between-islands.md`.

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
