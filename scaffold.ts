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

  // 4. Stylesheet + the shared controls component.
  await write(`${appDir}/assets/styles.css`, STYLES);
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
  // Shared gallery component + index routes: / (all), /components, /pages.
  await write(`${appDir}/gallery.tsx`, GALLERY_LIB);
  await write(`${appDir}/routes/index.tsx`, galleryRoute("../gallery.tsx"));
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
      <a class="iso-back" href="/">← all components</a>
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
