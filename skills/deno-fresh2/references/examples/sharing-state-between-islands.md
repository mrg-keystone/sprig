# Sharing State Between Islands

> Source: https://fresh.deno.dev/docs/examples/sharing-state-between-islands

## TL;DR
Create a signal in a **server-rendered parent** (per request) and pass it to multiple islands. Fresh serializes the signal once; all consumers stay in sync. Don't use module-level signals on the server — they'd leak across users.

## Pattern
```tsx
// routes/index.tsx — server component
import { signal } from "@preact/signals";
import AddToCart from "../islands/AddToCart.tsx";
import Cart from "../islands/Cart.tsx";

export default define.page(() => {
  const cart = signal<string[]>([]);   // per-request, server-side
  return (
    <>
      <AddToCart cart={cart} sku="abc" />
      <Cart cart={cart} />
    </>
  );
});
```

```tsx
// islands/AddToCart.tsx
export default function AddToCart({ cart, sku }) {
  return <button onClick={() => cart.value = [...cart.value, sku]}>Add</button>;
}
```

```tsx
// islands/Cart.tsx
export default function Cart({ cart }) {
  return <ul>{cart.value.map((s) => <li>{s}</li>)}</ul>;
}
```

## DON'T
```ts
// state.ts
export const cart = signal<string[]>([]);  // ❌ shared across all server requests
```

## See also
- `concepts/signals.md`
- `concepts/islands.md`
- `advanced/serialization.md`
