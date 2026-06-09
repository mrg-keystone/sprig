// Discovery: scan a Fresh project for components/pages with an `isolate/` folder.
//
// Scanned roots: components/ + islands/ are single components (routed under
// /components/…); pages/ holds page compositions (routed under /pages/…).
//
//   <component-or-page>/isolate/
//     fixture.json                 { category, folder, background?, controls, components }
//     cases/
//       <case>/
//         <case>.json              bare keys -> props; _keys -> special
//         tests/*.spec.ts          Playwright tests for this case
//
// A preview route is a PAGE: the top-level component plus whatever sub-components
// it renders. `controls` declares widgets for the top-level component; `components`
// declares widgets for the sub-components ON the page, keyed by function name:
//   "components": { "Button": { "controls": { "disabled": { "type": "boolean" } } } }
// Declared once per component TYPE, but each rendered INSTANCE gets its own
// controls group — keyed by its `id` prop (e.g. Button #submit, Button #cancel),
// or shared per type when it has no id. A case's `_mocks[name].props` seeds the
// initial values. Edited live via the vnode hook.
//
// fixture.json `controls` DECLARES each control's widget (argTypes):
//   "variant": { "type": "select", "options": ["a","b"] }
//   "size":    { "type": "range", "min": 0, "max": 4, "step": 1 }
//   "count":   { "type": "range", "min": 0, "max": 20, "signal": true }
//   "disabled":{ "type": "boolean" }
// A control may carry a default `value`. Undeclared props fall back to a widget
// inferred from the case value's type.
//
// Case special keys: _name (label), _innerHtml (-> innerHTML), _signals (-> signals).

export type Kind = "static" | "island";
export type Root = "components" | "islands" | "pages";
/** What's being isolated: a single component (components/ + islands/) or a page (pages/). */
export type Target = "component" | "page";

export interface TestRef {
  name: string;
  file: string;
}

export interface ControlDef {
  type?: "select" | "range" | "color" | "boolean" | "number" | "text";
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  signal?: boolean;
  value?: unknown;
}

export interface CaseDef {
  name: string;
  label: string;
  jsonPath: string;
  props: Record<string, unknown>;
  innerHtml?: string;
  signals?: Record<string, unknown>;
  mocks?: Record<string, unknown>;
  route: string;
  tests: TestRef[];
}

export interface ComponentEntry {
  slug: string;
  label: string;
  kind: Kind;
  root: Root;
  target: Target;
  dir: string;
  isolateDir: string;
  componentFile: string;
  exportName: string;
  category: string;
  folder: string;
  background?: string;
  controlDefs: Record<string, ControlDef>;
  /** Per-sub-component control widgets, keyed by the sub-component's function name. */
  subControlDefs: Record<string, Record<string, ControlDef>>;
  cases: CaseDef[];
}

/** A config problem found during discovery — surfaced up front, not swallowed. */
export interface Problem {
  kind: "fixture-json" | "case-json" | "component-file";
  /** The offending file (fixture/case JSON) or component directory. */
  path: string;
  /** Human-readable explanation: a JSON parse message, or what resolution did. */
  detail: string;
}

export interface DiscoverResult {
  entries: ComponentEntry[];
  problems: Problem[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

function pascal(s: string): string {
  return s.split(/[-_\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

async function* walkDirs(root: string): AsyncGenerator<string> {
  // Deno.readDir errors lazily — a missing dir throws on first iteration, not on
  // the call — so the loop itself must be guarded (e.g. a project with no
  // components/ or no islands/).
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(root)) entries.push(e);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory) continue;
    const child = `${root}/${e.name}`;
    yield child;
    yield* walkDirs(child);
  }
}

/** Parse fixture.controls into control definitions (objects), or {value} for bare values. */
function parseControlDefs(raw: unknown): Record<string, ControlDef> {
  const defs: Record<string, ControlDef> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      defs[k] = (v && typeof v === "object" && !Array.isArray(v))
        ? v as ControlDef
        : { value: v };
    }
  }
  return defs;
}

