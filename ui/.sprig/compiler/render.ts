// The SSR renderer: walks a parsed template AST → an HTML string, evaluating
// expressions/bindings against a scope, expanding control flow, and recursing
// into child components. Read-only; events/two-way are ignored at SSR (they wire
// up at hydration). Interpolation is HTML-escaped; author text and [innerHTML]
// are trusted.
import { field, named, type Node } from "./node.ts";
import { evalExpr, type Scope } from "./expr.ts";
import { scopeId } from "./scope.ts";

/** HTML-escape interpolated text (element content). */
function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An island's reactive setup (from logic.ts's defineComponent). */
export interface IslandDef {
  /** build the reactive scope from the island's @inputs */
  scope: (inputs: Scope) => Scope;
  /** is-land trigger, e.g. "load" | "visible" | "idle" | "interaction" */
  trigger: string;
}
export interface ComponentDef {
  selector: string;
  /** pre-parsed template root (server: parsed at boot; client: from JSON) */
  template: Node;
  /** present iff the folder has a logic.ts (→ an island) */
  island?: IslandDef;
  /** view-encapsulation scope id, derived from the component's UNIQUE folder PATH
   *  (not its bare basename) so two same-basename folders never share a marker.
   *  Falls back to a basename hash when a def is built without one. */
  scope?: string;
}
export interface Registry {
  get(selector: string): ComponentDef | undefined;
}
/** A collected (event) binding, for client-side delegation. */
export interface Handler {
  base: string; // dom event, e.g. "click"
  modifiers: string[]; // e.g. ["enter"]
  body: Node; // the handler statement AST
  scope: Scope; // the element's scope at render time
}
export interface RenderOpts {
  scope: Scope;
  registry: Registry;
  /** content for <router-outlet> (the matched child, pre-rendered) */
  outlet?: string;
  /** the current template's full source — used to re-emit the inter-node
   *  whitespace the grammar drops as `extras` (HTML collapses it to one space). */
  source: string;
  /** present in CLIENT mode: collect (event) bindings + emit data-sprig-* markers. */
  handlers?: Handler[];
  /** content projected into a component (the nodes between its tags), evaluated in
   *  the PARENT scope; <ng-content> renders it. */
  projected?: { nodes: Node[]; scope: Scope; source: string; namedSelects: string[]; scopeAttr?: string };
  /** view-encapsulation marker for the CURRENT component — every native element it
   *  emits carries this bare attribute, and the component's scoped CSS requires it. */
  scopeAttr?: string;
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

export function renderNodes(nodes: Node[], opts: RenderOpts): string {
  let out = "";
  let prevEnd = -1;
  for (const n of nodes) {
    // significant inter-node whitespace (collapsed to a single space, like HTML)
    if (prevEnd >= 0 && /\s/.test(opts.source.slice(prevEnd, n.startIndex))) out += " ";
    out += renderNode(n, opts);
    prevEnd = n.endIndex;
  }
  return out;
}

function renderNode(node: Node, opts: RenderOpts): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "interpolation":
      return escape(stringify(evalExpr(field(node, "expression"), opts.scope)));
    case "element":
    case "self_closing_element":
    case "script_element":
    case "style_element":
      return renderElement(node, opts);
    case "if_block":
      return renderIf(node, opts);
    case "for_block":
      return renderFor(node, opts);
    case "switch_block":
      return renderSwitch(node, opts);
    case "let_declaration":
      opts.scope[field(node, "name")!.text] = evalExpr(field(node, "value"), opts.scope);
      return "";
    case "defer_block":
      // SSR renders the deferred content (client @defer triggers come with hydration).
      return renderNodes(named(blockOf(node)!), opts);
    case "comment":
      return "";
    default:
      return "";
  }
}

// ───────────────────────────────── elements ─────────────────────────────────
interface TagInfo {
  tag: string;
  attrs: Node[];
  children: Node[];
  selfClosing: boolean;
}
function tagInfo(node: Node): TagInfo {
  if (node.type === "self_closing_element") {
    return { tag: field(node, "name")!.text, attrs: named(node).filter((c: Node) => c.type !== "tag_name"), children: [], selfClosing: true };
  }
  const start = named(node).find((c: Node) => c.type === "start_tag");
  const tag = field(start, "name")!.text;
  const attrs = named(start).filter((c: Node) => c.type !== "tag_name");
  const children = named(node).filter((c: Node) => c.type !== "start_tag" && c.type !== "end_tag");
  return { tag, attrs, children, selfClosing: false };
}

