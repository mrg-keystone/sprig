#!/usr/bin/env -S deno run -A
/* ============================================================
 * prototype annotate — local server / wrapper
 *
 * Serves a prototype's directory over http://localhost and
 * injects the cmd/ctrl+click feedback overlay into the target
 * HTML. Feedback is persisted to "<prototype-basename>.feedback.json"
 * RIGHT NEXT TO the prototype, so /prototype can pick it up.
 *
 *   deno run -A serve.ts <prototype.html> [--port 4505] [--open] [--host 127.0.0.1]
 *
 * Why a server (instead of just double-clicking the file)? A
 * file:// page cannot write a file next to itself. This tiny
 * server is the thing that does the writing. If you DO open the
 * raw file:// page, the overlay still works and falls back to a
 * downloadable JSON.
 * ========================================================== */

import { contentType } from "@std/media-types/content-type";
import { basename, dirname, extname, join, resolve } from "@std/path";

type Args = { file: string; port: number; host: string; open: boolean };

function parseArgs(argv: string[]): Args {
  let file = "";
  let port = 4505;
  let host = "127.0.0.1";
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") port = Number(argv[++i]);
    else if (a === "--host") host = argv[++i];
    else if (a === "--open") open = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      Deno.exit(0);
    } else if (!a.startsWith("-")) file = a;
  }
  if (!file) {
    printHelp();
    Deno.exit(1);
  }
  return { file, port, host, open };
}

function printHelp() {
  console.error(
    "Usage: deno run -A serve.ts <prototype.html> [--port 4505] [--open] [--host 127.0.0.1]\n\n" +
      "  cmd/ctrl+click an element  → type feedback, save\n" +
      "    · in the box: 'tree' picks any element from the HTML tree,\n" +
      "      'css' opens a live CSS editor saved as feedback\n" +
      "  shift+cmd/ctrl + drag      → draw on the page → save a screenshot note\n\n" +
      "  Feedback → <prototype-basename>.feedback.json next to the prototype\n" +
      "  (screenshots → <prototype-basename>.feedback.<id>.png alongside it).",
  );
}

const HERE = dirname(new URL(import.meta.url).pathname);
const CLIENT_JS = await Deno.readTextFile(join(HERE, "client.js"));

const args = parseArgs(Deno.args);
const protoAbs = resolve(args.file);
let stat: Deno.FileInfo;
try {
  stat = await Deno.stat(protoAbs);
} catch {
  console.error(`Not found: ${protoAbs}`);
  Deno.exit(1);
}
if (!stat.isFile) {
  console.error(`Not a file: ${protoAbs}`);
  Deno.exit(1);
}

const ROOT = dirname(protoAbs);
const PROTO_NAME = basename(protoAbs);
const FEEDBACK_NAME = PROTO_NAME.replace(/\.html?$/i, "") + ".feedback";
const FEEDBACK_PATH = join(ROOT, FEEDBACK_NAME + ".json");

type Entry = {
  key: string;
  feedback: string;
  selector?: string;
  id?: string;
  classes?: string;
  tag?: string;
  text?: string;
  html?: string;
  trail?: string;
  xpath?: string;
  css?: string; // CSS declarations to apply to the element (from the css editor)
  kind?: string; // "drawing" for screenshot+sketch entries, else element feedback
  image?: string; // filename of a saved screenshot (drawing entries), next to the prototype
  viewport?: { w: number; h: number; scrollX: number; scrollY: number };
};

// Turn an annotation key into a filesystem-safe basename fragment.
function safeKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "shot";
}

