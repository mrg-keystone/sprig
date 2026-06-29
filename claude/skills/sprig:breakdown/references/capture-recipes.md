# Capture recipes — Playwright evidence collection for the breakdown

Copy-adaptable recipes for the capture passes. They are plain Node scripts
(CommonJS, `.cjs`) so they run with zero project setup.

## Finding Playwright

Don't install anything until you've checked what's already there, in order:

1. **the isolate runner** (present on any machine that has run `sprig isolate` and its
   case tests — it provisions `~/.isolate-runner`):

   ```js
   const os = require('os');
   const { chromium } = require(os.homedir() + '/.isolate-runner/node_modules/playwright-core');
   ```

2. A project-local `node_modules/playwright-core` or `playwright`.
3. Last resort: `npm i playwright-core` in a scratch dir (browsers usually
   already exist under the standard cache, e.g. `~/Library/Caches/ms-playwright`;
   if launch fails with a missing-browser error, `npx playwright install chromium`).

## Serving the source

Self-contained mocks open directly: `file:///abs/path/mock.html`. Hash routes
work over `file://` too — `file:///abs/path/mock.html#/board`. Only reach for
`python3 -m http.server` if the mock `fetch()`es relative resources (blocked
on `file://`).

After `goto`, **let entrance animations settle** before stills
(`await page.waitForTimeout(2000–3000)`) — count-ups, skeleton→content swaps,
and staggered reveals all lie at t=0.

## Stills

```js
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('file://' + src + '#/dashboard');
await page.waitForTimeout(2500);

// full page
await page.screenshot({ path: 'screenshots/dashboard.png', fullPage: true });
// cropped to one component — locator screenshots auto-clip
await page.locator('.topbar').screenshot({ path: '.../topbar.png' });
```

- **Breakpoints**: read the source's `@media` queries and re-shoot at *those*
  widths (e.g. a `max-width: 720px` query → shoot at 700×844), not guessed
  device sizes. Re-create the page with a new viewport or use
  `page.setViewportSize()`.
- **Themes**: if the source has a theme attribute/class, set it directly
  before shooting — `await page.evaluate(() => document.documentElement.dataset.theme = 'dark')`
  — no need to click the toggle.
- **Transient components** (toast, modal, palette, drawer): drive the UI to
  summon them first (`page.keyboard.press('Meta+k')`, click the trigger), then
  screenshot the overlay element.

## Motion: extract the spec

CSS animations/transitions and WAAPI animations are all visible to one call:

```js
const specs = await page.evaluate(() =>
  document.getAnimations().map((a) => ({
    kind: a.constructor.name,            // CSSAnimation | CSSTransition | Animation (WAAPI)
    name: a.animationName ?? a.transitionProperty ?? null,
    target: (() => { const el = a.effect?.target; if (!el) return null;
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
             (el.classList.length ? '.' + [...el.classList].join('.') : ''); })(),
    keyframes: a.effect?.getKeyframes?.() ?? [],
    timing: a.effect?.getComputedTiming?.() ?? {},   // duration, delay, easing, iterations
    playState: a.playState,
  })),
);
```

Run it once after load (entrance + infinite animations) and again after
triggering each interaction (hover via `locator.hover()`, open/close, drag) to
catch transition-driven motion. Triggers don't appear in the API — attribute
them by correlating target selectors with the CSS/JS you extracted.

**Blind spots — `getAnimations()` cannot see:**

- **rAF-driven animation** (count-ups, parallax, manual `style.*` writes in
  scroll handlers) — find them by reading the code for
  `requestAnimationFrame`; capture via clock emulation below.
- **canvas drawing** (sparklines, charts) — no declarative layer exists at
  all; read the draw code for the animation parameters and capture frames via
  clock emulation.

## Deterministic scrubbing → filmstrip

For scrubbable (CSS/WAAPI) animation, pause everything and step `currentTime`:

```js
for (const pct of [0, 20, 40, 60, 80, 100]) {
  await page.evaluate(({ pct }) => {
    for (const a of document.getAnimations()) {
      a.pause();
      const dur = a.effect.getComputedTiming().duration;
      a.currentTime = (pct / 100) * dur;     // within one iteration for infinite anims
    }
  }, { pct });
  await page.locator(SEL).screenshot({ path: `frames/${pct}.png` });
}
```

