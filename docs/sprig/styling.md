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
.cta { @apply inline-flex items-center rounded-md px-3 py-1.5 font-medium; }
```

(Not `.btn` — that name belongs to daisyUI, see the next section.)

## daisyUI is in the build — reserved class names

The build also loads **daisyUI 5** as a Tailwind plugin (`@plugin "daisyui" { themes: false }`,
pinned by sprig, not by your app). Its *themes* are off — your `css-variables.json` tokens are the
brand — but its **components are on**: write `<button class="btn btn-primary">` or
`<div class="card">` in any template and daisyUI's button/card rules are emitted into `app.css`.
That is the point. The trap is the flip side:

**daisyUI's rules are document-global and are emitted on demand.** Tailwind scans your
templates for class tokens; the moment it sees one that names a daisyUI component (`stat`,
`badge`, `list`, `status`…) it emits that component's rules, targeting the **bare class**,
unscoped, in a `daisyui.*` layer. View encapsulation protects your rules from *other
components' rules*; it does nothing against daisyUI, because daisyUI's rule matches the bare
class on the same element.

So this (from a real island — an 8px status dot):

```css
/* islands/coms-island/styles.css */
.coms-island .stat { width: 8px; height: 8px; border-radius: 9999px; }
```

renders as a **daisyUI stat block**: your scoped rule is unlayered, so it wins on the three
properties it sets — and daisyUI's `.stat { display: inline-grid; padding-inline: 1.5rem;
padding-block: 1rem; grid-template-columns: … }` supplies everything it doesn't. Under
Preflight's `box-sizing: border-box` the 8px box can't shrink below its own padding, so the
"dot" is a 48×32px inline-grid cell. (Verified against `daisyui@5.7.28`: only the `.stat`
rules were emitted, nothing for `btn`/`card`, because only `stat` appeared in the template.)

"Fully reset it" is the wrong fix — the property set is daisyUI's, and it changes between
minor versions. **Rename your element. `sprig build` / `sprig dev` warn when a component's
`styles.css` targets any class the bundled daisyUI defines** (bare names and their parts and
modifiers — the exact set is read from the installed package, so it always matches the version
the build just compiled with):

```
sprig: islands/coms-island/styles.css styles .stat, .stat-value — daisyUI (bundled by the build)
styles the same class name(s) globally, so these rules only override the properties they set on
top of daisyUI's. Unless you mean the daisyUI component, rename with your own prefix
(e.g. .co-stat). See docs/sprig/styling.md → "Reserved class names".
```

The warning is exact: `.statistic`, `.dock-tab` or `.list-item` don't fire, because daisyUI
defines no such class *today*. Which is why the convention below reserves the whole prefix.

### The reserved list (`daisyui@5.7.28`)

Every bare name below is a daisyUI component or utility with its own global rule. Each one also
owns its **`<name>-*` namespace** — parts and modifiers like `stat-title`, `stat-value`,
`btn-sm`, `card-body`, `menu-title`, `list-row`, `tab-content`, `chat-bubble`,
`badge-primary` (653 class names in all) — and daisyUI adds to those namespaces in minor
releases, so treat the whole prefix as taken:

`alert` `aura` `avatar` `badge` `breadcrumbs` `btn` `cally` `card` `carousel` `chat` `checkbox`
`collapse` `countdown` `diff` `divider` `dock` `drawer` `dropdown` `fab` `fieldset` `filter`
`footer` `glass` `hero` `indicator` `input` `join` `kbd` `label` `link` `list` `loading` `mask`
`megamenu` `menu` `modal` `navbar` `otp` `progress` `radio` `range` `rating` `select`
`skeleton` `stack` `stat` `stats` `status` `step` `steps` `swap` `tab` `table` `tabs`
`textarea` `timeline` `toast` `toggle` `tooltip` `validator` `vc`

The generic ones bite hardest: `status`, `list`, `label`, `link`, `filter`, `stack`, `table`,
`toggle`, `indicator`, `loading`, `footer`, `hero`, `mask`, `diff`, `collapse`, `step`.

Footnotes (not warned on, but daisyUI's): `.disabled` is a qualifier under `.menu`
(`li.disabled`), `.prose` gets `--tw-prose-*` variables, and `.step` only matches inside
`.steps`. Responsive twins (`sm:toast`, `lg:join`) follow their root.

This list mirrors `DAISYUI_RESERVED_CLASSES` in `framework/.sprig/compiler/build.ts` — the
build's fallback when it can't read the installed package, and a test keeps the two in sync.
To regenerate it after a daisyUI bump, run `installedDaisyuiClasses("~/.cache/sprig-tailwind")`
from that file (it reads the package's `components/*.css` + `utilities/*.css`, selectors only)
and keep the names without a hyphen.

### The convention: prefix your own classes

Pick a short prefix per app or per component and use it for **every class you style
yourself** — a name that is yours can never be daisyUI's tomorrow either:

```css
/* islands/coms-island/styles.css — `cm-` is this app's prefix */
.cm-root { display: flex; gap: .5rem; }
.cm-dot  { width: 8px; height: 8px; border-radius: 9999px; }   /* was .stat */
.cm-dot--online { background: var(--color-success); }
```

sprig's own isolate workbench does exactly this after hitting the same collision on `dock`,
`badge`, `kbd` and `toast`: its chrome is `wb-dock`, `wb-badge`, `wb-kbd`, `wb-toast`.

Two-letter app prefixes (`cm-`, `wb-`) or the component's name (`coms-dot`) both work; BEM
modifiers (`--sm`) on a prefixed block are fine. The only rule: **don't start a class you
style with a reserved name or `<reserved>-`.** Unprefixed names that aren't reserved
(`.counter`, `.hdot`) are safe today but one daisyUI release away from not being.

Conversely, when you *want* the daisyUI component, use its own names and modifiers as
documented (`btn btn-sm`, `stat` + `stat-title`/`stat-value`) and let the theme tokens style
it — `status` is daisyUI's own 0.5rem status dot (`status status-success`), which is what the
island above ended up wanting.

---

**Next:** [data-and-di.md](./data-and-di.md) — loading data.
**See also:** [folder-components.md](./folder-components.md) · [architecture.md](./architecture.md)
