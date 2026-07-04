// UI-only host (no keep backend): sprigUi serves the build's assets at
// /ui/_assets/* and delegates every other /ui request to the SSR app (where the
// guards run).
//   deno task build && deno task start     — prod-style, prebuilt templates
//   deno task dev                          — dev server + HMR (also mounts /ui)
import { sprigUi } from "@mrg-keystone/sprig/keep";
import { sprigApp } from "./src/mod.ts";

const ui = sprigUi({ app: sprigApp }); // default base "/ui"

export default {
  fetch: async (req: Request, info?: Deno.ServeHandlerInfo) =>
    (await ui(req, info)) ?? new Response("Not Found", { status: 404 }),
};
