// Repro 2 — why the leak in 01 cannot be closed inside the app's data layer.
//
// resolve() is the only code that runs between "guard passed" and "data rendered".
// But sprig hands resolve() a ResolveCtx of `{ params, url }` ONLY — no request
// headers, so no cookie. The guard is the ONLY layer with the auth signal
// (GuardCtx.headers). Once the guard permits the request, resolve() has nothing to
// re-check against: it cannot tell an authenticated caller from an attacker who
// simply appended `?token=`, so it cannot defensively withhold the records.
//
// This proves the framework fact structurally: it captures the actual object sprig
// passes to resolve() at runtime and asserts `headers` is absent. It THROWS if sprig
// ever grows a header/cookie seam on ResolveCtx (i.e. the gap is closed).
//
// Run from the repo root:
//   deno run -A feedback/03-guard-ssr-data-leak/repro/02-resolve-cannot-see-auth.ts
import { Backend, bootstrap, defineRoutes, inject } from "@sprig/core";
import { createRenderer } from "@sprig/keep";
import { dirname, fromFileUrl, join } from "@std/path";
import { makeBackend } from "./fixture-app/main.ts";

let seenCtxKeys: string[] = [];

const srcDir = join(dirname(fromFileUrl(import.meta.url)), "fixture-app", "src");
const renderer = await createRenderer(srcDir, "/app", {});

// A route whose resolve records exactly what sprig hands it. We provide the resolve
// inline via the legacy `modules` map so this script is self-contained.
const app = bootstrap({
  routes: defineRoutes([{ path: "probe", load: "probe" }]),
  base: "/app",
  renderer,
  modules: {
    probe: {
      resolve: (ctx) => {
        seenCtxKeys = Object.keys(ctx as unknown as Record<string, unknown>).sort();
        // resolve CAN reach the trusted Backend with no auth — but has no request
        // auth signal to gate that access on.
        inject(Backend);
        return {};
      },
    },
  },
});

// Drive a request carrying a cookie AND an Authorization header — neither can reach
// resolve(), which is the whole point.
await app.fetch(
  new Request("http://localhost/app/probe", {
    method: "GET",
    headers: { cookie: "app_auth=1", authorization: "Bearer real-one" },
  }),
  undefined,
  { backend: makeBackend() },
);

console.log(`resolve() received ctx keys: [${seenCtxKeys.join(", ")}]`);

const hasAuthSignal = seenCtxKeys.includes("headers") || seenCtxKeys.includes("cookies") ||
  seenCtxKeys.includes("request") || seenCtxKeys.includes("req");

if (hasAuthSignal) {
  throw new Error(
    "ResolveCtx now exposes a request/header seam — resolve() can re-gate on auth. " +
      "The data-layer defense gap is closed; update this repro.",
  );
}

console.log(`\nGAP (expected): ResolveCtx = { ${seenCtxKeys.join(", ")} } — no headers/cookie.`);
console.log(`The guard (GuardCtx.headers) is the ONLY layer that sees the auth cookie; once`);
console.log(`it passes, resolve() runs with no way to distinguish an authenticated caller`);
console.log(`from an attacker who appended ?token=. Combined with 01, the magic-link`);
console.log(`handshake leaks the first SSR payload by construction.`);
