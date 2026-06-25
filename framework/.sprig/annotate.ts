// Build-stage annotate, folded INTO `sprig dev` (the `--annotate` flag). Injects a
// ⌘/Ctrl+click overlay into the dev server's HTML and keys each note to the COMPONENT
// that owns the clicked element — resolved from sprig's view-encapsulation scope-id
// marker (`<div s1a2b3c4d …>`). The note carries the component's `sprig isolate` route
// so a build session goes and edits that component in isolation. Notes persist to
// <appDir>/spec/ui/build-notes.json (component-keyed). The companion overlay is
// annotate-client.js next to this file.
//
// Parity is structural: we resolve markers with the SAME componentScopeId the renderer
// stamps with — imported, not copied.
import { basename, dirname, extname, fromFileUrl, join, relative, resolve } from "@std/path";
import { componentScopeId } from "./compiler/scope.ts";

const HERE = dirname(fromFileUrl(import.meta.url));

/** Decode a `data:image/png;base64,…` URL into raw bytes (shared by both modes' /shot). */
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
function safeKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "shot";
}
let _shot = 0;
function shotId(): string {
  return Date.now().toString(36) + "-" + (++_shot);
}

export interface Comp {
  id: string; // scope id (the bare marker attribute on the component's elements)
  component: string; // path shown to the user, e.g. "src/components/ui-button"
  relDir: string; // relative to src/, e.g. "components/ui-button"
  selector: string; // folder basename / custom tag
  kind: "static" | "island" | "page";
  isolate: string; // "edit in isolation" instruction (route hint)
  isolateUrl: string; // a clickable workbench URL (when the isolate server's base is known), else ""
}

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

async function isolateInfo(
  dir: string,
  relDir: string,
  kind: Comp["kind"],
  isolateBase: string,
): Promise<{ isolate: string; isolateUrl: string }> {
  const iso = join(dir, "isolate");
  if (!(await isDir(iso))) {
    return {
      isolate: `No isolate/ yet — add one for src/${relDir}/ (see breakdown isolate-format), then verify it in \`sprig isolate\`.`,
      isolateUrl: "",
    };
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
  const firstCase = cases[0] ?? "";
  const caseHint = cases.length ? `/{${cases.join("|")}}` : "/<case>";
  const base = isolateBase.replace(/\/+$/, "");
  return {
    isolate: `Verify in isolation: ${base ? base + "/" : "`sprig isolate` → /"}${seg}${caseHint} — edit src/${relDir}/.`,
    isolateUrl: base ? `${base}/${seg}${firstCase ? "/" + firstCase : ""}` : "",
  };
}

/** Scan src/ for folder-components (a dir with a template.html) → scope-id → component map. */
export async function scanComponents(srcDir: string, isolateBase = ""): Promise<Map<string, Comp>> {
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
      const relDir = relative(srcDir, dir).replace(/\\/g, "/");
      if (relDir && relDir !== "shell") {
        const kind: Comp["kind"] = relDir.startsWith("pages/") || relDir === "pages"
          ? "page"
          : (await isFile(join(dir, "logic.ts")))
          ? "island"
          : "static";
        const id = componentScopeId(relDir);
        const { isolate, isolateUrl } = await isolateInfo(dir, relDir, kind, isolateBase);
        out.set(id, { id, component: "src/" + relDir, relDir, selector: basename(relDir), kind, isolate, isolateUrl });
      }
    }
    for (const d of subdirs) await walk(d);
  }
  if (await isDir(srcDir)) await walk(srcDir);
  return out;
}

type Note = { component: string; selector: string; kind: string; isolate: string; isolateUrl: string; notes: string[] };
type Store = Record<string, Note | string>;

const HOWTO =
  "Each entry is a COMPONENT to edit IN ISOLATION. For each: open it in `sprig isolate` at its route " +
  "(isolateUrl), edit src/<component>/ (template.html / logic.ts / styles.css) to address its notes, " +
  "verify there (not the prod app), then delete the entry. Keyed by component path, not selector.";

export interface Annotate {
  size: number;
  /** Handle an /__annotate/* request, or return null if it isn't one. */
  handle(req: Request): Promise<Response | null>;
  /** Inject the overlay into an HTML Response (returns the response unchanged if not HTML). */
  inject(res: Response): Promise<Response>;
}

