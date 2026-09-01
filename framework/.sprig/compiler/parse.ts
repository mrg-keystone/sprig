// Template parsing (SERVER ONLY): load the tree-sitter-angular-template grammar
// (compiled to wasm, no Rust) once and parse template.html into an AST. web-tree-
// sitter is a pure-wasm runtime, so this works in Deno with no native build. The
// browser never imports this file (it walks the serialized JsonNode instead).
import { Language, Parser } from "web-tree-sitter";
import { fromFileUrl } from "@std/path";
import type { Node } from "./node.ts";

export type { Node };
export { field, named } from "./node.ts";

let parserPromise: Promise<Parser> | null = null;

function loadParser(): Promise<Parser> {
  return (parserPromise ??= (async () => {
    await Parser.init();
    // The tree-sitter grammar wasm sits next to this module. Read it directly when local
    // (file://), and fetch only when this module is served remotely (https:// — i.e. published
    // on JSR), so a local run never goes through fetch.
    //
    // ⚠️ It is named `grammar.bin`, NOT `grammar.wasm`, ON PURPOSE — do NOT rename it back.
    // JSR/`deno publish` treats any `.wasm` file as a Wasm ES module and rewrites its single
    // import module `env` → `./env` (the wasm-ESM ABI) on ingest. web-tree-sitter's
    // `Language.load(bytes)` instantiates the raw bytes with an `env` import and throws on the
    // rewritten `./env` form ("Import #0 \"./env\": module is not an object or function"), so a
    // `.wasm` name ships a grammar that can't load from JSR. A non-`.wasm` name is served as
    // opaque bytes, byte-identical to the repo. (web-tree-sitter ignores the extension entirely.)
    const wasmUrl = new URL("./grammar.bin", import.meta.url);
    const bytes = wasmUrl.protocol === "file:"
      ? await Deno.readFile(fromFileUrl(wasmUrl))
      : new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
    const lang = await Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(lang);
    return parser;
  })());
}

/** Did tree-sitter recover from a syntax error in this (sub)tree? web-tree-sitter
 *  is error-tolerant: malformed input yields a non-null tree with ERROR/MISSING
 *  nodes and `rootNode.hasError === true` instead of throwing. */
export function hasParseError(node: Node): boolean {
  return node?.hasError === true;
}

// The block keywords the Angular-flavored grammar lexes after `@` in text
// content. Anything else after `@` cannot open a block, so a bare `@` there is
// prose (an email, a handle) — escape it instead of letting the parse die.
const BLOCK_KEYWORD =
  /^(?:if|else|for|empty|let|switch|case|default|defer|placeholder|loading|error)\b/;

/** Escape a bare `@` in TEXT content as `&#64;` so the grammar doesn't lex it as
 *  a control-flow opener. Only `@` NOT followed by a block keyword is escaped,
 *  and only in plain text — tags, comments, interpolations and raw
 *  script/style content pass through untouched (`@media` in <style> and
 *  decorators in <script> are real syntax there). The entity is invisible to
 *  the reader: text nodes are emitted raw into HTML on the server, and the
 *  client applies re-renders via innerHTML, so both channels display `@`. */
