<sub>[← sprig docs](./README.md)</sub>

# Folder-components

In sprig a **folder is a component**. A component is a directory containing up to four
convention-named files:

| file | role | required |
|---|---|---|
| `template.html` | the markup (Angular-flavoured). Its presence makes the folder a component. | **yes** |
| `styles.css` | view-encapsulated styles for this component | no |
| `logic.ts` | island reactive scope (`export default defineComponent(...)`). **Its presence ⇒ this folder is an island.** | no |
| `resolve.ts` | **pages only** — server-side data loader; its return becomes the page's `@inputs` | no |

The compiler scans `src/` for every `template.html` and registers the enclosing folder as
a component whose **selector is the folder basename** (`shared-components/counter/` →
`<counter>`).

## The three kinds of component

```
src/
  shell/                      # the root LAYOUT — must contain <router-outlet></router-outlet>
  pages/
    <page>/                   # a PAGE — routed, STATIC (never an island)
      template.html
      resolve.ts
      components/
        <name>/               # a PAGE-LOCAL component (shadows a same-named global, in this page only)
  shared-components/
    <name>/                   # a GLOBAL, reusable component (may be an island)
  services/
    <domain>/mod.ts           # not a component — an @Injectable data layer (see data-and-di.md)
```

- **Pages** (`pages/<name>/`) are routed via `defineRoutes`. A page **cannot be an island** —
  the compiler throws if it finds `pages/<name>/logic.ts`. Put interactivity in a
  shared-component or a page-local component and place its tag in the page template.
- **Shared-components** (`shared-components/<name>/`) are globally reusable by tag and may be
  islands.
- **Page-local components** (`pages/<page>/components/<name>/`) are scoped to one page and
  **shadow** a same-named global component *within that page only*.

## Identity is the folder path, not the basename

A component's identity is its folder path relative to `src/` — **not** just its basename. The
compiler keeps two registries:

- a **global** map keyed by basename (shared / shell / page components) — a basename
  collision here **throws** loudly (`duplicate component selector "…"`), instead of the old
  silent last-write-wins clobber;
- a **page-local** map (`page → selector → def`) whose entries shadow globals for that page.

So `shared-components/issue-card/` and `pages/board/components/issue-card/` coexist: each gets
a **distinct view-encapsulation scope id** (derived from the full path), so their styles never
cross-apply. See [styling.md](./styling.md).

> Islands additionally register/hydrate by selector on the client, so **two islands cannot
> share a basename** — `sprig build` fails loudly if they do. Rename one folder.

## A minimal page

```html
<!-- pages/home/template.html — `name` arrives from resolve.ts -->
<main class="home">
  <h1>Hello, {{ name }} 👋</h1>
</main>
```

```ts
// pages/home/resolve.ts
import type { Resolve } from "@sprig/core";
export const resolve: Resolve = () => ({ name: "sprig" });
```

The shell wraps every page; its `<router-outlet>` is replaced with the matched page:

```html
<!-- shell/template.html -->
<div class="app-root">
  <router-outlet></router-outlet>
</div>
```

A component embeds another by tag, passing `@inputs` via `[prop]` bindings:

```html
<!-- pages/workbench/template.html -->
<workbench [cases]="cases" [problems]="problems" [previewBase]="previewBase"></workbench>
```

---

**Next:** [templates.md](./templates.md) — the full template syntax.
**See also:** [islands.md](./islands.md) · [routing.md](./routing.md) · [styling.md](./styling.md)
