// A logic.ts makes overview an island, so resolve()'s `calls` cross into the page
// as a serialized @input — which is exactly how the protected records end up in
// the SSR HTML (the input bridge) that the server sends to the browser.
import { defineComponent } from "@sprig/core";

interface Call {
  phone: string;
  reason: string;
}

export default defineComponent({
  inputs: ["calls"],
  setup(ctx) {
    const calls = ctx.input<Call[]>("calls", []);
    return { calls, count: () => calls().length };
  },
});
