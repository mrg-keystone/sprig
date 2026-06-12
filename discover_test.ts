// Unit tests for discovery + route generation — fast, no browser. The
// fixtures/fresh-app/ project is the input; we assert the structured
// ComponentEntry[] directly. (Browser behavior — controls, event log, the test
// bridge — is covered by the Playwright specs run via
// `isolate test --root fixtures/fresh-app`.)
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { fromFileUrl } from "jsr:@std/path@^1";
import {
  type ComponentEntry,
  controlDefault,
  discover,
  parseCaseValues,
  parseControlDefs,
} from "./discover.ts";

const ROOT = fromFileUrl(new URL("./fixtures/fresh-app", import.meta.url));
const { entries, problems } = await discover(ROOT);
const by = (label: string): ComponentEntry => {
  const e = entries.find((x) => x.label === label);
  if (!e) {
    throw new Error(
      `no entry "${label}" (got: ${entries.map((x) => x.label).join(", ")})`,
    );
  }
  return e;
};
const caseOf = (e: ComponentEntry, name: string) => {
  const c = e.cases.find((x) => x.name === name);
  if (!c) throw new Error(`no case "${name}" on ${e.label}`);
  return c;
};

Deno.test("discovers components from components/ + islands/ and pages from pages/", () => {
  assertEquals(
    entries.map((e) => e.label).sort(),
    ["button", "counter", "float-button", "login"],
  );
});

Deno.test("target: components/islands are 'component', pages/ is 'page'", () => {
  assertEquals(by("button").target, "component");
  assertEquals(by("counter").target, "component");
  assertEquals(by("login").target, "page");
});

Deno.test("kind: islands hydrate, components/pages are static", () => {
  assertEquals(by("counter").kind, "island");
  assertEquals(by("button").kind, "static");
  assertEquals(by("login").kind, "static");
});

Deno.test("routes are namespaced by target: /components/… and /pages/…", () => {
  assertEquals(
    caseOf(by("counter"), "three").route,
    "/components/counter/default/three",
  );
  assertEquals(
    caseOf(by("button"), "primary").route,
    "/components/buttons/regular/primary",
  );
  assertEquals(
    caseOf(by("login"), "default").route,
    "/pages/login/auth/default",
  );
});

Deno.test("slugs are root-qualified (component vs page of same name can't collide)", () => {
  assertEquals(by("counter").slug, "islands__counter");
  assertEquals(by("button").slug, "components__button");
  assertEquals(by("login").slug, "pages__login");
});

Deno.test("top-level control defs: signal range, select with options, boolean", () => {
  const count = by("counter").controlDefs.count;
  assertEquals(count.type, "range");
  assertEquals(count.signal, true);
  const size = by("button").controlDefs.size;
  assertEquals(size.type, "select");
  assert(size.options?.includes("md"));
  assertEquals(by("button").controlDefs.disabled.type, "boolean");
});

Deno.test("per-sub-component control defs back the per-instance controls groups", () => {
  // fixture.components.Button.controls.disabled — declared once per type, one
  // group rendered per instance (by id) in the browser.
  assertEquals(by("counter").subControlDefs.Button.disabled.type, "boolean");
  assertEquals(by("login").subControlDefs.Button.disabled.type, "boolean");
});

Deno.test("_mocks parse into the case: stub placeholder + forced props", () => {
  assertEquals(caseOf(by("counter"), "stubbed").mocks, { Button: "stub" });
  assertEquals(caseOf(by("counter"), "disabled-subs").mocks, {
    Button: { props: { disabled: true } },
  });
});

Deno.test("signals vs props: _signals land in signals, bare keys in props", () => {
  const three = caseOf(by("counter"), "three");
  assertEquals(three.signals?.count, 3);
  const primary = caseOf(by("button"), "primary");
  assertEquals(primary.props.id, "primary");
  assertEquals(primary.innerHtml, "Click me");
});

Deno.test("tests are collected per case", () => {
  const three = caseOf(by("counter"), "three");
  const names = three.tests.map((t) => t.name).sort();
  assert(names.includes("count"));
  assert(names.includes("events"));
  assert(three.tests.every((t) => t.file.endsWith(".spec.ts")));
});

// --- config problems: surfaced up front, not swallowed -----------------------

Deno.test("the bundled fresh-app fixture is clean — no config problems", () => {
  assertEquals(problems, []);
});

