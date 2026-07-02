// Hidden INFRA perf reporting (perf.ts + the hydrate.ts soft-nav hook): env gating,
// document injection, the exact wire contract, and the soft-nav outcome semantics
// that keep a fallback-to-full-load from double-reporting.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { perfConfig, perfHeadSnippet } from "./perf.ts";
import { perfSend, runSoftNav, type SoftNavDeps, type SprigConfig } from "./hydrate.ts";
import { createRenderer } from "./mod.ts";

const env = (m: Record<string, string>) => ({ get: (k: string) => m[k] });

Deno.test("perf: enabled only by INFRA_PERF=true/1 with INFRA_PERF_URL set", () => {
  assertEquals(perfConfig(env({})), null);
  assertEquals(perfConfig(env({ INFRA_PERF: "false", INFRA_PERF_URL: "http://x/p" })), null);
  assertEquals(perfConfig(env({ INFRA_PERF_URL: "http://x/p" })), null);
  assertEquals(perfConfig(env({ INFRA_PERF: "true" })), null); // no URL → off (warns once)
  assertEquals(perfConfig(env({ INFRA_PERF: "true", INFRA_PERF_URL: "http://x/p" })), { url: "http://x/p", app: "" });
  assertEquals(
    perfConfig(env({ INFRA_PERF: " TRUE ", INFRA_PERF_URL: "http://x/p", INFRA_APP_ID: "app-1" })),
    { url: "http://x/p", app: "app-1" },
  );
  assertEquals(perfConfig(env({ INFRA_PERF: "1", INFRA_PERF_URL: "http://x/p" })), { url: "http://x/p", app: "" });
  // an env read that throws (no --allow-env) means OFF, never a crash
  assertEquals(
    perfConfig({
      get: () => {
        throw new Error("denied");
      },
    }),
    null,
  );
});

Deno.test("perf: head snippet carries the contract and resists </script> breakout", () => {
  assertEquals(perfHeadSnippet(null), "");
  const s = perfHeadSnippet({ url: "https://infra.example/perf?x=</script><script>alert(1)</script>", app: "app-1" });
  assertStringIncludes(s, "navId");
  assertStringIncludes(s, '"infra-app-id"');
  assertStringIncludes(s, "timeOrigin"); // #1 is backdated to the real navigation start
  assertStringIncludes(s, 'addEventListener("load"'); // #2 defers to the load event
  assertStringIncludes(s, "sendBeacon");
  // exactly ONE literal </script> — the tag's own closer; the URL's copies are <-escaped
  assertEquals(s.split("</script>").length, 2);
});

Deno.test("perf: perfSend emits exactly the 4-field payload", () => {
  const sent: Array<{ url: string; body: string }> = [];
  const when = new Date("2026-07-02T10:00:00.000Z");
  perfSend({ url: "http://infra/p", app: "app-1" }, "/ui/two", "nav-1", when, (url, body) => {
    sent.push({ url, body });
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].url, "http://infra/p");
  assertEquals(JSON.parse(sent[0].body), {
    timestamp: "2026-07-02T10:00:00.000Z",
    navId: "nav-1",
    route: "/ui/two",
    "infra-app-id": "app-1",
  });
});

// ── document integration ─────────────────────────────────────────────────────
async function writeTree(tmp: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}

