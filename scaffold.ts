// Build (once) a real Fresh app under ~/isolate/<host-app-name>, symlink the
// host's components/ + islands/ into it, then generate: a category ▸ folder ▸
// case zippy gallery with a ▸ run button per case, one preview route per case
// (the case is a PAGE — the component plus the sub-components it renders — with a
// LIVE, typed controls panel grouped per component), and a /api/run endpoint that
// runs a case's Playwright tests against the live app. Cached between runs.
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "jsr:@std/path@^1";
import { copy } from "jsr:@std/fs@^1";
import type {
  CaseDef,
  ComponentEntry,
  ControlDef,
  Problem,
} from "./discover.ts";

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

/**
 * Link `target` → `path` as a directory symlink. On Windows a dir symlink needs
 * Developer Mode/admin, so fall back to a junction (no elevation, still a live
 * link), then — last resort — a recursive copy. The copy is a SNAPSHOT: source
 * edits won't live-reflect until isolate is re-run, so we warn when we use it.
 */
async function linkOrCopy(target: string, path: string): Promise<void> {
  try {
    await Deno.symlink(target, path, { type: "dir" });
    return;
  } catch (e) {
    if (Deno.build.os !== "windows") throw e; // a real error on Unix — surface it
  }
  try {
    await Deno.symlink(target, path, { type: "junction" });
    return;
  } catch { /* junction unavailable — fall through to a copy */ }
  console.warn(
    `⚠ couldn't symlink ${
      basename(target)
    }/ (Windows without Developer Mode?) — ` +
      `copied it instead.\n  The preview is a snapshot: re-run isolate to pick up ` +
      `source edits, or enable Developer Mode for live links.`,
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

export interface SetupResult {
  appDir: string;
  scaffolded: boolean;
}

export async function setupApp(
  hostRoot: string,
  entries: ComponentEntry[],
  problems: Problem[] = [],
): Promise<SetupResult> {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set; cannot locate ~/isolate");
  const appDir = `${home}/isolate/${basename(hostRoot)}`;
  const runner = `${home}/.isolate-runner/node_modules`;

  // 1. Scaffold a real Fresh app once (reused on later runs).
  let scaffolded = false;
  if (!(await exists(`${appDir}/deno.json`))) {
    await Deno.mkdir(dirname(appDir), { recursive: true });
    const init = new Deno.Command("deno", {
      args: ["run", "-Ar", "jsr:@fresh/init", appDir, "--tailwind"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const { success } = await init.output();
    if (!success) throw new Error("`jsr:@fresh/init` failed");
    scaffolded = true;
  }

  // 1b. Ensure rxjs is in the app's import map — controls.tsx builds the event
  //     stream from it (and Vite bundles it for the browser, like the other npm:
  //     deps). The app uses nodeModulesDir:"manual", so it must also be installed.
  {
    const djPath = `${appDir}/deno.json`;
    try {
      const dj = JSON.parse(await Deno.readTextFile(djPath));
      dj.imports = dj.imports ?? {};
      if (dj.imports.rxjs !== "npm:rxjs@^7") {
        dj.imports.rxjs = "npm:rxjs@^7";
        await Deno.writeTextFile(djPath, JSON.stringify(dj, null, 2) + "\n");
      }
    } catch { /* leave the import map as-is */ }
    if (!(await exists(`${appDir}/node_modules/rxjs`))) {
      await new Deno.Command("deno", {
        args: ["install"],
        cwd: appDir,
        stdout: "inherit",
        stderr: "inherit",
      }).output();
    }
  }

  // 2. Link the host's components/ + islands/ + pages/ into place (only the ones
  //    that exist — a host need not have all three). A live symlink is ideal; on
  //    Windows without Developer Mode it falls back to a junction, then a copy.
  for (const dir of ["components", "islands", "pages"] as const) {
    await rmrf(`${appDir}/${dir}`);
    if (await exists(`${hostRoot}/${dir}`)) {
      await linkOrCopy(`${hostRoot}/${dir}`, `${appDir}/${dir}`);
    }
  }

  // 3. vite.config — stock Fresh, plus: ignore isolate/ folders and fs.allow
  //    the host tree (symlink targets).
  await write(
    `${appDir}/vite.config.ts`,
    `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Dedupe Preact so the host's symlinked islands/components share ONE preact
  // instance with the app. Without this the host code can resolve its own copy,
  // and controls.tsx's vnode hook (the mock layer) never sees its sub-components.
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
`,
  );

  // 4. Stylesheet (gallery/controls + the v0.4 shell) + the shared controls component.
  await write(`${appDir}/assets/styles.css`, STYLES + SHELL_STYLES);
  await write(`${appDir}/controls.tsx`, CONTROLS_LIB);

  // 5. Playwright config — testDir at the host root, baseURL injected per run.
  await write(
    `${appDir}/playwright.config.ts`,
    `export default {
  testDir: ${JSON.stringify(hostRoot)},
  outputDir: ${JSON.stringify(`${appDir}/test-results`)},
  use: {
    baseURL: process.env.ISOLATE_BASE_URL || "http://localhost:8321",
    screenshot: "only-on-failure",
  },
  reporter: [["json"]],
  fullyParallel: true,
};
`,
  );

  // 6. Routes: shell, gallery, run endpoint, run-button island, and — per
  //    component — a preview island; per case, a preview route.
  await rmrf(`${appDir}/routes`);
  await write(`${appDir}/routes/_app.tsx`, APP_SHELL);
  await write(`${appDir}/routes/(_islands)/RunTests.tsx`, RUN_ISLAND);
  await write(`${appDir}/routes/(_islands)/Shell.tsx`, SHELL_LIB);
  await write(
    `${appDir}/routes/api/run.ts`,
    runEndpoint(runner, `${appDir}/playwright.config.ts`, hostRoot),
  );

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
  // Config problems ship in the manifest so the GALLERY shows them — a `--force`
  // preview must say in the browser which components are broken, not look complete.
  const flatProblems = problems.map((p) => ({
    kind: p.kind,
    path: p.path.startsWith(hostRoot + "/")
      ? p.path.slice(hostRoot.length + 1)
      : p.path,
    detail: p.detail,
  }));
  await write(
    `${appDir}/manifest.ts`,
    `export const cases = ${JSON.stringify(flatCases, null, 2)} as const;\n\n` +
      `export const problems = ${
        JSON.stringify(flatProblems, null, 2)
      } as const;\n`,
  );
  // Shared gallery component + index routes. / is the v0.4 persistent shell
  // (navigator + stage); /components and /pages keep the flat gallery as fallback.
  await write(`${appDir}/gallery.tsx`, GALLERY_LIB);
  await write(`${appDir}/routes/index.tsx`, shellRoute());
  const targets = new Set(entries.map((e) => e.target));
  if (targets.has("component")) {
    await write(
      `${appDir}/routes/components/index.tsx`,
      galleryRoute("../../gallery.tsx", "component"),
    );
  }
  if (targets.has("page")) {
    await write(
      `${appDir}/routes/pages/index.tsx`,
      galleryRoute("../../gallery.tsx", "page"),
    );
  }

  for (const e of entries) {
    const islandFile = `${appDir}/routes/(_islands)/${
      pascal(e.slug)
    }Preview.tsx`;
    const hostRel = (p: string) =>
      p.startsWith(hostRoot + "/") ? p.slice(hostRoot.length + 1) : p;
    // No component file at all (e.g. under --force): importing "" would crash the
    // whole Vite build — generate an island that just renders the error card.
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

  return { appDir, scaffolded };
}

/** Per-component island: imports the component, hands it to <Controls> with the
 *  case config (values) plus this component's control defs, the per-sub-component
 *  control defs (other components on the page), and background. */
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
// Resolution is default → named export, NOTHING ELSE. A first-exported-function
// fallback used to render the WRONG component silently, and a throw here used to
// kill the route — an unresolved export renders a visible error card instead.
const Component = mod.default ?? (mod as Record<string, unknown>)[NAME];
const EXPORTS = (mod.default !== undefined ? ["default"] : [])
  .concat(Object.keys(mod).filter((k) => k !== "default"));
const DEFS = ${JSON.stringify(defs)};
const SUB_DEFS = ${JSON.stringify(subDefs)};
const BACKGROUND = ${JSON.stringify(background ?? "#ffffff")};

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

/** Stand-in island for an entry with NO component file: importing one would crash
 *  the whole preview build, so the case renders an error card naming the gap. */
function missingFileIsland(
  controlsImp: string,
  hostDir: string,
  exportName: string,
): string {
  return `import { IsoError } from "${controlsImp}";

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

/** A preview route: renders the component's island with this case's values. */
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

/**
 * Which of the requested `tests` /api/run will actually execute: each must resolve
 * to a real `.spec` file INSIDE the host root. We resolve first (collapsing `..`)
 * and check containment with `relative`, so a crafted `${hostRoot}/../etc/x.spec.ts`
 * can't escape — the run endpoint spawns Playwright unauthenticated on localhost,
 * so it must only ever run the host's own tests. Exported so it's unit-tested; the
 * generated endpoint below inlines the identical logic (it can't import this module).
 */
export function filterSpecs(tests: unknown, hostRoot: string): string[] {
  if (!Array.isArray(tests)) return [];
  const root = resolve(hostRoot);
  return tests
    .filter((s): s is string => typeof s === "string")
    .map((s) => resolve(s))
    .filter((abs) => {
      const rel = relative(root, abs);
      const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      return inside && /\.spec\.tsx?$/.test(abs);
    });
}

/** POST /api/run { tests: string[] } -> runs those specs via the Playwright runner. */
function runEndpoint(runner: string, config: string, hostRoot: string): string {
  return `import { isAbsolute, relative, resolve } from "jsr:@std/path@^1";

const RUNNER = ${JSON.stringify(runner)};
const PW_BIN = RUNNER + "/.bin/playwright";
const CONFIG = ${JSON.stringify(config)};
const HOST_ROOT = resolve(${JSON.stringify(hostRoot)});
const RUNNER_FIX = "re-run \`isolate dev\` to install it, or: cd " +
  RUNNER.replace(/\\/node_modules$/, "") + " && npm i @playwright/test rxjs@^7";

const stripAnsi = (s: string) => s.replace(/\\u001b\\[[0-9;]*m/g, "");

// Only run real .spec files that resolve INSIDE the host root. Resolve first so a
// crafted "../" path can't escape — this endpoint spawns Playwright unauthenticated
// on localhost, so it must never run anything outside the host's own tests.
// (Mirror of scaffold.ts's exported filterSpecs(), which is unit-tested.)
// Returns null for a runnable spec, else WHY it was rejected — the run button
// shows the reason, so a failure never collapses to a bare "no valid tests".
async function specReason(s: unknown): Promise<string | null> {
  if (typeof s !== "string") return "not a file path";
  const abs = resolve(s);
  const rel = relative(HOST_ROOT, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return "outside the project root (" + HOST_ROOT + ")";
  }
  if (!/\\.spec\\.tsx?$/.test(abs)) return "not a .spec.ts/.spec.tsx file";
  try { await Deno.stat(abs); } catch { return "file not found"; }
  return null;
}

export const handler = {
  async POST(ctx: any) {
    let body: any = {};
    try { body = await ctx.req.json(); } catch (_e) { /* empty */ }
    const requested: unknown[] = Array.isArray(body.tests) ? body.tests : [];
    const specs: string[] = [];
    const rejected: string[] = [];
    for (const t of requested) {
      const why = await specReason(t);
      if (why === null) specs.push(resolve(t as string));
      else rejected.push(String(t) + " — " + why);
    }
    if (!specs.length) {
      return Response.json({
        ok: false,
        error: rejected.length
          ? "no runnable tests:\\n" + rejected.join("\\n")
          : "no tests requested",
      }, { status: 400 });
    }
    try { await Deno.stat(PW_BIN); } catch {
      return Response.json({
        ok: false,
        error: "Playwright runner missing at " + PW_BIN + " — " + RUNNER_FIX,
      }, { status: 500 });
    }
    const baseURL = new URL(ctx.req.url).origin;
    let out;
    try {
      out = await new Deno.Command(PW_BIN, {
        args: ["test", ...specs, "--config", CONFIG, "--reporter=json"],
        env: { ...Deno.env.toObject(), NODE_PATH: RUNNER, ISOLATE_BASE_URL: baseURL },
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (e) {
      return Response.json({
        ok: false,
        error: "couldn't start the Playwright runner (" + ((e as Error).message || e) +
          ") — " + RUNNER_FIX,
      }, { status: 500 });
    }

    const results: { title: string; ok: boolean; error?: string }[] = [];
    // Playwright reports per-spec failures under suites, but a spec that can't
    // even load (syntax error, bad import) lands in top-level \`errors\` — without
    // it a broken spec file reads as an empty, reasonless run.
    let topErrors: string[] = [];
    try {
      const j = JSON.parse(new TextDecoder().decode(out.stdout));
      topErrors = (j.errors || [])
        .map((e: any) => e && e.message).filter(Boolean)
        .map((m: any) => stripAnsi(String(m)));
      const walk = (s: any) => {
        (s.specs || []).forEach((sp: any) => {
          const err = (sp.tests || []).flatMap((t: any) => (t.results || []))
            .map((r: any) => r.error?.message).filter(Boolean)[0];
          results.push({ title: sp.title, ok: !!sp.ok, error: err ? stripAnsi(String(err)) : undefined });
        });
        (s.suites || []).forEach(walk);
      };
      (j.suites || []).forEach(walk);
    } catch { /* unparsable */ }

    const stderrTail = stripAnsi(new TextDecoder().decode(out.stderr)).trim().slice(-400);
    return Response.json({
      ok: out.code === 0,
      results,
      error: results.length ? undefined : (
        topErrors.join("\\n\\n") || stderrTail ||
        "Playwright produced no test results (exit " + out.code + ")"
      ),
    });
  },
};
`;
}

const CONTROLS_LIB =
  `import { batch, signal, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { options } from "preact";
import { filter, fromEvent, map, merge, Subject } from "rxjs";

// A LOUD stand-in for a component that can't render (missing file, unresolved
// export). The preview must never show a blank stage or a dead route — the card
// names the file, what was expected, and what the module actually exports.
export function IsoError(
  props: { title: string; file?: string; expected?: string; seen?: string[]; hint?: string },
) {
  return (
    <div class="iso-error">
      <h2 class="iso-error__title">⚠ {props.title}</h2>
      {props.file
        ? <p class="iso-error__row"><span class="iso-error__key">file</span><code>{props.file}</code></p>
        : null}
      {props.expected
        ? <p class="iso-error__row"><span class="iso-error__key">expected</span><code>{props.expected}</code></p>
        : null}
      {props.seen
        ? (
          <p class="iso-error__row">
            <span class="iso-error__key">exports seen</span>
            <code>{props.seen.length ? props.seen.join(", ") : "none"}</code>
          </p>
        )
        : null}
      <p class="iso-error__hint">{props.hint || "Fix the export (or the file name) and reload — \`isolate list\` shows every config problem."}</p>
    </div>
  );
}

// --- sub-component mock + control layer ---------------------------------------
// Every preview route is a PAGE: a top-level component and the sub-components it
// renders. We reach those sub-components via Preact's vnode hook (no rebuilds):
//   MOCKS[name]  — from _mocks: "stub" (placeholder) or { props } (forced props),
//                  applied to every instance of that component name.
//   SUB[key]     — LIVE prop overrides for ONE instance. Each instance of a
//                  DECLARED component gets its own controls group; the instance
//                  key is "Name#<id>" when it has an id prop, else just "Name"
//                  (so id-less instances of a type share a group).
// Instances are discovered by recording each declared component the hook sees.
let MOCKS: Record<string, any> = {};
let SUB: Record<string, any> = {};
let DECLARED: Record<string, any> = {};
const SEEN: { name: string; id: string | null; key: string }[] = [];
const STUBS = new Map<string, any>();
function stubFor(name: string) {
  if (!STUBS.has(name)) {
    STUBS.set(name, () => <span class="iso-stub" title={"mocked <" + name + ">"}>{name}</span>);
  }
  return STUBS.get(name);
}
const prevVnode = (options as any).vnode;
(options as any).vnode = (vnode: any) => {
  const t = vnode.type;
  if (typeof t === "function") {
    const name = t.displayName || t.name;
    if (name) {
      const m = MOCKS[name];
      let stubbed = false;
      if (m) {
        if (m === "stub" || m === true || m.stub) { vnode.type = stubFor(name); stubbed = true; }
        else if (m.props) vnode.props = { ...vnode.props, ...m.props };
      }
      // Track + inject per-INSTANCE controls for declared components.
      if (DECLARED[name] && !stubbed) {
        const id = vnode.props && vnode.props.id;
        const key = id != null ? name + "#" + id : name;
        if (!SEEN.some((s) => s.key === key)) SEEN.push({ name, id: id != null ? String(id) : null, key });
        const ov = SUB[key];
        if (ov) vnode.props = { ...vnode.props, ...ov };
      }
    }
  }
  if (prevVnode) prevVnode(vnode);
};
function setMocks(m: any) { MOCKS = m || {}; }
function setSub(s: any) { SUB = s || {}; }
function setDeclared(d: any) { DECLARED = d || {}; }

// --- event log ----------------------------------------------------------------
// Captured by delegation on the STAGE container (capture phase): it sees EVERY
// event from every element under test — never the controls panel — and records
// what each one carried (an input's value, the pressed key, a clicked label).
// High-frequency move/scroll/wheel events are left out so the log stays useful;
// the filter narrows the rest.
const STAGE_EVENTS = [
  "click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup",
  "pointerdown", "pointerup", "keydown", "keyup",
  "input", "change", "submit", "reset", "focusin", "focusout",
];
const EVENTS = signal<{ id: number; time: string; source: string; type: string; detail: string }[]>([]);
// Event-type names in first-seen order. Append-only and stable: a new type never
// reorders the existing checkboxes, so logging an event (e.g. a focusout fired by
// clicking a log control) can't shift a checkbox out from under an in-flight click.
const TYPES_SEEN = signal<string[]>([]);
const REGEXES = signal<string[]>([]); // active regex filters (AND), each applied to "source name detail"
const DRAFT = signal(""); // in-progress regex being typed
const HIDDEN = signal<Record<string, boolean>>({}); // event-type name -> hidden
let EVENT_SEQ = 0;
function pushEvent(evt: { time: string; source: string; type: string; detail: string }) {
  EVENT_SEQ += 1;
  EVENTS.value = [{ id: EVENT_SEQ, ...evt }, ...EVENTS.value].slice(0, 300);
  if (!TYPES_SEEN.value.includes(evt.type)) TYPES_SEEN.value = [...TYPES_SEEN.value, evt.type];
}
function describeEl(el: any): string {
  if (!el || !el.tagName) return "?";
  const tag = el.tagName.toLowerCase();
  return el.id ? tag + "#" + el.id : tag;
}
/** What the event carried: an input/checkbox value, the pressed key, or a label. */
function eventDetail(e: any, el: any): string {
  const ty = e.type;
  if (ty === "input" || ty === "change") {
    if (el && (el.type === "checkbox" || el.type === "radio")) return "checked=" + el.checked;
    return el && "value" in el ? JSON.stringify(el.value) : "";
  }
  if (ty === "keydown" || ty === "keyup") return e.key ? "key=" + e.key : "";
  const label = ((el && el.textContent) || "").replace(/\\s+/g, " ").trim();
  return label && label.length <= 40 ? JSON.stringify(label) : "";
}
// Only events on actual interactive controls are logged — never inert markup
// like the page wrapper div or a heading.
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]";
/** Map a raw DOM event to an IsolateEvent, or null if it isn't on an ENABLED control. */
function toIsolateEvent(e: any) {
  const tgt = e.target;
  const el = tgt && tgt.closest && tgt.closest(INTERACTIVE);
  if (!el) return null; // not a control
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return null; // disabled
  return { time: new Date().toLocaleTimeString(), source: describeEl(el), type: e.type, detail: eventDetail(e, el) };
}

// The page's event stream: ONE RxJS Observable of IsolateEvents. The UI renders
// from it, and (via the __isolateEmit hook) Playwright tests can observe it too.
const events$ = new Subject<{ time: string; source: string; type: string; detail: string }>();
(globalThis as any).__isolate = { events$ };

/** Wire stage DOM events into events$, and events$ into the UI + the test hook. */
function attachStageEvents(root: HTMLElement) {
  const domSub = merge(...STAGE_EVENTS.map((t) => fromEvent(root, t, { capture: true })))
    .pipe(map(toIsolateEvent), filter((x) => x != null))
    .subscribe((evt) => events$.next(evt as any));
  const sink = events$.subscribe((evt) => {
    pushEvent(evt);
    const g = globalThis as any;
    if (typeof g.__isolateEmit === "function") g.__isolateEmit(evt);
  });
  return () => { domSub.unsubscribe(); sink.unsubscribe(); };
}

function compileRegex(p: string): RegExp | null {
  try { return new RegExp(p, "i"); } catch { return null; }
}
function EventLog() {
  const all = EVENTS.value;
  const hidden = HIDDEN.value;
  const patterns = REGEXES.value;
  const res = patterns.map(compileRegex);

  // Event types seen so far (stable order), each toggleable via a checkbox.
  const types = TYPES_SEEN.value;

  const events = all.filter((e) => {
    if (hidden[e.type]) return false;
    const hay = e.source + " " + e.type + " " + e.detail;
    for (const re of res) if (re && !re.test(hay)) return false; // AND across patterns
    return true;
  });

  const addDraft = () => {
    const p = DRAFT.value.trim();
    if (p && !REGEXES.value.includes(p)) REGEXES.value = [...REGEXES.value, p];
    DRAFT.value = "";
  };
  const removeAt = (i: number) => { REGEXES.value = REGEXES.value.filter((_, j) => j !== i); };
  // Derive hidden from the checkbox's own checked state (not a stored toggle), so a
  // double-fired change event stays idempotent.
  const setHidden = (ty: string, hide: boolean) => { HIDDEN.value = { ...HIDDEN.value, [ty]: hide }; };

  return (
    <section class="iso-log">
      <header class="iso-log__head">
        <span class="iso-log__title">events</span>
        <span class="iso-log__count">{events.length + "/" + all.length}</span>
        <input
          class="iso-log__filter"
          placeholder="add regex…"
          value={DRAFT.value}
          onInput={(e) => { DRAFT.value = (e.currentTarget as HTMLInputElement).value; }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }}
        />
        <button class="iso-log__add" title="add regex filter" onClick={addDraft}>+</button>
        <span class="iso-log__chips">
          {patterns.map((p, i) => (
            <span class={"iso-log__chip" + (res[i] ? "" : " iso-log__chip--bad")} key={p} title={res[i] ? "" : "invalid regex"}>
              /{p}/
              <button class="iso-log__chip-x" title="remove" onClick={() => removeAt(i)}>×</button>
            </span>
          ))}
        </span>
        {all.length ? <button class="iso-log__clear" onClick={() => { EVENTS.value = []; TYPES_SEEN.value = []; }}>clear</button> : null}
      </header>
      {types.length
        ? (
          <div class="iso-log__types">
            {types.map((ty) => (
              <label class="iso-log__type" key={ty}>
                <input type="checkbox" checked={!hidden[ty]} onChange={(e) => setHidden(ty, !(e.currentTarget as HTMLInputElement).checked)} />
                {ty}
              </label>
            ))}
          </div>
        )
        : null}
      <ol class="iso-log__list">
        {events.length === 0
          ? <li class="iso-log__empty">{all.length ? "nothing matches the filter" : "no events yet — interact with the component"}</li>
          : null}
        {events.map((e) => (
          <li class="iso-log__row" key={e.id}>
            <span class="iso-log__time">{e.time}</span>
            <span class="iso-log__src">{e.source}</span>
            <span class="iso-log__name">{e.type}</span>
            {e.detail ? <span class="iso-log__detail">{e.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Initial value for a sub-component control the case doesn't set (mirrors discover's controlDefault). */
function widgetDefault(def: any) {
  if (def && def.value !== undefined) return def.value;
  switch (def && def.type) {
    case "boolean": return false;
    case "number":
    case "range": return (def && def.min != null) ? def.min : 0;
    case "select": return def && def.options ? def.options[0] : undefined;
    case "color": return "#000000";
    default: return "";
  }
}

/** Seed one instance's control values from its _mocks props (by name), else the widget default. */
function seedRow(defs: any, seed: any) {
  const row: Record<string, any> = {};
  const s = seed || {};
  for (const k of Object.keys(defs || {})) row[k] = (k in s) ? s[k] : widgetDefault(defs[k]);
  return row;
}

function widgetType(def: any, value: any) {
  if (def && def.type) return def.type;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

function Widget(props: { def?: any; value: any; onChange: (v: any) => void; textarea?: boolean }) {
  const { def, value, onChange } = props;
  const type = props.textarea ? "textarea" : widgetType(def, value);

  if (type === "select") {
    return (
      <select class="ctrl-input" value={value == null ? "" : String(value)}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        {((def && def.options) || []).map((o: any) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  }
  if (type === "range") {
    const min = def && def.min != null ? def.min : 0;
    const max = def && def.max != null ? def.max : 100;
    const step = def && def.step != null ? def.step : 1;
    return (
      <span class="ctrl-range">
        <input type="range" min={min} max={max} step={step} value={String(value ?? 0)}
          onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))} />
        <span class="ctrl-range__val">{String(value ?? 0)}</span>
      </span>
    );
  }
  if (type === "color") {
    return <input type="color" value={String(value ?? "#000000")}
      onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />;
  }
  if (type === "boolean") {
    return <input type="checkbox" checked={!!value}
      onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />;
  }
  if (type === "number") {
    return <input class="ctrl-input" type="number" value={String(value ?? 0)}
      onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))} />;
  }
  if (type === "textarea") {
    return <textarea class="ctrl-input ctrl-textarea" value={value == null ? "" : String(value)}
      onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)} />;
  }
  return <input class="ctrl-input" type="text" value={value == null ? "" : String(value)}
    onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />;
}

function Field(props: { label: string; children: any }) {
  return (
    <label class="ctrl-field">
      <span class="ctrl-field__label">{props.label}</span>
      {props.children}
    </label>
  );
}

function SignalField(props: { name: string; def?: any; sig: any }) {
  const v = props.sig.value; // reactive read
  return (
    <Field label={props.name + " · signal"}>
      <Widget def={props.def} value={v} onChange={(nv) => { props.sig.value = nv; }} />
    </Field>
  );
}

export function Controls(props: { Component: any; name?: string; config: any; defs?: any; subDefs?: any; background?: string }) {
  const { Component, config } = props;
  setMocks(config.mocks);
  const defs = props.defs || {};
  const subDefs = props.subDefs || {};
  setDeclared(subDefs); // tell the vnode hook which sub-components to track + inject
  const stageRef = useRef<HTMLDivElement>(null);
  const state = useSignal<Record<string, any>>({ ...(config.props || {}) });
  const html = useSignal<string | null>(config.innerHtml ?? null);
  const sigs = useMemo(() => {
    const m: Record<string, any> = {};
    for (const k of Object.keys(config.signals || {})) m[k] = signal(config.signals[k]);
    return m;
  }, []);
  // Live overrides keyed by instance key, plus the instances the stage actually
  // rendered. Both start empty; we fill them once the stage has mounted (below).
  const subState = useSignal<Record<string, any>>({});
  const instances = useSignal<{ name: string; id: string | null; key: string }[]>([]);
  const stageBump = useSignal(0); // stage remount key — bumped only on a control edit
  setSub(subState.value); // push current overrides before the component's children render

  // After mount the vnode hook has recorded every declared sub-component instance
  // the stage rendered (in SEEN). Surface them as controls groups and seed each
  // instance's controls from its _mocks props / widget defaults.
  useEffect(() => {
    if (!SEEN.length) return;
    const next = { ...subState.peek() };
    for (const inst of SEEN) {
      if (!next[inst.key]) {
        const seed = (config.mocks && config.mocks[inst.name] && config.mocks[inst.name].props) || {};
        next[inst.key] = seedRow(subDefs[inst.name], seed);
      }
    }
    batch(() => {
      instances.value = SEEN.slice();
      subState.value = next;
    });
  }, []);

  // Capture every event the stage fires (scoped to the stage container, so the
  // controls panel's own inputs never leak into the log). Once this effect has
  // run, the stage is mounted AND interactive — flag it so the waitHydrated()
  // test helper can wait for a click to actually do something (clicking before
  // hydration is a silent no-op).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const detach = attachStageEvents(el);
    (globalThis as any).__isolateReady = true;
    return () => { (globalThis as any).__isolateReady = false; detach(); };
  }, []);

  const s = state.value;
  const compProps: Record<string, any> = {};
  for (const k of Object.keys(s)) compProps[k] = s[k];
  for (const k of Object.keys(sigs)) compProps[k] = sigs[k];
  if (html.value != null) compProps.dangerouslySetInnerHTML = { __html: html.value };

  // Sub-component overrides are injected by the vnode hook, which only re-applies
  // when the component's children are recreated. @preact/signals skips re-rendering
  // a signal-using component on a parent render with equal props, so we remount the
  // stage (via a key bump) when a sub-control is edited. We bump ONLY on edits —
  // never on the initial seed — so the stage is never torn down mid-interaction.
  const stageKey = String(stageBump.value);

  const set = (k: string, v: any) => { state.value = { ...state.value, [k]: v }; };
  const setInst = (key: string, k: string, v: any) => {
    subState.value = { ...subState.value, [key]: { ...subState.value[key], [k]: v } };
    stageBump.value += 1;
  };

  // --- v0.4 shell bridge -----------------------------------------------------
  // When this preview is iframed by the shell, its panel + log are hidden (CSS,
  // via data-embed) and the parent dock drives controls/console instead. Post the
  // control surface + every stage event UP; apply control edits sent DOWN. The
  // (hidden) in-iframe Controls is still the single source of truth for the stage.
  const isEmbed = typeof window !== "undefined" && window.parent !== window;
  const buildInstances = () =>
    instances.value.map((inst) => ({
      key: inst.key,
      name: inst.name,
      id: inst.id,
      controls: Object.keys(subDefs[inst.name] || {}).map((k) => ({
        scope: "sub",
        instKey: inst.key,
        key: k,
        def: subDefs[inst.name][k],
        value: (subState.value[inst.key] || {})[k],
      })),
    }));
  useEffect(() => {
    if (!isEmbed) return;
    const post = (msg: any) => {
      try { window.parent.postMessage({ source: "isolate-stage", ...msg }, "*"); } catch (_e) { /* ignore */ }
    };
    const surface = () => {
      const controls: any[] = [];
      for (const k of Object.keys(state.value)) controls.push({ scope: "prop", key: k, def: defs[k] || null, value: state.value[k] });
      for (const k of Object.keys(sigs)) controls.push({ scope: "signal", key: k, def: defs[k] || null, value: sigs[k].value });
      return { name: props.name || "component", background: props.background || "#ffffff", html: html.value, controls, instances: buildInstances() };
    };
    const onMsg = (e: any) => {
      const d = e.data;
      if (!d || d.target !== "isolate-stage") return;
      if (d.type === "set") {
        if (d.scope === "prop") set(d.key, d.value);
        else if (d.scope === "signal" && sigs[d.key]) sigs[d.key].value = d.value;
        else if (d.scope === "html") html.value = d.value;
        else if (d.scope === "sub") setInst(d.instKey, d.key, d.value);
      } else if (d.type === "request") post({ type: "ready", ...surface() });
    };
    window.addEventListener("message", onMsg);
    const sub = events$.subscribe((evt) => post({ type: "event", payload: evt }));
    post({ type: "ready", ...surface() });
    return () => { window.removeEventListener("message", onMsg); sub.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!isEmbed) return;
    try { window.parent.postMessage({ source: "isolate-stage", type: "instances", instances: buildInstances() }, "*"); } catch (_e) { /* ignore */ }
  }, [instances.value]);

  const propKeys = Object.keys(s);
  const sigKeys = Object.keys(sigs);
  const insts = instances.value;
  const selfEmpty = propKeys.length === 0 && sigKeys.length === 0 && html.value == null;
  const empty = selfEmpty && insts.length === 0;

  return (
    <div class="ctrl">
      <div class="ctrl-stage" ref={stageRef} style={"background:" + (props.background || "#ffffff")}>
        <Component key={stageKey} {...compProps} />
      </div>
      <aside class="ctrl-panel">
        <h3 class="ctrl-title">controls</h3>
        {empty ? <p class="ctrl-empty">no editable props</p> : null}
        {!selfEmpty
          ? (
            <fieldset class="ctrl-group">
              <legend class="ctrl-group__legend">{props.name || "component"}</legend>
              {propKeys.map((k) => (
                <Field key={k} label={k}>
                  <Widget def={defs[k]} value={s[k]} onChange={(v) => set(k, v)} />
                </Field>
              ))}
              {sigKeys.map((k) => <SignalField key={k} name={k} def={defs[k]} sig={sigs[k]} />)}
              {html.value != null
                ? (
                  <Field label="_innerHtml">
                    <Widget textarea value={html.value} onChange={(v) => { html.value = v; }} />
                  </Field>
                )
                : null}
            </fieldset>
          )
          : null}
        {insts.map((inst) => (
          <fieldset class="ctrl-group" key={inst.key}>
            <legend class="ctrl-group__legend">{inst.id ? inst.name + " #" + inst.id : inst.name}</legend>
            {Object.keys(subDefs[inst.name] || {}).map((k) => (
              <Field key={k} label={k}>
                <Widget def={subDefs[inst.name][k]} value={subState.value[inst.key]?.[k]} onChange={(v) => setInst(inst.key, k, v)} />
              </Field>
            ))}
          </fieldset>
        ))}
      </aside>
      <EventLog />
    </div>
  );
}
`;

const RUN_ISLAND = `import { useSignal } from "@preact/signals";

export default function RunTests({ tests }: { tests: string[] }) {
  const status = useSignal("idle");
  const results = useSignal<{ title: string; ok: boolean; error?: string }[]>([]);
  const ok = useSignal<boolean | null>(null);
  const error = useSignal<string | null>(null);

  if (!tests || tests.length === 0) {
    return <span class="iso-run iso-run--none">no tests</span>;
  }

  const run = async () => {
    status.value = "running";
    results.value = [];
    ok.value = null;
    error.value = null;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tests }),
      });
      const j = await res.json();
      results.value = j.results || [];
      ok.value = !!j.ok;
      // A run with no per-test results carries its reason in j.error — keep it,
      // a bare "✗ error" tells the user nothing about what to fix.
      if (!j.ok && results.value.length === 0) {
        error.value = j.error || ("run failed (HTTP " + res.status + ")");
      }
    } catch (e) {
      ok.value = false;
      error.value = "couldn't reach /api/run — " + ((e as Error).message || e);
    }
    status.value = "done";
  };

  return (
    <span class="iso-run">
      <button class="iso-run__btn" onClick={run} disabled={status.value === "running"}>
        {status.value === "running" ? "running…" : "▸ run"}
      </button>
      {status.value === "done"
        ? (
          <span class="iso-run__results">
            {results.value.length
              ? results.value.map((r, i) => (
                <span key={i} class={"iso-dot " + (r.ok ? "ok" : "fail")} title={r.error || r.title}>
                  {r.ok ? "✓" : "✗"} {r.title}
                </span>
              ))
              : ok.value
              ? <span class="iso-dot ok">✓ ok</span>
              : (
                <span class="iso-dot fail iso-run__error" title={error.value || "error"}>
                  ✗ {(error.value || "error").split("\\n")[0]}
                </span>
              )}
          </span>
        )
        : null}
    </span>
  );
}
`;

const APP_SHELL =
  `export default function App({ Component }: { Component: any }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>isolate</title>
        {/* When this page is iframed by the v0.4 shell stage, mark it embed so the
            preview shows component-only (panel/log/back hidden, driven via the
            parent dock). Runs before paint, so there's no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.parent!==window)document.documentElement.setAttribute('data-embed','')}catch(e){}",
          }}
        />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
`;

/** A thin index route that renders the shared gallery, optionally filtered to one target. */
function galleryRoute(imp: string, only?: "component" | "page"): string {
  return `import { Gallery } from "${imp}";

export default function Route() {
  return <Gallery${only ? ` only="${only}"` : ""} />;
}
`;
}

const GALLERY_LIB = `import { cases, problems } from "./manifest.ts";
import RunTests from "./routes/(_islands)/RunTests.tsx";

function group(arr, key) {
  const m = {};
  for (const x of arr) (m[x[key]] = m[x[key]] || []).push(x);
  return m;
}

const TITLE = { component: "components", page: "pages" };

export function Gallery({ only }: { only?: "component" | "page" }) {
  const shown = only ? cases.filter((c) => c.target === only) : cases;
  const byTarget = group(shown, "target");
  const order = ["component", "page"];
  const targets = Object.keys(byTarget).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <main class="iso-gallery">
      <h1>isolate</h1>
      <p class="iso-sub">
        {only ? <a class="iso-sub__link" href="/">← all</a> : null}
        {only ? " · " : ""}
        {shown.length + " case(s)"}
      </p>
      {problems.length
        ? (
          <section class="iso-problems">
            <h2 class="iso-problems__title">⚠ {problems.length} config problem(s) — these previews are broken</h2>
            <ul class="iso-problems__list">
              {problems.map((p) => (
                <li class="iso-problems__row" key={p.path + p.detail}>
                  <code class="iso-problems__path">{p.path}</code>
                  <span class="iso-problems__detail">{p.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )
        : null}
      {targets.length === 0 ? <p class="ctrl-empty">nothing here yet</p> : null}
      {targets.map((target) => {
        const byCat = group(byTarget[target], "category");
        return (
          <section class="iso-target-sec" key={target}>
            <h2 class="iso-target"><a href={"/" + TITLE[target]}>{TITLE[target]}</a></h2>
            {Object.keys(byCat).sort().map((cat) => {
              const byFolder = group(byCat[cat], "folder");
              return (
                <details class="iso-zip" open key={cat}>
                  <summary class="iso-zip__head">{cat}</summary>
                  <div class="iso-zip__body">
                    {Object.keys(byFolder).sort().map((folder) => (
                      <details class="iso-zip iso-zip--sub" open key={folder}>
                        <summary class="iso-zip__head">{folder || "—"}</summary>
                        <ul class="iso-cases">
                          {byFolder[folder].map((c) => (
                            <li class="iso-case" key={c.route}>
                              <a class="iso-case__link" href={c.route}>{c.label}</a>
                              <span class={"iso-badge iso-badge--" + c.kind}>{c.kind}</span>
                              <RunTests tests={c.testFiles} />
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}
`;

/** A thin index route that renders the persistent shell island. */
function shellRoute(): string {
  return `import Shell from "./(_islands)/Shell.tsx";

export default function Route() {
  return <Shell />;
}
`;
}

// The v0.4 persistent shell: top bar + navigator + a stage that IFRAMES each
// case's existing preview route, plus a ⌘K command palette and toasts. It reuses
// the proven per-case routes untouched — it's chrome around them, not a rebuild.
// (The separated controls/console/tests dock is the next increment; it needs the
// controls.tsx postMessage bridge so the stage can render component-only.)
const SHELL_LIB = `import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { cases, problems } from "../../manifest.ts";

const SECTIONS = [
  { label: "Components", target: "component" },
  { label: "Pages", target: "page" },
];

function groupBy(arr, keyFn) {
  const m = {};
  for (const x of arr) (m[keyFn(x)] = m[keyFn(x)] || []).push(x);
  return m;
}

export default function Shell() {
  const all = cases;
  const active = useSignal(all.length ? all[0].route : "");
  const search = useSignal("");
  const collapsed = useSignal({});
  const palOpen = useSignal(false);
  const palQ = useSignal("");
  const palSel = useSignal(0);
  const toasts = useSignal([]);
  const bannerOpen = useSignal(problems.length > 0);
  const running = useSignal(false);
  const seq = useRef(0);
  const evSeq = useRef(0);
  const palInput = useRef(null);
  const frame = useRef(null);

  // dock + stage tools + the stage bridge (filled by postMessage from the iframe)
  const dockTab = useSignal("controls");
  const dockOpen = useSignal(true);
  const dockH = useSignal(280);
  const caseStatus = useSignal({});  // route -> "pass" | "fail" | "running"
  const vp = useSignal("fit");
  const zoom = useSignal(1);
  const grid = useSignal(false);
  const bg = useSignal("#ffffff");
  const kbd = useSignal(false);      // emulated mobile keyboard on/off
  const kbdMode = useSignal("ios");  // "ios" (overlay) | "android" (resize)
  const surface = useSignal(null);   // { name, background, html, controls, instances }
  const events = useSignal([]);      // bridged stage events
  const conQ = useSignal("");
  const conHidden = useSignal({});
  const tests = useSignal({ status: "idle", results: [], error: null });

  const toast = (tone, title, text) => {
    const id = ++seq.current;
    toasts.value = [...toasts.value, { id, tone, title, text }];
    setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 5000);
  };
  const activeCase = () => all.find((c) => c.route === active.value);
  const reset = () => { surface.value = null; events.value = []; tests.value = { status: "idle", results: [], error: null }; };
  const go = (route) => { if (route !== active.value) reset(); active.value = route; location.hash = route; palOpen.value = false; };

  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(location.hash.replace(/^#/, ""));
      if (h && h !== active.value && all.some((c) => c.route === h)) { reset(); active.value = h; }
    };
    fromHash();
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        palOpen.value = true; palQ.value = ""; palSel.value = 0;
      } else if (e.key === "Escape") palOpen.value = false;
    };
    addEventListener("hashchange", fromHash);
    addEventListener("keydown", onKey);
    return () => { removeEventListener("hashchange", fromHash); removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (palOpen.value && palInput.current) palInput.current.focus();
  }, [palOpen.value]);

  const q = search.value.trim().toLowerCase();
  const matches = (c) => !q || (c.category + " " + c.component + " " + c.label).toLowerCase().includes(q);
  const shown = all.filter(matches);

  const pq = palQ.value.trim().toLowerCase();
  const palItems = (!pq
    ? all
    : all.filter((c) => (c.component + " " + c.category + " " + c.label).toLowerCase().includes(pq))
  ).slice(0, 50);

  // Run one case's specs and reflect the verdict on its navigator dot.
  const runCase = async (c) => {
    if (!c.testFiles.length) return null;
    caseStatus.value = { ...caseStatus.value, [c.route]: "running" };
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tests: c.testFiles }) });
      const j = await res.json();
      const results = j.results || [];
      const pass = j.ok && results.length > 0 && results.every((r) => r.ok);
      caseStatus.value = { ...caseStatus.value, [c.route]: pass ? "pass" : "fail" };
      return { pass, results, error: (!j.ok && !results.length) ? (j.error || "run failed") : null };
    } catch (e) {
      caseStatus.value = { ...caseStatus.value, [c.route]: "fail" };
      return { pass: false, results: [], error: String((e && e.message) || e) };
    }
  };
  const runAll = async () => {
    const withTests = all.filter((c) => c.testFiles.length);
    if (!withTests.length) { toast("info", "No tests", "No spec files were discovered."); return; }
    running.value = true;
    let passed = 0;
    for (const c of withTests) { const r = await runCase(c); if (r && r.pass) passed++; }
    running.value = false;
    if (passed === withTests.length) toast("ok", "All cases passed", passed + "/" + withTests.length + " cases green.");
    else toast("fail", "Some cases failed", passed + "/" + withTests.length + " cases passed.");
  };

  // Drag the dock taller/shorter.
  const startDockResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dockH.value;
    const onMove = (ev) => { dockH.value = Math.max(120, Math.min(window.innerHeight - 160, startH + (startY - ev.clientY))); };
    const onUp = () => { removeEventListener("pointermove", onMove); removeEventListener("pointerup", onUp); };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  // Receive the stage's control surface + events from the iframe (the bridge in
  // controls.tsx posts them up when embedded).
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.source !== "isolate-stage") return;
      if (d.type === "ready") {
        surface.value = { name: d.name, background: d.background, html: d.html, controls: d.controls || [], instances: d.instances || [] };
        if (d.background) bg.value = d.background;
      } else if (d.type === "instances") {
        if (surface.value) surface.value = { ...surface.value, instances: d.instances || [] };
      } else if (d.type === "event") {
        events.value = [{ id: ++evSeq.current, ...d.payload }, ...events.value].slice(0, 300);
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, []);

  const sendSet = (msg) => {
    try {
      if (frame.current && frame.current.contentWindow) {
        frame.current.contentWindow.postMessage({ target: "isolate-stage", type: "set", ...msg }, "*");
      }
    } catch (_e) { /* ignore */ }
  };
  const editControl = (c, value) => {
    sendSet({ scope: c.scope, key: c.key, instKey: c.instKey, value });
    const s = surface.value;
    if (!s) return;
    const upd = (x) => (x.scope === c.scope && x.key === c.key && x.instKey === c.instKey) ? { ...x, value } : x;
    surface.value = { ...s, controls: s.controls.map(upd), instances: s.instances.map((inst) => ({ ...inst, controls: inst.controls.map(upd) })) };
  };

  const widget = (c, onChange) => {
    const def = c.def || {};
    const type = def.type || (typeof c.value === "boolean" ? "boolean" : typeof c.value === "number" ? "number" : "text");
    if (type === "select") {
      return (
        <select class="ci" value={c.value == null ? "" : String(c.value)} onChange={(e) => onChange(e.currentTarget.value)}>
          {(def.options || []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
      );
    }
    if (type === "range") {
      return (
        <span class="crange">
          <input type="range" min={def.min == null ? 0 : def.min} max={def.max == null ? 100 : def.max} step={def.step == null ? 1 : def.step}
            value={String(c.value == null ? 0 : c.value)} onInput={(e) => onChange(Number(e.currentTarget.value))} />
          <span class="val">{String(c.value == null ? 0 : c.value)}</span>
        </span>
      );
    }
    if (type === "color") return <input type="color" class="swatch" value={String(c.value == null ? "#000000" : c.value)} onInput={(e) => onChange(e.currentTarget.value)} />;
    if (type === "boolean") return <input type="checkbox" class="cbox" checked={!!c.value} onChange={(e) => onChange(e.currentTarget.checked)} />;
    if (type === "number") return <input type="number" class="ci" value={String(c.value == null ? 0 : c.value)} onInput={(e) => onChange(Number(e.currentTarget.value))} />;
    return <input type="text" class="ci" value={c.value == null ? "" : String(c.value)} onInput={(e) => onChange(e.currentTarget.value)} />;
  };

  const renderControlsTab = () => {
    const s = surface.value;
    if (!s) return <div class="ctrl-empty">Loading the stage…</div>;
    const hasHtml = s.html != null;
    if (!s.controls.length && !hasHtml && !s.instances.length) return <div class="ctrl-empty">no editable props</div>;
    return (
      <div class="ctrls-body">
        {(s.controls.length || hasHtml)
          ? (
            <div class="ctrl-group">
              <div class="ctrl-group__h">{s.name}</div>
              {s.controls.map((c) => (
                <div class="ctrl-row" key={c.scope + c.key}>
                  <label>{c.key}{c.scope === "signal" ? <span class="sig">signal</span> : null}</label>
                  {widget(c, (v) => editControl(c, v))}
                </div>
              ))}
              {hasHtml
                ? (
                  <div class="ctrl-row">
                    <label>_innerHtml</label>
                    <input class="ci" value={s.html} onInput={(e) => { const v = e.currentTarget.value; sendSet({ scope: "html", value: v }); surface.value = { ...surface.value, html: v }; }} />
                  </div>
                )
                : null}
            </div>
          )
          : null}
        {s.instances.map((inst) => (
          <div class="ctrl-group" key={inst.key}>
            <div class="ctrl-group__h">{inst.id ? inst.name + " #" + inst.id : inst.name}<span class="pill">instance</span></div>
            {inst.controls.map((c) => (
              <div class="ctrl-row" key={c.key}>
                <label>{c.key}</label>
                {widget(c, (v) => editControl(c, v))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderConsoleTab = () => {
    const list = events.value;
    const cq = conQ.value.trim().toLowerCase();
    const hidden = conHidden.value;
    const types = [...new Set(list.map((e) => e.type))];
    const visible = list.filter((e) => !hidden[e.type] && (!cq || (e.source + " " + e.type + " " + e.detail).toLowerCase().includes(cq)));
    return (
      <div class="con">
        <div class="con-head">
          <input class="con-filter" placeholder="filter…" value={conQ.value} onInput={(e) => { conQ.value = e.currentTarget.value; }} />
          <div class="con-types">
            {types.map((ty) => <button class={"con-type" + (hidden[ty] ? " off" : "")} key={ty} onClick={() => { conHidden.value = { ...hidden, [ty]: !hidden[ty] }; }}>{ty}</button>)}
          </div>
          <span class="con-count">{visible.length + " / " + list.length}</span>
          {list.length ? <button class="con-clear" onClick={() => { events.value = []; }}>clear</button> : null}
        </div>
        <div class="con-list">
          {visible.length === 0 ? <div class="con-empty">{list.length ? "nothing matches the filter" : "no events yet — interact with the component on the stage"}</div> : null}
          {visible.map((e) => (
            <div class="con-row" key={e.id}>
              <span class="con-time">{e.time}</span>
              <span class="con-src">{e.source}</span>
              <span class="con-type-c">{e.type}</span>
              <span class="con-detail">{e.detail}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTestsTab = () => {
    const c = activeCase();
    const files = c ? c.testFiles : [];
    const names = c ? c.tests : [];
    const t = tests.value;
    const run = async () => {
      if (!files.length || !c) return;
      tests.value = { status: "running", results: [], error: null };
      caseStatus.value = { ...caseStatus.value, [c.route]: "running" };
      try {
        const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tests: files }) });
        const j = await res.json();
        const results = j.results || [];
        const pass = j.ok && results.length > 0 && results.every((r) => r.ok);
        tests.value = { status: "done", results, error: (!j.ok && !results.length) ? (j.error || "run failed") : null };
        caseStatus.value = { ...caseStatus.value, [c.route]: pass ? "pass" : "fail" };
      } catch (e) {
        tests.value = { status: "done", results: [], error: String((e && e.message) || e) };
        caseStatus.value = { ...caseStatus.value, [c.route]: "fail" };
      }
    };
    return (
      <div class="tests">
        <div class="tests-bar">
          <button class="run-btn" onClick={run} disabled={!files.length || t.status === "running"}>{t.status === "running" ? "running…" : "▸ run tests"}</button>
          <span class="tests-summary">{files.length ? names.length + " spec(s) · " + files.length + " file(s)" : "no tests for this case"}</span>
        </div>
        {t.error ? <div class="spec-err"><span class="lbl">run error</span>{"\\n" + t.error}</div> : null}
        {t.results.length
          ? (
            <div class="spec-file">
              <div class="spec-file__h">results</div>
              {t.results.map((r, i) => <div class="spec" key={i}><span class={"ico " + (r.ok ? "pass" : "fail")}>{r.ok ? "✓" : "✗"}</span><span class="name">{r.title}</span></div>)}
            </div>
          )
          : (t.status !== "running" && !t.error && names.length
            ? (
              <div class="spec-file">
                <div class="spec-file__h">specs</div>
                {names.map((n, i) => <div class="spec" key={i}><span class="ico idle">○</span><span class="name">{n}</span></div>)}
              </div>
            )
            : null)}
      </div>
    );
  };

  // An emulated mobile keyboard tray. Purely visual + space-reserving: it shrinks
  // the iframe (a real viewport) so the component reflows as it would with a real
  // on-screen keyboard up. Not a functional input.
  const renderKeyboard = () => (
    <div class="kbd" aria-hidden="true">
      {[["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"]].map((row, i) => (
        <div class="kbd-row" key={i}>{row.map((k) => <span class="kbd-key" key={k}>{k}</span>)}</div>
      ))}
      <div class="kbd-row">
        <span class="kbd-key dark wide">⇧</span>
        {["z", "x", "c", "v", "b", "n", "m"].map((k) => <span class="kbd-key" key={k}>{k}</span>)}
        <span class="kbd-key dark wide">⌫</span>
      </div>
      <div class="kbd-row">
        <span class="kbd-key dark">123</span>
        <span class="kbd-key dark">🌐</span>
        <span class="kbd-key space">space</span>
        <span class="kbd-key return">return</span>
      </div>
    </div>
  );

  const cur = activeCase();

  return (
    <div id="app">
      <header class="topbar">
        <div class="brand"><span class="logo">◧</span><span>isolate</span><span class="ver">v0.4</span></div>
        <button class="kbd-search" onClick={() => { palOpen.value = true; palQ.value = ""; palSel.value = 0; }}>
          <span>⌕</span><span>Jump to a case…</span><span class="k">⌘K</span>
        </button>
        <div class="spacer"></div>
        <button class="tbtn" onClick={runAll} disabled={running.value}>
          <span class="dot"></span>{running.value ? "Running…" : "Run all tests"}
        </button>
      </header>

      <div class="body">
        <nav class="sidebar">
          <div class="sb-search">
            <input
              value={search.value}
              onInput={(e) => { search.value = e.currentTarget.value; }}
              placeholder="Filter components…  ( / )"
              autocomplete="off"
            />
          </div>
          <div class="sb-scroll">
            {shown.length === 0
              ? (
                <div class="sb-empty">
                  {all.length
                    ? "No cases match your filter."
                    : "No components yet. Drop an isolate/ folder next to any component to see it here."}
                </div>
              )
              : SECTIONS.map((sec) => {
                const inSec = shown.filter((c) => c.target === sec.target);
                if (!inSec.length) return null;
                const cats = groupBy(inSec, (c) => c.category);
                return (
                  <div class="sb-section" key={sec.target}>
                    <div class={"sb-section__h" + (sec.target === "component" ? " is-comp" : "")}>{sec.label}</div>
                    {Object.keys(cats).sort().map((cat) => {
                      const ck = sec.target + "/" + cat;
                      const isColl = !!collapsed.value[ck];
                      const comps = groupBy(cats[cat], (c) => c.component);
                      return (
                        <div class={"sb-cat" + (isColl ? " collapsed" : "")} key={ck}>
                          <button class="sb-cat__h" onClick={() => { collapsed.value = { ...collapsed.value, [ck]: !isColl }; }}>
                            <span class="sb-cat__caret">▸</span><span>{cat}</span><span class="sb-cat__count">{cats[cat].length}</span>
                          </button>
                          <div class="sb-cases">
                            {Object.keys(comps).sort().map((comp) => (
                              <div class="sb-comp-group" key={comp}>
                                <div class="sb-comp">{comp}</div>
                                {comps[comp].map((c) => (
                                  <button
                                    class={"sb-case" + (c.route === active.value ? " active" : "")}
                                    onClick={() => go(c.route)}
                                    key={c.route}
                                  >
                                    <span class="sb-case__label">{c.label}</span>
                                    <span class={"sb-case__status " + (caseStatus.value[c.route] || c.kind)} title={caseStatus.value[c.route] || c.kind}></span>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </nav>

        <main class="main">
          {bannerOpen.value && problems.length
            ? (
              <div class="banner">
                <span>⚠</span>
                <div>
                  <b>{problems.length} config problem(s)</b> — these previews are broken.
                  {problems.map((p) => <div key={p.path + p.detail}><code>{p.path}</code> {p.detail}</div>)}
                </div>
                <button class="x" onClick={() => { bannerOpen.value = false; }}>×</button>
              </div>
            )
            : null}
          <div class="stage-head">
            {cur
              ? (
                <div class="crumb">
                  <span class="seg">{cur.category}</span><span class="sep">/</span>
                  <span class="cur">{cur.component} · {cur.label}</span>
                  <span class={"kind " + cur.kind}>{cur.kind}</span>
                </div>
              )
              : <div class="crumb"><span class="seg">nothing selected</span></div>}
            <div class="stage-tools">
              <div class="seg-group">
                {["fit", "360", "768", "1024", "full"].map((v) => (
                  <button class={vp.value === v ? "on" : ""} key={v} onClick={() => { vp.value = v; }}>{v}</button>
                ))}
              </div>
              <button class={"tool-ico" + (kbd.value ? " on" : "")} title="toggle emulated mobile keyboard" onClick={() => { kbd.value = !kbd.value; }}>⌨</button>
              {kbd.value
                ? (
                  <div class="seg-group">
                    <button class={kbdMode.value === "ios" ? "on" : ""} title="iOS: overlay — keyboard floats over a full-height layout (reproduces the fixed-bar-hidden / content-under-keyboard bugs)" onClick={() => { kbdMode.value = "ios"; }}>iOS</button>
                    <button class={kbdMode.value === "android" ? "on" : ""} title="Android: resizes-content — the layout viewport actually shrinks" onClick={() => { kbdMode.value = "android"; }}>Android</button>
                  </div>
                )
                : null}
              <button class="tool-ico" title="zoom out" onClick={() => { zoom.value = Math.max(0.25, Math.round((zoom.value - 0.1) * 100) / 100); }}>−</button>
              <button class="tool-ico" title="reset zoom" onClick={() => { zoom.value = 1; }}>{Math.round(zoom.value * 100) + "%"}</button>
              <button class="tool-ico" title="zoom in" onClick={() => { zoom.value = Math.min(2, Math.round((zoom.value + 0.1) * 100) / 100); }}>+</button>
              <button class={"tool-ico" + (grid.value ? " on" : "")} title="toggle grid" onClick={() => { grid.value = !grid.value; }}>▦</button>
              <input type="color" class="swatch" title="stage background" value={bg.value} onInput={(e) => { bg.value = e.currentTarget.value; }} />
              {cur ? <a class="stage-open tool-ico" href={active.value} target="_blank" title="open this preview in its own tab">↗</a> : null}
            </div>
          </div>
          <div class={"stage-host" + (grid.value ? " grid" : "")} style={"background:" + bg.value}>
            {active.value
              ? (
                <div class={"stage-canvas" + (kbd.value ? " with-kbd " + (kbdMode.value === "android" ? "kbd-resize" : "kbd-overlay") : "")} style={"width:" + (vp.value === "fit" || vp.value === "full" ? "100%" : vp.value + "px") + ";transform:scale(" + zoom.value + ")"}>
                  <iframe ref={frame} class="stage-frame" key={active.value} src={active.value}></iframe>
                  {kbd.value ? renderKeyboard() : null}
                </div>
              )
              : <div class="stage-empty">Select a case from the navigator to preview it here.</div>}
          </div>

          <section class={"dock" + (dockOpen.value ? "" : " collapsed")} style={dockOpen.value ? "height:" + dockH.value + "px" : ""}>
            {dockOpen.value ? <div class="dock-resize" onPointerDown={startDockResize}></div> : null}
            <div class="dock-tabs">
              <button class={"dock-tab" + (dockTab.value === "controls" ? " on" : "")} onClick={() => { dockTab.value = "controls"; dockOpen.value = true; }}>controls</button>
              <button class={"dock-tab" + (dockTab.value === "console" ? " on" : "")} onClick={() => { dockTab.value = "console"; dockOpen.value = true; }}>
                console{events.value.length ? <span class="badge accent">{events.value.length}</span> : null}
              </button>
              <button class={"dock-tab" + (dockTab.value === "tests" ? " on" : "")} onClick={() => { dockTab.value = "tests"; dockOpen.value = true; }}>
                tests{cur && cur.tests.length ? <span class="badge">{cur.tests.length}</span> : null}
              </button>
              <button class="dock-collapse" title={dockOpen.value ? "collapse" : "expand"} onClick={() => { dockOpen.value = !dockOpen.value; }}>{dockOpen.value ? "▾" : "▴"}</button>
            </div>
            {dockOpen.value
              ? (
                <div class="dock-body">
                  {dockTab.value === "controls" ? renderControlsTab() : dockTab.value === "console" ? renderConsoleTab() : renderTestsTab()}
                </div>
              )
              : null}
          </section>
        </main>
      </div>

      {palOpen.value
        ? (
          <div class="palette-back" onClick={(e) => { if (e.target === e.currentTarget) palOpen.value = false; }}>
            <div class="palette">
              <input
                ref={palInput}
                placeholder="Jump to a case — type a component, category, or case name…"
                value={palQ.value}
                onInput={(e) => { palQ.value = e.currentTarget.value; palSel.value = 0; }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); palSel.value = Math.min(palSel.value + 1, palItems.length - 1); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); palSel.value = Math.max(palSel.value - 1, 0); }
                  else if (e.key === "Enter") { const it = palItems[palSel.value]; if (it) go(it.route); }
                  else if (e.key === "Escape") palOpen.value = false;
                }}
              />
              <div class="palette-list">
                {palItems.length === 0
                  ? <div class="pal-empty">No matches.</div>
                  : palItems.map((c, i) => (
                    <div
                      class={"pal-item" + (i === palSel.value ? " sel" : "")}
                      key={c.route}
                      onClick={() => go(c.route)}
                      onMouseEnter={() => { palSel.value = i; }}
                    >
                      <span>{c.component} · {c.label}</span>
                      <span class="crumbs">{c.category}</span>
                      <span class="pk">{c.kind}</span>
                    </div>
                  ))}
              </div>
              <div class="pal-foot">
                <span><span class="k">↑↓</span> navigate</span>
                <span><span class="k">↵</span> open</span>
                <span><span class="k">esc</span> close</span>
              </div>
            </div>
          </div>
        )
        : null}

      <div class="toasts">
        {toasts.value.map((t) => (
          <div class={"toast " + t.tone} key={t.id}>
            <div><div class="tt">{t.title}</div><div class="tx">{t.text}</div></div>
            <button class="x" onClick={() => { toasts.value = toasts.value.filter((x) => x.id !== t.id); }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

const SHELL_STYLES = `
/* ===== isolate shell (v0.4) — persistent navigator + iframed stage ===== */
:root {
  --ink: #17150f; --ink-2: #6b6453; --ink-3: #9b927c;
  --paper: #f3eee2; --surface: #fffdf8; --surface-2: #faf6ec;
  --line: #e4ddcc; --line-2: #d6ccb4;
  --accent: #c2410c; --accent-2: #9a3412; --accent-soft: #f7e7dd;
  --ok: #15803d; --fail: #b91c1c; --fail-soft: #fdeceb;
  --island: #7c3aed; --page: #a16207;
  --r: 8px; --r-sm: 6px; --r-lg: 12px;
  --shadow: 0 1px 2px rgba(23,21,15,.06), 0 8px 24px -12px rgba(23,21,15,.18);
  --shadow-lg: 0 12px 40px -12px rgba(23,21,15,.32);
  --sb-w: 250px;
}
html, body { height: 100%; }
*::-webkit-scrollbar { width: 9px; height: 9px; }
*::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
*::-webkit-scrollbar-thumb:hover { background: var(--ink-3); }

#app { height: 100vh; display: grid; grid-template-rows: auto 1fr; overflow: hidden;
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; font-size: 13px; line-height: 1.45;
  color: var(--ink); background: var(--paper); }
#app button { font: inherit; color: inherit; cursor: pointer; }

.topbar { display: flex; align-items: center; gap: 14px; padding: 0 14px; height: 48px;
  background: var(--surface); border-bottom: 1px solid var(--line); z-index: 30; }
.topbar .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; letter-spacing: -.02em; }
.topbar .logo { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); display: grid;
  place-items: center; color: #fff; font-size: 13px; box-shadow: inset 0 -2px 4px rgba(0,0,0,.18); }
.topbar .ver { font-size: 10px; color: var(--ink-3); font-weight: 500; letter-spacing: .04em;
  border: 1px solid var(--line); border-radius: 99px; padding: 1px 6px; }
.kbd-search { display: flex; align-items: center; gap: 8px; width: 260px; padding: 5px 9px;
  border: 1px solid var(--line); border-radius: var(--r); background: var(--surface-2); color: var(--ink-3); }
.kbd-search:hover { border-color: var(--line-2); background: #fff; }
.kbd-search .k { margin-left: auto; font-size: 10px; border: 1px solid var(--line); border-radius: 4px;
  padding: 1px 5px; background: #fff; color: var(--ink-2); }
.topbar .spacer { flex: 1; }
.tbtn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: #fff;
  border-radius: var(--r); padding: 6px 11px; font-size: 12px; }
.tbtn:hover { border-color: var(--accent); color: var(--accent); }
.tbtn:disabled { opacity: .6; }
.tbtn .dot { width: 7px; height: 7px; border-radius: 99px; background: var(--ok); }

.body { display: grid; grid-template-columns: var(--sb-w) 1fr; min-height: 0; position: relative; }

.sidebar { background: var(--surface); border-right: 1px solid var(--line); display: flex;
  flex-direction: column; min-height: 0; }
.sb-search { padding: 10px; border-bottom: 1px solid var(--line); }
.sb-search input { width: 100%; font: inherit; font-size: 12px; padding: 7px 10px; border: 1px solid var(--line);
  border-radius: var(--r); background: var(--surface-2); color: var(--ink); }
.sb-search input:focus { outline: none; border-color: var(--accent); background: #fff; box-shadow: 0 0 0 3px var(--accent-soft); }
.sb-scroll { overflow: auto; flex: 1; padding: 6px 6px 24px; }
.sb-section { margin-top: 10px; }
.sb-section:first-child { margin-top: 4px; }
.sb-section__h { font-size: 9.5px; text-transform: uppercase; letter-spacing: .16em; color: var(--page);
  padding: 4px 8px; font-weight: 700; }
.sb-section__h.is-comp { color: var(--accent); }
.sb-cat { margin: 1px 0; }
.sb-cat__h { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none;
  border: 0; padding: 5px 8px; border-radius: var(--r-sm); font-size: 12px; font-weight: 600; color: var(--ink); }
.sb-cat__h:hover { background: var(--surface-2); }
.sb-cat__caret { transition: transform .15s; color: var(--ink-3); font-size: 9px; width: 9px; display: inline-block; }
.sb-cat.collapsed .sb-cat__caret { transform: rotate(-90deg); }
.sb-cat__count { margin-left: auto; font-size: 10px; color: var(--ink-3); }
.sb-cat.collapsed .sb-cases { display: none; }
.sb-comp { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3);
  padding: 6px 8px 2px 22px; font-weight: 600; }
.sb-case { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none;
  border: 0; padding: 5px 8px 5px 24px; border-radius: var(--r-sm); font-size: 12px; color: var(--ink-2); position: relative; }
.sb-case:hover { background: var(--surface-2); color: var(--ink); }
.sb-case.active { background: var(--accent-soft); color: var(--accent-2); font-weight: 600; }
.sb-case.active::before { content: ""; position: absolute; left: 6px; top: 7px; bottom: 7px; width: 2.5px;
  border-radius: 99px; background: var(--accent); }
.sb-case__label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.sb-case__status { width: 7px; height: 7px; border-radius: 99px; flex: none; background: var(--line-2); }
.sb-case__status.island { background: var(--island); }
.sb-case__status.page { background: var(--page); }
.sb-empty { padding: 24px 14px; color: var(--ink-3); text-align: center; font-size: 12px; line-height: 1.6; }

.main { display: flex; flex-direction: column; min-height: 0; background: var(--paper); }
.stage-head { display: flex; align-items: center; gap: 12px; padding: 9px 14px; background: var(--surface);
  border-bottom: 1px solid var(--line); min-height: 46px; }
.crumb { display: flex; align-items: center; gap: 7px; font-size: 12px; min-width: 0; }
.crumb .seg { color: var(--ink-3); }
.crumb .sep { color: var(--ink-3); opacity: .6; }
.crumb .cur { font-weight: 700; color: var(--ink); }
.kind { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; padding: 2px 7px;
  border-radius: 99px; border: 1px solid var(--line); color: var(--ink-2); }
.kind.island { color: var(--island); }
.kind.page { color: var(--page); }
.kind.component { color: var(--accent); }
.stage-open { margin-left: auto; text-decoration: none; border: 1px solid var(--line); border-radius: var(--r);
  padding: 4px 9px; font-size: 12px; color: var(--ink-2); }
.stage-open:hover { border-color: var(--accent); color: var(--accent); }
.stage-host { flex: 1; min-height: 0; position: relative; background: var(--paper); }
.stage-frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.stage-empty { padding: 40px; text-align: center; color: var(--ink-3); }

.banner { display: flex; align-items: flex-start; gap: 10px; padding: 9px 14px; background: var(--fail-soft);
  border-bottom: 1px solid var(--fail); font-size: 12px; }
.banner b { color: var(--fail); }
.banner code { background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.banner .x { margin-left: auto; border: 0; background: none; color: var(--fail); font-size: 15px; line-height: 1; }

.palette-back { position: fixed; inset: 0; background: rgba(23,21,15,.34); backdrop-filter: blur(3px);
  display: grid; place-items: start center; padding-top: 14vh; z-index: 60; }
.palette { width: min(560px, 92vw); background: var(--surface); border: 1px solid var(--line-2);
  border-radius: var(--r-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.palette input { width: 100%; border: 0; border-bottom: 1px solid var(--line); background: none;
  padding: 15px 18px; font: inherit; font-size: 14px; color: var(--ink); }
.palette input:focus { outline: none; }
.palette-list { max-height: 46vh; overflow: auto; padding: 6px; }
.pal-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--r-sm);
  font-size: 13px; cursor: pointer; }
.pal-item .crumbs { color: var(--ink-3); font-size: 11px; }
.pal-item.sel { background: var(--accent-soft); }
.pal-item .pk { margin-left: auto; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); }
.pal-empty { padding: 24px; text-align: center; color: var(--ink-3); }
.pal-foot { display: flex; gap: 14px; padding: 9px 16px; border-top: 1px solid var(--line); font-size: 11px;
  color: var(--ink-3); background: var(--surface-2); }
.pal-foot .k { border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; background: #fff; color: var(--ink-2); }

.toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 9px;
  z-index: 70; width: 340px; }
.toast { display: flex; gap: 11px; align-items: flex-start; background: var(--surface); border: 1px solid var(--line-2);
  border-left: 3px solid var(--accent); border-radius: var(--r); box-shadow: var(--shadow-lg); padding: 11px 13px; font-size: 12px; }
.toast.ok { border-left-color: var(--ok); }
.toast.fail { border-left-color: var(--fail); }
.toast.info { border-left-color: var(--accent); }
.toast .tt { font-weight: 700; margin-bottom: 2px; }
.toast .tx { color: var(--ink-2); line-height: 1.5; }
.toast .x { margin-left: auto; border: 0; background: none; color: var(--ink-3); font-size: 15px; line-height: 1; }

/* ---- embedded preview: component-only stage (panel/log/back hidden) ---- */
html[data-embed] .iso-back { display: none; }
html[data-embed] .ctrl { grid-template-columns: 1fr; grid-template-rows: 1fr; min-height: 100dvh; }
html[data-embed] .ctrl-panel, html[data-embed] .iso-log { display: none; }
html[data-embed] .ctrl-stage { grid-row: 1; grid-column: 1; }

/* ---- stage tools (right of the breadcrumb) ---- */
.stage-tools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.seg-group { display: flex; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: #fff; }
.seg-group button { border: 0; background: none; padding: 5px 9px; font-size: 11px; color: var(--ink-2); border-right: 1px solid var(--line); }
.seg-group button:last-child { border-right: 0; }
.seg-group button:hover { background: var(--surface-2); }
.seg-group button.on { background: var(--accent-soft); color: var(--accent-2); font-weight: 600; }
.tool-ico { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 28px; padding: 0 6px;
  border: 1px solid var(--line); border-radius: var(--r); background: #fff; font-size: 12px; color: var(--ink-2); text-decoration: none; }
.tool-ico:hover { border-color: var(--accent); color: var(--accent); }
.tool-ico.on { background: var(--accent-soft); color: var(--accent-2); }
.swatch { width: 30px; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: var(--r); background: none; cursor: pointer; }
.swatch::-webkit-color-swatch-wrapper { padding: 2px; }
.swatch::-webkit-color-swatch { border: 0; border-radius: 4px; }

/* ---- stage host: a centered, sizeable canvas around the iframe ---- */
.stage-host { flex: 1; min-height: 0; overflow: auto; display: flex; justify-content: center; align-items: stretch; padding: 22px; }
.stage-host.grid { background-image: radial-gradient(var(--line-2) 1px, transparent 1px); background-size: 18px 18px; }
.stage-canvas { width: 100%; max-width: 100%; transform-origin: top center; transition: width .18s ease; align-self: stretch; }
.stage-frame { width: 100%; height: 100%; min-height: 480px; border: 0; background: #fff; border-radius: var(--r-lg);
  box-shadow: var(--shadow); display: block; }

/* ---- emulated mobile keyboard (toggle: iOS overlay / Android resize) ---- */
.stage-canvas.with-kbd { position: relative; }
/* Android resizes-content: the iframe actually shrinks, keyboard sits below it */
.stage-canvas.kbd-resize { display: flex; flex-direction: column; border-radius: var(--r-lg); box-shadow: var(--shadow); }
.stage-canvas.kbd-resize .stage-frame { flex: 1; min-height: 0; border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: none; }
/* iOS overlays-content: iframe keeps full height, keyboard floats OVER the bottom —
   a fixed bottom bar hides behind it and content runs under it (the real iOS bug) */
.stage-canvas.kbd-overlay .kbd { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2;
  box-shadow: 0 -8px 24px -10px rgba(0,0,0,.3); }
.kbd { background: #bdb5a3; padding: 9px 6px 16px; display: flex; flex-direction: column; gap: 7px;
  user-select: none; border-radius: 0 0 var(--r-lg) var(--r-lg); border-top: 1px solid rgba(0,0,0,.08); }
.kbd-row { display: flex; justify-content: center; gap: 5px; width: 100%; max-width: 460px; margin: 0 auto; }
.kbd-key { flex: 1; max-width: 36px; height: 38px; background: #fff; border-radius: 5px; display: grid;
  place-items: center; font-size: 14px; color: var(--ink); box-shadow: 0 1px 1px rgba(0,0,0,.25); }
.kbd-key.dark { background: #8d8676; color: #fff; font-size: 12px; }
.kbd-key.wide { max-width: 52px; }
.kbd-key.space { max-width: none; flex: 5; color: var(--ink-3); font-size: 11px; letter-spacing: .1em; }
.kbd-key.return { max-width: none; flex: 2; background: var(--accent); color: #fff; font-size: 11px; }

/* ---- dock (controls / console / tests) ---- */
.dock { position: relative; display: flex; flex-direction: column; height: 280px; min-height: 0; background: var(--surface); border-top: 1px solid var(--line); }
.dock.collapsed { height: auto; }
.dock-resize { position: absolute; top: -3px; left: 0; width: 100%; height: 6px; cursor: row-resize; z-index: 6; }
.dock-resize::after { content: ""; position: absolute; top: 2px; left: 50%; transform: translateX(-50%); width: 34px; height: 3px; border-radius: 99px; background: var(--line-2); }
.sb-case__status.pass { background: var(--ok); }
.sb-case__status.fail { background: var(--fail); }
.sb-case__status.running { background: var(--accent); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.dock-tabs { display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.dock-tab { position: relative; border: 0; background: none; padding: 9px 13px; font-size: 12px; color: var(--ink-2); font-weight: 600; display: flex; align-items: center; gap: 7px; }
.dock-tab:hover { color: var(--ink); }
.dock-tab.on { color: var(--accent-2); }
.dock-tab.on::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; background: var(--accent); border-radius: 99px; }
.dock-tab .badge { font-size: 10px; font-weight: 700; border-radius: 99px; padding: 1px 6px; background: var(--line); color: var(--ink-2); }
.dock-tab .badge.accent { background: var(--accent-soft); color: var(--accent-2); }
.dock-collapse { margin-left: auto; border: 0; background: none; color: var(--ink-3); padding: 8px 6px; font-size: 13px; }
.dock-collapse:hover { color: var(--ink); }
.dock-body { flex: 1; overflow: auto; min-height: 0; }

.ctrls-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; max-width: 720px; }
.ctrl-group { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface-2); padding: 11px 13px; }
.ctrl-group__h { font-size: 10px; font-weight: 700; letter-spacing: .04em; color: var(--accent); text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 7px; }
.ctrl-group__h .pill { font-size: 9px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 99px; padding: 1px 6px; text-transform: none; letter-spacing: 0; font-weight: 500; background: #fff; }
.ctrl-row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; align-items: center; padding: 5px 0; }
.ctrl-row label { font-size: 12px; color: var(--ink-2); }
.ctrl-row .sig { font-size: 9px; color: var(--island); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; margin-left: 5px; }
.ci { font: inherit; font-size: 12px; padding: 5px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); background: #fff; width: 100%; color: var(--ink); }
.ci:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.crange { display: flex; align-items: center; gap: 10px; }
.crange input[type=range] { flex: 1; accent-color: var(--accent); }
.crange .val { min-width: 2.5ch; text-align: right; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.cbox { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }

.con { display: flex; flex-direction: column; height: 100%; }
.con-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 2; }
.con-filter { font: inherit; font-size: 12px; width: 150px; padding: 5px 9px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
.con-filter:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.con-types { display: flex; gap: 5px; flex-wrap: wrap; }
.con-type { font-size: 11px; border: 1px solid var(--line); border-radius: 99px; padding: 2px 9px; background: #fff; color: var(--ink-2); }
.con-type.off { opacity: .4; text-decoration: line-through; }
.con-type:hover { border-color: var(--accent); }
.con-count { font-size: 11px; color: var(--ink-3); margin-left: auto; }
.con-clear { font-size: 11px; border: 1px solid var(--line); border-radius: var(--r-sm); background: #fff; padding: 4px 10px; color: var(--ink-2); }
.con-clear:hover { border-color: var(--accent); color: var(--accent); }
.con-list { padding: 4px 0; }
.con-row { display: grid; grid-template-columns: 96px 160px 90px 1fr; gap: 12px; padding: 5px 14px; font-size: 12px; border-bottom: 1px dotted var(--line); align-items: baseline; }
.con-row:hover { background: var(--surface-2); }
.con-time { color: var(--ink-3); font-variant-numeric: tabular-nums; font-size: 11px; }
.con-src { color: var(--accent); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.con-type-c { color: var(--ink); font-weight: 600; }
.con-detail { color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.con-empty { padding: 30px; text-align: center; color: var(--ink-3); }

.tests { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.tests-bar { display: flex; align-items: center; gap: 10px; }
.run-btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: var(--r); padding: 6px 13px; font-size: 12px; font-weight: 600; }
.run-btn:hover:not(:disabled) { background: var(--accent-2); }
.run-btn:disabled { opacity: .6; cursor: default; }
.tests-summary { font-size: 12px; color: var(--ink-2); }
.spec-file { border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
.spec-file__h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-2); font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--line); }
.spec { display: flex; align-items: center; gap: 9px; padding: 7px 12px; font-size: 12px; border-bottom: 1px dotted var(--line); }
.spec:last-child { border-bottom: 0; }
.spec .ico { width: 15px; text-align: center; }
.spec .ico.pass { color: var(--ok); }
.spec .ico.fail { color: var(--fail); }
.spec .ico.idle { color: var(--ink-3); }
.spec .name { flex: 1; color: var(--ink); }
.spec-err { background: var(--fail-soft); padding: 10px 14px; font-size: 11px; color: var(--ink); white-space: pre-wrap;
  border-radius: var(--r); border: 1px solid var(--fail); line-height: 1.6; }
.spec-err .lbl { color: var(--fail); font-weight: 700; }

@media (max-width: 760px) {
  .body { grid-template-columns: 1fr; }
  .sidebar { position: absolute; z-index: 40; height: 100%; width: 240px; box-shadow: var(--shadow-lg); }
}
`;

const STYLES = `@import "tailwindcss";
@source "../components";
@source "../islands";
@source "../pages";
@source "../routes";

:root { --iso-ink: #17150f; --iso-paper: #f7f3ea; --iso-line: #e4ddcc; --iso-accent: #c2410c;
  --iso-ok: #15803d; --iso-fail: #b91c1c; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--iso-ink); background: var(--iso-paper);
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; }
a { color: inherit; }

.iso-gallery { max-width: 60rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
.iso-gallery h1 { font-size: 2.1rem; letter-spacing: -0.04em; margin: 0; }
.iso-sub { margin: 0.3rem 0 2rem; opacity: 0.55; font-size: 0.8rem; }

.iso-target-sec { margin-top: 2.5rem; }
.iso-target-sec:first-of-type { margin-top: 0; }
.iso-target { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.18em;
  opacity: 0.5; margin: 0 0 0.4rem; color: var(--iso-accent); }
.iso-target a { text-decoration: none; }
.iso-target a:hover { text-decoration: underline; }
.iso-sub__link { text-decoration: none; border-bottom: 1px solid transparent; }
.iso-sub__link:hover { border-color: currentColor; }

.iso-zip { border-top: 1px solid var(--iso-line); }
.iso-zip__head { cursor: pointer; padding: 0.7rem 0; font-weight: 600; list-style: none;
  display: flex; align-items: center; gap: 0.55rem; user-select: none; }
.iso-zip__head::-webkit-details-marker { display: none; }
.iso-zip__head::before { content: "\\25B8"; opacity: 0.45; transition: transform 0.15s ease; }
.iso-zip[open] > .iso-zip__head::before { transform: rotate(90deg); }
.iso-zip__body { padding-left: 1.15rem; }
.iso-zip--sub { border-top: 0; }
.iso-zip--sub > .iso-zip__head { font-weight: 500; font-size: 0.9rem; opacity: 0.85;
  text-transform: uppercase; letter-spacing: 0.08em; }

.iso-cases { list-style: none; margin: 0 0 0.5rem; padding: 0; }
.iso-case { display: flex; align-items: center; gap: 0.7rem; padding: 0.4rem 0; }
.iso-case__link { font-weight: 600; text-decoration: none; border-bottom: 1.5px solid transparent; }
.iso-case__link:hover { border-color: var(--iso-ink); }
.iso-badge { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em;
  padding: 0.12em 0.5em; border-radius: 999px; border: 1px solid var(--iso-line); opacity: 0.75; }
.iso-badge--island { color: var(--iso-accent); border-color: currentColor; }

.iso-run { display: inline-flex; align-items: center; gap: 0.5rem; margin-left: auto; min-width: 0; }
.iso-run--none { opacity: 0.3; font-size: 0.7rem; margin-left: auto; }
.iso-run__btn { font: inherit; font-size: 0.7rem; cursor: pointer; border: 1px solid var(--iso-line);
  background: #fff; border-radius: 6px; padding: 0.22rem 0.6rem; transition: border-color 0.12s ease; }
.iso-run__btn:hover:not(:disabled) { border-color: var(--iso-ink); }
.iso-run__btn:disabled { opacity: 0.5; cursor: default; }
.iso-run__results { display: inline-flex; gap: 0.6rem; font-size: 0.7rem; }
.iso-dot.ok { color: var(--iso-ok); }
.iso-dot.fail { color: var(--iso-fail); }
/* the run failed before producing per-test results — show WHY, inline; the full
   text rides in the title attribute */
.iso-run__error { max-width: 24rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* config problems banner on the gallery (what --force is hiding) */
.iso-problems { margin: 0 0 2rem; padding: 0.8rem 1rem; border: 1px solid var(--iso-fail);
  border-radius: 8px; background: #fff5f5; }
.iso-problems__title { margin: 0 0 0.5rem; font-size: 0.8rem; color: var(--iso-fail); }
.iso-problems__list { margin: 0; padding: 0; list-style: none; }
.iso-problems__row { display: flex; flex-wrap: wrap; gap: 0.2rem 0.7rem; padding: 0.25rem 0;
  font-size: 0.75rem; border-top: 1px dotted var(--iso-line); }
.iso-problems__path { font-weight: 600; }
.iso-problems__detail { opacity: 0.75; }

/* error card: a component that can't render (missing file / unresolved export) */
.iso-error { max-width: 36rem; margin: 1rem; padding: 1.2rem 1.4rem; border: 1px dashed var(--iso-fail);
  border-radius: 10px; background: #fff5f5; color: var(--iso-ink); }
.iso-error__title { margin: 0 0 0.8rem; font-size: 1rem; color: var(--iso-fail); }
.iso-error__row { display: flex; gap: 0.7rem; margin: 0.3rem 0; font-size: 0.8rem; align-items: baseline; }
.iso-error__key { flex: 0 0 7rem; opacity: 0.55; font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: 0.1em; }
.iso-error__row code { word-break: break-all; }
.iso-error__hint { margin: 0.9rem 0 0; font-size: 0.75rem; opacity: 0.7; }

.iso-back { position: fixed; top: 1rem; left: 1rem; z-index: 5; font-size: 0.75rem; text-decoration: none;
  padding: 0.35rem 0.7rem; border: 1px solid var(--iso-line); border-radius: 999px;
  background: rgba(255,255,255,0.8); backdrop-filter: blur(6px); }
.iso-back:hover { border-color: var(--iso-ink); }

/* live controls preview */
.ctrl-page { min-height: 100dvh; }
.ctrl { display: grid; grid-template-columns: 1fr 19rem; grid-template-rows: minmax(0, 1fr) auto;
  min-height: 100dvh; }
.ctrl-stage { grid-column: 1; grid-row: 1; display: grid; place-items: center; padding: 3.5rem 2rem; }

/* event log — pinned under the stage. FIXED height: it must never resize the
   stage as rows arrive, or a logged pointerdown would shift the target out from
   under an in-flight click. Rows scroll inside instead. */
.iso-log { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; height: 16rem;
  background: #fff; border-top: 1px solid var(--iso-line); }
.iso-log__head { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem 0.55rem; padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--iso-line); }
.iso-log__title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.5; }
.iso-log__count { font-size: 0.7rem; opacity: 0.45; }
.iso-log__filter { font: inherit; font-size: 0.72rem; width: 8rem;
  padding: 0.15rem 0.5rem; border: 1px solid var(--iso-line); border-radius: 6px; background: var(--iso-paper); }
.iso-log__filter:focus { outline: 2px solid var(--iso-accent); outline-offset: -1px; }
.iso-log__add { font: inherit; font-size: 0.78rem; line-height: 1; cursor: pointer; border: 1px solid var(--iso-line);
  background: #fff; border-radius: 6px; padding: 0.15rem 0.5rem; }
.iso-log__add:hover { border-color: var(--iso-ink); }
.iso-log__chips { display: inline-flex; flex-wrap: wrap; gap: 0.3rem; }
.iso-log__chip { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.7rem;
  border: 1px solid var(--iso-line); border-radius: 999px; padding: 0.05rem 0.2rem 0.05rem 0.55rem; background: var(--iso-paper); }
.iso-log__chip--bad { border-color: var(--iso-fail); color: var(--iso-fail); }
.iso-log__chip-x { font: inherit; cursor: pointer; border: none; background: none; opacity: 0.6; padding: 0 0.25rem; }
.iso-log__chip-x:hover { opacity: 1; }
.iso-log__clear { margin-left: auto; font: inherit; font-size: 0.7rem; cursor: pointer;
  border: 1px solid var(--iso-line); background: #fff; border-radius: 6px; padding: 0.15rem 0.55rem; }
.iso-log__clear:hover { border-color: var(--iso-ink); }
.iso-log__types { display: flex; flex-wrap: wrap; gap: 0.15rem 0.7rem; padding: 0.35rem 1rem;
  border-bottom: 1px solid var(--iso-line); font-size: 0.7rem; }
.iso-log__type { display: inline-flex; align-items: center; gap: 0.25rem; opacity: 0.85; cursor: pointer; }
.iso-log__type input { margin: 0; }
.iso-log__list { margin: 0; padding: 0.4rem 1rem 0.8rem; list-style: none; overflow: auto;
  flex: 1; min-height: 0; font-size: 0.78rem; }
.iso-log__empty { opacity: 0.4; font-size: 0.75rem; padding: 0.35rem 0; }
.iso-log__row { display: flex; gap: 0.7rem; align-items: baseline; padding: 0.22rem 0;
  border-bottom: 1px dotted var(--iso-line); }
.iso-log__time { opacity: 0.45; font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.iso-log__src { color: var(--iso-accent); font-weight: 600; }
.iso-log__name { font-weight: 600; }
.iso-log__detail { opacity: 0.6; }
.iso-stub { display: inline-flex; align-items: center; padding: 0.4rem 0.7rem;
  font-size: 0.7rem; font-family: ui-monospace, monospace; color: #9a6b00;
  background: repeating-linear-gradient(45deg, #fdf6e3, #fdf6e3 6px, #faedcc 6px, #faedcc 12px);
  border: 1px dashed #d9b441; border-radius: 4px; }
.ctrl-panel { grid-column: 2; grid-row: 1 / 3; border-left: 1px solid var(--iso-line); background: #fff;
  padding: 3.6rem 1.25rem 2rem; display: flex; flex-direction: column; gap: 0.9rem; overflow: auto; }
.ctrl-title { margin: 0 0 0.3rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.5; }
.ctrl-empty { font-size: 0.75rem; opacity: 0.4; }
.ctrl-group { border: 1px solid var(--iso-line); border-radius: 8px; margin: 0; padding: 0.5rem 0.85rem 0.85rem;
  display: flex; flex-direction: column; gap: 0.9rem; }
.ctrl-group__legend { padding: 0 0.4rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
  color: var(--iso-accent); }
.ctrl-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; }
.ctrl-field__label { opacity: 0.7; }
.ctrl-input { font: inherit; font-size: 0.8rem; padding: 0.32rem 0.45rem; border: 1px solid var(--iso-line);
  border-radius: 6px; background: var(--iso-paper); width: 100%; }
.ctrl-input:focus { outline: 2px solid var(--iso-accent); outline-offset: -1px; }
.ctrl-textarea { min-height: 4.5rem; resize: vertical; }
.ctrl-range { display: flex; align-items: center; gap: 0.55rem; }
.ctrl-range input[type=range] { flex: 1; accent-color: var(--iso-accent); }
.ctrl-range__val { font-size: 0.75rem; min-width: 2.5ch; text-align: right; opacity: 0.7; }
input[type=color] { width: 2.6rem; height: 1.7rem; padding: 0; border: 1px solid var(--iso-line);
  border-radius: 6px; background: none; cursor: pointer; }
@media (max-width: 640px) { .ctrl { grid-template-columns: 1fr; } .ctrl-panel { border-left: 0; border-top: 1px solid var(--iso-line); } }
`;
