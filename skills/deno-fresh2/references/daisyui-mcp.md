# daisyUI MCP — accessible component structure, fast (then make it yours)

> The `daisyui-blueprint` MCP server gives this skill two tools for building Fresh
> UIs out of daisyUI 5: **`daisyUI-Snippets`** (a searchable catalog of components,
> layouts, templates, and themes — each returned with its class vocabulary, a
> copy-paste markup skeleton, **and a rendered screenshot**) and
> **`Figma-to-daisyUI`** (read a Figma node → pick the snippets that recreate it →
> emit daisyUI markup). It's the fast path to *correct, accessible structure*. It is
> **not** the design — see *The contract* below. SKILL.md's "Make it look good"
> section is the bar; this file is the mechanics.

## When to reach for it

- You need a **correct, accessible** version of a common component (navbar, modal,
  dropdown, tabs, drawer, table, form controls, toast, steps, stat, timeline…) and
  don't want to hand-roll the ARIA roles, focus order, and responsive markup.
- You want an **interactive-looking** component (dropdown, modal, collapse,
  accordion, theme switch) **without shipping an island** — daisyUI's CSS-only
  variants are a near-perfect fit for Fresh's zero-JS model (see *The Fresh win*).
- You're rebuilding a **Figma** mock and want a structural first pass.
- You're scaffolding components into **isolate** and want a real screenshot as a
  structure reference for the rendered case.

Skip it when the surface is a bespoke, signature layout — the MCP gives you generic
scaffolding, and a one-off hero/masthead is exactly where generic scaffolding is the
wrong starting point.

## The contract — structure ≠ a finished design

daisyUI gives you the accessible **component scaffolding that sits *beneath* the bar**
— and **none** of the four non-negotiables SKILL.md's "Make it look good" actually
demands. Those four are distinctive **typography**, a **motion layer**,
**depth/atmosphere**, and **a signature moment**; daisyUI delivers zero of them, and
its *default* theme is precisely the tidy-but-generic look the skill calls a failure.
So treat it as a head start on the markup, never as progress against the design bar —
the rule is non-negotiable:

> **Use the MCP for the markup skeleton and class vocabulary; then re-theme it with a
> custom daisyUI theme and layer on your own type, motion, atmosphere, and signature
> moment.** Stock daisyUI shipped as-is fails the bar exactly like an untouched starter
> does.

Concretely: pull the snippet → paste the structure → swap the default theme for a
**custom `@plugin "daisyui/theme"`** (below) → load a real display+body font pairing
in `_app.tsx` → add the entrance/scroll motion and gradient/grain/shadow depth from
`frontend-design.md` → design the one **signature moment** per screen daisyUI will
never give you. The MCP removes the boilerplate; you still owe all four pillars.

## Calling `daisyUI-Snippets`

**Nested-object args, never an array** — the tool rejects `["components/button"]`.
Each top-level key is a *category*; under it, set the snippet to `true`:

```jsonc
// categories: components · component-examples · layouts · templates · themes
{ "components": { "button": true, "card": true },
  "layouts":   { "top-navbar": true },
  "themes":    { "custom-theme": true } }
```

**It's a two-level fetch.** The `components.<name>` entry returns the component's
**class-name vocabulary** (grouped by role — component, **part** (child elements like
`card-body`/`modal-box`), color, style, size, modifier, placement, … per the tool's
type reference), a **markup skeleton** with placeholder tokens like `{CONTENT}`, a
**screenshot**, and a list of
`components/<name>/examples/*`. For full copy-paste markup of a specific variant,
request it from the **`component-examples`** category, keyed `<name>.<example>`:

```jsonc
{ "component-examples": { "card.pricing-card": true,
                          "modal.modal-using-checkbox": true } }
```