For rAF-driven motion, install a fake clock **before navigation**, then step
virtual time — rAF callbacks fire deterministically:

```js
const page = await browser.newPage();
await page.clock.install();
await page.goto(url);
for (let i = 0; i <= 5; i++) {
  await page.clock.runFor(DURATION_MS / 5);
  await page.locator(SEL).screenshot({ path: `frames/${i}.png` });
}
```

**Composite the filmstrip with zero extra dependencies** — write an HTML strip
and screenshot it (no ImageMagick needed):

```js
const fs = require('fs'); const path = require('path');
const cells = frames.map((f, i) =>
  `<figure style="margin:0;text-align:center;color:#ddd;font:11px monospace">
     <img src="file://${path.resolve(f)}" style="display:block;max-height:240px">
     <figcaption>${i * 20}%</figcaption></figure>`).join('');
fs.writeFileSync('/tmp/strip.html',
  `<body style="margin:0;display:flex;gap:2px;background:#222;width:max-content">${cells}</body>`);
const strip = await browser.newPage();
await strip.goto('file:///tmp/strip.html');
await strip.screenshot({ path: 'screenshots/filmstrip.png', fullPage: true });
```

## Live jank run → `jank.md`

One unscrubbed pass per animated component: instrument, trigger the real
interaction, read the counters.

```js
await page.evaluate(() => {
  window.__jank = { deltas: [], loaf: [], cls: 0 };
  let last = performance.now();
  requestAnimationFrame(function tick(t) {
    window.__jank.deltas.push(t - last); last = t; requestAnimationFrame(tick);
  });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__jank.loaf.push(e.duration)))
    .observe({ type: 'long-animation-frame', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__jank.cls += e.value; }))
    .observe({ type: 'layout-shift', buffered: true });
});

// ...trigger: hover, open the modal, drag the card, or scroll:
await page.mouse.wheel(0, 600); await page.waitForTimeout(1200);

const j = await page.evaluate(() => window.__jank);
const frame = 1000 / 60;
const dropped = j.deltas.filter((d) => d > 1.5 * frame).length / j.deltas.length;
// report: dropped-frame %, max(j.deltas) ms, j.loaf entries > 50ms, CLS delta j.cls
```

Numbers vary run to run — report them as one labeled sample, not a benchmark.

## Static jank lints

Run these over the **extracted CSS and JS** (grep + judgment, no browser).
Record hits in the owning component's Motion section, each with the fix the
rebuild should use instead.

CSS side:

| Lint | Why it janks | Rebuild with |
|---|---|---|
| Keyframes/transitions on layout props (`height`, `width`, `top`, `left`, `margin`, `padding`) | layout + paint every frame | `transform` (`scaleY`, `translate`) or `grid-template-rows: 0fr→1fr` |
| `transition: all` | transitions properties you never intended, incl. layout props; cost scales with element count | list the intended properties |
| Animating `box-shadow`/`filter` on hover | full repaint of the shadow region per frame | pre-render shadow on a pseudo-element, animate its `opacity` |
| Missing `will-change`/compositor hint on heavy persistent animation (parallax layers, marquees) | layers re-rasterize | `will-change: transform` on the moving layer only |

JS side:

| Lint | Why it janks | Rebuild with |
|---|---|---|
| Layout reads (`offsetTop`, `offsetHeight`, `getBoundingClientRect`) inside scroll/rAF/resize handlers — worst as a per-element loop | forces synchronous layout per read → reflow storm | batch reads before writes; cache geometry; `IntersectionObserver` |
| Unthrottled scroll handlers doing style writes | runs faster than frames are painted | rAF-throttle, or CSS scroll-driven animation |
| `setTimeout`/`setInterval`-driven animation | not frame-aligned; drifts and stutters | rAF or CSS animation |
| Style writes interleaved with reads in one handler | layout thrash | read-all-then-write-all |

A labeled trap in a fixture or a comment admitting the hack still counts as a
finding — lint the code as it is, not as the comments promise.
