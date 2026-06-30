# message-composer

Page-local **island** under `pages/guestbook/components/message-composer/`. Selector `<message-composer>`.
The guestbook's left-column card: name input + message textarea + live char counter + "Sign the
guestbook" button. **This is the optimistic-write island** — its reason for existing is the post()
flow, not its (modest) visuals.

Source: `fixtures/eval-app/spec/ui/hearth-prototype.html` @ `data-theme="brand"` (light).
Evidence root: `…/breakdown/pages/guestbook/components/message-composer/` (`screenshots/`, `js/composer.js`,
`css/`, `_capture-data.json`, `jank.md`).

---

## 1. Classification & behavior

**Bucket:** folder with `logic.ts` ⇒ **island** (hydrates). Page-local to guestbook (lives under the
page's own `components/`), not shared — it appears only on the guestbook page.

**Why an island (one line):** it owns live local input state (name/message/charCount) and performs an
optimistic server write; static HTML can't carry the keystroke counter, the maxlength clamp, or the
post→rollback flow.

**Interaction tier: optimistic-write island.**

**Client state owned (signals):**

| signal | type | role |
|---|---|---|
| `name` | string | name input value; trimmed into the posted entry (blank ⇒ "guest") |
| `message` | string | textarea value; trimmed; empty-guarded |
| `charCount` | string (derived) | `` `${message.length}/240` `` — recomputed from `message`, **not** a stored signal |

A control-edit remount resets plain locals, so `name`/`message` are **signal-backed** (survive remount,
reviewer can toggle them live).

**Data source:** the composer has no read data of its own. It **writes** into a shared `messages` store —
a **module-level signal both this island and the wall import** (composer mutates, wall renders). It is
**NOT** a prop (a signal isn't serializable) and the composer does **NOT** reach across the DOM to append
to the wall. Honest-empty: in isolation no wall is mounted to render the mutation; the post is observed via
the `posted` output event + the store length (see Events).

**Liveness:** request-response. The write is `Backend.postMessage(entry)` fired in the background; there is
no pushed realtime stream into the composer.

**Optimistic write flow (the key case):**

1. Read `name`/`message`; `text = message.trim()`.
2. **Empty guard** — if `text === ""`: fire a **warning** toast (`"Your note is empty"` / `"Write a few warm
   words first."`), refocus `#msgInput`, and **return without writing**. The button is **never disabled**
   (evidence: `jank.md` behavior note) — the guard, not a disabled state, blocks empty posts.
3. **Snapshot** the shared `messages` store.
4. **Unshift the optimistic entry** to the front of the store: `{ id, name: name.trim(), avatar: null,
   message: text, minutesAgo: 0, isNew: true }` — appears instantly at the top of the wall, tagged for the
   `.animate-rise` entrance.
5. **Reset the composer** optimistically: clear `name`/`message`, `charCount → "0/240"`.
6. Fire `Backend.postMessage(entry)` **in the background**; on resolve, success toast (`"Message posted!"` /
   `"Thanks for signing the guestbook."`).
7. **On failure: roll back** — restore the snapshot (remove the optimistic entry), surface an **error** toast,
   and restore the composer's `name`/`message` so the note isn't lost. **NEVER** client-toast +
   `location.reload()`.

> Source vs. contract: the extracted prototype (`js/composer.js`) does the optimistic add + success toast +
> reset **locally with no network** (no `Backend`, no failure path). Steps 3/6/7 (snapshot, the real
> `Backend.postMessage` call, and the rollback + error toast) are the **analyst's prescribed architecture**,
> not extracted — see Gaps.

**Data-shape hazard:** the posted entry's `name` may be `""` (blank ⇒ wall renders "a guest") and `avatar`
is `null` (wall falls back to an initial-letter avatar — the "J" seen in `composer-after-post`). `minutesAgo:
0` ⇒ wall renders "just now"; `isNew: true` ⇒ wall applies `.animate-rise`. The composer produces these; the
wall consumes them.

---

## 2. Anatomy

```
<message-composer>                       aside .card .bg-base-100 .border .border-base-300 .shadow-sm
  ├─ h2.font-display      "Leave a message"                        (Caveat display face)
  ├─ p (muted)            "A warm note for whoever wanders in next."
  ├─ label                "What's your name?"
  ├─ .input  (wrapper)                                              daisyUI input, base-content border
  │    ├─ <i data-lucide="user">                                   leading user glyph
  │    └─ input#nameInput  placeholder="e.g. Jamie"  [name]
  ├─ p (help, muted, .text-xs)
  │      "Shown next to your message. Leave blank to sign as a guest."
  ├─ label                "Your message"
  ├─ textarea#msgInput .textarea .textarea-primary .h-28 .w-full
  │      placeholder="Leave a warm note…"  maxlength="240"  [message]
  ├─ .footer-row  (flex justify-between, .text-xs muted)
  │    ├─ span             "Keep it kind."
  │    └─ span#charCount   "0/240"                                  [derived from message]
  └─ button#postBtn .btn .btn-primary .btn-block
       ├─ <i data-lucide="feather">                                feather/quill glyph
       └─ "Sign the guestbook"
```

No slots / projected children — the composer is fully self-contained (no `<content>`).

---

## 3. Props table

| name | type | default | control widget | signal? |
|---|---|---|---|---|
| `name` | string | `""` | `text` | **yes** |
| `message` | string | `""` | `text` | **yes** |
| `maxLength` | number | `240` | `number` | no |

`charCount` is **derived** (`` `${message.length}/${maxLength}` ``), not a control. Placeholders
(`"e.g. Jamie"`, `"Leave a warm note…"`) and the labels are fixed template text, not props. The shared
`messages` store is an imported module signal, not a prop (not serializable) — see §1.

---

## 4. States → cases

| state | what it shows | case | screenshot to diff |
|---|---|---|---|
| **default / empty** | placeholders, `0/240`, button at rest | `cases/default` | `screenshots/composer-empty-desktop.png` |
| **typing / filled** | name `Jamie`, 75-char note, `75/240`, textarea border primary | `cases/typing` | `screenshots/composer-typing-desktop.png` |
| **at-limit (clamped)** | message at the 240 maxlength, `240/240`; counter has **no** over-limit color | `cases/at-limit` | `screenshots/composer-atlimit-desktop.png` |
| **posted / reset** | optimistic post complete → composer back to `0/240`, fields cleared | `cases/posted-reset` | `screenshots/composer-after-post.png` |
| **empty-guard** (behavioral) | submit with blank message ⇒ warning toast + refocus, **no write**; composer render = empty | (folds into `default` + Events #3) | `screenshots/post-empty-warning-fullpage.png` |
| **backend-failure / rollback** (behavioral) | optimistic entry removed, error toast, fields restored | (Events #5 — no static still) | — (analyst contract; see Gaps) |
| **textarea focus** (interaction) | 2px primary outline ring on `#msgInput` | (Motion §6 + interaction test) | `screenshots/composer-textarea-focus.png` |
| **dark theme** | `brand-dark` tokens (primary `#EA7A45`, base-100 `#1E1712`) | (documented; see Gaps) | `screenshots/composer-empty-dark.png` |

The button's rest/hover/active/focus-visible are pseudo-state interaction stills, not data cases — see §6.

---

## 5. Events

isolate-events `source` is `tag#id`; the host custom-event is `source === "message-composer"`. Each row is a
`capture(page)` predicate sketch for the build session to lift into `tests/*.spec.ts`.

**1 — live char count updates on input**
```ts
const ev = await capture(page);
await page.goto("/components/guestbook/message-composer/default");
await waitHydrated(page);
await page.locator("#msgInput").fill("Pulled up a chair and stayed a while — thank you for keeping the lights on.");
await ev.expect(e => e.source === "textarea#msgInput" && e.type === "input", { timeout: 3000 });
await expect(page.locator("#charCount")).toHaveText("75/240");
```

**2 — optimistic post (valid message) → posted output + reset**
```ts
await page.locator("#nameInput").fill("Jamie");
await page.locator("#msgInput").fill("Pulled up a chair and stayed a while — thank you for keeping the lights on.");
await page.locator("#postBtn").click();
await ev.expect(e => e.source === "button#postBtn" && e.type === "click");
await ev.expect(e => e.source === "message-composer" && e.type === "posted"
  && e.detail.name === "Jamie"
  && e.detail.message === "Pulled up a chair and stayed a while — thank you for keeping the lights on."
  && e.detail.minutesAgo === 0 && e.detail.isNew === true);
await expect(page.locator("#msgInput")).toHaveValue("");      // optimistic reset
await expect(page.locator("#charCount")).toHaveText("0/240");
```

**3 — empty guard (blank message) → warning, no write, refocus**
```ts
await page.goto("/components/guestbook/message-composer/default");
await waitHydrated(page);
await page.locator("#postBtn").click();
await ev.expect(e => e.source === "button#postBtn" && e.type === "click");
// assert NO posted output fires within 500ms (empty guard returned early):
await expect(ev.seen(e => e.source === "message-composer" && e.type === "posted")).resolves.toBe(false);
await expect(page.locator("#msgInput")).toBeFocused();        // refocus
```

**4 — maxlength hard clamp at 240**
```ts
await page.locator("#msgInput").fill("x".repeat(300));
await expect(page.locator("#msgInput")).toHaveValue(/^.{240}$/);
await expect(page.locator("#charCount")).toHaveText("240/240");
```

**5 — backend failure → rollback (analyst contract; build session stubs `Backend.postMessage` to reject)**
```ts
// build session forces Backend.postMessage -> Promise.reject(...) before goto
await page.locator("#nameInput").fill("Jamie");
await page.locator("#msgInput").fill("Pulled up a chair and stayed a while — thank you for keeping the lights on.");
await page.locator("#postBtn").click();
await ev.expect(e => e.source === "message-composer" && e.type === "posted");       // optimistic add first
await ev.expect(e => e.source === "message-composer" && e.type === "post-failed");  // then rollback
await expect(page.locator("#msgInput")).toHaveValue(                                // note restored
  "Pulled up a chair and stayed a while — thank you for keeping the lights on.");
```

---

## 6. Motion

The composer has **no entrance and no looping animation of its own** — `getAnimations()` is empty on the
card after load, and `@keyframes brand-rise` / `.animate-rise` is applied to **newly-posted wall cards and
toasts, not the composer**. Its only motion is the daisyUI button micro-feedback and the instant input
focus ring. Per-state computed values: `_capture-data.json` (`forced.*`). Filmstrip:
`screenshots/filmstrip.png` (rest → hover → :active → :focus-visible).

| Trigger | Element | Properties | Duration / easing | Extracted end-state |
|---|---|---|---|---|
| hover | `#postBtn` (`.btn`) | `background-color`, `border-color`, `box-shadow` | 0.2s `cubic-bezier(0,0,.2,1)` | bg darkens ~7% → `oklab(0.5147…)` ≈ deeper terracotta; shadow retained |
| `:active` (press) | `#postBtn` | `translate`, `background-color`, `box-shadow` | 0.2s `cubic-bezier(0,0,.2,1)` | `translate: 0 .5px` nudge; bg darkens ~5% → `oklab(0.5258…)`; **box-shadow collapses to `0 0 0 0`** |
| `:focus-visible` | `#postBtn` | `outline` (not transitioned) | instant | `outline: 2px solid #C2410C`, `outline-offset: 2px` |
| focus | `#msgInput` (`.textarea-primary`) | — (`transition: all 0s` ⇒ no animation) | instant | `outline: 2px solid #C2410C`, offset 2px; border already primary at rest |

**Jank findings + rebuild fixes** (full detail in `jank.md`; one optimistic post sampled — 222 frames,
0.5% dropped, **one 178.9 ms long-animation-frame on the post click**, CLS 0):

- **[HIGH] Full-wall `innerHTML` rebuild + document-wide `lucide.createIcons()` on every post.** The prototype's
  `post()` calls `renderWall()` which does `wall.innerHTML = list.map(cardHtml).join("")` + a whole-document
  icon rescan — the 178.9 ms LoAF, O(n) in wall length. **Rebuild fix: insert-only** — build one card node and
  `prepend` it (a keyed list-prepend, not an `innerHTML` replace); scope/skip the icon pass (pre-render static
  `<svg>`). This is the composer's headline fix and what the optimistic-write flow (§1 step 4) must do.
- **[MED]** `lucide.createIcons()` unscoped — same root cause; scope to the changed node or pre-render SVG.
- **[LOW]** smooth `scrollIntoView` stacked on the post frame — fine once the render is insert-only.
- **[LOW/CSS]** the post button transitions `box-shadow` (hover retains, `:active` → `0 0 0 0`). Cheap here
  (one small 0.2s button). Optional fix: move the shadow to a pseudo-element and cross-fade `opacity`,
  transition only `transform`/`background-color`.
- **Checked, NOT flagged:** `updateCharCount()` is a single `textContent` write, no layout read — keep it
  per-keystroke, no throttle. No forced sync layout, no timer-driven animation in the composer.

---

## 7. Responsive

The composer is **fluid-width** — the card fills its column and the textarea is `.w-full` (100%, overriding
the daisyUI `clamp(3rem,20rem,100%)`). **Internal layout never reflows**: label → field → help/footer always
stack vertically; the button is always `.btn-block` (full width). Breakpoint changes are the **page**
(`guestbook` page-composition) re-flowing the column, not the composer.

| Viewport | Behavior | Still |
|---|---|---|
| desktop ≥ ~1024 | left sidebar column; composer ~324px wide | `composer-empty-desktop.png` |
| ~700 | wider single column, composer near full content width; help text fully visible | `composer-empty-700.png` |
| mobile ~390 | full-width stacked above the wall | `composer-empty-mobile.png` |

The textarea height is fixed by `.h-28` (7rem / 112px) at every width. (The 700/mobile empty stills happen to
have `#nameInput` **focused** — the dark base-content focus ring — that's a capture artifact, not a layout
difference.) Source breakpoints belong to the page unit — **the composer declares no `@media` of its own
(verify against the page's grid during build).**

---

## 8. A11y

- **Roles/labels:** `<label>` "What's your name?" associated to `#nameInput`; `<label>` "Your message"
  associated to `#msgInput`. `#charCount` is decorative status text — pair it with the textarea via
  `aria-describedby` (and consider `aria-live="polite"` so the count is announced as it changes; **the source
  has neither — described, not extracted**). The empty-guard's warning is delivered via a toast (`role="alert"`,
  toast unit) — verify it's announced.
- **Focus order:** name input → textarea → post button (DOM order). No focus trap (not a dialog).
- **Keyboard:** the button is reachable/activatable by keyboard; Enter/Space fire `post()`. `#postBtn`'s
  `:focus-visible` shows a 2px `#C2410C` outline (offset 2px); `#msgInput` focus shows the same primary
  outline. Button is never disabled, so keyboard users can always trigger the empty-guard.
- **Reduced motion:** the authored theme guards it — `@media (prefers-reduced-motion: reduce) { animation/
  transition-duration: 0.01ms !important }` — so the button micro-feedback and any wall `.animate-rise`
  entrance are neutralized. The optimistic insert still happens instantly (no motion dependency).
- **Color/contrast:** post button is primary `#C2410C` on `#FFF8F1` text. **Counter caveat:** at `240/240` the
  counter is the same muted color as `0/240` — no over-limit color or warning. A reviewer relying on color
  gets no at-limit cue (maxlength is the only enforcement). Flagged as the known gap, not a bug to fix here.

---

## 9. Used on

- **Guestbook page** (`pages/guestbook/`) — left column, above the "and others signed today" avatar row.
  **Page-local, not shared** (evidence: appears only in `hearth-prototype.html`'s guestbook layout; no other
  page references `<message-composer>`).

---

## 10. Isolate build plan

**Lands at:** `pages/guestbook/components/message-composer/` (page-local island — has `logic.ts`). Files:
`template.html` + `logic.ts` + `styles.css` (button/textarea/input are daisyUI utility classes; encapsulated
overrides only if needed). **Selector = folder basename = `<message-composer>`.**

**Preview route(s)** (from `fixture.json` `category`/`folder`, **not** the source path):
`/components/guestbook/message-composer/<case>` —

| route | one-line state | diff against |
|---|---|---|
| `/components/guestbook/message-composer/default` | empty, `0/240`, button at rest | `screenshots/composer-empty-desktop.png` |
| `/components/guestbook/message-composer/typing` | `Jamie` + 75-char note, `75/240` | `screenshots/composer-typing-desktop.png` |
| `/components/guestbook/message-composer/at-limit` | message clamped at 240, `240/240` | `screenshots/composer-atlimit-desktop.png` |
| `/components/guestbook/message-composer/posted-reset` | post complete → reset to `0/240` | `screenshots/composer-after-post.png` |

**Events → specs:** §5 #1 (char count) and #4 (maxlength clamp) → `cases/typing/tests/char-count.spec.ts`.
§5 #2 (optimistic post + reset) → `cases/default/tests/optimistic-post.spec.ts` (posts the §5 typing data,
asserts the `posted` output + reset). §5 #3 (empty guard) → `cases/default/tests/empty-guard.spec.ts`. §5 #5
(backend rollback) → `cases/default/tests/rollback.spec.ts` (build session stubs `Backend.postMessage` to
reject; lift the predicates verbatim).

**Loop:** scaffold the folder → drop this `isolate/` in → `sprig isolate` → open each route, diff vs the listed
screenshot (counter text, button color `#C2410C`, primary focus ring, card border/shadow) → lift §5 Events into
the `tests/*.spec.ts` above → run → iterate until visual + behavioral pass, **before composing into the
guestbook page**. The optimistic-write flow (insert-only mutation of the shared `messages` signal, success
toast, failure rollback) is the acceptance bar — do not settle for client-toast + reload.

---

## Gaps (described, not extracted — verify during build)

- **`Backend.postMessage` call + failure rollback + `post-failed` output + input-restore** — the analyst's
  prescribed optimistic architecture; the source prototype (`js/composer.js`) writes locally with no network
  and has no failure path. No composer-specific still exists for the error state (the "Error toast" demo-panel
  button is a demo trigger, not the composer's failure path).
- **Isolate service-mocking for `Backend`** — `_mocks` only stubs sub-components by selector; mocking the
  `Backend` service to force a reject is a build-session spec concern (e.g. global stub) — verify the mechanism.
- **`at-limit` full message text** — the 240-char value in `cases/at-limit` is reconstructed from the
  textarea's visible (scrolled-to-end) tail plus its obvious repeating phrase; the ~214 chars above the scroll
  fold are inferred, the trailing `…whoever wa` and the exact 240 length are confirmed. Verify char-for-char.
- **`aria-describedby` / `aria-live` on the counter, and the over-limit counter color** — absent in source;
  recommended, not extracted.
- **Dark-theme case** — `composer-empty-dark.png` exists, but the theme is an ancestor `data-theme="brand-dark"`
  swap, not a composer prop; no per-case theme mechanism is declared in `isolate-format.md`. Verify whether the
  isolate stage can switch theme before adding a `dark` case.
- **Composer `@media`** — the composer declares none; responsive reflow is the page's grid. Confirm during
  composition.