So the loop is: pull the component to learn the vocabulary and see the screenshot →
pull the one or two `component-examples` that match what you're building → adapt.
`layouts` (top-navbar, drawer-sidebars, bento grids) and `templates` (login-form,
dashboard) return whole compositions in one shot — start there for page shells.
`themes` returns `colors` (the semantic palette reference), `builtin-themes`, and
`custom-theme` (the token template you'll actually use).

## The Fresh win — CSS-only interactivity needs no island

This is the reason daisyUI pays off in Fresh specifically. Fresh server-renders
every page and hydrates **only** islands; most daisyUI "interactive" components are
**pure CSS/HTML** with no script, so they render and work from the SSR'd HTML with
**zero JS shipped** — no island, no hydration, no serialization rules. Verified
against the real snippet markup:

| Component | Zero-JS mechanism | Island needed? |
|---|---|---|
| dropdown | `<details><summary>` (or popover API, or CSS `:focus`) | **No** |
| collapse / accordion | `<details><summary>` (or checkbox) | **No** |
| modal | the `modal-toggle` checkbox opens **and** closes with no JS; the native `<dialog>` variant needs JS (`showModal()`) to *open* as a real top-layer modal but closes free via `<form method="dialog">` | **No** for the checkbox variant; a tiny island only to *open* a `<dialog>` |
| theme switch / dark mode | `<input type="checkbox" value="theme" class="theme-controller">` | **No** |
| drawer / sidebar | `drawer-toggle` checkbox | **No** |
| tabs | radio inputs (`tabs` + `tab-content`) | **No** |

A theme/dark-mode toggle with **no island** is the headline example:

```tsx
// Server component — ships zero JS, flips the page to your "mydark" theme on click.
// `value` must name a theme you've defined/enabled (see the custom theme below);
// a stock name like "synthwave" does nothing unless you explicitly enable it, and
// switching *to* a stock theme is the generic look this doc forbids anyway.
<input type="checkbox" value="mydark" class="toggle theme-controller" />
```

Reach for an island **only** when the interaction needs real client state (a value
that drives other logic, a fetch, an animation tied to JS) — not merely to open a
menu or a dialog. Prefer the CSS-only variant first; it's the Fresh-idiomatic choice.

## Pasting snippets into Preact/JSX

Snippets are **HTML**, and Preact takes HTML attributes almost verbatim — usually a
near-1:1 paste. The things that actually bite:

- **`class` is correct** — keep it; don't "fix" it to `className`. `for`, `tabindex`,
  `role`, `popover`, and kebab-case SVG attrs (`stroke-linecap`) all work in Preact
  as written. No translation needed.
- **Inline string handlers are NOT valid JSX.** The dialog-modal example ships
  `onclick="my_modal_1.showModal()"` — that string attribute does nothing in Preact.
  Two fixes: (a) use the **checkbox-open** modal variant (zero JS, still server-only),
  or (b) move the trigger into an **island** with a real function:
  `onClick={() => (document.getElementById("my_modal_1") as HTMLDialogElement).showModal()}`.
  The `<form method="dialog">` close button needs no JS once the dialog is open.
  (daisyUI labels the checkbox/anchor-link modal variants *"(legacy)"* and prefers
  `<dialog>` + `showModal()`, which needs JS — but the checkbox variant is the
  deliberate zero-island choice for Fresh and still ships in daisyUI 5.)
- **`<dialog>` / `<details>` / `<input>` toggles render fine server-side** — they're
  the zero-JS path above. A snippet's comment like "Put this before `</body>`" is just
  DOM-order advice; place the element wherever the JSX tree puts it.
- **`style="anchor-name:--x"`** (popover/anchor dropdowns) is a *string* in HTML; in
  JSX pass an object — `style={{ anchorName: "--x" }}` — or keep the `<details>`
  variant and avoid the issue.
- **Multi-element snippets** (a trigger + a separate dialog/checkbox block) must live
  in the **same component** so Preact owns the whole subtree; don't split the pair
  across a server component and an island.

## Wiring daisyUI into the build

daisyUI is a Tailwind plugin; load it in the **global** stylesheet that `client.ts`
imports (`assets/styles.css`) — the one place app-wide CSS belongs (SKILL.md,
*Component-scoped CSS*). Scaffold the project with `--tailwind` so `@tailwindcss/vite`
is already wired (`advanced/vite.md`), then:

```sh
deno i -D npm:daisyui@latest
```

```css
/* assets/styles.css — imported from client.ts */
@import "tailwindcss";
@plugin "daisyui";                 /* default themes — replace per below */
```

This is daisyUI **5** + Tailwind **4** (note the `@plugin` directive, not a
`tailwind.config.js` `plugins:` array — that's the v3/daisyUI-4 shape; don't
reconstruct it). `examples/daisyui.md` is the same wiring in brief.

## The bridge to world-class — a custom theme

This is where you discharge the contract. Replace the bare `@plugin "daisyui"` with a
**custom theme** so every `btn-primary`/`bg-base-100` renders *your* palette, not the
default:

```css
@import "tailwindcss";
@plugin "daisyui";
@plugin "daisyui/theme" {
  name: "mytheme";
  default: true;
  color-scheme: light;
  --color-base-100: oklch(98% 0.02 240);
  --color-base-content: oklch(20% 0.05 240);
  --color-primary: oklch(55% 0.30 240);
  --color-primary-content: oklch(98% 0.01 240);
  /* …all semantic colors… plus: */
  --radius-box: 0.5rem;   /* card/modal/alert radius */
  --radius-field: 0.25rem;/* button/input/tab radius */
  --depth: 1;             /* 0|1 — subtle 3D depth */
  --noise: 0;             /* 0|1 — grain on components */
}
```

Pull the full token template with `{ "themes": { "custom-theme": true } }` — **all**
the `--color-*` / `--radius-*` / `--size-*` / `--border` / `--depth` / `--noise`
variables are required. Then:

- **Use semantic color names, never raw Tailwind grays.** `bg-base-100`,
  `text-base-content`, `btn-primary` re-theme automatically and stay readable in
  dark mode; `bg-gray-100`/`text-gray-800` are a fixed color that breaks the moment
  the theme flips (pull `{ "themes": { "colors": true } }` for the full rationale).
  No `dark:` prefixes needed — daisyUI colors are already theme-aware.
- **Define a second theme** (`name: "mydark"; prefersdark: true; color-scheme: dark`)
  and switch with the zero-JS `theme-controller` toggle above — instant dark mode,
  no island.
- **Apply a theme with `data-theme="name"`** on any element — commonly `<html>` in
  `_app.tsx` (`<html data-theme="mytheme">`), or on a section to scope one region.
  `default: true` just makes a theme the implicit one, and the `theme-controller`
  input flips `data-theme` for you.
- **`--radius-*`, `--depth`, `--noise`, `--border` are your texture knobs**, but they
  don't replace the depth/atmosphere pillar — layer your own gradients, grain, and
  shadows on top (`frontend-design.md`).
- daisyUI still gives you **no fonts, no motion, and no signature moment** — load the
  display+body pairing, author the entrance/hover/scroll motion, and design the one
  memorable detail per screen yourself. The MCP got you the components; *those* pillars
  are the difference between "neat" and world-class.

## `Figma-to-daisyUI` — a structural first pass from a mock

Pass a Figma file/node URL; the tool returns the design's structure (frames,
text, colors, layout) and is instructed to then pull the matching `daisyUI-Snippets`
and emit recreating markup. Use it for the **structural** pass, then re-theme and
add character exactly as above — it inherits the same contract (it produces stock
daisyUI structure, not a finished design).

