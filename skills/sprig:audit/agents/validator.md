# Validator — stage 4 agent brief

Spawn **one** agent with this brief plus `fixes.md`, **after restarting a fresh
server** (the fixer edited code; an edited-but-stale `sprig dev` server will lie —
restart it, or test the prod build). It re-runs **every** issue's "Verify fixed"
check and re-checks a few *unrelated* stories for regressions, then reports each
issue green or still-failing. It owns the Playwright MCP for this stage (the hunter
is long done — no contention).

## The brief to paste

```
You are the validator on a sprig app audit. Prove each fix in fixes.md actually
holds, and catch any regression the fixes introduced. Think step by step: run each
issue's own Verify check, record the real result, then sweep for collateral damage.

If the Playwright MCP tools (mcp__playwright__*) or mcp__sequential-thinking__
sequentialthinking aren't directly callable, load their schemas first with
ToolSearch (`select:mcp__playwright__browser_navigate,...`).

APP (freshly restarted): <base URL>
PROJECT ROOT: <abs path>
FIXES: <project>/fixes.md
USER STORIES: <paste user-stories.md, or the derived list>

PER ISSUE (every section, ☑ and ☐ alike):
- Run its "Verify fixed" check exactly as written — a `curl -i` status, a Playwright
  interaction via the MCP (interact → assert the DOM/route reacted), `isolate test`,
  or a perf re-measure under the same trigger/conditions. Recipes:
  references/fixes-format.md (Verification recipes) and
  references/playwright-mcp-recipes.md.
- Record PASS (with the actual output: the status line, the measured number, the
  asserted DOM change) or FAIL (what you got vs. expected). No "looks fixed" — paste
  the evidence.

REGRESSION SWEEP:
- Re-run 3–5 unrelated user stories end to end (especially ones near the files the
  fixer touched). A fix that corrected one route and broke another is a net loss —
  surface it.
- Drain the console + network once more on the main pages: any NEW errors/4xx/5xx
  that weren't in the original hunt are regressions.

DISCIPLINE
- Validate against the fresh server you were given; if you suspect staleness,
  cache-bust (`?_=<n>`) and re-check. Assert status codes off the response, not the
  DOM.
- A ☐ deferred issue isn't a failure — just report it still-open with its noted
  reason; don't try to fix it (you're not the fixer).

RETURN your final message as this exact JSON, nothing else.
```

## Return shape

```json
{
  "results": [
    { "id": "B1", "title": "Soft 404 on /ui/product/:id", "status": "pass",
      "evidence": "curl -i /ui/product/nope → HTTP/1.1 404 Not Found" },
    { "id": "P1", "title": "Row expand height jank", "status": "fail",
      "evidence": "dropped-frame 0.31 (expected < 0.10) — fix didn't change the animated property",
      "next": "re-open: animate transform/grid-template-rows, not height" }
  ],
  "regressions": [
    { "where": "/ui/cart", "symptom": "new console error TypeError after the write fix", "evidence": "console: …" }
  ],
  "deferred_still_open": ["F8 server-side validation — needs the keep endpoint to reject bad input"],
  "verdict": "fail"                 // pass = all checks green & no regressions; else fail
}
```

## How the orchestrator consumes it

- **verdict pass** → done. `fixes.md` is fully ☑ and is the proof; report the
  summary (fixed N, deferred M, all verified).
- **any fail or regression** → think about why (wrong root cause vs. incomplete fix
  vs. collateral), loop that issue back through FIX — or re-open ROOT-CAUSE if the
  diagnosis itself was wrong — restart a fresh server, and re-validate. Never
  declare done over a red check.
