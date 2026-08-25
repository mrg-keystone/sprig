// Node helpers shared by the interpreter (expr.ts / render.ts / serialize.ts).
// NO web-tree-sitter import here, so these modules bundle for the browser — the
// client walks JsonNode (the serialized AST) through this exact same API.

// deno-lint-ignore no-explicit-any
export type Node = any; // web-tree-sitter Node OR JsonNode: { type, text, startIndex, endIndex, namedChildren, childForFieldName }

/** Named children only (skips anonymous punctuation tokens). */
export function named(node: Node): Node[] {
  return node.namedChildren.filter((c: Node) => c !== null);
}

/** Child for a field name (may be an anonymous token, e.g. an operator). */
export function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name) ?? null;
}

/** Does this template SOURCE declare any `(event)="…"` bindings? Both the build
 *  (island-chunk emission) and the SSR registry (hydration classification) must
 *  answer this identically: a route whose logic looks server-only (onServerLoad,
 *  no browser hook) but whose template wires events MUST still hydrate — the
 *  alternative is a page whose every click silently does nothing. Lives here
 *  (not parse.ts) so the SSR side can ask without pulling the wasm parser in. */
export function templateHasEventBindings(src: string): boolean {
  return /\(([a-zA-Z][\w.-]*)\)\s*=\s*["']/.test(src);
}
