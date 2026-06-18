// Materialize the ui/ template into ~/isolate/<project>: copy the static Fresh
// app, symlink the host's components/islands/pages, and generate the per-project
// parts (manifest, gallery routes, one preview island per component, one route
// per case). Ported from reference/scaffold.ts's setupApp — the only change is
// that the static files are COPIED from ui/ instead of written from inlined
// strings. Pure orchestration; not a keep endpoint (chicken-and-egg + Vite HMR).
import {
  type CaseDef,
  type ComponentEntry,
  type ControlDef,
  discover,
  type Problem,
} from "../../server/src/core/business/discover/mod.ts";
import { basename, dirname, fromFileUrl, relative } from "#std/path";
import { copy } from "#std/fs";

const UI_DIR = fromFileUrl(new URL("../../ui", import.meta.url));

// Static template files copied verbatim from ui/ (vite.config + manifest are
// generated per-project below, so they're excluded here).
const STATIC = [
  "deno.json",
  "main.ts",
  "client.ts",
  "utils.ts",
  "types.ts",
  "controls.tsx",
  "gallery.tsx",
  "routes/_app.tsx",
  "routes/index.tsx",
  "routes/(_islands)/Shell.tsx",
  "routes/(_islands)/RunTests.tsx",
  "routes/api/run.ts",
];

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function write(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

async function rmrf(p: string): Promise<void> {
  try {
    await Deno.remove(p, { recursive: true });
  } catch { /* already gone */ }
}

async function linkOrCopy(target: string, path: string): Promise<void> {
  try {
    await Deno.symlink(target, path, { type: "dir" });
    return;
  } catch (e) {
    if (Deno.build.os !== "windows") throw e;
  }
  try {
    await Deno.symlink(target, path, { type: "junction" });
    return;
  } catch { /* junction unavailable — fall through to a copy */ }
  console.warn(
    `⚠ couldn't symlink ${
      basename(target)
    }/ — copied it instead (a snapshot; ` +
      `re-run isolate to pick up source edits).`,
  );
  await copy(target, path, { overwrite: true });
}

function relImport(fromFile: string, toFile: string): string {
  let r = relative(dirname(fromFile), toFile);
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}

function pascal(s: string): string {
  return s.split(/[-_\s/]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

function viteConfig(appDir: string, hostRoot: string): string {
  return `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: {
    dedupe: ["preact", "preact/hooks", "preact/jsx-runtime", "@preact/signals", "@preact/signals-core"],
  },
  server: {
    port: 8321,
    strictPort: false,
    fs: { allow: [${JSON.stringify(appDir)}, ${JSON.stringify(hostRoot)}] },
  },
  plugins: [
    fresh({ ignore: [/node_modules/, new RegExp("/(islands|components|pages)/.*/isolate/")] }),
    tailwindcss(),
  ],
});
`;
}

function playwrightConfig(appDir: string, hostRoot: string): string {
  return `export default {
  testDir: ${JSON.stringify(hostRoot)},
  outputDir: ${JSON.stringify(`${appDir}/test-results`)},
  use: {
    baseURL: process.env.ISOLATE_BASE_URL || "http://localhost:8321",
    screenshot: "only-on-failure",
  },
  reporter: [["json"]],
  fullyParallel: true,
};
`;
}

function previewIsland(
  compImp: string,
  hostFile: string,
  exportName: string,
  controlsImp: string,
  defs: Record<string, ControlDef>,
  subDefs: Record<string, Record<string, ControlDef>>,
  background: string | undefined,
): string {
  return `import * as mod from "${compImp}";
import { Controls, IsoError } from "${controlsImp}";

const NAME = ${JSON.stringify(exportName)};
const FILE = ${JSON.stringify(hostFile)};
const Component = mod.default ?? (mod as Record<string, unknown>)[NAME];
const EXPORTS = (mod.default !== undefined ? ["default"] : [])
  .concat(Object.keys(mod).filter((k) => k !== "default"));
const DEFS = ${JSON.stringify(defs)};
const SUB_DEFS = ${JSON.stringify(subDefs)};
const BACKGROUND = ${JSON.stringify(background ?? "#ffffff")};

// deno-lint-ignore no-explicit-any
export default function Preview({ config }: { config: any }) {
  if (typeof Component !== "function") {
    return (
      <IsoError
        title={"can't render " + NAME}
        file={FILE}
        expected={'a default export or a named export "' + NAME + '"'}
        seen={EXPORTS}
      />
    );
  }
  return <Controls Component={Component} name={NAME} config={config} defs={DEFS} subDefs={SUB_DEFS} background={BACKGROUND} />;
}
`;
}

function missingFileIsland(
  controlsImp: string,
  hostDir: string,
  exportName: string,
): string {
  return `import { IsoError } from "${controlsImp}";

// deno-lint-ignore no-explicit-any
export default function Preview(_props: { config: any }) {
  return (
    <IsoError
      title={"can't render " + ${JSON.stringify(exportName)}}
      file={${JSON.stringify(hostDir)} + "/ (no .tsx file)"}
      expected={'a component file exporting "' + ${
    JSON.stringify(exportName)
  } + '" (default or named)'}
    />
  );
}
`;
}

function caseRoute(islandImp: string, c: CaseDef): string {
  const config = {
    props: c.props ?? {},
    signals: c.signals ?? {},
    innerHtml: c.innerHtml ?? null,
    mocks: c.mocks ?? {},
  };
  return `import Preview from "${islandImp}";

const CONFIG = ${JSON.stringify(config)};

export default function Route() {
  return (
    <div class="ctrl-page">
      <a class="iso-back" href="/" target="_top">← all components</a>
      <Preview config={CONFIG} />
    </div>
  );
}
`;
}

function galleryRoute(only: "component" | "page"): string {
  return `import { Gallery } from "../../gallery.tsx";

export default function Route() {
  return <Gallery only=${JSON.stringify(only)} />;
}
`;
}

export interface MaterializeResult {
  appDir: string;
  entries: ComponentEntry[];
  problems: Problem[];
  scaffolded: boolean;
}

/** Build/refresh the preview app for `hostRoot` under ~/isolate/<project>. */
export async function materialize(
  hostRoot: string,
): Promise<MaterializeResult> {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set; cannot locate ~/isolate");
  const appDir = `${home}/isolate/${basename(hostRoot)}`;
  const { entries, problems } = await discover(hostRoot);
  const scaffolded = !(await exists(`${appDir}/node_modules`));

  // 1. Copy the static ui/ template (refreshed every run so ui edits land).
  for (const f of STATIC) {
    await write(`${appDir}/${f}`, await Deno.readTextFile(`${UI_DIR}/${f}`));
  }
  await rmrf(`${appDir}/assets`);
  await copy(`${UI_DIR}/assets`, `${appDir}/assets`, { overwrite: true });
  await rmrf(`${appDir}/static`);
  await copy(`${UI_DIR}/static`, `${appDir}/static`, { overwrite: true });

  // 2. Install the app's deps once (nodeModulesDir: manual).
  if (scaffolded) {
    await new Deno.Command("deno", {
      args: ["install"],
      cwd: appDir,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
  }

  // 3. Symlink the host's source dirs (only the ones that exist).
  for (const dir of ["components", "islands", "pages"] as const) {
    await rmrf(`${appDir}/${dir}`);
    if (await exists(`${hostRoot}/${dir}`)) {
      await linkOrCopy(`${hostRoot}/${dir}`, `${appDir}/${dir}`);
    }
  }

  // 4. Per-project config.
  await write(`${appDir}/vite.config.ts`, viteConfig(appDir, hostRoot));
  await write(
    `${appDir}/playwright.config.ts`,
    playwrightConfig(appDir, hostRoot),
  );

  // 5. The manifest (typed; mirrors the ui/types Case + Problem shapes).
  const flatCases = entries.flatMap((e) =>
    e.cases.map((c) => ({
      target: e.target,
      category: e.category,
      folder: e.folder,
      component: e.label,
      name: c.name,
      label: c.label,
      route: c.route,
      kind: e.kind,
      tests: c.tests.map((t) => t.name),
      testFiles: c.tests.map((t) => t.file),
    }))
  );
  const flatProblems = problems.map((p) => ({
    kind: p.kind,
    path: p.path.startsWith(hostRoot + "/")
      ? p.path.slice(hostRoot.length + 1)
      : p.path,
    detail: p.detail,
  }));
  await write(
    `${appDir}/manifest.ts`,
    `import type { Case, Problem } from "./types.ts";\n\n` +
      `export const cases: Case[] = ${
        JSON.stringify(flatCases, null, 2)
      };\n\n` +
      `export const problems: Problem[] = ${
        JSON.stringify(flatProblems, null, 2)
      };\n`,
  );

  // 6. Flat-gallery fallback routes per target.
  await rmrf(`${appDir}/routes/components`);
  await rmrf(`${appDir}/routes/pages`);
  const targets = new Set(entries.map((e) => e.target));
  if (targets.has("component")) {
    await write(
      `${appDir}/routes/components/index.tsx`,
      galleryRoute("component"),
    );
  }
  if (targets.has("page")) {
    await write(`${appDir}/routes/pages/index.tsx`, galleryRoute("page"));
  }

  // 7. Per-component preview island + per-case route.
  for (const e of entries) {
    const islandFile = `${appDir}/routes/(_islands)/${
      pascal(e.slug)
    }Preview.tsx`;
    const hostRel = (p: string) =>
      p.startsWith(hostRoot + "/") ? p.slice(hostRoot.length + 1) : p;
    await write(
      islandFile,
      e.componentFile
        ? previewIsland(
          relImport(islandFile, e.componentFile.replace(hostRoot, appDir)),
          hostRel(e.componentFile),
          e.exportName,
          relImport(islandFile, `${appDir}/controls.tsx`),
          e.controlDefs,
          e.subControlDefs,
          e.background,
        )
        : missingFileIsland(
          relImport(islandFile, `${appDir}/controls.tsx`),
          hostRel(e.dir),
          e.exportName,
        ),
    );
    for (const c of e.cases) {
      const routeFile = `${appDir}/routes${c.route}.tsx`;
      await write(routeFile, caseRoute(relImport(routeFile, islandFile), c));
    }
  }

  return { appDir, entries, problems, scaffolded };
}
