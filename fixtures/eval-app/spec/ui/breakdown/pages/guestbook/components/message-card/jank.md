# message-card — jank findings

Lints run over the extracted `css/message-card.css` and `js/message-card.js`,
plus one live (unscrubbed) instrumented run of the real trigger (posting a
message → `animate-rise` on the new card). Numbers are one labeled sample, not a
benchmark.

## The animation itself — CLEAN (compositor-only)

The `animate-rise` entrance animates **only `opacity` and `transform`**
(`@keyframes brand-rise { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }`).
Both are compositor properties — no layout, no paint per frame.

| CSS lint | Result |
|---|---|
| Keyframes/transitions on layout props (`height`/`width`/`top`/`left`/`margin`/`padding`) | **PASS** — only `opacity` + `transform` |
| `transition: all` | **PASS** — not used; it's a keyframe animation, explicit |
| Animated `box-shadow` / `filter` | **PASS** — `shadow-sm` is static; not animated |
| Missing `will-change` on heavy persistent animation | **N/A** — one-shot 320 ms entrance that runs **once** (`isNew` is cleared after the first render), not a persistent/looping layer; a compositor hint is unnecessary |

No CSS rebuild change required for the animation. Keep the keyframes as
`opacity` + `transform`.

## JS-side finding — the TRIGGER path rebuilds the whole wall (real, observed)

The animation is GPU-cheap, but the **trigger** is not. `post()` → `renderWall()`
does `wall.innerHTML = list.map(cardHtml).join("")` (re-stringifies and re-parses
**every** card, not just the new one) and then `lucide.createIcons()`, which
re-scans the whole document for `[data-lucide]` and swaps every icon on every
card. This is a synchronous long task that lands in the same frame the entrance
starts.

- **Live sample** (post one message, observe ~1.2 s): **152 frames, 1 dropped
  (0.7%), max frame 33.8 ms, CLS 0.0001**, and **one long-animation-frame of
  195.5 ms** at the moment of the post.
- The 33.8 ms / 195.5 ms spike is the **innerHTML rebuild + full `lucide.createIcons()` rescan**, not the `opacity/transform` animation. CLS is negligible because new cards prepend above the fold and the list just shifts down.

| JS lint | Result |
|---|---|
| Layout reads (`offsetTop`/`getBoundingClientRect`) inside scroll/rAF/resize loops | **PASS** — none; no scroll/rAF handlers in the card path |
| Unthrottled scroll handlers writing styles | **PASS** — none |
| `setTimeout`/`setInterval`-driven animation | **PASS** — entrance is CSS-driven; the only `setTimeout`s are the fake-fetch delay and toast auto-dismiss (not this card) |
| Full-subtree DOM rebuild + icon rescan on every insert | **FAIL** — 195 ms long task per post; scales with wall size |

**Rebuild fix:** insert only the new card (build one `cardHtml` and
`wall.prepend(node)` / `insertAdjacentHTML('afterbegin', …)`) instead of
re-rendering the entire list, and create icons **scoped to the new node**
(`lucide.createIcons({ nameAttr:'data-lucide', icons, attrs:{} })` over just the
inserted subtree, or pre-render the single clock icon) rather than rescanning the
whole document. That keeps the post off the long-task path so the 320 ms entrance
runs alone. In a component framework this falls out naturally — render one
`<MessageCard isNew>` and let the framework patch only that node.

## Reduced motion

A global guard collapses the entrance to ~0 ms under
`@media (prefers-reduced-motion: reduce)` — preserve this in the rebuild.
