// Phase 5: resolveIslands awaits class-island onServerInit BEFORE the sync render, and
// does so in PARALLEL across independent islands.
import { assert } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { resolveIslands } from "./render.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function islandDef(selector: string, src: string, delay: number, label: string): Promise<any> {
  const template = await parseTemplate(src);
  return {
    selector,
    template,
    scope: "s",
    island: {
      scope: () => ({ label: "(sync)" }),
      trigger: "load",
      resolve: async () => {
        await sleep(delay); // a server fetch
        return { label };
      },
    },
  };
}

Deno.test("resolveIslands awaits class-island onServerInit in PARALLEL", async () => {
  // deno-lint-ignore no-explicit-any
  const defs: Record<string, any> = {
    "a-isl": await islandDef("a-isl", "<p>a</p>", 100, "A"),
    "b-isl": await islandDef("b-isl", "<p>b</p>", 100, "B"),
  };
  const registry = { get: (s: string) => defs[s] };
  const root = await parseTemplate(`<div><a-isl></a-isl><b-isl></b-isl></div>`);
  const resolved = new Map();

  const t = performance.now();
  await resolveIslands(named(root), { scope: {}, registry, source: root.text }, resolved);
  const ms = performance.now() - t;
  console.log(`  two 100ms islands resolved in ${ms.toFixed(0)}ms`);

  assert(resolved.size === 2, `both islands pre-resolved, got ${resolved.size}`);
  const labels = [...resolved.values()].map((s) => (s as { label: string }).label).sort();
  assert(labels.join() === "A,B", `onServerInit ran (labels ${labels})`);
  assert(ms < 170, `parallel (~100ms, not ~200ms sequential), got ${ms.toFixed(0)}ms`);
});

Deno.test("a { setup } island is NOT pre-resolved (no resolve fn) — left to sync render", async () => {
  // deno-lint-ignore no-explicit-any
  const setupIsland: any = {
    selector: "s-isl",
    template: await parseTemplate("<p>s</p>"),
    scope: "s",
    island: { scope: () => ({}), trigger: "load" }, // no `resolve`
  };
  const registry = { get: (s: string) => (s === "s-isl" ? setupIsland : undefined) };
  const root = await parseTemplate(`<div><s-isl></s-isl></div>`);
  const resolved = new Map();
  await resolveIslands(named(root), { scope: {}, registry, source: root.text }, resolved);
  assert(resolved.size === 0, "no class resolve → nothing pre-resolved; sync render handles it");
});