Deno.test("perf: renderDocument ships snippet + config only when the env gate is on", async () => {
  const cwd = Deno.cwd();
  const tmp = await Deno.makeTempDir({ prefix: "sprig-perf-" });
  const saved: Record<string, string | undefined> = {};
  for (const k of ["INFRA_PERF", "INFRA_PERF_URL", "INFRA_APP_ID"]) {
    saved[k] = Deno.env.get(k);
    Deno.env.delete(k);
  }
  try {
    await writeTree(tmp, {
      "static/app.css": "body{color:red}",
      "shell/template.html": `<div><router-outlet></router-outlet></div>`,
      "pages/home/template.html": `<p>hi</p>`,
    });
    Deno.chdir(tmp); // so the renderer can't pick up the repo's static/templates.json

    // OFF (no env): no snippet, no config entry
    let r = await createRenderer(tmp, "/ui");
    let html = await r.renderDocument("pages/home", {});
    assert(!html.includes("infra-app-id"), "disabled: document must not carry the snippet");
    assert(!html.includes('"perf"'), "disabled: __sprig_config must not carry perf");

    // ON: snippet in the head + { url, app } in __sprig_config
    Deno.env.set("INFRA_PERF", "true");
    Deno.env.set("INFRA_PERF_URL", "http://127.0.0.1:9/perf");
    Deno.env.set("INFRA_APP_ID", "test-app");
    r = await createRenderer(tmp, "/ui");
    html = await r.renderDocument("pages/home", {});
    assertStringIncludes(html, '"infra-app-id"');
    assertStringIncludes(html, "http://127.0.0.1:9/perf");
    // the snippet must run BEFORE the stylesheet link (a pending stylesheet blocks
    // inline scripts on the CSSOM — beacon #1 must not wait for the CSS download)
    assert(html.indexOf('"infra-app-id"') < html.indexOf("app.css"), "snippet must precede the stylesheet");
    const cfg = JSON.parse(html.match(/<script type="application\/json" id="__sprig_config">(.*?)<\/script>/s)![1]);
    assertEquals(cfg.perf, { url: "http://127.0.0.1:9/perf", app: "test-app" });

    // streaming path emits the same document
    const stream = r.renderStream("pages/home", {});
    const streamed = await new Response(stream).text();
    assertEquals(streamed, html);
  } finally {
    Deno.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    await Deno.remove(tmp, { recursive: true });
  }
});

// ── soft-nav outcome semantics (what gates the pair's second report) ─────────
type FakeOutlet = { innerHTML: string };
function navEvent(url: string, aborted = false) {
  return { destination: { url }, signal: { aborted }, navigationType: "push", canIntercept: true } as never;
}
function deps(over: Partial<SoftNavDeps> & { assigned?: string[] }): SoftNavDeps {
  const assigned = over.assigned ?? [];
  return {
    fetch: over.fetch ?? (() => Promise.resolve(new Response("<x/>", { headers: { "content-type": "text/html" } }))),
    parse: over.parse ?? ((_h) => ({}) as never),
    outletOf: over.outletOf ?? ((_d) => ({ innerHTML: "next" }) as never),
    assign: over.assign ?? ((u) => assigned.push(u)),
    scrollTo: () => {},
    scrollToTarget: () => false,
    bootstrap: () => {},
    teardown: () => {},
  };
}
const CFG: SprigConfig = { base: "/ui", v: "dev" };

Deno.test("perf/soft-nav: runSoftNav reports swapped / fallback / aborted", async () => {
  const g = globalThis as { document?: unknown };
  const hadDoc = "document" in g;
  const prevDoc = g.document;
  g.document = {}; // runSoftNav reads the current outlet off the document global
  try {
    // committed swap → "swapped" (the only outcome that earns a page-loaded report)
    const cur: FakeOutlet = { innerHTML: "old" };
    const next: FakeOutlet = { innerHTML: "new" };
    let outcome = await runSoftNav(
      navEvent("http://localhost/ui/two"),
      { ...CFG },
      deps({ outletOf: (d) => (d === g.document ? cur : next) as never }),
    );
    assertEquals(outcome, "swapped");
    assertEquals(cur.innerHTML, "new");

    // non-committable response (here: a 500) → real navigation → "fallback"
    const assigned: string[] = [];
    outcome = await runSoftNav(
      navEvent("http://localhost/ui/two"),
      { ...CFG },
      deps({ assigned, fetch: () => Promise.resolve(new Response("boom", { status: 500 })) }),
    );
    assertEquals(outcome, "fallback");
    assertEquals(assigned, ["http://localhost/ui/two"]);

    // missing outlet in the fetched document → "fallback"
    outcome = await runSoftNav(
      navEvent("http://localhost/ui/two"),
      { ...CFG },
      deps({ outletOf: (d) => (d === g.document ? ({ innerHTML: "" } as never) : null) }),
    );
    assertEquals(outcome, "fallback");

    // superseded navigation → "aborted" (no report, no fallback navigation)
    const aborted: string[] = [];
    outcome = await runSoftNav(navEvent("http://localhost/ui/two", true), { ...CFG }, deps({ assigned: aborted }));
    assertEquals(outcome, "aborted");
    assertEquals(aborted, []);
  } finally {
    if (hadDoc) g.document = prevDoc;
    else delete g.document;
  }
});
