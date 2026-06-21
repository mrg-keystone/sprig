import { assert, assertEquals } from "@std/assert";
import { scopeCss } from "../ui/.sprig/compiler/scope.ts";

const T = "s12345678";
const TOK = `[${T}]`;

Deno.test("bug 11: unbalanced ()/[] inside an attribute-selector string still scopes the rest", () => {
  const out = scopeCss(
    '[aria-label="Close )"] { color: red }\n.other { color: green }',
    T,
  );
  // both rules must carry the scope marker
  assert(out.includes(`[aria-label="Close )"]${TOK}`), `attr rule unscoped: ${out}`);
  assert(out.includes(`.other${TOK}`), `.other unscoped: ${out}`);

  // a stray "(" must not un-scope either
  const out2 = scopeCss('[data-x="("] { color: red }\n.other { color: green }', T);
  assert(out2.includes(`.other${TOK}`), `.other unscoped (paren): ${out2}`);
});

Deno.test("bug 13: unbalanced {/} inside a string value does not corrupt following rules", () => {
  const sheet = `.a{color:red}
.icon::before{content:"{";}
.b{color:blue}
.c{color:green}`;
  const out = scopeCss(sheet, T);
  assert(out.includes(`.b${TOK}`), `.b unscoped: ${out}`);
  assert(out.includes(`.c${TOK}`), `.c unscoped: ${out}`);
  // balanced braces, no stray trailing "}" — ignore braces inside string literals
  const structural = out.replace(/"[^"]*"/g, '""');
  const opens = (structural.match(/{/g) || []).length;
  const closes = (structural.match(/}/g) || []).length;
  assertEquals(opens, closes, `unbalanced braces: ${out}`);
});

Deno.test("bug 21: unknown rule-bearing at-rules (@starting-style) scope their inner rules", () => {
  const out = scopeCss("@starting-style { .box { opacity: 0; } }", T);
  assert(out.includes(`.box${TOK}`), `inner .box unscoped: ${out}`);
});

Deno.test("bug 36: :host-context(...) descendant produces valid CSS (no dangling -context)", () => {
  const out = scopeCss(":host-context(.dark) .x { color:red }", T);
  assert(!out.includes("-context"), `dangling -context: ${out}`);
  assert(out.includes(`.x${TOK}`), `.x not scoped: ${out}`);
});

Deno.test("bug 40: :host-context(...) standalone produces valid CSS, never matches nothing", () => {
  const out = scopeCss(":host-context(.dark) { x:1 }", T);
  assert(!out.includes("-context"), `dangling -context: ${out}`);
  // must not have the broken `]-context` / double-attr shape; must reference .dark + token
  assert(out.includes(".dark"), `lost ancestor: ${out}`);
  assert(out.includes(TOK), `lost host marker: ${out}`);
});

Deno.test("bug 37: escaped-colon class names get the token appended at the end", () => {
  const out = scopeCss(".hover\\:bg-red { color: red }", T);
  assertEquals(out.trim(), `.hover\\:bg-red${TOK} { color: red }`, out);

  const out2 = scopeCss(".md\\:flex { display: flex }", T);
  assertEquals(out2.trim(), `.md\\:flex${TOK} { display: flex }`, out2);

  // genuine pseudo still works
  const out3 = scopeCss(".plain:hover { color: red }", T);
  assertEquals(out3.trim(), `.plain${TOK}:hover { color: red }`, out3);
});

Deno.test("bug 38: stripComments is string/url aware", () => {
  const out = scopeCss('.a { content: "/* not a comment */"; }', T);
  assert(out.includes('content: "/* not a comment */"'), `string destroyed: ${out}`);

  const out2 = scopeCss(".a { background: url(http://x/*y*/z.png); }", T);
  assert(out2.includes("url(http://x/*y*/z.png)"), `url corrupted: ${out2}`);
});

Deno.test("bug 39: nested style rules get their key compound scoped", () => {
  const out = scopeCss(".card { .title { font-weight: bold; } }", T);
  assert(out.includes(`.title${TOK}`), `nested .title unscoped: ${out}`);
  assert(out.includes(`.card${TOK}`), `.card unscoped: ${out}`);

  const out2 = scopeCss(".card { color:red; & .title { color:blue; } }", T);
  assert(out2.includes(`.title${TOK}`), `nested & .title unscoped: ${out2}`);
});

Deno.test("bug 84: :host inside a compound gets exactly one marker", () => {
  assertEquals(scopeCss(":host.active { color: red }", T).trim(), `${TOK}.active { color: red }`);
  assertEquals(scopeCss(':host[dir="rtl"]{}', T).trim(), `${TOK}[dir="rtl"] {}`);
  assertEquals(scopeCss(":host:hover{}", T).trim(), `${TOK}:hover {}`);
});

Deno.test("bug 85: insertToken does not corrupt escaped-colon class names", () => {
  const out = scopeCss(".foo\\:bar { color:red }", T);
  assertEquals(out.trim(), `.foo\\:bar${TOK} { color:red }`, out);
});