/** A sensible initial value for a declared control that the case doesn't set. */
function controlDefault(def: ControlDef): unknown {
  if (def.value !== undefined) return def.value;
  switch (def.type) {
    case "boolean":
      return false;
    case "number":
    case "range":
      return def.min ?? 0;
    case "select":
      return def.options?.[0];
    case "color":
      return "#000000";
    default:
      return "";
  }
}

/** Split a case JSON: bare keys -> props, _name/_innerHtml/_signals -> special. */
function parseCaseValues(obj: Record<string, unknown>) {
  const props: Record<string, unknown> = {};
  let innerHtml: string | undefined;
  let signals: Record<string, unknown> | undefined;
  let mocks: Record<string, unknown> | undefined;
  let label: string | undefined;
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k === "_name") label = String(v);
    else if (k === "_innerHtml") innerHtml = String(v);
    else if (k === "_signals") signals = v as Record<string, unknown>;
    else if (k === "_mocks") mocks = v as Record<string, unknown>;
    else if (k.startsWith("_")) { /* unknown special — ignore */ }
    else props[k] = v;
  }
  return { props, innerHtml, signals, mocks, label };
}

async function findComponentFile(
  dir: string,
  exportName: string,
  problems: Problem[],
): Promise<string> {
  const tsx: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && /\.tsx?$/.test(e.name)) tsx.push(e.name);
  }
  const exact = tsx.find((n) => n.replace(/\.tsx?$/, "") === exportName);
  const ci = tsx.find((n) =>
    n.replace(/\.tsx?$/, "").toLowerCase() === exportName.toLowerCase()
  );
  const pick = exact ?? ci ?? tsx[0];
  // No exact or case-insensitive match: we either fall back to an arbitrary
  // .tsx (Vite then imports the wrong component) or find none (empty path → a
  // cryptic import error at preview time). Surface it now instead.
  if (!exact && !ci) {
    problems.push({
      kind: "component-file",
      path: dir,
      detail: pick
        ? `no file matching export "${exportName}" — falling back to ${pick}`
        : `no .tsx file for export "${exportName}"`,
    });
  }
  return `${dir}/${pick ?? ""}`;
}

