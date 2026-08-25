// Pure import-map transformations for the CLI's pin stamping + legacy-name
// migration (extracted from cli.ts so they are testable — cli.ts executes its
// command switch on import and cannot be imported by a test).
//
// Contract, learned the hard way (a stale 0.21.1 CLI silently DOWNGRADED an
// app pinned to 1.0.0, resurrecting every runtime bug fixed in between):
//   · stamping keeps an app's @mrg-keystone/sprig pin matched to the CLI that
//     builds it, but NEVER downgrades — a pin AHEAD of the CLI means the CLI
//     install is stale, not the app;
//   · migration renames the LEGACY `@sprig/core`/`@sprig/keep` scope only — an
//     entry already on the modern name passes through byte-identical.

/** A relative / absolute / `file:` value — an intentional local dev override. */
export function isLocalOverride(value: string): boolean {
  return /^(\.{0,2}\/|\/|file:)/.test(value);
}

/** The version a `jsr:@mrg-keystone/sprig@X[/keep]` value pins (range markers
 *  `^`/`~` stripped), or null when the value doesn't carry one. */
export function pinnedSprigVersion(value: string): string | null {
  return value.match(/@mrg-keystone\/sprig@[\^~]?([^/]+)/)?.[1] ?? null;
}

/** Compare two semver-ish `a.b.c` strings. Returns >0 if `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface StampResult {
  imports: Record<string, string>;
  changed: boolean;
  /** a pin left alone because it is AHEAD of the CLI (the caller warns once) */
  aheadPin: string | null;
}

/** Re-pin the existing @mrg-keystone/sprig mappings to the CLI version `v`.
 *  Only existing keys are touched; local overrides and pins NEWER than `v`
 *  are left alone (never downgrade). */
export function stampImports(imports: Record<string, string>, v: string): StampResult {
  const wanted: Record<string, string> = {
    "@mrg-keystone/sprig": `jsr:@mrg-keystone/sprig@${v}`,
    "@mrg-keystone/sprig/keep": `jsr:@mrg-keystone/sprig@${v}/keep`,
  };
  const out = { ...imports };
  let changed = false;
  let aheadPin: string | null = null;
  for (const [k, want] of Object.entries(wanted)) {
    const cur = out[k];
    if (typeof cur !== "string") continue; // only restamp a key that already exists
    if (isLocalOverride(cur)) continue; // leave a LOCAL / file: override alone
    const pinned = pinnedSprigVersion(cur);
    if (pinned && compareVersions(pinned, v) > 0) {
      aheadPin = pinned; // never downgrade — the CLI is the stale side
      continue;
    }
    if (cur !== want) {
      out[k] = want;
      changed = true;
    }
  }
  return { imports: out, changed, aheadPin };
}

/** Rename a legacy-scoped import KEY to the modern scope; non-legacy keys pass through. */
export function migrateKey(k: string): string {
  return k === "@sprig/core"
    ? "@mrg-keystone/sprig"
    : k === "@sprig/keep"
    ? "@mrg-keystone/sprig/keep"
    : k.startsWith("@sprig/core/")
    ? "@mrg-keystone/sprig/" + k.slice("@sprig/core/".length)
    : k.startsWith("@sprig/keep/")
    ? "@mrg-keystone/sprig/keep/" + k.slice("@sprig/keep/".length)
    : k;
}

/** Rewrite a LEGACY value's scope and re-pin its version to the CLI's (a
 *  legacy-named app predates the rename, so its pin is behind by definition). */
export function migrateVal(val: string, v: string | null): string {
  let out = val.replaceAll("@sprig/core", "@mrg-keystone/sprig").replaceAll("@sprig/keep", "@mrg-keystone/sprig/keep");
  if (v) out = out.replace(/(@mrg-keystone\/sprig)@[^/"']+/g, `$1@${v}`);
  return out;
}

export interface MigrateResult {
  imports: Record<string, string>;
  changed: boolean;
}

/** Migrate the legacy `@sprig/*` entries of an import map to the modern scope.
 *  An entry with a modern key AND no legacy name in its value is NOT an input
 *  to this migration and passes through byte-identical — this function must be
 *  a true no-op on an already-migrated app. A deliberate LOCAL override already
 *  present on the modern key wins over a migrating legacy key (which is dropped). */
export function migrateImports(imports: Record<string, string>, v: string | null): MigrateResult {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [k, val] of Object.entries(imports)) {
    const key = migrateKey(k);
    if (key === k && !val.includes("@sprig/core") && !val.includes("@sprig/keep")) {
      next[k] = val;
      continue;
    }
    const value = migrateVal(val, v);
    if (key !== k) {
      const existing = imports[key];
      if (typeof existing === "string" && isLocalOverride(existing)) {
        changed = true;
        continue; // drop the legacy key; the local override wins
      }
    }
    if (key !== k || value !== val) changed = true;
    next[key] = value;
  }
  return { imports: next, changed };
}
