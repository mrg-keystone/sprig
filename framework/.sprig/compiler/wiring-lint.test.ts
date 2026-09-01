// TEMPLATE WIRING — whole-app lint + `sprig map` (template-wiring-spec.md §5/§6,
// test plan §8 items 9–10). These tests build a real on-disk app fixture (bootstrap
// shell + src/ components + pages + a routers/root/routes.json table) and run the
// same analysis `sprig check` / `sprig build` / `sprig map` run:
//   • rule 1 (error): a verb naming a signal the component doesn't declare —
//     forwarding <router-outlet> exempt;
//   • rule 2 (error): a channel with no sets: origin;
//   • rule 3 (warning): exactly one participant — incl. the §6 counting example
//     (the forwarding element never counts; an unmatched forward contributes 0);
//   • rule 4 (warning): more than one sets: origin;
//   • `sprig map`: exact rendered lines, all three verbs + outlet forwarding, with
//     a route-mounted page counted ONCE however many routes reach it.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { analyzeWiring, declaredSignals, renderWiringMap, type WiringAnalysis } from "./wiring-lint.ts";

// ────────────────────────────────── harness ─────────────────────────────────
/** Write an app fixture ({ "relative/path": content }) into a temp dir. */
async function makeApp(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "sprig-wiring-lint-" });
  for (const [p, content] of Object.entries(files)) {
    const abs = join(dir, p);
    await Deno.mkdir(dirname(abs), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return dir;
}

/** A minimal island logic.ts declaring the given signal fields (class style). */
const logic = (...signals: string[]): string =>
  `import { signal } from "@mrg-keystone/sprig";\n` +
  `export default class C {\n` +
  signals.map((s) => `  ${s} = signal<string | null>(null);\n`).join("") +
  `}\n`;

async function analyzed(files: Record<string, string>): Promise<WiringAnalysis> {
  const app = await makeApp(files);
  try {
    return await analyzeWiring(app);
  } finally {
    await Deno.remove(app, { recursive: true }).catch(() => {});
  }
}

// ─────────────────────────────── `sprig map` (§5) ───────────────────────────
Deno.test("spec §5: sprig map renders one line per channel — set by → edited by → read by, pages joined via forwarding, each counted once", async () => {
  const a = await analyzed({
    // the shell declares the channel: all three verbs + the forwarding outlet.
    "bootstrap/template.html": `<div class="frame">
  <side-nav sets:org></side-nav>
  <org-quick-rename edits:draft={org}></org-quick-rename>
  <main class="content">
    <router-outlet reads:org></router-outlet>
  </main>
</div>`,
    "src/shared-components/side-nav/template.html": `<nav>{{ org() }}</nav>`,
    "src/shared-components/side-nav/logic.ts": logic("org"),
    "src/shared-components/org-quick-rename/template.html": `<input [value]="draft()" />`,
    "src/shared-components/org-quick-rename/logic.ts": logic("draft"),
    // routed pages: two declare the forwarded local name `org`, one doesn't.
    "src/pages/org-detail/template.html": `<h1>{{ org() }}</h1>`,
    "src/pages/org-detail/logic.ts": logic("org"),
    "src/pages/app-detail/template.html": `<h1>{{ org() }}</h1>`,
    "src/pages/app-detail/logic.ts": logic("org"),
    "src/pages/plain-page/template.html": `<p>static</p>`,
    // app-detail is reachable via TWO routes — it must still count (and print) ONCE.
    "src/routers/root/routes.json": JSON.stringify([
      { path: "", load: "pages/org-detail" },
      { path: "apps/:id", load: "pages/app-detail" },
      { path: "apps/:id/alt", load: "pages/app-detail" },
      { path: "plain", load: "pages/plain-page" },
    ]),
  });

  // the accepted §5 [DECIDE] default: one clause per verb, edits: gets its own.
  assertEquals(renderWiringMap(a), [
    "org: set by side-nav → edited by org-quick-rename → read by org-detail, app-detail",
  ]);
  // a healthy channel: no lint findings at all.
  assertEquals(a.diagnostics, []);
  // channel identity is the DECLARING template (per-template scope).
  assertEquals(a.channels[0].file, "bootstrap/template.html");
  assertEquals(a.channels[0].line, 2);
});

Deno.test("spec §3 channel scope: same-named channels in two templates are two channels — two map lines, stable file order", async () => {
  const wire = (suffix: string) =>
    `<div><set-${suffix} sets:local></set-${suffix}><read-${suffix} reads:local></read-${suffix}></div>`;
  const a = await analyzed({
    "src/pages/one/template.html": wire("one"),
    "src/pages/one/components/set-one/template.html": `<i></i>`,
    "src/pages/one/components/set-one/logic.ts": logic("local"),
    "src/pages/one/components/read-one/template.html": `<i></i>`,
    "src/pages/one/components/read-one/logic.ts": logic("local"),
    "src/pages/two/template.html": wire("two"),
    "src/pages/two/components/set-two/template.html": `<i></i>`,
    "src/pages/two/components/set-two/logic.ts": logic("local"),
    "src/pages/two/components/read-two/template.html": `<i></i>`,
    "src/pages/two/components/read-two/logic.ts": logic("local"),
  });
  assertEquals(a.diagnostics, []);
  assertEquals(renderWiringMap(a), [
    "local: set by set-one → read by read-one",
    "local: set by set-two → read by read-two",
  ]);
  assertEquals(a.channels.map((c) => c.file), [
    "src/pages/one/template.html",
    "src/pages/two/template.html",
  ]);
});

// ────────────────────────────────── lint (§6) ───────────────────────────────
Deno.test("spec §6 rule 1: a verb naming a signal the component doesn't declare is an ERROR — the forwarding outlet is exempt", async () => {
  const a = await analyzed({
    "bootstrap/template.html": `<div>
  <side-nav sets:wrong></side-nav>
  <router-outlet reads:org></router-outlet>
</div>`,
    "src/shared-components/side-nav/template.html": `<nav></nav>`,
    "src/shared-components/side-nav/logic.ts": logic("org"),
    "src/pages/org-detail/template.html": `<h1>{{ org() }}</h1>`,
    "src/pages/org-detail/logic.ts": logic("org"),
    "src/routers/root/routes.json": JSON.stringify([{ path: "", load: "pages/org-detail" }]),
  });
  const rule1 = a.diagnostics.filter((d) => d.rule === 1);
  assertEquals(rule1.length, 1, "exactly one rule-1 finding — the outlet forwards, it never owns");
  assertEquals(rule1[0].level, "error");
  assertEquals(rule1[0].file, "bootstrap/template.html");
  assertEquals(rule1[0].line, 2);
  assertStringIncludes(rule1[0].message, `"side-nav" declares no signal "wrong"`);
  assertStringIncludes(rule1[0].message, "org", "the message lists the signals it DOES declare");
  assert(!a.diagnostics.some((d) => d.message.includes("router-outlet")), "no finding blames the forwarder");
});

Deno.test("spec §6 rule 1: wiring on a static component (no logic.ts) and on a non-component tag are ERRORS", async () => {
  const a = await analyzed({
    "src/shell/template.html": `<div><static-box sets:org></static-box><no-such-thing reads:org></no-such-thing></div>`,
    "src/shared-components/static-box/template.html": `<b>static</b>`,
  });
  const rule1 = a.diagnostics.filter((d) => d.rule === 1);
  assertEquals(rule1.map((d) => d.level), ["error", "error"]);
  assertStringIncludes(rule1[0].message, "static (no logic.ts)");
  assertStringIncludes(rule1[1].message, `"no-such-thing" is not a component`);
  assertEquals(rule1[0].file, "src/shell/template.html");
});

Deno.test("spec §6 rule 2: a channel with only reads:/edits: participants is an ERROR — the value has no origin", async () => {
  const a = await analyzed({
    "src/shell/template.html": `<div><view-a reads:x></view-a><edit-a edits:x></edit-a></div>`,
    "src/shared-components/view-a/template.html": `<i></i>`,
    "src/shared-components/view-a/logic.ts": logic("x"),
    "src/shared-components/edit-a/template.html": `<i></i>`,
    "src/shared-components/edit-a/logic.ts": logic("x"),
  });
  assertEquals(a.diagnostics.length, 1);
  assertEquals(a.diagnostics[0].rule, 2);
  assertEquals(a.diagnostics[0].level, "error");
  assertStringIncludes(a.diagnostics[0].message, `channel "x" has no sets: participant`);
});

Deno.test("spec §6 rule 3 + the counting [DECIDE]: forwarder never counts, unmatched forward contributes nothing → one participant WARNS", async () => {
  // the spec's own example: <side-nav sets:org> + <router-outlet reads:org> and NO
  // reachable page declaring `org` — exactly one participant (side-nav).
  const a = await analyzed({
    "bootstrap/template.html": `<div><side-nav sets:org></side-nav><router-outlet reads:org></router-outlet></div>`,
    "src/shared-components/side-nav/template.html": `<nav></nav>`,
    "src/shared-components/side-nav/logic.ts": logic("org"),
    "src/pages/plain-page/template.html": `<p>no org signal here</p>`,
    "src/routers/root/routes.json": JSON.stringify([{ path: "", load: "pages/plain-page" }]),
  });
  assertEquals(a.diagnostics.length, 1);
  assertEquals(a.diagnostics[0].rule, 3);
  assertEquals(a.diagnostics[0].level, "warning");
  assertStringIncludes(a.diagnostics[0].message, `exactly one participant (side-nav)`);
  assertStringIncludes(a.diagnostics[0].message, "matches no routed page");
});

Deno.test("spec §6 rule 3: a lone participant with no forwarding at all also WARNS (dead wire or typo)", async () => {
  const a = await analyzed({
    "src/shell/template.html": `<div><solo-x sets:x></solo-x></div>`,
    "src/shared-components/solo-x/template.html": `<i></i>`,
    "src/shared-components/solo-x/logic.ts": logic("x"),
  });
  assertEquals(a.diagnostics.length, 1);
  assertEquals(a.diagnostics[0].rule, 3);
  assertEquals(a.diagnostics[0].level, "warning");
});

Deno.test("spec §6 rule 4: more than one sets: on a channel WARNS, naming the origins", async () => {
  const a = await analyzed({
    "src/shell/template.html": `<div><nav-a sets:x></nav-a><nav-b sets:x></nav-b><view-b reads:x></view-b></div>`,
    "src/shared-components/nav-a/template.html": `<i></i>`,
    "src/shared-components/nav-a/logic.ts": logic("x"),
    "src/shared-components/nav-b/template.html": `<i></i>`,
    "src/shared-components/nav-b/logic.ts": logic("x"),
    "src/shared-components/view-b/template.html": `<i></i>`,
    "src/shared-components/view-b/logic.ts": logic("x"),
  });
  assertEquals(a.diagnostics.length, 1);
  assertEquals(a.diagnostics[0].rule, 4);
  assertEquals(a.diagnostics[0].level, "warning");
  assertStringIncludes(a.diagnostics[0].message, "2 sets: participants (nav-a, nav-b)");
});

Deno.test("a forwarded sets: page satisfies the rule-2 origin (the outlet is a conduit for the page's own sets:)", async () => {
  // mirrors the runtime's §8.8 retention test: <router-outlet sets:org> + a page
  // that declares `org` — the page IS the origin, so no "no origin" error.
  const a = await analyzed({
    "bootstrap/template.html": `<div><probe-h reads:org></probe-h><router-outlet sets:org></router-outlet></div>`,
    "src/shared-components/probe-h/template.html": `<i></i>`,
    "src/shared-components/probe-h/logic.ts": logic("org"),
    "src/pages/org-page/template.html": `<h1></h1>`,
    "src/pages/org-page/logic.ts": logic("org"),
    "src/routers/root/routes.json": JSON.stringify([{ path: "", load: "pages/org-page" }]),
  });
  assertEquals(a.diagnostics, []);
  assertEquals(renderWiringMap(a), ["org: set by org-page → read by probe-h"]);
});

// ─────────────────────────── signal-declaration scan ────────────────────────
Deno.test("declaredSignals: class fields, setup consts, object properties, computed — comments ignored", () => {
  const s = declaredSignals(`
    import { computed, defineComponent, signal } from "@mrg-keystone/sprig";
    // count = signal(9)  ← a comment, not a declaration
    export default class C {
      org = signal<string | null>(null);
      total: WritableAccessor<number> = signal(0);
      label = computed(() => this.org() ?? "");
    }
    export const other = defineComponent({
      setup: () => {
        const count = signal(0);
        return { count, draft: signal("d") };
      },
    });
  `);
  for (const name of ["org", "total", "label", "count", "draft"]) assert(s.has(name), `declares ${name}`);
  assert(!s.has("comment"), "comments contribute nothing");
});
