// REGRESSION (bug B3 — props-script index skew): the EARLIER nested-island morph tests build
// a parent host whose first child is a <div> — so they never exercise the host's own
// <script class="sprig-props"> hydration bridge. The REAL SSR island host carries that script
// (plus a whitespace separator) as its FIRST child, while the client re-render emits BODY-ONLY
// HTML (no script). Before the fix, morphChildren aligned the full live children — including the
// leading bridge — against the body, a one/two-node skew that landed the live <main> (holding the
// nested island host) opposite the wrong re-render node and replaceChild'd it away, destroying the
// nested island (the counter/like-button "wiped on hydration" symptom). After the fix the
// host-level morph excludes the bridge + blank text, body aligns to body, and correspondsToIslandHost
// preserves the nested host.
import { assertEquals } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { patchInnerHtml } from "./hydrate.ts";

Deno.test("REGRESSION (B3): host morph preserves a nested island even when the host's FIRST child is its <script class=sprig-props> bridge", () => {
  // The live DOM after SSR + child hydration: the home page is itself a root island, and its
  // FIRST child is the props bridge, then a whitespace separator, then the body <main> that
  // contains the already-hydrated <sprig-island data-sel="counter">.
  const html =
    `<html><body>` +
    `<sprig-island data-sel="home" data-trigger="load">` +
      `<script class="sprig-props" type="application/json">{"__snapshot":{"name":"sprig"}}</script>` +
      ` ` + // the SSR separator between the bridge and the body — the source of the skew
      `<main class="home">` +
        `<sprig-island data-sel="counter" data-trigger="load" data-sprig-hydrated="1" id="theCounter">` +
          `<script class="sprig-props" type="application/json">{"count":0}</script>` +
          `<div class="counter"><button>+1</button><span class="count">0</span></div>` +
        `</sprig-island>` +
      `</main>` +
    `</sprig-island>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });

  try {
    const homeHost = doc.querySelector(`sprig-island[data-sel="home"]`)! as unknown as HTMLElement;
    const counterBefore = doc.getElementById("theCounter");
    // deno-lint-ignore no-explicit-any
    (counterBefore as any).__sprigScope = { iAmTheHydratedCounter: true };

    // What renderNodes emits for the home island on the client: BODY ONLY (no props bridge),
    // the nested island as a fresh <sprig-island> shell (matching the island-aware re-render).
    const reRenderBody =
      `<main class="home">` +
        `<sprig-island data-sel="counter" data-trigger="load">` +
          `<script class="sprig-props" type="application/json">{}</script>` +
        `</sprig-island>` +
      `</main>`;

    patchInnerHtml(homeHost, reRenderBody);

    const counterAfter = doc.getElementById("theCounter");
    const stillHydratedCounter = !!doc.querySelector(
      `sprig-island[data-sel="home"] main.home sprig-island[data-sel="counter"]`,
    );
    const counterButton = doc.querySelector(
      `sprig-island[data-sel="counter"] .counter button`,
    );

    // The nested counter island host SURVIVES — same node identity, hydration marker and its
    // server-expanded body (the +1 button) intact — instead of being wiped by the parent morph.
    assertEquals(counterAfter !== null, true, "the hydrated nested counter host survives the host morph");
    assertEquals(stillHydratedCounter, true, "the nested <sprig-island data-sel=counter> is preserved under <main>");
    // deno-lint-ignore no-explicit-any
    assertEquals((counterAfter as any).__sprigScope?.iAmTheHydratedCounter, true, "same node identity preserved");
    assertEquals(counterAfter!.getAttribute("data-sprig-hydrated"), "1", "hydration marker intact");
    assertEquals(counterButton !== null, true, "the counter's +1 button was NOT wiped");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("REGRESSION (B3): inner position skew — interleaved whitespace + bare-tag re-render must not wipe nested island hosts (keyed match)", () => {
  // The realistic case: the parent body has TWO nested island hosts with whitespace text nodes
  // between every element (as a real template renders), while the client re-render emits the
  // body WITHOUT that whitespace and with the nested islands as BARE custom tags. Positional
  // alignment skews — the live counter host lands opposite the wrong re-render node — so the
  // OLD morph replaceChild'd both hydrated hosts away. Keyed island-host matching pins each by
  // data-sel regardless of position, so both survive.
  const html =
    `<html><body>` +
    `<sprig-island data-sel="home" data-trigger="load">` +
      `<script class="sprig-props" type="application/json">{"__snapshot":{}}</script> ` +
      `<main class="home">\n  ` +
        `<h1>Hi</h1>\n  ` +
        `<h2>Counter</h2>\n  ` +
        `<sprig-island data-sel="counter" data-trigger="load" data-sprig-hydrated="1" id="cnt">` +
          `<script class="sprig-props" type="application/json">{"count":0}</script>` +
          `<div class="counter"><button>+1</button><span class="count">0</span></div>` +
        `</sprig-island>\n  ` +
        `<h2>Like</h2>\n  ` +
        `<sprig-island data-sel="like-button" data-trigger="load" data-sprig-hydrated="1" id="lk">` +
          `<script class="sprig-props" type="application/json">{}</script>` +
          `<button class="like-btn">♥ Like</button>` +
        `</sprig-island>\n` +
      `</main>` +
    `</sprig-island>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const homeHost = doc.querySelector(`sprig-island[data-sel="home"]`)! as unknown as HTMLElement;
    // deno-lint-ignore no-explicit-any
    (doc.getElementById("cnt") as any).__sprigScope = { id: "counter" };
    // deno-lint-ignore no-explicit-any
    (doc.getElementById("lk") as any).__sprigScope = { id: "like" };

    // The client re-render: body-only, NO inter-element whitespace, nested islands as BARE tags
    // (the worst case) at shifted positions relative to the whitespace-laden live DOM.
    const reRenderBody =
      `<main class="home">` +
        `<h1>Hi</h1>` +
        `<h2>Counter</h2>` +
        `<counter></counter>` +
        `<h2>Like</h2>` +
        `<like-button></like-button>` +
      `</main>`;

    patchInnerHtml(homeHost, reRenderBody);

    const cnt = doc.getElementById("cnt");
    const lk = doc.getElementById("lk");
    assertEquals(cnt !== null, true, "counter host survives the inner-skew morph");
    assertEquals(lk !== null, true, "like-button host survives the inner-skew morph");
    assertEquals(!!doc.querySelector(`sprig-island[data-sel="counter"] .counter button`), true, "counter +1 button intact");
    assertEquals(!!doc.querySelector(`sprig-island[data-sel="like-button"] .like-btn`), true, "like button intact");
    // and NOT degraded to bare tags (the live symptom)
    assertEquals(doc.querySelector(`main.home > counter`), null, "counter was NOT replaced by a bare <counter>");
    // deno-lint-ignore no-explicit-any
    assertEquals((cnt as any).__sprigScope?.id, "counter", "same counter node identity");
    // deno-lint-ignore no-explicit-any
    assertEquals((lk as any).__sprigScope?.id, "like", "same like node identity");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});
