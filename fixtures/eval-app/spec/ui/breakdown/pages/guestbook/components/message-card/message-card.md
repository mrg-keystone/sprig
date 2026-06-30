# message-card

> One guestbook entry: avatar + name + time-ago badge + message body. Page-local to the
> guestbook wall, which renders one `<message-card>` per `Message`.

## 1. Classification & behavior

**Folder bucket: `static`** — `template.html` + `styles.css`, **no `logic.ts`**. The card owns no
client state, hydrates nothing, and emits no interaction events. Its only authored motion is the
CSS-only `animate-rise` entrance, gated by a plain `isNew` prop. (Analyst call: static. Confirmed —
nothing here reads, writes, or reconciles state; the entrance is a keyframe animation, not script.)

- **Interaction tier:** static. No clicks, no inputs, no hover affordance (the card has `shadow-sm`
  but no `:hover` rule in source). It is a pure projection of one `Message`.
- **Data contract (one `Message`):** `name`, `avatar` (URL | null), `message`, `id`, `minutesAgo`,
  plus the presentational `isNew` flag. All derived display is pure:
  - **Name fallback:** blank/whitespace `name` → literal `"Anonymous guest"`.
  - **Avatar branch:** non-null `avatar` → `<img>` photo in a ringed circle; `null` → tinted
    initials placeholder.
  - **Initials:** `initials(name)` = first letters of the first two whitespace-split words,
    uppercased (`"The Whitman House"` → `TW`, `"Pilar"` → `P`, hyphenated single token
    `"Maximiliana-…"` → `M`, blank → `?`).
  - **Avatar tint (placeholder only):** `AVATAR_TINTS[id % 3]` → `[neutral, secondary, accent]`.
  - **Time label:** `timeAgo(minutesAgo)` → `just now` (`<1`) | `N min ago` (`<60`) | `N hour(s) ago`
    (`<24h`) | `yesterday` (`==1d`) | `N days ago`.
- **Data source:** props only, passed down by the wall from its `Message[]`. No fetch, no store.
- **Liveness:** none. Request-response render; the wall re-renders it. No realtime push.
- **Data-shape hazard (carry into build):**
  1. **`avatar` is an external host URL.** Seed photos are `https://i.pravatar.cc/96?img=N`
     (`N ∈ {47,15,8}`). The schema must treat `avatar` as an opaque optional image ref — do **not**
     bake pravatar in. For fixtures, lift the sample image to `assets/` (the case below carries the
     real captured URL so the screenshot diffs; swap to a local asset during build).
  2. **Tint rotation is `id % 3`.** All four captured placeholder stills happen to land on
     **secondary** (`id` 4, 901, 1000 — each `% 3 == 1`; olive `#5E6B47`). **neutral** (`id % 3 == 0`,
     e.g. Pilar `id 3`, Sam `id 6`; brown `#43342A`) and **accent** (`id % 3 == 2`, e.g. a posted
     `id 1001`; honey `#DA9A3E`) are reachable rotation outcomes that **no capture exercises** —
     *described, not extracted; verify the neutral/accent tints during build.*

## 2. Anatomy

```
<message-card>  →  <article class="card …">           ← +.animate-rise when isNew
  <div.card-body gap-3 p-5>
    <div.flex items-start gap-3>
      ┌ avatar slot ────────────────────────────────┐
      │ photo:    <div.avatar> <div.w-12.rounded-full.ring-1.ring-base-300> <img>    │
      │ initials: <div.avatar.avatar-placeholder> <div.{tint}.w-12.rounded-full>     │
      │           <span.text-base.font-semibold>{INITIALS}</span>                    │
      └──────────────────────────────────────────────┘
      <div.min-w-0.flex-1>                            ← text column (shrinkable, clips overflow)
        <div.flex.flex-wrap.items-baseline.gap-x-2.gap-y-0.5>   ← name + badge row (wraps)
          <span.font-semibold.break-words>{NAME}</span>
          <span.badge.badge-soft.badge-secondary.badge-sm.shrink-0>
            <i data-lucide="clock" class="size-[0.85em]"></i> {TIME_AGO}
          </span>
        <p.mt-1.5.text-base-content/85.leading-relaxed.break-words.[overflow-wrap:anywhere]>{MESSAGE}</p>
```

