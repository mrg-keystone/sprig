<sub>[← sprig docs](./README.md)</sub>

# Islands & hydration

A folder becomes an **island** when it has a `logic.ts` whose default export is a
`defineComponent(...)`. Islands are the only things shipped to and hydrated on the client;
everything else is static SSR HTML. Each island ships as its **own code-split chunk**, loaded
on its trigger.

## defineComponent

```ts
// shared-components/counter/logic.ts
import { defineComponent, signal } from "@mrg-keystone/sprig";

export default defineComponent({
  trigger: "visible",          // "load" (default) | "idle" | "visible" | "interaction"
  inputs: ["start"],           // names bound via <counter [start]="3">
  setup: (ctx) => {
    const start = ctx.input<number>("start", 0);
    const count = signal(start());
    return {
      count,
      inc: () => count.set(count() + 1),
      dec: () => count.set(Math.max(0, count() - 1)),
    };
  },
});
```

`setup(ctx)` returns the **reactive scope** the template binds. You may also pass a bare
`setup` function (`defineComponent((ctx) => ({...}))`); `inputs` then defaults to `[]` and
`trigger` to `"load"`.

```html
<!-- shared-components/counter/template.html -->
<div class="counter">
  <button (click)="dec()" [disabled]="count() <= 0">−</button>
  <output>{{ count() }}</output>
  <button (click)="inc()">+</button>
</div>
```

## Reactive primitives (from `@mrg-keystone/sprig`)

Templates read **both** signals and computeds as `name()`.

- `signal(initial)` → a callable **writable** accessor: read `count()`, write
  `count.set(v)` / `count.value = v` / `count.update(prev => …)`.
- `computed(() => …)` → a read-only derived accessor: read `total()`.
- `effect(() => …)` → re-runs when its tracked reads change; returns a disposer.

```ts
const search = signal("");
const palItems = computed(() => all().filter((c) => c.label.includes(search())));
```

## Inputs, outputs, model

`ctx` (a `ComponentCtx`) bridges the component boundary:

```ts
setup: (ctx) => {
  const cases    = ctx.input<Case[]>("cases", []);     // typed @input → Accessor (read-only)
  const onPick   = ctx.output<string>("pick");         // @output → call onPick(value) to emit
  const value    = ctx.model<string>("value", "");     // two-way [(value)] → WritableAccessor
  // ...
}
```

- `ctx.input(name, fallback)` reads a serialized server `@input` and returns an `Accessor`.
  Bind it from the parent with `[name]="expr"`.
- `ctx.output(name)` returns an emitter; `[(x)]`/`(xChange)` wire to the parent.
  *(Note: in v1, cross-island outputs on the client are a no-op stub — outputs resolve during
  SSR composition.)*
- `ctx.model(name, fallback)` is a `WritableAccessor` for two-way `[(name)]`.

Only the names listed in `inputs:` (and bound by the parent) are serialized into the props
bridge. Islands are **leaf interactive units** in v1 — they don't compose child folder-components
on the client.

## Triggers (lazy hydration)

`trigger` decides when the island's chunk is dynamically imported and hydrated:

| trigger | fires when |
|---|---|
| `"load"` (default) | immediately on `client.js` boot |
| `"idle"` | `requestIdleCallback` (falls back to a 200ms timer) |
| `"visible"` | the island scrolls into view (`IntersectionObserver`) |
| `"interaction"` | first `pointerover` / `focusin` on the island |

## The server + client duality

**`setup()` runs on BOTH sides:** once on the server for the initial SSR paint, once on the
client at hydration. The signals created in `setup()` *are* the island's state. Guard any
browser-only side effect:

```ts
const isClient = typeof document !== "undefined";

setup: (ctx) => {
  // ...signals/computeds: run on both sides, fine...

  if (isClient) {
    addEventListener("keydown", onKey);          // client only
    addEventListener("hashchange", syncFromHash);
    effect(() => { if (open()) focusInput(); });  // DOM effects: client only
  }
  return scope;
}
```

Unguarded `window`/`document`/`location` access in `setup()` will throw during SSR (→ HTTP
500). On the server, `inject()` *does* work inside `setup()` (it runs in a server component
injector), but injecting a **server-scoped** token like `Backend` from an island is rejected —
server data must reach islands as serialized `@inputs`. See [data-and-di.md](./data-and-di.md).

## Reactive morphing + event delegation

At hydration the client re-renders the island body inside an `effect`, so **any signal write
re-paints**. It doesn't blow away the DOM: it **morphs** children in place (reusing nodes by
position/tag, syncing attributes/text), so focus, caret, selection, and scroll on unchanged
elements survive a re-render.

`(event)` bindings are **delegated** on the island root: one listener per distinct DOM event
type, dispatching to the matched element's handler (honoring key/modifier chords). Soft-nav
detaches islands inside the swapped outlet and disposes their effects/observers — no leaks.

## Talking to the backend from an island

The `Backend` DI token is **SSR-only**. From client island code, use the network channel:

```ts
const res = await fetch("/api/http/post-test-run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ files }),
});
const j = await res.json();
```

`/api/*` is the token-gated, request-hardened keep handler — see [hosting.md](./hosting.md).

---

**Next:** [styling.md](./styling.md) — view-encapsulated styles.
**See also:** [templates.md](./templates.md) · [data-and-di.md](./data-and-di.md) · [routing.md](./routing.md)
