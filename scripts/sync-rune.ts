#!/usr/bin/env -S deno run -A
// Repin @mrg-keystone/rune to its newest published version across sprig's own packages, then relock.
//
//   deno task sync:rune            # pin to the latest rune on JSR
//   deno task sync:rune 3.1.0      # pin to an explicit version (for a deliberate downgrade/hold)
//
// The scaffold `sprig init` writes does NOT hardcode a rune version — it reads the pin back out of
// server/deno.json at init time (see runeRange() in framework/cli.ts), so refreshing server here is
// what makes every freshly-scaffolded app target the newest rune. This is the LOCAL twin of the
// release-time refresh: the reusable jsr-publish workflow runs the same repin on every cut (its
// `refresh-latest` step) so a published sprig always ships against the newest rune; run this task
// when you want that today, without waiting for a release.
//
// api.jsr.io is authoritative (jsr.io/@scope/pkg/meta.json is CDN-cached and lags minutes behind).

const PKG = "@mrg-keystone/rune";
const [scope, name] = PKG.slice(1).split("/");
const UA = "sprig-sync-rune/1.0; https://jsr.io/@sprig/core";

// Files whose rune pins we own. server/ is the source of truth the scaffold reads; the fixtures are
// standalone demo apps (not workspace members, so a `deno install` relock won't reach them) that
// should mirror what a real scaffold produces.
const TARGETS = [
  "server/deno.json",
  ...[...Deno.readDirSync("fixtures")]
    .filter((e) => e.isDirectory)
    .map((e) => `fixtures/${e.name}/deno.json`),
];

// Matches every rune pin regardless of the import-map KEY (bare `@mrg-keystone/rune`, the aliased
// `#assert` → `.../rune@X/assert`, …). The char class stops at `/`, so a `/assert` subpath survives.
const PIN = new RegExp(`jsr:@${scope}/${name}@[^"/]+`, "g");

async function latestVersion(): Promise<string> {
  const res = await fetch(`https://api.jsr.io/scopes/${scope}/packages/${name}`, {
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`api.jsr.io ${res.status} for ${PKG}`);
  const { latestVersion } = await res.json() as { latestVersion?: string };
  if (!latestVersion) throw new Error(`no latestVersion for ${PKG} — is it published?`);
  return latestVersion;
}

const explicit = Deno.args[0];
const version = explicit ?? await latestVersion();
const replacement = `jsr:@${scope}/${name}@^${version}`;
console.log(`${PKG} → ^${version}${explicit ? " (explicit)" : " (latest on JSR)"}`);

let changed = 0;
for (const file of TARGETS) {
  let text: string;
  try {
    text = Deno.readTextFileSync(file);
  } catch {
    continue; // a fixture without a deno.json — skip
  }
  if (!PIN.test(text)) continue;
  const next = text.replace(PIN, replacement);
  if (next === text) {
    console.log(`  = ${file} (already ${replacement})`);
    continue;
  }
  Deno.writeTextFileSync(file, next);
  console.log(`  ✎ ${file}`);
  changed++;
}

if (changed === 0) {
  console.log("Nothing to repin — every target already at latest.");
  Deno.exit(0);
}

// Relock the workspace so deno.lock matches the new floor (server is a workspace member).
console.log("Relocking (deno install)…");
const relock = new Deno.Command("deno", { args: ["install", "--quiet"], stdout: "inherit", stderr: "inherit" });
const { code } = await relock.output();
if (code !== 0) {
  console.error("::warning:: `deno install` relock failed — run it manually to update deno.lock");
  Deno.exit(code);
}
console.log(`Done — ${changed} file(s) repinned to ${replacement}.`);
