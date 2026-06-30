# guestbook — page

> **Classification:** `page-composition` (analyst). Folder `pages/guestbook/`, selector
> `guestbook`. This is the only page in Hearth; the whole prototype IS this page.
> Source: `spec/ui/hearth-prototype.html` (rendered `data-theme="brand"`, light).
> Evidence: `screenshots/` (desktop-1280, tablet-768, mobile-390, state-empty, state-loading,
> state-overflow), `js/page.js`, `css/page.css`.

---

## 1. Classification & behavior

A **page-composition**: it owns no view of its own beyond layout chrome. It **resolves data**
(`resolve.ts`) and **threads it into children**, wires the composer→wall→toast write loop, and
sets the responsive grid. It is not an island itself — the reactive state lives in `message-wall`.

### Composition (render order — matches the analyst contract)

1. `app-header` (static) — wordmark + tagline + "*N* have signed" counter (reads `signedCount`).
2. `message-composer` (island) — the "Leave a message" card; **writes** a new `Message`.
3. `social-proof` (static) — avatar-group + "and others signed today".
4. `message-wall` (island) — "On the wall" heading + count badge + "newest first" + the list of
   `message-card`s (and the empty / loading branches). **Holds the reactive `messages` signal**,
   seeded once from `resolve.ts`.
5. `toast` (island) — fixed `toast-end` stack for transient confirmations.

(2)+(3) sit in the left `aside`; (4) in the right `section`. The prototype's floating **Demo-states
panel** and its **Error-toast button** are throwaway scaffold — **do not ship them** (they only
existed to fake the four view-states + the error path in a static file).

### Data source & contract

`resolve.ts` returns `{ messages: Message[], signedCount: number }` (request-response, server-side).
The page threads:

- `messages` → `<message-wall [messages]>` → seeds the wall's `messages` signal (the one source of
  truth for both the card list and the count badge — never a second count source, per data-model
  hazard #2).
- `signedCount` → `<app-header [signed-count]>`.
- `loading` → `<message-wall [loading]>` (skeleton branch; client transient, see States).

