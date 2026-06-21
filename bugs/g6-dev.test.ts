// g6-dev: dev/HMR server bugs (26, 41, 64, 67) in ui/.sprig/compiler/dev.ts.
// Each test drives createDevServer through a real seam:
//   - 41/64: real Deno.watchFs + an in-process SSE listener (mirrors hydration.test),
//     with a fake renderer whose reparse can throw, asserting fault isolation.
//   - 26: real watcher with a deliberately-slow reparse; assert handleChange runs
//     never overlap (serialized) — the in-flight guard.
//   - 67: drive dev.fetch directly with a malformed percent-escape selector.
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createDevServer } from "../ui/.sprig/compiler/dev.ts";
import type { SerializedTemplate } from "../ui/.sprig/compiler/serialize.ts";

// Minimal structural renderer (avoids importing the SsrRenderer type from mod.ts,
// which can be transiently mid-edit by another group). dev.ts only needs srcDir,
// reparse, and astFor at runtime for these paths.
interface FakeRenderer {
  srcDir: string;
  renderDocument: () => Promise<string>;
  selectors: () => string[];
  reparse: (sel: string) => Promise<boolean>;
  astFor: (sel: string) => SerializedTemplate | null;
}

const noopTemplate = { tag: "div", attrs: {}, children: [] } as unknown as SerializedTemplate;

function fakeRenderer(srcDir: string, over: Partial<FakeRenderer> = {}): FakeRenderer {
  return {
    srcDir,
    renderDocument: () => Promise.resolve("<html></html>"),
    selectors: () => [],
    reparse: () => Promise.resolve(true),
    astFor: () => noopTemplate,
    ...over,
  };
}

const passthruHandler = {
  fetch: () => new Response("ok", { status: 200 }),
};

