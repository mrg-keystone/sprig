## 7. Soft navigation (hydrate.ts:500-727)

Requires the Navigation API (`globalThis.navigation`); otherwise normal browser nav.
`pagehide → persistState()` always registered.

**Lifecycle:**

1. **`navigate` event fires.** `softNavShouldSkip` runs first.
2. **Skip checks.** Any skip condition (table below) → the listener returns without
   calling `e.intercept()`; the browser handles the navigation natively (full nav).
3. **Intercept** — the boundary. `e.intercept()` claims the navigation; everything past
   this point is committed to the soft-nav path. `persistState()` runs; with `cfg.perf`
   present, the nav-start beacon fires here.
4. **Fetch** the destination. At each checkpoint from here on (right after fetch
   resolves, after a fetch failure, and after the response body is read), if a
   superseding `navigate` event has already aborted this one's `e.signal`, this
   navigation yields immediately: no assign, no swap (the aborted leg, below).
5. **Commit checks.** Any commit-fail condition (table below) →
   `location.assign(original destination)`, a full-nav fallback — no second beacon.
6. **Swap.** Pair current + fetched outlet chains, diff `data-level`, swap the
   shallowest differing position.
7. **Beacons.** A committed swap fires the committed-swap beacon.

Because the intercept boundary at step 3 separates "never touched the soft-nav path"
from "touched it but fell back," the skip and commit-fail legs below don't need a
uniform Response column — skip always means the browser handles it; commit-fail always
means `location.assign(original destination)`. A third outcome, aborted, is neither: see
below.

**Skip** — never reaches step 3 (`e.intercept()` is never called):

| Leg | Condition | Example |
| --- | --- | --- |
| skip | not interceptable | Navigation API itself marks it non-interceptable (e.g. a modifier-clicked link) |
| skip | hash-only | `/blog/post-a` → `/blog/post-a#comments` |
| skip | download | a link with a `download` attribute |
| skip | form POST | a `<form method="post">` submit |
| skip | reload | same URL, navigation type `reload` |
| skip | URL parse failure | destination fails `new URL()` |
| skip | cross-origin | destination origin ≠ current origin |
| skip | out-of-base | destination path outside the app's configured `base` |
| skip | reserved prefix | destination under `cfg.reserved` |
| skip | same-path query-only | `/search?q=a` → `/search?q=b` |

