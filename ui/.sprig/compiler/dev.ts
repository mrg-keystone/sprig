// The sprig dev server — state-preserving HMR with NO Vite. It wraps the production
// serveSprig handler and adds, using only Deno + the existing compiler:
//   - Deno.watchFs over the src tree (debounced),
//   - an SSE channel `<base>/_sprig/hmr` pushing typed update messages,
//   - a live AST endpoint `<base>/_sprig/ast/<sel>` (dev island chunks fetch it),
//   - per-change handling: template → reparse + push AST (instant, state-kept);
//     css → rebuild app.css + push css (swap the link, no reload); logic/other .ts
//     → rebuild the dev bundle + push reload.
import { basename, dirname } from "@std/path";
import type { SsrRenderer } from "./mod.ts";
import { buildClient, buildCss } from "./build.ts";

export interface DevConfig {
  renderer: SsrRenderer;
  base: string;
  outDir: string;
  handler: { fetch(req: Request, info: Deno.ServeHandlerInfo): Promise<Response> | Response };
}

export function createDevServer(cfg: DevConfig): {
  fetch(req: Request, info: Deno.ServeHandlerInfo): Promise<Response> | Response;
  close(): void;
} {
  const enc = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const send = (msg: unknown) => {
    const frame = enc.encode(`data: ${JSON.stringify(msg)}\n\n`);
    for (const c of clients) {
      try {
        c.enqueue(frame);
      } catch { /* client gone */ }
    }
  };

  // debounced file watcher (closeable, so tests / Ctrl-C don't leak it)
  const watcher = Deno.watchFs(cfg.renderer.srcDir);
  let timer: number | undefined;
  // Serialize rebuilds: the debounce coalesces an event burst, but overlapping
  // batches (a save during a >1s build) would otherwise fire two handleChange/
  // buildClient runs that race the same outDir. A single in-flight drain loop
  // keeps exactly one build running and coalesces any paths that arrive while it
  // runs into the next trailing batch.
  const pending = new Set<string>();
  let running: Promise<void> | null = null;
  const drain = (): Promise<void> => {
    if (running) return running; // a build is in flight; pending will be picked up
    running = (async () => {
      try {
        while (pending.size) {
          const batch = [...pending];
          pending.clear();
          try {
            await handleChange(batch);
          } catch (e) {
            send({ type: "error", message: String(e) });
          }
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
  (async () => {
    for await (const ev of watcher) {
      if (ev.kind === "access") continue;
      for (const p of ev.paths) pending.add(p);
      clearTimeout(timer);
      timer = setTimeout(() => {
        drain();
      }, 60);
    }
  })();

  async function handleChange(paths: string[]) {
    const templates: string[] = [];
    let css = false, reload = false;
    for (const p of paths) {
      if (p.endsWith("template.html")) templates.push(basename(dirname(p)));
      else if (p.endsWith("styles.css")) css = true;
      else if (p.endsWith(".ts")) reload = true;
    }
    // Each change kind is handled in its own try/catch so a broken/transient
    // edit (e.g. a momentarily-unreadable template) only reports its own error
    // and never suppresses the other batched updates in the same window.
    // template edit → reparse (SSR fresh) + push new AST (live update, state preserved)
    for (const sel of templates) {
      try {
        if (await cfg.renderer.reparse(sel)) {
          send({ type: "template", sel, template: cfg.renderer.astFor(sel) });
          console.log(`%c[sprig dev]%c template ↻ ${sel}`, "color:#7c3aed", "");
        }
      } catch (e) {
        send({ type: "error", message: String(e) });
      }
    }
    // css edit → rebuild app.css + swap the stylesheet (no reload, state untouched)
    if (css) {
      try {
        await buildCss(cfg.renderer.srcDir, cfg.outDir);
        send({ type: "css", v: String(Date.now()) });
        console.log(`%c[sprig dev]%c css ↻`, "color:#7c3aed", "");
      } catch (e) {
        send({ type: "error", message: String(e) });
      }
    }
    // logic.ts / resolve.ts / other → rebuild the dev bundle, then full reload
    if (reload) {
      try {
        await buildClient(cfg.renderer.srcDir, cfg.outDir, { dev: true });
        send({ type: "reload" });
        console.log(`%c[sprig dev]%c reload (rebuilt)`, "color:#7c3aed", "");
      } catch (e) {
        send({ type: "error", message: String(e) });
      }
    }
  }

  const hmrPath = `${cfg.base}/_sprig/hmr`;
  const astPrefix = `${cfg.base}/_sprig/ast/`;
  return {
    fetch(req, info) {
      const path = new URL(req.url).pathname;
      if (path === hmrPath) {
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            clients.add(c);
            c.enqueue(enc.encode("retry: 800\n\n"));
          },
          cancel() {
            clients.delete(ctrl);
          },
        });
        return new Response(body, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      if (path.startsWith(astPrefix)) {
        let sel: string;
        try {
          // untrusted path — a malformed percent-escape (e.g. a lone `%`) throws
          // URIError; return a clean 400 instead of crashing the handler (500).
          sel = decodeURIComponent(path.slice(astPrefix.length));
        } catch {
          return new Response("bad request", { status: 400 });
        }
        const ast = cfg.renderer.astFor(sel);
        return ast
          ? Response.json(ast, { headers: { "cache-control": "no-cache" } })
          : new Response("not found", { status: 404 });
      }
      return cfg.handler.fetch(req, info);
    },
    close() {
      clearTimeout(timer);
      watcher.close();
      for (const c of clients) {
        try {
          c.close();
        } catch { /* already closed */ }
      }
      clients.clear();
    },
  };
}
