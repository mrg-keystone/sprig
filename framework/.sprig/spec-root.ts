// The shared `spec/` resolution contract between sprig and the rune/keep toolchain
// (see coordinate.md). In a monorepo the frontend (sprig) and backend (rune) are
// siblings under the git root and must read+write ONE shared `spec/`. So `spec/` is
// always `specRootOf(startDir) + "/spec/"`, resolved by walking up to the nearest
// ancestor that contains a `.git` entry.
//
// Both tools MUST implement the IDENTICAL walk, or a monorepo's two halves resolve to
// different `spec/` dirs and the shared contract splits.
import { dirname, join, resolve } from "@std/path";

function gitEntryExists(dir: string): boolean {
  try {
    // `.git` can be a directory (a normal clone) OR a file (a `git worktree`
    // checkout points elsewhere via a `.git` file) — test for existence, not type.
    Deno.statSync(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `startDir` to the nearest ancestor containing a `.git` entry and
 *  return it as the spec root (`spec/` lives directly under it). With no `.git`
 *  ancestor, return `startDir` unchanged — so a standalone single-package repo (its
 *  `.git` is at the project root, the walk returns it immediately) and a not-yet-`git
 *  init`'d scaffold both keep today's behavior. */
export function specRootOf(startDir: string): string {
  const start = resolve(startDir);
  let d = start;
  while (true) {
    if (gitEntryExists(d)) return d;
    const parent = dirname(d);
    if (parent === d) return start; // hit the filesystem root, no `.git` ancestor
    d = parent;
  }
}
