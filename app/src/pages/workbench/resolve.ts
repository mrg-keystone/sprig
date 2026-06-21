// Workbench page resolver (SSR): read the discovery manifest in-process and hand
// the flattened cases + problems to the page template (which mounts the shell
// island). projectRoot is the host project being previewed.
import { inject, type Resolve } from "@sprig/core";
import { DiscoveryService } from "../../services/discovery/mod.ts";

const PROJECT = Deno.env.get("ISOLATE_PROJECT") ?? "fixtures/fresh-app";

export const resolve: Resolve = async () => {
  const disc = inject(DiscoveryService);
  const { cases, problems, count } = await disc.manifest(PROJECT);
  return { cases, problems, count };
};
