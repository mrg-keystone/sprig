# Hearth — Component Recipes

Brand-voiced daisyUI 5 recipes for the guestbook. Every class here was pulled
**verbatim from the daisyUI MCP** (daisyUI 5) — do not "remember" class names, they
drifted from v4 (`input-bordered`, `form-control`, `label-text` are all gone).

Rules for everything below:
- **Semantic colors only** (`btn-primary`, `bg-base-100`, `text-base-content`) so it
  rethemes with `data-theme="brand"` / `data-theme="brand-dark"`. Never raw `gray-*`/hex.
- Icons are **Lucide** via `<i data-lucide="…"></i>` in the prototype's plain HTML.
- `primary` (terracotta) is the one precious CTA color — use it sparingly: the "Sign the
  guestbook" / "Leave a message" action. Everything else leans on `base-*`, `secondary`
  (sage), `accent` (honey), `neutral` (warm brown).

---

## Button

Class families (MCP): color `btn-{neutral,primary,secondary,accent,info,success,warning,error}`
· style `btn-{outline,dash,soft,ghost,link}` · size `btn-{xs,sm,md,lg,xl}` ·
behavior `btn-{active,disabled}` · modifier `btn-{wide,block,square,circle}`.

```html
<!-- Primary CTA — the precious one. Used once per view. -->
<button class="btn btn-primary">Leave a message</button>

<!-- Soft / ghost supporting actions -->
<button class="btn btn-soft btn-secondary">Browse the wall</button>
<button class="btn btn-ghost">Cancel</button>

<!-- With a Lucide icon (size-[1.2em] keeps the glyph optically matched to text) -->
<button class="btn btn-primary">
  <i data-lucide="feather" class="size-[1.2em]"></i>
  Sign the guestbook
</button>

<!-- Sizes -->
<button class="btn btn-xs">xs</button>
<button class="btn btn-sm">sm</button>
<button class="btn">md</button>
<button class="btn btn-lg">lg</button>
```

---

## Card

Class families (MCP): part `card-{title,body,actions}` · style `card-{border,dash}` ·
modifier `card-side`, `image-full` · size `card-{xs,sm,md,lg,xl}`.

A guestbook entry is a card with no image — a warm note on a cream surface. The generous
`--radius-box: 1.25rem` and `--depth: 1` shadow give it the cozy, pinned-to-the-wall feel.

```html
<!-- A single guestbook message -->
<div class="card bg-base-100 w-96 shadow-sm">
  <div class="card-body">
    <h2 class="card-title">A warm welcome</h2>
    <p>So glad I found this little corner of the internet. Thanks for having me!</p>
    <div class="card-actions justify-end">
      <span class="badge badge-soft badge-secondary">2 hours ago</span>
    </div>
  </div>
</div>

<!-- Outlined variant for a quieter, secondary entry -->
<div class="card card-border border-base-300 bg-base-100">
  <div class="card-body">
    <h2 class="card-title">Just passing through</h2>
    <p>Lovely place. I'll be back.</p>
  </div>
</div>
```

---

## Input & Textarea (the "leave a message" form)

**daisyUI 5: `input`/`textarea` are bordered by default** — there is no `input-bordered`,
and `form-control`/`label-text` were removed. Use `fieldset` + `legend.fieldset-legend` +
`label`. Color/size families: `input-{primary,secondary,…}` · `input-{xs…xl}` (same for
`textarea-*`); style `input-ghost` / `textarea-ghost`.

```html
<!-- Name -->
<fieldset class="fieldset">
  <legend class="fieldset-legend">What's your name?</legend>
  <input type="text" class="input" placeholder="Type here" />
  <p class="label">Shown next to your message</p>
</fieldset>

<!-- The message itself -->
<fieldset class="fieldset">
  <legend class="fieldset-legend">Your message</legend>
  <textarea class="textarea h-24" placeholder="Leave a warm note…"></textarea>
  <div class="label">Keep it kind</div>
</fieldset>

<!-- Focus accent on the primary field -->
<input type="text" class="input input-primary" placeholder="Type here" />
```

