// The /auth gateway has two modes:
//   SESSION MODE (keep.intakeSession present — KEEP_SESSION_KV on): login/exchange mint a server-side
//     session, set the httpOnly `sprig_session` cookie, and return {name,email,grants} — NEVER a
//     bearer. /auth/me reads the profile back off the cookie; /auth/logout destroys it + clears it.
//   LEGACY MODE (no intakeSession): login/exchange proxy to infra and return the bearer verbatim —
//     the original `?token=` fix, kept for non-KV deployments.
import { assert, assertEquals } from "jsr:@std/assert";
import { type KeepApi, serveSprig, type SessionIntake, type SessionMinted, type SessionProfile } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

const INFRA = "https://infra.test";
const stubApp = {
  fetch: () => Promise.resolve(new Response("SSR", { status: 200 })),
} as unknown as SprigApp;

const baseKeep = (): KeepApi => ({
  backend: { fetch: () => Promise.resolve(new Response("{}")) },
  handler: () => new Response("api", { status: 200 }),
});

function server(keep: KeepApi = baseKeep(), exchangePath?: string) {
  return serveSprig({ keep, app: stubApp, auth: { infraUrl: INFRA, exchangePath } });
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

/** A keep whose session engine is on: intakeSession mints a fake id + profile, sessions.read plays
 *  it back, destroySession forgets it. No infra, no network. */
function sessionKeep() {
  const store = new Map<string, SessionProfile>();
  let n = 0;
  const intakes: SessionIntake[] = [];
  const keep: KeepApi = {
    ...baseKeep(),
    intakeSession: (input: SessionIntake): Promise<SessionMinted> => {
      intakes.push(input);
      const id = `sid-${++n}`;
      const grants = input.credentialKind === "opaque" ? ["read"] : ["write"];
      store.set(id, { name: "Ada", email: input.email ?? "ada@x.test", grants });
      return Promise.resolve({ id, creator: "ada@x.test", email: input.email ?? "ada@x.test", grants });
    },
    destroySession: (id: string) => { store.delete(id); return Promise.resolve(); },
    sessions: { read: (id: string) => Promise.resolve(store.get(id) ?? null) },
  };
  return { keep, store, intakes };
}

// ─────────────────────────────── legacy (bearer proxy) mode ───────────────────────────────

Deno.test("legacy: POST /auth/exchange forwards the opaque token to infra and returns the minted bearer", async () => {
  const infra = withInfra(() => new Response(JSON.stringify({ token: "REAL.BEARER" }), { status: 200 }));
  try {
    const res = await server().fetch(
      new Request("http://host/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "opaque-handle-123" }),
      }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { token: "REAL.BEARER" }, "infra's bearer is passed through verbatim");
    assertEquals(res.headers.get("set-cookie"), null, "legacy mode sets no session cookie");
    assertEquals(infra.calls.length, 1);
    assertEquals(infra.calls[0].url, `${INFRA}/api/authz/exchange`, "default exchange path");
    assertEquals(infra.calls[0].body, { token: "opaque-handle-123" });
  } finally {
    infra.restore();
  }
});

Deno.test("legacy: exchangePath override targets a custom infra endpoint", async () => {
  const infra = withInfra(() => new Response(JSON.stringify({ token: "B" }), { status: 200 }));
  try {
    await server(baseKeep(), "/custom/exchange").fetch(
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
    const res = await server().fetch(
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
  const res = await server().fetch(
    new Request("http://host/auth/exchange", { method: "GET" }),
    {} as Deno.ServeHandlerInfo,
  );
  assertEquals(res.status, 405);
  assert(res.headers.get("allow")?.includes("POST"));
  await res.body?.cancel();
});

// ─────────────────────────────── session (httpOnly cookie) mode ───────────────────────────────

Deno.test("session: POST /auth/exchange mints a session, sets the httpOnly cookie, returns the profile — no bearer", async () => {
  const infra = withInfra(() => new Response("infra must not be called", { status: 500 }));
  try {
    const { keep, intakes } = sessionKeep();
    const res = await server(keep).fetch(
      new Request("http://host/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "opaque-handle-123" }),
      }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(res.status, 200);
    const cookie = res.headers.get("set-cookie") ?? "";
    assert(cookie.startsWith("sprig_session=sid-1"), `cookie was: ${cookie}`);
    assert(/HttpOnly/i.test(cookie), "cookie must be HttpOnly");
    assert(/SameSite=Lax/i.test(cookie), "cookie must be SameSite=Lax");
    const body = await res.json();
    assertEquals(body, { name: "ada@x.test", email: "ada@x.test", grants: ["read"] });
    assert(!("token" in body), "the bearer must NEVER reach the browser");
    assertEquals(intakes[0], { credential: "opaque-handle-123", credentialKind: "opaque" });
    assertEquals(infra.calls.length, 0, "keep does the exchange; the gateway must not proxy");
  } finally {
    infra.restore();
  }
});

Deno.test("session: POST /auth/login mints a firebase session and sets the cookie", async () => {
  const { keep, intakes } = sessionKeep();
  const res = await server(keep).fetch(
    new Request("http://host/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "id-tok", email: "ada@x.test" }),
    }),
    {} as Deno.ServeHandlerInfo,
  );
  assertEquals(res.status, 200);
  assert((res.headers.get("set-cookie") ?? "").includes("sprig_session=sid-1"));
  assertEquals(await res.json(), { name: "ada@x.test", email: "ada@x.test", grants: ["write"] });
  assertEquals(intakes[0], { credential: "id-tok", credentialKind: "firebase", email: "ada@x.test" });
});

Deno.test("session: GET /auth/me resolves the cookie → profile; 401 when absent", async () => {
  const { keep } = sessionKeep();
  const srv = server(keep);
  // mint a session first
  const mint = await srv.fetch(
    new Request("http://host/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t" }),
    }),
    {} as Deno.ServeHandlerInfo,
  );
  const id = (mint.headers.get("set-cookie") ?? "").match(/sprig_session=([^;]+)/)?.[1] ?? "";
  await mint.body?.cancel();
  assert(id, "expected a session id");

  const me = await srv.fetch(
    new Request("http://host/auth/me", { headers: { cookie: `sprig_session=${id}` } }),
    {} as Deno.ServeHandlerInfo,
  );
  assertEquals(me.status, 200);
  assertEquals(await me.json(), { name: "Ada", email: "ada@x.test", grants: ["read"] });

  const anon = await srv.fetch(new Request("http://host/auth/me"), {} as Deno.ServeHandlerInfo);
  assertEquals(anon.status, 401);
  assertEquals(await anon.json(), null);
});

Deno.test("session: POST /auth/logout destroys the session and clears the cookie", async () => {
  const { keep, store } = sessionKeep();
  const srv = server(keep);
  const mint = await srv.fetch(
    new Request("http://host/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t" }),
    }),
    {} as Deno.ServeHandlerInfo,
  );
  const id = (mint.headers.get("set-cookie") ?? "").match(/sprig_session=([^;]+)/)?.[1] ?? "";
  await mint.body?.cancel();
  assertEquals(store.size, 1);

  const out = await srv.fetch(
    new Request("http://host/auth/logout", { method: "POST", headers: { cookie: `sprig_session=${id}` } }),
    {} as Deno.ServeHandlerInfo,
  );
  assertEquals(out.status, 204);
  assert(/sprig_session=;.*Max-Age=0/i.test(out.headers.get("set-cookie") ?? ""), "cookie cleared");
  assertEquals(store.size, 0, "the session record is gone");
  await out.body?.cancel();
});

Deno.test("session: /auth/me + /auth/logout work with no infra URL configured (KV-only)", async () => {
  const { keep, store } = sessionKeep();
  // no auth.infraUrl and no INFRA_URL env — the gateway is reached via keep.sessions/destroySession
  const prev = Deno.env.get("INFRA_URL");
  Deno.env.delete("INFRA_URL");
  try {
    store.set("sid-x", { name: "Grace", email: "g@x.test", grants: [] });
    const srv = serveSprig({ keep, app: stubApp });
    const me = await srv.fetch(
      new Request("http://host/auth/me", { headers: { cookie: "sprig_session=sid-x" } }),
      {} as Deno.ServeHandlerInfo,
    );
    assertEquals(me.status, 200);
    assertEquals(await me.json(), { name: "Grace", email: "g@x.test", grants: [] });
  } finally {
    if (prev !== undefined) Deno.env.set("INFRA_URL", prev);
  }
});
