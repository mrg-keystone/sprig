#!/usr/bin/env -S deno run -A
/* ============================================================
 * build annotate — click-to-edit overlay for a RUNNING sprig app
 *
 * The build-stage analog of the prototype annotate. There, a ⌘-click
 * keys a note to an ELEMENT in a throwaway HTML file (by selector).
 * Here, the app is real sprig — composed of folder-components, each
 * element stamped with its component's view-encapsulation SCOPE-ID
 * marker (`<div s1a2b3c4d …>`). So a ⌘-click resolves to the
 * COMPONENT that owns the element, and the saved note says
 * "edit this component in isolation" (with its `sprig isolate` route)
 * — never a CSS selector.
 *
 *   deno run -A serve.ts --app <appDir> --target http://localhost:8000 \
 *       [--port 4510] [--open]
 *
 * - <appDir>  the sprig app dir; its `src/` is scanned for folder-
 *             components → the scope-id → component map.
 * - <target>  the RUNNING app (`sprig dev` or `sprig serve`). The proxy
 *             forwards everything and injects the overlay into HTML.
 *
 * Notes persist to <appDir>/spec/ui/build-notes.json (component-keyed),
 * the checklist a build session works through, editing each in isolation.
 * ========================================================== */

import { basename, dirname, join, relative, resolve } from "@std/path";

type Args = { app: string; target: string; port: number; host: string; open: boolean };

function parseArgs(argv: string[]): Args {
  let app = ".";
  let target = "http://localhost:8000";
  let port = 4510;
  let host = "127.0.0.1";
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") app = argv[++i];
    else if (a === "--target") target = argv[++i];
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--host") host = argv[++i];
    else if (a === "--open") open = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      Deno.exit(0);
    }
  }
  return { app, target: target.replace(/\/+$/, ""), port, host, open };
}

function printHelp() {
  console.error(
    "Usage: deno run -A serve.ts --app <appDir> --target <url> [--port 4510] [--open]\n\n" +
      "  Proxies a running sprig app and injects a click-to-edit overlay.\n" +
      "  ⌘/Ctrl+click an element → type a note → save. The note is keyed to the\n" +
      "  COMPONENT that owns the element (via sprig's scope-id marker), with its\n" +
      "  `sprig isolate` route — so you go edit that component in isolation.\n" +
      "  Notes land in <appDir>/spec/ui/build-notes.json.",
  );
}

const HERE = dirname(new URL(import.meta.url).pathname);
const CLIENT_JS = await Deno.readTextFile(join(HERE, "client.js"));

const args = parseArgs(Deno.args);
const APP = resolve(args.app);
const SRC = join(APP, "src");
const NOTES_PATH = join(APP, "spec", "ui", "build-notes.json");

/** EXACT copy of the compiler's scopeId (framework/.sprig/compiler/scope.ts) — FNV-1a 32-bit.
 *  Must stay byte-identical so a marker in the DOM resolves to the right component. */
function scopeId(selector: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < selector.length; i++) {
    h ^= selector.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "s" + (h >>> 0).toString(16).padStart(8, "0");
}

type Comp = {
  id: string; // scope id
  component: string; // path shown to the user, e.g. "src/components/ui-button"
  relDir: string; // relative to src/, e.g. "components/ui-button"
  selector: string; // folder basename / custom tag
  kind: "static" | "island" | "page";
  isolate: string; // "edit in isolation" instruction
};

async function isFile(p: string): Promise<boolean> {
  try {
    return (await Deno.stat(p)).isFile;
  } catch {
    return false;
  }
}
async function isDir(p: string): Promise<boolean> {
  try {
    return (await Deno.stat(p)).isDirectory;
  } catch {
    return false;
  }
}

