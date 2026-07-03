// The SSR renderer: walks a parsed template AST → an HTML string, evaluating
// expressions/bindings against a scope, expanding control flow, and recursing
// into child components. Read-only; events/two-way are ignored at SSR (they wire
// up at hydration). Interpolation is HTML-escaped; author text and [innerHTML]
// are trusted.
import { field, named, type Node } from "./node.ts";
import { evalExpr, type Scope } from "./expr.ts";
import { scopeId } from "./scope.ts";
import { snapshotOf } from "./lifecycle.ts";

/** HTML-escape interpolated text (element content). */
function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap rendered content as a hydration boundary (the SSR island host): a <sprig-island>
 *  carrying the selector, trigger, and a JSON prop/snapshot bridge. Used for child islands
 *  AND for a page whose own logic.ts makes it the route's root island. */
export function islandHost(
  scopeAttr: string,
  selector: string,
  trigger: string,
  propsObj: Record<string, unknown>,
  inner: string,
): string {
  const props = JSON.stringify(propsObj).replace(/</g, "\\u003c");
  return `<sprig-island ${scopeAttr} data-sel="${escapeAttr(selector)}" data-trigger="${escapeAttr(trigger)}">` +
    `<script type="application/json" class="sprig-props">${props}</script>${inner}</sprig-island>`;
}

/** An island's reactive setup (from logic.ts's defineComponent). */
export interface IslandDef {
  /** build the reactive scope from the island's @inputs */
  scope: (inputs: Scope) => Scope;
  /** is-land trigger, e.g. "load" | "visible" | "idle" | "interaction" */
  trigger: string;
  /** class-based component: snapshot the instance's serializable state into the props
   *  bridge so the browser instance is re-seeded before onBrowserInit (see lifecycle.ts). */
  snapshot?: boolean;
  /** async resolution — instantiate + AWAIT onServerInit (class components). The server
   *  pre-pass (resolveIslands) calls this in parallel; the sync render reads the result.
   *  Absent for { setup } islands (resolved synchronously by `scope`). */
  resolve?: (inputs: Scope) => Promise<Scope>;
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
  /** the `load` of the component rendered INSIDE this outlet — stamped as data-level on the
   *  emitted <sprig-outlet> so the client soft-nav can diff nesting levels and swap the
   *  deepest one that changed (nested layouts). */
  outletKey?: string;
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
  /** preview overrides for child components, keyed by selector: force props onto every
   *  instance, or replace it with a placeholder ("stub"). Threaded SSR → client. */
  mocks?: Record<string, MockSpec>;
  /** server pre-pass results: an island INSTANCE key → its already-(onServerInit-)resolved
   *  scope, so the sync render uses it instead of re-resolving. Populated by resolveIslands.
   *  Keyed by INSTANCE PATH (not the bare AST node) so a component rendered multiple times —
   *  which shares ONE template AST — gives each instance its own scope (bug AB). */
  resolved?: Map<string, Scope>;
  /** the path prefix identifying the CURRENT template instance (extended only at a
   *  component call-site). Absent/"" at the page root. Combined with a node's startIndex
   *  via `rkey` to form the per-instance key in `resolved`. */
  resolvedPath?: string;
}

/** Per-instance key for `resolved`: the current instance path + the call-site node's
 *  startIndex. Two call-sites of the same component have distinct startIndex → distinct
 *  paths → the shared inner island node resolves under each instance separately. */
const rkey = (path: string | undefined, n: Node): string => (path ?? "") + "/" + n.startIndex;

/** A child-component override: "stub" (or { stub:true }) renders a placeholder;
 *  { props } forces those props onto every instance of that selector. */
export type MockSpec = "stub" | { stub?: boolean; props?: Record<string, unknown> };

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

// Native HTML element names — these ALWAYS render as native elements and are never
// resolved to a registered component, so a component must not be named like one
// (e.g. name it `ui-button`, not `button`). This is the web-component rule: it lets a
// component safely use native <button>/<input>/… in its own template.
const NATIVE = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo", "blockquote",
  "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup", "data", "datalist", "dd",
  "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i",
  "iframe", "img", "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
  "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p", "param", "picture",
  "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "section", "select", "slot", "small",
  "source", "span", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea",
  "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  "svg", "path", "circle", "rect", "line", "g", "polyline", "polygon", "text", "defs", "use",
]);

