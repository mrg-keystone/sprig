// Proves the static-vs-island predicate against REAL parsed templates + real classes.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { parseTemplate } from "./parse.ts";
import { classify, formatReport } from "./island-infer.ts";

Deno.test("one-way bindings + interpolation alone → static", async () => {
  const tpl = await parseTemplate(
    `<div class="card" [class.empty]="count === 0" [attr.id]="id"><p>{{ name }}</p></div>`,
  );
  const c = classify({ template: tpl });
  assertEquals(c.kind, "static", c.reasons.join());
  assertEquals(c.reasons, []);
});

Deno.test("an (event) binding → island", async () => {
  const tpl = await parseTemplate(`<button (click)="inc()">+</button>`);
  const c = classify({ template: tpl });
  assertEquals(c.kind, "island");
  assertStringIncludes(c.reasons.join(), "event");
});

Deno.test("a [(two-way)] binding → island", async () => {
  const tpl = await parseTemplate(`<input [(value)]="name">`);
  assertEquals(classify({ template: tpl }).kind, "island");
});

Deno.test("an event on a CHILD component tag still makes the host an island", async () => {
  // the host wires the child's click → it needs JS (matches renderComponent's event path)
  const tpl = await parseTemplate(`<ui-button (click)="dec()">-1</ui-button>`);
  assertEquals(classify({ template: tpl }).kind, "island");
});

Deno.test("onServerInit-only class with a static template → STILL static", async () => {
  class UserCard {
    user: unknown = null;
    async onServerInit() { this.user = { name: "x" }; } // server fetch, no browser behaviour
  }
  const tpl = await parseTemplate(`<div class="card">{{ user.name }}</div>`);
  const c = classify({ template: tpl, componentClass: UserCard });
  assertEquals(c.kind, "static", "onServerInit must NOT force an island");
});

Deno.test("a browser lifecycle hook → island even with a static template", async () => {
  class Clock {
    now = "";
    onBrowserInit() {/* setInterval */}
  }
  const tpl = await parseTemplate(`<p>{{ now }}</p>`); // no events
  const c = classify({ template: tpl, componentClass: Clock });
  assertEquals(c.kind, "island");
  assertStringIncludes(c.reasons.join(), "onBrowserInit");
});

Deno.test("the build report makes the decision legible", () => {
  const out = formatReport([
    { name: "user-card", kind: "static", reasons: [] },
    { name: "like-button", kind: "island", reasons: ["template binds an (event)/[(two-way)]"], bytes: 1230 },
    { name: "clock", kind: "island", reasons: ["class defines onBrowserInit/onBrowserDestroy"], bytes: 900 },
  ]);
  assertStringIncludes(out, "user-card");
  assertStringIncludes(out, "static");
  assertStringIncludes(out, "0kb");
  assertStringIncludes(out, "1.2kb");
  assertStringIncludes(out, "← template binds an (event)");
  console.log("\n" + out + "\n");
});
