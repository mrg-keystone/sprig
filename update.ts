// `isolate update` — refresh this machine to the latest published release:
//   1. Re-download every bundled skill from the newest
//      jsr:@mrg-keystone/isolate version and install each at USER scope
//      (~/.claude/skills/<skill-name>), replacing whatever is there.
//   2. Reinstall the `isolate` CLI globally, pinned to that same version.
//
// The skills ship inside the package under `skills/<dir>/` (one skill per
// directory — prototype, ui-breakdown, deno-fresh2); JSR's per-version
// metadata lists every published file, so we group that manifest by skill
// dir, download each into a temp dir, then swap it into place — an old
// install is only removed once its new copy downloaded fully.
import { dirname, join } from "jsr:@std/path@^1";

const SCOPE = "mrg-keystone";
const PKG = "isolate";
const CLI_NAME = "isolate";
const JSR_BASE = `https://jsr.io/@${SCOPE}/${PKG}`;

/**
 * The package's skill payloads: manifest paths under /skills/, grouped by
 * skill directory name. Only groups that carry a SKILL.md count — anything
 * else under /skills/ is not an installable skill.
 */
export function skillGroups(
  manifest: Record<string, unknown>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const p of Object.keys(manifest)) {
    const m = p.match(/^\/skills\/([^/]+)\//);
    if (!m) continue;
    const files = groups.get(m[1]) ?? [];
    files.push(p);
    groups.set(m[1], files);
  }
  for (const [dir, files] of groups) {
    if (!files.includes(`/skills/${dir}/SKILL.md`)) groups.delete(dir);
  }
  return groups;
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

/** Download one skill's files and swap them into ~/.claude/skills/<name>. */
async function installSkill(
  skillsRoot: string,
  version: string,
  dir: string,
  files: string[],
): Promise<boolean> {
  const prefix = `/skills/${dir}/`;
  const tmp = join(skillsRoot, `.${PKG}-update-tmp-${dir}`);
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
  await Deno.mkdir(tmp, { recursive: true });

  console.log(`Downloading ${files.length} file(s) for '${dir}'…`);
  for (const path of files) {
    const res = await fetch(`${JSR_BASE}/${version}${path}`);
    if (!res.ok) {
      console.error(`✗ download failed: ${res.status} — ${path}`);
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      return false;
    }
    const dest = join(tmp, path.slice(prefix.length));
    await Deno.mkdir(dirname(dest), { recursive: true });
    await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
  }

  const md = await Deno.readTextFile(join(tmp, "SKILL.md"));
  const name = skillNameFrom(md, dir);
  const target = join(skillsRoot, name);

  // Never delete a git checkout: the dev layout keeps the repo inside the
  // skill dir. Deleting it would destroy unpushed work — skip instead.
  for (const p of [join(target, ".git"), join(target, "isolate", ".git")]) {
    if (await Deno.lstat(p).catch(() => null)) {
      console.error(
        `✗ ${target} contains a git checkout (${p}).\n` +
          `  Refusing to delete it — skipping '${name}'. Move the checkout ` +
          `elsewhere (and use 'deno task install' for dev symlinks), then re-run.`,
      );
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
      return false;
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
  console.log(`✓ skill '${name}' ${version} installed → ${target}`);
  return true;
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
  const groups = skillGroups(vmeta.manifest as Record<string, unknown>);
  if (groups.size === 0) {
    console.error(
      `✗ version ${latest} carries no skills (nothing under /skills/ in the ` +
        `package). Publish a version with the skills/ folder first.`,
    );
    Deno.exit(1);
  }

  const skillsRoot = join(home, ".claude", "skills");
  await Deno.mkdir(skillsRoot, { recursive: true });

  let failures = 0;
  for (const [dir, files] of groups) {
    if (!(await installSkill(skillsRoot, latest, dir, files))) failures++;
  }
  if (failures > 0) {
    console.error(`✗ ${failures} skill(s) failed to install.`);
    Deno.exit(1);
  }

  console.log(`Refreshing the global '${CLI_NAME}' CLI…`);
  const install = async (spec: string) => {
    const { success } = await new Deno.Command("deno", {
      args: ["install", "-gA", "-f", "-n", CLI_NAME, spec],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    return success;
  };
  if (await install(`jsr:@${SCOPE}/${PKG}@${latest}`)) {
    console.log(`✓ '${CLI_NAME}' CLI at ${latest}. Update complete.`);
    return;
  }
  // deno resolves jsr: versions via the CDN-cached package metadata, which
  // can lag a fresh release by hours — the pinned spec then fails even
  // though the version is live. Install what the CDN does offer instead of
  // failing the whole update; a later re-run picks up the pin.
  console.warn(
    `⚠ pinned install of ${latest} failed (the registry CDN is likely still ` +
      `propagating). Installing the newest version deno can see…`,
  );
  if (!(await install(`jsr:@${SCOPE}/${PKG}`))) {
    console.error(
      `✗ CLI refresh failed. Retry with:\n` +
        `    deno install -gA -f -n ${CLI_NAME} jsr:@${SCOPE}/${PKG}@${latest}`,
    );
    Deno.exit(1);
  }
  console.log(
    `✓ '${CLI_NAME}' CLI installed (pre-${latest} until the CDN catches up — ` +
      `re-run 'isolate update' later to pin ${latest}). Skills are at ${latest}.`,
  );
}
