// Regression for the `?token=` bug: an opaque magic-link token must be EXCHANGED at infra for a
// real session bearer, not stored/forwarded raw (a raw handle fails keep's JWKS verification →
// 401 on every /api call). serveSprig's /auth/exchange gateway is the server half of that fix;
// these drive it with infra stubbed so no network is touched.
import { assert, assertEquals } from "jsr:@std/assert";
import { serveSprig } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

const INFRA = "https://infra.test";
const stubApp = {
  fetch: () => Promise.resolve(new Response("SSR", { status: 200 })),
} as unknown as SprigApp;

function server(exchangePath?: string) {
  return serveSprig({
    keep: {
      backend: { fetch: () => Promise.resolve(new Response("{}")) },
      handler: () => new Response("api", { status: 200 }),
    },
    app: stubApp,
    auth: { infraUrl: INFRA, exchangePath },
  });
}

// Swap global fetch for one that records the infra call and answers it, so the gateway's
// server-to-server exchange is observable without a real infra.
function withInfra(
  answer: (url: string, body: unknown) => Response,
): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return answer(url, body);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

Deno.test("POST /auth/exchange forwards the opaque token to infra and returns the minted bearer", async () => {
  const infra = withInfra(() => new Response(JSON.stringify({ token: "REAL.BEARER" }), { status: 200 }));
  try {
    const srv = server();
    const res = await srv.fetch(
      new Request("http://host/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "opaque-handle-123" }),
      }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { token: "REAL.BEARER" }, "infra's bearer is passed through verbatim");
    // The exchange actually hit infra with the opaque token — it was NOT stored raw.
    assertEquals(infra.calls.length, 1);
    assertEquals(infra.calls[0].url, `${INFRA}/api/authz/exchange`, "default exchange path");
    assertEquals(infra.calls[0].body, { token: "opaque-handle-123" });
  } finally {
    infra.restore();
  }
});

Deno.test("exchangePath override targets a custom infra endpoint", async () => {
  const infra = withInfra(() => new Response(JSON.stringify({ token: "B" }), { status: 200 }));
  try {
    const srv = server("/custom/exchange");
    await srv.fetch(
      new Request("http://host/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t" }),
      }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(infra.calls[0].url, `${INFRA}/custom/exchange`);
  } finally {
    infra.restore();
  }
});

Deno.test("POST /auth/exchange with no token → 400, never calls infra", async () => {
  const infra = withInfra(() => new Response("nope", { status: 500 }));
  try {
    const srv = server();
    const res = await srv.fetch(
      new Request("http://host/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(res.status, 400);
    assertEquals(infra.calls.length, 0, "a bad request must not reach infra");
  } finally {
    infra.restore();
  }
});

Deno.test("GET /auth/exchange → 405 (POST only)", async () => {
  const infra = withInfra(() => new Response("{}"));
  try {
    const srv = server();
    const res = await srv.fetch(
      new Request("http://host/auth/exchange", { method: "GET" }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(res.status, 405);
    assert(res.headers.get("allow")?.includes("POST"));
    await res.body?.cancel();
  } finally {
    infra.restore();
  }
});
