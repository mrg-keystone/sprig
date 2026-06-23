<sub>[← sprig docs](./README.md)</sub>

# Template syntax

Templates are HTML plus Angular-style interpolation, control flow, bindings, and pipes.
They are parsed by a tree-sitter grammar (no JSX, no `new Function`) and evaluated by a
read-only interpreter against a **scope** (the page's `@inputs` + loop locals + an island's
`setup()` result).

> ## ⚠ String literals MUST use single quotes
> Inside any template expression (`{{ }}`, `@if`, `@for`, bindings, event handlers), string
> literals **must be single-quoted**. Double quotes are a tree-sitter **grammar error**:
> ```html
> {{ status() === 'running' ? 'running…' : '▸ run' }}   <!-- ✓ -->
> {{ status() === "running" }}                           <!-- ✗ parse error -->
> ```
> Double quotes already delimit the attribute, so the inner literal needs the other quote.
> Keep large literal arrays/objects in `logic.ts`/`resolve.ts` and iterate them.

## Interpolation

```html
<h1>{{ project.name }}</h1>
<p>{{ price | number:'1.0-2' }} · {{ today | date:'short' }}</p>
```

Interpolated text is **HTML-escaped**. `null`/`undefined` render as the empty string;
objects/arrays render as JSON. Use `[innerHTML]="trustedHtml"` to inject raw HTML (author-trusted).

## Expressions

The interpreter supports a safe JS-expression subset: identifiers, member/`?.` access,
subscripts (`a[i]`), calls and method calls (`items.reduce(...)`), `+ - * / %`,
`== != === !== < > <= >=`, `&& || ??` (short-circuiting), `! -` unary, ternaries, array/object
literals, and arrow functions (e.g. `xs.filter(x => x.ok)`). Globals: `true`, `false`, `null`,
`undefined`. `$any(x)` is a no-op compile-time cast. There are **no** assignments or statements
in read positions (those exist only in event handlers).

## Control flow

```html
@if (board; as b) {
  <h2>{{ b.title }}</h2>
} @else if (loading) {
  <p>Loading…</p>
} @else {
  <p>No board.</p>
}
```

```html
@for (issue of issues; track issue.id) {
  <issue-card [issue]="issue"></issue-card>
} @empty {
  <li>Nothing here</li>
}
```

`@for` exposes loop locals in scope: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`.
Alias them with `let`: `@for (x of xs; track x.id; let i = $index)`.

```html
@switch (kind) {
  @case ('component') { <span>component</span> }
  @case ('page') { <span>page</span> }
  @default { <span>—</span> }
}
```

```html
@let total = a + b;          <!-- block-scoped local -->
@let label = open ? 'Open' : 'Closed';
```

`@defer { … }` renders its content at SSR (its client trigger arrives with hydration).

`@if`/`@else if` may bind the truthy condition with `; as alias`. Each branch gets its own
cloned scope, so `@let` and aliases never leak into the parent.

## Bindings

```html
<!-- property → DOM property/attribute -->
<input [value]="name()" [disabled]="busy()" />

<!-- [attr.x] sets/removes an attribute (omitted when null) -->
<a [attr.href]="url">{{ label }}</a>

<!-- [class.x] toggles a class; [class] takes a string | array | { name: boolean } map -->
<span [class.active]="isActive" [class.fail]="!r.ok"></span>
<div [class]="{ open: isOpen, busy: loading }"></div>

<!-- [style.prop] (+ optional unit), [style] takes an object -->
<div [style.width.px]="w" [style.color]="hex"></div>

<!-- innerHTML (trusted, unescaped) -->
<div [innerHTML]="markup"></div>
```

Boolean attributes (`disabled`, `checked`, `selected`, `readonly`, `required`, `hidden`,
`multiple`, `open`) render bare when truthy and are dropped when falsy.

Two-way binding `[(x)]="expr"` pairs an `x` input with an `xChange` output (see
[islands.md](./islands.md) on `ctx.model`).

## Events (client islands only)

`(event)` bindings are collected at SSR and **delegated** on the island root at hydration.
`$event` is in scope; handlers may call functions and assign to signals.

```html
<button (click)="inc()">+</button>
<input (input)="search.set($event.target.value)" />
```

Key/modifier chords are dot-suffixed (`enter`, `escape`/`esc`, `space`, `tab`, and modifier
keys `control`/`ctrl`, `shift`, `alt`/`option`, `meta`/`cmd`/`command`):

```html
<form (keyup.control.enter)="submit()"></form>
```

`(submit)` handlers automatically `preventDefault()`. (Events on **static** pages do nothing —
only islands hydrate.)

## Pipes

`value | name:arg1:arg2`. Built-ins:

| pipe | example |
|---|---|
| `uppercase` / `lowercase` / `titlecase` | `{{ name | titlecase }}` |
| `number` | `{{ x | number:'1.0-2' }}` (digitsInfo `minInt.minFrac-maxFrac`) |
| `percent` | `{{ r | percent }}` (default `'1.0-0'`) |
| `currency` | `{{ p | currency:'EUR' }}` |
| `date` | `{{ t | date:'short' }}` / `{{ t | date:'yyyy-MM-dd' }}` (named or token pattern) |
| `slice` | `{{ xs | slice:1:3 }}` |
| `json` | `{{ obj | json }}` |
| `keyvalue` | `@for (kv of map | keyvalue; track kv.key)` |
| `truncate` | `{{ s | truncate:20 }}` |
| `i18nPlural` | `{{ n | i18nPlural:{ '=0': 'none', other: '# items' } }}` |
| `i18nSelect` | `{{ g | i18nSelect:{ male: 'he', female: 'she', other: 'they' } }}` |

An unknown pipe name passes the value through unchanged.

## Component & special tags

```html
<counter [start]="3"></counter>          <!-- a registered folder-component, by basename -->
<router-outlet></router-outlet>          <!-- shell only → rendered as <sprig-outlet> -->
<ng-container>…</ng-container>           <!-- groups children with no DOM element -->
<content/>                               <!-- content projection slot (may self-close) -->
<content select="[footer]"/>             <!-- a named projection slot -->
```

`<router-outlet>` is emitted as a persistent `<sprig-outlet>` boundary (the soft-nav swap
target — see [routing.md](./routing.md)). Content placed between a component's tags is
projected via **`<content>`** (which may self-close, `<content/>`; optionally
`select="tag"` / `select=".class"` / `select="[attr]"`; the unmatched remainder fills the
default `<content>`). The Angular-flavoured `<ng-content>` is accepted as an alias.

## Keep templates dumb

Compute filtered/grouped/derived view-models in `logic.ts` (`computed(...)`) or `resolve.ts`,
return **plain arrays/objects**, and let the template iterate them. This keeps expressions
simple and sidesteps the single-quote constraint on big literals.

---

**Next:** [islands.md](./islands.md) — making a template interactive.
**See also:** [styling.md](./styling.md) · [data-and-di.md](./data-and-di.md)
