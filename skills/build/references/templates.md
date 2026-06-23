# Templates — Angular-flavored HTML

A `template.html` is HTML with Angular-style bindings, evaluated against the component's
`logic.ts` scope (the class instance, or the object `setup()` returns). No JSX, no Preact.
Bindings are parsed at build time (tree-sitter) and rendered to HTML on the server;
`(event)` bindings wire up at hydration (so they need a `logic.ts`).

## Interpolation

```html
<h1>Hello, {{ name }}</h1>
<p>{{ count() }} item(s)</p>            <!-- call a signal/method to read it -->
<span>{{ ok ? '✓' : '✗' }}</span>      <!-- expressions, ternaries, member access -->
```
Interpolated text is **HTML-escaped**. To inject trusted HTML use `[innerHTML]`.

## Property / input bindings — `[prop]="expr"`

One-way bind a DOM property or a child component's input:

```html
<button [disabled]="busy()">Save</button>
<input [value]="query" />
<article [innerHTML]="renderedMarkdown"></article>      <!-- trusted: not escaped -->
<count-display [value]="count()"></count-display>       <!-- input into a child component -->
```

## Event bindings — `(event)="handler()"`

Bind a DOM event to a scope method. Runs **only after hydration**, so the component needs a
`logic.ts`:

```html
<button (click)="inc()">+1</button>
<form (submit)="save()">…</form>
```

## Control flow blocks

```html
@if (user()) {
  <p>Hi {{ user().name }}</p>
} @else {
  <a href="/ui/login">Sign in</a>
}

@for (item of items; track item.id) {
  <li>{{ item.title }}</li>
} @empty {
  <li>Nothing yet.</li>
}
```
`@for` needs a `track` expression (a stable key). `@empty` renders when the list is empty.

## Composing components

Render another folder-component by its **selector** (the folder basename), passing inputs
with `[in]` and listening with `(ev)`:

```html
<ui-button id="increment" content="+1" (click)="inc()"></ui-button>
<badge></badge>
```
A child folder named `components/ui-button/` is `<ui-button>`. If it has a `logic.ts` it
hydrates as its own island; if static it renders inline with zero JS.

## Projection — `<ng-content>`

A component projects its children into its own template where it places `<ng-content>`:

```html
<!-- components/card/template.html -->
<section class="card"><ng-content></ng-content></section>
```
```html
<!-- usage -->
<card><p>projected into the card</p></card>
```

## The shell + `<router-outlet>`

`src/shell/template.html` is the document layout; the matched page renders where you place
`<router-outlet>`:

```html
<div class="app-root"><router-outlet></router-outlet></div>
```

## Styles

A folder's `styles.css` is **component-scoped** by the build (a path-derived marker), so
selectors can't leak between components. App-wide styles (tokens, resets, fonts) go in the
shell.
