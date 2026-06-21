// Gallery page resolver (SSR): same discovery manifest as the workbench, rendered
// as a flat index fallback (/components, /pages).
import { inject, type Resolve } from "@sprig/core";
import { DiscoveryService } from "../../services/discovery/mod.ts";

const PROJECT = Deno.env.get("ISOLATE_PROJECT") ?? "fixtures/fresh-app";

export const resolve: Resolve = async (ctx) => {
  const disc = inject(DiscoveryService);
  const { cases, problems } = await disc.manifest(PROJECT);
  // /components → component cases, /pages → page cases, else all.
  const only = ctx.url.pathname.endsWith("/components")
    ? "component"
    : ctx.url.pathname.endsWith("/pages")
    ? "page"
    : null;
  const shown = only ? cases.filter((c) => c.target === only) : cases;
  return { cases: shown, problems, count: shown.length };
};