- **Slots/children:** none. The card is fully prop-driven; no `<content>` projection.
- The card box (radius `--radius-box` → 20px, `border-base-300`, `shadow-sm`, `p-5`) is daisyUI v5 +
  Tailwind utility classes (framework CSS, not authored — reproduce via the same utilities in build).

## 3. Props table

| name | type | default | control widget | signal? |
|---|---|---|---|---|
| `name` | `string` | `"Marisol Vega"` | text | no |
| `avatar` | `string \| null` (URL) | `"https://i.pravatar.cc/96?img=47"` | text | no |
| `message` | `string` | *(Marisol body, see fixture)* | text | no |
| `id` | `number` | `1` | number | no |
| `minutesAgo` | `number` | `8` | number | no |
| `isNew` | `boolean` | `false` | boolean | no |

No `signal: true` rows — static component, no island state to survive a control-edit remount. Each
row maps 1:1 to a `fixture.json` control.

## 4. States → cases

| state / case | what it demonstrates | drives |
|---|---|---|
| `with-photo` | real photo avatar in ringed circle; "8 min ago" badge | `avatar` set, `minutesAgo` 8 |
| `initials` | null avatar → tinted **secondary** initials `TW`; "3 hours ago" (hour pluralization) | `avatar: null`, `id` 4, `minutesAgo` 180 |
| `anonymous` | blank `name` → "Anonymous guest", `initials` → `?`, "just now" (resting) | `name: ""`, `avatar: null`, `minutesAgo` 0 |
| `overflow` | 70-char hyphenated name (wraps via flex-wrap) + run-on body + unbreakable token (`[overflow-wrap:anywhere]`); single-token initials `M`; "2 min ago" | torture `name`/`message`, `id` 901 |
| `new` | `isNew` true → `animate-rise` entrance plays once; settles identical to `anonymous` | `isNew: true` over the anonymous data |

Non-case states (not prop-driven — global toggles / media, **described, verify during build**):
- **dark** — same card under `data-theme="brand-dark"` (`base-100 #1E1712`, `base-300 #3A2E24` border,
  secondary `#93A179`). Diff `screenshots/with-photo-dark.png` under the workbench dark toggle.
- **mobile** — narrow viewport; message reflows to more lines (see Responsive). Diff
  `screenshots/with-photo-mobile.png`.
- **reduced-motion** — entrance collapsed to ~0ms (see Motion).

## 5. Events

**None — static display card. It emits no click/input/custom DOM events.** The only observable DOM
signal is the entrance animation lifecycle on the `<article>` when `isNew` is true:

```ts
// new case — verify the entrance actually fires (animationend bubbles to the bridge)
const ev = await capture(page);
await page.goto("/components/guestbook/message-card/new");
await ev.expect(e => e.source === "article" && e.type === "animationend", { timeout: 1500 });

// fallback if the bridge does not surface CSS animation events: assert the class is applied
await expect(page.locator("article.animate-rise")).toHaveCount(1);
```

```ts
// any non-new case — assert the entrance does NOT fire (isNew false → no animate-rise)
await page.goto("/components/guestbook/message-card/with-photo");
await expect(page.locator("article.animate-rise")).toHaveCount(0);
```

## 6. Motion

**Extracted, ground-truth (`css/message-card.css`, `js/message-card.js`):**

- **Trigger:** the `isNew` flag only. The wall sets `isNew: true` on a freshly-posted entry, renders
  it with the `animate-rise` class, then clears the flag so it animates exactly **once**.
- **Keyframes:**
  ```css
  @keyframes brand-rise {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }
  .animate-rise { animation: brand-rise var(--dur-base) var(--ease-bounce) both; }
  ```