---

## Badge

Class families (MCP): style `badge-{outline,dash,soft,ghost}` ·
color `badge-{neutral,primary,secondary,accent,info,success,warning,error}` ·
size `badge-{xs,sm,md,lg,xl}`. The pill shape comes from `--radius-selector: 1rem`.

```html
<!-- Status / metadata on an entry -->
<span class="badge badge-soft badge-secondary">New</span>
<span class="badge badge-accent">Featured</span>
<span class="badge badge-outline badge-neutral">Visitor</span>

<!-- A count, inline in a heading -->
<h2 class="font-display">Messages <span class="badge badge-primary">128</span></h2>

<!-- With a Lucide icon -->
<span class="badge badge-soft badge-success">
  <i data-lucide="check" class="size-[1em]"></i> Posted
</span>
```

---

## Avatar

Class families (MCP): `avatar`, `avatar-group` · modifier `avatar-{online,offline,placeholder}`.
A guestbook entry pairs a small avatar with the signer's name.

```html
<!-- Visitor avatar with a presence dot -->
<div class="avatar avatar-online">
  <div class="w-12 rounded-full">
    <img src="https://img.daisyui.com/images/profile/demo/gordon@192.webp" />
  </div>
</div>

<!-- No photo? Warm initials placeholder on neutral brown -->
<div class="avatar avatar-placeholder">
  <div class="bg-neutral text-neutral-content w-12 rounded-full">
    <span>HM</span>
  </div>
</div>

<!-- Stacked group — "and 12 others signed today" -->
<div class="avatar-group -space-x-4">
  <div class="avatar"><div class="w-10"><img src="https://img.daisyui.com/images/profile/demo/batperson@192.webp" /></div></div>
  <div class="avatar"><div class="w-10"><img src="https://img.daisyui.com/images/profile/demo/spiderperson@192.webp" /></div></div>
  <div class="avatar avatar-placeholder">
    <div class="bg-neutral text-neutral-content w-10"><span>+12</span></div>
  </div>
</div>
```

---

## Alert & Toast

Alert class families (MCP): style `alert-{outline,dash,soft}` ·
color `alert-{info,success,warning,error}` · direction `alert-{vertical,horizontal}`.
Toast is a positioning wrapper: placement `toast-{start,center,end,top,middle,bottom}`.

```html
<!-- Inline alert with title + description (verbatim daisyUI 5 markup; Lucide icon) -->
<div role="alert" class="alert alert-vertical sm:alert-horizontal alert-success">
  <i data-lucide="party-popper" class="size-6 shrink-0"></i>
  <div>
    <h3 class="font-bold">Message posted!</h3>
    <div class="text-xs">Thanks for signing the guestbook.</div>
  </div>
  <button class="btn btn-sm">View</button>
</div>

<!-- Soft, warm variants for gentler notices -->
<div role="alert" class="alert alert-soft alert-info">
  <i data-lucide="info" class="size-5 shrink-0"></i>
  <span>New messages appear at the top of the wall.</span>
</div>

<!-- Toast: a transient confirmation, bottom-end. Pair with .animate-rise for a warm entrance. -->
<div class="toast toast-end">
  <div class="alert alert-success">
    <span>Your message was added to the wall.</span>
  </div>
</div>
```

---

### Notes for consumers

- **Headings use Caveat** (`--font-display`, applied to `h1–h4`/`.font-display`). Caveat is
  a handwriting script with little weight contrast, so headings are set at `700`. Keep it to
  genuine headings, the brand wordmark, and short warm phrases — it is not a body face. Body
  copy and all UI text use **Quicksand** (`--font-body`).
- **`btn-primary` (terracotta) is rationed** to the single hero action per view. Reach for
  `secondary` (sage), `accent` (honey), `soft`, `ghost`, or `outline` for everything else.
- Entrance motion: add `class="animate-rise"` (defined in `theme.css`) to newly posted
  entries / toasts for a gentle bounce-in; it is automatically neutralised under
  `prefers-reduced-motion`.
