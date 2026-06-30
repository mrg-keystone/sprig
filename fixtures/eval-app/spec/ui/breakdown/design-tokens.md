# design-tokens.md — Hearth

> Translation boundary. The prototype renders with **daisyUI 5 + @tailwindcss/browser** and a
> pasted `[data-theme]` block. What crosses into `build` here is **framework-neutral Tailwind v4
> `@theme` tokens** — no `tailwind.config.js`, no daisyUI, no daisyUI plugin params.
> Source of truth for values: `spec/ui/design-system/theme.css` (+ derived `css-variables.json`,
> `manifest.json`). Values below are byte-identical to those files. Both theme variants captured
> as parallel columns.

## Default-theme decision (flag for build + capture)

| Source | Declares default | color-scheme |
|---|---|---|
| `hearth-prototype.html` `<html data-theme="brand">` | **brand (light)** | light |
| `theme.css` `@plugin daisyui/theme { default: true }` | brand (light) | light |
| `css-variables.json` `"default": "brand-dark"` | **brand-dark (dark)** | dark |

The SPRIG-consumer artifact (`css-variables.json`) intentionally flips the no-attribute default to
**brand-dark** so a dark-first SSR app has no light flash. **The prototype itself renders brand
(light)** — so every capture screenshot and every isolate `default` case must set
`data-theme="brand"` to match the diff target. Recommendation: ship the `@theme` default as
**brand-dark** (per `css-variables.json`) and have the prototype-matching cases opt into
`[data-theme="brand"]`. Build must not silently render light when the token default is dark.

---

## Palette (both variants, parallel columns)

Semantic colors only — every surface/ink in the prototype is a `*-content` pair so it rethemes by
swapping `data-theme`. Hex, byte-identical to `theme.css`.

| Token | `brand` (light) | `brand-dark` (dark) | Role / sighted in prototype |
|---|---|---|---|
| `--color-base-100` | `#FBF7F0` | `#1E1712` | page surface (`bg-base-100`, body, cards) |
| `--color-base-200` | `#F3EADB` | `#29201A` | elevation / header bar / demo panel (`bg-base-200`) |
| `--color-base-300` | `#E6D7C3` | `#3A2E24` | borders / dividers / rings (`border-base-300`) |
| `--color-base-content` | `#3B2A1E` | `#F1E7D9` | body + heading ink (`text-base-content`, /60 /70 /85) |
| `--color-primary` | `#C2410C` | `#EA7A45` | the one precious CTA (post button, logo tile, empty CTA) |
| `--color-primary-content` | `#FFF8F1` | `#2A1206` | ink on primary |
| `--color-secondary` | `#5E6B47` | `#93A179` | sage — time-ago badge, demo active state |
| `--color-secondary-content` | `#FBF7F0` | `#1B1611` | ink on secondary |
| `--color-accent` | `#DA9A3E` | `#E8B25E` | honey — wall-count badge, empty-state icon, avatar tint |
| `--color-accent-content` | `#3B2A1E` | `#2A1F0E` | ink on accent |
| `--color-neutral` | `#43342A` | `#2C231C` | structural — avatar placeholder tint, "+9" chip |
| `--color-neutral-content` | `#FBF3E9` | `#F1E7D9` | ink on neutral |
| `--color-info` | `#3F7E8C` | `#5FA6B5` | info toast |
| `--color-info-content` | `#FBF7F0` | `#0E1B1E` | — |
| `--color-success` | `#4E7A2F` | `#84B85A` | success toast ("Message posted!") |
| `--color-success-content` | `#FBF7F0` | `#14210C` | — |
| `--color-warning` | `#D97706` | `#E8A53E` | warning toast ("Your note is empty") |
| `--color-warning-content` | `#3B2A1E` | `#2A1E08` | — |
| `--color-error` | `#C0392B` | `#E06A5C` | error toast + error scaffold button |
| `--color-error-content` | `#FFF6F4` | `#2A0E0A` | — |

### Derived shade tokens (build-free `color-mix`, theme-agnostic — defined once)
Carried verbatim from `theme.css`; the prototype's opacity slashes (`/60 /70 /85 /50`) are the
Tailwind-utility equivalent and can be reproduced with `text-base-content/60` etc. These named
shade tokens exist for any place a fixed mix is wanted:

| Token | Value |
|---|---|
| `--color-base-content-30` | `color-mix(in oklch, var(--color-base-content) 30%, transparent)` |
| `--color-base-content-50` | `color-mix(in oklch, var(--color-base-content) 50%, transparent)` |
| `--color-primary-30` | `color-mix(in oklch, var(--color-primary) 30%, transparent)` |
| `--color-primary-15` | `color-mix(in oklch, var(--color-primary) 15%, transparent)` |
| `--color-secondary-30` | `color-mix(in oklch, var(--color-secondary) 30%, transparent)` |
| `--color-accent-30` | `color-mix(in oklch, var(--color-accent) 30%, transparent)` |