// Collect SSE messages pushed by the dev server over a real HTTP connection.
async function collectSse(
  dev: { fetch(req: Request, info: Deno.ServeHandlerInfo): Promise<Response> | Response },
  base: string,
  msgs: unknown[],
): Promise<() => void> {
  const res = await dev.fetch(
    new Request(`http://localhost${base}/_sprig/hmr`),
    { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } } as Deno.ServeHandlerInfo,
  );
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let stopped = false;
  (async () => {
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (line) msgs.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  return () => {
    stopped = true;
    reader.cancel().catch(() => {});
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Bug 41: a failing template reparse silently drops batched CSS/reload updates
// in the same debounce window. Expected: the CSS update is still applied.
// ---------------------------------------------------------------------------
Deno.test("bug 41: failing template reparse must not drop batched css update", async () => {
  const src = await Deno.makeTempDir({ prefix: "g6-41-" });
  const out = await Deno.makeTempDir({ prefix: "g6-41-out-" });
  // pre-create the files so writes are modify events in one debounce batch
  await Deno.mkdir(join(src, "broken"), { recursive: true });
  const tpl = join(src, "broken", "template.html");
  const css = join(src, "styles.css");
  await Deno.writeTextFile(tpl, "<div></div>");
  await Deno.writeTextFile(css, "a{}");

  const renderer = fakeRenderer(src, {
    reparse: () => Promise.reject(new Error("template parse returned null")),
  });
  const dev = createDevServer({ renderer: renderer as never, base: "/ui", outDir: out, handler: passthruHandler });
  const msgs: unknown[] = [];
  const stop = await collectSse(dev, "/ui", msgs);
  try {
    // edit BOTH template and css within one debounce window
    await Deno.writeTextFile(tpl, "<div>x</div>");
    await Deno.writeTextFile(css, "a{color:red}");
    // wait past debounce + buildCss
    await sleep(1500);
    const types = msgs.map((m) => (m as { type: string }).type);
    assert(
      types.includes("css"),
      `css update must survive a failing template reparse; got ${JSON.stringify(types)}`,
    );
  } finally {
    stop();
    dev.close();
    await Deno.remove(src, { recursive: true }).catch(() => {});
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Bug 64: partial-batch loss — a reparse throw on one template must not skip
// the remaining templates in the same batch.
// ---------------------------------------------------------------------------
Deno.test("bug 64: one throwing template must not skip later templates in the batch", async () => {
  const src = await Deno.makeTempDir({ prefix: "g6-64-" });
  const out = await Deno.makeTempDir({ prefix: "g6-64-out-" });
  await Deno.mkdir(join(src, "aaa"), { recursive: true });
  await Deno.mkdir(join(src, "bbb"), { recursive: true });
  const tplA = join(src, "aaa", "template.html");
  const tplB = join(src, "bbb", "template.html");
  await Deno.writeTextFile(tplA, "<div></div>");
  await Deno.writeTextFile(tplB, "<div></div>");

  const reparsed: string[] = [];
  const renderer = fakeRenderer(src, {
    reparse: (sel: string) => {
      reparsed.push(sel);
      if (sel === "aaa") return Promise.reject(new Error("boom on aaa"));
      return Promise.resolve(true);
    },
  });
  const dev = createDevServer({ renderer: renderer as never, base: "/ui", outDir: out, handler: passthruHandler });
  const msgs: unknown[] = [];
  const stop = await collectSse(dev, "/ui", msgs);
  try {
    await Deno.writeTextFile(tplA, "<div>a</div>");
    await Deno.writeTextFile(tplB, "<div>b</div>");
    await sleep(1000);
    // bbb must have been reparsed despite aaa throwing first (or after)
    assert(reparsed.includes("bbb"), `bbb must be reparsed despite aaa throwing; reparsed=${JSON.stringify(reparsed)}`);
    const tplMsgs = msgs.filter((m) => (m as { type: string }).type === "template")
      .map((m) => (m as { sel: string }).sel);
    assert(tplMsgs.includes("bbb"), `a 'template' SSE for bbb must be sent; got ${JSON.stringify(tplMsgs)}`);
  } finally {
    stop();
    dev.close();
    await Deno.remove(src, { recursive: true }).catch(() => {});
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Bug 26: concurrent rebuilds race the same outDir — the debounced watcher has
// no in-flight guard, so two handleChange runs overlap. Expected: serialized.
// We detect overlap through a deliberately-slow reparse.
// ---------------------------------------------------------------------------
Deno.test("bug 26: overlapping change batches must be serialized (no concurrent builds)", async () => {
  const src = await Deno.makeTempDir({ prefix: "g6-26-" });
  const out = await Deno.makeTempDir({ prefix: "g6-26-out-" });
  await Deno.mkdir(join(src, "aaa"), { recursive: true });
  await Deno.mkdir(join(src, "bbb"), { recursive: true });
  const tplA = join(src, "aaa", "template.html");
  const tplB = join(src, "bbb", "template.html");
  await Deno.writeTextFile(tplA, "<div></div>");
  await Deno.writeTextFile(tplB, "<div></div>");

  let active = 0;
  let maxConcurrent = 0;
  const renderer = fakeRenderer(src, {
    reparse: async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await sleep(300); // long enough to overlap with a second batch
      active--;
      return true;
    },
  });
  const dev = createDevServer({ renderer: renderer as never, base: "/ui", outDir: out, handler: passthruHandler });
  try {
    // first batch: edit template A; the timer fires ~60ms later and starts a 300ms reparse
    await Deno.writeTextFile(tplA, "<div>a</div>");
    await sleep(120); // let batch-1's debounce fire while reparse is mid-flight
    // second batch: edit template B; on buggy code this fires a SECOND overlapping handleChange
    await Deno.writeTextFile(tplB, "<div>b</div>");
    await sleep(900); // let everything settle
    assertEquals(
      maxConcurrent,
      1,
      `handleChange runs must be serialized; observed ${maxConcurrent} concurrent reparse passes`,
    );
  } finally {
    dev.close();
    await Deno.remove(src, { recursive: true }).catch(() => {});
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Bug 67: /_sprig/ast/<sel> calls decodeURIComponent without try/catch — a lone
// '%' throws URIError. Expected: a clean 4xx, not a thrown/500.
// ---------------------------------------------------------------------------
Deno.test("bug 67: malformed percent-escape in ast selector yields 4xx, not a crash", async () => {
  const src = await Deno.makeTempDir({ prefix: "g6-67-" });
  const renderer = fakeRenderer(src, { astFor: () => null });
  const dev = createDevServer({ renderer: renderer as never, base: "/ui", outDir: src, handler: passthruHandler });
  try {
    const info = { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } } as Deno.ServeHandlerInfo;
    let res: Response;
    try {
      res = await dev.fetch(new Request("http://localhost/ui/_sprig/ast/%"), info);
    } catch (e) {
      throw new Error(`handler must not throw on malformed selector, but threw: ${e}`);
    }
    assert(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
    // a well-formed but unknown selector still 404s
    const ok = await dev.fetch(new Request("http://localhost/ui/_sprig/ast/Foo"), info);
    assertEquals(ok.status, 404);
  } finally {
    dev.close();
    await Deno.remove(src, { recursive: true }).catch(() => {});
  }
});
