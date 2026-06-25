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
import { basename, dirname, fromFileUrl, join, relative } from "@std/path";
import { componentScopeId } from "./compiler/scope.ts";

const HERE = dirname(fromFileUrl(import.meta.url));

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
  const cfg = JSON.stringify({ components: lite });

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
