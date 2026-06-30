// _start.ts — the prototype host (the "framework"; the UI never sees this).
//
// `deno task start` runs this. It is the ENTIRE server side, and it is generic —
// it knows nothing about Sprout, tasks, or any specific app. Everything app-
// specific lives in the AI-authored files: objects/*.json (read seed) +
// commands.json (write contract) + _test-prototype.html (the UI). The host:
//
//   1. Serves the UI, injecting the two seams + annotate at serve time.
//   2. READS  — GET /objects, /objects/:type, /objects/:type/:id   (the read model)
//   3. WRITES — POST /commands/:name                               (intents, applied
//      generically by `kind`, appended to the append-only events.json)
//   4. Introspection — GET /commands (the write contract) and GET /events (the log),
//      so a tool can read the whole contract over HTTP and derive the rune spec.
//   5. annotate — ⌘/Ctrl+click any element to leave a note (→ feedback/).
//
// The point of the format: the UI talks to /objects + /commands and never knows
// where data lives or how writes are stored. Swap this host for a keep backend
// and the UI does not change. This file is the reusable bit that graduates to
// /dev-tools; the AI only ever touches the three app files.

const ROOT = new URL(".", import.meta.url).pathname;
const HTML = ROOT + "_test-prototype.html";
const OBJECTS_DIR = ROOT + "objects";
const COMMANDS_FILE = ROOT + "commands.json";
const EVENTS_FILE = ROOT + "events.json";
const FEEDBACK_DIR = ROOT + "feedback";
const PORT = Number(Deno.env.get("PORT") ?? 8723);

type Obj = Record<string, unknown> & { id: string };
type CommandDef = { type: string; kind: string; field?: string; by?: string; input: Record<string, string>; does?: string };

// ---------------------------------------------------------------------------
// State. The read model is held IN MEMORY, seeded from objects/*.json at boot —
// so commands mutate a live projection while the authored seed files stay
// pristine, and a restart is a clean reset. events.json (the append-only log of
// every command) persists: it is the source of truth; the projection is derived.
// ---------------------------------------------------------------------------
const state: Record<string, Obj[]> = {};
let commands: Record<string, CommandDef> = {};

async function boot() {
  for await (const e of Deno.readDir(OBJECTS_DIR)) {
    if (e.isFile && e.name.endsWith(".json")) {
      const type = e.name.slice(0, -5);
      state[type] = JSON.parse(await Deno.readTextFile(`${OBJECTS_DIR}/${type}.json`));
    }
  }
  const raw = JSON.parse(await Deno.readTextFile(COMMANDS_FILE));
  // Keep only the real command entries (drop the $doc/$kinds documentation keys).
  commands = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as Record<string, CommandDef>;
}

const newId = (t: string) => t.slice(0, 1) + "_" + crypto.randomUUID().slice(0, 6);

async function appendEvent(ev: unknown) {
  let all: unknown[] = [];
  try { all = JSON.parse(await Deno.readTextFile(EVENTS_FILE)); } catch { /* first event */ }
  all.push(ev);
  await Deno.writeTextFile(EVENTS_FILE, JSON.stringify(all, null, 2));
}

// The generic command applier. A handful of `kind`s cover every write shape, and
// each maps to a rune:data immutability strategy (see commands.json $kinds). The
// AI never writes a reducer — it DECLARES the command and the host applies it.
async function runCommand(name: string, input: Record<string, unknown>): Promise<Obj | { error: string }> {
  const def = commands[name];
  if (!def) return { error: `no command "${name}"` };
  const coll = state[def.type];
  if (!coll) return { error: `command "${name}" targets unknown type "${def.type}"` };
  const fields = Object.keys(def.input);
  const setable = (o: Obj) => { for (const f of fields) if (f !== "id" && f in input) o[f] = input[f]; };
  const find = () => coll.find((o) => o.id === input.id);

  let result: Obj;
  switch (def.kind) {
    case "create": {
      const o = { id: newId(def.type) } as Obj;
      for (const f of fields) if (f in input) o[f] = input[f];
      coll.push(o); result = o; break;
    }
    case "set": {
      const o = find(); if (!o) return { error: `no ${def.type} "${input.id}"` };
      setable(o); result = o; break;
    }
    case "append": {
      const o = find(); if (!o) return { error: `no ${def.type} "${input.id}"` };
      const field = def.field ?? "items";
      const child = { id: newId(field) } as Obj;
      for (const f of fields) if (f !== "id" && f in input) child[f] = input[f];
      ((o[field] ??= []) as Obj[]).push(child); result = child; break;
    }
    case "adjust": {
      const o = find(); if (!o) return { error: `no ${def.type} "${input.id}"` };
      const field = def.field ?? "count";
      o[field] = (Number(o[field]) || 0) + (Number(input[def.by ?? "by"]) || 0); result = o; break;
    }
    case "remove": {
      const i = coll.findIndex((o) => o.id === input.id);
      if (i < 0) return { error: `no ${def.type} "${input.id}"` };
      result = coll.splice(i, 1)[0]; break;
    }
    default:
      return { error: `command "${name}" has unknown kind "${def.kind}"` };
  }
  await appendEvent({ command: name, kind: def.kind, input, ts: new Date().toISOString() });
  return result;
}