// Content-projection slot. Sprig accepts `<content>` (preferred — may self-close as `<content/>`)
// and the Angular-flavoured `<ng-content>` as aliases. A `select` attr scopes which projected
// nodes land here; the slot's own children are the fallback shown when nothing is projected.
function isContentTag(tag: string): boolean {
  return tag === "content" || tag === "ng-content";
}

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
      // Clone the scope so view-local @let bindings never leak into the parent.
      return renderNodes(named(blockOf(node)!), { ...opts, scope: cloneScope(opts.scope) });
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

  // the outlet is a persistent boundary element (the soft-nav swap target). data-level names
  // the load rendered inside it so the client can diff nesting and swap the deepest changed one.
  if (tag === "router-outlet") {
    const key = opts.outletKey ? ` data-level="${opts.outletKey.replace(/"/g, "&quot;")}"` : "";
    return `<sprig-outlet${key}>${opts.outlet ?? ""}</sprig-outlet>`;
  }

  // content projection: <content>/<ng-content> emits projected nodes (or its own children as a
  // fallback when nothing is projected); <ng-container> groups w/o a DOM element
  if (isContentTag(tag)) return renderContent(attrs, children, opts);
  if (tag === "ng-container") return renderNodes(children, opts);

  // a custom (non-native) tag may resolve to a registered component
  const comp = NATIVE.has(tag) ? undefined : opts.registry.get(tag);
  if (comp) return renderComponent(comp, attrs, children, opts, node);

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

/** Compute a child component's @inputs from its tag's bindings, in the parent scope. */
function computeInputs(attrs: Node[], scope: Scope): Scope {
  const inputs: Scope = {};
  for (const attr of attrs) {
    if (attr.type === "property_binding") {
      const name = field(attr, "name")!.text;
      if (!name.includes(".") && !name.startsWith("@")) inputs[name] = evalExpr(field(attr, "value"), scope);
    } else if (attr.type === "two_way_binding") {
      inputs[field(attr, "name")!.text] = evalExpr(field(attr, "value"), scope);
    } else if (attr.type === "attribute") {
      const v = field(attr, "value");
      if (v) inputs[field(attr, "name")!.text] = inputText(v, scope);
    }
  }
  return inputs;
}

