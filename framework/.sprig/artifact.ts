// sprig's implementation of the shared spec/ ARTIFACT contract: the
// self-describing manifest, the skeleton (when sprig's init is the FIRST to
// land), the version handshake, and the contract-freshness check that makes
// the build artifact-mediated — sprig reads the COMMITTED, hash-stamped
// contract files and never invokes the backend toolchain. Deliberately an
// INDEPENDENT implementation (no import from any other toolchain): the
// contract is executable prose plus the shared golden vectors, not a shared
// runtime module.

import { dirname, join } from "@std/path";
import {
  HASH_VECTORS_JSON,
  SPEC_ROOT_VECTORS_JSON,
} from "./vendored-tests.ts";

export const ARTIFACT_FORMAT_VERSION = "1.0.0";
export const SUPPORTED_FORMAT_MAJOR = 1;

export interface ManifestEntry {
  class: "durable" | "merge" | "derived";
  owner: string;
  producer: string;
}

export interface SpecManifest {
  formatVersion: string;
  subtrees: Record<string, ManifestEntry>;
}

/** Every subtree sprig produces — registered additively, only-if-absent. sprig
 *  never writes, edits, or reorders another toolchain's entries. */
export const SPRIG_MANIFEST_ENTRIES: Record<string, ManifestEntry> = {
  "ui/": { class: "durable", owner: "frontend", producer: "frontend toolchain" },
  "contract/binding.md": {
    class: "durable",
    owner: "frontend",
    producer: "frontend toolchain",
  },
};

function skeletonManifest(): SpecManifest {
  return {
    formatVersion: ARTIFACT_FORMAT_VERSION,
    subtrees: {
      "tests/": { class: "durable", owner: "none", producer: "artifact format" },
    },
  };
}

/** Create the spec/ skeleton ATOMICALLY iff spec/ is absent — layout dirs, the
 *  minimal manifest, and the vendored conformance vectors; built in a temp dir
 *  and renamed into place in one step so a racing or interrupted first init can
 *  never leave a partial skeleton. Returns true when this call created it. */
export async function ensureSpecSkeleton(gitRoot: string): Promise<boolean> {
  const specDir = join(gitRoot, "spec");
  try {
    await Deno.stat(specDir);
    return false;
  } catch { /* absent */ }
  const tmp = await Deno.makeTempDir({ prefix: ".spec-skeleton-", dir: gitRoot });
  try {
    for (const d of ["runes", "misc", "ui", "product", "contract", "tests"]) {
      await Deno.mkdir(join(tmp, d), { recursive: true });
    }
    await Deno.writeTextFile(
      join(tmp, "manifest.json"),
      JSON.stringify(skeletonManifest(), null, 2) + "\n",
    );
    await Deno.writeTextFile(
      join(tmp, "tests", "spec-root-vectors.json"),
      SPEC_ROOT_VECTORS_JSON + "\n",
    );
    await Deno.writeTextFile(
      join(tmp, "tests", "hash-vectors.json"),
      HASH_VECTORS_JSON + "\n",
    );
    try {
      await Deno.rename(tmp, specDir);
      return true;
    } catch {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      return false; // lost the race — the winner's skeleton is complete
    }
  } catch (e) {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
    throw e;
  }
}

export async function readManifest(
  gitRoot: string,
): Promise<SpecManifest | null> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(gitRoot, "spec", "manifest.json")),
    );
    if (
      parsed && typeof parsed === "object" &&
      typeof parsed.formatVersion === "string"
    ) return parsed as SpecManifest;
    return null;
  } catch {
    return null;
  }
}

/** Register sprig's entries additively, only-if-absent; a pre-artifact app
 *  (spec/ present, no manifest) gets the skeleton manifest first. */
export async function registerManifestEntries(
  gitRoot: string,
  entries: Record<string, ManifestEntry> = SPRIG_MANIFEST_ENTRIES,
): Promise<string[]> {
  const path = join(gitRoot, "spec", "manifest.json");
  const manifest = (await readManifest(gitRoot)) ?? skeletonManifest();
  const added: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (manifest.subtrees[key] !== undefined) continue;
    manifest.subtrees[key] = entry;
    added.push(key);
  }
  if (added.length || !(await readManifest(gitRoot))) {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(manifest, null, 2) + "\n");
  }
  return added;
}

/** The version handshake: null when compatible (or no manifest — a
 *  pre-artifact repo); otherwise the located error to print before exiting. */
export async function checkArtifactVersion(
  gitRoot: string,
): Promise<string | null> {
  const manifest = await readManifest(gitRoot);
  if (!manifest) return null;
  const major = Number(manifest.formatVersion.split(".")[0]);
  if (Number.isFinite(major) && major === SUPPORTED_FORMAT_MAJOR) return null;
  return `spec/manifest.json declares artifact format ${manifest.formatVersion}; ` +
    `this sprig supports ${SUPPORTED_FORMAT_MAJOR}.x — upgrade ${
      major > SUPPORTED_FORMAT_MAJOR ? "the sprig CLI" : "the artifact"
    } so the two agree (never edit around a version mismatch).`;
}

/**
 * Artifact-mediated decoupling, the consuming half: when the app carries a
 * committed typed client (`spec/contract/client/.hash`), its recorded
 * `source-hash` must equal the committed `spec/contract/openapi.json`'s own
 * `x-spec-hash` — the client was generated from THIS spec. On a mismatch (or a
 * client with no openapi.json beside it) the build FAILS LOUD with the fix,
 * naming the regeneration step; it never invokes the backend toolchain to
 * regenerate anything itself. No client committed → nothing to verify.
 */
export async function verifyContractFreshness(
  gitRoot: string,
): Promise<string | null> {
  let hashFile: { "source-hash"?: string };
  try {
    hashFile = JSON.parse(
      await Deno.readTextFile(
        join(gitRoot, "spec", "contract", "client", ".hash"),
      ),
    );
  } catch {
    return null; // no committed client → artifact-mediation has nothing to gate
  }
  const recorded = hashFile["source-hash"];
  if (typeof recorded !== "string" || recorded === "") {
    return "spec/contract/client/.hash carries no source-hash — regenerate the client " +
      "(the client generator stamps the openapi.json hash it consumed).";
  }
  let current: string | undefined;
  try {
    const openapi = JSON.parse(
      await Deno.readTextFile(join(gitRoot, "spec", "contract", "openapi.json")),
    );
    current = openapi["x-spec-hash"];
  } catch {
    return "spec/contract/client/ is committed but spec/contract/openapi.json is missing — " +
      "commit the backend's emitted contract (a rune sync with the run-all gate emits it), " +
      "or remove the stale client.";
  }
  if (typeof current !== "string") {
    return "spec/contract/openapi.json carries no x-spec-hash stamp — re-emit it " +
      "(a rune sync with the run-all gate stamps it).";
  }
  if (recorded !== current) {
    return `client is from openapi@${recorded.slice(0, 12)}…, spec has openapi@${
      current.slice(0, 12)
    }… — regenerate the typed client from the current openapi.json before building.`;
  }
  return null;
}
