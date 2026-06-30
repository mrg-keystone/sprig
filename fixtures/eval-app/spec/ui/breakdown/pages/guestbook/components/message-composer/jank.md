# message-composer — motion & jank

Source: `fixtures/eval-app/spec/ui/hearth-prototype.html` @ `data-theme="brand"` (light).
Region: `aside .card` — name input + textarea + char count + "Sign the guestbook" button.
Captured with Playwright (isolate-runner chromium), headless, 1280×950 unless noted.

## What actually moves

The composer has **no entrance and no looping animation of its own** — `document.getAnimations()`
is empty on the card after load, and the only authored keyframe (`@keyframes brand-rise`
/ `.animate-rise`) is applied to *newly-posted wall cards and toasts*, **not** to the composer.

The composer's only motion is the daisyUI button micro-feedback and the (instant) input focus ring:

| Trigger | Element | Properties | Duration / easing | Extracted end-state |
|---|---|---|---|---|
| hover | `#postBtn` (`.btn`) | `background-color`, `border-color`, `box-shadow` | 0.2s `cubic-bezier(0,0,.2,1)` | bg darkens ~7% → `oklab(0.5147…)`; box-shadow retained |
| `:active` (press) | `#postBtn` | `translate`, `background-color`, `box-shadow` | 0.2s `cubic-bezier(0,0,.2,1)` | `translate: 0 .5px` (0.5px downward nudge); bg darkens ~5% → `oklab(0.5258…)`; **box-shadow collapses to `0 0 0 0` (removed)** |
| `:focus-visible` | `#postBtn` | `outline` | (outline not transitioned) | `outline: 2px solid var(--color-primary)` = `rgb(194,65,12)`, `outline-offset: 2px` |
| focus | `#msgInput` (`.textarea.textarea-primary`) | — (`transition` resolves to `all 0s` → no animation) | instant | `outline: 2px solid var(--color-primary)`, offset 2px; border already primary at rest (textarea-primary) |

Press feedback evidence: `screenshots/filmstrip.png` (rest → hover → :active → :focus-visible).
Per-state computed values are in `_capture-data.json` (`forced.*`).

The button's transition lists `transform` and the active nudge is the CSS `translate` property
(composited) — that part is fine. See the CSS lint below for the `box-shadow` part.

## Live jank sample — one optimistic post()

Instrumented rAF-delta + LongAnimationFrame + layout-shift observers, then filled name+message
and clicked **Sign the guestbook** (the optimistic write). Single labeled sample, not a benchmark:

- frames observed: **222**
- dropped frames (>1.5× 16.7ms): **0.5%**
- max frame time: **25.5 ms**
- long-animation-frames > 50ms: **1 entry, 178.9 ms**
- CLS delta: **0** (the optimistic prepend does shift the existing wall cards down, but it is
  input-attributed within 500ms so it is excluded from CLS; visually the new card rises via
  `.animate-rise` transform/opacity)

The single **178.9 ms long-animation-frame** lands on the post click — see the JS lint below for why.

## Jank findings + rebuild fixes

### JS

1. **[HIGH] Full-wall `innerHTML` rebuild + document-wide icon rescan on every post.**
   `post()` → `renderWall()` does `wall.innerHTML = list.map(cardHtml).join("")` (re-renders
   *all* existing cards, not just the new one) and then `lucide.createIcons()` (rescans every
   `[data-lucide]` in the whole document). Measured as the 178.9 ms long-animation-frame above;
   cost is O(n) in wall length and grows as people sign. It also destroys/recreates all existing
   card DOM (drops focus/selection/scroll state, and re-runs would re-trigger sibling animations
   if `isNew` weren't being reset).
   **Rebuild fix:** insert only the new card — build one node and `wall.prepend(node)` — and scope
   icon creation to that subtree (or emit static inline `<svg>`), instead of blowing away and
   re-parsing the whole list. In sprig terms: a keyed list-prepend, not an `innerHTML` replace.

2. **[MED] `lucide.createIcons()` is unscoped and called on every render.** Same root cause as #1;
   even outside posting (e.g. demo-state switches) it re-parses the entire document's icons.
   **Rebuild fix:** scope icon creation to the changed node, or pre-render the feather icon as
   static SVG markup so no post-render JS icon pass is needed at all.

3. **[LOW] Programmatic smooth scroll stacked onto the post frame.** `post()` ends with
   `$("#wall").scrollIntoView({ behavior: "smooth" })` fired in the same tick the wall DOM was
   fully replaced and the new card began its `.animate-rise`, so it piles onto the same busy frame.
   **Rebuild fix:** with the insert-only render (#1) the frame is cheap, so the smooth scroll is
   fine as-is; just don't pair it with a full re-render.

### CSS

4. **[LOW] Post button animates `box-shadow` on hover/active.** `.btn` `transition-property`
   includes `box-shadow`; on hover the shadow is retained (repainted as bg-derived color shifts)
   and on `:active` it transitions to `0 0 0 0` (removed). Animating `box-shadow` repaints the
   shadow region each frame. Low severity here: one small button, 0.2s, not persistent.
   **Rebuild fix:** pre-render the rest/hover shadow on a `::before`/`::after` pseudo-element and
   cross-fade its `opacity`; transition only `transform`/`translate` + `background-color` on the
   button itself, not `box-shadow`.

### Checked and NOT flagged (so they aren't re-raised downstream)

- `updateCharCount()` runs on every `input` event but does a single `textContent` write with **no
  layout read** — no throttle needed, no thrash. Fine.
- **No forced synchronous layout** in composer handlers (no `offsetTop` / `getBoundingClientRect`).
- **No `setTimeout`/`setInterval`-driven animation** in the composer itself. (The `setTimeout`
  fade-out in `showToast()` is the **toast** unit's, not the composer's.)
- The textarea/input computed `transition: all 0s` is the UA default (duration 0 ⇒ nothing
  animates) — **not** a real `transition: all` jank case.
- The card transitions only `outline` (0.2s ease-in-out); `outline` doesn't trigger layout or
  affect siblings. Fine.
- `@keyframes brand-rise` animates `transform` + `opacity` only (compositable) — correct approach,
  and not applied to the composer anyway.

### Behavior note (not jank, for the spec-writer)

- `maxlength="240"` is set on `#msgInput`, so real typed input is hard-clamped at 240. The counter
  is a plain `N/240` string with **no near-limit / over-limit color or warning state** — it looks
  identical at 0/240, 75/240, and 240/240 (see the three desktop stills). The empty-submit guard
  shows a **warning toast** ("Your note is empty") + refocuses the textarea rather than disabling
  the button (button is never disabled).
