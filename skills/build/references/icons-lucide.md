# Lucide icons — rendering them in Fresh, mostly zero-JS

> [Lucide](https://lucide.dev/icons/) is a 1600+ icon set of clean, consistent
> **stroke** SVGs (a community fork of Feather). Every icon is just an SVG drawn on a
> 24×24 grid with `stroke="currentColor"` and `stroke-width="2"` — so it inherits text
> color, scales crisply, and in Fresh can ship with **zero JS**. Browse + copy at
> <https://lucide.dev/icons/>. **Which** icon (and its size/weight) comes from the
> ui-breakdown spec; this file is purely **how** to render it correctly in Fresh 2 / Preact.

## Why Lucide fits Fresh

- **The artifact is an SVG, not a script.** An inline Lucide SVG in a server component
  is pure markup — it renders in the SSR'd HTML and ships **no JS**. That's the
  Fresh-idiomatic default for the overwhelmingly-static job icons do.
- **`currentColor` + a 24-grid** means an icon recolors with `color`/`text-*` and sizes
  with one prop — it slots into your theme tokens with no per-icon work.

## Three ways to use it — pick by how many icons and where

### 1. Inline SVG — zero JS, zero dependency (the default for a handful)

On <https://lucide.dev/icons/>, open an icon → **Copy SVG** → paste into JSX. Preact
takes the SVG **verbatim** — `class`, `stroke-width`, `stroke-linecap`, `viewBox` all
work as written (don't rewrite to `className`/camelCase). The copied SVG already uses
`stroke="currentColor"`, so it follows text color for free:

```tsx
// A server component — ships zero JS. Inherits color; sized by the class.
export function ArrowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
         stroke-linejoin="round" class="size-5" aria-hidden="true">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}
```

Best when you need a few icons and don't want a dependency. The cost is verbose,
repeated markup — past a handful, reach for the component package. Keep shared inline-SVG
icons together in `components/icons/`, import them as JSX (never from `static/` — that's
for URL-only assets), and don't give each one an isolate fixture; they're leaf
presentational components.

### 2. `lucide-preact` components — ergonomic, official, names match the gallery

```sh
deno add npm:lucide-preact    # resolves the latest and pins it into deno.json's imports
```

```tsx
import { Menu, Search, ArrowRight } from "lucide-preact";

// Icon names are PascalCase of the gallery slug: `arrow-right` → ArrowRight, `menu` → Menu.
<Menu />                                  {/* 24px, currentColor, stroke 2 */}
<Search size={18} class="text-primary" /> {/* sized + recolored */}
<ArrowRight size={20} strokeWidth={1.5} absoluteStrokeWidth />
```

**Use the `-preact` package, not `lucide-react`** (the React one pulls in React).
Props (defaults straight from the source):

| Prop | Default | Effect |
|---|---|---|
| `size` | `24` | width *and* height in px |
| `color` | `"currentColor"` | stroke color — leave it to inherit `color`/`text-*` |
| `strokeWidth` | `2` | line weight (try `1.5` for a lighter, more refined feel) |
| `absoluteStrokeWidth` | `false` | keep stroke a **constant** visual width as `size` changes (computes `strokeWidth*24/size`) |
| `class` | — | merged onto the built-in `lucide` class (so every icon also has `class="lucide …"`) |
| …any SVG attr | — | `aria-label`, `onClick` (island only), `fill`, etc. pass straight through |

Because every rendered icon carries the `lucide` class, you can style **all** icons at
once in your global sheet — e.g. `.lucide { width: 1em; height: 1em; }` to make icons
track the surrounding `font-size`.

**Zero-JS in Fresh:** a `lucide-preact` icon used inside a **server component**
(`components/…`) renders to SVG at SSR and ships **no JS** — the import runs only on the
server. It costs client bytes **only** inside an **island**, where Vite tree-shakes the
bundle down to the icons you actually imported (see *Rules that bite*).

### 3. `jsr:@preact-icons/lu` — a JSR-native alternative

If you'd rather stay on JSR than pull an npm package, the community
[`@preact-icons/lu`](https://jsr.io/@preact-icons/lu) port exposes the Lucide set with
`Lu`-prefixed names:

```sh
deno add jsr:@preact-icons/lu
```
```tsx
import { LuArrowRight, LuMenu } from "@preact-icons/lu";
<LuMenu class="size-5" />
```

Trade-off: it's a third-party port (names are renamed `Lu*` and the version can lag the
official release), whereas `lucide-preact` is official and its names match the gallery
1:1. Prefer `lucide-preact` unless you have a reason to avoid npm.

## Zero-JS by default — the same rule as everywhere in Fresh

Mirror the skill's island discipline: **keep icons in server components / inline SVG**
so they cost nothing client-side. Only let icons into an **island** when that island
genuinely renders them as part of its interactive state (a toggle that swaps `Menu`↔`X`,
a button whose icon changes on click). Never reach for an island just to *show* an icon.

And don't pass an icon **component as a prop** into an island — that's a function prop,
which fails island serialization (`advanced/serialization.md`). Render the icon *inside*
the island, or pass it as **children**, or pass a plain string the island maps to an
icon.

## Color, size & weight — render what the spec gives

- **Color: let it inherit.** Keep `currentColor` and set the *text* color (`text-primary`,
  or your own `color` token). The icon then re-themes and flips with dark mode automatically;
  never hard-code a hex on the icon.
- **Size with the `size` prop (or `.lucide{width:1em}`)**, not a CSS `transform: scale` —
  scaling multiplies the stroke weight too (a 2px stroke renders heavier at 2×) and leaves
  the element's original box, whereas the `size` prop resizes cleanly and keeps stroke-width
  as authored. Use the size the spec gives (typically matched to adjacent text — e.g.
  `size={18}` next to a 16px label).
- **Match the stroke weight the spec gives.** `strokeWidth={2}` is Lucide's default; the
  spec may call for `1.5`. Use `absoluteStrokeWidth` when you mix sizes but want the stroke
  to render at a uniform visual width.
- **Optical alignment.** Give icon+text rows `inline-flex items-center gap-2`; nudge with
  a tiny `translate-y` only if a specific glyph sits visually off-center.
- **RTL: mirror only directional glyphs.** Lucide doesn't auto-flip arrows, chevrons, or
  undo/redo in a right-to-left layout. Flip *just those* — `class="rtl:-scale-x-100"`
  (Tailwind) or `[dir=rtl] &{transform:scaleX(-1)}` — never symmetric icons (search, check, x).

## App-wide icon defaults — use CSS, not the context (in Fresh)

`lucide-preact` ships a `LucideContext` (a `<LucideProvider>` that sets default
`size`/`color`/`strokeWidth`/`class` for every icon under it). **Don't reach for it in
Fresh.** A provider in `_app.tsx` wraps the *server* tree, so SSR icons pick up its
values — but an island hydrates as its **own** Preact root the provider never enters, so
its icons re-render with the component defaults (`strokeWidth 2`) on the client: a visual
jump or hydration mismatch right at the server/island seam.

Set app-wide defaults in **CSS** instead. Every icon carries the `lucide` class, and a CSS
rule crosses the island boundary (it's a stylesheet, not component context) — and CSS
`stroke-width`/`width`/`color` override the SVG's presentation attributes:

```css
/* global sheet (client.ts) — every Lucide icon, server-rendered or island */
.lucide { width: 1em; height: 1em; stroke-width: 1.5; }
```

`color` you already control via `currentColor` + the surrounding text color. This is the
Fresh-correct way to theme all icons at once.

## Accessibility — decorative vs meaningful

Verified from the source: `lucide-preact` **auto-adds `aria-hidden="true"`** to an icon
**unless** it has children or any a11y prop (`aria-*`, `role`, or `title`). It does **not**
add `role="img"`. So:

- **Decorative** (next to a text label): do nothing — it's auto-hidden from assistive tech,
  which is correct.
- **Icon-only button/link** (the common case): label the **control**, not the icon, and let
  the icon stay decorative — `<button aria-label="Search"><Search /></button>`. This is
  Lucide's own recommendation and the most robust pattern (no reliance on a bare `<svg>`
  being named).
- **A standalone meaningful icon** (not inside an already-labeled control): give the
  *component* an `aria-label` (or a `<title>` child — either removes the auto-`aria-hidden`).
  For **inline SVG** (path 1) Lucide adds nothing for you: write `role="img"` +
  `aria-label="…"` when it's meaningful, or `aria-hidden="true"` when it's decorative.

## Rules that bite

- **Never `import * as Icons` or dynamically index `Icons[name]` inside an island** — it
  defeats tree-shaking and bundles **all ~1600 icons** into the client. Use static named
  imports; for dynamic names, map only the icons you actually use.
- **`lucide-preact`, not `lucide-react`** (the React one drags in React); keep `class`, not
  `className`.
- **Default to server components / inline SVG (zero JS);** reach for an island only when the
  icon is part of interactive state — and never pass an icon *component* as a prop (the
  function-prop trap, `advanced/serialization.md`).

Already covered above: color → `currentColor` + a text color; names → PascalCase of the
gallery slug; icon-only controls → label the wrapping `<button>`, not the icon.

## See also

- `rebuild-from-ui-breakdown.md` — the spec that tells you which icon/size/weight to render
- `concepts/islands.md` · `advanced/serialization.md` — when icons cost client JS, and the function-prop trap
- Lucide gallery: <https://lucide.dev/icons/> · Preact guide: <https://lucide.dev/guide/packages/lucide-preact>
