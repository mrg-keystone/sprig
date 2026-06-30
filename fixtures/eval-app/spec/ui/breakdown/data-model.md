# data-model.md — Hearth

> The mock's hardcoded data **is** the implied backend schema. Schema, value-sets, cardinality,
> generation rules, and the component→entity reverse index only — **no data rows** (those live in
> isolate case JSON). Source: the `SEED_MESSAGES` / `OVERFLOW_MESSAGES` arrays and the render
> functions in `hearth-prototype.html`.

## Entities

The whole "backend" is **one flat entity**. There are no relations, no nesting, no joins.

### `Message` (a guestbook entry)

| Field | Type | Value-set / constraints | Notes |
|---|---|---|---|
| `id` | integer | PK, unique | Seed ids `1–6`; overflow torture id `901`; runtime new posts start at `1000` and increment (`nextId++`). Also used as the avatar-tint selector: `id % 3`. |
| `name` | string \| null | free text; **empty string AND `null` both mean anonymous** | Renders as `"Anonymous guest"` when blank/`null` after `.trim()`. `initials()` derives a 1–2 letter monogram from it. **Hazard:** two distinct "no name" representations — normalize. |
| `avatar` | string(URL) \| null | external image URL or `null` | `null` → tinted-initials placeholder. Seed uses `https://i.pravatar.cc/96?img=N` (N ∈ {47,15,8} for photo entries). **Hazard:** external host dependency — the rebuild should not bake pravatar into the schema; treat avatar as an optional image ref and lift sample images to `assets/` for fixtures. |
| `message` | string | **max 240 chars** (client `maxlength="240"` + char counter), required (non-empty after trim) | Free text incl. unicode/emoji (seed has `🌍`) and unbreakable tokens (overflow set). Must be HTML-escaped on render (`escapeHtml`). |
| `createdAt` | timestamp | — | **NOT in the mock.** The mock stores `minutesAgo` (integer) instead — a prototype shortcut. See hazard below. The real schema field is a creation timestamp; relative time is computed at render. |

Transient (UI-only, **not** schema):

| Field | Type | Notes |
|---|---|---|
| `isNew` | boolean | Set on optimistically-posted entries to trigger the `animate-rise` entrance once, then cleared (`m.isNew = false`) after first render. Never persisted; lives only in client signal state. |

### Value-sets / enums

- **View state** (UI, not data): `viewState ∈ {"normal", "empty", "loading", "overflow"}` — these
  are **render states of the wall**, not entity values. They become `message-wall` states→cases.
  Driven only by throwaway scaffold (the demo panel) + the initial fake-load.
- **Toast kind**: `{"success", "error", "warning", "info"}` — UI notification tone, not stored data.
- **Avatar tint** (for placeholder avatars): rotates `id % 3` over
  `[neutral, secondary, accent]` (`AVATAR_TINTS`). Deterministic from `id`.

## Cardinality at load

| Set | Count at load | Composition |
|---|---|---|
| `SEED_MESSAGES` (normal) | **6** | ids 1–6; mix of 3 photo + 3 placeholder avatars; `minutesAgo` 8 → 1500 |
| `OVERFLOW_MESSAGES` | **7** | 1 torture entry (id 901: 70+ char name, run-on + unbreakable token) prepended to the 6 seed |
| empty | **0** | honest-empty state rendered |
| loading | n/a | 4 skeleton cards (fixed count) shown for ~900ms boot / ~1400ms demo |

Ordering: **newest first** (the header says "newest first ↑"). The seed array is already in
newest-first order (ascending `minutesAgo`); optimistic posts `unshift` to the front
(`minutesAgo: 0`). Real schema: `ORDER BY createdAt DESC`.

## Generation

- **Seeded & fully deterministic.** All content is the hardcoded `SEED_MESSAGES` literal — no RNG,
  no `Date.now()`. `timeAgo(minutesAgo)` and `initials(name)` and `id % 3` tints are pure functions
  → identical render every load. Good for fixtures: case JSON can carry exact values.
- **The one non-determinism in a faithful rebuild:** relative time. The mock dodges it by storing
  `minutesAgo` literals. A real app stores `createdAt` and computes `timeAgo(now − createdAt)`,
  which drifts with wall-clock. **For deterministic fixtures/screenshots, freeze "now"** (or keep
  storing a fixed offset in fixtures) so `timeAgo` output is stable across captures.
- `timeAgo` buckets (reproduce exactly): `<1 → "just now"`; `<60 → "{n} min ago"`;
  `<24h → "{h} hour(s) ago"`; `==1 day → "yesterday"`; else `"{d} day(s) ago"`.

