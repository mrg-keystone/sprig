# Contract: prototype

> **Producer:** prototype · **Consumer:** breakdown · Pipeline: design → prototype → breakdown → build → audit

ONE self-contained, throwaway **`.html` mock** that shows the complete look-and-feel and the
main flow — the thing the `breakdown` stage decomposes into a build spec.

## Artifact
A single `*-prototype.html` file that **opens by double-click** — CDN scripts only, no build
step, hardcoded data, fake in-memory interactions.

## Shape (what `breakdown` can rely on)
- **Renderable with Playwright** as-is (it's just an HTML file) — so breakdown can open it, walk
  the DOM, extract tokens, and capture screenshots/filmstrips.
- The **design-system brand applied** — daisyUI semantic classes + `data-theme`, via the CDN
  stack (daisyUI + `@tailwindcss/browser@4` + lucide).
- **Every screen of the flow is present**, including the unglamorous states (empty, loading,
  error/toast, overflow) where real requirements hide. Multiple "pages" are expressed via
  client-side routing (hash router / view toggles), so breakdown counts **views, not files**.

## Invariants
- Fully self-contained — no server, no external build.
- Data is hardcoded and ideally deterministic (so breakdown's screenshots reproduce).
- It is **throwaway** — reference ground truth for the spec, never deliverable code.

## Validation
Opens standalone in a browser; every flow + unglamorous state is reachable by clicking.