/** Read a component's isolate/ folder → the `sprig isolate` route + cases (best effort). */
async function isolateHint(dir: string, relDir: string, kind: Comp["kind"]): Promise<string> {
  const iso = join(dir, "isolate");
  if (!(await isDir(iso))) {
    return `No isolate/ yet — add one for src/${relDir}/ (see breakdown isolate-format), then \`sprig isolate\` and edit it.`;
  }
  let category = basename(relDir);
  let folder = "";
  try {
    const fx = JSON.parse(await Deno.readTextFile(join(iso, "fixture.json")));
    if (typeof fx.category === "string") category = fx.category;
    if (typeof fx.folder === "string") folder = fx.folder;
  } catch { /* defaults */ }
  const cases: string[] = [];
  try {
    for await (const e of Deno.readDir(join(iso, "cases"))) if (e.isDirectory) cases.push(e.name);
  } catch { /* none */ }
  const root = kind === "page" ? "pages" : "components";
  const seg = [root, category, folder].filter(Boolean).join("/");
  const caseHint = cases.length ? `/{${cases.join("|")}}` : "/<case>";
  return `\`sprig isolate\` → /${seg}${caseHint} — edit src/${relDir}/ (template.html / logic.ts / styles.css).`;
}

/** Scan src/ for folder-components (a dir with a template.html) → scope-id map. */
async function scanComponents(): Promise<Map<string, Comp>> {
  const out = new Map<string, Comp>();
  async function walk(dir: string) {
    let hasTpl = false;
    const subdirs: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        if (e.isDirectory) subdirs.push(join(dir, e.name));
        else if (e.name === "template.html") hasTpl = true;
      }
    } catch {
      return;
    }
    if (hasTpl) {
      const relDir = relative(SRC, dir).replace(/\\/g, "/");
      if (relDir && relDir !== "shell") {
        const kind: Comp["kind"] = relDir.startsWith("pages/") || relDir === "pages"
          ? "page"
          : (await isFile(join(dir, "logic.ts")))
          ? "island"
          : "static";
        out.set(scopeId(relDir), {
          id: scopeId(relDir),
          component: "src/" + relDir,
          relDir,
          selector: basename(relDir),
          kind,
          isolate: await isolateHint(dir, relDir, kind),
        });
      }
    }
    for (const d of subdirs) await walk(d);
  }
  if (await isDir(SRC)) await walk(SRC);
  return out;
}

const COMPONENTS = await scanComponents();

// ---- notes store (component-keyed) ----
type Note = { component: string; selector: string; kind: string; isolate: string; notes: string[] };
type Store = Record<string, Note | string>;

const HOWTO =
  "Each entry is a COMPONENT to edit IN ISOLATION. For each: run `sprig isolate` in the app dir, " +
  "open the component at its route, edit src/<component>/ (template.html / logic.ts / styles.css) to " +
  "address its notes, verify in the workbench, then delete the entry. Keyed by component path, not selector.";