function renderComponent(comp: ComponentDef, attrs: Node[], children: Node[], opts: RenderOpts, node?: Node): string {
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
  const inputs: Scope = computeInputs(attrs, opts.scope);
  // preview overrides (mocks): "stub" → a labelled placeholder; { props } → force
  // those props onto this instance (e.g. force a child button disabled).
  const mock = opts.mocks?.[comp.selector];
  if (mock === "stub" || (typeof mock === "object" && mock.stub)) {
    const sc = opts.scopeAttr ? ` ${opts.scopeAttr}` : "";
    return `<span${sc} class="iso-stub" data-stub="${escapeAttr(comp.selector)}">${escapeAttr(comp.selector)}</span>`;
  }
  if (typeof mock === "object" && mock.props) Object.assign(inputs, mock.props);

  const tpl = comp.template;
  if (comp.island) {
    // CLIENT mode (handlers present): this is a CHILD island encountered while the PARENT
    // island re-renders. The child island OWNS + MANAGES its own subtree (its own effect,
    // listeners, hydrated state), so the parent must NOT re-render the child's body — it must
    // emit a <sprig-island data-sel> SHELL that morph matches to the live hydrated child host
    // (left untouched by morphChildren's island-preservation), and that bootstrapIslands can
    // lazy-load if the child hasn't loaded yet. Rendering the child's body here would (a) leak
    // a fresh re-render the child neither owns nor disposes, and (b) emit a bare element/inline
    // body that morph would mismatch against the live <sprig-island> host and destroy it (bug AJ).
    if (opts.handlers) {
      return islandHost(childScope, comp.selector, comp.island.trigger, {}, "");
    }
    // an island: use the scope the async pre-pass already resolved for this node (its
    // onServerInit has run + awaited); else build it synchronously now.
    const scope = (node && opts.resolved?.get(rkey(opts.resolvedPath, node))) ?? comp.island.scope(inputs);
    // Snapshot the post-onServerInit state NOW, BEFORE rendering the body. The body's
    // @let declarations mutate the scope object, and those template-locals must not leak
    // into the snapshot (they'd be restored as bogus instance fields on the client).
    const snap = comp.island.snapshot
      ? snapshotOf(scope as Record<string, unknown>)
      : undefined;
    const inner = renderNodes(named(tpl), {
      scope, registry: opts.registry, outlet: opts.outlet, outletKey: opts.outletKey, source: tpl.text, handlers: opts.handlers, projected, scopeAttr: childScope, mocks: opts.mocks, resolved: opts.resolved,
      // nested islands resolve under THIS instance (extend the path at this call-site)
      resolvedPath: node ? rkey(opts.resolvedPath, node) : opts.resolvedPath,
    });
    // SERVER mode wraps the rendered body as a hydration boundary with a JSON prop bridge.
    // carry mocks into the client via the props bridge so the island's own re-render
    // applies them to its children too (the SSR-only force-props would otherwise be lost),
    // plus the pre-render snapshot so a class instance re-seeds before onBrowserInit.
    const propsObj: Record<string, unknown> = { ...inputs };
    if (opts.mocks) propsObj.__mocks = opts.mocks;
    if (snap) propsObj.__snapshot = snap;
    return islandHost(childScope, comp.selector, comp.island.trigger, propsObj, inner);
  }
  // static child: render its template; in CLIENT mode, wire (event) bindings on the
  // component tag onto the child's root element so they delegate to the host island.
  // CACHE: a leaf static component (SSR, no projected children, no mocks) is a pure
  // function of its inputs → memoize the HTML across renders and requests — but ONLY if
  // its rendered subtree is itself pure. A subtree is IMPURE if it (transitively) renders
  // a <router-outlet> (its content varies per request via opts.outlet) or an ISLAND (its
  // scope()/onServerInit output varies per request); caching either would replay one
  // request's value to later requests (stale outlet / cross-request data leak).
  const cacheable = !opts.handlers && children.length === 0 && !opts.mocks &&
    !hasImpureDescendant(comp, opts.registry);
  let key = "";
  if (cacheable) {
    // Build a SOUND cache key. JSON.stringify is unsound for two reasons we guard here:
    //  • it maps NaN/Infinity/-Infinity AND null all to the literal `null`, so distinct
    //    non-finite (or null) inputs would COLLIDE on one key (bug Z) — fix with a replacer
    //    that maps a non-finite number to a DISTINCT sentinel (null still serializes as JSON
    //    null, now distinct from each sentinel);
    //  • it SILENTLY OMITS function/undefined values (no throw), so distinct closures (or
    //    undefined) would produce identical keys without the catch ever firing (bug AD) —
    //    those cannot be keyed reliably, so REFUSE to cache (leave key="").
    const unkeyable = Object.values(inputs).some(
      (v) => typeof v === "function" || typeof v === "undefined",
    );
    if (!unkeyable) {
      try {
        const ser = JSON.stringify(
          inputs,
          (_k, v) => (typeof v === "number" && !Number.isFinite(v)) ? ("\u0000nf:" + String(v)) : v,
        );
        key = `${defToken(comp)} ${comp.selector} ${childScope} ${ser}`;
        const hit = staticCache.get(key);
        if (hit !== undefined) {
          staticCacheHits++;
          return hit;
        }
      } catch {
        key = ""; // non-serializable inputs → don't cache
      }
    }
  }
  // forward `resolved` so an island nested inside this static component still finds the
  // scope the async pre-pass (resolveIslands) recorded for it — else it falls back to its
  // stale synchronous scope() value (bug H).
  const html = renderNodes(named(tpl), { scope: inputs, registry: opts.registry, outlet: opts.outlet, outletKey: opts.outletKey, source: tpl.text, projected, scopeAttr: childScope, mocks: opts.mocks, resolved: opts.resolved, resolvedPath: node ? rkey(opts.resolvedPath, node) : opts.resolvedPath });
  const out = injectRootAttrs(html, eventAttrs(attrs, opts));
  if (key) {
    if (staticCache.size >= STATIC_CACHE_MAX) staticCache.clear(); // crude bound
    staticCache.set(key, out);
  }
  return out;
}

