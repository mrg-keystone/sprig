// Discovery: scan a Fresh project for components with an `isolate/` folder.
//
//   <component>/isolate/
//     fixture.json                 { category, folder, background?, controls }
//     cases/
//       <case>/
//         <case>.json              bare keys -> props; _keys -> special
//         tests/*.spec.ts          Playwright tests for this case
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
export type Root = "components" | "islands";

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
  route: string;
  tests: TestRef[];
}

export interface ComponentEntry {
  slug: string;
  label: string;
  kind: Kind;
  root: Root;
  dir: string;
  isolateDir: string;
  componentFile: string;
  exportName: string;
  category: string;
  folder: string;
  background?: string;
  controlDefs: Record<string, ControlDef>;
  cases: CaseDef[];
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
  let listing: AsyncIterable<Deno.DirEntry>;
  try {
    listing = Deno.readDir(root);
  } catch {
    return;
  }
  for await (const e of listing) {
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
  let label: string | undefined;
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k === "_name") label = String(v);
    else if (k === "_innerHtml") innerHtml = String(v);
    else if (k === "_signals") signals = v as Record<string, unknown>;
    else if (k.startsWith("_")) { /* unknown special — ignore */ }
    else props[k] = v;
  }
  return { props, innerHtml, signals, label };
}

async function findComponentFile(dir: string, exportName: string): Promise<string> {
  const tsx: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && /\.tsx?$/.test(e.name)) tsx.push(e.name);
  }
  const pick = tsx.find((n) => n.replace(/\.tsx?$/, "") === exportName) ??
    tsx.find((n) => n.replace(/\.tsx?$/, "").toLowerCase() === exportName.toLowerCase()) ??
    tsx[0];
  return `${dir}/${pick ?? ""}`;
}

async function collectTests(testsDir: string): Promise<TestRef[]> {
  const out: TestRef[] = [];
  if (!(await exists(testsDir))) return out;
  for await (const e of Deno.readDir(testsDir)) {
    if (e.isFile && /\.spec\.tsx?$/.test(e.name)) {
      out.push({ name: e.name.replace(/\.spec\.tsx?$/, ""), file: `${testsDir}/${e.name}` });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function collectCases(
  isolateDir: string,
  defs: Record<string, ControlDef>,
  category: string,
  folder: string,
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
      } catch { /* malformed — empty case */ }
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
      route: folder ? `/${category}/${folder}/${name}` : `/${category}/${name}`,
      tests: await collectTests(`${caseDir}/tests`),
    });
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return cases;
}

export async function discover(projectRoot: string): Promise<ComponentEntry[]> {
  const roots: Root[] = ["components", "islands"];
  const entries: ComponentEntry[] = [];

  for (const root of roots) {
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
        } catch { /* malformed fixture */ }
      }
      const category = String(fixture.category ?? label);
      const folder = String(fixture.folder ?? "");
      const controlDefs = parseControlDefs(fixture.controls);

      // Background: top-level `background`, or legacy `controls._background`.
      let background = typeof fixture.background === "string" ? fixture.background : undefined;
      if (!background && controlDefs._background) {
        const b = controlDefs._background as ControlDef & { value?: unknown };
        background = typeof b.value === "string" ? b.value : undefined;
      }
      delete controlDefs._background;

      entries.push({
        slug: rel.replaceAll("/", "__"),
        label,
        kind: root === "islands" ? "island" : "static",
        root,
        dir,
        isolateDir,
        componentFile: await findComponentFile(dir, exportName),
        exportName,
        category,
        folder,
        background,
        controlDefs,
        cases: await collectCases(isolateDir, controlDefs, category, folder),
      });
    }
  }

  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}
