# Fresh 2 bug & performance catalog — the detection playbook

The expertise that makes this an audit and not a guess. Each entry is the inverse
of a build "top gotcha": **browser symptom → code signal → the fix → how to
verify**. Use it as the checklist for passes 2–3 and as the reference the
parallel-RCA agents trace against. Severities are defaults — adjust to impact.

When you cite a fix, point at the canonical pattern in the **build** skill's
`references/` (named per row) so the fixer isn't re-deriving Fresh internals.

**Contents** · [Functional bugs](#functional-bugs) · [Backend bugs](#backend-bugs)
· [Performance](#performance) · [Accessibility](#accessibility)
· [Do NOT flag these](#false-positives--correct-patterns-do-not-flag)

---

## Functional bugs

| # | Browser symptom | Code signal / root cause | Fix (build ref) | Verify | Sev |
|---|---|---|---|---|---|
| F1 **Soft 404** | "Not found" page but the response is `200` | Handler renders a not-found *branch* (`page({notFound})`) instead of throwing; or a leftover Fresh-1 `_404.tsx`; status never set | `throw new HttpError(404)` → `routes/_error.tsx` (`advanced/error-handling.md`) | `curl -i …/missing` → `404` | High |
| F2 **Blank page** | Route renders nothing / empty body | `GET` returns a value **without** `page()` or a `Response` — silent no-render | Wrap data in `page({...})` or return `Response` (`concepts/data-fetching.md`) | route shows content; SSR HTML non-empty | High |
| F3 **500 on render** | Page 500s; console/server: *Non-JSX element passed to `ctx.render()`* | `ctx.render(data)` (Fresh-1 habit) — `ctx.render` takes JSX, not data | `return page({ data })` (`advanced/define.md`) | route `200` + content | Blocker |
| F4 **Dead island** | Markup is there; click/type does nothing | A **function** passed as an island prop (serialization drops it); or a `fresh-island::Name` specifier (island file added while `dev` ran → registry drift kills *all* hydration on the page); or a client throw | Move the handler *inside* the island / emit an event prop; **restart `deno task dev`** after adding an island (`concepts/islands.md`, `advanced/serialization.md`, `playwright-and-dev-loop.md`) | interact → DOM reacts; `0` `fresh-island:` specifiers; clean console | Blocker |
| F5 **Hydration mismatch** | Console: *Expected server HTML to contain…*; flicker or island state resets on load | Non-deterministic render (`Date.now()`, `Math.random()`, reading `window`/`localStorage` during SSR) → server HTML ≠ client | Make render deterministic; defer client-only reads to post-hydrate (`concepts/islands.md`, `advanced/serialization.md`) | no hydration warning in console | High |
| F6 **Form resubmits** | Valid submit re-renders the form (`200`); reload double-submits | POST handler returns a render instead of a **303** redirect (no Post/Redirect/Get) | `return` a `303` with `location` after success (`advanced/forms.md`) | submit → `waitForURL`; POST status `303` | High |
| F7 **No server validation** | Bad input accepted when posted directly (client JS bypassed) | Validation only in the island; handler trusts `formData` | Validate in the handler; re-render with inline error + `422` (`advanced/forms.md`) | `curl` POST bad data → `422`, no write | High |
| F8 **Missing CSRF** | Cross-site POST succeeds | No CSRF middleware on mutating routes | Add the csrf plugin (`plugins/csrf.md`) | POST without token rejected | Med (prod) |
| F9 **Broken subtree** | Every route under a folder is blank / loses `ctx.state` | A `_middleware.ts` forgot `await ctx.next()` (or set state on a module var, not `ctx.state`) | `await ctx.next()`; store per-request data on `ctx.state` (`concepts/middleware.md`) | subtree routes render with state | High |
| F10 **Route shadowing / asset 404** | A specific route hits the wrong handler; `static/` files 404 | `App` builder order: dynamic route registered before the static one, or `staticFiles()`/middleware registered **after** `.fsRoutes()` | Register specific-before-dynamic, middleware before routes (`concepts/middleware.md`, `concepts/file-routing.md`) | featured route correct; asset `200` | High |
| F11 **Island reads `undefined` env** | A `FRESH_PUBLIC_*` value is `undefined` client-side; or a secret appears in the JS bundle | Non-literal `Deno.env.get(x)` (Vite can't inline it), missing `FRESH_PUBLIC_` prefix, or a secret behind that prefix | Literal `Deno.env.get("FRESH_PUBLIC_FOO")`; never prefix secrets (`advanced/environment-variables.md`) | island gets value; bundle grep finds no secret | High |
| F12 **Hero invisible until scroll** | Above-the-fold content blank on load; blank forever with reduced-motion / for crawlers | `opacity:0` + `animation-timeline: view()` on above-the-fold elements | Author the *visible* state as default; load-time entrance above the fold; scroll reveals **below** only | hero visible at load and under `prefers-reduced-motion` | High |
| F13 **Wrong/blank `<title>`** | Tab title is the app default on every page, or duplicated | Page doesn't set `<Head>` (last render wins, so it inherits `_app.tsx`) | Per-page `<Head>` from `fresh/runtime` (`advanced/head.md`) | each route's `<title>` is correct | Low |

## Backend bugs

Only if the app **fronts** a rune/keep backend in-process — read build's
`references/rune-backend.md`. These are invisible from the DOM; you find them by
checking the adapter's `live` flag, the network, and the server logs.

| # | Symptom | Root cause | Fix | Verify | Sev |
|---|---|---|---|---|---|
| B1 **Fake data shown as real** | Numbers look real but never change / don't match the store | A live-first adapter fell back to the fixture and `live:false` isn't surfaced — the gap is silent | Surface `live` in the UI; wire the real endpoint or label the placeholder (`rune-backend.md`) | adapter returns `live:true`; backend call `ok` | Blocker |
| B2 **Everything empty** | Every list/stat is empty though the DB has data | env not loaded → in-process backend picked the **empty default store** (the "DB is broken" red herring) | `--env-file=…` on **dev and start** tasks (`rune-backend.md`, `advanced/environment-variables.md`) | data appears; same in the prod build | Blocker |
| B3 **Crashes only in prod build** | Works in `dev`, 500s under `deno serve` | `import.meta.url`-relative file read resolves to the bundled path; or `Deno.openKv` without `--unstable-kv` after an env fallback | env via `--env-file`; avoid `import.meta.url` reads in bundled paths (`rune-backend.md`) | `deno task build` → `deno serve` → endpoint `200` | Blocker |
| B4 **Slow page (server)** | High document TTFB; page waits before first byte | SSR loader does serial/`N+1` backend `fetch`es, or one slow endpoint blocks render | Parallelize (`Promise.all`), batch, cache; defer non-critical (`concepts/data-fetching.md`) | TTFB re-measured under threshold | High |
| B5 **Fixture ≠ DTO drift** | A field renders `undefined`, or the screen breaks on real data | The isolate fixture shape diverged from the rune DTO (field the DTO lacks, or required DTO field the fixture omits) | Re-type the loader off the generated DTO; reconcile loudly (`rune-backend.md`) | loader types against the DTO; route renders on live data | High |

## Performance

Instrument and **measure** (recipes in `playwright-mcp-recipes.md`); a number with
a location is a finding, "feels slow" is not. Heuristic thresholds (report the
actual number regardless): long task **> 50 ms**, INP **> 200 ms** (poor > 500),
CLS **> 0.1**, dropped frames **> ~15 %** under interaction, SSR TTFB **> ~500 ms**
worth tracing.

| # | Measured symptom | Code signal | Fix (build ref) | Verify | Sev |
|---|---|---|---|---|---|
| P1 **Animation drops frames** | dropped-frame % spikes while a thing animates | `@keyframes`/`transition` on **layout props** (`height`,`width`,`top`,`left`,`margin`,`padding`) → layout+paint each frame | Animate `transform` (`scaleY`/`translate`) or `grid-template-rows: 0fr→1fr` | re-measure dropped % during the same trigger | High |
| P2 **Broad repaint on state change** | jank on hover/toggle far from the changed element | `transition: all` — transitions props you never intended, incl. layout | List the intended properties only | re-measure | Med |
| P3 **Hover jank** | frame drops on hover | animated `box-shadow`/`filter` → repaint of the whole shadow region | Pre-render shadow on a pseudo-element, animate its `opacity` | re-measure hover | Med |
| P4 **Persistent-animation jank** | parallax/marquee stutters | no compositor hint → layer re-rasterizes | `will-change: transform` on the moving layer only | re-measure | Low |
| P5 **Long task on scroll** | `longtask`/`loaf` entries while scrolling | **forced synchronous layout** — layout reads (`offsetTop`,`getBoundingClientRect`,`getComputedStyle`) inside a scroll/`rAF`/resize handler, worst in a per-element loop | Batch reads before writes; cache geometry; `IntersectionObserver` | long-task gone on re-scroll | High |
| P6 **Scroll stutter** | handler runs more often than frames paint | unthrottled scroll handler doing style writes | rAF-throttle, or CSS scroll-driven animation | re-measure | Med |
| P7 **Drifting/stuttery motion** | animation not frame-aligned | `setTimeout`/`setInterval`-driven animation | `requestAnimationFrame` or CSS animation | re-measure smoothness | Med |
| P8 **Layout shift** | CLS above threshold during load | `<img>`/media without `width`/`height`, late-injected banners, font swap | Set dimensions / reserve space; `font-display` (`advanced/head.md`) | CLS re-measured below 0.1 | High |
| P9 **JS shipped for nothing** | island hydrates but has no interactivity | a static thing placed in `islands/` (or with a client handler it doesn't need) | Move to `components/` (server-only, zero JS) (`concepts/islands.md`) | island count drops; no hydration for it | Med |
| P10 **Heavy above-fold hydration** | high INP / long task right after load | a large island hydrating above the fold blocks interaction | Split it; defer/lazy below-fold islands; shrink the hydration boundary | INP re-measured | Med |
| P11 **Listener/timer leak** | handlers/listeners grow across navigations; INP degrades over a session | island adds `addEventListener`/`setInterval` with no cleanup | Clean up on unmount (effect return) (`concepts/islands.md`) | listener count stable across nav | Med |
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
  needs no JS. "Looks interactive" ≠ "needs hydration."
- **Listeners with proper effect cleanup** — not a leak (P11) if they're removed on
  unmount.
- **Request-time data reads** (`Deno.readTextFile(new URL(...))`) — the *fix* for
  dev staleness, not a bug. (Static JSON `import … with {type:"json"}` going stale
  is a **dev-loop** artifact, not a production bug — note it as low/dev-only at
  most, and only if it actually misled the audit.)
- **`live:false` that the UI honestly surfaces** — a labeled placeholder is the
  correct gap-handling pattern, not B1. B1 is when the fakeness is *hidden*.
- **A full reload on every save** is not a *perf* bug — but the `always-full-reload`
  dev plugin that causes it **is** a real HMR hazard worth flagging: on **Safari** it
  renders the island you just edited **stale** (a full reload re-imports the
  `fresh-island::*` modules, which Safari serves from its module cache ignoring
  `no-store`; a new tab shows it fresh). Recommend standard Fresh HMR instead — see the
  dev-loop note in the build skill.
