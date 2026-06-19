#!/usr/bin/env -S deno run -A
// deno-lint-ignore-file no-import-prefix -- standalone remote bootstrap (run via
// `deno run -A <url>`); it has no import map, so the inline jsr: specifier is required.
// Bootstrap installer for the isolate CLI. One-liner:
//
//   deno run -A https://raw.githubusercontent.com/mrg-keystone/isolate/main/install.ts
//
// Downloads the latest GitHub release bundle (cli + server + ui + skills) into
// ~/.isolate, then hands off to the bundle's own installer to copy the skills to
// ~/.claude/skills (skills as isolate-<name>) and install the global `isolate` bin. After this, use
// `isolate update` to upgrade everything (skills, CLI, and the bundled UI).
//
// Standalone by design — it can't import the bundle's modules before the bundle
// exists, so the download+extract is duplicated from cli/lib/install-core.ts.
import { dirname, join } from "jsr:@std/path@^1";

const REPO = "mrg-keystone/isolate";
const UA = { "user-agent": "isolate-install" };

const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
if (!home) {
  console.error("✗ HOME not set — cannot locate ~/.isolate.");
  Deno.exit(1);
}
const runtime = join(home, ".isolate");

console.log("Finding the latest isolate release…");
const relRes = await fetch(
  `https://api.github.com/repos/${REPO}/releases/latest`,
  { headers: { ...UA, accept: "application/vnd.github+json" } },
);
if (!relRes.ok) {
  console.error(`✗ GitHub API ${relRes.status} ${relRes.statusText}.`);
  Deno.exit(1);
}
// deno-lint-ignore no-explicit-any
const rel: any = await relRes.json();
// deno-lint-ignore no-explicit-any
const asset = (rel.assets ?? []).find((a: any) =>
  /^isolate-.*\.tar\.gz$/.test(a.name)
);
const url: string = asset ? asset.browser_download_url : rel.tarball_url;
const isSource = !asset;
console.log(`Installing isolate ${rel.tag_name}…`);

const tmp = await Deno.makeTempDir({ prefix: "isolate-install-" });
const tgz = join(tmp, "bundle.tar.gz");
const dl = await fetch(url, { headers: UA });
if (!dl.ok) {
  console.error(`✗ download failed: ${dl.status} ${dl.statusText}.`);
  Deno.exit(1);
}
await Deno.writeFile(tgz, new Uint8Array(await dl.arrayBuffer()));
const ex = join(tmp, "bundle");
await Deno.mkdir(ex, { recursive: true });
const untar = await new Deno.Command("tar", {
  args: ["-xzf", tgz, "-C", ex, ...(isSource ? ["--strip-components=1"] : [])],
  stdout: "null",
  stderr: "inherit",
}).output();
if (!untar.success) {
  console.error("✗ failed to extract the release bundle.");
  Deno.exit(1);
}

// Swap into ~/.isolate.
await Deno.remove(runtime, { recursive: true }).catch(() => {});
await Deno.mkdir(dirname(runtime), { recursive: true });
await Deno.rename(ex, runtime);
console.log(`✓ runtime → ${runtime}`);

// Finish with the bundle's own installer (skills → ~/.claude/skills, + the bin).
const finish = await new Deno.Command("deno", {
  args: ["run", "-A", join(runtime, "cli", "lib", "install-core.ts")],
  stdout: "inherit",
  stderr: "inherit",
}).output();
Deno.exit(finish.success ? 0 : 1);