// ---------------------------------------------------------------------------
// The two seams + annotate, injected into every served page. The UI file stays
// pure presentation; these are host concerns bolted on at serve time.
// ---------------------------------------------------------------------------
const SEAMS_CLIENT = /* html */ `
<script>
// READ seam — ask for objects of a type; never know where they live.
window.objects = {
  types: () => fetch("/objects").then((r) => r.json()),
  all:   (type) => fetch("/objects/" + type).then((r) => r.json()),
  get:   (type, id) => fetch("/objects/" + type + "/" + encodeURIComponent(id)).then((r) => r.ok ? r.json() : null),
};
// WRITE seam — fire an intent; never edit a record in place. Returns the result
// object (or rejects with the host's error), so the UI can reconcile optimism.
window.commands = {
  list: () => fetch("/commands").then((r) => r.json()),
  run: (name, input) => fetch("/commands/" + name, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  }).then(async (r) => { const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || "command failed"); return d; }),
};
</script>`;

const ANNOTATE_OVERLAY = /* html */ `
<script>
(() => {
  let notes = 0;
  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;right:14px;bottom:14px;z-index:2147483647;font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;" +
    "background:#111827;color:#fff;padding:8px 12px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:default;user-select:none";
  const render = () =>
    (badge.textContent = "✎ annotate — ⌘/Ctrl+click an element · " + notes + " note" + (notes === 1 ? "" : "s"));
  render();
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(badge));

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let sel = el.nodeName.toLowerCase();
      if (el.id) { sel += "#" + el.id; parts.unshift(sel); break; }
      const cls = (el.className && typeof el.className === "string")
        ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
      const sibs = el.parentNode ? [...el.parentNode.children].filter((c) => c.nodeName === el.nodeName) : [];
      if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")";
      parts.unshift(sel + cls);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function flash(el) {
    const o = el.style.outline, off = el.style.outlineOffset;
    el.style.outline = "2px solid #6366f1"; el.style.outlineOffset = "2px";
    setTimeout(() => { el.style.outline = o; el.style.outlineOffset = off; }, 900);
  }
  function toast(msg, ok) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;left:50%;bottom:60px;transform:translateX(-50%);z-index:2147483647;" +
      "background:" + (ok ? "#059669" : "#dc2626") + ";color:#fff;padding:10px 16px;border-radius:8px;" +
      "font:500 13px ui-sans-serif,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  document.addEventListener("click", async (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    const note = prompt("Note for «" + (el.textContent || el.nodeName).trim().slice(0, 40) + "» :");
    if (!note) return;
    flash(el);
    try {
      const res = await fetch("/_feedback", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ note, selector: cssPath(el), text: (el.textContent || "").trim().slice(0, 120), url: location.pathname, ts: new Date().toISOString() }),
      });
      if (res.ok) { notes++; render(); toast("saved to feedback/", true); }
      else toast("save failed", false);
    } catch { toast("save failed (server down?)", false); }
  }, true);
})();
</script>`;

function injectHost(html: string): string {
  let out = html.includes("</head>") ? html.replace("</head>", SEAMS_CLIENT + "\n</head>") : SEAMS_CLIENT + html;
  out = out.includes("</body>") ? out.replace("</body>", ANNOTATE_OVERLAY + "\n</body>") : out + ANNOTATE_OVERLAY;
  return out;
}

// ---------------------------------------------------------------------------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json" } });

await boot();

Deno.serve({
  port: PORT,
  onListen: ({ port }) => {
    console.log(`\n  ✎ prototype host running\n`);
    console.log(`     UI        →  http://localhost:${port}/`);
    console.log(`     objects   →  http://localhost:${port}/objects        (read model)`);
    console.log(`     commands  →  http://localhost:${port}/commands       (write contract)`);
    console.log(`     events    →  http://localhost:${port}/events         (append-only log)`);
    console.log(`     feedback  →  ./feedback/\n`);
  },
}, async (req) => {
  const { pathname } = new URL(req.url);

  // 1. The page (wrapped with both seams + annotate).
  if (pathname === "/" || pathname === "/index.html") {
    try {
      return new Response(injectHost(await Deno.readTextFile(HTML)), { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch {
      return new Response("prototype html not found", { status: 500 });
    }
  }

  // 2. READ seam.
  if (pathname === "/objects") return json(Object.keys(state).sort());
  const rm = pathname.match(/^\/objects\/([a-z0-9_-]+)(?:\/([^/]+))?$/i);
  if (rm) {
    const [, type, id] = rm;
    const rows = state[type];
    if (!rows) return json({ error: `no object type "${type}"` }, 404);
    if (id === undefined) return json(rows);
    const one = rows.find((r) => String(r.id) === id);
    return one ? json(one) : json({ error: `no ${type} "${id}"` }, 404);
  }

  // 3. WRITE seam — the contract (GET) and applying an intent (POST).
  if (pathname === "/commands" && req.method === "GET") return json(commands);
  const cm = pathname.match(/^\/commands\/([a-z0-9_.-]+)$/i);
  if (cm && req.method === "POST") {
    let input: Record<string, unknown> = {};
    try { input = await req.json(); } catch { /* empty body ok */ }
    const result = await runCommand(cm[1], input);
    return json(result, "error" in result ? 400 : 200);
  }

  // 4. The append-only event log (introspection).
  if (pathname === "/events" && req.method === "GET") {
    try { return json(JSON.parse(await Deno.readTextFile(EVENTS_FILE))); } catch { return json([]); }
  }

  // 5. annotate feedback sink.
  if (pathname === "/_feedback" && req.method === "POST") {
    try {
      const note = await req.json();
      const file = `${FEEDBACK_DIR}/feedback.json`;
      let all: unknown[] = [];
      try { all = JSON.parse(await Deno.readTextFile(file)); } catch { /* first note */ }
      all.push(note);
      await Deno.writeTextFile(file, JSON.stringify(all, null, 2));
      return json({ ok: true, count: all.length });
    } catch {
      return json({ ok: false }, 400);
    }
  }

  return new Response("not found", { status: 404 });
});
