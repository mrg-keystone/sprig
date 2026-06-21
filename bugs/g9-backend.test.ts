// Group g9-backend — bugs 14, 15, 16, 19, 43, 44, 50, 89.
// All in the board backend (backend/src/board/**). We drive the REAL composed
// handler from ../serve.ts (which mounts @app/backend under /api) via
// handler.fetch(new Request(...)) — the same network seam the sprig UI uses.
import { assert, assertEquals } from "@std/assert";
import handler from "../serve.ts";

const INFO = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 12345 },
  completed: Promise.resolve(),
} as unknown as Deno.ServeHandlerInfo;

const fetchH = (req: Request) => handler.fetch(req, INFO);

const jsonPost = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const post = (path: string, body: unknown) => fetchH(jsonPost(path, body));

// ─────────────────────────────────────────────────────────────────────────────
// bug 14: well-formed but unknown resource id -> 404 (not 500). The input PASSES
// validation (non-empty string), so this is the not-found path, not the empty
// validation gap. Both issue and user are covered.
Deno.test("bug 14: unknown well-formed id -> 404 not 500", async () => {
  // control: a valid id still returns 200 (proves input passes validation)
  const ok = await post("/api/http/issue", { issueId: "SPR-101" });
  assertEquals(ok.status, 200, "valid id should still be 200");
  await ok.body?.cancel();

  const r1 = await post("/api/http/issue", { issueId: "SPR-999" });
  assertEquals(r1.status, 404, "unknown issue id should be 404, not 500");
  await r1.body?.cancel();

  const r2 = await post("/api/http/user", { userId: "nobody" });
  assertEquals(r2.status, 404, "unknown user id should be 404, not 500");
  await r2.body?.cancel();
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 15: empty-string and whitespace-only issueId/userId are malformed input
// and must be rejected at the validation seam with 422 (not 500).
Deno.test("bug 15: empty/whitespace id -> 422 not 500", async () => {
  for (const [path, body] of [
    ["/api/http/issue", { issueId: "" }],
    ["/api/http/issue", { issueId: "   " }],
    ["/api/http/user", { userId: "" }],
    ["/api/http/user", { userId: "  " }],
  ] as Array<[string, unknown]>) {
    const r = await post(path, body);
    assertEquals(r.status, 422, `${path} ${JSON.stringify(body)} -> should be 422`);
    await r.body?.cancel();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 16: well-formed-but-nonexistent id is a client condition -> 404, and the
// error body must NOT be the {status:500,...} server-fault envelope.
Deno.test("bug 16: nonexistent id -> 404 with non-500 body", async () => {
  const r = await post("/api/http/issue", { issueId: "SPR-999" });
  assertEquals(r.status, 404);
  const body = await r.json();
  assert(body.status !== 500, `body should not carry status 500: ${JSON.stringify(body)}`);

  const r2 = await post("/api/http/user", { userId: "nobody" });
  assertEquals(r2.status, 404);
  await r2.body?.cancel();
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 19: not-found must NOT echo the attacker-controlled id verbatim in the
// error body (info reflection). 404 status + message free of the raw id.
Deno.test("bug 19: not-found does not reflect raw id", async () => {
  const marker = "ZZZ-REFLECT-MARKER-12345";
  const r = await post("/api/http/issue", { issueId: marker });
  assertEquals(r.status, 404);
  const text = await r.text();
  assert(!text.includes(marker), `error body must not reflect the raw id: ${text}`);

  const r2 = await post("/api/http/user", { userId: marker });
  assertEquals(r2.status, 404);
  const text2 = await r2.text();
  assert(!text2.includes(marker), `user error body must not reflect the raw id: ${text2}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 43: relateds must reflect a real relationship, not the first 3 seed issues.
// SPR-104 and SPR-105 must NOT return byte-identical related lists, and a
// genuinely related issue (shared tag) must be preferred.
//   SPR-103 (tag "router") and SPR-104 (tag "router") share a tag -> each other
//   should appear in the other's relateds, which the positional slice never did.
Deno.test("bug 43: relateds are relevance-ranked, not positional", async () => {
  const relIds = async (id: string): Promise<string[]> => {
    const r = await post("/api/http/issue", { issueId: id });
    assertEquals(r.status, 200);
    const detail = await r.json();
    return detail.relateds.map((x: { id: string }) => x.id);
  };

  const r104 = await relIds("SPR-104");
  const r105 = await relIds("SPR-105");

  // The buggy positional slice returns [SPR-101,SPR-102,SPR-103] for BOTH.
  assert(
    JSON.stringify(r104) !== JSON.stringify(r105),
    `two unrelated issues should not get identical relateds: 104=${JSON.stringify(r104)} 105=${JSON.stringify(r105)}`,
  );
  // SPR-104 shares the "router" tag with SPR-103 -> SPR-103 must be related.
  assert(
    r104.includes("SPR-103"),
    `SPR-104 (router) should relate to SPR-103 (router); got ${JSON.stringify(r104)}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 44: dashboard "recent activity" must be sorted newest-first by `at`.
//   Seed order is a1,a2,a3,a4,a5 which is NOT descending by `at`.
//   Expected descending: a1(06-19 14:12), a3(06-19 08:45), a2(06-18), a5(06-12), a4(06-11).
Deno.test("bug 44: dashboard activity sorted by at desc", async () => {
  const r = await post("/api/http/dashboard", {});
  assertEquals(r.status, 200);
  const dash = await r.json();
  const ats: string[] = dash.activitys.map((a: { at: string }) => a.at);
  for (let i = 1; i < ats.length; i++) {
    assert(
      ats[i - 1] >= ats[i],
      `activity feed must be descending by at: ${JSON.stringify(ats)}`,
    );
  }
  // concrete order check
  const ids: string[] = dash.activitys.map((a: { id: string }) => a.id);
  assertEquals(ids, ["a1", "a3", "a2", "a5", "a4"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 50: an unbounded issueId must be rejected by input validation (422) before
// reaching business logic, and must NOT be reflected back unbounded in an error.
Deno.test("bug 50: unbounded id rejected at validation, not reflected", async () => {
  const huge = "A".repeat(200000);
  const r = await post("/api/http/issue", { issueId: huge });
  assertEquals(r.status, 422, "an oversized id should be rejected with 422, not 500");
  const text = await r.text();
  assert(
    text.length < 10000,
    `error body should be bounded, not reflect the 200k payload (got ${text.length} bytes)`,
  );
  assert(!text.includes(huge), "error body must not contain the full payload");
});

// ─────────────────────────────────────────────────────────────────────────────
// bug 89: unknown/extra top-level JSON fields must be rejected (422), not
// silently accepted. The control (valid types) still passes.
Deno.test("bug 89: unknown extra fields rejected with 422", async () => {
  const r1 = await post("/api/http/issue", { issueId: "SPR-101", extra: "LEAK" });
  assertEquals(r1.status, 422, "extra field should be rejected with 422");
  await r1.body?.cancel();

  const r2 = await post("/api/http/user", { userId: "ada", nope: 1 });
  assertEquals(r2.status, 422, "extra field on user should be rejected with 422");
  await r2.body?.cancel();

  // reserved keys treated as unknown too. Build the raw JSON string so __proto__
  // is a real own key (a {__proto__:...} object literal would set the prototype
  // instead of an own property and never serialize as a key).
  const r3 = await fetchH(
    new Request("http://localhost/api/http/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"issueId":"SPR-101","__proto__":{"polluted":true}}',
    }),
  );
  assertEquals(r3.status, 422);
  await r3.body?.cancel();

  // control: clean valid payload still works
  const ok = await post("/api/http/issue", { issueId: "SPR-101" });
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
});