`social-proof` is **honest-static** in the prototype (hard-coded 3 avatars + "+9"); the real query
("distinct signers in last 24h") is *described, not extracted — verify during build* (data-model
hazard #4). It does **not** vary by view-state in any captured screenshot.

### Liveness — request-response, NOT realtime

There is no websocket / poll / SSE / refresh interval anywhere in the source. The wall is **seeded
once** from `resolve.ts` and does not push.
**Honest-staleness note (carry into the wall's spec):** the wall reflects load-time state **plus the
current author's own optimistic additions only** — other guests' new entries appear **only on
refetch/reload**. Do not invent a realtime feed.

### The write — optimistic flow (the page owns this wiring)

The prototype's `post()` is an in-memory optimistic insert (`MESSAGES.unshift(entry)` →
`renderWall()` → success toast). The rebuild keeps it optimistic but real:

1. **Snapshot** the wall's `messages` signal.
2. **Mutate local island state** — `message-composer` emits its `post` output `{ name, message }`;
   the page prepends an optimistic `Message` (`minutesAgo: 0`, `isNew: true`, `avatar: null`) to the
   `message-wall` `messages` signal **in place** (keyed list-prepend, not a full re-render — see
   Motion / jank).
3. **Fire the POST in the background.**
4. **On success** keep it (reconcile the server `id` / `createdAt` into the optimistic row).
5. **On failure roll back** — restore the snapshot (remove the optimistic card) **and** surface the
   error toast *"Couldn't post your message — Something went wrong on our end. Give it another try."*
   (this copy is the prototype's scaffold **Error toast** button text — it is the real failure-path
   message, reused).

**Never** client-toast + `location.reload()`. The wall reconciles in place via its `messages` signal.

### Client state owned

The page owns **none** — it threads props. The reactive `messages` signal is owned by `message-wall`
(one island, justified: it must mutate the list in place for optimistic posts + count without a
reload). `loading` is a wall-local client transient. `toast` owns its own queue.

### Data-shape hazards relevant to this page (full list in `data-model.md`)

- **#1 `signedCount` fabricated aggregate / the 47-at-zero lie.** Header = `47 + list.length` in the
  mock. At zero messages the empty screenshot **still says "47 have signed"** — a lie. The captured
  `empty` case reproduces that screenshot (`signedCount: 47`), but **build must resolve it to the
  honest `0`** (real source: `count(messages)` ± a server-side historical offset). Flagged here and
  in the `empty` case.
- **#2 count badge desync.** The "On the wall" badge must always equal the rendered card count
  (`messages.length`), incl. the optimistic insert — derive from the same signal, never a second
  source.
- **#5 dual anonymous.** `name` may be `""` (composer blank) or `null` (seed) → both collapse to
  *"Anonymous guest"* (handled in `message-card`/`guest-avatar`).
- **#6 external avatar host.** Seed `avatar` URLs are `i.pravatar.cc`. Cases carry the **captured
  URLs** (to diff the real faces); build should lift representative images to `assets/` rather than
  hot-link. *Described, not extracted — verify during build.*

---

## 2. Anatomy

```
<guestbook>                                   ← page root (data-theme="brand" → light, see §A11y/build note)
├─ <app-header [signed-count]="signedCount"/> ← bg-base-200/40, border-b; max-w-5xl, py-7
│     [flame tile] Hearth                                   ⟨users⟩ 53 have signed   (counter: hidden < sm)
│     A community guestbook — pull up a chair.
└─ <main class="mx-auto max-w-5xl px-4 py-8 pb-28">
   └─ grid  gap-8  lg:grid-cols-[360px_minmax(0,1fr)]      ← (fix: minmax(0,1fr), see Responsive bug)
      ├─ <aside class="lg:sticky lg:top-6 self-start space-y-4">
      │   ├─ <message-composer/>     ← "Leave a message" card (name input, textarea, char count, submit)
      │   └─ <social-proof/>         ← avatar-group(-space-x-4) + "and others signed today"
      └─ <section class="min-w-0">   ← (fix: min-w-0 so the long-token track can shrink)
          ├─ header row:  «On the wall» <count badge>            ↑ newest first
          └─ <message-wall>          ← space-y-4 list of <message-card> | empty branch | 4 skeletons
<toast/>                             ← fixed toast-end z-50 (transient; renders nothing at rest)
```

Slots/children: the page composes by **selector**, not projected children — there is no
`<content>` / `_innerHtml`. Each child is its own folder-component (`app-header`, `message-composer`,
`social-proof`, `message-wall`, `toast`; the wall renders `message-card` which renders
`guest-avatar`).

---

## 3. Props table

The page's inputs are exactly what `resolve.ts` threads. Each scalar maps to one `fixture.json`
control; `messages` is an array (no widget) carried per-case as a bare prop.

| name | type | default | control widget | signal? |
|---|---|---|---|---|
| `messages` | `Message[]` | *(per case)* | — (array — carried in each `cases/*.json`, no widget) | no — threaded to `message-wall`, which seeds its own `messages` signal |
| `signedCount` | `number` | `53` | `number` | no |
| `loading` | `boolean` | `false` | `boolean` | **yes** — toggle the skeleton branch live without losing it on remount |

`Message = { id:number, name:string|null, avatar:string|null, message:string, minutesAgo:number }`
(the mock stores `minutesAgo`; the real schema is `createdAt` with `timeAgo` derived — data-model
hazard #3; freeze "now" for deterministic diffs).

---

## 4. States → cases

One case per row. The page's state is the **data state of the wall** (the four prototype
view-states, with the demo panel that drove them dropped). The count badge value is owned by
`message-wall` but listed here because it is visible in every page screenshot.

| Case | One-line state | `messages` | `signedCount` (header) | wall badge | Diff target |
|---|---|---|---|---|---|
| `default` | Normal — 6 seed cards, newest first | 6 seed (ids 1–6) | `53` (47+6) | `6` | `screenshots/guestbook-desktop-1280.png` |
| `empty` | Honest-empty — dashed "The wall is quiet…" card + CTA | `[]` | `47` **(the lie — resolve to `0`)** | `0` | `screenshots/guestbook-state-empty.png` |
| `loading` | 4 skeleton cards; badge shows `…` | 6 seed (drives header count only) + `loading:true` | `53` | `…` | `screenshots/guestbook-state-loading.png` |
| `overflow` | Wrap-torture — 70-char name + run-on + unbreakable token at top of 7 cards | 7 (id 901 torture + 6 seed) | `54` (47+7) | `7` | `screenshots/guestbook-state-overflow.png` |

Behavioral notes (verify in the child specs, surfaced here because they are page-visible):
- **`loading`** is a client transient — in the rebuild data is resolved server-side, so this branch
  is the wall's hydration/refetch skeleton (4 fixed skeleton cards, badge `…`). The prototype faked
  it via boot (`900ms`) and the demo panel (`1400ms`).
- **`empty` social-proof** still renders in the captured screenshot (mock is static); the honest-empty
  decision is that real `social-proof` should **collapse/hide** at zero recent signers (data-model
  honest-empty) — *described, not extracted — verify during build*. The `empty` case reproduces the
  captured screenshot (social-proof present).
- The optimistic post + warning/error toasts are **events** (§5), not separate page cases — they are
  exercised by tests over the `default`/`empty` cases.

---

## 5. Events

The page emits little directly; it **wires** child events into the optimistic write loop. These are
composition-level integration checks (each a `capture(page)` predicate + a DOM follow-up). Per-child
micro-events (button hover, `input` char-count, textarea focus) live in the child specs, not here.
Tests land under the case noted.

**E1 — Optimistic post prepends a card + fires success toast** (`default` case):
```ts
const ev = await capture(page);                     // install BEFORE goto
await page.goto("/pages/guestbook/default");
await waitHydrated(page);
await page.locator("message-composer textarea").fill("Hello from the test");
await page.locator("message-composer button").click();          // "Sign the guestbook"
await ev.expect(e => e.type === "click" && /button/.test(e.source), { timeout: 3000 });
// composition result — wall prepends the optimistic card, toast confirms:
await expect(page.locator("message-wall article").first()).toContainText("Hello from the test");
await expect(page.locator("[role='alert']")).toContainText("Message posted!");
// (the composer's own `post` output event — e.source === "message-composer", e.type === "post",
//  e.detail.message === "Hello from the test" — is asserted in the message-composer spec.)
```

**E2 — Empty-state CTA focuses the composer** (`empty` case):
```ts
const ev = await capture(page);
await page.goto("/pages/guestbook/empty");
await waitHydrated(page);
await page.getByRole("button", { name: /be the first to sign/i }).click();
await ev.expect(e => e.type === "click" && /button/.test(e.source));
await expect(page.locator("message-composer textarea")).toBeFocused();    // focusComposer()
```

**E3 — Empty submit shows a warning toast and adds no card** (`default` case):
```ts
const ev = await capture(page);
await page.goto("/pages/guestbook/default");
await waitHydrated(page);
const before = await page.locator("message-wall article").count();
await page.locator("message-composer button").click();          // textarea empty
await expect(page.locator("[role='alert']")).toContainText("Your note is empty");
expect(await page.locator("message-wall article").count()).toBe(before);   // no insert
```

(Failure-path rollback — E1 with a forced server error → optimistic card removed + error toast
*"Couldn't post your message"* — is owned by the wall/composer write loop; *described here, lifted to
the wall spec's tests during build*.)

---

## 6. Motion

The page has **no entrance/loop of its own**; all motion is delegated to children. Tokens are
verbatim from `design-tokens.md` / `css/page.css`.

- **New-card entrance** — `@keyframes brand-rise { from { opacity:0; transform:translateY(8px) } to
  { opacity:1; transform:none } }`, `.animate-rise { animation: brand-rise var(--dur-base)=320ms
  var(--ease-bounce)=cubic-bezier(0.34,1.56,0.64,1) both }`. Applied **once** to an optimistically
  posted card (`isNew`, then cleared). Compositor-only (opacity+transform) — **clean**, no rebuild
  needed. Filmstrip: `components/message-card/screenshots/filmstrip.png`.
- **Toast** — `animate-rise` on entrance; exit is an inline JS transition
  `opacity .25s, transform .25s` → `translateY(8px)` then removed at `260ms`. Owned by `toast`.
- **Button micro-feedback** (composer submit) — `0.2s cubic-bezier(0,0,.2,1)` bg/shadow + `:active`
  `translate 0 .5px`. Filmstrip: `components/message-composer/screenshots/filmstrip.png`.
- **`prefers-reduced-motion: reduce`** — global blanket
  `*{ animation-duration:.01ms!important; transition-duration:.01ms!important }`. Preserve. Note the
  toast's **inline** JS-set exit transition is not reliably caught by `!important` — gate it on a
  reduced-motion check (toast spec).

**Page-level jank finding to fix (the write path):** the prototype's `post()` →
`renderWall()` does `wall.innerHTML = list.map(cardHtml).join("")` + a document-wide
`lucide.createIcons()` rescan — a **178–195 ms long-animation-frame per post**, O(n) in wall size.
**Rebuild fix (this is exactly the optimistic flow in §1):** prepend only the **one** new keyed
card to the wall's `messages` signal and let the framework patch that node; inline the clock/feather
icons as static SVG so there is no post-render icon rescan. Then the 320 ms entrance runs alone.
The trailing smooth `scrollIntoView` is fine once the frame is cheap.

*No page-level filmstrip was captured (page motion is delegated) — the two child filmstrips above are
the references. Described, not extracted — verify the composed entrance during build.*

---

## 7. Responsive

The source file declares **no width `@media` of its own**; behavior comes entirely from Tailwind
default breakpoints (measured). Only `sm` and `lg` are used; `md`/`xl`/`2xl` unused.

| Width | Layout |
|---|---|
| `< 640px` (mobile-390) | Single column, mobile-first. Header counter "*N* have signed" **hidden** (`hidden sm:flex`). Composer + social-proof stack **above** the wall. Cards full-width, body text wraps to 3–4 lines. Container `max-w-5xl px-4`. Diff: `guestbook-mobile-390.png`. |
| `≥ 640px` (`sm`) | Header counter **appears** (the only `sm` change). Still single column until `lg`. Diff: `guestbook-tablet-768.png` (768 shows counter + single column). |
| `≥ 1024px` (`lg`) | Main becomes **two columns** `lg:grid-cols-[360px_1fr]` (composer 360px fixed, wall fluid) and the composer becomes **`lg:sticky lg:top-6`** (`self-start`) so it stays pinned while the wall scrolls. Diff: `guestbook-desktop-1280.png`. |

### LAYOUT BUG to fix (captured at the page level — record + correct in build)

The **overflow** state blows out page width: measured `scrollWidth 1396` at a `1280` viewport
(+116px horizontal overflow) and **+486px** at `390`. Root cause: the message body uses
`break-words [overflow-wrap:anywhere]` but **`break-words` (`overflow-wrap:break-word`) wins** and
does **not** reduce the element's *min-content* width, so the unbreakable token
(`Supercalifragilistic…xxxx`) forces the grid's `1fr` track (= `minmax(auto,1fr)`, min = `auto` =
min-content) wider than the viewport.

**Fix (all three, belt-and-suspenders):**
1. `lg:grid-cols-[360px_minmax(0,1fr)]` — let the wall track shrink below its content min.
2. `min-w-0` on the wall `section` (the grid item) — override `min-width:auto`.
3. Use `[overflow-wrap:anywhere]` **alone** on the message `<p>` (drop the redundant `break-words`,
   which loses to it and confuses min-content), so long tokens break to fit.

This is exposed by the `overflow` isolate case at the `1024`+ and `360` viewport presets — diff
against `guestbook-state-overflow.png` and assert the document does **not** scroll horizontally
(`scrollWidth <= clientWidth`).

---

## 8. A11y

- **Landmarks:** `<header>` (banner), `<main>`, `<aside>` (complementary — composer), `<section>`
  (the wall). Keep them as real elements.
- **Heading order:** `h1` "Hearth" (wordmark, font-display) → `h2` "Leave a message" (composer) →
  `h2` "On the wall" (wall) → `h3` "The wall is quiet… for now" (empty branch). One `h1`; no skips.
- **Counter:** `<app-header>` "*N* have signed" is hidden below `sm` (`hidden sm:flex`) — purely
  decorative duplicate of the wall badge, so hiding it is fine; do not make it the only count source.
- **Composer:** name input + textarea have visible `<legend>`/labels; helper text
  ("Shown next to your message…", "Keep it kind."); char counter `0/240` (`tabular-nums`). Submit is
  **never disabled** — empty submit raises a warning toast and refocuses the textarea (focus
  management on validation).
- **Focus order:** name → message → submit → (wall CTA when empty). The empty CTA's
  `focusComposer()` moves focus to the textarea — preserve as managed focus.
- **Toasts:** `role="alert"` (assertive). Ensure an `aria-live` region so screen readers announce
  post-success / validation / error.
- **Reduced motion:** honored globally (§6); verify the toast inline-transition gate.
- **Theme/contrast:** screenshots are `data-theme="brand"` (light) — see build note in §10.

---

## 9. Used on

This **is** a page (`pages/guestbook/`) — Hearth's single route (`/`). It is page-local, not shared.
Components it composes: `app-header`, `message-composer` (island), `social-proof`, `message-wall`
(island) → `message-card` → `guest-avatar`, `toast` (island). `message-card`/`guest-avatar` are
shared-capable (the wall, social-proof and composer-preview all render avatars/cards) — confirm
shared-vs-local placement from each child's own spec.

---

## 10. Isolate build plan

**Lands at:** `src/pages/guestbook/` — selector `guestbook` (folder basename). Page-composition →
template threads `resolve.ts` data into the child selectors; no `logic.ts` required on the page
itself (state lives in `message-wall`).

**Preview routes** (from `fixture.json`: `category:"guestbook"`, no `folder` → `/pages/<category>/<case>`):
- `/pages/guestbook/default` — normal, 6 seed cards → diff `screenshots/guestbook-desktop-1280.png`
- `/pages/guestbook/empty` — honest-empty branch → diff `screenshots/guestbook-state-empty.png`
- `/pages/guestbook/loading` — 4 skeletons, badge `…` → diff `screenshots/guestbook-state-loading.png`
- `/pages/guestbook/overflow` — wrap torture → diff `screenshots/guestbook-state-overflow.png`
  (also check `360`/`1024` viewport presets for the no-horizontal-scroll assertion, §7 bug)

**Cases → screenshots** (the one-line state each demonstrates): see §4 table.

**Events → tests:** E1 → `cases/default/tests/post-optimistic.spec.ts`; E3 →
`cases/default/tests/empty-submit-warning.spec.ts`; E2 → `cases/empty/tests/empty-cta-focus.spec.ts`.
The `overflow` case gets a no-horizontal-scroll assertion test
(`cases/overflow/tests/no-overflow.spec.ts`). (Build session lifts the §5 predicates verbatim.)

**Loop:** scaffold the page + its 5 children → build each **child** in isolation first (their own
`isolate/`), diffing against their stills → **then** compose `guestbook`: drop this `isolate/`, run
`sprig isolate`, open each `/pages/guestbook/<case>`, diff vs the page screenshot. During early
composition any not-yet-ready child may be `_mocks: { "<selector>": "stub" }`'d; **unstub before the
final diff**. Apply the §7 grid fix and re-check `overflow` at `1024`/`360`. Lift E1–E3 into the case
`tests/`, run, iterate. Compose-last — the page is the last unit to go green.

**Build-verify gaps (described, not extracted):**
- **Theme:** screenshots are `data-theme="brand"` (light) but the token default is `brand-dark`
  (design-tokens). There is no fixture field for theme — the page root (or shell) must render under
  `[data-theme="brand"]` for the diff to match. *Verify during build.* (`background` is set to the
  light base-100 `#FBF7F0` so the stage chrome matches.)
- **`signedCount` honest source** — the `empty` case carries `47` (the captured lie); build must wire
  the real `0`-at-zero source (hazard #1).
- **`social-proof` empty-collapse** + its real "signed today" query (hazard #4).
- **Avatar host** — cases carry captured `i.pravatar.cc` URLs; lift to `assets/` (hazard #6).
- **Composer `post` output event** exact name/detail shape (lifted from the composer spec).