---

## Typography

Fonts (Google Fonts, loaded via `@import` in the prototype; build should self-host or keep the
`@import`):

| Token | Value | Role |
|---|---|---|
| `--font-display` | `'Caveat', 'Comic Sans MS', system-ui, cursive` | headings `h1–h4` / `.font-display` / wordmark — handwritten script, set at **700** |
| `--font-body` | `'Quicksand', system-ui, sans-serif` | body + all UI text (set on `body`) |
| `--font-mono` | `ui-monospace, 'SF Mono', Menlo, monospace` | not sighted in prototype (char-count uses `tabular-nums`, not mono) |

Heading rule (from `theme.css`, applies to `h1,h2,h3,h4,.font-display`):
`font-family: var(--font-display); letter-spacing: -0.015em; line-height: 1.1; font-weight: 700`.

### Type scale — **divergence flag**

The design system defines a **modular major-third (1.25) scale** (`--step-*`). The **prototype did
NOT use it** — it uses Tailwind's built-in size utilities. The screenshot diff target therefore
shows Tailwind's default sizes. Build must reproduce the **rendered** column for diff fidelity;
expose the `--step-*` tokens for future adoption and flag the mismatch.

| `--step` token | DS value (px) | Prototype class actually used | Rendered (px) | Where |
|---|---|---|---|---|
| `--step-5` | `3.0518rem` (49) | — | — | (unused) |
| `--step-4` | `2.4414rem` (39) | `text-4xl` | 36 | `h1` wordmark "Hearth" |
| `--step-3` | `1.9531rem` (31) | `text-3xl` | 30 | `h2` "On the wall" |
| `--step-2` | `1.5625rem` (25) | `text-2xl` | 24 | composer `h2`, empty-state `h3` |
| `--step-1` | `1.25rem` (20) | — | — | (unused) |
| `--step-0` | `1rem` (16) | `text-base` | 16 | message body |
| `--step--1` | `0.8rem` (12.8) | `text-sm` | 14 | tagline, labels, captions |
| `--step--2` | `0.64rem` (10.2) | `text-xs` | 12 | demo-panel label, "+9" chip |

Tailwind v4 `@theme` exposes the scale as `--text-step-*` (→ `text-step-0` utilities). The
**recommendation**: keep the prototype's built-in classes (`text-4xl`, `text-3xl`, `text-2xl`,
`text-base`, `text-sm`, `text-xs`) so screenshots diff clean, and treat `--step-*` as available-but-
not-yet-applied. Do not silently swap sizes.

Leading / tracking / measure:

| Token | Value |
|---|---|
| `--leading-tight` | `1.1` (headings) |
| `--leading-snug` | `1.25` |
| `--leading-normal` | `1.5` |
| `--leading-relaxed` | `1.6` (message body — prototype uses `leading-relaxed`) |
| `--tracking-display` | `-0.015em` (headings) |
| `--measure` | `65ch` (comfortable reading width; not directly applied in prototype, cards rely on grid column width) |

---

## Radii

| Token | Value | daisyUI role → prototype usage |
|---|---|---|
| `--radius-selector` | `1rem` | badges/toggles — pill (`badge` shapes) |
| `--radius-field` | `0.75rem` | buttons/inputs/textarea/tabs |
| `--radius-box` | `1.25rem` | cards / alerts / modals (`rounded-box` on logo tile + all cards) |

Prototype also uses `rounded-full` (avatars, the `size-16` empty icon ring, the logo via
`rounded-box`). Map `rounded-box`→`--radius-box`, `rounded-field`-equivalent for inputs/buttons.
Tailwind v4: expose as `--radius-box`, `--radius-field`, `--radius-selector` (→ `rounded-box` etc.).

---

## Spacing, borders, shadows

- **Spacing**: prototype uses Tailwind's default 0.25rem spacing scale throughout
  (`gap-2/3/4/8`, `px-4`, `py-7/8`, `mt-1.5`, `-space-x-4`, `pb-28`, `size-7/9/12/16`). No custom
  spacing tokens — keep Tailwind defaults.
- **Border**: `--border: 1px` → Tailwind default `border` (1px). Prototype uses `border
  border-base-300` and `border border-dashed border-base-300` (empty state). No custom border token
  needed.
