# Data Fetching

> Source: https://fresh.deno.dev/docs/concepts/data-fetching

## TL;DR
Two shapes: (1) export a `handler` from a route file and a default page component; the handler's data flows into `props.data`. (2) Skip the handler entirely and `await` data inside an async page component. `define.handlers` + `define.page` give type inference.

## Recommended (typed) form
```ts
import { define } from "../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const data = await fetchData(ctx.params.id);
    return page({ data });
  },
  async POST(ctx) {
    return page({ success: true });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <h1>{data.project.name}</h1>
));
```
`page()` is the helper that wraps data for the renderer; the `<typeof handler>` generic gives full autocompletion on `data`.

## Async-component form
```ts
export default define.page(async (ctx) => {
  const project = await db.projects.findOne(ctx.params.id);
  return <div>{project.name}</div>;
});
```

## Redirects + custom Response
```ts
GET(ctx) {
  if (!ctx.state.user) return ctx.redirect("/login");
  return page(data, { status: 201, headers: { "Cache-Control": "no-store" } });
}
```
Handlers may also return a raw `Response` directly.

## Page component props
`{ data, url, params, req, state, route, error }`.

## Gotchas
- Returning from `GET` without `page()` or a `Response` won't render anything.
- Type inference relies on `define.handlers` + `define.page<typeof handler>`. Without it, `data` is `unknown`.

## See also
- `advanced/define.md` — `define` helpers
- `concepts/context.md` — `ctx` shape
- `concepts/routing.md`
