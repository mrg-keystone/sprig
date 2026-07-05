// The JSON folder-routing subsystem: `loadRoutes` reads the `routers/root/` entry router's
// routes.json, resolves `guards: ["<name>"]` from `guards/<name>/mod.ts`, and pulls a nested
// router's children from its own `routes.json` — declarative route tables, no imports.
import { assert, assertEquals } from "jsr:@std/assert";
import { dirname, join } from "@std/path";
import { loadRoutes } from "./mod.ts";

const scaffold = async (files: Record<string, string>): Promise<string> => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-json-routing-" });
  for (const [rel, body] of Object.entries(files)) {
    const p = join(tmp, rel);
    await Deno.mkdir(dirname(p), { recursive: true });
    await Deno.writeTextFile(p, body);
  }
  return tmp;
};

Deno.test("loadRoutes: routers/root entry + guards/<name>/mod.ts + nested routers/<name>/routes.json", async () => {
  const tmp = await scaffold({
    // a guard is a folder — mod.ts (+ test.ts); it default-exports a Guard
    "guards/loggedIn/mod.ts": `export default (ctx: { path: string[] }) => ctx.path;`,
    // the entrypoint router's table: a public page + a guarded nested router
    "routers/root/routes.json": JSON.stringify([
      { path: "login", load: "pages/login" },
      { path: "", load: "routers/app", guards: ["loggedIn"] },
    ]),
    // the nested router's own children table
    "routers/app/routes.json": JSON.stringify([{ path: "overview", load: "pages/overview" }]),
  });
  try {
    const routes = await loadRoutes(tmp);
    // entry = the routers/root layout wrapping the app
    assertEquals(routes.length, 1);
    assertEquals(routes[0].load, "routers/root");
    const kids = routes[0].children ?? [];
    assertEquals(kids.map((r) => r.load).sort(), ["pages/login", "routers/app"]);
    // "loggedIn" resolved from guards/loggedIn/mod.ts onto the guarded route
    const app = kids.find((r) => r.load === "routers/app")!;
    assertEquals(app.guards?.length, 1);
    assertEquals(typeof app.guards?.[0], "function");
    // the nested router's children came from routers/app/routes.json
    assertEquals(app.children?.map((r) => r.load), ["pages/overview"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("loadRoutes: legacy src/root.json + guards/<name>/guard.ts still resolve (back-compat)", async () => {
  const tmp = await scaffold({
    "guards/gate/guard.ts": `export default (ctx: { path: string[] }) => ctx.path;`,
    "root.json": JSON.stringify([{ path: "x", load: "pages/x", guards: ["gate"] }]),
  });
  try {
    const routes = await loadRoutes(tmp);
    assertEquals(routes.map((r) => r.load), ["pages/x"]);
    assert(routes[0].guards?.length === 1, "legacy guard.ts did not resolve");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
