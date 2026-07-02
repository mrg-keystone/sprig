# sprig bug & performance catalog — the detection playbook

The expertise that makes this an audit and not a guess. Each entry is the inverse
of a sprig "top gotcha": **browser symptom → code signal → the fix → how to
verify**. Use it as the checklist for the hunt passes and as the reference the
parallel-RCA agents trace against. Severities are defaults — adjust to impact.

sprig is a **Deno SSR framework** with Angular-flavored HTML templates and
selective island hydration — **not Fresh/Preact, Next, or Angular.** A component
is a **folder** (`template.html` + optional `logic.ts` + `styles.css`); a folder
with a `logic.ts` is an **island** (hydrates), one without ships **zero JS**. When
you cite a fix, point at the canonical pattern in the **`sprig:build`** skill's
`references/` (component-model · templates · routing · serving · isolate) so the
fixer isn't re-deriving runtime internals.

**Contents** · [Functional bugs](#functional-bugs) · [Backend bugs](#backend-bugs)
· [Performance](#performance) · [Accessibility](#accessibility)
· [Do NOT flag these](#false-positives--correct-patterns-do-not-flag)

---

## Functional bugs

| # | Browser symptom | Code signal / root cause | Fix (sprig ref) | Verify | Sev |
|---|---|---|---|---|---|
| F1 **Soft 404** | A missing resource shows a "not found" view but the response is `200` | The page's `resolve.ts` / service found nothing but never called `setResponseStatus(req, 404)` (and/or didn't capture `currentInjector()` synchronously at construction) | Capture `currentInjector()` at construction; `setResponseStatus(this.#req, 404)` on miss — `bootstrap.fetch` emits it (data-and-di) | `curl -i …/missing \| head -1` → `404` | High |
| F2 **Page 500s / blank** | Route 500s (controlled, no leak) or renders empty | A throw in `resolve`/`render`: most often **`inject()` called after an `await`** (the active injector is cleared across async — must be sync, before the first await), or an **unguarded `window`/`document`/`location` in `setup()`** during SSR | `inject()` synchronously, capture deps into locals/fields first; guard browser-only access with `typeof document !== "undefined"` and defer DOM effects to the client (data-and-di, islands) | route `200` + content; server log clean | Blocker |
| F3 **Dead island** | Markup is there; clicking/typing does nothing | The folder has **no `logic.ts`** so it's static and its `(event)` bindings never fire; **or** a non-serializable `@input` (a function/class instance) was passed and dropped on the wire; **or** an unguarded browser global threw during client `setup()` | Add a `logic.ts` (`defineComponent`) to make it an island; pass only serializable `@inputs` and emit events via `ctx.output` instead of callback props (component-model, islands) | interact → DOM reacts; console clean | Blocker |
| F4 **Click does nothing visible** | Island is live but the value never updates | State held in a **plain variable, not a `signal`** — sprig re-paints (morphs) only on a signal write | Hold mutable state in `signal()`, read it as `name()` in the template, write via `.set`/`.update` (islands, component-model) | interact → the bound value changes | High |
| F5 **State lost on navigation** | An island resets/loses state after a soft-nav | The island lives **inside** `<router-outlet>`, which soft-nav tears down and re-arms; or a value set on the server wasn't a serializable field, so it isn't snapshotted/re-seeded | Put state that must survive nav in an island **outside** the outlet (in the shell); set serializable fields in `onServerInit` (routing soft-nav, component-model) | navigate away + back → state preserved | Med |
| F6 **Persisted state lost in prod** | `StateService` restores in `dev` but not in the prod build | No `static key` on the subclass — class names are **minified in production**, so the default key isn't stable across builds | Set `static key = "…"` on the `StateService` (component-model → StateService) | `sprig build` → `sprig serve` → reload → state restored | High |
| F7 **Server write blocks / can't roll back** | A save spins before reacting; or on failure the UI keeps the optimistic value | The handler `await`s the server call **before** updating the UI, or has no rollback on `catch` | **Optimistic UI**: snapshot → mutate local state now → fire the call in the background → roll back + surface the error on failure (build → Optimistic UI). Exception: a `data-note` saying "wait/spinner" or "realtime island" wins | interact → instant UI; forced failure → reverts + error shown | High |
| F8 **No server-side validation** | Bad input is accepted when posted directly to `/api/*` (client checks bypassed) | Validation only in the island; the keep backend trusts the body. (sprig's `/api` gateway rejects *malformed* bodies as 4xx, but **business** validation is the app's job) | Validate in the keep endpoint/service; return an error the island surfaces inline (serving, data-and-di) | `curl` POST bad data to `/api/…` → rejected, no write | High |
| F9 **DI boundary throw** | 500 with *"DI does not cross the SSR/island boundary"* | Injecting a **server-scoped** token (e.g. `Backend`) from island/client code, or a scope mismatch | Server data reaches islands as serialized `@inputs`; from an island call `fetch("/api/…")`, never `inject(Backend)` (data-and-di scope) | island gets its data; no DI throw in the log | High |
| F10 **Route 404s unexpectedly** | A path (or the bare `/`) 404s, or a write verb 405s | `base` is set (`/ui`) so **off-base paths including `/` 404 by design**; or a `:param`/`load` mismatch in `defineRoutes`; SSR pages are **GET/HEAD only** (others → 405) | Link under `base`; fix the route table; don't POST to an SSR page — mutate via `/api/*` (routing) | the intended route renders; off-base 404 is expected | Med |
| F11 **Asset 404 / stale asset** | A `<base>/_assets/*` file 404s or serves stale | File not under `assetsDir` (`static/`), or a missing rebuild so the `?v=` cache-buster / `.sprig-manifest.json` didn't update | Put assets in `static/`; rebuild (`sprig build`) so the manifest `v` bumps (serving, hosting) | asset `200` with the immutable cache header; `?v=` changed after rebuild | Low |
| F12 **Hero invisible until scroll** | Above-the-fold content blank on load; blank forever with reduced-motion / for crawlers | `opacity:0` + `animation-timeline: view()` on above-the-fold elements | Author the *visible* state as default; load-time entrance above the fold; scroll reveals **below** only | hero visible at load and under `prefers-reduced-motion` | High |
| F13 **Unexpected 302 / redirect loop** | A page redirects when it should render; ping-pong 302s (browser `ERR_TOO_MANY_REDIRECTS`); or a controlled 500 before any render | A route **guard** returned a route ≠ the target: stale auth state, wrong segments (base baked in — `["ui","login"]` instead of app-relative `["login"]`), two guards bouncing to each other, or a throwing guard (fails closed as 500). Parent guards run for ALL children (inheritance is by design) | Return `ctx.path` to allow; return app-relative segments (the framework prefixes `base`); break mutual redirects; remember the chain runs parent-first before `resolve` (routing Guards) | an authorized session renders `200`; the deny path lands on its redirect target exactly once | Med |

## Backend bugs

Only if the app **fronts** a keep backend. Two channels: the in-process `Backend`
token (SSR, in `resolve.ts`/services, **bypasses auth**) and the token-gated
`/api/*` network handler (islands). These are invisible from the DOM; you find
them by checking the adapter's `live` flag, the network, and the server logs.

| # | Symptom | Root cause | Fix | Verify | Sev |
|---|---|---|---|---|---|
| B1 **Fake data shown as real** | Numbers look real but never change / don't match the store | A live-first service fell back to a fixture and `live:false` isn't surfaced — the gap is silent | Surface `live` in the UI; wire the real endpoint or label the placeholder | service returns `live:true`; backend call `ok` | Blocker |
| B2 **Everything empty** | Every list/stat is empty though the DB has data | `serve.ts` still wires the **no-op keep stub** `sprig init` scaffolds (returns `null`), or env not loaded → the in-process backend hit an empty default store | Swap the no-op keep for the real `api` in `serveSprig({ keep: api, … })`; pass `--env-file` / `--unstable-kv` on **dev and start** (hosting) | data appears; same in the prod build | Blocker |
| B3 **Crashes/empties only in prod** | Works in `sprig dev`, fails under `sprig serve` | `--unstable-kv`/`--env-file` missing on the start task; an `import.meta.url`-relative read resolving to a bundled path; missing `static key` | Pass the flags on `start`; avoid bundled-path reads; set `static key` (hosting, component-model) | `sprig build` → `sprig serve` → endpoint `200` + data | Blocker |
| B4 **Slow page (server)** | High document TTFB; first byte waits | `resolve.ts` does serial/`N+1` `Backend` fetches, or one slow endpoint blocks SSR render | Parallelize (`Promise.all`), batch, cache; defer non-critical to a client island `fetch("/api/…")` (data-and-di) | TTFB re-measured under threshold | High |
| B5 **Island `/api` call fails** | An island `fetch("/api/…")` returns 4xx | Missing/invalid token on the gated channel; wrong prefix; non-JSON body → **415**; body > 4 MiB or JSON deeper than 200 → **400** | Correct path/headers/token; send valid JSON within limits (hosting → `/api` gateway) | the island's `fetch` is `ok`; expected data returns | High |
| B6 **Fixture ≠ DTO drift** | A field renders `undefined`, or the screen breaks on real data | An isolate case shape diverged from the keep DTO (a field the DTO lacks, or a required DTO field the case omits) | Re-type the resolver off the generated DTO; reconcile loudly (isolate) | resolver types against the DTO; route renders on live data | High |

## Performance

Instrument and **measure** (recipes in `playwright-mcp-recipes.md`); a number with
a location is a finding, "feels slow" is not. Heuristic thresholds (report the
actual number regardless): long task **> 50 ms**, INP **> 200 ms** (poor > 500),
CLS **> 0.1**, dropped frames **> ~15 %** under interaction, SSR TTFB **> ~500 ms**
worth tracing.

| # | Measured symptom | Code signal | Fix | Verify | Sev |
|---|---|---|---|---|---|
| P1 **Animation drops frames** | dropped-frame % spikes while a thing animates | `@keyframes`/`transition` on **layout props** (`height`,`width`,`top`,`left`,`margin`,`padding`) → layout+paint each frame | Animate `transform` (`scaleY`/`translate`) or `grid-template-rows: 0fr→1fr` | re-measure dropped % during the same trigger | High |
| P2 **Broad repaint on state change** | jank on hover/toggle far from the changed element | `transition: all` — transitions props you never intended, incl. layout | List the intended properties only | re-measure | Med |
| P3 **Hover jank** | frame drops on hover | animated `box-shadow`/`filter` → repaint of the whole shadow region | Pre-render shadow on a pseudo-element, animate its `opacity` | re-measure hover | Med |
| P4 **Persistent-animation jank** | parallax/marquee stutters | no compositor hint → layer re-rasterizes | `will-change: transform` on the moving layer only | re-measure | Low |
| P5 **Long task on scroll** | `longtask`/`loaf` entries while scrolling | **forced synchronous layout** — layout reads (`offsetTop`,`getBoundingClientRect`,`getComputedStyle`) inside a scroll/`rAF`/resize handler in an island, worst in a per-element loop | Batch reads before writes; cache geometry; `IntersectionObserver` | long-task gone on re-scroll | High |
| P6 **Scroll stutter** | handler runs more often than frames paint | unthrottled scroll handler doing style writes | rAF-throttle, or CSS scroll-driven animation | re-measure | Med |
| P7 **Drifting/stuttery motion** | animation not frame-aligned | `setTimeout`/`setInterval`-driven animation | `requestAnimationFrame` or CSS animation | re-measure smoothness | Med |
| P8 **Layout shift** | CLS above threshold during load | `<img>`/media without `width`/`height`, late-injected banners, font swap | Set dimensions / reserve space; `font-display` | CLS re-measured below 0.1 | High |
| P9 **JS shipped for nothing** | a chunk loads + hydrates but there's no real interactivity | a **static** thing was given a `logic.ts` (so the folder ships an island chunk) it doesn't need | Remove the `logic.ts` → the folder becomes static, zero JS (islands) | island/chunk count drops; no hydration for it | Med |
| P10 **Heavy above-fold hydration** | high INP / long task right after load | a large island hydrating **`trigger: "load"`** above the fold blocks interaction | Use a lazier `trigger` (`idle`/`visible`/`interaction`); split the island; shrink the boundary (islands → triggers) | INP re-measured | Med |
| P11 **Listener/timer leak** | handlers/timers grow across navigations; INP degrades over a session | island adds a **manual** `addEventListener`/`setInterval` in `setup()` with no cleanup (soft-nav disposes `effect`s & delegated `(event)`s for you, not these) | Register reactive work via `effect` (auto-disposed) or remove the listener/timer on teardown (islands) | listener/timer count stable across nav | Med |
| P12 **Slow/oversized network** | big/uncompressed assets, missing `cache-control`, serial chains | unoptimized images, no caching headers, request B needlessly awaits A | Compress/resize; cache headers; parallelize | network re-check: sizes/headers/parallel | Med |

## Accessibility

From `browser_snapshot` (the a11y tree) and keyboard driving — correctness bugs,
not nice-to-haves: controls with no accessible name, images with no `alt`, a modal
that doesn't trap focus or restore it on close, a flow with no keyboard path, focus
order that doesn't follow reading order, color-only state. Fix with real
roles/labels/`alt`/focus management; verify the name appears in the snapshot and
the keyboard path works.

## False positives — correct patterns, do NOT flag

Credibility depends on not crying wolf. These are **right**, even though a naive
scan or a "looks interactive" glance might flag them. Verify they're actually the
good pattern, then leave them alone (or list them under "Checked and healthy"):

- **`transform`-based animation** (`scaleX`/`scaleY`/`translate`/`opacity`) — the
  *correct* alternative to P1, not a finding.
- **A pure CSS scroll-snap carousel** — classify **static**, not a dead island; it
  needs no `logic.ts`. "Looks interactive" ≠ "needs hydration."
- **A static folder with no `logic.ts` and no `(event)` bindings** — correct, not a
  dead island. F3 is only when an `(event)` is wired but no `logic.ts` exists.
- **A lazy `trigger`** (`idle`/`visible`/`interaction`) deferring hydration — not a
  dead island; the chunk loads on its trigger. Confirm hydration after the trigger
  fires before calling it dead.
- **Soft navigation swapping the `<router-outlet>`** (not a full reload), and an
  island **outside** the outlet staying mounted across nav — both correct (state
  preservation), not a bug or a leak.
- **Reactive work via `effect` / delegated `(event)` bindings** — auto-disposed on
  island teardown; not a leak (P11 is only *manual* `addEventListener`/`setInterval`
  with no cleanup).
- **Request-time data reads in `resolve.ts`** (reading the backend fresh each
  request) — the correct SSR pattern, not a bug.
- **`live:false` that the UI honestly surfaces** — a labeled placeholder is the
  correct gap-handling pattern, not B1. B1 is when the fakeness is *hidden*.

## Dev-loop hazard

`sprig dev` does HMR with **no Vite**: editing a `template.html`/`styles.css`
hot-swaps in place keeping island state; editing a `logic.ts` or server code
rebuilds + reloads. After **structural** changes (adding/removing an island or a
route), or any FIX edit, a long-lived dev server can still mislead — so **validate
against a freshly-restarted server**, and for a "production-ready" pass against the
prod path (`sprig build` → `sprig serve`), where minification/CSS-scoping/env bugs
surface.