// memoized SSR output for pure leaf static components (selector + inputs → html)
const STATIC_CACHE_MAX = 10_000;
const staticCache = new Map<string, string>();
let staticCacheHits = 0;
// Per-ComponentDef cache namespace. The cache is a MODULE-GLOBAL Map shared by every
// createRenderer in the process, but its old key (selector + scope id + inputs) carried
// no renderer identity — so two renderers whose fixtures place a same-name component at
// the SAME relDir (→ same scope id) but with DIFFERENT template content collided on one
// key and the second got the first's HTML (a cross-renderer leak). Two distinct renderers
// build DISTINCT ComponentDef objects even for the same relDir, so namespacing the key by
// def identity isolates them while still letting ONE renderer reuse its own memoized leaf.
const defTokens = new WeakMap<ComponentDef, string>();
let defSeq = 0;
function defToken(comp: ComponentDef): string {
  let t = defTokens.get(comp);
  if (t === undefined) defTokens.set(comp, (t = "d" + (defSeq++)));
  return t;
}
/** Clear the static-component HTML cache — call when a template changes (dev HMR). */
export function clearStaticCache(): void {
  staticCache.clear();
  staticCacheHits = 0;
}
/** Cache stats (tests/diagnostics). */
export function staticCacheStats(): { size: number; hits: number } {
  return { size: staticCache.size, hits: staticCacheHits };
}
// A component subtree is IMPURE (and so must never be cached) if it, OR any nested
// registered component it renders, transitively contains a <router-outlet> (whose content
// is the per-request opts.outlet) or IS / CONTAINS an island (whose scope()/onServerInit
// output varies per request). The check resolves child tags through the registry and walks
// recursively; a positive result is memoized per ComponentDef. (A negative computed mid
// cycle-guard could be incomplete, so only `true` is memoized.)
const impureCache = new WeakMap<ComponentDef, boolean>();
function hasImpureDescendant(comp: ComponentDef, registry: Registry, seen = new Set<ComponentDef>()): boolean {
  const memo = impureCache.get(comp);
  if (memo !== undefined) return memo;
  if (seen.has(comp)) return false; // cycle guard
  seen.add(comp);
  let impure = (comp.template.text ?? "").includes("router-outlet");
  if (!impure) {
    const visit = (n: Node) => {
      if (impure) return;
      if (n.type === "element" || n.type === "self_closing_element") {
        const tag = tagInfo(n).tag;
        // A non-native tag that is not a structural builtin resolves to (or could resolve
        // to) a registered COMPONENT. Such a composite's rendered subtree depends on WHICH
        // registry resolves that tag (bug AA: a shared wrapper nesting <card> that page A
        // and page B shadow with different pure components renders differently per page yet
        // caches under one key). So a component referencing ANY such child tag is NOT a pure
        // function of its inputs → mark it impure (non-cacheable). This keeps caching for
        // TRUE leaves (only native elements + interpolation/bindings).
        if (!NATIVE.has(tag) && tag !== "router-outlet" && !isContentTag(tag) && tag !== "ng-container") {
          impure = true;
          return;
        }
      }
      for (const c of named(n)) visit(c);
    };
    visit(comp.template);
  }
  // only memoize a definite true; see note above.
  if (impure) impureCache.set(comp, true);
  return impure;
}

/** SERVER async pre-pass: await each class-island's onServerInit BEFORE the sync render,
 *  in PARALLEL across independent subtrees (siblings concurrent; a child only after its
 *  parent island resolves, since its inputs may depend on it). Populates `resolved`
 *  (node → scope) for the sync render. Walks element/component structure; islands behind
 *  control-flow blocks or inside { setup } islands fall back to sync onServerInit. */