- **Properties:** `opacity` 0→1 and `transform` translateY(8px)→none — **compositor-only**.
- **Duration:** `--dur-base` = **320ms**. **Easing:** `--ease-bounce` =
  `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot/bounce). **Fill:** `both`.
- **Filmstrip:** `screenshots/filmstrip.png` — 0ms (opacity 0, +8px) → 64 / 128 / 192 / 256 →
  320ms (settled), the anonymous-guest card rising in.

**Jank (`jank.md`):** the animation itself is **CLEAN** — only `opacity` + `transform`, no layout/paint
per frame, **no `will-change` needed** (one-shot 320ms entrance, not a persistent layer). Keep the
keyframes as-is. **The cost lives in the trigger path, which is NOT this card's CSS:** the source
`renderWall()` does `wall.innerHTML = list.map(cardHtml).join("")` + a full-document
`lucide.createIcons()` rescan on every post — one ~195ms long-animation-frame landing in the same
frame the entrance starts (live sample: 152 frames, 1 dropped, max 33.8ms, CLS 0.0001). **Rebuild
fix belongs to the wall, not the card:** render/patch only the new `<message-card isNew>` (insert
one node, scope icon creation to it) — in a component framework this falls out for free. *Note it,
do not attribute it to the card.*

**Reduced motion:** a global `@media (prefers-reduced-motion: reduce)` guard collapses
`animation-duration`/`transition-duration` to `0.01ms`. Preserve it in the rebuild.

## 7. Responsive

The source has **no `@media` rule for this card** — it is fully fluid:

- **Text column** is `min-w-0 flex-1`: it takes remaining width beside the fixed `w-12` (48px)
  avatar and shrinks to zero before overflowing, so the message rewraps to more lines as width drops
  (desktop ~2 lines → mobile ~3 lines for the Marisol body; see `with-photo-mobile.png`).
- **Name/badge row** is `flex flex-wrap items-baseline gap-x-2`: a long name pushes the time badge to
  the next line rather than overflowing.
- Card padding (`p-5`) and radius (`--radius-box`) are width-independent.

## 8. A11y

- **Roles:** `<article>` per entry (implicit `article` landmark/role). Name is a `<span>` (not a
  heading) — the wall owns the list semantics; preserve that.
- **Avatar image:** photo `<img>` has `alt=""` (decorative — the visible name carries identity).
  Keep `alt=""`; do not echo the name into alt (would double-announce).
- **Initials/`?` placeholder:** purely visual; the adjacent name text is the accessible label.
- **Time badge:** the `timeAgo` string is plain text inside the badge; the lucide clock `<i>` is
  decorative.
- **Focus order / keyboard:** nothing focusable or interactive in the card — no tab stops, no
  trapping.
- **Reduced motion:** honored via the global guard (entrance ~0ms). No motion-essential information.

## 9. Used on

- **Guestbook page** (`pages/guestbook/`) — rendered by the wall, one per `Message`.

**Shared vs page-local:** **page-local.** Only the guestbook wall renders it (evidence: sole consumer
in the prototype; `data-model.md` lists `message-card` reading one `Message`, used only by the wall).

## 10. Isolate build plan

- **Lands in:** `components/message-card/` (static, no `logic.ts`). **Selector:** `message-card`
  (folder basename = custom tag `<message-card>`).
- **Preview routes** (from `fixture.json` `category: "guestbook"`, `folder: "message-card"` — **not**
  the source path): `/components/guestbook/message-card/<case>` —
  - `…/with-photo` — Marisol Vega, real photo, "8 min ago" → diff `screenshots/with-photo.png`
    (and `…/with-photo` under dark toggle → `with-photo-dark.png`; at mobile width →
    `with-photo-mobile.png`).
  - `…/initials` — The Whitman House, secondary `TW`, "3 hours ago" → diff `screenshots/initials.png`.
  - `…/anonymous` — Anonymous guest, `?`, "just now" (resting) → diff `screenshots/anonymous.png`.
  - `…/overflow` — Maximiliana torture row, `M`, "2 min ago" → diff `screenshots/overflow.png`.
  - `…/new` — anonymous data + `isNew` → `animate-rise` → diff the settled frame of
    `screenshots/filmstrip.png` (100% / 320ms equals resting `anonymous`).
- **Events → tests:** the two Section-5 sketches become
  `cases/new/tests/entrance.spec.ts` (animationend on `article`, class-presence fallback) and a
  `toHaveCount(0)` assertion on `animate-rise` for `with-photo` (no-entrance guard).
- **Loop:** scaffold `components/message-card/` (`template.html`, `styles.css` carrying
  `@keyframes brand-rise` + `.animate-rise` + the reduced-motion guard) → drop this `isolate/` →
  `sprig isolate` → open each route, diff vs its screenshot → lift Section-5 events into
  `cases/new/tests/*.spec.ts` → run → iterate → only then compose into the guestbook wall.
- **Build notes:** keep the entrance as `opacity`+`transform` (no `will-change`); the
  innerHTML-rebuild long task is the **wall's** to fix (insert/patch one node), not the card's; swap
  the pravatar URL for a local `assets/` image once the with-photo diff passes.