## Component → entity reverse index

| Component | Reads / writes | Fields touched |
|---|---|---|
| `message-card` | reads 1 `Message` | `name`, `avatar`, `message`, `minutesAgo`(→createdAt), `isNew` |
| `guest-avatar` | reads `Message` subset | `name` (→ initials), `avatar`, `id` (→ tint) |
| `message-wall` | reads `Message[]` + count | the list; `length` → `#wallCount` badge |
| `message-composer` | **writes** a new `Message` | creates `{name, message}`; server assigns `id`,`createdAt` |
| `social-proof` | reads `Message[]` subset + aggregate | recent signers' avatars + "and N others" count |
| `app-header` | reads aggregate count | `signedCount` = derived total (see hazards) |

## Data-shape hazards (flag for the builder — these are correctness traps, not perf)

1. **`signedCount` is a fabricated global aggregate.** Header shows
   `base(47) + (empty ? 0 : list.length)`. The `47` is a hard-coded fiction. **Decide a real
   source**: `count(messages)` (+ optional historical offset stored server-side), or a dedicated
   counter. In honest-empty it currently shows `47` — but with zero messages "47 have signed" is a
   lie; the honest value is `0`. Resolve before build.
2. **`wallCount` badge is a layout-rendered count.** It must always equal the number of cards
   actually rendered (`list.length`), including the optimistic insert. Derive it from the **same**
   `messages` signal the wall renders — never a second source of truth, or it desyncs after a post.
3. **`minutesAgo` vs `createdAt`.** Stored relative time is a prototype shortcut. The schema field
   is a timestamp; relative display is derived. Don't persist `minutesAgo`.
4. **`social-proof` "+9 and others signed today"** is an aggregate over a "signed today" subset
   minus the shown avatars. Both the subset selection (which 3 avatars) and the "+N" count are
   fabricated in the mock (static markup). Decide the real query (e.g. distinct signers in last
   24h) and the empty behavior (see honest-empty).
5. **Dual "anonymous" representation.** `name` can be `null` (seed) or `""` (composer leaves blank).
   Both must collapse to `"Anonymous guest"`. Normalize at the boundary.
6. **External avatar host.** `i.pravatar.cc` is a third-party dependency baked into seed rows.
   The schema should treat `avatar` as an opaque optional URL; fixtures should lift representative
   images into `assets/` rather than hot-link.
7. **Overflow torture data is a wrap-robustness case, not a perf case.** id 901's 70-char hyphenated
   name + 350-char run-on + unbreakable `Supercalifragilistic…xxxx` token exist to prove the card
   wraps (`break-words [overflow-wrap:anywhere]`) without blowing out the `360px / 1fr` grid. Keep
   it as a `message-card` / `message-wall` `overflow` case. **Do not** spec virtualization /
   pagination / perf — the data set is tiny (≤7).

## Honest-empty

The mock **always has data** (6 seed entries; the boot even fakes a 900ms load then settles to
normal). The empty state is only reachable via the throwaway demo panel. **Build must render the
honest-empty branch when `resolve.ts` returns zero messages**, not treat "has data" as guaranteed:

- **`message-wall` empty** — the real honest-empty: a dashed-border card, feather icon, *"The wall
  is quiet… for now"*, *"No one has signed yet. Be the first…"*, and a primary CTA *"Be the first
  to sign"* that focuses the composer. Ship this branch; it is the zero-row truth.
- **`app-header` signedCount** at zero — see hazard #1 (should read `0`, not `47`).
- **`social-proof`** with zero recent signers — should collapse/hide, not render "+0 and others".
- **`message-card`** has no empty (it's always given one message), but its *fields* can be empty:
  blank `name` (→ "Anonymous guest") and `null` `avatar` (→ initials) are its honest field-empty
  cases and must be covered.

## Liveness (request-response, NOT realtime)

There is **no** websocket, polling, SSE, or `setInterval` refresh in the mock. New messages from
*other* guests appear only on reload. The composer's optimistic insert is the **only** live update,
and it is the local author's own write. So:

- `message-wall` is **request-response**, seeded once from `resolve.ts`; it does **not** push.
  Honest-staleness note for its spec: the wall reflects load-time state plus the current author's
  optimistic additions — it will not show others' new entries until refetch/reload. Do not invent a
  realtime feed.
- The only timers in the source are cosmetic: boot fake-load `900ms`, demo loading `1400ms`, toast
  auto-dismiss `3200ms` + `260ms` fade — none are data liveness.
