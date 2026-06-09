// Build (once) a real Fresh app under ~/isolate/<host-app-name>, symlink the
// host's components/ + islands/ into it, then generate: a category ▸ folder ▸
// case zippy gallery with a ▸ run button per case, one preview route per case
// (component + a LIVE, typed controls panel), and a /api/run endpoint that runs
// a case's Playwright tests against the live app. Cached between runs.
import { basename, dirname, relative } from "jsr:@std/path@^1";
import type { CaseDef, ComponentEntry, ControlDef } from "./discover.ts";

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

  // 2. Symlink the host's components/ + islands/ into place.
  for (const dir of ["components", "islands"] as const) {
    await rmrf(`${appDir}/${dir}`);
    await Deno.symlink(`${hostRoot}/${dir}`, `${appDir}/${dir}`);
  }

  // 3. vite.config — stock Fresh, plus: ignore isolate/ folders and fs.allow
  //    the host tree (symlink targets).
  await write(
    `${appDir}/vite.config.ts`,
    `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 8321,
    strictPort: false,
    fs: { allow: [${JSON.stringify(appDir)}, ${JSON.stringify(hostRoot)}] },
  },
  plugins: [
    fresh({ ignore: [/node_modules/, new RegExp("/(islands|components)/.*/isolate/")] }),
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
  use: { baseURL: process.env.ISOLATE_BASE_URL || "http://localhost:8321" },
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
  await write(
    `${appDir}/manifest.ts`,
    `export const cases = ${JSON.stringify(flatCases, null, 2)} as const;\n`,
  );
  await write(`${appDir}/routes/index.tsx`, GALLERY);

  for (const e of entries) {
    const islandFile = `${appDir}/routes/(_islands)/${pascal(e.slug)}Preview.tsx`;
    await write(
      islandFile,
      previewIsland(
        relImport(islandFile, e.componentFile.replace(hostRoot, appDir)),
        e.exportName,
        relImport(islandFile, `${appDir}/controls.tsx`),
        e.controlDefs,
        e.background,
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
 *  case config (values) plus this component's control defs + background. */
function previewIsland(
  compImp: string,
  exportName: string,
  controlsImp: string,
  defs: Record<string, ControlDef>,
  background: string | undefined,
): string {
  return `import * as mod from "${compImp}";
import { Controls } from "${controlsImp}";

const Component = (mod.default ?? mod[${JSON.stringify(exportName)}] ?? Object.values(mod).find((v) => typeof v === "function"));
const DEFS = ${JSON.stringify(defs)};
const BACKGROUND = ${JSON.stringify(background ?? "#ffffff")};

export default function Preview({ config }: { config: any }) {
  return <Controls Component={Component} config={config} defs={DEFS} background={BACKGROUND} />;
}
`;
}

/** A preview route: renders the component's island with this case's values. */
function caseRoute(islandImp: string, c: CaseDef): string {
  const config = {
    props: c.props ?? {},
    signals: c.signals ?? {},
    innerHtml: c.innerHtml ?? null,
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

/** POST /api/run { tests: string[] } -> runs those specs via the Playwright runner. */
function runEndpoint(runner: string, config: string, hostRoot: string): string {
  return `const RUNNER = ${JSON.stringify(runner)};
const PW_BIN = RUNNER + "/.bin/playwright";
const CONFIG = ${JSON.stringify(config)};
const HOST_ROOT = ${JSON.stringify(hostRoot)};

export const handler = {
  async POST(ctx: any) {
    let body: any = {};
    try { body = await ctx.req.json(); } catch (_e) { /* empty */ }
    const tests: string[] = Array.isArray(body.tests) ? body.tests : [];
    const specs = tests.filter((s) =>
      typeof s === "string" && s.startsWith(HOST_ROOT) && /\\.spec\\.tsx?$/.test(s)
    );
    if (!specs.length) {
      return Response.json({ ok: false, error: "no valid tests" }, { status: 400 });
    }
    const baseURL = new URL(ctx.req.url).origin;
    const out = await new Deno.Command(PW_BIN, {
      args: ["test", ...specs, "--config", CONFIG, "--reporter=json"],
      env: { ...Deno.env.toObject(), NODE_PATH: RUNNER, ISOLATE_BASE_URL: baseURL },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const results: { title: string; ok: boolean; error?: string }[] = [];
    try {
      const j = JSON.parse(new TextDecoder().decode(out.stdout));
      const walk = (s: any) => {
        (s.specs || []).forEach((sp: any) => {
          const err = (sp.tests || []).flatMap((t: any) => (t.results || []))
            .map((r: any) => r.error?.message).filter(Boolean)[0];
          results.push({ title: sp.title, ok: !!sp.ok, error: err });
        });
        (s.suites || []).forEach(walk);
      };
      (j.suites || []).forEach(walk);
    } catch { /* unparsable */ }

    return Response.json({
      ok: out.code === 0,
      results,
      error: results.length ? undefined : new TextDecoder().decode(out.stderr).slice(-400),
    });
  },
};
`;
}

const CONTROLS_LIB = `import { signal, useSignal } from "@preact/signals";
import { useMemo } from "preact/hooks";

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

export function Controls(props: { Component: any; config: any; defs?: any; background?: string }) {
  const { Component, config } = props;
  const defs = props.defs || {};
  const state = useSignal<Record<string, any>>({ ...(config.props || {}) });
  const html = useSignal<string | null>(config.innerHtml ?? null);
  const sigs = useMemo(() => {
    const m: Record<string, any> = {};
    for (const k of Object.keys(config.signals || {})) m[k] = signal(config.signals[k]);
    return m;
  }, []);

  const s = state.value;
  const compProps: Record<string, any> = {};
  for (const k of Object.keys(s)) compProps[k] = s[k];
  for (const k of Object.keys(sigs)) compProps[k] = sigs[k];
  if (html.value != null) compProps.dangerouslySetInnerHTML = { __html: html.value };

  const set = (k: string, v: any) => { state.value = { ...state.value, [k]: v }; };
  const propKeys = Object.keys(s);
  const sigKeys = Object.keys(sigs);
  const empty = propKeys.length === 0 && sigKeys.length === 0 && html.value == null;

  return (
    <div class="ctrl">
      <div class="ctrl-stage" style={"background:" + (props.background || "#ffffff")}>
        <Component {...compProps} />
      </div>
      <aside class="ctrl-panel">
        <h3 class="ctrl-title">controls</h3>
        {empty ? <p class="ctrl-empty">no editable props</p> : null}
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
      </aside>
    </div>
  );
}
`;

const RUN_ISLAND = `import { useSignal } from "@preact/signals";

export default function RunTests({ tests }: { tests: string[] }) {
  const status = useSignal("idle");
  const results = useSignal<{ title: string; ok: boolean; error?: string }[]>([]);
  const ok = useSignal<boolean | null>(null);

  if (!tests || tests.length === 0) {
    return <span class="iso-run iso-run--none">no tests</span>;
  }

  const run = async () => {
    status.value = "running";
    results.value = [];
    ok.value = null;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tests }),
      });
      const j = await res.json();
      results.value = j.results || [];
      ok.value = !!j.ok;
    } catch (_e) {
      ok.value = false;
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
              : <span class={"iso-dot " + (ok.value ? "ok" : "fail")}>{ok.value ? "✓ ok" : "✗ error"}</span>}
          </span>
        )
        : null}
    </span>
  );
}
`;

const APP_SHELL = `export default function App({ Component }: { Component: any }) {
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

const GALLERY = `import { cases } from "../manifest.ts";
import RunTests from "./(_islands)/RunTests.tsx";

function group(arr, key) {
  const m = {};
  for (const x of arr) (m[x[key]] = m[x[key]] || []).push(x);
  return m;
}

export default function Gallery() {
  const byCat = group(cases, "category");
  return (
    <main class="iso-gallery">
      <h1>isolate</h1>
      <p class="iso-sub">{cases.length + " case(s)"}</p>
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
    </main>
  );
}
`;

const STYLES = `@import "tailwindcss";
@source "../components";
@source "../islands";
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

.iso-back { position: fixed; top: 1rem; left: 1rem; z-index: 5; font-size: 0.75rem; text-decoration: none;
  padding: 0.35rem 0.7rem; border: 1px solid var(--iso-line); border-radius: 999px;
  background: rgba(255,255,255,0.8); backdrop-filter: blur(6px); }
.iso-back:hover { border-color: var(--iso-ink); }

/* live controls preview */
.ctrl-page { min-height: 100dvh; }
.ctrl { display: grid; grid-template-columns: 1fr 19rem; min-height: 100dvh; }
.ctrl-stage { display: grid; place-items: center; padding: 3.5rem 2rem; }
.ctrl-panel { border-left: 1px solid var(--iso-line); background: #fff;
  padding: 3.6rem 1.25rem 2rem; display: flex; flex-direction: column; gap: 0.9rem; }
.ctrl-title { margin: 0 0 0.3rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.5; }
.ctrl-empty { font-size: 0.75rem; opacity: 0.4; }
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
