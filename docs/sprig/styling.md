<sub>[← sprig docs](./README.md)</sub>

# Styling & view encapsulation

Each component's `styles.css` is **view-encapsulated** — its rules can only land on that
component's own elements. sprig uses Angular's "Emulated" model (no Shadow DOM, so it's
SSR-friendly).

## How it works

Every component gets a stable **scope id** derived from its **unique folder path** (FNV-1a
hash of the path relative to `src/`, e.g. `s1a2b3c4d`). Two mechanisms share that id:

1. **At SSR**, every native element the component's template emits carries the scope id as a
   bare marker attribute (`<div s1a2b3c4d class="card">…`).
2. **At build**, each rule in the component's `styles.css` is rewritten so its **rightmost
   (key) compound** also requires that marker: `.card h3 { }` → `.card h3[s1a2b3c4d] { }`.

Result: a rule from component A can never match an element of component B (which carries B's
marker). Rightmost-only scoping is sufficient because the *styled* element always carries the
marker.

Because the id comes from the **path** (not the basename), `shared-components/issue-card/` and
`pages/board/components/issue-card/` get **different** ids — their styles never collide. See
[folder-components.md](./folder-components.md).

```css
/* shared-components/counter/styles.css — scoped to <counter>'s elements only */
.counter { display: flex; gap: .5rem; }
.counter button { padding: .25rem .75rem; }
```

## Escaping encapsulation: `:global`

Use `:global(...)` for document-level rules (the key compound is left unscoped):

```css
:global(body) { margin: 0; }
:global(:root) { --accent: #c2410c; }
```

Typically the **shell**'s `styles.css` holds your `:global(body)` / `:global(:root)` rules.

`@keyframes`, `@font-face`, `@page`, `@property`, `@charset`, `@import`, `@namespace`, and
`@counter-style` bodies are left **unscoped** (their content isn't a list of style rules).
Rule-bearing at-rules (`@media`, `@supports`, `@container`, `@layer`, `@starting-style`, …) are
recursed into, so their inner rules get the marker too. `:host` / `:host(x)` /
`:host-context(x)` map to the scope marker as you'd expect.

## The scope id is consistent across SSR / CSS / hydrate

The same path-derived id is stamped by the SSR renderer, baked into the scoped `app.css`, and
**carried in each island's chunk** so the client re-render re-emits the *same* marker. That's
why scoped styles survive hydration and a reactive re-render — the morphed DOM keeps its
markers.

## Tailwind

`sprig build` runs the Tailwind v4 CLI over your component CSS and templates:

- `@apply` works inside component `styles.css`.
- Utility classes used in `template.html` files are scanned and emitted (`@source` points at
  your `src/**/*.html`).
- Everything is concatenated, scoped, Tailwind-expanded, minified → one `static/app.css`,
  linked from every SSR document with the `?v=` cache-buster.

```css
.btn { @apply inline-flex items-center rounded-md px-3 py-1.5 font-medium; }
```

---

**Next:** [data-and-di.md](./data-and-di.md) — loading data.
**See also:** [folder-components.md](./folder-components.md) · [architecture.md](./architecture.md)
