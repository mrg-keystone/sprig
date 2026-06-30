# index.md — Hearth breakdown

> Build-order, inventory, and completeness audit for the Hearth community-guestbook rebuild.
> Rebuild target: **sprig** (Deno SSR, folder-components, selective island hydration, Tailwind v4
> `@theme`). Source: `spec/ui/hearth-prototype.html` (one CDN-only throwaway file, rendered
> `data-theme="brand"`, light). Tokens: `design-tokens.md`. Schema: `data-model.md`.
>
> **Run scope (eval subset).** This breakdown run produced a **representative subset** of unit specs.
> **3 of 8 units** have a written `.md` + runnable `isolate/` (guestbook page, message-composer,
> message-card). The remaining **5 are spec-pending** — classified, assigned their DOM regions /
> listeners / motion, and listed in the build order, but **no unit `.md`, `isolate/`, or capture
> stills written this run.** They are itemized in §6 (Spec-pending). This is intentional, not a miss.

---

## 1. Page inventory

Hearth is a **single-page app** — the whole prototype is one route. No client-side routing
(`location.hash`, `#/`, `hashchange`, History API, `[data-view]`/`.view.active`) exists in the
source; there is exactly **one page**. The four prototype "view-states" (normal/empty/loading/overflow)
are **render states of the wall**, not separate pages — they were driven only by a throwaway demo panel.

| Page | Route | Classification | Purpose | Composes | Status |
|---|---|---|---|---|---|
| `guestbook` | `/` | page-composition | The community guestbook: read the wall + leave a message. Resolves `{ messages, signedCount }` server-side and threads it into children; wires the composer→wall→toast optimistic-write loop; sets the responsive grid. | `app-header`, `message-composer`, `social-proof`, `message-wall` (→ `message-card` → `guest-avatar`), `toast` | **DONE** (`pages/guestbook/guestbook.md` + `isolate/`) |

**Dropped, do not ship** (throwaway scaffold that existed only to fake states in a static file):
the floating **Demo-states panel** (`.fixed.bottom-4.left-4`, the 4 `.js-state` buttons) and the
**Error-toast button** (`#errToastBtn`). The error button's copy — *"Couldn't post your message /
Something went wrong on our end…"* — is the **real failure-path message** and is **reused** in the
optimistic-write rollback (see message-composer / the wall write loop), but the button itself is not shipped.

---

## 2. Component inventory + shared-usage matrix

Eight units total (1 page + 7 components). There is **one** page, so the page axis of the matrix is
degenerate (everything used by guestbook). The load-bearing sharing axis here is **intra-page** —
`guest-avatar` is the one primitive consumed by **>1 component** (`message-card` and `social-proof`),
which is why the analyst classified it **shared**.

### Component × page

| Component | Folder | Selector | Class. | Tier | Shared? (+evidence) | Data source | Renderable / capture | guestbook | Status |
|---|---|---|---|---|---|---|---|:--:|---|
| `app-header` | `pages/guestbook/components/app-header/` | `app-header` | static | static | page-local (only in the guestbook header) | prop `signedCount` ← `resolve.ts` | yes | ✓ | **spec-pending** |
| `message-composer` | `pages/guestbook/components/message-composer/` | `message-composer` | island | optimistic-write island | page-local (only `<message-composer>` in source) | **writes** the shared `messages` store + `Backend.postMessage` | yes | ✓ | **DONE** |
| `social-proof` | `pages/guestbook/components/social-proof/` | `social-proof` | static | static | page-local (only in the guestbook aside) | server-resolved "signed today" subset + "+N" (mock: hard-coded) | yes | ✓ | **spec-pending** |
| `message-wall` | `pages/guestbook/components/message-wall/` | `message-wall` | island | island (request-response) | page-local (only the wall) | `messages` ← `resolve.ts`; owns the reactive `messages` signal | yes | ✓ | **spec-pending** |
| `message-card` | `pages/guestbook/components/message-card/` | `message-card` | static | static | page-local (sole consumer = the wall) | props (one `Message`) from the wall | yes | ✓ | **DONE** |
| `guest-avatar` | `shared-components/guest-avatar/` | `guest-avatar` | static | static | **shared** — consumed by `message-card` (w-12 photo/initials) **and** `social-proof` (w-9 group + "+N" chip) | props (`name`/`avatar`/`id` subset of `Message`) | yes | ✓ | **spec-pending** |
| `toast` | `pages/guestbook/components/toast/` | `toast` | island | pure-client island | page-local (single `#toasts` mount) | none — transient queue, no data read | yes (transient; renders nothing at rest) | ✓ | **spec-pending** |

