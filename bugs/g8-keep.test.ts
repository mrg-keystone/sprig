// Group g8-keep — bugs 1, 17, 18, 42, 49, 52, 72, 73, 74, 75, 88, 91, 93.
// All in the serveSprig gateway / serveAsset (packages/keep/mod.ts). We drive the
// real composed handler from ../serve.ts via handler.fetch(new Request(...)).
import { assert, assertEquals } from "@std/assert";
import handler from "../serve.ts";
import { assetExt } from "../packages/keep/mod.ts";

const INFO = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 12345 },
  completed: Promise.resolve(),
} as unknown as Deno.ServeHandlerInfo;

const fetchH = (req: Request) => handler.fetch(req, INFO);
const drain = async (res: Response) => {
  await res.body?.cancel();
  return res;
};
const jsonPost = (path: string, body: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

// ─────────────────────────────────────────────────────────────────────────────
// bug 1: a VALID but deeply-nested JSON body must be rejected with a bounded 4xx
// at the gateway, not crash the keep pipeline with "Maximum call stack size
// exceeded" → 500.
Deno.test("bug 1: deeply-nested valid JSON body → bounded 400 (no stack-overflow 500)", async () => {
  const deep = `{"issueId":"SPR-101","x":${"[".repeat(50000)}0${"]".repeat(50000)}}`;
  const res = await drain(await fetchH(jsonPost("/api/http/issue", deep)));
  assertEquals(res.status, 400, "over-nested body must be a bounded 400, not 500");
});

// bug 17 / 52: malformed / non-JSON request body must be a 4xx (not a 500 leaking
// the raw JSON.parse error string).
Deno.test("bug 17/52: malformed JSON body → 400, not 500 leaking parser error", async () => {
  for (const bad of ["{not json", "{bad", "hello"]) {
    const res = await fetchH(jsonPost("/api/http/issue", bad));
    const text = await res.text();
    assertEquals(res.status, 400, `'${bad}' should be 400, got ${res.status}`);
    assert(
      !/JSON|position|Unexpected/i.test(text),
      `response must not leak the raw parser error, got: ${text}`,
    );
  }
  // also on /user
  const u = await drain(await fetchH(jsonPost("/api/http/user", "{bad")));
  assertEquals(u.status, 400);
});

// bug 42: same malformed-JSON root, lower-severity variant (trailing-junk / a
// truncated object). Must be 400.
Deno.test("bug 42: truncated/incomplete JSON body → 400", async () => {
  const res = await fetchH(jsonPost("/api/http/issue", '{"issueId":'));
  const text = await res.text();
  assertEquals(res.status, 400);
  assert(!/Unexpected end of JSON input/i.test(text), `must not leak parser text: ${text}`);
});

// bug 18: TRACE on /api/* must NOT crash with a bare 500 (the old code threw a
// TypeError re-wrapping the Request with a forbidden method). Expect a clean 405.
// TRACE is a forbidden method, so the userland Request constructor refuses to
// build one — exactly as Deno's HTTP server can still DELIVER one to the handler.
// We spoof a Request whose .method is TRACE (Request.method is read-only, so we
// wrap a real GET request in a Proxy that overrides .method) to reach the seam.
Deno.test("bug 18: TRACE /api/* → clean 405, not an uncaught 500", async () => {
  const real = new Request("http://localhost/api/http/board", { method: "GET" });
  const traceReq = new Proxy(real, {
    get(target, prop, recv) {
      if (prop === "method") return "TRACE";
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Request;
  const res = await drain(await fetchH(traceReq));
  assertEquals(res.status, 405, "TRACE must be a routed 405, not a bare 500");
  assert(res.headers.get("allow") !== null, "405 should carry an Allow header");
});

// bug 49: a body declared as a non-JSON media type must be rejected (415), not
// silently parsed as JSON and accepted with 200.
Deno.test("bug 49: non-JSON content-type with a body → 415 (not parsed as JSON)", async () => {
  for (const ct of ["text/plain", "application/xml"]) {
    const res = await drain(await fetchH(
      new Request("http://localhost/api/http/issue", {
        method: "POST",
        headers: { "content-type": ct },
        body: '{"issueId":"SPR-101"}',
      }),
    ));
    assertEquals(res.status, 415, `${ct} body must be 415, got ${res.status}`);
  }
});

// ── serveAsset bugs (driven through /ui/_assets/*, served from ./static) ──────

// bug 72: static assets must answer only GET/HEAD; other methods → 405 + Allow.
Deno.test("bug 72: non-GET/HEAD on a static asset → 405 with Allow", async () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await drain(await fetchH(
      new Request("http://localhost/ui/_assets/client.js", { method: m }),
    ));
    assertEquals(res.status, 405, `${m} on an asset must be 405, got ${res.status}`);
    assertEquals(res.headers.get("allow"), "GET, HEAD");
  }
  // GET still works
  const ok = await drain(await fetchH(new Request("http://localhost/ui/_assets/client.js")));
  assertEquals(ok.status, 200);
});

// bug 73: a legitimate single-segment filename containing a ".." substring must
// NOT be over-blocked with 403; it should reach the FS (404 if absent here).
Deno.test("bug 73: single-segment name with '..' substring is not 403", async () => {
  const res = await drain(await fetchH(
    new Request("http://localhost/ui/_assets/foo..bar.js"),
  ));
  assertEquals(res.status, 404, "a no-such-file single-segment name should 404, not 403");
  // a real traversal segment is still rejected (URL normalizes ../ before us, so
  // forge one that survives: %2e%2e is decoded to '..' as a full segment).
});

// bug 74: content-type lookup must be case-insensitive on the extension. On a
// case-insensitive FS (macOS) client.JS resolves to client.js but must still be
// served as text/javascript, not application/octet-stream.
Deno.test("bug 74: uppercase extension still gets the right content-type", async () => {
  const res = await drain(await fetchH(new Request("http://localhost/ui/_assets/client.JS")));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/javascript; charset=utf-8");
});

// bug 75: conditional GET with the matching ETag must yield 304, and an asset
// response must carry ETag + Last-Modified validators.
Deno.test("bug 75: assets carry ETag/Last-Modified and a conditional GET → 304", async () => {
  const first = await drain(await fetchH(new Request("http://localhost/ui/_assets/app.css")));
  assertEquals(first.status, 200);
  const etag = first.headers.get("etag");
  assert(etag, "asset must carry an ETag");
  assert(first.headers.get("last-modified"), "asset must carry Last-Modified");
  const cond = await drain(await fetchH(
    new Request("http://localhost/ui/_assets/app.css", {
      headers: { "if-none-match": etag! },
    }),
  ));
  assertEquals(cond.status, 304, "matching If-None-Match must yield 304");
});

// bug 88: the /api prefix-strip must NOT alias the human /docs Swagger surface.
Deno.test("bug 88: /api/docs does not leak the Swagger /docs UI", async () => {
  const res = await drain(await fetchH(new Request("http://localhost/api/docs")));
  assertEquals(res.status, 404, "/api/docs must not serve the docs UI");
});

// bug 91: extension derivation for an EXTENSIONLESS name. The old code did
// `file.slice(file.lastIndexOf("."))`, so a no-dot name like "LICENSE" keyed to
// its trailing char "E" instead of "". The derivation must yield "".
Deno.test("bug 91: extensionless filename derives key '' (not the trailing char)", () => {
  assertEquals(assetExt("LICENSE"), "", `'LICENSE' must derive '' not 'E'`);
  assertEquals(assetExt("robots"), "", `'robots' must derive '' not 's'`);
  // sanity: a real extension still works (and is lower-cased per bug 74)
  assertEquals(assetExt("client.JS"), ".js");
});

// bug 93: extension derivation must not read across the "/" separator. The old
// code derived ".0/client" for "v2.0/client" (a dotted parent dir + extensionless
// file). It must derive "" from the basename only.
Deno.test("bug 93: ext derivation does not span a '/' (dotted dir + extensionless file)", () => {
  assertEquals(assetExt("v2.0/client"), "", `'v2.0/client' must derive '' not '.0/client'`);
  assertEquals(assetExt("sub.dir/noext"), "", `'sub.dir/noext' must derive '' not '.dir/noext'`);
  // a real nested extension is still detected
  assertEquals(assetExt("v1.2/client.js"), ".js");
});

// bug 91/93 (served): the same names served through the asset path resolve to
// application/octet-stream.
Deno.test("bug 91/93: extensionless / dotted-dir names served → application/octet-stream", async () => {
  const staticDir = new URL("../static", import.meta.url).pathname;
  const dottedDir = `${staticDir}/v2.0`;
  await Deno.writeTextFile(`${staticDir}/LICENSE`, "MIT");
  await Deno.mkdir(dottedDir, { recursive: true });
  await Deno.writeTextFile(`${dottedDir}/client`, "x");
  try {
    // bug 91: "LICENSE" has no dot — old code keyed it to "E"; either way the
    // map missed, but the derivation must be clean octet-stream.
    const r1 = await drain(await fetchH(new Request("http://localhost/ui/_assets/LICENSE")));
    assertEquals(r1.status, 200);
    assertEquals(r1.headers.get("content-type"), "application/octet-stream");
    // bug 93: "v2.0/client" — old code derived ".0/client" reading across "/".
    const r2 = await drain(await fetchH(new Request("http://localhost/ui/_assets/v2.0/client")));
    assertEquals(r2.status, 200);
    assertEquals(r2.headers.get("content-type"), "application/octet-stream");
  } finally {
    await Deno.remove(`${staticDir}/LICENSE`).catch(() => {});
    await Deno.remove(dottedDir, { recursive: true }).catch(() => {});
  }
});