**One caveat:** Figma-to-daisyUI's built-in instructions tell it to request snippets
"in a single array" — ignore that wording; `daisyUI-Snippets` rejects arrays and needs
the nested-object syntax (`{"components":{"name":true}}`) from *Calling* above.

It slots into the **ui-breakdown → rebuild** flow (SKILL.md, *Rebuild from a
ui-breakdown*): when a component spec or the mock has a Figma source, `Figma-to-daisyUI`
is a fast way to get the first structural draft of that component before you wire its
real API, data, and the validation cases. The ui-breakdown's per-component **Events**
section and `isolate/` proposals remain the spec of record; daisyUI is the scaffold
you pour into them, not a replacement for them.

## daisyUI × isolate — scaffold, then verify

A tight loop when building one component (`isolate.md`):

1. Pull the component + the matching `component-examples` snippet; note the
   **screenshot** the MCP returned.
2. Scaffold it at its isolate root (`components/<name>/PascalCase.tsx`), pasting the
   markup with the Preact fixes above; re-theme via your custom theme.
3. Drop in the `isolate/` fixture + cases; `isolate dev` to eyeball the render and
   `isolate test` to run the behavioral checks (from the Events section). Iterate
   until the tests pass.

Use the MCP screenshot as a **structure/layout sanity check, not a pixel target.**
It's a single *default-theme* image of the component's *canonical* example (requesting
the checkbox-modal example returns the same generic `modal.png`), and your custom
theme + fonts + motion are *meant* to diverge from it. `isolate test` is the real
gate; the screenshot only confirms you composed the right parts.

## Rules that bite

- **Args are nested objects, not arrays.** `{components:{button:true}}`.
- **Two-level fetch**: `components.<name>` for vocab+skeleton+screenshot;
  `component-examples.<name>.<example>` for full markup.
- **Don't ship the default theme.** Bare `@plugin "daisyui"` is the generic look the
  skill forbids — always define a custom theme.
- **Keep `class`, not `className`.** And inline `onclick="…()"` strings are dead in
  JSX → CSS-only variant or an island with a real `onClick` function.
- **Prefer CSS-only variants over islands** — dropdown/modal/collapse/drawer/tabs/
  theme-switch all have a no-JS path; an island is for genuine client state only.
- **Semantic colors only** (`base-100`/`primary`/`*-content`), never `gray-*`, so
  themes and dark mode work without `dark:`.
- **daisyUI 5 / Tailwind 4 syntax** (`@import "tailwindcss"; @plugin "daisyui"`), not
  a `tailwind.config.js` plugins array.
- **It's structure, not design** — you still owe typography, motion, atmosphere, and a
  signature moment.

## See also

- `frontend-design.md` — the four pillars daisyUI doesn't cover (type, motion, depth, signature moment)
- `examples/daisyui.md` — the bare install/wiring recipe
- `advanced/vite.md` — Tailwind via `@tailwindcss/vite`
- `concepts/islands.md` · `advanced/serialization.md` — when you *do* need an island
- `isolate.md` — preview/diff a scaffolded component
- daisyUI docs: https://daisyui.com/ · theme generator: https://daisyui.com/theme-generator/
