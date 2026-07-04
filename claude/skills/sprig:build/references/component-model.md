# Component model — logic.ts, lifecycle, signals, DI, state

A component is a **folder**: `template.html` (the view) + optional `logic.ts` (behavior) +
optional `styles.css` (component-scoped). The folder's **basename is its selector** — the
custom tag other templates compose it with (`components/badge/` → `<badge>`). A folder with
a `logic.ts` is an **island** (hydrates on the client); a folder with only `template.html`
is **static** (ships no JS).

## Two ways to write `logic.ts`

**1. A class (preferred for pages + anything with lifecycle/data).** The instance IS the
template scope — its fields and methods are what `{{ }}`, `[prop]`, and `(event)` bind to.

```ts
import { inject } from "@mrg-keystone/sprig";
import State from "../../services/state/mod.ts";

export default class Greeter {
  greeting = "(loading…)";
  state = inject(State);

  onServerInit() { this.greeting = "Hello from the server"; }   // server, before render
  onBrowserInit() { /* after hydration */ }
  greet() { this.greeting = "hi"; }                              // (click)="greet()"
}
```

**2. `defineComponent({ setup })`** — a function returning the reactive scope; good for
small islands built from signals.

```ts
import { defineComponent, signal } from "@mrg-keystone/sprig";

export default defineComponent({
  setup: () => {
    const count = signal(0);
    return { count, inc: () => count.set(count() + 1), dec: () => count.set(count() - 1) };
  },
});
```

Both are valid; pick the class when you want lifecycle hooks or a page's `onServerInit`
data load.

## Lifecycle hooks (class components)

All optional. Order: server render runs `onServerInit`; the client runs `onBrowserInit`
after hydration.

| Hook | Runs | Use for |
|---|---|---|
| `onServerInit()` | server, **before** the template renders (awaited) | load data (often `inject(Backend)`), set fields |
| `onBrowserInit()` | client, **after** hydration | browser-only setup (focus, timers, listeners) |
| `onServerDestroy()` | server, after the render | server-side cleanup |
| `onBrowserDestroy()` | client, when the island is torn down (e.g. soft-nav away) | clear timers/listeners |

**State crosses the wire.** After `onServerInit`, the instance's *serializable* fields are
snapshotted into the page HTML and **re-seeded onto the client instance before
`onBrowserInit`** — so a value set on the server is present in the browser. Only
JSON-serializable values survive (no functions/class instances; non-finite numbers drop).
`onServerInit` may be `async` (its `await`ed data is in the snapshot).

## Signals

`signal`/`computed`/`effect`/`isSignal` from `@mrg-keystone/sprig`. A signal is callable to read
and has `.set`/`.update`:

```ts
const count = signal(0);
count();                       // read → 0
count.set(2); count.update(n => n + 1);
const doubled = computed(() => count() * 2);
effect(() => console.log(count()));   // re-runs on change
```

Templates read signals by calling them: `{{ count() }}`, `[value]="count()"`. Reactive
updates re-render the island in place.

## Optimistic UI (the default for every server write)

**Mandatory** (see SKILL.md): a user action that writes to the server updates the UI
*immediately*, runs the server call in the background, and rolls back only if it fails. The
component must be an **island** (it has a `logic.ts`) so it can react on the client.

The shape is **snapshot → mutate → call → reconcile**:

```ts
import { inject, signal } from "@mrg-keystone/sprig";
import Api from "../../services/api/mod.ts";

export default class Todo {
  items = inject(State).items;          // a signal-backed list the template renders
  error = signal("");
  api = inject(Api);

  async toggle(item) {
    const prev = item.done;             // 1. snapshot what we're about to change
    item.done = !item.done;             // 2. optimistic: update + render NOW
    this.items.update(x => [...x]);     //    nudge the signal so the view re-renders
    try {
      await this.api.setDone(item.id, item.done);   // 3. server, NOT awaited before the UI moved
    } catch {
      item.done = prev;                 // 4. failed → roll back the exact change
      this.items.update(x => [...x]);
      this.error.set("Couldn't save — reverted.");
    }
  }
}
```

Rules of thumb:
- **Capture a precise rollback snapshot** before mutating (the old value, or the removed
  item + its index for a list delete) — roll back to *that*, don't refetch.
- **Don't `await` the server call before the UI changes.** Awaiting first = a spinner, which
  is the thing we're avoiding.
- **Surface failures** — a rollback that's silent looks like the click did nothing. Show a
  toast/inline error.
- **Fall back to a pending/disabled state only when the result is unknowable client-side**
  (server-generated id, payment auth, a fetched result set). Then show a spinner and `await`.
- **Overrides:** an inline `data-note` on the element can demand "wait for the server" or
  "realtime island" — honor it over this default.

## Dependency injection

`@Injectable` registers a class; `inject(Token)` resolves it from the active injector.

```ts
import { Injectable, inject, Backend } from "@mrg-keystone/sprig";

@Injectable({ providedIn: "root", scope: "both" })   // scope: "both" | "server" | "client"
class Api {
  async list() { return inject(Backend).fetch("/things").then(r => r.json()); }
}

// in a component:
const api = inject(Api);          // a root singleton
```

- **`inject()` is synchronous-only** — call it in a constructor, field initializer,
  `onServerInit`, or `setup`, **before any `await`**. Capture deps into fields first.
- **`scope`** keeps DI from crossing the SSR/client boundary: a `"server"` service can't be
  injected on the client (pass its data in as an input instead). `"both"` is shared.
- **`Backend`** is the in-process data client threaded in by the host (`backendClient`) —
  `inject(Backend).fetch("/path")` reads data with no TCP, no token, during SSR.

## StateService — persisted app state

A `StateService` subclass is a DI singleton whose serializable fields persist to
**localStorage** across navigation + full reload, restored on load.

```ts
import { Injectable, StateService } from "@mrg-keystone/sprig";

@Injectable({ providedIn: "root", scope: "both" })
export default class State extends StateService {
  static key = "app";     // STABLE key — class names are minified in prod
  count = 0;
}
```

- `inject(State)` anywhere (pages, islands). Mutate its fields; they're saved on
  navigation (`navigate`/`pagehide`) and restored when the page loads.
- `reset()` restores the constructed defaults **and** removes the saved copy from
  localStorage.
- Server-side it's just defaults (no localStorage); the client overlays the saved values
  after construction — read restored values in `onBrowserInit`, and use a signal field if
  you need the display to update reactively on restore.
- It only persists once a **client-hydrating** component constructs it (an island, or a
  page with a `logic.ts` — both hydrate). A purely static page never runs client code.
