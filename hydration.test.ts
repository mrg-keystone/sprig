/// <reference lib="dom" />
// Hydration e2e: builds the client bundle, boots the real serve.ts handler, and
// drives a headless Chromium to prove an island hydrates and is interactive —
// signals, (click) events, [disabled], and @if all reactive on the client.
// (DOM lib is referenced for the page.evaluate() callbacks that run in the browser.)
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { chromium } from "playwright";
import { buildClient } from "./ui/.sprig/compiler/build.ts";
import { createDevServer } from "./ui/.sprig/compiler/dev.ts";
import { serveSprig } from "@sprig/keep";
import { api } from "@app/backend";
import { app, renderer } from "@app/ui";
import handler from "./serve.ts";

const ROOT = dirname(fromFileUrl(import.meta.url));
// build the client bundle so static/client.js + manifest are fresh
await buildClient(join(ROOT, "ui/src"), join(ROOT, "static"));

Deno.test("hydration: counter island is interactive in a real browser", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 8137, signal: ac.signal, onListen() {} },
    (req, info) => handler.fetch(req, info),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:8137/ui", { waitUntil: "networkidle" });

    const island = 'sprig-island[data-sel="counter"]';
    const value = page.locator(`${island} .counter__value`);
    const plus = page.locator(`${island} button`).filter({ hasText: "+" });
    const minus = page.locator(`${island} button`).filter({ hasText: "−" });
    const badge = page.locator(`${island} .counter__badge`);

    // the island hydrated
    await page.waitForFunction(`document.querySelector('${island}')?.dataset.sprigHydrated === '1'`);

    assertEquals((await value.textContent())?.trim(), "0");
    assert(await minus.isDisabled(), "[disabled]=count()<=0 → disabled at 0");
    assertEquals(await badge.count(), 0, "@if count()>=5 hidden at 0");

    for (let i = 0; i < 6; i++) await plus.click();
    assertEquals((await value.textContent())?.trim(), "6", "(click)=inc() drives the signal");
    assertEquals((await badge.textContent())?.trim(), "🔥 on a roll", "@if becomes true reactively");
    assert(!(await minus.isDisabled()), "[disabled] releases reactively");

    await minus.click();
    await minus.click();
    assertEquals((await value.textContent())?.trim(), "4", "(click)=dec() decrements");
    assertEquals(await badge.count(), 0, "@if becomes false reactively");
  } finally {
    await browser.close();
    ac.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test("soft-nav: Navigation API swaps only the outlet; outside islands persist", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 8138, signal: ac.signal, onListen() {} },
    (req, info) => handler.fetch(req, info),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:8138/ui", { waitUntil: "networkidle" });
    await page.waitForFunction("document.querySelector('header sprig-island')?.dataset.sprigHydrated === '1'");

    assertEquals((await page.locator("main h1").first().textContent())?.trim(), "sprig dashboard");

    // bump the SHELL counter (outside the outlet) to 3
    const counter = page.locator("header sprig-island[data-sel=counter]");
    const plus = counter.locator("button").filter({ hasText: "+" });
    await plus.click();
    await plus.click();
    await plus.click();
    assertEquals((await counter.locator(".counter__value").textContent())?.trim(), "3");

    // soft-navigate to the board via a normal <a href>
    await page.locator('header nav a[href="/ui/board"]').click();
    await page.waitForURL("**/ui/board");

    // the OUTLET content swapped (board now) — wait for the view-transition swap
    await page.waitForFunction("document.querySelector('main h1')?.textContent.trim() === 'sprig board'");
    assert((await page.locator("main").textContent())?.includes("In progress"), "board column rendered");

    // the shell counter PERSISTED its state → it was a soft-nav, not a full reload
    assertEquals(
      (await counter.locator(".counter__value").textContent())?.trim(),
      "3",
      "outside island kept its state across the soft navigation",
    );
  } finally {
    await browser.close();
    ac.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test("m7: per-island code-split — a page loads only its own island chunks", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 8139, signal: ac.signal, onListen() {} },
    (req, info) => handler.fetch(req, info),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let loaded: string[] = [];
    // deno-lint-ignore no-explicit-any
    page.on("requestfinished", (r: any) => {
      const p = new URL(r.url()).pathname;
      if (p.includes("/_assets/")) loaded.push(p.split("/").pop()!);
    });

    // dashboard: counter chunk only, exactly one shared runtime chunk, NO star-rating
    await page.goto("http://localhost:8139/ui", { waitUntil: "networkidle" });
    await page.waitForFunction("document.querySelector('sprig-island[data-sel=counter]')?.dataset.sprigHydrated === '1'");
    assert(loaded.includes("isl.counter.js"), "counter chunk loads on the dashboard");
    assert(!loaded.includes("isl.star-rating.js"), "star-rating chunk is NOT shipped to the dashboard");
    assertEquals([...new Set(loaded.filter((f) => f.startsWith("chunk-")))].length, 1, "exactly one shared runtime chunk");

    // issue page: the star-rating chunk lazy-loads on its `visible` trigger + hydrates + is reactive
    loaded = [];
    await page.goto("http://localhost:8139/ui/issues/SPR-101", { waitUntil: "networkidle" });
    const sr = page.locator('sprig-island[data-sel="star-rating"]');
    await sr.scrollIntoViewIfNeeded();
    await page.waitForFunction("document.querySelector('sprig-island[data-sel=star-rating]')?.dataset.sprigHydrated === '1'");
    assert(loaded.includes("isl.star-rating.js"), "star-rating chunk lazy-loads on the issue page");
    // the issue page renders TWO islands (shell counter + star-rating); they must
    // share ONE runtime chunk, else @sprig/core is duplicated and the injector splits.
    await page.waitForFunction("document.querySelector('sprig-island[data-sel=counter]')?.dataset.sprigHydrated === '1'");
    assert(loaded.includes("isl.counter.js"), "the shell counter chunk also loads on the issue page");
    assertEquals(
      [...new Set(loaded.filter((f) => f.startsWith("chunk-")))].length,
      1,
      "both islands share ONE runtime chunk (no per-island @sprig/core duplication)",
    );
    await sr.locator("button.rating__star").nth(3).click(); // 4th star
    assertEquals((await sr.locator(".rating__label").textContent())?.trim(), "4/5", "rating signal drives the label + lit stars");
    assertEquals(await sr.locator(".rating__star--on").count(), 4);
  } finally {
    await browser.close();
    ac.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test("view encapsulation: components get distinct scope markers; islands keep them after hydration", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 8140, signal: ac.signal, onListen() {} },
    (req, info) => handler.fetch(req, info),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:8140/ui/issues/SPR-101", { waitUntil: "networkidle" });
    const sr = page.locator('sprig-island[data-sel="star-rating"]');
    await sr.scrollIntoViewIfNeeded();
    await page.waitForFunction("document.querySelector('sprig-island[data-sel=star-rating]')?.dataset.sprigHydrated === '1'");

    const r = await page.evaluate(() => {
      const scopeOf = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? (Array.from(el.attributes).map((a) => a.name).find((n) => /^s[0-9a-f]{8}$/.test(n)) ?? null) : "MISSING";
      };
      const issue = scopeOf(".issue"), star = scopeOf(".rating__star"), shell = scopeOf(".shell");
      const starEl = document.querySelector(".rating__star")!;
      return {
        distinct: new Set([issue, star, shell]).size === 3,
        islandHasMarker: typeof star === "string" && /^s[0-9a-f]{8}$/.test(star),
        leak: starEl.matches(`.rating__star[${issue}]`), // issue-page scope must NOT reach a star
        ownScope: starEl.matches(`.rating__star[${star}]`),
        color: getComputedStyle(starEl).color, // scoped rule applied → slate-300, not the inherited body color
      };
    });
    assert(r.distinct, `the 3 components have distinct scope markers (${JSON.stringify(r)})`);
    assert(r.islandHasMarker, "the island keeps its scope marker after the client re-render");
    assertEquals(r.leak, false, "a component's scope cannot reach another component's element");
    assert(r.ownScope, "the island element is reached by its OWN scope");
  } finally {
    await browser.close();
    ac.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test("hmr: editing a template hot-swaps the island while preserving its state (no Vite, no reload)", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-hmr-" });
  await buildClient(join(ROOT, "ui/src"), tmp, { dev: true }); // dev bundle → isolated dir
  // compose the dev server: serveSprig with assets from tmp, wrapped by the watcher/SSE/AST layer
  const devHandler = serveSprig({ keep: api, app, base: "/ui", assetsDir: tmp });
  const dev = createDevServer({ renderer, base: "/ui", outDir: tmp, handler: devHandler });
  const ac = new AbortController();
  const server = Deno.serve({ port: 8141, signal: ac.signal, onListen() {} }, (req, info) => dev.fetch(req, info));
  const tplPath = join(ROOT, "ui/src/shared-components/counter/template.html");
  const original = await Deno.readTextFile(tplPath);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:8141/ui", { waitUntil: "load" }); // NOT networkidle — SSE stays open
    const island = 'sprig-island[data-sel="counter"]';
    await page.waitForFunction(`document.querySelector('${island}')?.dataset.sprigHydrated === '1'`);

    // drive the island to 5 (badge appears via @if count()>=5) — this is the STATE to preserve
    const value = page.locator(`${island} .counter__value`);
    const plus = page.locator(`${island} button`).filter({ hasText: "+" });
    for (let i = 0; i < 5; i++) await plus.click();
    assertEquals((await value.textContent())?.trim(), "5");
    assertEquals((await page.locator(`${island} .counter__badge`).textContent())?.trim(), "🔥 on a roll");

    // EDIT the template on disk → watcher → reparse → SSE → client hot-swap (no reload)
    await Deno.writeTextFile(tplPath, original.replace("🔥 on a roll", "🔥 HMR works"));
    await page.waitForFunction(
      `document.querySelector('${island} .counter__badge')?.textContent.includes('HMR works')`,
      null,
      { timeout: 8000 },
    );
    // STATE PRESERVED: still 5 — it was a hot-swap, not a reload
    assertEquals((await value.textContent())?.trim(), "5", "island state survived the template hot-swap");
  } finally {
    await Deno.writeTextFile(tplPath, original); // restore the repo
    await browser.close();
    dev.close(); // stop the watcher + SSE so the test doesn't leak resources
    ac.abort();
    await server.finished.catch(() => {});
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