function renderElement(node: Node, opts: RenderOpts): string {
  const { tag, attrs, children, selfClosing } = tagInfo(node);

  // the outlet is a persistent boundary element (the soft-nav swap target)
  if (tag === "router-outlet") return `<sprig-outlet>${opts.outlet ?? ""}</sprig-outlet>`;

  // content projection: <ng-content> emits projected nodes; <ng-container> groups w/o a DOM element
  if (tag === "ng-content") return renderContent(attrs, opts);
  if (tag === "ng-container") return renderNodes(children, opts);

  const comp = opts.registry.get(tag);
  if (comp) return renderComponent(comp, attrs, children, opts);

  // native element — carries the current component's view-encapsulation marker
  const built = buildAttrs(attrs, opts);
  const sc = opts.scopeAttr ? ` ${opts.scopeAttr}` : "";
  const open = `<${tag}${sc}${built.attrs}>`;
  if (VOID.has(tag.toLowerCase()) || selfClosing) {
    return VOID.has(tag.toLowerCase()) ? open : `<${tag}${sc}${built.attrs} />`;
  }
  const inner = built.innerHTML !== undefined ? built.innerHTML : renderNodes(children, opts);
  return `${open}${inner}</${tag}>`;
}

function renderComponent(comp: ComponentDef, attrs: Node[], children: Node[], opts: RenderOpts): string {
  const childScope = comp.scope ?? scopeId(comp.selector); // this component's view-encapsulation marker
  // content the parent placed between the component's tags, projected via <ng-content>;
  // it keeps the PARENT's scope (it was authored there), like Angular emulated encapsulation.
  const projected = {
    nodes: children,
    scope: opts.scope,
    source: opts.source,
    namedSelects: collectSelects(comp.template),
    scopeAttr: opts.scopeAttr,
  };
  // compute the child's @inputs from the parent's bindings, evaluated in the parent scope
  const inputs: Scope = {};
  for (const attr of attrs) {
    if (attr.type === "property_binding") {
      const name = field(attr, "name")!.text;
      if (!name.includes(".") && !name.startsWith("@")) inputs[name] = evalExpr(field(attr, "value"), opts.scope);
    } else if (attr.type === "two_way_binding") {
      inputs[field(attr, "name")!.text] = evalExpr(field(attr, "value"), opts.scope);
    } else if (attr.type === "attribute") {
      const v = field(attr, "value");
      if (v) inputs[field(attr, "name")!.text] = quotedText(v, opts.scope);
    }
  }
  const tpl = comp.template;
  if (comp.island) {
    // an island: build the reactive scope from setup(), render its initial state.
    const scope = comp.island.scope(inputs);
    const inner = renderNodes(named(tpl), {
      scope, registry: opts.registry, outlet: opts.outlet, source: tpl.text, handlers: opts.handlers, projected, scopeAttr: childScope,
    });
    // CLIENT mode (handlers present) renders the island body for re-paint; SERVER
    // mode wraps it as a hydration boundary with a JSON prop bridge.
    if (opts.handlers) return inner;
    const props = JSON.stringify(inputs).replace(/</g, "\\u003c");
    // selectors/triggers are trusted compile-time idents, but escape for consistency
    // with every other attribute (defense-in-depth on the loader's import() URL). The
    // wrapper carries the island's own marker so its :host styles target it.
    return `<sprig-island ${childScope} data-sel="${escapeAttr(comp.selector)}" data-trigger="${escapeAttr(comp.island.trigger)}">` +
      `<script type="application/json" class="sprig-props">${props}</script>${inner}</sprig-island>`;
  }
  return renderNodes(named(tpl), { scope: inputs, registry: opts.registry, outlet: opts.outlet, source: tpl.text, projected, scopeAttr: childScope });
}

// render <ng-content> by emitting the projected nodes (in the parent's scope)
function renderContent(attrs: Node[], opts: RenderOpts): string {
  const p = opts.projected;
  if (!p) return "";
  const sel = attrValue(attrs, "select");
  const picked = sel
    ? p.nodes.filter((n) => matchesSelect(n, sel))
    : p.nodes.filter((n) => !p.namedSelects.some((s) => matchesSelect(n, s))); // default slot = unmatched
  // projected nodes belong to the PARENT component → its scope marker, not the child's
  return renderNodes(picked, { ...opts, scope: p.scope, source: p.source, scopeAttr: p.scopeAttr, projected: undefined });
}

