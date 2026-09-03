// The renderer injects `<script defer src="<base>/_assets/vendor/apexcharts.js">` into EVERY
// page head (compiler documentHead), so EVERY serving path of a composed app must answer that
// URL from the in-source VENDOR map — the app's build output never contains the vendored libs
// ("the server hands over its own bundled copy; the app never emits it"). serveSprig always
// did; the compose seam (api.compose({ frontend: Frontend() })) and the sprigUi middleware
// fell through to the static dir and 404'd on every page load (infra buglist: "sprig:
// api.compose misses the vendor asset route"). These tests pin all three paths in lockstep.
import { assert, assertEquals } from "jsr:@std/assert";
import { Frontend, serveSprig, sprigUi } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

const fakeApp: SprigApp = {
  fetch: () => Promise.resolve(new Response("SSR", { status: 200 })),
} as unknown as SprigApp;

// a stub keep: an in-process backend fetch + a handler, enough for serveSprig to compose.
function stubKeep() {
  return {
    backend: { fetch: () => Promise.resolve(new Response("{}", { status: 200 })) },
    handler: () => new Response("KEEP", { status: 200 }),
  };
}

const get = (p: string) => new Request("http://host" + p);
const VENDOR_PATH = "/ui/_assets/vendor/apexcharts.js";
const MISSING_VENDOR_PATH = "/ui/_assets/vendor/definitely-not-vendored.js";

async function assertVendorServed(res: Response, who: string) {
  assertEquals(res.status, 200, `${who}: the vendored lib the renderer injects on every page must be served`);
  assertEquals(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert((await res.text()).length > 0, `${who}: non-empty body — the server's own bundled copy`);
}

Deno.test("serveSprig serves the framework-vendored lib from the VENDOR map (the existing guarantee)", async () => {
  const handler = serveSprig({ keep: stubKeep(), app: fakeApp });
  await assertVendorServed(await handler.fetch(get(VENDOR_PATH), {} as Deno.ServeHandlerInfo), "serveSprig");
});

Deno.test("Frontend (the api.compose seam) serves the framework-vendored lib — parity with serveSprig", async () => {
  const handler = Frontend({ app: fakeApp });
  await assertVendorServed(await handler(get(VENDOR_PATH)), "Frontend");
});

Deno.test("sprigUi middleware serves the framework-vendored lib — parity with serveSprig", async () => {
  const ui = sprigUi({ app: fakeApp });
  const res = await ui(get(VENDOR_PATH));
  assert(res, "vendor asset path is ours, never pass-through");
  await assertVendorServed(res!, "sprigUi");
});

Deno.test("an unknown vendored name is a handled 404 on all three paths (never the static-dir fall-through)", async () => {
  const sprigRes = await serveSprig({ keep: stubKeep(), app: fakeApp })
    .fetch(get(MISSING_VENDOR_PATH), {} as Deno.ServeHandlerInfo);
  assertEquals(sprigRes.status, 404);
  await sprigRes.body?.cancel();

  const frontendRes = await Frontend({ app: fakeApp })(get(MISSING_VENDOR_PATH));
  assertEquals(frontendRes.status, 404);
  await frontendRes.body?.cancel();

  const uiRes = await sprigUi({ app: fakeApp })(get(MISSING_VENDOR_PATH));
  assertEquals(uiRes?.status, 404);
  await uiRes?.body?.cancel();
});
