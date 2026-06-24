# Hunter — stage 1 agent brief

Spawn **one** agent with this brief. It owns the Playwright MCP browser for the
whole stage (single driver, no contention) and hunts in three passes — **UI, then
server, then client** — returning a bug list with reproducible evidence. It does
**not** fix anything; finding and proving is the whole job.

Give it: the running base URL, the project map (paths + data-ownership), and
`user-stories.md`. Point it at `references/fresh2-bug-catalog.md` (what to hunt) and
`references/playwright-mcp-recipes.md` (the exact MCP calls).

## The brief to paste

```
You are the bug-hunter on a Fresh 2 app audit. Find and PROVE bugs and performance
problems — do not fix anything, do not edit files. Think step by step: work one
pass at a time, and reproduce every bug before you log it.

APP (running): <base URL, e.g. http://localhost:8123>
PROJECT ROOT: <abs path>
PROJECT MAP: routes/ <…>  islands/ <…>  components/ <…>  main.ts utils.ts
  vite.config.ts  ·  data: <owns-data | fronts rune/keep backend at <dir>>
USER STORIES: <paste user-stories.md, or "none — derive from routes/islands">
EVIDENCE DIR: <project>/fixes-evidence/   (write screenshots/JSON here)

Read first: references/fresh2-bug-catalog.md (the detection playbook — symptoms,
code signals, thresholds) and references/playwright-mcp-recipes.md (the MCP call
sequences). Hunt for exactly the failure classes in the catalog.

If the Playwright MCP tools (mcp__playwright__*) or mcp__sequential-thinking__
sequentialthinking aren't directly callable, load their schemas first with
ToolSearch (e.g. `select:mcp__playwright__browser_navigate,mcp__playwright__
browser_evaluate,mcp__playwright__browser_console_messages,mcp__playwright__
browser_network_requests,mcp__playwright__browser_snapshot,mcp__playwright__
browser_click,mcp__playwright__browser_take_screenshot`).

PASS 1 — UI (live, Playwright MCP). You are the only driver. Install the console +
network + performance listeners BEFORE navigating. Then walk every user story and
route:
  - assert the user-VISIBLE outcome, not just that the page loaded;
  - check STATUS CODES off the response (soft 404 = a "not found" page that returns
    200; auth bounce should be 302/303), via curl or an evaluate-fetch;
  - check island HYDRATION by interacting → assert the DOM reacts (dead island =
    no change), never by "the button is visible";
  - submit FORMS valid (expect 303 PRG) and invalid (expect inline error/422);
  - drain CONSOLE (errors, Preact hydration mismatches) and NETWORK (4xx/5xx,
    failed assets) on every page;
  - MEASURE performance (long tasks, CLS, dropped frames under scroll/hover/drag,
    waterfall) — a number with conditions, not "feels slow";
  - resize to the source's real @media breakpoints and re-check.
  Capture evidence for each deviation as you see it (screenshot/console line/
  network entry/number) into the evidence dir.

PASS 2 — SERVER. For each UI symptom, read the server code that would cause it:
route handlers (missing page()/Response, ctx.render(data), soft-404 branch),
main.ts (App builder order, middleware before routes), _middleware.ts (missing
await ctx.next()), and — if it fronts a backend — the in-process adapter and rune
endpoints/DTOs (fake data shown as real, empty-store fallback, slow SSR fetch).
Confirm or drop each UI suspicion against the actual code.

PASS 3 — CLIENT. Read the island/component/CSS code for the client-side causes:
function props passed into islands (serialization), non-signal state that never
re-renders, listeners/timers with no cleanup, layout-property CSS animations,
transition:all, forced synchronous layout in scroll/rAF handlers, above-the-fold
content gated on scroll reveals.

DISCIPLINE
- Reproduce before you log. Anything you can't trigger goes in needs_investigation,
  not bugs.
- Don't flag deliberately-correct patterns (transform-based animation, a CSS
  scroll-snap carousel, listeners with proper cleanup, request-time data reads, an
  honestly-surfaced live:false). The catalog's "Do NOT flag" list is binding.
- Locate, don't fully diagnose — a one-line lead and the suspected file is enough;
  the root-cause stage goes deep. But every bug needs real evidence.

RETURN your final message as this exact JSON, nothing else.
```

## Return shape (the bug list)

```json
{
  "bugs": [
    {
      "id": "B1",
      "title": "Unknown /product/:id returns HTTP 200 (soft 404)",
      "category": "bug",                       // bug | perf
      "severity": "blocker",                   // blocker | high | medium | low
      "layer": "server",                       // ui | server | client | backend
      "where_seen": "/product/nope",
      "symptom": "Not-found page renders but the response is 200.",
      "evidence": ["fixes-evidence/soft-404.png", "nav response status = 200"],
      "lead": "routes/product/[id].tsx renders a not-found branch instead of throwing"
    }
  ],
  "needs_investigation": [
    { "note": "Intermittent flash on /cart on first load", "what_would_confirm": "slow-mo capture / repeated reload" }
  ],
  "checked_healthy": [
    "Progress bar animates transform: scaleX (correct, not a jank finding)"
  ]
}
```

The orchestrator turns each `bugs[]` entry into a root-cause agent;
`needs_investigation` and `checked_healthy` flow into the matching `fixes.md`
appendices.