function collectSelects(node: Node, acc: string[] = []): string[] {
  if (node.type === "element" || node.type === "self_closing_element") {
    const ti = tagInfo(node);
    if (ti.tag === "ng-content") {
      const s = attrValue(ti.attrs, "select");
      if (s) acc.push(s);
    }
  }
  for (const c of named(node)) collectSelects(c, acc);
  return acc;
}

function matchesSelect(node: Node, sel: string): boolean {
  if (node.type !== "element" && node.type !== "self_closing_element") return false;
  const ti = tagInfo(node);
  if (sel.startsWith("[") && sel.endsWith("]")) {
    const name = sel.slice(1, -1);
    return ti.attrs.some((a) => a.type === "attribute" && field(a, "name")!.text === name);
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    const c = ti.attrs.find((a) => a.type === "attribute" && field(a, "name")!.text === "class");
    return c ? quotedText(field(c, "value")!, {}).split(/\s+/).includes(cls) : false;
  }
  return ti.tag === sel; // tag selector
}

function attrValue(attrs: Node[], name: string): string | null {
  const a = attrs.find((x) => x.type === "attribute" && field(x, "name")!.text === name);
  const v = a ? field(a, "value") : null;
  return v ? quotedText(v, {}) : null;
}

// ─────────────────────────────── attributes ─────────────────────────────────
interface BuiltAttrs {
  attrs: string;
  innerHTML?: string;
}
function buildAttrs(attrNodes: Node[], opts: RenderOpts): BuiltAttrs {
  const scope = opts.scope;
  const plain: Record<string, string> = {};
  const classes: string[] = [];
  const styles: Record<string, string> = {};
  let innerHTML: string | undefined;

  for (const attr of attrNodes) {
    if (attr.type === "attribute") {
      const name = field(attr, "name")!.text;
      if (name === "i18n" || name.startsWith("i18n-") || name === "ngProjectAs") continue;
      const v = field(attr, "value");
      const text = v ? quotedText(v, scope) : "";
      if (name === "class") classes.push(text);
      else plain[name] = text;
    } else if (attr.type === "property_binding") {
      const name = field(attr, "name")!.text;
      const value = evalExpr(field(attr, "value"), scope);
      applyBinding(name, value, { plain, classes, styles, setInner: (h) => (innerHTML = h) });
    } else if (attr.type === "event_binding" && opts.handlers) {
      // CLIENT mode: collect the handler and tag the element for delegation
      const name = field(attr, "name")!.text; // "click" | "keyup.enter" | "@anim.done"
      if (!name.startsWith("@")) {
        const [base, ...modifiers] = name.split(".");
        // Multiple same-base bindings (keyup.enter + keyup.escape, click + click.ctrl)
        // must ALL be reachable: append this handler's index to a space-separated list
        // rather than overwriting the marker, so dispatch can pick the matching one.
        const key = `data-sprig-${base}`;
        const prev = plain[key];
        plain[key] = prev ? `${prev} ${opts.handlers.length}` : String(opts.handlers.length);
        opts.handlers.push({ base, modifiers, body: field(attr, "handler")!, scope });
      }
    }
    // two_way_binding / reference / structural_directive / template_input → no-op here
  }

  if (classes.filter(Boolean).length) plain["class"] = [plain["class"], ...classes].filter(Boolean).join(" ");
  const styleStr = Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";");
  if (styleStr) plain["style"] = [plain["style"], styleStr].filter(Boolean).join(";");

  const attrs = Object.entries(plain)
    .map(([k, v]) => (v === "" && BOOLEAN.has(k) ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join("");
  return { attrs, innerHTML };
}

const BOOLEAN = new Set(["disabled", "checked", "selected", "readonly", "required", "hidden", "multiple", "open"]);

function applyBinding(
  name: string,
  value: unknown,
  sink: { plain: Record<string, string>; classes: string[]; styles: Record<string, string>; setInner: (h: string) => void },
): void {
  if (name === "innerHTML") {
    sink.setInner(stringify(value));
    return;
  }
  if (name.startsWith("@")) return; // animation
  if (name.startsWith("attr.")) {
    const a = name.slice(5);
    if (value != null) sink.plain[a] = stringify(value);
    return;
  }
  if (name.startsWith("class.")) {
    if (value) sink.classes.push(name.slice(6));
    return;
  }
  if (name === "class" || name === "ngClass") {
    sink.classes.push(...classList(value));
    return;
  }
  if (name.startsWith("style.")) {
    const rest = name.slice(6); // "color" or "width.px"
    const dot = rest.indexOf(".");
    const prop = dot === -1 ? rest : rest.slice(0, dot);
    const unit = dot === -1 ? "" : rest.slice(dot + 1);
    if (value != null) sink.styles[prop] = `${stringify(value)}${unit}`;
    return;
  }
  if (name === "style" || name === "ngStyle") {
    for (const [k, v] of Object.entries((value as Record<string, unknown>) ?? {})) sink.styles[k] = stringify(v);
    return;
  }
  // plain DOM property → attribute
  if (BOOLEAN.has(name)) {
    if (value) sink.plain[name] = "";
  } else if (value != null && value !== false) {
    sink.plain[name] = stringify(value);
  }
}

function classList(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(classList);
  if (value && typeof value === "object") {
    return Object.entries(value).filter(([, on]) => on).map(([k]) => k);
  }
  return [];
}

/** A plain/double-quoted attribute value that may contain interpolation. */
function quotedText(quotedValue: Node, scope: Scope): string {
  let out = "";
  for (const c of named(quotedValue)) {
    if (c.type === "interpolation") out += stringify(evalExpr(field(c, "expression"), scope));
    else out += c.text; // attribute_text
  }
  return out;
}

// ───────────────────────────── control flow ─────────────────────────────────
function blockOf(node: Node): Node | null {
  return named(node).find((c: Node) => c.type === "block") ?? null;
}

function renderIf(node: Node, opts: RenderOpts): string {
  const cond = evalExpr(field(node, "condition"), opts.scope);
  // Each @if view is its own block: clone the scope so view-local bindings (@let)
  // and any alias stay scoped to the branch and never leak into the parent.
  if (cond) {
    const alias = field(node, "alias");
    const scope = alias ? { ...opts.scope, [alias.text]: cond } : { ...opts.scope };
    return renderNodes(named(field(node, "consequence")!), { ...opts, scope });
  }
  for (const alt of named(node)) {
    if (alt.type === "else_if_clause") {
      const c = evalExpr(field(alt, "condition"), opts.scope);
      if (c) {
        const alias = field(alt, "alias");
        const scope = alias ? { ...opts.scope, [alias.text]: c } : { ...opts.scope };
        return renderNodes(named(blockOf(alt)!), { ...opts, scope });
      }
    } else if (alt.type === "else_clause") {
      return renderNodes(named(blockOf(alt)!), { ...opts, scope: { ...opts.scope } });
    }
  }
  return "";
}

function renderFor(node: Node, opts: RenderOpts): string {
  const binding = field(node, "binding")!;
  const item = field(binding, "item")!.text;
  const collection = evalExpr(field(binding, "collection"), opts.scope) as unknown[] | null;
  const aliases: Array<{ name: string; src: string }> = [];
  for (const g of named(binding)) {
    if (g.type === "for_alias_group") {
      for (const a of named(g)) aliases.push({ name: field(a, "name")!.text, src: field(a, "value")!.text });
    }
  }
  const arr = Array.isArray(collection) ? collection : [];
  if (arr.length === 0) {
    const empty = named(node).find((c: Node) => c.type === "empty_clause");
    return empty ? renderNodes(named(blockOf(empty)!), opts) : "";
  }
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    const locals: Record<string, unknown> = {
      $index: i, $count: arr.length, $first: i === 0, $last: i === arr.length - 1, $even: i % 2 === 0, $odd: i % 2 === 1,
    };
    const scope: Scope = { ...opts.scope, [item]: arr[i], ...locals };
    for (const a of aliases) scope[a.name] = locals[a.src];
    out += renderNodes(named(field(node, "consequence") ?? blockOf(node)!), { ...opts, scope });
  }
  return out;
}

function renderSwitch(node: Node, opts: RenderOpts): string {
  const value = evalExpr(field(node, "value"), opts.scope);
  let dflt: Node | null = null;
  for (const c of named(node)) {
    if (c.type === "case_clause") {
      if (evalExpr(field(c, "value"), opts.scope) === value) return renderNodes(named(blockOf(c)!), opts);
    } else if (c.type === "default_clause") {
      dflt = c;
    }
  }
  return dflt ? renderNodes(named(blockOf(dflt)!), opts) : "";
}

// ───────────────────────────────── helpers ──────────────────────────────────
function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
