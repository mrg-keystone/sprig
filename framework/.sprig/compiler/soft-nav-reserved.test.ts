// BUG X (LOW) — at base "", softNavShouldSkip's base-containment test degenerates
// (every same-origin path startsWith "/"), so soft-nav intercepts + fetches off-app
// keep-owned routes (/api, /docs) before the outlet fallback. The fix gives softNav a
// set of RESERVED off-app prefixes to skip: a destination at/under a reserved prefix is
// left to the browser (no wasted XHR). The __sprig_config builder defaults `reserved`
// to the keep defaults ["/api", "/docs"] when the createRenderer caller omits it.
import { assert, assertEquals } from "@std/assert";
import { type SprigConfig, softNavShouldSkip } from "./hydrate.ts";

// softNavShouldSkip reads location.origin (Deno has no global `location`). Stub it for
// the duration of a test so a same-origin destination URL is recognized as in-app.
function withLocation<T>(origin: string, fn: () => T): T {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const had = "location" in g;
  const prev = g.location;
  Object.defineProperty(g, "location", { configurable: true, value: { origin, href: origin + "/" } });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(g, "location", { configurable: true, value: prev });
    else delete g.location;
  }
}

// Build a NavEvent stub the way the soft-nav path expects: interceptable, same-origin
// push to `dest`, no hash/download/form (so only the base/reserved logic decides).
// deno-lint-ignore no-explicit-any
function navEvent(dest: string): any {
  return { canIntercept: true, hashChange: false, downloadRequest: false, formData: null, navigationType: "push", destination: { url: dest } };
}

Deno.test("BUG X: at base '', a nav to a RESERVED prefix (/docs, /api/*) is skipped (no soft-nav intercept)", () => {
  const origin = "https://app.test";
  const cfg: SprigConfig = { base: "", v: "x", reserved: ["/api", "/docs"] };
  withLocation(origin, () => {
    // /docs (exact) and /api/foo (under) are keep-owned: MUST be left to the browser.
    assertEquals(
      softNavShouldSkip(navEvent(`${origin}/docs`), cfg, `${origin}/`),
      true,
      "/docs is reserved → skip (no wasted XHR)",
    );
    assertEquals(
      softNavShouldSkip(navEvent(`${origin}/api/foo`), cfg, `${origin}/`),
      true,
      "/api/foo is under a reserved prefix → skip",
    );
  });
});

Deno.test("BUG X: at base '', a real in-app route (/about) is still soft-nav intercepted", () => {
  const origin = "https://app.test";
  const cfg: SprigConfig = { base: "", v: "x", reserved: ["/api", "/docs"] };
  withLocation(origin, () => {
    assertEquals(
      softNavShouldSkip(navEvent(`${origin}/about`), cfg, `${origin}/`),
      false,
      "/about is a real in-app route → intercept (soft-nav)",
    );
    // a reserved prefix must match on a path BOUNDARY, not as a bare string prefix:
    // /apixyz is NOT under /api, so it stays in-app.
    assertEquals(
      softNavShouldSkip(navEvent(`${origin}/apixyz`), cfg, `${origin}/`),
      false,
      "/apixyz is not under /api (boundary-respecting) → intercept",
    );
  });
});

import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

Deno.test("BUG X: __sprig_config defaults `reserved` to the keep defaults when createRenderer omits it", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-reserved-default-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("pages/home/template.html", `<h1>home</h1>`);
    const r = await createRenderer(tmp, "", { dev: true }); // no `reserved` opt → defaults
    const html = await r.renderDocument("pages/home", {});
    const m = html.match(/<script type="application\/json" id="__sprig_config">([^<]*)<\/script>/);
    assert(m, "expected a __sprig_config script in the document tail");
    const cfg = JSON.parse(m![1].replace(/\\u003c/g, "<"));
    assertEquals(cfg.reserved, ["/api", "/docs"], "config builder must default reserved to the keep defaults");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
