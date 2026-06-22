// Content hashing — used by the build to stamp ?v= AND by the SSR runtime to recompute
// it on demand. It lives in its own module (no tree-sitter / parser import) so the
// RUNTIME can hash static/ without pulling the wasm-backed compiler into the bundle.
import { basename } from "@std/path";

/** A collision-safe short hash of a set of files, framed by (name-len, name,
 *  content-len, content) so the digest depends on file boundaries + names, not just the
 *  raw byte stream (an unframed concat collides under boundary shifts). */
export async function shortHash(paths: string[]): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0);
    return b;
  };
  for (const p of paths) {
    const name = enc.encode(basename(p));
    const content = await Deno.readFile(p);
    parts.push(u32(name.length), name, u32(content.length), content);
  }
  const total = parts.reduce((n, b) => n + b.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const b of parts) {
    all.set(b, off);
    off += b.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", all);
  // 8 bytes / 64-bit — `v` is the sole cache-buster for the stable-named, immutable-
  // cached client.js + isl.*.js, so keep it collision-safe (matches esbuild's hashes).
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
