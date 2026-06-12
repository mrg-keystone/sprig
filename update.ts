// `isolate update` — refresh this machine to the latest published release:
//   1. Re-download the bundled deno-fresh2 skill from the newest
//      jsr:@mrg-keystone/isolate version and install it at USER scope
//      (~/.claude/skills/<skill-name>), replacing whatever is there.
//   2. Reinstall the `isolate` CLI globally, pinned to that same version.
//
// The skill ships inside the package under `skill/`; JSR's per-version
// metadata lists every published file, so we filter that manifest for
// `/skill/**`, download into a temp dir, then swap it into place — the old
// install is only removed once the new copy downloaded fully.
import { dirname, join } from "jsr:@std/path@^1";

const SCOPE = "mrg-keystone";
const PKG = "isolate";
const CLI_NAME = "isolate";
const JSR_BASE = `https://jsr.io/@${SCOPE}/${PKG}`;

/** The package's skill payload: manifest paths under /skill/. */
export function skillFiles(manifest: Record<string, unknown>): string[] {
  return Object.keys(manifest).filter((p) => p.startsWith("/skill/"));
}

/** Read `name:` from SKILL.md frontmatter, else the fallback. */
export function skillNameFrom(md: string, fallback: string): string {
  const m = md.match(/^name:\s*(\S+)/m);
  return m ? m[1] : fallback;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  // api.jsr.io asks tools to identify themselves (jsr.io/docs/api).
  const res = await fetch(url, {
    headers: {
      "user-agent": `mrg-keystone-isolate; https://jsr.io/@${SCOPE}/${PKG}`,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return await res.json();
}

export async function cmdUpdate(): Promise<void> {
  const home = Deno.env.get("HOME");
  if (!home) {
    console.error("✗ HOME not set — cannot locate ~/.claude/skills.");
    Deno.exit(1);
  }

  // The AUTHORITATIVE latest: jsr.io's CDN-cached meta.json lags new
  // releases by minutes, which would reinstall the previous version.
  const meta = await fetchJson(
    `https://api.jsr.io/scopes/${SCOPE}/packages/${PKG}`,
  );
  const latest = meta.latestVersion as string;
  console.log(`Latest published @${SCOPE}/${PKG}: ${latest}`);

  const vmeta = await fetchJson(`${JSR_BASE}/${latest}_meta.json`);
  const files = skillFiles(vmeta.manifest as Record<string, unknown>);
  if (!files.includes("/skill/SKILL.md")) {
    console.error(
      `✗ version ${latest} carries no skill (no /skill/SKILL.md in the ` +
        `package). Publish a version with the skill/ folder first.`,
    );
    Deno.exit(1);
  }

  const skillsRoot = join(home, ".claude", "skills");
  const tmp = join(skillsRoot, `.${PKG}-update-tmp`);
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
  await Deno.mkdir(tmp, { recursive: true });

  console.log(`Downloading ${files.length} skill file(s)…`);
  for (const path of files) {
    const res = await fetch(`${JSR_BASE}/${latest}${path}`);
    if (!res.ok) {
      console.error(`✗ download failed: ${res.status} — ${path}`);
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      Deno.exit(1);
    }
    const dest = join(tmp, path.slice("/skill/".length));
    await Deno.mkdir(dirname(dest), { recursive: true });
    await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
  }

  const md = await Deno.readTextFile(join(tmp, "SKILL.md"));
  const name = skillNameFrom(md, "deno-fresh2");
  const target = join(skillsRoot, name);

  // Never delete a git checkout: the dev layout keeps the repo inside the
  // skill dir. Deleting it would destroy unpushed work — bail instead.
  for (const p of [join(target, ".git"), join(target, "isolate", ".git")]) {
    if (await Deno.lstat(p).catch(() => null)) {
      console.error(
        `✗ ${target} contains a git checkout (${p}).\n` +
          `  Refusing to delete it. Move the checkout elsewhere (and use ` +
          `'deno task install' for a dev symlink), then re-run.`,
      );
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      Deno.exit(1);
    }
  }

  // Replace the old install: a symlink is unlinked (never followed), a real
  // directory is removed recursively — only now that the new copy is complete.
  const old = await Deno.lstat(target).catch(() => null);
  if (old) {
    await Deno.remove(target, { recursive: old.isDirectory });
    console.log(`✓ removed previous install at ${target}`);
  }
  await Deno.rename(tmp, target);
  console.log(`✓ skill '${name}' ${latest} installed → ${target}`);

  console.log(`Refreshing the global '${CLI_NAME}' CLI…`);
  const { success } = await new Deno.Command("deno", {
    args: [
      "install",
      "-gA",
      "-f",
      "-n",
      CLI_NAME,
      `jsr:@${SCOPE}/${PKG}@${latest}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!success) {
    console.error(
      `✗ CLI refresh failed. Retry with:\n` +
        `    deno install -gA -f -n ${CLI_NAME} jsr:@${SCOPE}/${PKG}@${latest}`,
    );
    Deno.exit(1);
  }
  console.log(`✓ '${CLI_NAME}' CLI at ${latest}. Update complete.`);
}
