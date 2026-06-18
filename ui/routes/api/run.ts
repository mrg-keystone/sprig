import { define } from "../../utils.ts";

// The keep server (../../server) owns test execution. The run-tests islands post
// { tests: <absolute spec paths> } here; we proxy to keep's test.run endpoint and
// map its TestReport ({ ok, testResults, error }) to the shape the islands read
// ({ ok, results, error }) — keeping those islands a verbatim port of the
// reference. keep trusts localhost (deny-by-default auth), so no token is needed.
//
// Modes:
//   - default (this file): proxy over HTTP to a separately-run keep server.
//     Point ISOLATE_KEEP_URL at it (default http://localhost:3000).
//   - in-process embed (the spec's target): replace the fetch with
//     `import { api } from "../../../server/bootstrap/mod.ts"` +
//     `api.backend.fetch("/http/post-test-run", …)` once the deno workspace +
//     keep-under-Vite build are verified (see README "Wiring keep").
const KEEP_URL = Deno.env.get("ISOLATE_KEEP_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => ({} as { tests?: string[] }));
    const files = Array.isArray(body.tests) ? body.tests : [];
    try {
      const res = await fetch(`${KEEP_URL}/http/post-test-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const report = await res.json().catch(() => ({}));
      return Response.json({
        ok: !!report.ok,
        results: report.testResults ?? [],
        error: report.error,
      });
    } catch (e) {
      return Response.json({
        ok: false,
        results: [],
        error: `couldn't reach the keep server at ${KEEP_URL} — ` +
          ((e as Error).message ?? String(e)),
      }, { status: 502 });
    }
  },
});
