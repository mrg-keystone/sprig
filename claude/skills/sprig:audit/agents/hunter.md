# Hunter — stage 1 agent brief

Spawn **one** agent with this brief. It owns the Playwright MCP browser for the
whole stage (single driver, no contention) and hunts in three passes — **UI, then
server, then client** — returning a bug list with reproducible evidence. It does
**not** fix anything; finding and proving is the whole job.

Give it: the running base URL, the project map (paths + data-ownership), and
`user-stories.md`. Point it at `references/sprig-bug-catalog.md` (what to hunt) and
`references/playwright-mcp-recipes.md` (the exact MCP calls).

## The brief to paste

```
You are the bug-hunter on a sprig app audit. Find and PROVE bugs and performance
problems — do not fix anything, do not edit files. Think step by step: work one
pass at a time, and reproduce every bug before you log it.

APP (running): <base URL, e.g. http://localhost:8000/ui>
PROJECT ROOT: <abs path>
PROJECT MAP: src/ (shell/ pages/ components/ islands/ services/)  main.ts serve.ts
  ·  data: <owns-data | fronts keep backend (Backend token / /api) at <dir>>
USER STORIES: <paste user-stories.md, or "none — derive from the route table + islands">
EVIDENCE DIR: <project>/fixes-evidence/   (write screenshots/JSON here)

Read first: references/sprig-bug-catalog.md (the detection playbook — symptoms,
code signals, thresholds) and references/playwright-mcp-recipes.md (the MCP call
sequences). Hunt for exactly the failure classes in the catalog. sprig is a Deno
SSR framework with folder-components + island hydration — NOT Fresh/Preact/Next.

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
    200 instead of setResponseStatus(404); off-base paths incl. / 404 by design),
    via curl or an evaluate-fetch;
  - check island HYDRATION by interacting → assert the DOM reacts (dead island =
    no change), never by "the button is visible"; gate on hydration first (a click
    before hydrate is a silent no-op);
  - drive WRITES (optimistic island actions): the UI should update instantly, and on
    a forced failure roll back + show an error — never spin then location.reload();
    post bad data straight to /api to check server-side validation;
  - drain CONSOLE (SSR throws, DI-boundary throws, unguarded-window throws) and
    NETWORK (4xx/5xx, failed assets, /api errors) on every page;
  - MEASURE performance (long tasks, CLS, dropped frames under scroll/hover/drag,
    waterfall) — a number with conditions, not "feels slow";
  - resize to the source's real @media breakpoints and re-check.
  Capture evidence for each deviation as you see it (screenshot/console line/
  network entry/number) into the evidence dir.

PASS 2 — SERVER. For each UI symptom, read the server code that would cause it:
the page's resolve.ts / @Injectable services (missing setResponseStatus(404) on a
missing resource, inject() called after an await, an unguarded window/document in
setup), main.ts (the defineRoutes table), serve.ts (the no-op keep stub still wired
instead of the real api), and — if it fronts a backend — the in-process Backend
calls and keep endpoints/DTOs (fake data shown as real, empty-store/no-op-keep
fallback, slow SSR fetch). Confirm or drop each UI suspicion against the actual code.

PASS 3 — CLIENT. Read the island/component/CSS code for the client-side causes:
an interactive folder with no logic.ts (its (event) bindings never fire — dead
island), non-serializable @inputs (function/class-instance props), non-signal state
that never re-renders, an unguarded browser global in setup(), manual
addEventListener/setInterval with no cleanup, layout-property CSS animations,
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
      "title": "Unknown /ui/product/:id returns HTTP 200 (soft 404)",
      "category": "bug",                       // bug | perf
      "severity": "blocker",                   // blocker | high | medium | low
      "layer": "server",                       // ui | server | client | backend
      "where_seen": "/ui/product/nope",
      "symptom": "Not-found view renders but the response is 200.",
      "evidence": ["fixes-evidence/soft-404.png", "nav response status = 200"],
      "lead": "src/services/product/mod.ts returns null without setResponseStatus(404)"
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
