# Define Helpers

> Source: https://fresh.deno.dev/docs/advanced/define

## TL;DR
`define` is an optional helper that wires up TypeScript inference between handlers, pages, layouts, and middleware. Create one `define` per app (typed with your `State`) and import it from every route file.

## Setup
```ts
// utils.ts
import { createDefine } from "fresh";

export interface State {
  user?: { id: string; name: string };
}

export const define = createDefine<State>();
```

## Available helpers
| Helper | Returns |
|---|---|
| `define.middleware(fn)` | Typed middleware |
| `define.handlers({ GET, POST, ... })` | Typed handler object |
| `define.page<typeof handler>(fn)` | Typed page; `props.data` matches handler return |
| `define.layout(fn)` | Typed layout |

## Pattern
```tsx
import { define } from "../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    return page({ data: { foo: "Deno" } });
  },
});

export default define.page<typeof handler>((props) => (
  <h1>I like {props.data.foo}</h1>
));
```

## Why bother
- `props.data.*` autocompletes.
- `ctx.state.*` autocompletes against your declared `State`.
- Cuts repetitive type imports.

## See also
- `concepts/data-fetching.md`
- `concepts/middleware.md`
- `concepts/context.md` — `State` typing
