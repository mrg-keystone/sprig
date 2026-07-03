// BUG S (MED) — the build ships static (non-island) component templates to the client
// keyed by BARE selector, and the client componentRegistry is ALSO keyed by bare
// selector. So two same-basename STATIC components (a global shared one + a page-local
// pages/<page>/components/<name>/ one) silently last-write-wins on the client: an island
// that composes that child re-renders with the WRONG template + scope marker, diverging
// from the SSR (whose registryForPage gives each page its own page-local def with a
// distinct path-derived scope). Same-basename ISLANDS already fail loud; only statics
// clobber silently.
//
// FIX: make the client component resolution page-aware, mirroring the server
// registryForPage. The build emits GLOBAL statics keyed by selector (registerComponent)
// PLUS a page-local map page -> { selector -> {template, scope} } (registerPageComponent).
// The client builds a page-aware COMPONENTS registry per island: resolve (page, sel) ->
// page-local def ?? global def. The current page is carried in __sprig_config and onto
// each <sprig-island data-page="…"> host so hydrateIsland resolves children for ITS page.
import { assert } from "@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { parseTemplate } from "./parse.ts";
import { serialize } from "./serialize.ts";
import {
  bootstrapIslands,
  type IslandEntry,
  pageFromConfig,
  registerComponent,
  registerIsland,
  registerPageComponent,
  outletChain,
  runSoftNav,
  type SoftNavDeps,
  type SprigConfig,
} from "./hydrate.ts";

function mockDocument(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
}
// deno-lint-ignore no-explicit-any
const unmockDoc = () => delete (globalThis as any).document;

Deno.test("BUG S: same-basename static card resolves per-page on the client (page-local vs global), no silent clobber", async () => {
  // The build collected TWO statics sharing the basename "card":
  //   - shared/card                       → GLOBAL  (template GLOBAL-CARD, scope sc-global)
  //   - pages/home/components/card        → page-local for "home" (HOME-CARD, scope sc-home)
  // The client registry must keep them DISTINCT (not last-write-wins by selector).
  const globalCard = serialize(await parseTemplate(`<p class="card">GLOBAL-CARD</p>`));
  const homeCard = serialize(await parseTemplate(`<p class="card">HOME-CARD</p>`));
  registerComponent("card", { template: globalCard, scope: "sc-global" });
  registerPageComponent("home", "card", { template: homeCard, scope: "sc-home" });

  // An island whose template composes the static <card>. The SAME island selector is used
  // on both pages; only the host's data-page differs.
  const islandTpl = serialize(await parseTemplate(`<div class="wrap"><card></card></div>`));
  const entry: IslandEntry = { setup: () => ({}), template: islandTpl, scope: "sc-wrap" };

  mockDocument(
    `<html><body>` +
      // home page island → must resolve <card> to the PAGE-LOCAL card
      `<sprig-island data-sel="wrap" data-trigger="load" data-page="home">` +
      `<script class="sprig-props" type="application/json">{}</script>` +
      `</sprig-island>` +
      // about page island (no page-local card) → must resolve <card> to the GLOBAL card
      `<sprig-island data-sel="wrap" data-trigger="load" data-page="about">` +
      `<script class="sprig-props" type="application/json">{}</script>` +
      `</sprig-island>` +
      `</body></html>`,
  );

  try {
    registerIsland("wrap", entry); // hydrates BOTH instances synchronously

    const hosts = document.querySelectorAll("sprig-island");
    const home = hosts[0] as unknown as HTMLElement;
    const about = hosts[1] as unknown as HTMLElement;

    // HOME page: page-local card (HOME-CARD + sc-home), NOT the global one.
    assert(home.innerHTML.includes("HOME-CARD"), "home island must render its PAGE-LOCAL card text");
    assert(home.innerHTML.includes("sc-home"), "home island must render the PAGE-LOCAL card scope marker");
    assert(!home.innerHTML.includes("GLOBAL-CARD"), "home island must NOT render the global card (clobber)");

    // ABOUT page: no page-local card → the GLOBAL card (GLOBAL-CARD + sc-global).
    assert(about.innerHTML.includes("GLOBAL-CARD"), "about island must render the GLOBAL card text");
    assert(about.innerHTML.includes("sc-global"), "about island must render the GLOBAL card scope marker");
    assert(!about.innerHTML.includes("HOME-CARD"), "about island must NOT render home's page-local card");
  } finally {
    unmockDoc();
  }
});

