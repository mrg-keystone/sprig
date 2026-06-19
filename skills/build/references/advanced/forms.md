# Forms

> Source: https://fresh.deno.dev/docs/advanced/forms

## TL;DR
Use plain `<form>` elements pointing at a route's POST handler. Read fields via `await ctx.req.formData()`. Redirect with 303 after success (Post/Redirect/Get). Forms work without JS — progressive enhancement is the default.

## Basic POST handler
```ts
// routes/contact.tsx
import { define } from "../utils.ts";
import { page } from "fresh";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email")?.toString();
    // Re-render with an error via page({...}) — NOT ctx.render({...}), which in
    // Fresh 2 takes JSX and crashes on a data object ("Non-JSX element passed…").
    if (!email) return page({ error: "Email required" }, { status: 400 });
    await sendInquiry(email);
    return new Response(null, { status: 303, headers: { Location: "/thanks" } });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <form method="post">
    <input name="email" type="email" required />
    <button>Send</button>
    {data?.error && <p>{data.error}</p>}
  </form>
));
```

## File uploads
Set `encType` and treat values as `File`:
```html
<form method="post" encType="multipart/form-data">
  <input type="file" name="my-file" />
  <button>Upload</button>
</form>
```
```ts
const form = await ctx.req.formData();
const file = form.get("my-file") as File;
const text = await file.text();          // or .arrayBuffer(), .stream()
```

## Always
- Validate types/sizes server-side (don't trust client).
- Add CSRF protection in production — see `plugins/csrf.md`.
- Use 303 (See Other) on successful POST so reload doesn't resubmit.

## See also
- `concepts/data-fetching.md`
- `plugins/csrf.md`
- `advanced/partials.md` — form submits can trigger partial swaps