`cfg.reserved` is the same reserved set the server skips — spec 04
[§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
item 4 is the single source of truth. It's only populated for a non-root `base`; at
root `base` it's absent (empty list), so `/api`/`/docs`/`/_assets` are NOT skipped
there — they intercept, fetch, and fall through to the non-HTML commit-fail leg below.

**Commit-fail** — passed step 3 (intercepted, fetched) but fails a commit check;
falls back to `location.assign(original destination)`:

| Leg | Condition | Example |
| --- | --- | --- |
| commit-fail | non-ok | a 404/500 SSR error page — `text/html` but `!ok` (`softNavResponseOk`, hydrate.ts:563-567) |
| commit-fail | redirected | a guard's 302 is followed transparently by fetch and lands here — there is NO client-side guard wiring |
| commit-fail | non-HTML content-type | response `content-type` isn't `text/html` |
| commit-fail | transport failure | fetch throws (network drop) |
| commit-fail | empty outlet chain | either the current or fetched document has no `<sprig-outlet>` (hydrate.ts:621-624) |

Every commit-fail leg takes the SAME path — the full-nav fallback so URL/history/
lifecycle stay correct (hydrate.ts:596-608); a commit-fail never swap-anyway,
never silently drops the navigation — with one exception, the aborted leg below,
where dropping it silently is correct because a newer navigation already took over.

**Aborted** — a THIRD outcome (`SoftNavOutcome` = `"swapped" | "fallback" | "aborted"`,
hydrate.ts:587), distinct from both skip and commit-fail: a superseding `navigate`
event fires while this one is still in flight and aborts its `e.signal`
(`e.signal?.aborted`, checked at hydrate.ts:595/604/608/610 — right after fetch
resolves, on a fetch failure, and after the response body is read). An aborted leg
calls neither `deps.assign` nor the swap — it yields outright, because the newer
navigation runs this same flow itself and will reach its own commit-fail-or-swap
outcome. It always occurs after the intercept boundary (step 3), so its nav-start
beacon has already fired; see Perf beacons below.
- **Swap:** DOMParser the fetched page, then:
  1. Pair current + fetched `<sprig-outlet>` chains positionally, outer→inner (spec 01
     [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md)'s `MatchedLevel[]`
     chain). Each outlet's `data-level` value IS the matched level's `load` string
     (`MatchedLevel.load`, spec 04
     [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
     item 3) — a per-position content identifier, not an integer depth index.
  2. At each non-leaf position, swap iff its `data-level` value changed OR the two
     chains diverge in LENGTH at this position (one page has a layout level the other
     doesn't) — comparing `data-level` directly catches both: same-depth outlets
     showing different `load`s (e.g. same layout, different leaf page), and one chain
     ending where the other continues.
  3. The leaf (innermost) position always counts as differing, regardless of `load`
     equality — `load` never encodes route `:param`s, so a `:param`-only navigation
     changes page content without changing `load`, and the leaf is the one position
     comparing `data-level` alone can't catch that on; it must always refresh.
  4. Swap at the shallowest position that qualifies under 2 or 3. Every position outer
     of it preserves its DOM and island state.
  5. Before swapping, thread the fetched document's matched page into the live
     `cfg.page` (`pageOf`/`pageFromConfig`), so islands hydrated into the swapped
     subtree resolve their children against the NEW page's registry (registryForPage
     parity — spec 04 [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)'s `page` row).
  6. At that position: `teardown(cur)` → innerHTML replace → re-stamp the swapped
     outlet's own `data-level` from `next` (the innerHTML replace copies `next`'s
     INNER content but not `next`'s own `data-level` attribute — without this
     re-stamp, `cur`'s `data-level` goes stale and the NEXT soft-nav diff mis-compares
     this position) → `bootstrap(cur)` (re-arm islands) → scroll (traverse lets the
     browser restore; else fragment; else top). Wrapped in `startViewTransition` when
     available.

  `<head>` — including `<title>` — lives outside any `<sprig-outlet>`, so no step above
  touches it: a soft nav does NOT sync `document.title` (or any other `<head>` metadata —
  meta tags, links, etc.) from the fetched document. The whole `<head>`, tab title
  included, stays whatever the ORIGINAL page rendered.
- **State:** islands OUTSIDE the swapped outlet stay mounted (state preserved) — those
  DOM nodes are identity-stable (`===`) across the swap and keep their
  `data-sprig-hydrated="1"` marker untouched. At/below the swap point every node is
  REPLACED (innerHTML replace, not an in-place mutation) and re-armed from scratch,
  carrying fresh `data-sprig-hydrated`/`data-sprig-armed` markers (spec 04
  [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
  naming conventions). A commit-fail leg never reaches a swap at all — `location.assign`
  produces an ordinary full document load (a fresh navigation, not a DOM mutation). An
  aborted leg likewise never reaches a swap or an assign — it yields outright to the
  superseding navigation. `persistState()` runs before navigating away.
- **Perf beacons:** with `cfg.perf` present, beacon count per leg — mechanism
  (`sendBeacon`/`navId`/`keepalive` fallback) is spec 04
  [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
  item 4:
  - skip → 0 (never intercepted, step 3 never runs).
  - commit-fail → 1 (nav-start only, already sent at intercept; committed-swap
    never sends since the swap never commits).
  - aborted → 1 (nav-start only, same as commit-fail — it always happens after the
    intercept boundary; committed-swap never sends since it yields instead of swapping).
  - swap → 2 (nav-start at intercept, committed-swap once the swap commits).

  The commit-fail leg's single beacon is never double-counted against the ensuing
  full-nav reload's own head-snippet nav-start/load pair — the collector dedups by
  `navId`, not because the commit-fail leg itself reports zero.

**Example traces** (route shapes per spec 01 [§3](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md); `data-level` values are the matched levels' `load` strings, outer→inner):

- **(a) Param-only leaf change**, `/blog/post-a` → `/blog/post-b` — a `:slug` route
  matches both, so both chains carry the SAME `load`s: current
  `["routers/blog", "pages/blog/post"]`, fetched `["routers/blog", "pages/blog/post"]`.
  Position 1 (`routers/blog`) is unchanged → preserved: its islands (e.g. a blog-nav
  sidebar) stay mounted, state intact. Position 2 is the leaf — always treated as
  differing regardless of `load` equality (`load` never encodes `:slug`) — so it's the
  shallowest differing position and swaps: `teardown` the old leaf outlet → innerHTML
  replace → `bootstrap` re-arms only that outlet's islands. Scroll: not a traverse, no
  fragment → top.
- **(b) Same layout, different leaf load**, `/pricing` → `/about` — current
  `["routers/app", "pages/pricing"]`, fetched `["routers/app", "pages/about"]`. Position 1
  (`routers/app`) equal → preserved (shell islands stay mounted). Position 2's
  `data-level` itself changed (`pages/pricing` → `pages/about`) — same swap shape as (a),
  but here it's an actual `load` change driving it, not the always-differing leaf rule.
  Teardown/bootstrap/scroll identical to (a).
- **(c) Length divergence**, `/dashboard` → `/admin/users` — current chain has 2
  positions, `["routers/app", "pages/dashboard"]` (dashboard is a leaf, no nested
  layout); fetched has 3, `["routers/app", "routers/admin", "pages/admin/users"]`
  (admin is its own layout). Position 1 (`routers/app`) equal → preserved. Position 2 is
  where the chains diverge in LENGTH — current ends there, fetched continues into
  `routers/admin` — so position 2 is the shallowest differing position. Swap there:
  `teardown(cur)` on the old leaf outlet → innerHTML replace with the fetched subtree
  from position 2 down (the `routers/admin` outlet and its own `pages/admin/users` leaf
  arrive together in that one replacement) → `bootstrap(cur)` re-arms every island in
  the new subtree, including the admin layout's own. Position 1's shell islands stay
  mounted. Scroll: top.