export function escapeLooseAt(html: string): string {
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        const stop = end === -1 ? n : end + 3;
        out += html.slice(i, stop);
        i = stop;
        continue;
      }
      const raw = /^<(script|style)\b/i.exec(html.slice(i, i + 8));
      if (raw) {
        const close = new RegExp(`</${raw[1]}\\s*>`, "i").exec(html.slice(i));
        const stop = close ? i + close.index + close[0].length : n;
        out += html.slice(i, stop);
        i = stop;
        continue;
      }
      const end = html.indexOf(">", i + 1);
      const stop = end === -1 ? n : end + 1;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "{" && html[i + 1] === "{") {
      const end = html.indexOf("}}", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "@" && !BLOCK_KEYWORD.test(html.slice(i + 1, i + 14))) {
      out += "&#64;";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// TEMPLATE WIRING longhand (spec §3): `sets:org={selectedOrg}` — the braces hold a
// LITERAL compile-time channel identifier, but the grammar rejects both an unquoted
// `={…}` value AND a bare `{` inside a quoted value. Rewrite it to a quoted,
// entity-encoded form (`sets:org="&#123;selectedOrg&#125;"`) before parsing, so the
// attribute arrives as an ordinary quoted value whose entity-decoded text is the
// `{channel}` literal render.ts's wiring collector reads. Applied only INSIDE
// tags — text content, comments, interpolations and raw <script>/<style> bodies
// pass through untouched (same skip discipline as escapeLooseAt above; offsets
// shift, but every consumer takes the source from the tree itself, so they stay
// coherent).
const WIRE_LONGHAND = /(\s(?:sets|reads|edits):[A-Za-z_$][\w$-]*)=\{\s*([A-Za-z_$][\w$]*)\s*\}(?=[\s>/]|$)/g;

/** Quote + entity-encode the wiring-longhand `={channel}` form inside start tags. */
export function quoteWiringLonghand(html: string): string {
  if (!html.includes("={")) return html; // fast path: no longhand anywhere
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        const stop = end === -1 ? n : end + 3;
        out += html.slice(i, stop);
        i = stop;
        continue;
      }
      const raw = /^<(script|style)\b/i.exec(html.slice(i, i + 8));
      if (raw) {
        const close = new RegExp(`</${raw[1]}\\s*>`, "i").exec(html.slice(i));
        const stop = close ? i + close.index + close[0].length : n;
        out += html.slice(i, stop);
        i = stop;
        continue;
      }
      const end = html.indexOf(">", i + 1);
      const stop = end === -1 ? n : end + 1;
      out += html.slice(i, stop).replace(WIRE_LONGHAND, '$1="&#123;$2&#125;"');
      i = stop;
      continue;
    }
    if (ch === "{" && html[i + 1] === "{") {
      const end = html.indexOf("}}", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** The first ERROR/MISSING node in the tree — where the syntax error actually is. */
function firstErrorNode(node: Node): Node | null {
  if (node.type === "ERROR" || node.isMissing) return node;
  if (!node.hasError) return null;
  for (let i = 0; i < (node.childCount ?? 0); i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = firstErrorNode(child);
    if (found) return found;
  }
  return node;
}

/** Parse a template string → the root AST node. By default a template that does
 *  not parse cleanly THROWS (so a typo'd/truncated template fails the build and
 *  is never baked into an island chunk / the SSR registry) rather than silently
 *  shipping a tree-sitter ERROR AST. Pass `{ allowError: true }` to inspect a
 *  possibly-broken tree without throwing (the dev HMR reparse path uses this to
 *  suppress the live push instead of clobbering mounted islands). */
export async function parseTemplate(html: string, opts: { allowError?: boolean } = {}): Promise<Node> {
  const parser = await loadParser();
  // Prose-proof the text content first (a bare `@` would otherwise lex as a
  // control-flow opener and fail the whole parse), and quote the wiring-longhand
  // `={channel}` form the grammar can't lex unquoted. Every consumer of this tree
  // takes the source from the tree itself (serialize round-trips rootNode.text,
  // render slices opts.source = template.text), so offsets stay coherent.
  const source = escapeLooseAt(quoteWiringLonghand(html));
  const tree = parser.parse(source);
  if (!tree) throw new Error("template parse returned null");
  const root = tree.rootNode;
  if (!opts.allowError && hasParseError(root)) {
    const err = firstErrorNode(root);
    const at = err?.startPosition
      ? `line ${err.startPosition.row + 1}, column ${err.startPosition.column + 1}`
      : "unknown position";
    const excerpt = err
      ? source.slice(err.startIndex, Math.min(err.endIndex, err.startIndex + 80))
      : "";
    throw new Error(
      `sprig: template failed to parse cleanly (syntax error at ${at}). ` +
        "Fix the template HTML — a malformed template must not ship.\n" +
        `  near: ${JSON.stringify(excerpt)}\n` +
        `  source: ${JSON.stringify(source.length > 120 ? source.slice(0, 120) + "…" : source)}`,
    );
  }
  return root;
}

/** Parse + cache a template source (SSR). */
const PARSE_CACHE = new Map<string, Promise<Node>>();
export function parseCached(source: string): Promise<Node> {
  let p = PARSE_CACHE.get(source);
  if (!p) {
    p = parseTemplate(source);
    PARSE_CACHE.set(source, p);
  }
  return p;
}
