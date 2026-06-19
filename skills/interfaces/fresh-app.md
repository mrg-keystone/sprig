# Contract: fresh-app

> **Producer:** build · **Consumer:** audit · Pipeline: design → prototype → breakdown → build → audit

A **running Fresh 2 app** the `audit` stage can exercise live, hunt bugs in, and harden.

## Artifact
A buildable Fresh 2 project:
- `routes/` (pages + API + `_app.tsx` + unified `_error.tsx`), `islands/`, `components/`,
  `utils.ts`, `main.ts`, `client.ts`, `vite.config.ts`, `deno.json`.
- `assets/styles.css` — the **global sheet**: the breakdown's tokens as a Tailwind 4 `@theme`
  block (+ `@font-face`, resets, shared keyframes) and nothing component-specific.
- **Per-component CSS:** components style with **Tailwind utilities first**; any custom CSS a
  component needs lives in its **own co-located `*.module.css`** — never a shared/global
  component stylesheet.
- `user-stories.md` (one line per thing a user can do) + Playwright tests; isolate cases green.

## Shape (what `audit` can rely on)
- `deno task dev` serves it; `deno task build` then `deno serve -A _fresh/server.js` runs prod.
- **Real data wired** (live), with any unavoidable fixture **labeled** (`live: boolean`) — not a
  console of 100% fake numbers.
- SSR-native interaction: form+PRG / Fresh Partials / justified islands — **no whole-page island,
  nothing `location.reload()`-ing server state**; correct HTTP status codes (a real 404 is a 404).

## Invariants
- The app actually **builds and boots** — the prod build, not just `deno task dev`.
- `user-stories.md` is the coverage map; each story has a browser test.

## Validation
The prod build boots and serves; the suite runs green against a freshly-started server. The audit
records findings + fixes in `fixes.md`.
