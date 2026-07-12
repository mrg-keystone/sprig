# Isolate workbench — feedback / bug reports

Findings from running the `ui/` isolate spec suite (sprig 0.20.29, `sprig isolate`) on
2026-07-11. Evidence-backed; each item was reproduced, not inferred. The app itself is
verified correct in all cases below — these are **tooling-layer** issues in the isolate
workbench / sprig hydration, surfaced while trying to get the suite green.

Suite outcome after working around these: **326 / 330** (`--workers=3 --retries=2`), the
remaining 3–4 are the items below.

---

## BUG 1 (main) — data-driven nested islands never hydrate in a composed preview

**Severity: high** — makes an entire class of component untestable in isolation (any
component that renders a nested island *from its case data*).

### Symptom
A spec that composes a nested island (e.g. `tokens-list` embedding `<chip-editor>` per
row, or `roles-card` embedding `<chip-editor>`) can never interact with the nested island:
it renders as an inert bare custom element with no content, so its `<summary>` / popover
never exists and the test times out.

Affected specs in this repo:
- `src/islands/tokens-list/isolate/cases/grant-popover/tests/popover.spec.ts`
- `src/islands/roles-card/isolate/cases/popover-open/tests/chip-add.spec.ts`

### Root cause (three facts that compose into the failure)

1. **The preview seeds a component's data *after* hydration**, as signals via the
   stage-bridge — not as server-rendered props. On `/components/app-detail/tokens-list/grant-popover`:
   - SSR HTML: the `tokens-list` island host carries `props = {"__mocks":{}}`, renders the
     **empty** state (`<span id="tok-count">0</span>`, `"No tokens minted."`), **0**
     `<chip-editor>`.
   - The 27 tokens (with grants) live in the sibling `stage-bridge` island's
     `caseData.signals.tokens`, applied to the target's signals post-hydration.
   - Measured after the bridge applies data: `tok-count → 27`, **54** `<chip-editor>` tags
     appear, but `sprig-island[data-sel="chip-editor"]` count = **0**,
     `data-sprig-hydrated` = **false** on all, `innerHTML.length = 0`, `<summary>` count = **0**.

2. **sprig hydrates islands exactly once, at bootstrap.** `framework/.sprig/compiler/hydrate.ts`
   scans `root.querySelectorAll("sprig-island")` a single time and arms an
   `IntersectionObserver` per island. There is **no `MutationObserver` / re-scan**, so an
   island that first appears *after* that scan is never hydrated.

3. **The renderer's client re-render assumes nested islands are already live.**
   `framework/.sprig/compiler/render.ts` (client mode) emits an empty `<sprig-island>`
   *shell* for a child island and relies on morph matching it to "the live hydrated child
   host" (its own comment). In the preview that host was never server-rendered (empty SSR),
   so nothing exists to match, and the child never becomes a hydrated island.

**Net:** the preview injects data too late for any data-driven nested island to hydrate.

### Why it is NOT an app bug
In production the data comes from `resolve.ts` at SSR time, so the nested `<chip-editor>`s
are in the initial HTML, present at the bootstrap scan, and hydrate normally — the feature
works. `chip-editor` also passes as its *own* direct isolate target
(`shared-components/chip-editor/…`). Only the **composed preview** can't host it.

### Suggested fixes (either fixes it)
- **Isolate side:** server-render the case's seeded signal values into the target island's
  SSR props, so a data-driven nested island exists in the initial HTML (present at the
  bootstrap scan). i.e. don't defer *all* case data to a post-hydration signal push.
