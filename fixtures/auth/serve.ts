// UI host with the standalone /auth gateway (no keep backend): sprigUi serves the
// build's assets at /ui/_assets/* + the SSR app; sprigAuth mounts the same-origin
// /auth endpoints the built-in login()/getUserData()/logout() client calls, proxying
// to the baked-in infra control plane (sessionless legacy mode without keep).
//   deno task build && deno task start     — prod-style, prebuilt templates
//   deno task dev                          — dev server + HMR (also mounts /ui + /auth)
import { sprigAuth, sprigUi } from "@mrg-keystone/sprig/keep";
import { sprigApp } from "./src/mod.ts";

const ui = sprigUi({ app: sprigApp }); // default base "/ui"
const auth = sprigAuth(); // baked-in infra URL; no env needed

export default {
  fetch: async (req: Request, info?: Deno.ServeHandlerInfo) =>
    (await auth(req)) ?? (await ui(req, info)) ?? new Response("Not Found", { status: 404 }),
};