Deno.test("BUG S: an island host WITHOUT data-page falls back to __sprig_config.page (bootstrapIslands)", async () => {
  const globalCard = serialize(await parseTemplate(`<p class="card">GLOBAL-CARD</p>`));
  const homeCard = serialize(await parseTemplate(`<p class="card">HOME-CARD</p>`));
  registerComponent("card", { template: globalCard, scope: "sc-global" });
  registerPageComponent("home", "card", { template: homeCard, scope: "sc-home" });

  const islandTpl = serialize(await parseTemplate(`<div class="wrap2"><card></card></div>`));
  const entry: IslandEntry = { setup: () => ({}), template: islandTpl, scope: "sc-wrap2" };

  // The host has NO data-page; bootstrapIslands(cfg) sets the current page from cfg.page.
  mockDocument(
    `<html><body>` +
      `<sprig-island data-sel="wrap2" data-trigger="load">` +
      `<script class="sprig-props" type="application/json">{}</script>` +
      `</sprig-island>` +
      `</body></html>`,
  );
  try {
    // realistic order: the eager loader runs first (sets currentPage from cfg + arms the
    // host), then the island chunk self-registers and hydrates the pending instance.
    bootstrapIslands({ base: "/ui", v: "1", page: "home" } as SprigConfig);
    registerIsland("wrap2", entry);
    const host = document.querySelector("sprig-island") as unknown as HTMLElement;
    assert(host.innerHTML.includes("HOME-CARD"), "island with no data-page resolves <card> via cfg.page=home → page-local");
    assert(!host.innerHTML.includes("GLOBAL-CARD"), "must not clobber to the global card");
  } finally {
    unmockDoc();
  }
});

Deno.test("BUG S: soft-nav threads the NEW page into cfg so swapped-in islands resolve per the new page", async () => {
  const globalCard = serialize(await parseTemplate(`<p class="card">GLOBAL-CARD</p>`));
  const homeCard = serialize(await parseTemplate(`<p class="card">HOME-CARD</p>`));
  registerComponent("card", { template: globalCard, scope: "sc-global" });
  registerPageComponent("home", "card", { template: homeCard, scope: "sc-home" });

  const islandTpl = serialize(await parseTemplate(`<div class="wrap3"><card></card></div>`));
  const entry: IslandEntry = { setup: () => ({}), template: islandTpl, scope: "sc-wrap3" };

  // Current document is the ABOUT page (cfg.page = "about"); its outlet is empty.
  mockDocument(`<html><body><sprig-outlet></sprig-outlet></body></html>`);

  // The fetched (next) HOME document: its config says page "home", and its outlet holds a
  // wrap3 island composing <card>. After the swap that island must render the page-local card.
  const nextHtml =
    `<html><body><sprig-outlet>` +
    `<sprig-island data-sel="wrap3" data-trigger="load">` +
    `<script class="sprig-props" type="application/json">{}</script>` +
    `</sprig-island>` +
    `</sprig-outlet>` +
    `<script type="application/json" id="__sprig_config">{"base":"/ui","v":"1","page":"home"}</script>` +
    `</body></html>`;

  const cfg: SprigConfig = { base: "/ui", v: "1", page: "about" };
  // a real-ish navigate event + deps (no view transition; synchronous swap)
  const e = {
    canIntercept: true,
    destination: { url: "https://x/ui/home" },
    navigationType: "push",
    signal: { aborted: false },
  };
  const deps: SoftNavDeps = {
    fetch: () => Promise.resolve(new Response(nextHtml, { status: 200, headers: { "content-type": "text/html" } })),
    parse: (html) => new DOMParser().parseFromString(html, "text/html")! as unknown as Document,
    outletOf: (doc) => doc.querySelector("sprig-outlet"),
    outletChainOf: (doc) => outletChain(doc),
    assign: () => {},
    scrollTo: () => {},
    scrollToTarget: () => false,
    bootstrap: (root) => bootstrapIslands(cfg, root),
    teardown: () => {},
    pageOf: (doc) => pageFromConfig(doc),
  };

  try {
    // sanity: pageFromConfig reads the new page off the parsed doc
    assert(pageFromConfig(new DOMParser().parseFromString(nextHtml, "text/html")! as unknown as ParentNode) === "home", "pageFromConfig reads page=home");

    registerIsland("wrap3", entry); // entry available before the swap
    await runSoftNav(e, cfg, deps);

    const host = document.querySelector("sprig-island") as unknown as HTMLElement;
    assert(host, "the home island was swapped into the outlet");
    assert(host.innerHTML.includes("HOME-CARD"), "after soft-nav to home, the island resolves <card> to the page-local card");
    assert(!host.innerHTML.includes("GLOBAL-CARD"), "after soft-nav to home it must NOT render the global card");
  } finally {
    unmockDoc();
  }
});