/** Build a throwaway project: components/<name>/{<File>.tsx, isolate/...} and discover it. */
async function withProject(
  files: Record<string, string>,
  fn: (r: Awaited<ReturnType<typeof discover>>) => void | Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "isolate-test-" });
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = `${dir}/${rel}`;
      await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(path, content);
    }
    await fn(await discover(dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("malformed fixture.json is reported, not swallowed", async () => {
  await withProject({
    "components/widget/Widget.tsx": "export function Widget() { return null; }",
    "components/widget/isolate/fixture.json": '{ "category": "w", }', // trailing comma
  }, ({ problems }) => {
    const p = problems.find((x) => x.kind === "fixture-json");
    assert(
      p,
      `expected a fixture-json problem, got ${JSON.stringify(problems)}`,
    );
    assert(p.path.endsWith("widget/isolate/fixture.json"));
  });
});

Deno.test("malformed case JSON is reported with its path", async () => {
  await withProject({
    "components/widget/Widget.tsx": "export function Widget() { return null; }",
    "components/widget/isolate/fixture.json": "{}",
    "components/widget/isolate/cases/bad/bad.json": "{ not json",
  }, ({ problems }) => {
    const p = problems.find((x) => x.kind === "case-json");
    assert(p, `expected a case-json problem, got ${JSON.stringify(problems)}`);
    assert(p.path.endsWith("cases/bad/bad.json"));
  });
});

Deno.test("unresolved component file (export ≠ filename) is reported", async () => {
  await withProject({
    // folder "gadget" → export "Gadget", but the file is named "thing.tsx".
    "components/gadget/thing.tsx": "export function Gadget() { return null; }",
    "components/gadget/isolate/fixture.json": "{}",
  }, ({ problems }) => {
    const p = problems.find((x) => x.kind === "component-file");
    assert(
      p,
      `expected a component-file problem, got ${JSON.stringify(problems)}`,
    );
    assert(p.detail.includes("Gadget"));
    assert(p.detail.includes("thing.tsx"));
  });
});

Deno.test("a clean synthetic project reports zero problems", async () => {
  await withProject({
    "components/gadget/Gadget.tsx": "export function Gadget() { return null; }",
    "components/gadget/isolate/fixture.json": '{ "category": "g" }',
    "components/gadget/isolate/cases/ok/ok.json": '{ "_name": "OK" }',
  }, ({ entries, problems }) => {
    assertEquals(problems, []);
    assertEquals(entries.length, 1);
  });
});

// --- pure helpers (fast, no project) -----------------------------------------

Deno.test("parseControlDefs: object stays a ControlDef, bare/array value → {value}", () => {
  const d = parseControlDefs({
    variant: { type: "select", options: ["a", "b"] }, // object → kept as-is
    label: "hi", // bare value → { value: "hi" }
    tags: ["x", "y"], // array is not a ControlDef object → { value: [...] }
  });
  assertEquals(d.variant.type, "select");
  assert(d.variant.options?.includes("b"));
  assertEquals(d.label.value, "hi");
  assertEquals(d.tags.value, ["x", "y"]);
  // Non-object input is tolerated (no controls declared).
  assertEquals(parseControlDefs(undefined), {});
  assertEquals(parseControlDefs("nope"), {});
});

Deno.test("controlDefault: a sensible seed per widget type", () => {
  assertEquals(controlDefault({ type: "boolean" }), false);
  assertEquals(controlDefault({ type: "number" }), 0);
  assertEquals(controlDefault({ type: "number", min: 2 }), 2);
  assertEquals(controlDefault({ type: "range", min: 5 }), 5);
  assertEquals(controlDefault({ type: "select", options: ["a", "b"] }), "a");
  // Empty/missing options must NOT seed undefined — falls back to "".
  assertEquals(controlDefault({ type: "select" }), "");
  assertEquals(controlDefault({ type: "select", options: [] }), "");
  assertEquals(controlDefault({ type: "color" }), "#000000");
  assertEquals(controlDefault({ type: "text" }), "");
  assertEquals(controlDefault({}), "");
  // An explicit default value always wins over the type-based seed.
  assertEquals(controlDefault({ value: 42 }), 42);
  assertEquals(controlDefault({ type: "boolean", value: true }), true);
});

Deno.test("parseCaseValues: _specials are split out, unknown _keys ignored, bare keys → props", () => {
  const v = parseCaseValues({
    _name: "My Case",
    _innerHtml: "<b>hi</b>",
    _signals: { count: 3 },
    _mocks: { Button: "stub" },
    _whatever: "ignored", // unknown special — dropped, not a prop
    id: "primary", // bare key → prop
    disabled: true,
  });
  assertEquals(v.label, "My Case");
  assertEquals(v.innerHtml, "<b>hi</b>");
  assertEquals(v.signals, { count: 3 });
  assertEquals(v.mocks, { Button: "stub" });
  assertEquals(v.props, { id: "primary", disabled: true });
  assert(!("_whatever" in v.props));
  // An empty case is all-empty (no label, no specials).
  const empty = parseCaseValues({});
  assertEquals(empty.props, {});
  assertEquals(empty.label, undefined);
  assertEquals(empty.mocks, undefined);
});

Deno.test("sub-controls: full-form wrapper vs bare shorthand, and the 'controls' ambiguity", async () => {
  await withProject({
    "components/widget/Widget.tsx": "export function Widget() { return null; }",
    "components/widget/isolate/fixture.json": JSON.stringify({
      components: {
        // full form: explicit `controls` wrapper
        Full: { controls: { disabled: { type: "boolean" } } },
        // shorthand: no `controls` key → the whole object IS the controls map
        Short: { size: { type: "range", min: 1, max: 3 } },
        // a `controls` key always means the wrapper — so a control one might intend
        // to literally name "controls" is read as the wrapper, not as a control.
        Ambig: { controls: { type: "boolean" } },
      },
    }),
  }, ({ entries, problems }) => {
    assertEquals(problems, []);
    const sub = entries[0].subControlDefs;
    assertEquals(sub.Full.disabled.type, "boolean");
    assertEquals(sub.Short.size.type, "range");
    assertEquals(sub.Short.size.min, 1);
    // Ambig.controls was unwrapped → its contents parsed; the map is keyed by the
    // inner key ("type"), confirming a literal "controls" control is NOT produced.
    assert("type" in sub.Ambig);
    assert(!("controls" in sub.Ambig));
  });
});
