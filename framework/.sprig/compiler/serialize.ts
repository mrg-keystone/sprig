// Serialize a parsed (wasm-backed) template tree → a compact, JSON-safe form, and
// reconstruct it as a JsonNode that exposes the SAME shape the interpreter uses
// (type / text / startIndex / endIndex / namedChildren / childForFieldName). This
// lets the identical expr.ts + render.ts run on the CLIENT with no wasm: the build
// ships JSON, the client walks it.
import type { Node } from "./node.ts";

export interface SNode {
  t: string; // type
  s: number; // startIndex
  e: number; // endIndex
  c: SNode[]; // all children (named + anonymous)
  n: number[]; // indices of c that are named
  f: Record<string, number>; // field name → index into c
}
export interface SerializedTemplate {
  source: string;
  root: SNode;
}

function isNamed(node: Node): boolean {
  return typeof node.isNamed === "function" ? node.isNamed() : node.isNamed;
}

function toSNode(node: Node): SNode {
  const c: SNode[] = [];
  const n: number[] = [];
  const f: Record<string, number> = {};
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const idx = c.length;
    c.push(toSNode(child));
    if (isNamed(child)) n.push(idx);
    const fname = node.fieldNameForChild(i);
    // FIRST-write-wins to mirror web-tree-sitter's childForFieldName (which
    // returns the first matching child). A repeated field name (e.g. pipe
    // "argument") otherwise collapsed to the LAST child here, diverging from
    // the wasm tree used on the server → SSR/client hydration mismatch.
    if (fname && !(fname in f)) f[fname] = idx;
  }
  return { t: node.type, s: node.startIndex, e: node.endIndex, c, n, f };
}

/** wasm tree → JSON-safe { source, root }. */
export function serialize(rootNode: Node): SerializedTemplate {
  // A JsonNode has no childCount/child/fieldNameForChild, so re-walking it via
  // toSNode would yield an empty tree. It already holds its backing SNode +
  // source, so round-trip it directly.
  if (rootNode instanceof JsonNode) return rootNode.toSerialized();
  return { source: rootNode.text, root: toSNode(rootNode) };
}

/** A plain-object node that quacks like a web-tree-sitter node for the interpreter. */
export class JsonNode {
  #s: SNode;
  #source: string;
  #named?: JsonNode[];
  constructor(s: SNode, source: string) {
    this.#s = s;
    this.#source = source;
  }
  get type(): string {
    return this.#s.t;
  }
  get startIndex(): number {
    return this.#s.s;
  }
  get endIndex(): number {
    return this.#s.e;
  }
  get text(): string {
    return this.#source.slice(this.#s.s, this.#s.e);
  }
  get namedChildren(): JsonNode[] {
    return (this.#named ??= this.#s.n.map((i) => new JsonNode(this.#s.c[i], this.#source)));
  }
  childForFieldName(name: string): JsonNode | null {
    const i = this.#s.f[name];
    return i === undefined ? null : new JsonNode(this.#s.c[i], this.#source);
  }
  /** Expose the backing { source, root } so serialize() can round-trip without re-walking. */
  toSerialized(): SerializedTemplate {
    return { source: this.#source, root: this.#s };
  }
}

/** Reconstruct a JsonNode tree (the interpreter renders its namedChildren). */
export function fromSerialized(t: SerializedTemplate): JsonNode {
  return new JsonNode(t.root, t.source);
}
