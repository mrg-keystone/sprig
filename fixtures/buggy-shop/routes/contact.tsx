import { define } from "../utils.ts";
import { page } from "fresh";
import { Head } from "fresh/runtime";

export const handler = define.handlers({
  GET(_ctx) {
    return page({ sent: false });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = String(form.get("email") ?? "");
    // No server-side validation — an empty or malformed email is accepted.
    console.log("contact submission:", email);
    // Returns a 200 re-render instead of a 303 redirect — a reload resubmits the form.
    return page({ sent: true });
  },
});

export default define.page<typeof handler>(function Contact({ data }) {
  return (
    <div class="store">
      <Head>
        <title>Contact</title>
      </Head>
      <nav class="nav">
        <a href="/">Home</a>
      </nav>
      <h1>Contact us</h1>
      {data.sent ? <p id="ok" class="ok">Thanks — we'll be in touch.</p> : null}
      <form method="post" class="form">
        <input type="text" name="name" placeholder="Name" />
        <input type="text" name="email" placeholder="Email" />
        <textarea name="message" placeholder="Message"></textarea>
        <button type="submit">Send</button>
      </form>
    </div>
  );
});