export async function resolveIslands(nodes: Node[], opts: RenderOpts, resolved: Map<string, Scope>): Promise<void> {
  // Clone the scope once so the @let evolution below (and any caller-shared scope object)
  // is never mutated. The synchronous scope-evolution within the loop must mirror the sync
  // render so a following island's computeInputs sees an earlier @let (bug AG).
  // Clone PRESERVING the prototype (bug AK): when the scope is a CLASS instance (a resolved
  // class island), its methods live on the prototype; a plain object-spread drops them, so
  // computeInputs evaluating a method call (e.g. a nested island's [msg]="format()") would
  // see undefined and the nested island's SSR body + snapshot would diverge from the sync
  // render. Copying own-property DESCRIPTORS onto a clone of the same prototype keeps @let
  // isolation (a @let write adds/overrides an OWN data prop on this front clone, not the
  // shared instance) AND lets scope.method() / (name in scope) resolve through the prototype.
  opts = { ...opts, scope: Object.create(Object.getPrototypeOf(opts.scope), Object.getOwnPropertyDescriptors(opts.scope)) };
  const tasks: Promise<void>[] = [];
  for (const node of nodes) {
    // @let binds in DOCUMENT ORDER (like renderNode's let_declaration case) so a following
    // sibling island's inputs see it; do this BEFORE the element-skip below.
    if (node.type === "let_declaration") {
      opts.scope[field(node, "name")!.text] = evalExpr(field(node, "value"), opts.scope);
      continue;
    }
    if (node.type !== "element" && node.type !== "self_closing_element") continue;
    const { tag, attrs, children } = tagInfo(node);
    if (tag === "router-outlet") continue;
    if (isContentTag(tag) || tag === "ng-container") {
      if (children.length) tasks.push(resolveIslands(children, opts, resolved));
      continue;
    }
    const comp = NATIVE.has(tag) ? undefined : opts.registry.get(tag);
    // a mocked island is left to the sync render path so its forced props/stub apply to
    // the SAME scope the snapshot is taken from (pre-resolving would resolve unmocked
    // inputs, desyncing the snapshot from the rendered output).
    if (comp?.island?.resolve && !opts.mocks?.[tag]) {
      const inputs = computeInputs(attrs, opts.scope);
      // resolve THIS island, then recurse its body with the resolved scope (parent→child
      // ordered); the whole task runs concurrently with its siblings via Promise.all.
      const childPath = rkey(opts.resolvedPath, node); // this island instance's path
      tasks.push((async () => {
        const scope = await comp.island!.resolve!(inputs);
        resolved.set(childPath, scope);
        await resolveIslands(named(comp.template), { ...opts, scope, source: comp.template.text, resolvedPath: childPath }, resolved);
      })());
    } else if (comp?.island) {
      /* { setup } island: resolved synchronously by render; don't re-run setup here */
    } else if (comp) {
      // static component: recurse into its body with its computed inputs, extending the
      // instance path at THIS call-site so nested islands resolve under this instance.
      tasks.push(resolveIslands(named(comp.template), { ...opts, scope: computeInputs(attrs, opts.scope), source: comp.template.text, resolvedPath: rkey(opts.resolvedPath, node) }, resolved));
    } else if (children.length) {
      tasks.push(resolveIslands(children, opts, resolved)); // native element → recurse children
    }
    // an island PROJECTED (slotted) into a component wrapper is rendered by <ng-content>
    // in the PARENT scope but at the WRAPPER BODY path (rkey(P, N)) — renderContent spreads
    // the wrapper-body opts. So pre-resolve the call-site projected children under that SAME
    // path while keeping the PARENT scope, else a projected class island never gets its
    // resolve() awaited and the sync render falls back to its stale scope() (bug AF).
    if (comp && children.length) {
      tasks.push(resolveIslands(children, { ...opts, resolvedPath: rkey(opts.resolvedPath, node) }, resolved));
    }
  }
  await Promise.all(tasks);
}

/** CLIENT mode: collect (event) bindings on a component tag into the host's handler
 *  table and return the data-sprig-* markers to stamp on the child's root element. */
function eventAttrs(attrs: Node[], opts: RenderOpts): string {
  if (!opts.handlers) return "";
  const marks: Record<string, string> = {};
  for (const attr of attrs) {
    if (attr.type !== "event_binding") continue;
    const name = field(attr, "name")!.text;
    if (name.startsWith("@")) continue;
    const [base, ...modifiers] = name.split(".");
    const key = `data-sprig-${base}`;
    marks[key] = marks[key] ? `${marks[key]} ${opts.handlers.length}` : String(opts.handlers.length);
    opts.handlers.push({ base, modifiers, body: field(attr, "handler")!, scope: opts.scope });
  }
  return Object.entries(marks).map(([k, v]) => ` ${k}="${v}"`).join("");
}

