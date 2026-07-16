import { assert } from "@std/assert";
import { dirname, join } from "@std/path";
import { createRenderer } from "./mod.ts";

// The base-prefix pass (createRenderer's applyBasePrefix): an app authors root-
// relative nav hrefs (href="/runs"); when mounted under a non-root base (e.g.
// "/ui"), those must land ON the base so a click hits the served route instead
// of 404ing off-base — the same prefixing buildNav() does for the generated nav.
// Off-base surfaces (the keep API /api + /docs, served at the origin root) and
// non-root-relative values (//, https:, #) are left untouched; at base "" it is a
// no-op so the root-mounted composition is byte-identical.

async function renderApp(base: string, pageTemplate: string): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-base-href-" });
  const write = async (rel: string, body: string) => {
    const p = join(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(p), { recursive: true });
    await Deno.writeTextFile(p, body);
  };
  await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
  await write("pages/home/template.html", pageTemplate);
  try {
    const r = await createRenderer(tmp, base, { dev: true });
    return await r.renderDocument("pages/home", {});
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

const PAGE = `<nav>
  <a href="/runs">Runs</a>
  <a href="/">Home</a>
  <a href="/api/http/list-flows">api</a>
  <a href="/docs/board">docs</a>
  <a href="//cdn.example/x.js">cdn</a>
  <a href="https://ext.example/y">ext</a>
  <a href="/ui/already">already-based</a>
  <a href="#hash">hash</a>
  <form action="/submit"></form>
  <form action="/api/create"></form>
</nav>`;

Deno.test("base-href-prefix: root-relative nav hrefs are prefixed with a non-root base", async () => {
  const html = await renderApp("/ui", PAGE);
  // app routes → on-base
  assert(html.includes(`href="/ui/runs"`), "app href not prefixed");
  assert(!html.includes(`href="/runs"`), "bare (unprefixed) app href leaked");
  assert(html.includes(`href="/ui/"`), 'home href="/" not prefixed to base + "/"');
  assert(html.includes(`action="/ui/submit"`), "form action to an app route not prefixed");
  // off-base keep surfaces served at the origin root → untouched
  assert(html.includes(`href="/api/http/list-flows"`), "keep /api href was wrongly rewritten");
  assert(html.includes(`href="/docs/board"`), "keep /docs href was wrongly rewritten");
  assert(html.includes(`action="/api/create"`), "form action to /api was wrongly rewritten");
  // non-root-relative + already-based → untouched (and never double-prefixed)
  assert(html.includes(`href="//cdn.example/x.js"`), "protocol-relative URL was rewritten");
  assert(html.includes(`href="https://ext.example/y"`), "absolute URL was rewritten");
  assert(html.includes(`href="#hash"`), "in-page anchor was rewritten");
  assert(html.includes(`href="/ui/already"`), "already-based href changed");
  assert(!html.includes(`/ui/ui/`), "already-based href was double-prefixed");
});

Deno.test("base-href-prefix: base '' is a no-op (root-mounted composition unchanged)", async () => {
  const html = await renderApp("", PAGE);
  assert(html.includes(`href="/runs"`), "root-mounted href was altered");
  assert(html.includes(`action="/submit"`), "root-mounted action was altered");
  assert(html.includes(`href="/api/http/list-flows"`), "root-mounted /api href was altered");
  // no app route got a base prefix (the "/ui/already" passthrough link is unrelated)
  assert(!html.includes(`href="/ui/runs"`), "app href was prefixed at base ''");
  assert(!html.includes(`action="/ui/submit"`), "app action was prefixed at base ''");
});
