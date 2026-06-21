// Template parsing (SERVER ONLY): load the tree-sitter-angular-template grammar
// (compiled to wasm, no Rust) once and parse template.html into an AST. web-tree-
// sitter is a pure-wasm runtime, so this works in Deno with no native build. The
// browser never imports this file (it walks the serialized JsonNode instead).
import { Language, Parser } from "web-tree-sitter";
import { dirname, fromFileUrl, join } from "@std/path";
import type { Node } from "./node.ts";

export type { Node };
export { field, named } from "./node.ts";

let parserPromise: Promise<Parser> | null = null;

function loadParser(): Promise<Parser> {
  return (parserPromise ??= (async () => {
    await Parser.init();
    const wasmPath = join(dirname(fromFileUrl(import.meta.url)), "grammar.wasm");
    const lang = await Language.load(await Deno.readFile(wasmPath));
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

/** Parse a template string → the root AST node. By default a template that does
 *  not parse cleanly THROWS (so a typo'd/truncated template fails the build and
 *  is never baked into an island chunk / the SSR registry) rather than silently
 *  shipping a tree-sitter ERROR AST. Pass `{ allowError: true }` to inspect a
 *  possibly-broken tree without throwing (the dev HMR reparse path uses this to
 *  suppress the live push instead of clobbering mounted islands). */
export async function parseTemplate(html: string, opts: { allowError?: boolean } = {}): Promise<Node> {
  const parser = await loadParser();
  const tree = parser.parse(html);
  if (!tree) throw new Error("template parse returned null");
  const root = tree.rootNode;
  if (!opts.allowError && hasParseError(root)) {
    throw new Error(
      "sprig: template failed to parse cleanly (tree-sitter reported a syntax error). " +
        "Fix the template HTML — a malformed template must not ship.\n" +
        `  source: ${JSON.stringify(html.length > 120 ? html.slice(0, 120) + "…" : html)}`,
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
