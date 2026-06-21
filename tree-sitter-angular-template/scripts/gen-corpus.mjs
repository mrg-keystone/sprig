// Generates tree-sitter corpus tests under test/corpus/.
// Expected trees are seeded from the (already verified) parser output: each source is
// parsed with `tree-sitter parse`, byte positions are stripped, and the result is the
// expected sexp. This locks the current correct structure as a regression baseline.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = "/Users/raphaelcastro/Documents/programming/sprig/tree-sitter-angular-template";

const GROUPS = {
  bindings: [
    ["property binding", `<button [disabled]="busy"></button>`],
    ["attribute binding", `<td [attr.colspan]="2 + 1"></td>`],
    ["class bindings", `<div [class.active]="a" [class]="{ active: a }"></div>`],
    ["style binding with unit", `<div [style.width.px]="w"></div>`],
    ["event binding with key combo", `<input (keyup.control.enter)="send()" />`],
    ["two-way binding", `<input [(ngModel)]="name" />`],
    ["animation bindings", `<div [@fade]="s" (@fade.done)="d($event)"></div>`],
    ["template reference and exportAs", `<input #c="ngModel" [(ngModel)]="email" />`],
    ["plain attribute with interpolation", `<img src="{{ url }}" alt="pic" />`],
  ],
  control_flow: [
    ["if else-if else", `@if (a) { <p>a</p> } @else if (b) { <p>b</p> } @else { <p>c</p> }`],
    ["if with as alias", `@if (user$ | async; as u) { {{ u.name }} }`],
    ["for with track and empty", `@for (i of items; track i.id) { <li>{{ i.n }}</li> } @empty { <li>none</li> }`],
    ["for with contextual aliases", `@for (r of rows; track r.id; let idx = $index, last = $last) { <i>{{ idx }}</i> }`],
    ["switch", `@switch (s) { @case ('a') { <p>A</p> } @default { <p>D</p> } }`],
  ],
  defer: [
    ["defer full", `@defer (on viewport) { <c /> } @placeholder (minimum 500ms) { <p>ph</p> } @loading (after 100ms; minimum 1s) { <s /> } @error { <e /> }`],
    ["defer combined triggers", `@defer (on idle; on timer(5s)) { <c /> }`],
    ["defer interaction with ref and prefetch", `@defer (on interaction(btn); prefetch on idle) { <c /> } @placeholder { <p>x</p> }`],
    ["defer when", `@defer (when ready()) { <c /> }`],
    ["let declarations", `@let total = items.reduce((s, i) => s + i.p, 0);`],
  ],
  expressions: [
    ["pipe chain", `{{ name | lowercase | titlecase }}`],
    ["pipe with args", `{{ p | currency:'EUR':'symbol':'1.2-2' }}`],
    ["ternary", `{{ on ? 'Y' : 'N' }}`],
    ["safe navigation chain", `{{ user?.address?.city }}`],
    ["non-null and member", `{{ user!.name }}`],
    ["nullish coalescing", `{{ nick ?? 'anon' }}`],
    ["any cast then member", `{{ $any(x).legacy }}`],
    ["call then member", `{{ f().g.h }}`],
    ["array and object literals", `<a [x]="['c', t]" [y]="{ a: 1, 'b-c': d }"></a>`],
    ["operator precedence", `{{ a + b * c > d }}`],
  ],
  microsyntax: [
    ["ngIf else", `<div *ngIf="ok; else other"></div>`],
    ["ngIf then else", `<div *ngIf="r; then a else b"></div>`],
    ["ngIf async as", `<div *ngIf="u$ | async as u"></div>`],
    ["ngFor full", `<li *ngFor="let x of xs; trackBy: byId; let i = index; let first = first"></li>`],
    ["ngSwitch", `<div [ngSwitch]="s"><p *ngSwitchCase="'a'"></p><p *ngSwitchDefault></p></div>`],
    ["ngTemplateOutlet with context", `<ng-container *ngTemplateOutlet="t; context: { $implicit: 'x', k: 1 }"></ng-container>`],
  ],
  html: [
    ["self-closing component", `<app-spinner />`],
    ["content projection", `<ng-content select="[title]"></ng-content>`],
    ["ng-template with let inputs", `<ng-template #t let-name let-f="formal"></ng-template>`],
    ["nested elements with comment", `<ul><!-- c --><li>x</li></ul>`],
  ],
  scanner: [
    ["script raw text", `<script>var a = 1 < 2 && b > 3;</script>`],
    ["style raw text", `<style>.box { color: red; width: 10px }</style>`],
    ["li implicit close", `<ul><li>one<li>two</ul>`],
    ["p implicit close by block", `<p>one<div>x</div>`],
    ["table cell and row implicit close", `<table><tr><td>a<td>b<tr><td>c</table>`],
    ["dt dd implicit close", `<dl><dt>term<dd>def</dl>`],
    ["void element before sibling", `<div><br><span>x</span></div>`],
    ["void elements without slash", `<br><hr><img src="a.png">`],
  ],
  robustness: [
    ["css custom property binding", `<a [style.--my-var]="c"></a>`],
    ["percent style unit", `<i [style.width.%]="p"></i>`],
    ["namespaced attribute binding", `<svg [attr.xlink:href]="u"></svg>`],
    ["keyed access numeric", `{{ items[0] }}`],
    ["keyed access string", `{{ obj['k'] }}`],
    ["single-quoted attribute", `<div id='main'></div>`],
    ["scientific number", `{{ 1.5e-2 }}`],
    ["numeric object key", `<a [m]="{ 1: a, 2: b }"></a>`],
    ["namespaced tag", `<svg:circle></svg:circle>`],
  ],
};

function parse(src) {
  const tmp = join(tmpdir(), "ngt_corpus_" + Math.random().toString(36).slice(2) + ".ng.html");
  wf(tmp, src);
  const out = execSync(`tree-sitter parse ${tmp}`, { cwd: DIR }).toString();
  // strip byte ranges " [r, c] - [r, c]" -> ""
  return out.replace(/ \[\d+, \d+\] - \[\d+, \d+\]/g, "").trimEnd();
}

mkdirSync(join(DIR, "test", "corpus"), { recursive: true });
const bar = "=".repeat(40);
let totalTests = 0;
for (const [group, cases] of Object.entries(GROUPS)) {
  const blocks = cases.map(([name, src]) => {
    totalTests++;
    return `${bar}\n${name}\n${bar}\n\n${src}\n\n---\n\n${parse(src)}\n`;
  });
  const file = join(DIR, "test", "corpus", `${group}.txt`);
  writeFileSync(file, blocks.join("\n"));
  console.log(`wrote ${group}.txt (${cases.length} tests)`);
}
console.log(`total: ${totalTests} corpus tests`);
