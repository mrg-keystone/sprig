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