async function readNotes(): Promise<Store> {
  try {
    const j = JSON.parse(await Deno.readTextFile(NOTES_PATH));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}
async function writeNotes(store: Store): Promise<void> {
  await Deno.mkdir(dirname(NOTES_PATH), { recursive: true });
  const ordered: Store = { _howto: HOWTO };
  for (const [k, v] of Object.entries(store)) if (k !== "_howto") ordered[k] = v;
  await Deno.writeTextFile(NOTES_PATH, JSON.stringify(ordered, null, 2) + "\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function injectOverlay(html: string): string {
  // The client only needs id → {selector, component, kind} to label + pick the ancestor marker.
  const lite: Record<string, { selector: string; component: string; kind: string }> = {};
  for (const [id, c] of COMPONENTS) lite[id] = { selector: c.selector, component: c.component, kind: c.kind };
  const cfg = JSON.stringify({ components: lite });
  const tag = `\n<script>window.__SPRIG_ANNOTATE__=${cfg};</script>\n<script>\n${CLIENT_JS}\n</script>\n`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

function outHeaders(h: Headers): Headers {
  const o = new Headers(h);
  for (const k of ["content-encoding", "content-length", "transfer-encoding", "connection"]) o.delete(k);
  return o;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  // ---- annotate API ----
  if (p === "/__annotate/state") return json(await readNotes());
  if (p === "/__annotate/clear" && req.method === "POST") {
    await writeNotes({});
    return json(await readNotes());
  }
  if (p === "/__annotate/save" && req.method === "POST") {
    const body = (await req.json()) as { id?: string; selector?: string; note?: string; _delete?: string };
    const store = await readNotes();
    if (body._delete) {
      delete store[body._delete];
      await writeNotes(store);
      return json(await readNotes());
    }
    const note = String(body.note || "").trim();
    if (!note) return json({ error: "empty note" }, 400);
    const comp = body.id ? COMPONENTS.get(body.id) : undefined;
    const key = comp ? comp.component : `unresolved:${body.selector || "?"}`;
    const existing = store[key];
    const entry: Note = (existing && typeof existing === "object")
      ? existing as Note
      : comp
      ? { component: comp.component, selector: comp.selector, kind: comp.kind, isolate: comp.isolate, notes: [] }
      : {
        component: key,
        selector: body.selector || "?",
        kind: "unresolved",
        isolate: "Couldn't map this element to a component (no scope-id marker). Locate it by its selector and edit the owning component in isolation.",
        notes: [],
      };
    entry.notes.push(note);
    store[key] = entry;
    await writeNotes(store);
    return json(await readNotes());
  }

  // ---- proxy everything else to the running app, injecting the overlay into HTML ----
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const fw = new Headers(req.headers);
  fw.delete("host");
  fw.delete("accept-encoding"); // ask upstream for identity so HTML injection sees raw bytes
  let up: Response;
  try {
    up = await fetch(args.target + p + url.search, {
      method: req.method,
      headers: fw,
      body: hasBody ? new Uint8Array(await req.arrayBuffer()) : undefined,
      redirect: "manual",
    });
  } catch {
    return new Response(
      `build-annotate: cannot reach the app at ${args.target}. Is it running? (\`sprig dev\` / \`sprig serve\`)`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const ct = up.headers.get("content-type") || "";
  // Only BUFFER html (to inject the overlay). Everything else — assets, /api, and crucially the
  // HMR SSE stream (`text/event-stream`, which never ends) — streams straight through; buffering
  // an SSE body with arrayBuffer() would hang forever.
  if (/^text\/html/i.test(ct)) {
    const html = injectOverlay(new TextDecoder().decode(await up.arrayBuffer()));
    const h = outHeaders(up.headers);
    h.set("cache-control", "no-store");
    return new Response(html, { status: up.status, headers: h });
  }
  return new Response(up.body, { status: up.status, headers: outHeaders(up.headers) });
}

const pageURL = `http://${args.host === "0.0.0.0" ? "localhost" : args.host}:${args.port}/ui`;

console.error("");
console.error("  build annotate");
console.error("  ──────────────");
console.error(`  app       : ${APP}`);
console.error(`  target    : ${args.target}  (the running sprig app)`);
console.error(`  components : ${COMPONENTS.size} folder-components mapped from src/`);
console.error(`  notes     : ${NOTES_PATH}`);
console.error(`  open      : ${pageURL}`);
console.error("");
if (COMPONENTS.size === 0) {
  console.error("  ⚠ No folder-components found under src/ — is --app the sprig app dir?");
  console.error("");
}
console.error("  ⌘/Ctrl+click any element → type a note → save.");
console.error("  The note is keyed to the COMPONENT that owns it (not a selector), with");
console.error("  its `sprig isolate` route — go edit that component in isolation.");
console.error("  Then re-run /build (or read spec/ui/build-notes.json). Ctrl+C to stop.");
console.error("");

if (args.open) {
  const cmd = Deno.build.os === "darwin" ? "open" : Deno.build.os === "windows" ? "explorer" : "xdg-open";
  try {
    new Deno.Command(cmd, { args: [pageURL], stdout: "null", stderr: "null" }).spawn();
  } catch { /* ignore */ }
}

Deno.serve({ port: args.port, hostname: args.host, onListen: () => {} }, handler);