**Composition tree** (selector composition, not projected children — no `<content>`):
```
guestbook  (page-composition)
├─ app-header                       static
├─ message-composer                 island  (writes → messages store; fires toasts)
├─ social-proof                     static  └─ guest-avatar (×3 + "+9" chip)
├─ message-wall                     island  (owns messages signal; loading/empty branches)
│   └─ message-card  (×N)           static
│        └─ guest-avatar            static  (photo | tinted-initials)
└─ toast                            island  (pure-client transient stack)
```

> **Folder note for `guest-avatar`.** Per the `ui-breakdown` contract, a component used by >1
> consumer goes in `shared-components/<name>/`. With only one page, "shared" here means
> shared-across-components. **Consistency finding (carry to build):** the written `message-card.md`
> (§2 anatomy) currently **inlines** the avatar markup (photo / tinted-initials slot) rather than
> composing `<guest-avatar>`. When `guest-avatar` is specced (spec-pending), the build must decide
> whether `message-card` + `social-proof` **delegate** to `<guest-avatar>` (extract the slot) or keep
> it inlined; the `guest-avatar` unit reconciles `initials()`, `AVATAR_TINTS[id % 3]`, the photo-in-ring
> vs placeholder branch, and the size variants (w-12 card / w-9 group). See §5 risk R4.

---

## 3. Interaction / tier summary

The classification test is **"needs a `logic.ts` the server can't re-render"**, not "looks interactive".
**Default static; every island justified below.** Of 7 components, **4 are static** and **3 are islands**
— the page itself is a composition, not a whole-page island (no smell).

### Static (template-only, zero `logic.ts`)
| Component | Why static |
|---|---|
| `app-header` | Pure display of a server-resolved `signedCount`; no clicks, inputs, or state. (In the mock, `renderWall()` writes `#signedCount` as a side effect — in the rebuild this becomes a read-only prop from `resolve.ts`, so the header carries no JS.) |
| `social-proof` | Server-resolved avatar group + "+N" count; the prototype's markup is fully static. No client behavior. |
| `message-card` | Pure projection of one `Message`. Only motion is the CSS-only `animate-rise` entrance gated by a plain `isNew` prop — a keyframe, not script. |
| `guest-avatar` | Pure: photo-in-ring vs tinted-initials placeholder, derived from `name`/`avatar`/`id`. No state. |

