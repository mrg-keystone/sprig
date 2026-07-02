// Content hashing — used by the build to stamp ?v= AND by the SSR runtime to recompute
// it on demand. It lives in its own module (no tree-sitter / parser import) so the
// RUNTIME can hash static/ without pulling the wasm-backed compiler into the bundle.
import { basename, join } from "@std/path";

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

/** The ?v= content version of a built assets dir: shortHash over the SERVED file set
 *  (.js + app.css — the same set the build hashes, so build/render/serve agree).
 *  `null` when the dir is missing or holds no assets — the DEGRADED state; callers
 *  must treat it as "not content-addressed", never as a usable version. */
export async function versionOf(dir: string): Promise<string | null> {
  try {
    const files: string[] = [];
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && (e.name.endsWith(".js") || e.name === "app.css")) files.push(join(dir, e.name));
    }
    return files.length ? await shortHash(files.sort()) : null;
  } catch {
    return null;
  }
}

/** A CURRENT-version supplier for the asset server + the SSR env. The content hash is
 *  memoized behind a cheap stat probe (sorted name/size/mtime of the same file set), so
 *  the steady state costs a readDir + a few stats — but an in-place rebuild (an HMR
 *  rebuild under `sprig dev`, or `sprig build` under a running server) is picked up on
 *  the next request. Memoizing forever would let a stale hash keep blessing changed
 *  bytes as `immutable` — the exact wedge this versioner exists to prevent. */
export function assetsVersioner(dir: string): () => Promise<string | null> {
  let sig: string | undefined;
  // the PROMISE is memoized (keyed by the probe signature), so a request arriving
  // while a recompute is in flight awaits the fresh hash instead of reading the old one
  let hash: Promise<string | null> = Promise.resolve(null);
  return async () => {
    let probe: string;
    try {
      const parts: string[] = [];
      for await (const e of Deno.readDir(dir)) {
        if (e.isFile && (e.name.endsWith(".js") || e.name === "app.css")) {
          const s = await Deno.stat(join(dir, e.name));
          parts.push(`${e.name}:${s.size}:${s.mtime?.getTime() ?? 0}`);
        }
      }
      probe = parts.sort().join("\n");
    } catch {
      probe = ""; // unreadable dir → same as empty: no version
    }
    if (probe !== sig) {
      sig = probe;
      hash = probe ? versionOf(dir) : Promise.resolve(null);
    }
    return hash;
  };
}