export async function makeAnnotate(
  opts: { appDir: string; srcDir: string; isolateBase?: string },
): Promise<Annotate> {
  const components = await scanComponents(opts.srcDir, opts.isolateBase ?? "");
  const notesPath = join(opts.appDir, "spec", "ui", "build-notes.json");
  const clientJs = await Deno.readTextFile(join(HERE, "annotate-client.js"));

  // The client only needs id → {selector, component, kind, isolateUrl} to label + deep-link.
  const lite: Record<string, { selector: string; component: string; kind: string; isolateUrl: string }> = {};
  for (const [id, c] of components) {
    lite[id] = { selector: c.selector, component: c.component, kind: c.kind, isolateUrl: c.isolateUrl };
  }
  const cfg = JSON.stringify({ mode: "build", components: lite });

  async function readNotes(): Promise<Store> {
    try {
      const j = JSON.parse(await Deno.readTextFile(notesPath));
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }
  async function writeNotes(store: Store): Promise<void> {
    await Deno.mkdir(dirname(notesPath), { recursive: true });
    const ordered: Store = { _howto: HOWTO };
    for (const [k, v] of Object.entries(store)) if (k !== "_howto") ordered[k] = v;
    await Deno.writeTextFile(notesPath, JSON.stringify(ordered, null, 2) + "\n");
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

  return {
    size: components.size,
    async handle(req: Request): Promise<Response | null> {
      const p = new URL(req.url).pathname;
      if (!p.startsWith("/__annotate/")) return null;
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
        const comp = body.id ? components.get(body.id) : undefined;
        const key = comp ? comp.component : `unresolved:${body.selector || "?"}`;
        const existing = store[key];
        const entry: Note = (existing && typeof existing === "object")
          ? existing as Note
          : comp
          ? { component: comp.component, selector: comp.selector, kind: comp.kind, isolate: comp.isolate, isolateUrl: comp.isolateUrl, notes: [] }
          : {
            component: key,
            selector: body.selector || "?",
            kind: "unresolved",
            isolate: "Couldn't map this element to a component (no scope-id marker). Locate it by its selector and edit the owning component in isolation.",
            isolateUrl: "",
            notes: [],
          };
        entry.notes.push(note);
        store[key] = entry;
        await writeNotes(store);
        return json(await readNotes());
      }
      if (p === "/__annotate/shot" && req.method === "POST") {
        const body = (await req.json()) as { key?: string; feedback?: string; image?: string };
        const bytes = decodePngDataUrl(body.image || "");
        const store = await readNotes();
        const key = body.key || `drawing:${shotId()}`;
        let imgName = "";
        if (bytes) {
          imgName = `build-notes.${safeKey(key)}.png`;
          await Deno.mkdir(dirname(notesPath), { recursive: true });
          await Deno.writeFile(join(dirname(notesPath), imgName), bytes);
        }
        store[key] = {
          component: imgName || "(screenshot)",
          selector: "✎ drawing",
          kind: "drawing",
          isolate: "A screenshot note — not tied to a component. Review the image and fix the relevant component(s) in isolation.",
          isolateUrl: "",
          notes: [String(body.feedback || "").trim() || "(no note)"],
        } as Note;
        await writeNotes(store);
        return json(await readNotes());
      }
      return json({ error: "unknown annotate route" }, 404);
    },
    async inject(res: Response): Promise<Response> {
      const ct = res.headers.get("content-type") || "";
      if (!/^text\/html/i.test(ct)) return res;
      const html = await res.text();
      const tag = `\n<script>window.__SPRIG_ANNOTATE__=${cfg};</script>\n<script>\n${clientJs}\n</script>\n`;
      const i = html.toLowerCase().lastIndexOf("</body>");
      const out = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
      const h = new Headers(res.headers);
      h.delete("content-length");
      h.set("cache-control", "no-store");
      return new Response(out, { status: res.status, headers: h });
    },
  };
}

// ============================================================
// PROTOTYPE mode — `sprig dev --annotate <html>`
// Serve a single throwaway HTML file (+ its dir) with the SAME overlay, keyed to the
// ELEMENT by CSS selector. Persists to a sibling <name>.feedback.json; supports the inline
// data-note source patch and screenshot notes. This is the old standalone serve.ts, folded in.
// ============================================================

const CT: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// --- inline source-patch: write data-note(+css) onto the matched opening tag in the HTML ---
function maskedRegions(src: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ").trim();
}
function setTagAttr(openTag: string, name: string, value: string | null): string {
  const attrRe = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, "i");
  if (value === null || value === "") return openTag.replace(attrRe, "");
  const inject = ` ${name}="${escapeAttr(value)}"`;
  if (attrRe.test(openTag)) return openTag.replace(attrRe, inject);
  return openTag.replace(/\s*\/?>$/, (end) => inject + (end.trim().startsWith("/") ? " />" : ">"));
}
function patchInlineNote(
  src: string,
  o: { tag: string; classes?: string; id?: string; idx?: number; note?: string; css?: string; remove?: boolean },
): { patched: boolean; src?: string } {
  const tag = (o.tag || "").toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return { patched: false };
  const want = (o.classes || "").split(/\s+/).filter(Boolean);
  const masks = maskedRegions(src);
  const inMask = (pos: number) => masks.some(([s, e]) => pos >= s && pos < e);
  const tagRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const hits: Array<{ index: number; openTag: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    if (inMask(m.index)) continue;
    const openTag = m[0];
    const clsM = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
    const cls = ((clsM && (clsM[2] ?? clsM[3])) || "").split(/\s+/).filter(Boolean);
    if (want.length && !want.every((c) => cls.includes(c))) continue;
    if (o.id) {
      const idM = /\sid\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
      if (((idM && (idM[2] ?? idM[3])) || "") !== o.id) continue;
    }
    hits.push({ index: m.index, openTag });
  }
  if (!hits.length) return { patched: false };
  const target = hits[Math.min(Math.max(o.idx ?? 0, 0), hits.length - 1)];
  let nt = setTagAttr(target.openTag, "data-note", o.remove ? null : (o.note ?? ""));
  nt = setTagAttr(nt, "data-note-css", o.remove || !o.css ? null : o.css);
  if (nt === target.openTag) return { patched: true, src };
  return { patched: true, src: src.slice(0, target.index) + nt + src.slice(target.index + target.openTag.length) };
}

