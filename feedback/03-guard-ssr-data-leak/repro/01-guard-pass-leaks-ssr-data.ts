// Repro 1 — a guard-pass makes bootstrap() render the protected page's DATA into the
// SSR HTML, for an UNAUTHENTICATED request, whenever the guard lets it through.
//
// The guard here is the common "magic-link handshake": it passes on the presence of
// a `?token=` param so the client can seed its bearer. An attacker supplies ANY value
// — `?token=3` — and the server responds 200 with the full record set embedded in the
// HTML. No cookie, no valid token, no /api call: the data is in the first document.
//
// This runs against the REAL framework code (framework/.sprig/core.ts bootstrap →
// guard → resolve → render). It asserts the leak; it will THROW once sprig stops
// rendering protected data for a merely-permitted (not authenticated) request.
//
// Run from the repo root:
//   deno run -A feedback/03-guard-ssr-data-leak/repro/01-guard-pass-leaks-ssr-data.ts
import { LEAK_MARKER, makeApp, makeBackend } from "./fixture-app/main.ts";

const app = await makeApp();
const backend = makeBackend();

// A page navigation the way a browser makes it: GET, no Authorization header. The
// only auth signal a document nav can carry is a cookie — and this anonymous
// attacker has none.
function get(pathAndQuery: string): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${pathAndQuery}`, { method: "GET" }),
    undefined,
    { backend },
  );
}

// ── Control: no token, no cookie → the guard redirects, no data rendered. ────────
const control = await get("/app/overview");
const controlHtml = control.status === 200 ? await control.text() : "";
control.body?.cancel?.();
console.log(`control   GET /app/overview            → HTTP ${control.status} (location=${control.headers.get("location") ?? "-"})`);

// ── Attack: append ?token=<anything>, still no cookie. ───────────────────────────
const attack = await get("/app/overview?token=3");
const attackHtml = await attack.text();
const leaked = attackHtml.includes(LEAK_MARKER);
console.log(`attack    GET /app/overview?token=3    → HTTP ${attack.status}, ${attackHtml.length} bytes, leaks records: ${leaked}`);

if (leaked) {
  const sample = attackHtml.slice(Math.max(0, attackHtml.indexOf(LEAK_MARKER) - 40), attackHtml.indexOf(LEAK_MARKER) + 60);
  console.log(`\nLEAK (expected): the anonymous SSR HTML contains protected records, e.g.:\n  …${sample}…`);
  console.log(`\nThe guard is the ONLY gate on the SSR render; it passed on attacker-supplied`);
  console.log(`?token=3, so resolve() ran against the trusted in-process Backend and the`);
  console.log(`records were embedded in the first document. See 02 for why resolve() can't`);
  console.log(`defend itself, and ../bug-report.md for the fix menu.`);
} else {
  throw new Error(
    "no leak — sprig no longer renders protected data for a merely-permitted request. " +
      "If this is the intended fix, update this repro.",
  );
}

// Sanity: the control must NOT have leaked (proves the token is what flipped it).
if (controlHtml.includes(LEAK_MARKER)) {
  throw new Error("unexpected: control (no token) also leaked — the guard is not gating at all");
}
