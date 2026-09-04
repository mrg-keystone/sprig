// The daisyUI class-collision warning (buildCss): a component styles.css that targets a class name
// daisyUI 5 also styles globally gets daisyUI's rules on top of its own — `.stat { width: 8px }`
// renders as a padded inline-grid stat block (coms ticket 20260904T132558Z, the status-dot blob;
// the workbench shell's own dock/badge/kbd/toast before it). selectorClasses + daisyuiCollisions
// are the pure core; installedDaisyuiClasses reads the exact set from the build's Tailwind cache.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DAISYUI_RESERVED_CLASSES, daisyuiCollisions, installedDaisyuiClasses, selectorClasses } from "./build.ts";

Deno.test("daisyuiCollisions: a scoped rule on a bare reserved name is a hit", () => {
  // the reporter's exact shape — scoping the rule under the component root changes nothing,
  // daisyUI's `.stat` still lands on the element
  assertEquals(daisyuiCollisions(`.my-root .stat { width: 8px; height: 8px; }`), ["stat"]);
});

Deno.test("daisyuiCollisions: exact names only — a name that merely starts like one is not a hit", () => {
  assertEquals(daisyuiCollisions(`.statistic { } .cardinal { } .button { } .tabular { }`), []);
  // the workbench's compound chrome names: daisyUI defines `dock-label`/`kbd-sm`, not these
  assertEquals(daisyuiCollisions(`.dock-tab { } .kbd-row { }`), []);
});

Deno.test("daisyuiCollisions: parts/modifiers hit when the reserved set carries them (installed set)", () => {
  const installed = new Set(["stat", "stat-title", "stat-value", "card", "card-body"]);
  assertEquals(daisyuiCollisions(`.stat-title { font-size: 12px; } .list-item { }`, installed), ["stat-title"]);
  assertEquals(daisyuiCollisions(`.card-body { padding: 0; }`, installed), ["card-body"]);
});

Deno.test("daisyuiCollisions: prefixed / own names never fire (the recommended fix)", () => {
  assertEquals(daisyuiCollisions(`.hdot { width: 8px; } .wb-dock { } .cm-stat { } .ui-btn--sm { }`), []);
});

Deno.test("selectorClasses: rules nested in at-rules are seen; declaration bodies are not", () => {
  assertEquals(
    selectorClasses(`@media (min-width: 640px) { .card { padding: 1rem; } }\n@supports (display: grid) { .x { width: .5rem } }`),
    ["card", "x"],
  );
  // `.5rem`, a `.org` inside url(), a `.btn` inside a content string — all in bodies, none a selector
  assertEquals(
    selectorClasses(`.hdot { width: .5rem; background: url(http://www.w3.org/x.svg); content: ".btn"; }`),
    ["hdot"],
  );
});

Deno.test("selectorClasses: CSS nesting is seen at every level; @layer names and escapes are not classes", () => {
  // daisyUI's own dist shape: a nested @layer with dotted name inside a rule, an escaped variant
  // (`sm:toast` is ONE class — the escape is blanked, leaving the responsive prefix that
  // installedDaisyuiClasses drops as noise; `toast` alone is not what that selector targets)
  assertEquals(
    selectorClasses(`@layer utilities{@layer daisyui.l1.l2.l3{.stat{display:grid;.stat-title{opacity:.6}}}}.sm\\:toast{inset:auto}`),
    ["stat", "stat-title", "sm"],
  );
});

Deno.test("selectorClasses: comments are ignored; names dedupe in first-seen order", () => {
  assertEquals(selectorClasses(`/* the .stat block */ .hdot { }`), ["hdot"]);
  assertEquals(selectorClasses(`.stat { } .badge { } .stat:hover { } .badge-sm { }`), ["stat", "badge", "badge-sm"]);
});

Deno.test("installedDaisyuiClasses: null when no package is there; exact set when it is", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    assertEquals(await installedDaisyuiClasses(tmp), null);
    // a stand-in package with daisyUI's real dist shape — the loader must read both dirs, keep only
    // selector classes, and drop the responsive/qualifier/variable-only noise
    const pkg = join(tmp, "node_modules", "daisyui");
    await Deno.mkdir(join(pkg, "components"), { recursive: true });
    await Deno.mkdir(join(pkg, "utilities"), { recursive: true });
    await Deno.writeTextFile(
      join(pkg, "components", "stat.css"),
      `/*! daisyUI */ @layer utilities{@layer daisyui.l1.l2.l3{.stat{display:inline-grid;width:100%;padding-inline:calc(.25rem * 6)}.stat-title{opacity:.6}}}`,
    );
    await Deno.writeTextFile(
      join(pkg, "components", "menu.css"),
      `.menu :where(li:not(.menu-title,.disabled)>*){background:url(http://www.w3.org/x.svg)}`,
    );
    await Deno.writeTextFile(join(pkg, "utilities", "join.css"), `.join{display:flex}@media (width>=640px){.sm\\:join{flex-direction:row}}`);
    await Deno.writeTextFile(join(pkg, "components", "README.md"), `.notacss { }`);
    const set = await installedDaisyuiClasses(tmp);
    assert(set);
    assertEquals([...set].sort(), ["join", "menu", "menu-title", "stat", "stat-title"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("installedDaisyuiClasses: against the real package in the build cache, when present", async () => {
  // Populated by any prior `sprig build`/`dev` on this machine (buildCss's twDir); skip if absent.
  const home = Deno.env.get("HOME") || Deno.env.get("TMPDIR") || "/tmp";
  const set = await installedDaisyuiClasses(join(home, ".cache", "sprig-tailwind"));
  if (!set) return;
  // the exact set must contain every curated bare name, plus the parts the ticket called out
  for (const name of DAISYUI_RESERVED_CLASSES) assert(set.has(name), `installed daisyUI lacks curated "${name}"`);
  for (const part of ["stat-title", "stat-value", "btn-sm", "card-body"]) assert(set.has(part), `missing ${part}`);
  for (const noise of ["sm", "lg", "w3", "org", "l1", "disabled", "prose"]) assert(!set.has(noise), `noise "${noise}" leaked`);
});

Deno.test("reserved list: every name the build warns on is documented in docs/sprig/styling.md", async () => {
  // The doc is the consumer-facing source of the list; the code set must never drift ahead of it.
  const here = import.meta.dirname!;
  const doc = await Deno.readTextFile(join(here, "..", "..", "..", "docs", "sprig", "styling.md"));
  const section = doc.slice(doc.indexOf("## daisyUI is in the build"));
  assertStringIncludes(section, "daisyui@5.7.28");
  for (const name of DAISYUI_RESERVED_CLASSES) {
    assertStringIncludes(section, "`" + name + "`", `reserved class "${name}" is missing from styling.md`);
  }
});
