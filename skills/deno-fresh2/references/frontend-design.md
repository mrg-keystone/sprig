# Frontend Design — making the UI distinctive

> Adapted from Anthropic's `frontend-design` skill. License: `frontend-design-LICENSE.txt`.
> Read this whenever you're producing the *visible* parts of a Fresh app — `_app.tsx`,
> layouts, pages, components, islands, and CSS. The goal: production-grade interfaces
> that avoid generic "AI slop" aesthetics.

Implement real working code with exceptional attention to aesthetic detail and creative
choices. The user gives you frontend requirements — a component, page, app, or interface;
they may include purpose, audience, or technical constraints.

## Design thinking (before coding)

Commit to a BOLD, cohesive aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme and execute it precisely — brutally minimal, maximalist chaos,
  retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine,
  brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. Use these as
  inspiration; design one true to the chosen direction.
- **Constraints**: Framework, performance, accessibility.
- **Differentiation**: What makes this UNFORGETTABLE — the one thing someone remembers?

**Choose a clear conceptual direction and execute it with precision.** Bold maximalism and
refined minimalism both work; the key is intentionality, not intensity. Then implement code
that is production-grade and functional, visually striking and memorable, cohesive with a
clear point of view, and meticulously refined in every detail.

## Aesthetics guidelines

- **Typography**: Choose beautiful, unique, interesting fonts. Avoid generic fonts (Arial,
  Inter, Roboto, system fonts). Pair a distinctive display font with a refined body font.
- **Color & theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency.
  Dominant colors with sharp accents beat timid, evenly-distributed palettes.
- **Motion**: Animations for effects and micro-interactions. Prefer CSS-only solutions.
  One well-orchestrated page load with staggered reveals (`animation-delay`) creates more
  delight than scattered micro-interactions. Use scroll-triggering and surprising hover states.
- **Spatial composition**: Unexpected layouts. Asymmetry, overlap, diagonal flow,
  grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & visual detail**: Create atmosphere and depth rather than flat solid colors —
  gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic
  shadows, decorative borders, custom cursors, grain overlays.

**NEVER** use generic AI aesthetics: overused fonts (Inter, Roboto, Arial, system fonts),
cliché schemes (especially purple gradients on white), predictable layouts, cookie-cutter
patterns. NEVER converge on the same choices across generations (e.g. defaulting to Space
Grotesk every time). Vary light/dark, fonts, and aesthetics between projects.

Match implementation complexity to the vision: maximalist designs need elaborate code with
extensive animation; minimalist designs need restraint and precise spacing/typography.
Elegance comes from executing the vision well. Don't hold back.

## The bar: world-class, not "fine"

The failure mode to fight is *competent but plain* — a tidy page that works and offends
no one and excites no one. That is not the goal. Aim for work you'd see in a senior
creative developer's portfolio: considered, characterful, alive. Concretely, before you
call a screen done, it should clear all of these:

- **Typography is doing real work** — a distinctive display face paired with a refined
  body face, an intentional modular scale (e.g. 1.25–1.5 ratio), oversized headings,
  tuned `line-height`, `letter-spacing`, and a readable `measure` (~60–75ch). System
  fonts are a starting point you replace, never the final look.
- **The page moves** — there is a deliberate entrance choreography on load and meaningful
  motion on interaction, not a static document.
- **There is depth** — layering, gradient/mesh/texture/grain, shadow, or overlap creates
  atmosphere; no flat single-color void.
- **There is a signature** — one memorable moment per screen (a dramatic masthead, an
  unexpected layout break, a delightful hover, an animated accent) that someone remembers.
- **It's cohesive** — one committed aesthetic concept executed everywhere via shared
  tokens, not a grab-bag.

If a screen is merely neat, it has failed the bar — push it further.

## Motion system

Motion is a first-class part of the design, not decoration bolted on. Build a small,
coherent system:

- **Entrance choreography.** Stagger key elements in on load with `@keyframes` +
  `animation-delay` (e.g. masthead, then heading, then content, ~60–120ms apart). Use
  expressive easing (`cubic-bezier`), not linear.
- **Micro-interactions.** Hover/focus states with transitions on transform/color/shadow;
  buttons and links should respond. Respect `prefers-reduced-motion` with a media query.