- **Shadows** — prototype uses Tailwind defaults, no custom shadow token:

  | Utility | Where |
  |---|---|
  | `shadow-sm` | logo tile, all cards (composer, message cards, skeletons) |
  | `shadow-lg` | floating demo panel, toasts |

  daisyUI `--depth: 1` (subtle 3D shadow) is **not directly translatable** and is approximated by
  these `shadow-sm`/`shadow-lg` utilities. `--noise: 1` (subtle grain) has **no DOM presence** in
  the prototype — there is no grain overlay element. Both `--depth` and `--noise` are daisyUI
  plugin params with no Tailwind token; **drop them** (per `css-variables.json` note) and reproduce
  elevation via the shadow utilities above.

---

## Motion / easing / durations

| Token | Value | Role |
|---|---|---|
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | warm entrance overshoot (`animate-rise`) |
| `--ease-standard` | `cubic-bezier(0.20, 0, 0, 1)` | standard ease (not directly used in prototype JS) |
| `--dur-micro` | `120ms` | — |
| `--dur-fast` | `200ms` | — |
| `--dur-base` | `320ms` | `animate-rise` duration; toast fade-out is hardcoded `250ms` |

Keyframes (verbatim — reproduce, don't reinvent):

```css
@keyframes brand-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.animate-rise { animation: brand-rise var(--dur-base) var(--ease-bounce) both; }
```

`animate-rise` is applied to: a newly posted message card (`isNew`), and each toast on creation.
The toast exit is a **separate inline JS transition** (not a keyframe):
`transition: opacity .25s, transform .25s; opacity:0; transform: translateY(8px)` then removed after
260ms — owned by the `toast` island, capture for its Motion section.

### prefers-reduced-motion (verbatim — preserve)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Global blanket reduction; keep as-is. Note the toast's **inline** JS-set transition (`.25s`) is NOT
covered by this `!important` rule reliably (inline styles) — flag for the `toast` island to gate its
exit transition on a reduced-motion check, or set the transition via a class so the media query wins.

---

## z-index scale (sighted)

| Layer | z | Element |
|---|---|---|
| floating demo panel | `z-40` | `fixed bottom-4 left-4` (scaffold — not shipped) |
| toast stack | `z-50` | `#toasts` `toast toast-end` |
| sticky composer | (auto) | `lg:sticky lg:top-6` — no z-index, relies on normal flow |

Only two explicit z-layers in product (panel is scaffold): toasts (`z-50`) sit above everything.

## Breakpoints (Tailwind defaults, only these used)

| Prefix | min-width | Used for |
|---|---|---|
| `sm` | 640px | header "X have signed" badge appears (`hidden sm:flex`) |
| `lg` | 1024px | main grid becomes 2-col `lg:grid-cols-[360px_1fr]`; composer becomes `lg:sticky lg:top-6` |

`md`, `xl`, `2xl` unused. Mobile-first: single column below `lg`, composer stacks above the wall.

---

## Proposed Tailwind v4 `@theme` (build target)

Put in a `:global(...)` block (e.g. `shell/styles.css`). Default values = **brand-dark** (the
SSR no-attribute default per `css-variables.json`); `[data-theme="brand"]` overrides to light to
match the prototype/screenshots. NOT a `tailwind.config.js`, NOT daisyUI.

```css
/* shell/styles.css */
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Quicksand:wght@300;400;500;600;700&display=swap');

@theme {
  /* palette — default = brand-dark */
  --color-base-100: #1E1712;
  --color-base-200: #29201A;
  --color-base-300: #3A2E24;
  --color-base-content: #F1E7D9;
  --color-primary: #EA7A45;            --color-primary-content: #2A1206;
  --color-secondary: #93A179;          --color-secondary-content: #1B1611;
  --color-accent: #E8B25E;             --color-accent-content: #2A1F0E;
  --color-neutral: #2C231C;            --color-neutral-content: #F1E7D9;
  --color-info: #5FA6B5;               --color-info-content: #0E1B1E;
  --color-success: #84B85A;            --color-success-content: #14210C;
  --color-warning: #E8A53E;            --color-warning-content: #2A1E08;
  --color-error: #E06A5C;              --color-error-content: #2A0E0A;

  /* fonts */
  --font-display: 'Caveat', 'Comic Sans MS', system-ui, cursive;
  --font-body:    'Quicksand', system-ui, sans-serif;
  --font-mono:    ui-monospace, 'SF Mono', Menlo, monospace;

  /* type scale (available; prototype used Tailwind built-ins — see divergence flag) */
  --text-step--2: 0.64rem;  --text-step--1: 0.8rem;  --text-step-0: 1rem;
  --text-step-1: 1.25rem;   --text-step-2: 1.5625rem; --text-step-3: 1.9531rem;
  --text-step-4: 2.4414rem; --text-step-5: 3.0518rem;

  /* radii */
  --radius-selector: 1rem;
  --radius-field: 0.75rem;
  --radius-box: 1.25rem;

  /* easing + durations */
  --ease-bounce:   cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-standard: cubic-bezier(0.20, 0, 0, 1);
  --dur-micro: 120ms; --dur-fast: 200ms; --dur-base: 320ms;
}

:global(:root) { color-scheme: dark; }

/* light variant — matches the prototype / capture screenshots */
:global([data-theme="brand"]) {
  color-scheme: light;
  --color-base-100: #FBF7F0;
  --color-base-200: #F3EADB;
  --color-base-300: #E6D7C3;
  --color-base-content: #3B2A1E;
  --color-primary: #C2410C;            --color-primary-content: #FFF8F1;
  --color-secondary: #5E6B47;          --color-secondary-content: #FBF7F0;
  --color-accent: #DA9A3E;             --color-accent-content: #3B2A1E;
  --color-neutral: #43342A;            --color-neutral-content: #FBF3E9;
  --color-info: #3F7E8C;               --color-info-content: #FBF7F0;
  --color-success: #4E7A2F;            --color-success-content: #FBF7F0;
  --color-warning: #D97706;            --color-warning-content: #3B2A1E;
  --color-error: #C0392B;              --color-error-content: #FFF6F4;
}

/* leading/tracking/measure + color-mix shades live in :root (not utility tokens) */
:global(:root) {
  --leading-tight: 1.1; --leading-snug: 1.25; --leading-normal: 1.5; --leading-relaxed: 1.6;
  --tracking-display: -0.015em; --measure: 65ch;
  --color-base-content-30: color-mix(in oklch, var(--color-base-content) 30%, transparent);
  --color-base-content-50: color-mix(in oklch, var(--color-base-content) 50%, transparent);
  --color-primary-30:      color-mix(in oklch, var(--color-primary) 30%, transparent);
  --color-primary-15:      color-mix(in oklch, var(--color-primary) 15%, transparent);
  --color-secondary-30:    color-mix(in oklch, var(--color-secondary) 30%, transparent);
  --color-accent-30:       color-mix(in oklch, var(--color-accent) 30%, transparent);
}

body { font-family: var(--font-body); }
h1, h2, h3, h4, .font-display {
  font-family: var(--font-display);
  letter-spacing: var(--tracking-display);
  line-height: var(--leading-tight);
  font-weight: 700;
}

@keyframes brand-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.animate-rise { animation: brand-rise var(--dur-base) var(--ease-bounce) both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

## daisyUI → Tailwind translation notes (for the spec-writers)

The prototype leans entirely on daisyUI 5 component classes. The breakdown's job is to retire them.
Map (verbatim recipes in `design-system/components.md`):

| daisyUI class | Tailwind v4 reconstruction |
|---|---|
| `btn btn-primary btn-block` | `inline-flex items-center justify-center gap-2 w-full rounded-field bg-primary text-primary-content px-4 py-2 font-medium shadow-sm hover:brightness-95` |
| `btn btn-xs btn-soft/-ghost` | small ghost/soft button — `text-xs px-2 py-1 rounded-field` + soft = tinted `bg-{tone}/15 text-{tone}` |
| `card` / `card-body` / `card-title` / `card-actions` | `rounded-box bg-base-100 border border-base-300 shadow-sm` + body padding `p-5`, title `font-display text-2xl`, actions `flex` |
| `input` (daisyUI bordered-by-default wrapper w/ icon) | `flex items-center gap-2 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2` + nested `<input>` `bg-transparent outline-none flex-1` |
| `textarea textarea-primary` | `w-full rounded-field border border-base-300 bg-base-100 p-3 focus:border-primary` |
| `fieldset` / `fieldset-legend` / `label` | semantic wrapper + `legend` `text-sm font-medium` + helper `p.label` `text-xs text-base-content/60` |
| `badge badge-soft badge-{secondary,accent}` `badge-sm` | `inline-flex items-center gap-1 rounded-selector px-2 py-0.5 text-xs bg-{tone}/15 text-{tone}` |
| `avatar` / `avatar-placeholder` / `avatar-group` | `rounded-full overflow-hidden ring-1 ring-base-300` (img) / grid-centered initials (placeholder) / `flex -space-x-4` (group) |
| `alert alert-{success,error,warning,info}` `alert-soft` | `flex items-start gap-2 rounded-box p-3 shadow-lg bg-{tone} text-{tone}-content` (soft = `bg-{tone}/15`) |
| `toast toast-end` | `fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end` |
| `skeleton` | `animate-pulse rounded bg-base-300/60` |

Icons: prototype uses **Lucide** via `<i data-lucide="…">` + `lucide.createIcons()`. For the
sprig rebuild, inline the SVGs (lift to `assets/`) — used glyphs: `flame, users-round, user-round,
feather, arrow-up, clock, sliders-horizontal, triangle-alert, party-popper, circle-alert, info,
check`. No runtime icon-font/JS dependency in the deliverable.
