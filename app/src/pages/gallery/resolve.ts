// Gallery page resolver (SSR): the flat index fallback (/components, /pages).
// Groups the discovery cases target → category → folder for the template.
import { inject, type Resolve } from "@sprig/core";
import { DiscoveryService } from "../../services/discovery/mod.ts";
import type { Case } from "../../lib/types.ts";

const PROJECT = Deno.env.get("ISOLATE_PROJECT") ?? "fixtures/sprig-app";
const TITLE: Record<string, string> = { component: "components", page: "pages" };

function groupBy(arr: Case[], key: (c: Case) => string): Record<string, Case[]> {
  const m: Record<string, Case[]> = {};
  for (const x of arr) (m[key(x)] = m[key(x)] || []).push(x);
  return m;
}

export const resolve: Resolve = async (ctx) => {
  const disc = inject(DiscoveryService);
  const { cases, problems } = await disc.manifest(PROJECT);
  const only = ctx.url.pathname.endsWith("/components")
    ? "component"
    : ctx.url.pathname.endsWith("/pages")
    ? "page"
    : null;
  const shown = only ? cases.filter((c) => c.target === only) : cases;

  const order = ["component", "page"];
  const byTarget = groupBy(shown, (c) => c.target);
  const sections = Object.keys(byTarget)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((target) => {
      const byCat = groupBy(byTarget[target], (c) => c.category);
      return {
        target,
        title: TITLE[target] ?? target,
        href: "/" + (TITLE[target] ?? target),
        cats: Object.keys(byCat).sort().map((cat) => {
          const byFolder = groupBy(byCat[cat], (c) => c.folder);
          return {
            cat,
            folders: Object.keys(byFolder).sort().map((folder) => ({
              folder: folder || "—",
              cases: byFolder[folder],
            })),
          };
        }),
      };
    });

  return { sections, problems, count: shown.length, only };
};