- **Framework side:** hydrate late-appearing islands — a `MutationObserver` (or a re-scan
  after an island's re-render) that picks up `sprig-island[data-sel]:not([data-sprig-hydrated])`
  and hydrates them. This would also make client-fetched, dynamically-rendered nested
  islands work in a real app, not just previews.

### Repro
```
cd ui && PORT=8000 sprig isolate . --no-open
# then, IN A BROWSER (see BUG 2 re: 127.0.0.1):
#   open http://127.0.0.1:8000/components/app-detail/tokens-list/grant-popover
#   wait for #tok-count to become 27
#   observe: document.querySelectorAll('chip-editor').length === 54
#            document.querySelectorAll('sprig-island[data-sel="chip-editor"]').length === 0
#            document.querySelectorAll('summary').length === 0
```

---

## BUG 2 (running the suite) — `localhost` resolves to IPv6 `::1`, which 404s

**Severity: high for anyone running specs headlessly** — cost the most time to diagnose.

Chromium and Node/Deno `fetch` resolve `localhost` → **IPv6 `::1`** first; `curl` resolves
→ **IPv4 `127.0.0.1`**. In this environment the real `sprig isolate` server answered on
`127.0.0.1:8000` while `::1:8000` returned **404 for every request** (a stale/second
listener). Result: every browser + `fetch` request 404'd → no island hydrated → **every
spec failed**, while `curl` health checks returned 200 — which looked exactly like "the
workbench crashes / 404s the browser."

Proof (same instant, same URL):
```
curl  http://127.0.0.1:8000/…   → 200      curl  http://[::1]:8000/…   → 404
deno  fetch 127.0.0.1 …          → 200      deno  fetch [::1] …         → 404
```

**Fix / guidance:** point the runner and specs at `http://127.0.0.1:8000` (IPv4), never
`localhost`. Ideally `sprig isolate` should bind a single dual-stack listener (or print the
exact IPv4 URL) and the spec `BASE` / any generated `playwright.config` should default to
`127.0.0.1`, not `localhost`.

---

## BUG 3 (spec ergonomics) — `isolate-events` `capture()` / `waitHydrated()` have no producer under direct navigation

The `isolate-events` helpers (`capture()`, `waitHydrated()`) depend on the page setting
`globalThis.__isolateReady` and calling `window.__isolateEmit` — signals only wired when a
case runs **inside the workbench shell** via its runner (`POST /api/http/post-test-run`,
which is 401-gated / has no CLI `test` command in 0.20.29). Under plain
`playwright test` direct navigation, `waitHydrated()` polls `__isolateReady` (never set →
5 s timeout) and `capture().expect()` never resolves.

This is already known in-repo: `shared-components/toast-stack/isolate/cases/auto-dismiss/tests/push-and-dismiss.spec.ts`
documents it verbatim and uses a **local** pattern instead (poll the island's
`__sprigScope`, record real bubbling DOM events). But several specs (all of `tokens-list`)
still imported `isolate-events` and thus could never pass headlessly. They were migrated to
the local pattern in this pass.

**Suggested fix:** either make the runner reachable for headless `playwright test`, or ship
`waitHydrated`/`capture` implementations that work off the DOM (attribute + bubbling events)
so they don't require the shell's postMessage bridge.

---

## Minor — preview layout / bundling artifacts (not blocking, worth noting)

- **`track-panel` skeleton renders 0-width.** In isolation the panel body is
  `display:contents` with no app container, so the loading skeleton has `height:136`,
  `visibility:visible`, `opacity:1` but **`width:0`** → Playwright `toBeVisible()` treats
  it as hidden. Worked around by asserting `toBeAttached()` + `aria-busy`. A preview wrapper
  that gives components a sane container width would avoid this.
- **`attached-vars` E6 — cancel triggers an attach (not fully root-caused).** In the
  `detach-confirm` preview, clicking the confirm-dialog `#cf-cancel` fires `onAttach`
  (a real `/envs/attach` call + "Attached NPM_REGISTRY" toast) with **no form-submit
  event**. It appears tied to the isolate bundler copying the shared `<confirm-dialog>` TAG
  *inside* `attached-vars` (so the cancel routes through attached-vars' own island-host
  event delegation) — in the real app `confirm-dialog` is a separate top-level island, so
  the interaction can't occur. Flagged for a closer look; likely a preview-bundling
  artifact rather than an app bug.

---

## Environment notes (this sandbox)
- Linux **aarch64** — the Playwright **`chrome` channel is not built for ARM64**
  (`playwright install chrome` → "not supported on Linux Arm64"), so the Playwright MCP
  can't launch; use the JSR-provisioned **chromium** instead.
- `~/.sprig` (the sprig install) was being wiped between sessions — re-run
  `deno run -A jsr:@mrg-keystone/sprig@0.20.29/cli install` to restore `sprig`.
- The isolate workbench **crashed under a cold full-suite run** (330 cases × 3 workers
  building chunks on demand → `ERR_CONNECTION_REFUSED`); warming case pages first + modest
  worker counts avoids it.

---

## Resolution (2026-07-11, applied in-repo — every claim re-verified against source first)

**BUG 1 — FIXED, framework side (the suggested `MutationObserver`/re-scan option, plus a
render-side gap the report's measurements exposed).** Root cause confirmed with one addition:
the client re-render didn't merely fail to *hydrate* late islands — it couldn't even emit the
shell, because `componentsForPage` (hydrate.ts) only resolved islands whose chunk had already
LOADED; an unloaded `chip-editor` fell through to native rendering (hence the measured 54 bare
tags / 0 hosts). Three changes:
- `build.ts`: the generated eager loader now registers EVERY island selector→scope
  (`registerIslandSelectors`), so the client knows a tag is an island before its chunk loads.
- `render.ts`: the client child-island shell now carries the parent-computed inputs (+ mocks)
  as its props bridge — discarded for a live host (morph pins it), the hydration seed for a
  genuinely-new child.
- `hydrate.ts`: `rescanIslands(el)` after every island effect render arms+lazy-loads hosts
  that appeared post-bootstrap (idempotent; armed/hydrated hosts skipped).
  Tests: `compiler/zz-nested-island-late.test.ts` (3 tests); full compiler suite 175/175.
  Known remaining limitation (pre-existing, unchanged): morph PINS live child hosts, so a
  data-driven REMOVAL leaves the stale child in the DOM.

**BUG 2 — FIXED.** `deno serve` binds 0.0.0.0 (IPv4-only) while the printed/targeted URLs
said `localhost`. `isolate dev` now prints/opens `http://127.0.0.1:<port>/`, `isolate test`'s
spawned-server baseURL (→ `ISOLATE_BASE_URL`) is `127.0.0.1`, and every spec-template doc
(`sprig:build`/`sprig:breakdown` refs, builder agent def, eval-app fixtures) now teaches the
`127.0.0.1` fallback.

**BUG 3 — FIXED (deeper than reported: the `__isolateReady`/`__isolateEmit` contract had NO
producer anywhere — not even inside the shell).** The stage-bridge (`preview-harness.ts`) is
now the producer: it stamps `__isolateReady` (false at case setup → true once the target
island's scope is attached AND the case `_signals` are applied; statics ready at SSR) and
feeds stage events to the `capture()` binding under direct navigation; the workbench shell
mirrors both signals onto the main frame when the case runs in its iframe (exactly one
producer per context). Verified end-to-end: new regression spec
`fixtures/sprig-app/.../three/tests/headless-events.spec.ts` (waitHydrated + capture) passes
2/2 under `isolate test` with real chromium. Skill refs updated — `isolate-events` is now the
RECOMMENDED hydration gate (it also waits for signal seeding, which the bare
`data-sprig-hydrated` marker does not).

**Minor items — parked with analysis.** `track-panel` 0-width: `.iso-stage-page` is
`display:grid; place-items:center` → content-sized track, so a `display:contents` root with a
%-width skeleton collapses; not changed because any default-width change shifts every
consumer's screenshot-diff baseline — candidates: an opt-in per-case stage width in
`fixture.json`. `attached-vars` E6: needs the downstream repro to root-cause (plausibly the
copied `confirm-dialog` becoming a preview island inside the target's delegation root);
untouched here.

Not addressed (out of this repo / pre-existing): the cold full-suite crash (workbench chunk
builds under load), and the legacy `fixtures/sprig-app` specs (18/20 red before AND after —
relative `page.goto` with no baseURL + selectors from the pre-sprig workbench UI).

## Follow-up pass (2026-07-11, same day): the parked pre-existing reds — all fixed

- **Workbench API 401** (also the reason BUG 3 called post-test-run "401-gated"): keep's
  fail-closed default left the four workbench routes (get-discovery/get-manifest/
  post-test-run/get-runner-status) reachable only via the `*` grant. All four are now
  `@Public()` (a local dev tool's browser UI calls them directly). `app/spine.test.ts` 4/4;
  route-audit reports "every controller route is @Public or explicitly gated".
- **`--json` stdout boot-log leak** (plan.md B1): fixed via a first-import console guard
  (`cli/lib/json-stdout.ts`); `isolate test --json | python3 -m json.tool` round-trips.
- **Legacy fixtures/sprig-app specs**: all migrated to the current dialect
  (ISOLATE_BASE_URL, waitHydrated/capture, current shell markup; shell-behavior specs
  drive `/#<route>` + frameLocator). **Full suite 21/21 green.** Getting there surfaced
  and fixed TWO real product bugs the specs were the first to exercise:
  1. **Poisoned dev AST for a page/island basename pair** — `astFor(<bare selector>)`
     returned the FIRST-registered def, so with `pages/workbench` + its
     `components/workbench` island (walk-order dependent, hits this Linux env), the dev
     AST endpoint served the PAGE template to the island chunk: the island renders
     ITSELF → with the new re-scan, 400+ self-nested hosts + "Maximum call stack size
     exceeded"; on published 0.20.x, a silently DEAD workbench UI post-hydration
     (verified live on the :8000 instance). Fix: `findIslandBySelector` — an island
     chunk's fetchAst always gets the island def (`ast-island-selector.test.ts`).
  2. **daisyUI class collisions in the workbench shell** — buildCss feeds every app
     through `@plugin "daisyui"`, which emits UNSCOPED component CSS for any class name
     found in the sources; the shell's own `dock`/`badge`/`kbd`/`toast` collided
     (daisyUI's `.dock` = fixed bottom-nav with `place-items`-style centering →
     the dock rendered as a 110px centered column, proven identical with JS disabled =
     pure CSS, pre-existing). Fix: shell chrome classes renamed `wb-dock`/`wb-badge`/
     `wb-kbd`/`wb-toast` (compound names like `dock-tab` don't collide and are unchanged).

NB for release: the checked-in `app/static` prebuilt workbench bundle is now STALE w.r.t.
these src fixes — the next release build must regenerate it. Also `ensureRunner`'s npm
install left `.bin/playwright` missing on this machine; provisioned manually
(`npm i @playwright/test` + `playwright install chromium` in `~/.isolate-runner`).
