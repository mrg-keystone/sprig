// FRAMEWORK_LOGGING + the silent-legacy-fallback fix (feedback/bug-auth-silent-legacy-fallback.md
// + feedback/feature-framework-logging.md).
//
// Two behaviors are pinned here:
//   1. ALWAYS ON (default, no env flag): when /auth/login or /auth/exchange degrades to legacy
//      bearer mode (no `sprig_session` cookie), the framework emits ONE warning per (path,reason) —
//      never a silent 200-with-no-cookie again. This is the bug fix.
//   2. GATED (FRAMEWORK_LOGGING on): the full `[fw:auth]`/`[fw:session]`/`[fw:compose]` trace — in
//      particular the "engine surfaced to gateway: intakeSession=<yes|no>" line that would have
//      caught the bug instantly. Exercised in a subprocess because the flag is read once at import.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { sprigAuth, type SessionMinted } from "./mod.ts";

const INFRA = "https://infra.test";
const profile: SessionMinted = { id: "sess_test", creator: "Rafa", email: "rafa@test", grants: [] };

// Answer infra's legacy `/api/session/login` proxy so the fallback path completes (200, no cookie).
function withInfra(): { restore: () => void } {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/api/session/login") || url.endsWith("/api/authz/exchange")) {
      return Promise.resolve(Response.json({ bearer: "legacy.bearer" }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = real; } };
}

// Capture console.warn/error emitted during `fn`.
async function capture(fn: () => Promise<void>): Promise<{ warns: string[]; errors: string[] }> {
  const warns: string[] = [], errors: string[] = [];
  const ow = console.warn, oe = console.error;
  console.warn = (...a: unknown[]) => warns.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = ow;
    console.error = oe;
  }
  return { warns, errors };
}

function loginReq(): Request {
  return new Request("http://localhost/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "fake", email: "rafa@test" }),
  });
}

Deno.test("legacy fallback (store DISABLED) warns once by default — no silent degrade", async () => {
  const infra = withInfra();
  try {
    const auth = sprigAuth({
      infraUrl: INFRA,
      keep: { intakeSession: () => Promise.reject(new Error("Session store is disabled …")) },
    });
    const { warns } = await capture(async () => {
      const res = await auth(loginReq());
      assertEquals(res!.status, 200); // the bug's shape: 200 …
      assertEquals(res!.headers.get("set-cookie"), null); // … with NO cookie
    });
    const legacy = warns.find((l) => /LEGACY bearer mode/.test(l));
    assert(legacy, `expected a legacy-fallback warning, got: ${JSON.stringify(warns)}`);
    assertStringIncludes(legacy!, "/auth/login");
    assertStringIncludes(legacy!, "DISABLED");
    assertStringIncludes(legacy!, "No sprig_session cookie will be set");
  } finally {
    infra.restore();
  }
});

Deno.test("legacy fallback (NO engine) warns by default with the no-intakeSession reason", async () => {
  const infra = withInfra();
  try {
    const auth = sprigAuth({ infraUrl: INFRA, keep: {} }); // no intakeSession at all
    const { warns } = await capture(async () => {
      const res = await auth(loginReq());
      assertEquals(res!.status, 200);
      assertEquals(res!.headers.get("set-cookie"), null);
    });
    const legacy = warns.find((l) => /LEGACY bearer mode/.test(l) && /ABSENT/.test(l));
    assert(legacy, `expected an 'engine ABSENT' warning, got: ${JSON.stringify(warns)}`);
  } finally {
    infra.restore();
  }
});

Deno.test("healthy SESSION MODE sets the cookie and does NOT warn about legacy", async () => {
  const auth = sprigAuth({ infraUrl: INFRA, keep: { intakeSession: () => Promise.resolve(profile) } });
  const { warns } = await capture(async () => {
    const res = await auth(loginReq());
    assertEquals(res!.status, 200);
    assertStringIncludes(res!.headers.get("set-cookie") ?? "", "sprig_session=");
  });
  assertEquals(warns.filter((l) => /LEGACY bearer mode/.test(l)), []);
});

Deno.test("warnOnce dedups: a second identical legacy fallback does not re-warn", async () => {
  const infra = withInfra();
  try {
    // fresh reason key ('opaque' → /auth/exchange, store-disabled) so this test owns its dedup key
    const auth = sprigAuth({
      infraUrl: INFRA,
      keep: { intakeSession: () => Promise.reject(new Error("Session store is disabled …")) },
    });
    const exchangeReq = () =>
      new Request("http://localhost/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "opaque-handle" }),
      });
    const first = await capture(async () => { await auth(exchangeReq()); });
    const second = await capture(async () => { await auth(exchangeReq()); });
    assert(first.warns.some((l) => /\/auth\/exchange → LEGACY/.test(l)), "first exchange should warn");
    assertEquals(second.warns.filter((l) => /\/auth\/exchange → LEGACY/.test(l)), [], "second must be deduped");
  } finally {
    infra.restore();
  }
});

Deno.test("FRAMEWORK_LOGGING=1 narrates the legacy fallback + the engine-surfaced line (subprocess)", async () => {
  // The flag is read once at import, so exercise it in a child process with the env set.
  const modUrl = new URL("./mod.ts", import.meta.url).href;
  const child = `
    import { sprigAuth } from ${JSON.stringify(modUrl)};
    globalThis.fetch = (() => Promise.resolve(Response.json({ bearer: "x" }))) as typeof fetch;
    const auth = sprigAuth({ infraUrl: "https://infra.test", keep: {} }); // no engine → legacy
    await auth(new Request("http://localhost/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "fake", email: "rafa@test" }),
    }));
  `;
  const tmp = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(tmp, child);
  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--config", new URL("../../deno.json", import.meta.url).pathname, tmp],
      env: { FRAMEWORK_LOGGING: "1" },
      stdout: "piped",
      stderr: "piped",
    });
    const { stderr } = await cmd.output();
    const log = new TextDecoder().decode(stderr);
    // the single line that states the /auth/login legacy fallback + its reason (feature acceptance test)
    assertStringIncludes(log, "[fw:auth]");
    assertStringIncludes(log, "LEGACY FALLBACK");
    assertStringIncludes(log, "reason=no-intakeSession");
    // the high-value line that would have caught the bug at a glance
    assertStringIncludes(log, "engine surfaced to gateway: intakeSession=no");
  } finally {
    await Deno.remove(tmp);
  }
});