// Decode a `data:image/png;base64,...` URL into raw bytes.
function decodePngDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl || "");
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function readFeedback(): Promise<Record<string, Entry>> {
  try {
    const raw = await Deno.readTextFile(FEEDBACK_PATH);
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

async function writeFeedback(data: Record<string, Entry>): Promise<void> {
  await Deno.writeTextFile(FEEDBACK_PATH, JSON.stringify(data, null, 2) + "\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function injectOverlay(html: string): string {
  const cfg = JSON.stringify({ file: PROTO_NAME, feedbackName: FEEDBACK_NAME });
  const tag = `\n<script>window.__ANNOTATE__=${cfg};</script>\n` +
    `<script>\n${CLIENT_JS}\n</script>\n`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  if (i === -1) return html + tag;
  return html.slice(0, i) + tag + html.slice(i);
}

// Resolve a request path to a file under ROOT, blocking traversal.
function safePath(pathname: string): string | null {
  const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
  const target = resolve(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + "/")) return null;
  return target;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  // ---- annotate API ----
  if (p === "/__annotate/state") {
    return json(await readFeedback());
  }
  if (p === "/__annotate/save" && req.method === "POST") {
    const entry = (await req.json()) as Entry & { _delete?: boolean };
    const data = await readFeedback();
    const key = entry.key;
    if (!key) return json({ error: "missing key" }, 400);
    if (entry._delete || !String(entry.feedback || "").trim()) {
      delete data[key];
    } else {
      delete (entry as { _delete?: boolean })._delete;
      delete (entry as { key?: string }).key; // redundant with the object's own key
      data[key] = entry;
    }
    await writeFeedback(data);
    return json(data);
  }
  if (p === "/__annotate/clear" && req.method === "POST") {
    await writeFeedback({});
    return json({});
  }
  // Save a drawing/screenshot: write the PNG next to the prototype, record an
  // entry that points at the filename (not the giant data URL).
  if (p === "/__annotate/shot" && req.method === "POST") {
    const entry = (await req.json()) as Entry & { image?: string };
    const key = entry.key;
    if (!key) return json({ error: "missing key" }, 400);
    const bytes = decodePngDataUrl(entry.image || "");
    if (!bytes) return json({ error: "bad image" }, 400);
    const imgName = `${FEEDBACK_NAME}.${safeKey(key)}.png`;
    await Deno.writeFile(join(ROOT, imgName), bytes);
    const data = await readFeedback();
    delete (entry as { key?: string }).key;
    entry.image = imgName; // store the filename, never the data URL
    data[key] = entry;
    await writeFeedback(data);
    return json(data);
  }

  // ---- static files (with overlay injection for the prototype) ----
  let target = p === "/" ? join(ROOT, PROTO_NAME) : safePath(p);
  if (!target) return new Response("Forbidden", { status: 403 });

  try {
    const info = await Deno.stat(target);
    if (info.isDirectory) target = join(target, "index.html");
  } catch {
    return new Response("Not found", { status: 404 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = extname(target);
  const ct = contentType(ext) || "application/octet-stream";

  // Inject overlay into the prototype HTML (and any html served).
  if (/^text\/html/.test(ct)) {
    const html = injectOverlay(new TextDecoder().decode(bytes));
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: { "content-type": ct, "cache-control": "no-store" },
  });
}

function openBrowser(target: string) {
  const cmd = Deno.build.os === "darwin"
    ? "open"
    : Deno.build.os === "windows"
    ? "explorer"
    : "xdg-open";
  try {
    new Deno.Command(cmd, { args: [target], stdout: "null", stderr: "null" })
      .spawn();
  } catch {
    /* ignore */
  }
}

const pageURL = `http://${
  args.host === "0.0.0.0" ? "localhost" : args.host
}:${args.port}/${PROTO_NAME}`;

console.error("");
console.error("  prototype annotate");
console.error("  ──────────────────");
console.error(`  prototype : ${protoAbs}`);
console.error(`  feedback  : ${FEEDBACK_PATH}`);
console.error(`  open      : ${pageURL}`);
console.error("");
console.error("  cmd/ctrl+click an element → type feedback → save.");
console.error("    in the box: 'tree' = pick any element · 'css' = live CSS editor");
console.error("  shift+cmd/ctrl + drag → draw → save a screenshot note.");
console.error("  Then re-run /prototype to apply it. Ctrl+C to stop.");
console.error("");

if (args.open) openBrowser(pageURL);

Deno.serve(
  { port: args.port, hostname: args.host, onListen: () => {} },
  handler,
);
