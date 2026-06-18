// Provision ~/.isolate-runner with @playwright/test, rxjs, and the isolate-events
// helper (copied from lib/events/). Returns whether the runner is usable; when it
// isn't, the exact cause + fix are printed first — a broken runner must never
// surface as a cryptic spawn failure inside `isolate test` or a ▸ run button.
import { fromFileUrl } from "#std/path";
import { copy } from "#std/fs";

const EVENTS_DIR = fromFileUrl(new URL("./events", import.meta.url));

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRunner(): Promise<boolean> {
  const home = Deno.env.get("HOME");
  if (!home) {
    console.warn(
      "⚠ HOME is not set — can't set up the Playwright runner (~/.isolate-runner).\n" +
        "  ▸ run buttons and `isolate test` will fail until it is.",
    );
    return false;
  }
  const dir = `${home}/.isolate-runner`;
  const mods = `${dir}/node_modules`;
  await Deno.mkdir(dir, { recursive: true });

  let npmMissing = false;
  const npm = async (
    args: string[],
    io: "inherit" | "null",
  ): Promise<boolean> => {
    try {
      const r = await new Deno.Command("npm", {
        args,
        cwd: dir,
        stdout: io,
        stderr: io,
      }).output();
      return r.success;
    } catch {
      if (!npmMissing) {
        npmMissing = true;
        console.warn(
          "⚠ npm not found — the Playwright runner needs Node.js/npm installed.",
        );
      }
      return false;
    }
  };

  if (!(await pathExists(`${dir}/package.json`))) {
    await npm(["init", "-y"], "null");
  }

  // 1. @playwright/test, matched to the system playwright version when available.
  if (!(await pathExists(`${mods}/.bin/playwright`))) {
    console.log("Setting up the Playwright runner (one-time)…");
    let ver = "latest";
    try {
      const v = await new Deno.Command("playwright", {
        args: ["--version"],
        stdout: "piped",
        stderr: "null",
      }).output();
      const m = new TextDecoder().decode(v.stdout).match(/(\d+\.\d+\.\d+)/);
      if (m) ver = m[1];
    } catch { /* fall back to latest */ }
    await npm(["i", `@playwright/test@${ver}`], "inherit");
  }

  // 2. rxjs — the event-stream test helper depends on it.
  if (!(await pathExists(`${mods}/rxjs`))) {
    console.log("Installing rxjs for the event-stream test helper…");
    await npm(["i", "rxjs@^7"], "inherit");
  }

  // 3. The isolate-events helper (capture/waitHydrated), importable from specs as
  //    "isolate-events". Copied from lib/events/ (the published ./events subpath).
  await Deno.mkdir(mods, { recursive: true });
  await Deno.remove(`${mods}/isolate-events`, { recursive: true }).catch(
    () => {},
  );
  await copy(EVENTS_DIR, `${mods}/isolate-events`, { overwrite: true });

  // Verify what actually landed; one consolidated warning naming the gap + fix.
  const missing: string[] = [];
  if (!(await pathExists(`${mods}/.bin/playwright`))) {
    missing.push("@playwright/test");
  }
  if (!(await pathExists(`${mods}/rxjs`))) missing.push("rxjs");
  if (missing.length) {
    console.warn(
      `⚠ Playwright runner incomplete — missing ${missing.join(" + ")}.\n` +
        "  ▸ run buttons and `isolate test` will fail until it's fixed:\n" +
        `    cd ${dir} && npm i ${
          missing.map((m) => (m === "rxjs" ? "rxjs@^7" : m)).join(" ")
        }`,
    );
    return false;
  }
  return true;
}