export function makePrototypeAnnotate(opts: { htmlPath: string }): { fetch(req: Request): Promise<Response> } {
  const protoAbs = resolve(opts.htmlPath);
  const ROOT = dirname(protoAbs);
  const PROTO_NAME = basename(protoAbs);
  const FEEDBACK_NAME = PROTO_NAME.replace(/\.html?$/i, "") + ".feedback";
  const FEEDBACK_PATH = join(ROOT, FEEDBACK_NAME + ".json");
  let clientJs = "";
  const cfg = JSON.stringify({ mode: "prototype", file: PROTO_NAME, feedbackName: FEEDBACK_NAME });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

  // deno-lint-ignore no-explicit-any
  async function readFeedback(): Promise<Record<string, any>> {
    try {
      const j = JSON.parse(await Deno.readTextFile(FEEDBACK_PATH));
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }
  // deno-lint-ignore no-explicit-any
  async function writeFeedback(data: Record<string, any>): Promise<void> {
    await Deno.writeTextFile(FEEDBACK_PATH, JSON.stringify(data, null, 2) + "\n");
  }
  function inject(html: string): string {
    const tag = `\n<script>window.__SPRIG_ANNOTATE__=${cfg};</script>\n<script>\n${clientJs}\n</script>\n`;
    const i = html.toLowerCase().lastIndexOf("</body>");
    return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  function safePath(pathname: string): string | null {
    const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
    const target = resolve(ROOT, rel);
    if (target !== ROOT && !target.startsWith(ROOT + "/")) return null;
    return target;
  }

  return {
    async fetch(req: Request): Promise<Response> {
      if (!clientJs) clientJs = await Deno.readTextFile(join(HERE, "annotate-client.js"));
      const url = new URL(req.url);
      const p = url.pathname;

      if (p === "/__annotate/state") return json(await readFeedback());
      if (p === "/__annotate/clear" && req.method === "POST") {
        await writeFeedback({});
        return json({});
      }
      if (p === "/__annotate/save" && req.method === "POST") {
        // deno-lint-ignore no-explicit-any
        const entry = (await req.json()) as any;
        const data = await readFeedback();
        const key = entry.key;
        if (!key) return json({ error: "missing key" }, 400);
        if (entry._delete || !String(entry.feedback || "").trim()) delete data[key];
        else {
          delete entry._delete;
          delete entry.key;
          data[key] = entry;
        }
        await writeFeedback(data);
        return json(data);
      }
      if (p === "/__annotate/inline" && req.method === "POST") {
        const o = (await req.json()) as { tag: string; classes?: string; id?: string; idx?: number; note?: string; css?: string; remove?: boolean };
        if (!o.tag) return json({ ok: false, error: "missing tag" }, 400);
        let html: string;
        try {
          html = await Deno.readTextFile(protoAbs);
        } catch {
          return json({ ok: false, error: "cannot read source" }, 500);
        }
        const r = patchInlineNote(html, o);
        if (!r.patched) return json({ ok: false, reason: "not-in-source" });
        if (r.src && r.src !== html) await Deno.writeTextFile(protoAbs, r.src);
        return json({ ok: true });
      }
      if (p === "/__annotate/shot" && req.method === "POST") {
        // deno-lint-ignore no-explicit-any
        const entry = (await req.json()) as any;
        const key = entry.key;
        if (!key) return json({ error: "missing key" }, 400);
        const bytes = decodePngDataUrl(entry.image || "");
        if (!bytes) return json({ error: "bad image" }, 400);
        const imgName = `${FEEDBACK_NAME}.${safeKey(key)}.png`;
        await Deno.writeFile(join(ROOT, imgName), bytes);
        const data = await readFeedback();
        delete entry.key;
        entry.image = imgName;
        data[key] = entry;
        await writeFeedback(data);
        return json(data);
      }

      // static files (overlay injected into HTML)
      let target = p === "/" ? join(ROOT, PROTO_NAME) : safePath(p);
      if (!target) return new Response("Forbidden", { status: 403 });
      try {
        if ((await Deno.stat(target)).isDirectory) target = join(target, "index.html");
      } catch {
        return new Response("Not found", { status: 404 });
      }
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(target);
      } catch {
        return new Response("Not found", { status: 404 });
      }
      const ct = CT[extname(target).toLowerCase()] || "application/octet-stream";
      if (/^text\/html/.test(ct)) {
        return new Response(inject(new TextDecoder().decode(bytes)), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response(bytes as unknown as BodyInit, {
        headers: { "content-type": ct, "cache-control": "no-store" },
      });
    },
  };
}