/** Inject extra attributes into the first opening tag of a rendered HTML fragment. */
function injectRootAttrs(html: string, extra: string): string {
  return extra ? html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1${extra}`) : html;
}

// Render <content>/<ng-content>: emit the projected nodes (in the PARENT's scope). When
// nothing is projected into this slot, fall back to the slot's OWN children — the component's
// default content, in the COMPONENT's scope (so `<content>default</content>` shows "default").
function renderContent(attrs: Node[], children: Node[], opts: RenderOpts): string {
  const fallback = () => renderNodes(children, { ...opts, projected: undefined });
  const p = opts.projected;
  if (!p) return fallback();
  const sel = attrValue(attrs, "select");
  const picked = sel
    ? p.nodes.filter((n) => matchesSelect(n, sel))
    : p.nodes.filter((n) => !p.namedSelects.some((s) => matchesSelect(n, s))); // default slot = unmatched
  if (!picked.length) return fallback();
  // projected nodes belong to the PARENT component → its scope marker, not the child's
  return renderNodes(picked, { ...opts, scope: p.scope, source: p.source, scopeAttr: p.scopeAttr, projected: undefined });
}

function collectSelects(node: Node, acc: string[] = []): string[] {
  if (node.type === "element" || node.type === "self_closing_element") {
    const ti = tagInfo(node);
    if (isContentTag(ti.tag)) {
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
  // plain keys whose value came from quotedText (literal author text raw + interpolations
  // already escaped) — these are FINAL and must NOT be escaped again at emit, else author
  // entities like "&amp;" become "&amp;amp;". property_binding / applyBinding values are
  // raw runtime data and are NOT in this set, so they stay escaped (XSS-safe).
  const preEscaped = new Set<string>();
  const classes: string[] = [];
  const styles: Record<string, string> = {};
  let innerHTML: string | undefined;

  for (const attr of attrNodes) {
    if (attr.type === "attribute") {
      const name = field(attr, "name")!.text;
      if (name === "i18n" || name.startsWith("i18n-") || name === "ngProjectAs") continue;
      const v = field(attr, "value");
      const text = v ? quotedText(v, scope) : "";
      if (name === "class") {
        classes.push(text); // class is aggregated + escaped at emit (entities meaningless here)
      } else if (name === "style") {
        // style is RE-AGGREGATED with [style.x] / [style] bindings at the end of this fn,
        // so its final value can carry RAW runtime data → keep it OUT of preEscaped (always
        // escaped at emit, like class). Author style entities are meaningless anyway.
        plain[name] = text;
      } else {
        plain[name] = text;
        preEscaped.add(name); // quotedText already produced a final, escape-once value
      }
    } else if (attr.type === "property_binding") {
      const name = field(attr, "name")!.text;
      const value = evalExpr(field(attr, "value"), scope);
      const before = { ...plain };
      applyBinding(name, value, { plain, classes, styles, setInner: (h) => (innerHTML = h) });
      // any plain key a binding actually wrote (added or changed) holds raw runtime data →
      // it must be escaped at emit, even if a same-named literal attribute pre-escaped it.
      for (const k of Object.keys(plain)) if (before[k] !== plain[k]) preEscaped.delete(k);
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
    .map(([k, v]) => (v === "" && BOOLEAN.has(k) ? ` ${k}` : ` ${k}="${preEscaped.has(k) ? v : escapeAttr(v)}"`))
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

/** A plain/double-quoted attribute value that may contain interpolation. Returns a
 *  FINAL attribute-ready string: literal author attribute_text is trusted and kept RAW
 *  (it may legitimately contain entities like "&amp;" — escaping it again would double-
 *  escape), while INTERPOLATED values are untrusted runtime data and ARE escaped here
 *  (so the buildAttrs emit must not escape this result again — see `preEscaped`). This
 *  mirrors element-content handling: author text raw, interpolations escaped. */
function quotedText(quotedValue: Node, scope: Scope): string {
  let out = "";
  for (const c of named(quotedValue)) {
    if (c.type === "interpolation") out += escapeAttr(stringify(evalExpr(field(c, "expression"), scope)));
    else out += c.text; // attribute_text — author literal, trusted/raw
  }
  return out;
}

/** Decode the HTML entities a template author may write in literal attribute text
 *  (&amp; &lt; &gt; &quot; &apos;/&#39; and numeric &#NN;/&#xHH;). Single-pass so a
 *  literal like "&amp;lt;" decodes to "&lt;" (not "<") — no cascading double-decode. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    // Only a valid Unicode scalar value is decodable. The regex allows unbounded
    // magnitudes, so an out-of-range code point (> U+10FFFF) is finite but makes
    // String.fromCodePoint THROW — bound-check it and fall back to the raw match.
    return (Number.isInteger(code) && code >= 0 && code <= 0x10FFFF) ? String.fromCodePoint(code) : _m;
  });
}

/** computeInputs-specific value builder for a component-tag attribute that becomes a
 *  DATA @input (NOT the native-element emit path — do NOT reuse quotedText's escape-for-
 *  emit output here). The CHILD escapes @input data exactly once on render (escape() for
 *  {{x}}, escapeAttr for [x]), so this must hand it the *decoded* author value: literal
 *  author attribute_text is HTML-entity-DECODED (so the child re-escapes it once, not
 *  twice → no "&amp;amp;"), while INTERPOLATED segments stay the RAW evaluated runtime
 *  value (NOT escaped here — the child escapes it once → still XSS-safe, no breakout). */
function inputText(quotedValue: Node, scope: Scope): string {
  let out = "";
  for (const c of named(quotedValue)) {
    if (c.type === "interpolation") out += stringify(evalExpr(field(c, "expression"), scope));
    else out += decodeEntities(c.text); // author literal → decode (child escapes once)
  }
  return out;
}

// ───────────────────────────── control flow ─────────────────────────────────
function blockOf(node: Node): Node | null {
  return named(node).find((c: Node) => c.type === "block") ?? null;
}

/** Clone a scope for a control-flow sub-view (@if/@for/@switch/@defer), PRESERVING
 *  the prototype so a class-instance scope keeps its methods/fields resolvable
 *  inside the block (bug AK — the same reason resolveIslands clones this way). A
 *  plain object-spread copies only own enumerable props and DROPS the prototype, so
 *  a method call inside the block would resolve to undefined and render empty.
 *  Copying own-property descriptors onto a clone of the same prototype keeps @let
 *  isolation (a @let write lands as an OWN prop on the clone, not the shared
 *  instance) AND lets scope.method() / (name in scope) resolve through the prototype. */
function cloneScope(scope: Scope, extra?: Record<string, unknown>): Scope {
  const clone = Object.create(Object.getPrototypeOf(scope), Object.getOwnPropertyDescriptors(scope));
  return extra ? Object.assign(clone, extra) : clone;
}

function renderIf(node: Node, opts: RenderOpts): string {
  const cond = evalExpr(field(node, "condition"), opts.scope);
  // Each @if view is its own block: clone the scope so view-local bindings (@let)
  // and any alias stay scoped to the branch and never leak into the parent.
  if (cond) {
    const alias = field(node, "alias");
    const scope = alias ? cloneScope(opts.scope, { [alias.text]: cond }) : cloneScope(opts.scope);
    return renderNodes(named(field(node, "consequence")!), { ...opts, scope });
  }
  for (const alt of named(node)) {
    if (alt.type === "else_if_clause") {
      const c = evalExpr(field(alt, "condition"), opts.scope);
      if (c) {
        const alias = field(alt, "alias");
        const scope = alias ? cloneScope(opts.scope, { [alias.text]: c }) : cloneScope(opts.scope);
        return renderNodes(named(blockOf(alt)!), { ...opts, scope });
      }
    } else if (alt.type === "else_clause") {
      return renderNodes(named(blockOf(alt)!), { ...opts, scope: cloneScope(opts.scope) });
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
    return empty ? renderNodes(named(blockOf(empty)!), { ...opts, scope: cloneScope(opts.scope) }) : "";
  }
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    const locals: Record<string, unknown> = {
      $index: i, $count: arr.length, $first: i === 0, $last: i === arr.length - 1, $even: i % 2 === 0, $odd: i % 2 === 1,
    };
    const scope: Scope = cloneScope(opts.scope, { [item]: arr[i], ...locals });
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
      // Each case body is its own view: clone the scope so a case-local @let never
      // leaks into the parent (or into a later case's condition evaluation).
      if (evalExpr(field(c, "value"), opts.scope) === value) return renderNodes(named(blockOf(c)!), { ...opts, scope: cloneScope(opts.scope) });
    } else if (c.type === "default_clause") {
      dflt = c;
    }
  }
  return dflt ? renderNodes(named(blockOf(dflt)!), { ...opts, scope: cloneScope(opts.scope) }) : "";
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