- **Scroll-driven reveals.** Prefer modern CSS scroll-driven animations
  (`animation-timeline: view()`) for elements that animate in as they enter the viewport —
  zero JS, no observer wiring. **But never gate above-the-fold content on scroll.** A
  reveal that starts at `opacity: 0` and only animates in on scroll will leave the hero,
  first headline, or first list rows *invisible* on initial paint — and they stay blank
  in any context where the scroll timeline doesn't run (a browser that doesn't support
  it, reduced-motion, a crawler, or a static screenshot). Use scroll reveals only for
  content that is genuinely below the fold; animate above-the-fold content with a
  **load-time** entrance instead (`@keyframes` + `animation-delay`). And make the
  end-state the default — author the visible state in base CSS and let the animation play
  *from* hidden *to* it, or wrap the hidden start in `@supports (animation-timeline: view())`
  and `@media (prefers-reduced-motion: no-preference)`, so content is never stuck hidden
  when the animation can't run.
- **Page transitions.** Animate navigation between routes with the View Transitions API
  (see Fresh notes below) so the site feels like an app, not a reload.

## Typographic system

Type is the highest-leverage, lowest-cost lever for world-class feel:

- Pick a **display** face with character (editorial serif, a striking grotesk, a
  variable font with width/weight axes) and a clean **body** face that pairs with it.
- Define a scale in CSS custom properties (`--step--1 … --step-6`); use generous
  size contrast between display and body.
- Tune the details: tighter `letter-spacing` on large display text, comfortable
  `line-height` (~1.5) on body, constrained line length, real hanging punctuation /
  small-caps / ligatures where the face supports them.
- Variable fonts let you animate weight/optical-size on hover for a premium touch.

## Applying this in Fresh 2 specifically

Fresh's architecture shapes *how* you deliver the design — lean into it, don't fight it:

- **CSS-only effects are the default and the win.** Pages are server-rendered and ship zero
  JS, so animations, gradients, hover/scroll effects, and page-load reveals belong in CSS,
  not JavaScript. This keeps the aesthetic without dragging an island onto every page.
  Modern CSS gives you a lot for free: `@keyframes` + `animation-delay` for entrance
  choreography, `animation-timeline: view()` for scroll-driven reveals, and `:has()` /
  container queries for responsive polish — all without shipping a byte of JS.
- **Animate navigation with View Transitions.** Add `f-client-nav f-view-transition` to the
  root (e.g. `<body>` in `_app.tsx`) and Fresh runs cross-page swaps inside
  `document.startViewTransition()` — a free cross-fade, customizable via
  `::view-transition-old/new(root)` keyframes and per-element `view-transition-name`.
  Progressive enhancement: unsupported browsers just navigate. See
  `references/advanced/view-transitions.md`. This is the single biggest "feels like a
  premium app" upgrade and costs almost nothing.
- **Reserve islands for genuinely interactive flourishes** (a theme toggle, an animated
  counter driven by state, a draggable element). Static visual polish never needs an island.
- **Global aesthetic lives in `_app.tsx` + the CSS imported in `client.ts`/`assets/`** — set
  fonts (`@font-face` or a `<link>` in `<Head>`/`_app.tsx`), CSS custom properties for the
  palette, and base typography there so every page inherits the direction.
- **Per-page identity via `<Head>`** (`fresh/runtime`) for page-specific fonts/meta.
- **Fonts**: load a distinctive face via `<link>` in `_app.tsx`/`<Head>` or self-host in
  `static/`; reference it through a CSS variable. Don't settle for the system stack.
- **Tailwind**: if the project scaffolded with Tailwind (`@tailwindcss/vite`), express the
  palette/type scale as theme tokens and still avoid the default look — customize, don't ship
  stock utility soup.
- **daisyUI via the MCP — structure only, then make it yours.** The `daisyui-blueprint` MCP
  (`daisyUI-Snippets` + `Figma-to-daisyUI`, see `references/daisyui-mcp.md`) is the fast way
  to get *accessible component markup* — and in Fresh especially, its CSS-only dropdowns,
  collapses, drawers, and theme toggles give you interactivity with **zero islands** (modals
  too, via their checkbox variant). But daisyUI gives only the accessible **structure**; it
  delivers none of the pillars this doc demands — distinctive **typography**, a **motion
  layer**, **depth/atmosphere**, a **signature moment**, cohesion. So pull the structure, then
  **re-theme it with a custom `@plugin "daisyui/theme"`** (your OKLCH palette, radius, depth)
  and supply those pillars yourself. Stock daisyUI shipped as-is is the generic look we avoid;
  a custom theme plus the pillars above is what makes it world-class.
