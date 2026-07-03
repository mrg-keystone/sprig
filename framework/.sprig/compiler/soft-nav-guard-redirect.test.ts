// Route guards promise (docs/sprig/routing.md "Guards"): a soft-nav that hits a guard
// redirect FALLS BACK TO A FULL NAVIGATION — redirected responses are deliberately not
// soft-swapped, so the browser lands on the redirect target with its URL bar, history
// entry, and full document lifecycle correct. No client-side guard wiring exists; this
// contract is what makes that true. Pinned here because the guards feature leans on it:
// fetch() follows the guard's 302 transparently, so the ONLY signal is r.redirected.
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { outletChain, runSoftNav, type SoftNavDeps, softNavResponseOk, type SprigConfig } from "./hydrate.ts";

/** A Response whose `redirected` reads true — what fetch() returns after transparently
 *  following a guard's 302 (status is the FINAL page's 200; the flag is the only trace). */
function redirectedResponse(body: string): Response {
  const r = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  Object.defineProperty(r, "redirected", { value: true });
  return r;
}

const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

Deno.test("softNavResponseOk: a followed redirect is NOT committable (guard 302 → full nav); a plain page is", () => {
  assertEquals(softNavResponseOk(html("<p>ok</p>")), true, "2xx text/html, not redirected → soft-swap");
  assertEquals(softNavResponseOk(redirectedResponse("<p>login</p>")), false, "redirected → full navigation");
  assertEquals(softNavResponseOk(new Response("nope", { status: 404, headers: { "content-type": "text/html" } })), false);
  assertEquals(softNavResponseOk(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })), false);
});

// deno-lint-ignore no-explicit-any
function navEvent(dest: string): any {
  return { canIntercept: true, hashChange: false, downloadRequest: false, formData: null, navigationType: "push", destination: { url: dest } };
}

Deno.test("runSoftNav on a guard redirect: full navigation to the ORIGINAL destination, outlet untouched", async () => {
  const calls: string[] = [];
  const deps: SoftNavDeps = {
    // the guarded route answers 302 → fetch follows it → redirected login page
    fetch: () => Promise.resolve(redirectedResponse("<sprig-outlet><p>login</p></sprig-outlet>")),
    parse: () => {
      calls.push("parse");
      throw new Error("unreachable");
    },
    outletOf: () => {
      calls.push("outletOf");
      return null;
    },
    outletChainOf: () => {
      calls.push("outletChainOf"); // must NOT be reached on a redirect (early assign+return)
      return [];
    },
    assign: (url) => calls.push("assign:" + url),
    scrollTo: () => calls.push("scrollTo"),
    scrollToTarget: () => false,
    bootstrap: () => calls.push("bootstrap"),
    teardown: () => calls.push("teardown"),
  };
  const cfg: SprigConfig = { base: "/ui", v: "x" };
  await runSoftNav(navEvent("https://app.test/ui/admin"), cfg, deps);
  // location.assign with the destination the USER navigated to — the browser then re-runs
  // the request and follows the guard's 302 natively (URL bar + history end up correct).
  assertEquals(calls, ["assign:https://app.test/ui/admin"], "redirect → assign only; no parse/swap/bootstrap");
});

Deno.test("CONTROL: a committable (non-redirected) page still soft-swaps the outlet, no full nav", async () => {
  const live = new DOMParser().parseFromString(
    `<html><body><sprig-outlet><p>old</p></sprig-outlet></body></html>`,
    "text/html",
  )!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: live });
  const calls: string[] = [];
  try {
    const deps: SoftNavDeps = {
      fetch: () => Promise.resolve(html(`<html><body><sprig-outlet><p>new</p></sprig-outlet></body></html>`)),
      parse: (h) => new DOMParser().parseFromString(h, "text/html") as unknown as Document,
      outletOf: (doc) => (doc as ParentNode).querySelector("sprig-outlet"),
      outletChainOf: (doc) => outletChain(doc as ParentNode),
      assign: (url) => calls.push("assign:" + url),
      scrollTo: () => {},
      scrollToTarget: () => false,
      bootstrap: () => calls.push("bootstrap"),
      teardown: () => calls.push("teardown"),
    };
    const cfg: SprigConfig = { base: "/ui", v: "x" };
    await runSoftNav(navEvent("https://app.test/ui/about"), cfg, deps);
    assert(!calls.some((c) => c.startsWith("assign:")), "committable page must NOT full-navigate");
    assertEquals(calls, ["teardown", "bootstrap"], "the outlet was torn down and re-armed");
    assertEquals(live.querySelector("sprig-outlet")!.innerHTML, "<p>new</p>", "outlet content swapped in place");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});