async function collectTests(testsDir: string): Promise<TestRef[]> {
  const out: TestRef[] = [];
  if (!(await exists(testsDir))) return out;
  for await (const e of Deno.readDir(testsDir)) {
    if (e.isFile && /\.spec\.tsx?$/.test(e.name)) {
      out.push({
        name: e.name.replace(/\.spec\.tsx?$/, ""),
        file: `${testsDir}/${e.name}`,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function collectCases(
  isolateDir: string,
  defs: Record<string, ControlDef>,
  prefix: string,
  category: string,
  folder: string,
  problems: Problem[],
): Promise<CaseDef[]> {
  const casesDir = `${isolateDir}/cases`;
  const cases: CaseDef[] = [];
  if (!(await exists(casesDir))) return cases;
  for await (const e of Deno.readDir(casesDir)) {
    if (!e.isDirectory) continue;
    const name = e.name;
    const caseDir = `${casesDir}/${name}`;
    const jsonPath = `${caseDir}/${name}.json`;
    let raw: Record<string, unknown> = {};
    if (await exists(jsonPath)) {
      try {
        raw = JSON.parse(await Deno.readTextFile(jsonPath));
      } catch (e) {
        problems.push({
          kind: "case-json",
          path: jsonPath,
          detail: (e as Error).message,
        });
      }
    }
    const v = parseCaseValues(raw);
    const props = { ...v.props };
    const signals = { ...(v.signals ?? {}) };
    let innerHtml = v.innerHtml;

    // Seed every declared control so it shows in the panel (case values win).
    for (const [n, def] of Object.entries(defs)) {
      if (n === "_innerHtml") {
        if (innerHtml === undefined) innerHtml = String(def.value ?? "");
      } else if (def.signal) {
        if (!(n in signals)) signals[n] = controlDefault(def);
      } else if (!(n in props)) {
        props[n] = controlDefault(def);
      }
    }

    cases.push({
      name,
      label: v.label ?? name,
      jsonPath,
      props,
      signals,
      innerHtml,
      mocks: v.mocks,
      route: folder
        ? `/${prefix}/${category}/${folder}/${name}`
        : `/${prefix}/${category}/${name}`,
      tests: await collectTests(`${caseDir}/tests`),
    });
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return cases;
}

export async function discover(projectRoot: string): Promise<DiscoverResult> {
  // components/ + islands/ hold single components; pages/ holds page compositions.
  const roots: { dir: Root; target: Target }[] = [
    { dir: "components", target: "component" },
    { dir: "islands", target: "component" },
    { dir: "pages", target: "page" },
  ];
  const entries: ComponentEntry[] = [];
  const problems: Problem[] = [];

  for (const { dir: root, target } of roots) {
    const prefix = target === "page" ? "pages" : "components";
    const rootAbs = `${projectRoot}/${root}`;
    for await (const dir of walkDirs(rootAbs)) {
      const rel = dir.slice(rootAbs.length + 1);
      // Skip the isolate/ folder itself and anything inside it — checked relative
      // to the scan root, so an "isolate" ancestor in the abs path doesn't match.
      if (rel.split("/").includes("isolate")) continue;
      const isolateDir = `${dir}/isolate`;
      if (!(await exists(isolateDir))) continue;

      const label = rel.split("/").pop() ?? rel;
      const exportName = pascal(label);

      let fixture: Record<string, unknown> = {};
      const fixturePath = `${isolateDir}/fixture.json`;
      if (await exists(fixturePath)) {
        try {
          fixture = JSON.parse(await Deno.readTextFile(fixturePath));
        } catch (e) {
          problems.push({
            kind: "fixture-json",
            path: fixturePath,
            detail: (e as Error).message,
          });
        }
      }
      const category = String(fixture.category ?? label);
      const folder = String(fixture.folder ?? "");
      const controlDefs = parseControlDefs(fixture.controls);

      // Per-sub-component controls: fixture.components[name].controls.
      const subControlDefs: Record<string, Record<string, ControlDef>> = {};
      if (fixture.components && typeof fixture.components === "object") {
        for (
          const [name, spec] of Object.entries(
            fixture.components as Record<string, unknown>,
          )
        ) {
          const ctrls =
            (spec && typeof spec === "object" && !Array.isArray(spec))
              ? (spec as { controls?: unknown }).controls
              : spec; // allow the bare-controls shorthand: "Button": { "disabled": {...} }
          subControlDefs[name] = parseControlDefs(ctrls);
        }
      }

      // Background: top-level `background`, or legacy `controls._background`.
      let background = typeof fixture.background === "string"
        ? fixture.background
        : undefined;
      if (!background && controlDefs._background) {
        const b = controlDefs._background as ControlDef & { value?: unknown };
        background = typeof b.value === "string" ? b.value : undefined;
      }
      delete controlDefs._background;

      entries.push({
        // Root-qualified so a component and a page with the same name don't
        // collide on the generated preview-island filename.
        slug: `${root}__${rel.replaceAll("/", "__")}`,
        label,
        kind: root === "islands" ? "island" : "static",
        root,
        target,
        dir,
        isolateDir,
        componentFile: await findComponentFile(dir, exportName, problems),
        exportName,
        category,
        folder,
        background,
        controlDefs,
        subControlDefs,
        cases: await collectCases(
          isolateDir,
          controlDefs,
          prefix,
          category,
          folder,
          problems,
        ),
      });
    }
  }

  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  problems.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, problems };
}
