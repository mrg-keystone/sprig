# buggy-shop — the ui-audit eval fixture

A small **deno-fresh2** app with a known set of **deliberately planted bugs**, plus
two **deliberately-correct patterns** that must NOT be flagged. It's the audit
target for the `ui-audit` skill (the way `pulse.html` / `ledgerline.html` are for
`ui-breakdown`). Point ui-audit at a running copy and it should find → root-cause →
fix → verify exactly the planted set, and leave the guards alone.

## Boot it

`deno.json` uses `nodeModulesDir: "manual"`, so it needs a `node_modules`. The
cheapest path reuses the sibling `fresh-app` fixture's cached deps:

```sh
cd fixtures/buggy-shop
ln -s ../fresh-app/node_modules node_modules     # reuse cached Vite/Preact/etc.
deno task dev --port 8123                          # http://127.0.0.1:8123
```

(Or scaffold fresh deps with `deno install` / let Vite pull them.) For a
production-fidelity pass: `deno task build && deno serve -A _fresh/server.js`.

## Answer key — what's planted

**Bugs the audit should find and fix (6):**

| # | Sev | File | Bug |
|---|---|---|---|
| 1 | blocker | `routes/index.tsx` | `loadStats` falls back to `STUB_STATS` with `live:false`, but the handler **drops `live`** — stub numbers render as real (catalog **B1**). |
| 2 | high | `routes/product/[id].tsx` | Missing product returns `page({product:null})` → **HTTP 200 soft 404** instead of `throw new HttpError(404)` (catalog **F1**). |
| 3 | high | `islands/AddToCart.tsx` | `qty` is a plain `let`, not a signal → clicking never re-renders the badge (catalog **F4**-adjacent). |
| 4 | high | `routes/contact.tsx` | Valid POST returns a **200 re-render, not a 303** PRG redirect; `/contact/thanks` doesn't exist (catalog **F6**). |
| 5 | high | `routes/contact.tsx` | POST does **no server-side validation** — bad/empty email accepted, no `422` (catalog **F7**). |
| 6 | low | `islands/Parallax.tsx` | Scroll handler in the render body: non-passive, unthrottled, **forced synchronous layout** (rect read → style write per dot per event), never cleaned up (catalog **P5/P6/P11**). *Latent* — measures fine at 40 dots. |

**Deliberately-correct patterns the audit must NOT flag (false-positive guards):**

- `.bar-fill` animates **`transform: scaleX`** (the correct, composited way) — not a layout-prop jank finding.
- `routes/product/[id].tsx` reads data with **`Deno.readTextFile(new URL(...))` at request time** — the correct dev-staleness pattern, not a stale-import bug.

**Bonus (a sharp audit will note it under "Needs investigation"):** that same
`import.meta.url`-relative read is correct in dev but may resolve to the bundled
path under a production `deno serve` build (catalog **B3**) — flag it, don't "fix"
it without confirming in the build.
