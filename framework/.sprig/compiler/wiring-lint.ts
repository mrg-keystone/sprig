// TEMPLATE WIRING — whole-app static analysis (template-wiring-spec.md §5 `sprig map`
// + §6 lint). Because the templates CONTAIN the dataflow (the three verbs are
// compile-time attributes with literal channel names), the CLI can resolve every
// channel without evaluating anything: this module walks the app's template graph,
// collects tethers exactly the way the runtime does (render.ts collectWiring), and
// keys channels EXACTLY the way wiring.ts does at hydration — (declaring template,
// channel name), with a forwarding `<router-outlet>` bridging a channel into the
// page templates the app's routing can mount under it.
//
// Accepted [DECIDE] defaults implemented here (in lockstep with wiring.ts):
//  • ANALYSIS SCOPE is the WHOLE-APP template graph: an outlet connects the template
//    that declares it to every page template that can mount under it, resolved from
//    the app's route tables (routers/root/routes.json → routers/<r>/routes.json,
//    legacy src/root.json) the same folder-first way the build discovers pages.
//    With no JSON route table (a defineRoutes([...]) app), every pages/<p>/ template
//    is treated as mountable — a superset, never a silent under-count.
//  • CHANNEL SCOPE is per-template: two same-named channels in unrelated templates
//    are DIFFERENT channels; only outlet forwarding bridges one into pages.
//  • PARTICIPANT COUNTING (§6 rules 3/4): the forwarding element itself NEVER counts
//    (it is a conduit, not an owner); each distinct page template in the routing
//    graph that declares the forwarded LOCAL name counts ONCE, regardless of how
//    many routes can mount it.
//  • Rule-1's forwarder exemption is the framework marker `router-outlet` — the one
//    forwarding element the runtime implements.
import { join, relative } from "@std/path";
import { walk } from "@std/fs/walk";
import { parseTemplate } from "./parse.ts";
import { field, named, type Node } from "./node.ts";
import { collectWiring, type TetherSpec } from "./render.ts";

// ─────────────────────────────── public shapes ──────────────────────────────
export interface WiringDiagnostic {
  level: "error" | "warning";
  /** which §6 rule fired (1 undeclared signal · 2 no origin · 3 lone participant · 4 many origins) */
  rule: 1 | 2 | 3 | 4;
  /** template path relative to the APP dir (e.g. "src/shell/template.html", "bootstrap/template.html") */
  file: string;
  /** 1-based template line of the offending tether (rules 2–4: the channel's first tether) */
  line: number;
  message: string;
}

/** One resolved channel — the unit `sprig map` prints one line for. */
export interface WiringChannelInfo {
  name: string;
  /** the DECLARING template (channel identity is per-template — spec §3 channel scope) */
  file: string;
  /** first tether's template line (orders the map output within a template) */
  line: number;
  /** participant names per verb, clause order: direct participants in template order,
   *  then outlet-forwarded pages in routing order; deduped (names, not instances) */
  setBy: string[];
  editedBy: string[];
  readBy: string[];
}

export interface WiringAnalysis {
  channels: WiringChannelInfo[];
  diagnostics: WiringDiagnostic[];
}

// ────────────────────────────── template walking ────────────────────────────
const lineOf = (source: string, idx: number): number => {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
};

/** tag + attribute nodes of an element node (mirrors render.ts tagInfo, read-only). */
function tagAttrs(node: Node): { tag: string; attrs: Node[] } | null {
  if (node.type === "self_closing_element") {
    return { tag: field(node, "name")!.text, attrs: named(node).filter((c: Node) => c.type !== "tag_name") };
  }
  if (node.type !== "element" && node.type !== "script_element" && node.type !== "style_element") return null;
  const start = named(node).find((c: Node) => c.type === "start_tag");
  if (!start) return null;
  return { tag: field(start, "name")!.text, attrs: named(start).filter((c: Node) => c.type !== "tag_name") };
}

/** Depth-first pre-order (document order) over every element in the template,
 *  including elements nested in control-flow blocks. */
