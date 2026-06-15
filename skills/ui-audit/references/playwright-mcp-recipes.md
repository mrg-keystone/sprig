# Playwright MCP recipes — driving the live app to find bugs & perf issues

Copy-adaptable call sequences for the discovery passes. The Playwright **MCP** is
one shared browser session — you are its only driver until the parallel-RCA pass.
`browser_evaluate` (run a function in the page, get JSON back) is the workhorse for
everything the dedicated tools don't cover.

**Contents**
- [Tool map](#tool-map) · [Booting & sizing](#booting--sizing)
- [Console & network health](#console--network-health)
- [Status codes — the soft-404 trap](#status-codes--the-soft-404-trap)
- [Island hydration check](#island-hydration-check)
- [Forms & redirects](#forms--redirects)
- [Performance: long tasks, CLS, INP](#performance-instrumentation)
- [Jank under interaction](#jank-under-interaction)
- [Animation specs & layout-thrash hunt](#animation-specs)
- [Network waterfall](#network-waterfall)
- [Breakpoints](#breakpoints)

## Tool map

| Need | MCP tool |
|---|---|
| Go to a URL | `browser_navigate` |
| Structural map (a11y tree — your DOM census) | `browser_snapshot` |
| Pixel evidence | `browser_take_screenshot` |
| Click / type / hover / key | `browser_click` · `browser_type` · `browser_hover` · `browser_press_key` |
| Fill a whole form | `browser_fill_form` |
| Drag (jank trigger) | `browser_drag` / `browser_drop` |
| Run JS in the page, get JSON back | `browser_evaluate` |
| Arbitrary Playwright (clock, routing) — if enabled | `browser_run_code_unsafe` |
| Console log since load | `browser_console_messages` |
| All network requests + statuses | `browser_network_requests` |
| Wait for text/selector/time | `browser_wait_for` |
| Resize to a breakpoint | `browser_resize` |

`browser_snapshot` (the accessibility tree) is both your structural census **and**
an a11y finding source — missing names/roles/labels show up here. Prefer it over a
screenshot when you need *refs* to click.

## Booting & sizing

Start the server fresh in the shell (`deno task dev` on a known port, or the prod
build — see SKILL pass 0), then:

1. `browser_resize` to a desktop viewport (e.g. 1280×800) so the first sweep is
   consistent.
2. `browser_navigate` to the app root.
3. Immediately drain console + network (below). The first paint is where boot
   errors, 500s, and asset 404s surface.

## Console & network health

After **every** navigation and interaction, drain both — these are free findings:

- `browser_console_messages` → triage by level. `error` is a finding. Watch
  specifically for Preact **hydration mismatch** warnings (`Expected server HTML
  to contain…`) — they mean SSR output ≠ client render, the classic source of
  content that flickers on load or an island that resets on hydrate.
- `browser_network_requests` → any `4xx`/`5xx` is a finding (failed API call,
  404'd asset, soft-error). Note the document request's own status for the
  status-code check below.

## Status codes — the soft-404 trap

**The MCP `browser_navigate` does not cleanly hand you the HTTP status**, and the
DOM can't tell a real 404 from a 200 that *looks* like one. Two reliable probes:

1. **From the shell (best for the verify step too):**
   `curl -i http://localhost:8000/blog/does-not-exist | head -1` → expect
   `HTTP/1.1 404`. A 200 here on a "not found" page is a soft 404.
2. **In-page, no extra navigation cost:** after navigating, read the document
   request's status from the network log, or probe directly:

   ```js
   // browser_evaluate
   async () => {
     const r = await fetch(location.pathname, { redirect: "manual" });
     return { status: r.status, type: r.type, redirected: r.redirected };
   }
   ```

Check this for every "error/empty" state a story implies (unknown id, gated
route). Auth bounces are the redirect version: expect a `302`/`303` to `/login`,
not a 200 render of the protected page.

## Island hydration check

The bug is *renders but doesn't react*. Never assert on visibility — assert that
**interacting changes the DOM**:

1. `browser_snapshot` to get the island's element ref.
2. Read a value (label/aria/state), e.g. `browser_evaluate`
   `() => document.querySelector("#count")?.textContent`.
3. `browser_click` (or type) the control.
4. Re-read. **No change = dead island.** Then check the console (a thrown error?)
   and the page source for the cause class (function prop passed to the island,
   `fresh-island::Name` specifier, a serialization error). Confirm hydration even
   ran:

   ```js
   // browser_evaluate — is anything hydrated at all?
   () => ({
     islands: document.querySelectorAll("[data-fresh-island], fresh-island").length,
     // a bare "fresh-island::" specifier in the client entry = island-registry drift
     badSpecifier: !!document.querySelector('script[src*="fresh-island:"]'),
   })
   ```

## Forms & redirects

Drive the real submit; assert the **redirect**, not the re-render:

1. `browser_fill_form` (or per-field `browser_type`) with valid input.
2. `browser_click` submit.
3. `browser_wait_for` the destination URL/marker. A form that lands back on itself
   with `200` (no `303`) resubmits on reload — a finding. Confirm the status with a
   `curl` repro of the POST if needed.
4. Re-run with **invalid** input → expect to stay with an inline error (and ideally
   a `422`), not a silent accept. Missing server-side validation is a finding even
   if client validation hides it.

## Performance instrumentation

Install observers via `browser_evaluate` **before** triggering, then read them
after. One combined installer:

```js
// browser_evaluate — install once after navigation
() => {
  const S = (window.__audit = { longtasks: [], loaf: [], cls: 0, lcp: 0, inp: 0 });
  const obs = (type, cb) => { try { new PerformanceObserver(l =>
    l.getEntries().forEach(cb)).observe({ type, buffered: true }); } catch {} };
  obs("longtask", e => S.longtasks.push(Math.round(e.duration)));
  obs("long-animation-frame", e => S.loaf.push(Math.round(e.duration)));
  obs("layout-shift", e => { if (!e.hadRecentInput) S.cls += e.value; });
  obs("largest-contentful-paint", e => S.lcp = Math.round(e.startTime));
  obs("event", e => { const d = e.duration; if (d > S.inp) S.inp = Math.round(d); });
  return "installed";
}
```

```js
// browser_evaluate — read after interacting
() => {
  const S = window.__audit || {};
  const nav = performance.getEntriesByType("navigation")[0] || {};
  return {
    ttfb: Math.round(nav.responseStart || 0),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    lcp: S.lcp, cls: +(S.cls || 0).toFixed(3), inpWorst: S.inp || 0,
    longtasks: S.longtasks || [], loaf: S.loaf || [],
  };
}
```

Thresholds that make a number a finding are in `fresh2-bug-catalog.md` (perf half).
Report each reading as one labeled sample with the trigger, not a benchmark.

## Jank under interaction

Measure frames across a real interaction (scroll/hover/drag/open):

```js
// browser_evaluate — start a frame-delta recorder
() => { const A = (window.__frames = { d: [], last: performance.now() });
  requestAnimationFrame(function t(n){ A.d.push(n - A.last); A.last = n;
    if (A.d.length < 240) requestAnimationFrame(t); }); return "recording"; }
```

Trigger the interaction (`browser_mouse`-style via `browser_evaluate`
`window.scrollBy(...)`, or `browser_hover`/`browser_drag`/`browser_press_key`),
wait ~1 s (`browser_wait_for`), then:

```js
// browser_evaluate — read jank
() => { const d = (window.__frames?.d) || [], f = 1000/60;
  return { frames: d.length, dropped: +(d.filter(x => x > 1.5*f).length / d.length).toFixed(2),
           maxFrameMs: Math.round(Math.max(0, ...d)) }; }
```

A high dropped-frame % under interaction is the symptom; correlate to the cause
class (CSS layout-prop animation, JS forced-sync-layout) in the catalog.

## Animation specs

Extract real animation params instead of describing them (catches layout-property
animations and `transition: all`):

```js
// browser_evaluate — declarative (CSS/WAAPI) animations only
() => document.getAnimations().map(a => ({
  kind: a.constructor.name,
  name: a.animationName ?? a.transitionProperty ?? null,
  props: (a.effect?.getKeyframes?.() || []).flatMap(k =>
    Object.keys(k).filter(p => !["offset","easing","composite"].includes(p))),
  duration: a.effect?.getComputedTiming?.().duration,
}))
```

`getAnimations()` is **blind to rAF/canvas** animation — find those by reading the
island/component source for `requestAnimationFrame`, manual `style.*` writes in
scroll handlers, and canvas draw loops. For deterministic frame capture of
rAF-driven motion, `browser_run_code_unsafe` can `page.clock.install()` if the
tool is enabled; otherwise capture live with the frame recorder above.

**Layout-thrash hunt (code-side, hand to the RCA agent):** grep the island/handler
source for layout reads (`offsetTop`, `offsetHeight`, `scrollTop`,
`getBoundingClientRect`, `getComputedStyle`) **inside** scroll/`rAF`/resize
handlers — worst as a per-element loop. That forces synchronous layout every frame.

## Network waterfall

`browser_network_requests` after a full page load gives you the list. Flag:

- any `4xx`/`5xx`;
- a slow **document** TTFB (a slow in-process backend `fetch` blocking SSR — a
  backend finding, traced server-side in pass 4);
- oversized/uncompressed assets, missing `cache-control`;
- serial chains that should be parallel (request B waits on A for no reason).

For a deeper look, read response timing via `browser_evaluate`
`performance.getEntriesByType("resource").map(r => ({ name: r.name, dur:
Math.round(r.duration), size: r.transferSize }))`.

## Breakpoints

Read the source's real `@media` widths (don't guess device sizes) and
`browser_resize` to each, re-running the smoke + a screenshot. Common deno-fresh2
finding: a layout that collapses or a bottom-tab-bar that overlaps content at the
small breakpoint, or a hover-only affordance with no touch equivalent.