### Islands (justified)
| Island | Tier | Liveness | Justification (the client JS the server can't re-render) |
|---|---|---|---|
| `message-composer` | **optimistic-write island** | request-response | Live char counter (`message.length/240`), `maxlength=240` clamp, and the **optimistic post → rollback** flow: snapshot → unshift optimistic entry into the shared `messages` store → `Backend.postMessage` in the background → reconcile on success / roll back + error toast on failure. **Never** client-toast + `location.reload()`. |
| `message-wall` | **island (request-response)** | request-response (**NOT realtime**) | Owns the reactive `messages` signal — must mutate the list **in place** to prepend the composer's optimistic card and keep the count badge in sync **without a reload**. Also owns the loading-skeleton transient (4 skeleton cards, badge `…`) and the honest-empty branch. |
| `toast` | **pure-client island** | n/a (no data) | Transient notification queue: append a toast node, `animate-rise` entrance, auto-dismiss at `3200ms`, inline exit transition (`opacity/transform .25s`) + removal at `260ms`. Pure client ephemeral UI, no server read/write of its own. |

- **Optimistic-write surface:** `message-composer` (writer) → shared `messages` store → `message-wall`
  (renders/reconciles) → `toast` (confirms / surfaces failure). One write, three islands cooperating.
- **Realtime / pushed panels:** **NONE.** There is no websocket, SSE, poll, or `setInterval` refresh
  anywhere in the source. The wall is **seeded once** from `resolve.ts` and does not push.
  **Honest-staleness:** the wall reflects load-time state **plus the current author's own optimistic
  additions only** — other guests' entries appear **only on refetch/reload**. Do not invent a feed.
- **Honest-empty (every live surface):** `message-wall` empty → dashed "The wall is quiet… for now"
  card + "Be the first to sign" CTA (the zero-row truth — ship it). `app-header` `signedCount` at zero
  → **`0`, not `47`** (hazard #1). `social-proof` at zero recent signers → **collapse/hide**, not "+0".

### Data-shape hazards (full detail in `data-model.md`; owners noted)
| # | Hazard | Owner(s) |
|---|---|---|
| 1 | `signedCount` is a fabricated global aggregate (`47 + list.length`); at zero it lies ("47 have signed" with 0 rows). Resolve to a real `count(messages)` ± server offset; honest `0` at empty. | `app-header`, page `resolve.ts` |
| 2 | `wallCount` badge must always equal rendered card count (incl. optimistic insert) — derive from the **same** `messages` signal, never a second source. | `message-wall` |
| 3 | `minutesAgo` is a prototype shortcut; the real field is `createdAt`, relative time derived. Freeze "now" for deterministic diffs. | `message-card`, `data-model` |
| 4 | `social-proof` "+9 and others signed today" is a fabricated aggregate over a "signed today" subset minus shown avatars. Decide the real query + empty collapse. | `social-proof` |
| 5 | Dual "anonymous" representation: `name` may be `null` (seed) or `""` (composer blank) — both collapse to "Anonymous guest". Normalize at the boundary. | `guest-avatar`, `message-card`, `message-composer` |
| 6 | External avatar host (`i.pravatar.cc`) baked into seed rows; treat `avatar` as an opaque optional URL, lift sample images to `assets/`. | `guest-avatar`, `message-card` |
| 7 | Overflow torture data (70-char hyphenated name + run-on + unbreakable token) is a **wrap-robustness** case, not perf — do **not** spec virtualization/pagination (dataset ≤7). | `message-card`, `message-wall`, page §7 grid bug |

---

## 4. Build order

Strictly **tokens → shared primitives → shared composites / page-local statics → page-local islands →
page composition**. Each tier diffs clean in `isolate/` before the next builds on it.

| # | Tier | Unit(s) | Depends on | Status |
|---|---|---|---|---|
| 0 | **Tokens** | `design-tokens.md` `@theme` → `shell/styles.css` (palette **both** variants — default `brand-dark`, `[data-theme="brand"]` = light to match screenshots; fonts; radii; `--ease-bounce`/`--dur-base`; `@keyframes brand-rise` + `.animate-rise`; reduced-motion guard) | — | DONE (doc) |
| 0b | **Shared store** | the module-level `messages` signal (imported by both `message-composer` (writes) and `message-wall` (renders)) | tokens | implied by composer/wall specs |
| 1 | **Shared primitive** | `guest-avatar` (static) | tokens | **spec-pending** |
| 2 | **Shared composite** | `message-card` (static) — composes `guest-avatar` | tokens, `guest-avatar` | **DONE** |
| 3 | **Page-local statics** | `app-header` (static), `social-proof` (static — composes `guest-avatar`) | tokens, `guest-avatar` | **spec-pending** |
| 4 | **Pure-client island** | `toast` (island) — independent; needed by composer/wall write loop | tokens (keyframes) | **spec-pending** |
| 5 | **Page-local islands** | `message-composer` (writes `messages` store, fires `toast`), then `message-wall` (renders `messages`, composes `message-card`, owns loading/empty) | tokens, store, `toast`, `message-card` | composer **DONE**; wall **spec-pending** |
| 6 | **Page composition** | `guestbook` — threads `resolve.ts`, wires composer→wall→toast optimistic loop, applies the §7 grid fix. **Compose-last; the page is the last unit to go green.** | all of the above | **DONE** (page spec; depends on pending children) |

**Cross-cutting build notes:**
- Build the **shared `messages` store (0b)** before either island in tier 5 — both import it; the composer
  mutates, the wall renders. It is not a prop (a signal isn't serializable) and the composer must **not**
  reach across the DOM to the wall.
- **Retire daisyUI + Lucide-JS:** the source leans on daisyUI 5 component classes (`btn`, `card`,
  `badge`, `avatar`, `alert`, `toast`, `skeleton`, `input`, `textarea`, `fieldset`) and Lucide via
  `lucide.createIcons()`. Reconstruct with Tailwind v4 utilities (recipes in `design-tokens.md` §
  daisyUI→Tailwind) and **inline the SVGs** (`flame, users-round, user-round, feather, arrow-up, clock,
  party-popper, circle-alert, triangle-alert, info, check`) — no runtime icon JS in the deliverable.
- **The headline performance fix lives in the wall, not the card/composer:** the prototype's `post()` →
  `renderWall()` does `wall.innerHTML = list.map(cardHtml).join("")` + a document-wide
  `lucide.createIcons()` rescan — a **178–195 ms long-animation-frame per post**, O(n) in wall size.
  The rebuild **prepends one keyed `<message-card isNew>` node** and inlines icons as static SVG; the
  320 ms entrance then runs alone. (Documented in the page spec §6 and message-card §6 — owned by the wall.)

---

## 5. Risks / unknowns

- **R1 — Default-theme flip.** Screenshots/captures are `data-theme="brand"` (light) but the token
  default (`css-variables.json`) is `brand-dark`. There is **no fixture field for theme**; the page
  root / shell must render under `[data-theme="brand"]` for the diff to match. Build must not silently
  render light when the token default is dark. (`design-tokens.md` §Default-theme decision.)
- **R2 — Type-scale divergence.** The design system defines a `--step-*` modular scale the **prototype
  did not use** (it used Tailwind built-ins). Reproduce the **rendered** sizes for diff fidelity; expose
  `--text-step-*` as available-but-unapplied. Do not silently swap sizes. (`design-tokens.md` §Type scale.)
- **R3 — `signedCount` honest source (hazard #1).** Captured `empty` case carries `47` (the lie); build
  must wire the real `0`-at-zero source. Owned by `app-header` + page `resolve.ts`.
- **R4 — `guest-avatar` not yet extracted.** It's in the inventory as the shared primitive, but the
  written `message-card.md` inlines the avatar slot. The spec-pending `guest-avatar` unit must reconcile
  delegation vs inlining across `message-card` and `social-proof` (size + variant params). (§2 folder note.)
- **R5 — `social-proof` real query + empty collapse (hazard #4).** The mock's "+9 and others" is static
  fabrication; the real "distinct signers in last 24h" query and the zero-signers collapse are *described,
  not extracted — verify during build.*
- **R6 — Composer `Backend` failure path is prescribed, not extracted.** The source `post()` writes
  in-memory with no network and no rollback; the snapshot → `Backend.postMessage` → rollback + error toast
  is the analyst's architecture. Build session stubs `Backend.postMessage` to reject. (composer spec Gaps.)
- **R7 — Page-overflow layout bug (must fix).** The `overflow` state scrolls horizontally
  (`scrollWidth 1396 @ 1280`). Fix = `lg:grid-cols-[360px_minmax(0,1fr)]` + `min-w-0` on the wall section
  + `[overflow-wrap:anywhere]` alone on the message `<p>`. Assert `scrollWidth <= clientWidth` at 360/1024.
  (page spec §7.)
- **R8 — Toast reduced-motion gate.** The toast's **inline** JS-set exit transition (`.25s`) is not
  reliably caught by the global `!important` reduced-motion rule (inline styles). Gate the exit on a
  reduced-motion check or set it via a class. Owned by the spec-pending `toast` unit. (`design-tokens.md`
  §prefers-reduced-motion.)
- **R9 — External avatar host (hazard #6).** Cases carry captured `i.pravatar.cc` URLs to diff real
  faces; build lifts representative images to `assets/` rather than hot-link.
- **R10 — 5 units carry no spec/isolate yet (run scope).** See §6 Spec-pending — these block tiers 1, 3,
  4, and the wall in tier 5, and therefore gate the final `guestbook` compose-last diff.

---

## 6. Completeness audit

Walked **every top-level DOM region** of the (one) page and **every listener / timer / observer /
animation** in the source `<script>`. Each maps to exactly one component/composition entry, or to
explicitly-dropped throwaway scaffold. **Unassigned (truly orphaned) = none.** Separately, 5 mapped
units have **no written spec/isolate this run** — itemized as Spec-pending (this is run scope, honestly
reported; it is **not** the same as "unassigned").

### 6a. DOM region → owner (guestbook page)

| Source region (line) | Owner | Status |
|---|---|---|
| `<header>` — flame tile, `h1` "Hearth", tagline, `#signedCount` "N have signed" (L85–101) | `app-header` | spec-pending |
| `<main>` grid wrapper `lg:grid-cols-[360px_1fr]` (L104–105) | `guestbook` (page chrome) | DONE |
| composer card `.card` (L109–136) | `message-composer` | DONE |
| social-proof block `.avatar-group` + "+9" + "and others signed today" (L139–149) | `social-proof` (avatars → `guest-avatar`) | spec-pending |
| wall header row — `h2` "On the wall" + `#wallCount` badge + "newest first" (L153–162) | `message-wall` (chrome + count badge) | spec-pending |
| `#wall` list container (L165) | `message-wall` | spec-pending |
| each rendered `<article>` card (`cardHtml`, L266–284) | `message-card` | DONE |
| avatar slot inside card (`avatarHtml`, L250–264) | `guest-avatar` (currently inlined in card — R4) | spec-pending |
| skeleton card (`skeletonCardHtml`, L286–299) | `message-wall` (loading branch) | spec-pending |
| empty state (`emptyStateHtml`, L301–314) + "Be the first to sign" CTA | `message-wall` (empty branch; CTA `focusComposer()` wired by page E2) | spec-pending |
| Demo-states panel `.fixed.bottom-4.left-4` + 4 `.js-state` btns (L171–186) | **DROPPED scaffold** | n/a (not shipped) |
| `#errToastBtn` (L182–184) | **DROPPED scaffold** (copy reused in write-failure path) | n/a |
| `#toasts` container (L189) | `toast` | spec-pending |

### 6b. Source JS (listener / timer / fn / animation) → owner

| Source (line) | What | Owner | Status |
|---|---|---|---|
| `#postBtn` click → `post()` (L420) | optimistic write | `message-composer` | DONE |
| `#msgInput` input → `updateCharCount()` (L421) | live char count | `message-composer` | DONE |
| `#msgInput` `maxlength=240` (L422) | hard clamp | `message-composer` | DONE |
| `post()` (L377–407) | snapshot/unshift/reset + scrollIntoView; calls wall + toast | `message-composer` (write loop; reconcile in `message-wall`, confirm in `toast`) | composer DONE; wall/toast pending |
| `renderWall()` (L317–346) | list/empty/loading render, `#wallCount` badge | `message-wall` | spec-pending |
| `renderWall()` side effect: `#signedCount` write (L335) | header count | `app-header` (rebuild: prop from `resolve.ts`, not a render side effect) | spec-pending |
| `showToast()` (L349–373) + `setTimeout 3200` + `setTimeout 260` + inline exit transition | toast queue/dismiss | `toast` | spec-pending |
| `focusComposer()` (L409–412) — empty-CTA `onclick` | focus mgmt | `message-wall` (CTA) → `message-composer` (focus target); wired by page E2 | composer DONE; wall pending |
| `.js-state` ×4 click listeners (L424–437) + demo `setTimeout 1400` | demo state switch | **DROPPED scaffold** | n/a |
| `#errToastBtn` click (L439–441) | demo error toast | **DROPPED scaffold** (copy → write-failure rollback) | n/a |
| boot: `lucide.createIcons()` + `renderWall()` + `setTimeout 900` loading→normal (L444–446) | fake initial load | `message-wall` (hydration/refetch skeleton transient) | spec-pending |
| `initials()` (L227–231), `AVATAR_TINTS` + `id % 3` (L244–248), `avatarHtml()` (L250–264) | avatar derivation | `guest-avatar` | spec-pending |
| `timeAgo()` (L233–241) | relative-time label | `message-card` | DONE |
| `cardHtml()` (L266–284) | one card | `message-card` | DONE |
| `escapeHtml()` (L222–225) | HTML escaping | render concern (framework auto-escapes; no component owns) | n/a |
| `lucide.createIcons()` (every render) | icon hydration | **all components** — replaced by inline static SVG (no runtime icon JS) | per-unit |
| `@keyframes brand-rise` / `.animate-rise` (L74–75) | entrance | `message-card` (new card) **and** `toast` (entrance) | card DONE; toast pending |
| `prefers-reduced-motion` guard (L76–78) | motion reduction | tokens (`shell/styles.css`); toast inline-exit gate = R8 | tokens DONE; toast pending |
| button micro-feedback + input/textarea focus rings (daisyUI) | micro-motion | `message-composer` | DONE |

### 6c. Unassigned

**Unassigned: none.** Every DOM region, every event listener, every timer, and every animation in the
source maps to exactly one component/composition — or to explicitly-dropped throwaway scaffold (the
demo-states panel + error-toast button, whose failure copy is reused in the write-rollback path). No
interaction lacks a tier; every island is justified (§3); the only live data panel (the wall) is marked
**request-response (not pushed)** with an honest-staleness + honest-empty note.

### 6d. Spec-pending (mapped + classified, but **no `.md` / `isolate/` / capture stills written this run**)

These are **not** unassigned — they have owners, tiers, DOM regions, and listeners assigned above. They
simply have **no unit spec, no runnable `isolate/` proposal, and no dedicated capture stills** yet (the
eval ran capture + spec-writing over a representative subset). Each still needs: its `<name>.md`,
`isolate/fixture.json` + `cases/<state>/`, component-isolated `screenshots/`, and an Isolate build plan.

| Unit | Class. / tier | Why it still needs a spec | Capture evidence today |
|---|---|---|---|
| `guest-avatar` | static (shared) | The shared primitive (R4) — must reconcile `initials()`/`AVATAR_TINTS[id%3]`/photo-vs-placeholder/size variants and decide delegation from `message-card` + `social-proof`. **Blocks tiers 2 & 3.** | embedded only (inside `message-card` stills + page social-proof) |
| `app-header` | static | `signedCount` honest source (R3); read-only prop, zero JS. | embedded only (`guestbook-desktop-1280.png` header) |
| `social-proof` | static | Real "signed today" query + empty collapse (R5); avatar group via `guest-avatar`. | embedded only (page stills) |
| `message-wall` | island (request-response) | Owns the `messages` signal, the optimistic in-place prepend, the count-badge sync (hazard #2), the loading-skeleton + honest-empty branches, the §6 wall innerHTML→insert-only perf fix, and the §7 overflow grid fix. **Highest-risk pending unit; gates the page compose.** | page-level only (`guestbook-state-empty/-loading/-overflow.png`); no component-isolated stills |
| `toast` | pure-client island | Queue + entrance + auto-dismiss (3200/260 ms) + the reduced-motion exit gate (R8); success/error/warning/info tones. | embedded only (`post-success-fullpage.png`, `post-empty-warning-fullpage.png`) |

**Audit verdict:** classification + assignment **complete** (no orphans); deliverable **incomplete by
run scope** — 3/8 units shipped with spec + isolate, **5/8 spec-pending** (capture + spec-writer passes
must run over `guest-avatar`, `app-header`, `social-proof`, `message-wall`, `toast` before the
`guestbook` compose-last diff can close). `index.md` Unassigned ships empty as required.