function* elements(root: Node): Generator<Node> {
  const stack: Node[] = [...named(root)].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "element" || n.type === "self_closing_element") yield n;
    const kids = named(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

// ───────────────────────── component + signal discovery ─────────────────────
/** What the analysis knows about one component folder (a dir with a template.html). */
interface Comp {
  /** dir relative to src/ ("shell", "pages/org-detail", "shared-components/side-nav") */
  relDir: string;
  /** the tag it resolves by — the folder basename */
  selector: string;
  /** declared signal field names from logic.ts, or null when there is no logic.ts
   *  (a static component — it hydrates nothing, so it can tether nothing) */
  signals: Set<string> | null;
}

/** Signal FIELDS a logic.ts declares, syntactically: class fields / consts assigned
 *  from `signal(...)` (also computed/linkedSignal — a reads: target may be derived),
 *  plus `name: signal(...)` object-literal properties in a `{ setup }` component.
 *  Deliberately permissive: rule 1 must never false-positive on an unusual but real
 *  declaration, so anything that binds NAME to a signal-producing call counts. */
export function declaredSignals(logicSource: string): Set<string> {
  const src = logicSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out = new Set<string>();
  const decl = /(?:^|[\s,{(;])([A-Za-z_$][\w$]*)\s*(?::\s*[^=;,(){}]+)?=\s*(?:signal|computed|linkedSignal)\s*[<(]/g;
  const prop = /([A-Za-z_$][\w$]*)\s*:\s*(?:signal|computed|linkedSignal)\s*[<(]/g;
  for (const m of src.matchAll(decl)) out.add(m[1]);
  for (const m of src.matchAll(prop)) out.add(m[1]);
  return out;
}

/** A routed page root: pages/<page>/ (incl. pages/_preview/<id>/) but NOT a
 *  page-local component pages/<page>/components/<x>/ — same rule as the build. */
function isPageRoot(relDir: string): boolean {
  const parts = relDir.split("/");
  return parts[0] === "pages" && parts[parts.length - 2] !== "components";
}

async function readText(p: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(p);
  } catch {
    return null;
  }
}

// ─────────────────────────────── route resolution ───────────────────────────
interface RawRoute {
  path?: string;
  load?: string;
  children?: RawRoute[];
}

/** Resolve which component templates can mount DIRECTLY under each outlet region —
 *  keyed "" for the shell's outlet, "routers/<r>" for a layout router's own outlet.
 *  Mirrors the render chain: a routers/<r> WITH a template.html is itself the
 *  directly-mounted template (its children mount in ITS outlet, one level down); a
 *  router with no template of its own passes its children through to the region
 *  that mounted it. Inline `children` of a non-layout (page) route mount in the
 *  same region as their parent — only routers/* wrap. Returns null when the app
 *  declares no JSON route table (defineRoutes-in-TS apps). */
async function resolveMountRegions(srcDir: string, byRelDir: Map<string, Comp>): Promise<Map<string, Set<string>> | null> {
  let entry: RawRoute[] | null = null;
  if (await readText(join(srcDir, "routers", "root", "routes.json")) !== null) {
    entry = [{ path: "", load: "routers/root" }];
  } else {
    const legacy = await readText(join(srcDir, "root.json"));
    if (legacy !== null) {
      try {
        entry = JSON.parse(legacy) as RawRoute[];
      } catch {
        entry = null; // unparseable table → fall back to the all-pages superset
      }
    }
  }
  if (!entry) return null;

  const regions = new Map<string, Set<string>>();
  const seenRouters = new Set<string>(); // cycle guard — a routes.json naming an ancestor router
  const add = (region: string, relDir: string) => {
    let s = regions.get(region);
    if (!s) regions.set(region, (s = new Set()));
    s.add(relDir);
  };
  const expand = async (entries: RawRoute[], region: string): Promise<void> => {
    for (const e of entries) {
      const load = e.load?.replace(/^\.\//, "");
      if (load?.startsWith("routers/")) {
        if (seenRouters.has(load)) continue;
        seenRouters.add(load);
        // a layout WITH its own template mounts here and opens its own region;
        // one without a template is a pure table — its children mount here.
        const hasTpl = byRelDir.has(load);
        if (hasTpl) add(region, load);
        const childRegion = hasTpl ? load : region;
        const table = await readText(join(srcDir, load, "routes.json"));
        const sub: RawRoute[] = [];
        if (table !== null) {
          try {
            sub.push(...(JSON.parse(table) as RawRoute[]));
          } catch { /* unparseable sub-table → treat as empty */ }
        }
        if (e.children) sub.push(...e.children);
        await expand(sub, childRegion);
      } else {
        if (load && byRelDir.has(load)) add(region, load);
        if (e.children) await expand(e.children, region); // a page parent doesn't wrap — same outlet
      }
    }
  };
  await expand(entry, "");
  return regions;
}

// ────────────────────────────────── analysis ────────────────────────────────
interface Tether extends TetherSpec {
  tag: string;
  /** true for a forwarding <router-outlet> tether (never a participant itself) */
  forwards: boolean;
}
interface TemplateWiring {
  /** path relative to the app dir (what diagnostics print) */
  file: string;
  /** dir relative to src/ ("" for the bootstrap shell) */
  relDir: string;
  tethers: Tether[];
}

interface Channel {
  name: string;
  file: string;
  line: number;
  /** direct participants, template order (one entry per INSTANCE — counting unit) */
  direct: Array<{ tag: string; verb: TetherSpec["v"]; line: number }>;
  /** forwarding outlet tethers on this channel */
  forwards: Array<{ verb: TetherSpec["v"]; local: string; line: number }>;
  /** forwarded pages that matched, by verb (page selectors, DISTINCT — count once each) */
  pages: Array<{ selector: string; verb: TetherSpec["v"] }>;
}

/** Analyze the app's whole template graph: every channel (for `sprig map`) and
 *  every §6 lint finding. `appDir` is the sprig UI package dir (holding src/ and,
 *  optionally, bootstrap/template.html — the shell). Pure read-only. */
export async function analyzeWiring(appDir: string): Promise<WiringAnalysis> {
  const srcDir = join(appDir, "src");
  const diagnostics: WiringDiagnostic[] = [];

  // 1. discover every component folder (the same walk the build does).
  const comps: Comp[] = [];
  const byRelDir = new Map<string, Comp>();
  try {
    for await (const entry of walk(srcDir, { includeDirs: false, match: [/template\.html$/] })) {
      const relDir = relative(srcDir, entry.path).replace(/\\/g, "/").replace(/\/template\.html$/, "");
      if (/(?:^|\/)(?:node_modules|static|isolate|_isolate)(?:\/|$)/.test(relDir)) continue;
      const logic = await readText(join(srcDir, relDir, "logic.ts"));
      const comp: Comp = {
        relDir,
        selector: relDir.split("/").pop()!,
        signals: logic === null ? null : declaredSignals(logic),
      };
      comps.push(comp);
      byRelDir.set(relDir, comp);
    }
  } catch {
    return { channels: [], diagnostics }; // no src/ → nothing to analyze
  }
  comps.sort((a, b) => a.relDir < b.relDir ? -1 : a.relDir > b.relDir ? 1 : 0);

  // resolve a tag from a declaring template: a page-local component shadows a
  // same-named global WITHIN its page (same rule as the build registries).
  const resolveComp = (tag: string, fromRelDir: string): Comp | undefined => {
    const page = /^pages\/([^/]+)/.exec(fromRelDir)?.[1];
    if (page) {
      const local = byRelDir.get(`pages/${page}/components/${tag}`);
      if (local) return local;
    }
    return comps.find((c) => c.selector === tag && !/^pages\/[^/]+\/components\//.test(c.relDir)) ??
      comps.find((c) => c.selector === tag);
  };

  // 2. collect each template's tethers (templates sorted → deterministic output).
  const templates: TemplateWiring[] = [];
  const collectFrom = async (file: string, relDir: string, source: string): Promise<void> => {
    const tethers: Tether[] = [];
    let root: Node;
    try {
      root = await parseTemplate(source);
    } catch {
      return; // unparseable template → the build/dev reports it; nothing to lint here
    }
    for (const el of elements(root)) {
      const info = tagAttrs(el);
      if (!info) continue;
      try {
        for (const t of collectWiring(info.attrs, root.text)) {
          tethers.push({ ...t, tag: info.tag, forwards: info.tag === "router-outlet" });
        }
      } catch (e) {
        // malformed wiring (interpolated channel, bad longhand) — the render throws
        // this too; surface it as a rule-1-adjacent ERROR with the element's line.
        diagnostics.push({
          level: "error",
          rule: 1,
          file,
          line: lineOf(root.text, el.startIndex),
          message: (e as Error).message.replace(/^sprig:\s*/, ""),
        });
      }
    }
    if (tethers.length) templates.push({ file, relDir, tethers });
  };
  const bootstrapTpl = await readText(join(appDir, "bootstrap", "template.html"));
  if (bootstrapTpl !== null) await collectFrom("bootstrap/template.html", "", bootstrapTpl);
  for (const c of comps) {
    const src = await readText(join(srcDir, c.relDir, "template.html"));
    if (src !== null) await collectFrom(`src/${c.relDir}/template.html`, c.relDir, src);
  }

  // 3. resolve the routing graph → what mounts under each outlet.
  const regions = await resolveMountRegions(srcDir, byRelDir);
  const allPages = comps.filter((c) => isPageRoot(c.relDir)).map((c) => c.relDir);
  const mountsUnder = (declRelDir: string): string[] => {
    if (regions === null) return allPages; // no JSON table → every page can mount (superset)
    if (declRelDir.startsWith("routers/")) return [...(regions.get(declRelDir) ?? [])];
    return [...(regions.get("") ?? [])]; // the shell's outlet (or an outlet a shell-level component carries)
  };

  // 4. build channels — keyed (declaring template, channel name), like the runtime —
  //    and run rule 1 per tether as we go.
  const channels = new Map<string, Channel>();
  const channelOf = (tpl: TemplateWiring, t: Tether): Channel => {
    const key = tpl.file + " " + t.c;
    let ch = channels.get(key);
    if (!ch) {
      channels.set(key, (ch = { name: t.c, file: tpl.file, line: t.l ?? 1, direct: [], forwards: [], pages: [] }));
    }
    if (t.l && t.l < ch.line) ch.line = t.l;
    return ch;
  };
  for (const tpl of templates) {
    for (const t of tpl.tethers) {
      const ch = channelOf(tpl, t);
      if (t.forwards) {
        // rule-1 exemption: the forwarding element tethers nothing of its own.
        ch.forwards.push({ verb: t.v, local: t.f, line: t.l ?? 1 });
        continue;
      }
      ch.direct.push({ tag: t.tag, verb: t.v, line: t.l ?? 1 });
      // rule 1: the verb must name a signal the component declares.
      const comp = resolveComp(t.tag, tpl.relDir);
      const where = `<${t.tag} ${t.v}:${t.f}${t.c !== t.f ? `={${t.c}}` : ""}>`;
      if (!comp) {
        diagnostics.push({
          level: "error",
          rule: 1,
          file: tpl.file,
          line: t.l ?? 1,
          message: `${where} — "${t.tag}" is not a component in this app, so it declares no signal "${t.f}" ` +
            `(a wiring verb tethers a component's own signal; template-wiring-spec.md §6 rule 1)`,
        });
      } else if (comp.signals === null) {
        diagnostics.push({
          level: "error",
          rule: 1,
          file: tpl.file,
          line: t.l ?? 1,
          message: `${where} — component "${t.tag}" (src/${comp.relDir}/) is static (no logic.ts), so it has no ` +
            `signal "${t.f}" to tether (template-wiring-spec.md §6 rule 1)`,
        });
      } else if (!comp.signals.has(t.f)) {
        const known = [...comp.signals].sort();
        diagnostics.push({
          level: "error",
          rule: 1,
          file: tpl.file,
          line: t.l ?? 1,
          message: `${where} — component "${t.tag}" declares no signal "${t.f}"` +
            (known.length ? ` (its logic.ts declares: ${known.join(", ")})` : " (its logic.ts declares no signals)") +
            ` (template-wiring-spec.md §6 rule 1)`,
        });
      }
    }
  }

  // 5. bridge forwarded channels into the routing graph: each DISTINCT page template
  //    declaring the forwarded LOCAL name joins once (however many routes reach it).
  for (const tpl of templates) {
    if (!tpl.tethers.some((t) => t.forwards)) continue;
    const mounted = mountsUnder(tpl.relDir);
    for (const t of tpl.tethers) {
      if (!t.forwards) continue;
      const ch = channelOf(tpl, t);
      for (const pageRel of mounted) {
        const page = byRelDir.get(pageRel);
        if (!page?.signals?.has(t.f)) continue; // no matching signal → the page is untouched
        if (ch.pages.some((p) => p.selector === page.selector && p.verb === t.v)) continue;
        ch.pages.push({ selector: page.selector, verb: t.v });
      }
    }
  }

  // 6. channel rules 2/3/4. Counting unit: direct participants count per INSTANCE;
  //    forwarded pages count once each; the forwarding element itself never counts.
  for (const ch of channels.values()) {
    const setters = [
      ...ch.direct.filter((d) => d.verb === "sets").map((d) => d.tag),
      ...ch.pages.filter((p) => p.verb === "sets").map((p) => p.selector),
    ];
    const total = ch.direct.length + ch.pages.length;
    if (setters.length === 0 && total > 0) {
      diagnostics.push({
        level: "error",
        rule: 2,
        file: ch.file,
        line: ch.line,
        message: `channel "${ch.name}" has no sets: participant — the value has no origin ` +
          `(an editor/reader of a value nothing originates is a bug; template-wiring-spec.md §6 rule 2)`,
      });
    }
    if (total === 1) {
      const only = ch.direct[0]?.tag ?? ch.pages[0]?.selector;
      const unmatched = ch.forwards.length > 0 && ch.pages.length === 0
        ? ` (its <router-outlet ${ch.forwards[0].verb}:${ch.forwards[0].local}> matches no routed page)`
        : "";
      diagnostics.push({
        level: "warning",
        rule: 3,
        file: ch.file,
        line: ch.line,
        message: `channel "${ch.name}" has exactly one participant (${only})${unmatched} — dead wire or typo ` +
          `(template-wiring-spec.md §6 rule 3)`,
      });
    }
    if (setters.length > 1) {
      diagnostics.push({
        level: "warning",
        rule: 4,
        file: ch.file,
        line: ch.line,
        message: `channel "${ch.name}" has ${setters.length} sets: participants (${setters.join(", ")}) — ` +
          `two origins is usually a bug; only the first in template order seeds ` +
          `(template-wiring-spec.md §6 rule 4)`,
      });
    }
  }

  // 7. shape the channels for `sprig map`: one line per channel, stable order
  //    (template path, then first-tether line, then name); clause participants are
  //    NAMES (deduped) — direct in template order, then forwarded pages in routing
  //    order (the route-table order the regions were expanded in; alphabetical in
  //    the no-route-table fallback, where comps are pre-sorted).
  const infos: WiringChannelInfo[] = [...channels.values()]
    .sort((a, b) =>
      a.file < b.file ? -1 : a.file > b.file ? 1 : a.line !== b.line ? a.line - b.line : a.name < b.name ? -1 : 1
    )
    .map((ch) => {
      const clause = (verb: TetherSpec["v"]): string[] => {
        const names: string[] = [];
        for (const d of ch.direct) if (d.verb === verb && !names.includes(d.tag)) names.push(d.tag);
        const pages = ch.pages.filter((p) => p.verb === verb).map((p) => p.selector)
          .filter((s) => !names.includes(s));
        return [...names, ...pages];
      };
      return { name: ch.name, file: ch.file, line: ch.line, setBy: clause("sets"), editedBy: clause("edits"), readBy: clause("reads") };
    });

  // diagnostics in file/line order, errors before warnings on the same line.
  diagnostics.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line !== b.line ? a.line - b.line : a.level === b.level ? 0 : a.level === "error" ? -1 : 1
  );
  return { channels: infos, diagnostics };
}

/** Render the `sprig map` lines (spec §5, one line per channel, one clause per verb):
 *  `org: set by side-nav → edited by org-quick-rename → read by org-detail, app-detail` */
export function renderWiringMap(analysis: WiringAnalysis): string[] {
  return analysis.channels.map((ch) => {
    const clauses: string[] = [];
    if (ch.setBy.length) clauses.push(`set by ${ch.setBy.join(", ")}`);
    if (ch.editedBy.length) clauses.push(`edited by ${ch.editedBy.join(", ")}`);
    if (ch.readBy.length) clauses.push(`read by ${ch.readBy.join(", ")}`);
    // a forward-only channel no page matched: nothing participates (lint flags it too)
    return `${ch.name}: ${clauses.length ? clauses.join(" → ") : "(no participants)"}`;
  });
}
