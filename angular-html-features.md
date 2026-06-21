# Angular HTML / Template Features

A practical reference for everything you can write inside an Angular template (`.html` /
inline `template`). Current as of **Angular v20** (May 2025) — standalone components,
signals, and the built-in control flow (`@if` / `@for` / `@switch` / `@defer`) are the
modern default. Legacy structural directives (`*ngIf`, `*ngFor`, `*ngSwitch`) still work
and are documented here for older codebases.

## Table of contents

1. [Interpolation & text](#1-interpolation--text)
2. [Binding (property, attribute, class, style, event, two-way)](#2-binding)
3. [Template expression operators](#3-template-expression-operators)
4. [Template reference variables (`#var`)](#4-template-reference-variables)
5. [`@let` — local template variables](#5-let--local-template-variables)
6. [Built-in control flow (`@if` / `@for` / `@switch`)](#6-built-in-control-flow)
7. [`@defer` — lazy / deferred loading](#7-defer--lazy-loading)
8. [Legacy structural directives (`*ngIf` / `*ngFor` / `*ngSwitch`)](#8-legacy-structural-directives)
9. [Pipes](#9-pipes)
10. [Content projection & template containers](#10-content-projection--template-containers)
11. [Built-in attribute directives (`ngClass` / `ngStyle` / `ngModel`)](#11-built-in-attribute-directives)
12. [Signals in templates](#12-signals-in-templates)
13. [Misc: animations, SVG, security, i18n, `$any`](#13-misc)
14. [Quick-reference cheat sheet](#14-quick-reference-cheat-sheet)

---

## 1. Interpolation & text

Render a component property/expression into text with double curly braces. The expression
is evaluated and stringified; HTML is **auto-escaped** (safe against XSS).

```html
<h1>Hello {{ name }}</h1>
<p>1 + 1 = {{ 1 + 1 }}</p>
<p>{{ user.firstName + ' ' + user.lastName }}</p>
<p>{{ isOnline ? 'Online' : 'Offline' }}</p>
<img src="{{ avatarUrl }}" />          <!-- interpolation inside an attribute -->
```

Template **expressions** (in `{{ }}` and `[prop]`) are side-effect-free reads. Template
**statements** (in `(event)`) may have side effects (method calls, assignments).

Forbidden in expressions: `new`, `++`/`--`, bitwise `|`/`&` (`|` means *pipe* here),
assignment (except in event statements), and global references like `window`/`document`.

---

## 2. Binding

| Type | Syntax | Example |
|------|--------|---------|
| Property | `[prop]="expr"` | `<img [src]="url" />` |
| Attribute | `[attr.name]="expr"` | `<td [attr.colspan]="span">` |
| Class (toggle) | `[class.name]="bool"` | `<div [class.active]="isActive">` |
| Class (map/string) | `[class]="expr"` | `<div [class]="{ active: a }">` |
| Style (one) | `[style.prop]="expr"` | `<div [style.color]="c">` |
| Style (+unit) | `[style.prop.unit]="n"` | `<div [style.width.px]="w">` |
| Style (map) | `[style]="expr"` | `<div [style]="{ color: c }">` |
| Event | `(event)="stmt"` | `<button (click)="save()">` |
| Two-way | `[(x)]="prop"` | `<input [(ngModel)]="name">` |

### Property binding `[ ]`

Binds to a DOM **property** (not the HTML attribute). Quote-less is interpolation; brackets
take an expression.

```html
<button [disabled]="isSubmitting">Save</button>
<app-user [user]="currentUser" [role]="'admin'"></app-user>
<a [href]="profileUrl">Profile</a>
```

### Attribute binding `[attr.*]`

Use when there is no matching DOM property (ARIA, `colspan`, SVG, `data-*`). Setting the
value to `null` / `undefined` **removes** the attribute.

```html
<button [attr.aria-label]="label">×</button>
<td [attr.colspan]="2 + 1">…</td>
<div [attr.data-id]="row.id">…</div>
```

### Class & style binding

```html
<!-- single class toggle -->
<div [class.active]="isActive" [class.disabled]="!enabled">…</div>

<!-- object / array / string -->
<div [class]="{ active: isActive, 'text-danger': hasError }">…</div>
<div [class]="['card', theme]">…</div>

<!-- single style, with optional unit suffix -->
<p [style.color]="color">…</p>
<div [style.width.px]="width" [style.font-size.rem]="size">…</div>

<!-- style object -->
<div [style]="{ color: 'red', 'font-weight': 'bold' }">…</div>
```

### Event binding `( )`

`$event` is the DOM event (or the emitted value for a custom `@Output()` / `output()`).

```html
<button (click)="onClick()">Click</button>
<input (input)="onInput($event)" (keyup.enter)="submit()" />
<form (submit)="save($event)">…</form>

<!-- key & pointer pseudo-events -->
<input (keydown.escape)="cancel()" />
<div (keyup.control.enter)="send()">…</div>

<!-- custom component output -->
<app-search (results)="handle($event)"></app-search>
```

### Two-way binding `[( )]` ("banana in a box")

Sugar for a property binding **and** an event binding. Requires a matching
`@Input() x` + `@Output() xChange` pair (or a signal `model()`).

```html
<input [(ngModel)]="name" />          <!-- needs FormsModule -->
<!-- equivalent to: -->
<input [ngModel]="name" (ngModelChange)="name = $event" />

<!-- custom two-way input -->
<app-counter [(value)]="count"></app-counter>
```

```ts
// Component author side — signal-based two-way binding (modern):
import { model } from '@angular/core';
value = model<number>(0);            // enables [(value)] on this component
```

---

## 3. Template expression operators

```html
<!-- Safe navigation (?.) — short-circuits to null instead of throwing -->
<p>{{ user?.address?.city }}</p>

<!-- Nullish coalescing (??) -->
<p>{{ nickname ?? 'Anonymous' }}</p>

<!-- Non-null assertion (!) — tells the type checker "not null/undefined" -->
<p>{{ user!.name }}</p>

<!-- Pipe (|) — transform a value (see §9) -->
<p>{{ price | currency }}</p>

<!-- $any() — escape hatch to disable type checking on a sub-expression -->
<p>{{ $any(item).legacyField }}</p>
```

`?.` is for **runtime** safety (value may be null at runtime). `!` is **compile-time**
only (suppresses the type error, does nothing at runtime).

---

## 4. Template reference variables

Declare a variable in the template with `#name`. By default it refers to the element /
component / directive on that host element. Usable anywhere in the same template.

```html
<input #phone placeholder="phone" />
<button (click)="call(phone.value)">Call</button>

<!-- reference a component/directive instance -->
<app-player #player></app-player>
<button (click)="player.play()">Play</button>

<!-- exportAs: grab a specific directive on the element -->
<input #ctrl="ngModel" [(ngModel)]="email" />
<span *ngIf="ctrl.invalid">Invalid email</span>

<!-- reference a template (for ngTemplateOutlet, etc.) -->
<ng-template #tpl>…</ng-template>
```

---

## 5. `@let` — local template variables

Define a reusable, **read-only** local variable in the template (Angular 18.1+). Scoped to
the current view and its descendants; cannot be reassigned and must be initialized. Ideal
for naming an `async` result once.

```html
@let user = user$ | async;
@let fullName = user?.first + ' ' + user?.last;
@let total = items.reduce((s, i) => s + i.price, 0);

<h2>{{ fullName }}</h2>
<p>Total: {{ total | currency }}</p>

@if (user) {
  <p>Welcome back, {{ user.first }}</p>   <!-- subscribes only once -->
}
```

---

## 6. Built-in control flow

The modern (v17+) way to do conditionals and loops. **No imports needed** — built into the
compiler, no `CommonModule` / `NgIf` / `NgFor`.

### `@if` / `@else if` / `@else`

```html
@if (user.isAdmin) {
  <admin-panel />
} @else if (user.isMember) {
  <member-area />
} @else {
  <p>Please sign in.</p>
}

<!-- alias the condition value with `as` -->
@if (user$ | async; as user) {
  <p>{{ user.name }}</p>
}
```

### `@for`

`track` is **required** — it tells Angular how to identify items for efficient DOM reuse
(use a unique id; `track item` or `track $index` for primitives/static lists).

```html
@for (item of items; track item.id) {
  <li>{{ item.name }}</li>
} @empty {
  <li>No items found.</li>
}
```

Implicit contextual variables inside `@for`:

| Variable | Meaning |
|----------|---------|
| `$index` | zero-based position |
| `$count` | total number of items |
| `$first` | `true` for first item |
| `$last`  | `true` for last item |
| `$even`  | `true` if `$index` is even |
| `$odd`   | `true` if `$index` is odd |

```html
@for (row of rows; track row.id; let i = $index, isLast = $last) {
  <tr [class.last]="isLast">{{ i + 1 }}. {{ row.label }}</tr>
}
```

### `@switch`

No fall-through, no `break`. Comparison is strict (`===`).

```html
@switch (status) {
  @case ('loading') { <spinner /> }
  @case ('error')   { <p>Something went wrong.</p> }
  @case ('done')    { <results [data]="data" /> }
  @default          { <p>Idle</p> }
}
```

---

## 7. `@defer` — lazy loading

Lazily load a block (and its component dependencies as a separate JS chunk) when a trigger
fires. Reduces initial bundle size. Sub-blocks handle the placeholder / loading / error UI.

```html
@defer (on viewport) {
  <heavy-chart [data]="data" />
} @placeholder (minimum 500ms) {
  <p>Scroll down to load the chart…</p>
} @loading (after 100ms; minimum 1s) {
  <spinner />
} @error {
  <p>Failed to load the chart.</p>
}
```

### Triggers — `@defer (on <trigger>)`

| Trigger | Fires when… |
|---------|-------------|
| `on idle` | the browser is idle (default if none given) |
| `on viewport` / `on viewport(ref)` | the element enters the viewport |
| `on interaction` / `on interaction(ref)` | user clicks / keys into the element |
| `on hover` / `on hover(ref)` | pointer hovers / focuses the element |
| `on immediate` | as soon as non-deferred content finishes rendering |
| `on timer(2s)` | a timer elapses |
| `when <expr>` | a boolean expression becomes truthy |

- Combine multiple triggers (OR) with `;` → `@defer (on viewport; on timer(5s))`.
- For `interaction` / `hover` / `viewport` **without** an explicit `(ref)`, a
  `@placeholder` block is **required** — its element becomes the trigger target.
- **Prefetch** the chunk independently of rendering:
  `@defer (on interaction; prefetch on idle) { … }`.

Sub-block options: `@placeholder (minimum 500ms)`, `@loading (after 100ms; minimum 1s)`
(`after` = wait this long before showing; `minimum` = show at least this long once shown).

---

## 8. Legacy structural directives

Pre-v17 syntax. Still fully supported; the `*` is sugar that wraps the host element in an
`<ng-template>`. Requires `CommonModule` (or the individual `NgIf`/`NgForOf`/`NgSwitch`).

### `*ngIf`

```html
<div *ngIf="isLoggedIn">Welcome</div>

<!-- else -->
<div *ngIf="isLoggedIn; else login">Welcome</div>
<ng-template #login><a>Sign in</a></ng-template>

<!-- then / else -->
<div *ngIf="ready; then content else loading"></div>
<ng-template #content>…</ng-template>
<ng-template #loading><spinner /></ng-template>

<!-- bind + alias the (async) result with `as` -->
<div *ngIf="user$ | async as user">{{ user.name }}</div>
```

### `*ngFor`

```html
<li *ngFor="let item of items;
            trackBy: trackById;
            let i = index;
            let first = first; let last = last;
            let even = even; let odd = odd">
  {{ i }}: {{ item.name }}
</li>
```

```ts
trackById(index: number, item: Item) { return item.id; }
```

### `*ngSwitch`

`ngSwitch` is a plain attribute binding; the cases are structural directives.

```html
<div [ngSwitch]="status">
  <spinner   *ngSwitchCase="'loading'" />
  <p         *ngSwitchCase="'error'">Error</p>
  <results   *ngSwitchCase="'done'" [data]="data" />
  <p         *ngSwitchDefault>Idle</p>
</div>
```

**Desugaring** — `*ngIf="c"` is shorthand for:

```html
<ng-template [ngIf]="c"><div>…</div></ng-template>
```

> Only one structural directive (`*…`) per element. Need two? Nest with `<ng-container>`
> (see §10) or switch to the new `@if`/`@for` blocks, which nest freely.

---

## 9. Pipes

Transform a displayed value with `|`. Pipes are pure functions applied left-to-right.

```html
{{ value | pipeName }}                       <!-- basic -->
{{ value | pipeName:arg1:arg2 }}             <!-- with parameters -->
{{ value | pipe1 | pipe2 }}                   <!-- chained -->
{{ price | currency:'EUR':'symbol':'1.2-2' }}
```

### Built-in pipes (`@angular/common`)

| Pipe | Purpose | Example |
|------|---------|---------|
| `async` | Subscribe to a `Promise`/`Observable`; auto-unsubscribe | `{{ data$ \| async }}` |
| `date` | Format a date by locale & format string | `{{ now \| date:'medium' }}` |
| `uppercase` | UPPERCASE text | `{{ name \| uppercase }}` |
| `lowercase` | lowercase text | `{{ name \| lowercase }}` |
| `titlecase` | Title Case Text | `{{ name \| titlecase }}` |
| `currency` | Format as currency | `{{ p \| currency:'USD' }}` |
| `number` | Decimal/number formatting (DecimalPipe) | `{{ n \| number:'1.0-2' }}` |
| `percent` | Format as a percentage | `{{ ratio \| percent }}` |
| `json` | `JSON.stringify` (debugging) | `<pre>{{ obj \| json }}</pre>` |
| `slice` | Slice an array or string | `{{ list \| slice:0:5 }}` |
| `keyvalue` | Object/Map → `{ key, value }[]` | `@for (e of map \| keyvalue; …)` |
| `i18nPlural` | Pluralize by a count map | `{{ n \| i18nPlural:mapping }}` |
| `i18nSelect` | Pick a string by key | `{{ gender \| i18nSelect:map }}` |

Common format examples:

```html
{{ today | date:'yyyy-MM-dd HH:mm' }}      <!-- 2026-06-19 14:30 -->
{{ today | date:'fullDate' }}              <!-- Friday, June 19, 2026 -->
{{ 1234.5 | number:'1.2-2' }}              <!-- 1,234.50 -->
{{ 0.1234 | percent:'1.1-1' }}             <!-- 12.3% -->
{{ 9.99 | currency:'GBP':'symbol':'1.2-2' }}  <!-- £9.99 -->
{{ longText | slice:0:100 }}…
```

The `number` / `currency` / `percent` digit format is `{minIntegers}.{minFractions}-{maxFractions}`.

### `async` pipe (most important)

Subscribes for you and unsubscribes automatically when the component is destroyed —
avoids manual subscription leaks.

```html
@if (user$ | async; as user) {
  <p>{{ user.name }}</p>
}
<ul>
  @for (todo of todos$ | async; track todo.id) { <li>{{ todo.title }}</li> }
</ul>
```

### Pure vs impure pipes

- **Pure** (default): re-runs only when the input *reference* changes. Fast, cached.
- **Impure** (`pure: false`): re-runs on every change-detection cycle (e.g. `async`,
  `keyvalue` are impure). Use sparingly — can hurt performance.

### Custom pipe

```ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'truncate', standalone: true })   // pure by default
export class TruncatePipe implements PipeTransform {
  transform(value: string, limit = 20, trail = '…'): string {
    return value.length > limit ? value.slice(0, limit) + trail : value;
  }
}
```

```html
{{ description | truncate:50 }}
{{ description | truncate:50:' →' }}
```

---

## 10. Content projection & template containers

### `<ng-content>` — content projection (transclusion)

Projects markup the parent placed between your component's tags into the component's view.

```html
<!-- card.component.html -->
<div class="card">
  <header><ng-content select="[card-title]"></ng-content></header>
  <div class="body"><ng-content></ng-content></div>   <!-- default slot -->
  <footer>
    <ng-content select="card-actions">
      <button>OK</button>   <!-- fallback content if none projected (v18+) -->
    </ng-content>
  </footer>
</div>
```

```html
<!-- usage -->
<app-card>
  <h2 card-title>Title</h2>
  <p>Body goes in the default slot.</p>
  <card-actions><button>Save</button></card-actions>
</app-card>
```

`select` accepts any CSS selector (element, `.class`, `[attr]`). Use `ngProjectAs="sel"` to
make an `<ng-container>` match a projection slot.

### `<ng-container>` — grouping with no DOM element

A logical wrapper that renders **nothing** itself. Great for applying a structural
directive without adding a wrapper element, or for stacking multiple structural directives.

```html
<ng-container *ngIf="user">
  <h2>{{ user.name }}</h2>
  <p>{{ user.bio }}</p>
</ng-container>

<!-- two structural directives, no extra DOM -->
<ng-container *ngFor="let row of rows">
  <tr *ngIf="row.visible">{{ row.label }}</tr>
</ng-container>
```

### `<ng-template>` + `ngTemplateOutlet` — reusable template fragments

`<ng-template>` defines markup that is **not rendered** until something stamps it out.

```html
<ng-template #greeting let-name let-formal="formal">
  <p>{{ formal ? 'Good day' : 'Hi' }}, {{ name }}!</p>
</ng-template>

<ng-container
  *ngTemplateOutlet="greeting; context: { $implicit: 'Sam', formal: true }">
</ng-container>
```

- `let-x` binds context property `x`; `let-y="key"` binds context property `key`.
- `$implicit` is the default value bound by `let-x` with no key.

---

## 11. Built-in attribute directives

```html
<!-- ngClass: object | array | string -->
<div [ngClass]="{ active: isActive, disabled: !enabled }">…</div>
<div [ngClass]="['card', theme]">…</div>

<!-- ngStyle: object of CSS properties (supports unit suffix keys) -->
<div [ngStyle]="{ color: color, 'font-size.px': size }">…</div>

<!-- ngModel: two-way form binding (needs FormsModule) -->
<input [(ngModel)]="username" name="username" />
```

> For static or single toggles prefer the native `[class.x]` / `[style.x]` bindings (§2) —
> they're lighter than `ngClass` / `ngStyle`.

---

## 12. Signals in templates

Signals are read by **calling** them like a function. The template re-renders the parts
that depend on a signal when its value changes (fine-grained, zoneless-friendly).

```ts
count = signal(0);
double = computed(() => this.count() * 2);
increment() { this.count.update(n => n + 1); }
```

```html
<p>{{ count() }} × 2 = {{ double() }}</p>
<button (click)="increment()">+</button>

@if (count() > 10) { <p>High!</p> }
@for (item of items(); track item.id) { <li>{{ item.name }}</li> }

<!-- signal inputs / model() also work directly -->
<app-child [value]="count()" [(open)]="isOpen" />
```

---

## 13. Misc

### Animations

```html
<div [@fadeInOut]="state" (@fadeInOut.done)="onDone($event)">…</div>
```

### Self-closing component tags (v16+)

```html
<app-spinner />
<app-user [user]="u" />
```

### Security & sanitization

- Interpolation `{{ }}` and property bindings are **auto-sanitized/escaped**.
- `[innerHTML]` is sanitized (scripts/handlers stripped) — safe-ish but bypasses Angular
  rendering; prefer real templates.
- To intentionally trust a value, inject `DomSanitizer` and use
  `bypassSecurityTrustHtml/Url/...` (only for values you control).

```html
<div [innerHTML]="trustedHtml"></div>
```

### Internationalization (`i18n`)

```html
<h1 i18n="@@homeTitle">Welcome</h1>
<img [src]="logo" i18n-alt alt="Company logo" />   <!-- translate an attribute -->
```

### `$any()` type-cast escape hatch

```html
{{ $any(widget).undeclaredProp }}
```

---

## 14. Quick-reference cheat sheet

```html
{{ expr }}                         <!-- interpolation (auto-escaped) -->
[prop]="expr"                      <!-- property binding -->
[attr.x]="expr"                    <!-- attribute binding -->
[class.x]="bool"  [class]="obj"    <!-- class binding -->
[style.x.px]="n"  [style]="obj"    <!-- style binding -->
(event)="stmt()"                   <!-- event binding ($event available) -->
[(x)]="prop"                       <!-- two-way binding -->
#ref                               <!-- template reference variable -->
@let x = expr;                     <!-- local template variable (v18.1+) -->

@if (c) {} @else if (c) {} @else {}        <!-- conditional (v17+) -->
@for (i of xs; track i.id) {} @empty {}    <!-- loop; track required -->
@switch (v) { @case (a) {} @default {} }   <!-- switch -->
@defer (on viewport) {} @placeholder {} @loading {} @error {}   <!-- lazy -->

*ngIf="c; else ref"                <!-- legacy conditional -->
*ngFor="let i of xs; trackBy: fn"  <!-- legacy loop -->
[ngSwitch] / *ngSwitchCase         <!-- legacy switch -->

{{ v | pipe:arg }}                 <!-- pipe: async date currency number
                                        percent json slice keyvalue uppercase
                                        lowercase titlecase i18nPlural i18nSelect -->

a?.b   x ?? y   z!   $any(w)        <!-- safe-nav, nullish, non-null, cast -->

<ng-content select="[slot]" />     <!-- content projection -->
<ng-container>…</ng-container>     <!-- no-DOM grouping -->
<ng-template #t let-x>…</ng-template>  <!-- + *ngTemplateOutlet="t; context:{}" -->
[ngClass]  [ngStyle]  [(ngModel)]  <!-- attribute directives -->
signal()                           <!-- read a signal in a template -->
```
