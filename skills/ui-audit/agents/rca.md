# Root-cause — stage 2 agent brief

Spawn **one agent per bug** (cluster tightly-related bugs into one), **in parallel**
— send them in a single message with multiple Agent calls; cap ~6–8 concurrent. Each
does read-only code tracing (frontend **and** backend, no browser, no edits) to pin
the bug to a `file:line` and prove the mechanism. Because they touch only source,
they don't contend for the browser. Use `subagent_type: "Explore"` for pure tracing,
or the general-purpose agent if a tiny local repro (run a handler, `deno check`) is
needed.

Their fix won't just be filed — the **fixer applies it next** — so the cause must be
right and the fix concrete and anchored to the canonical deno-fresh2 pattern.

## The brief to paste (fill per bug)

```
You are a root-cause analyst on a Fresh 2 app audit. Investigate ONE bug and return
a structured finding. READ-ONLY: no edits, no browser, no servers. Think step by
step: from the evidence, to what the code does, to the exact line that causes it.

PROJECT ROOT: <abs path>
PROJECT MAP: routes/ islands/ components/ main.ts utils.ts vite.config.ts
  CSS in assets/  ·  backend: <owns-data | fronts rune/keep at <dir>>

THE BUG (from the hunter)
- id/title: <B1 — Unknown /product/:id returns 200>
- category/severity: <bug|perf> / <blocker|high|med|low>
- where seen: <route/element>     layer lead: <ui|server|client|backend>
- evidence (look at these files): <fixes-evidence/...>, <status/console/number>
- hunter's lead: <one line>
- catalog row (if any): <paste from references/fresh2-bug-catalog.md>

DO THIS
1. From the evidence, state what the app does vs. what it should do (check
   user-stories.md if relevant).
2. Trace to the exact file:line. Span the stack as needed — route handlers & pages,
   islands (hydration, serialization, signals, listeners), components, CSS/keyframes,
   _app.tsx, main.ts (builder order), _middleware.ts, and the backend (in-process
   adapter, rune [ENT]/DTOs, env/tasks). Quote the few lines that prove it.
3. Verdict: CONFIRMED (you can point at the cause), REFUTED (code shows it's
   actually correct — say why; a false positive removed is a win), or NEEDS_REPRO
   (real but needs a browser/runtime check — name the exact check).
4. If CONFIRMED, give the concrete fix anchored to a named deno-fresh2 reference,
   and a single runnable verification with its expected result.

Never invent a file:line. If you can't find it, return NEEDS_REPRO with what's
missing. Default to REFUTED when the code clearly shows the suspected bug isn't real.

RETURN your final message as this exact JSON, nothing else.
```

## Return shape (the finding)

```json
{
  "id": "B1",
  "title": "Unknown /product/:id returns HTTP 200 (soft 404)",
  "verdict": "confirmed",            // confirmed | refuted | needs_repro
  "category": "bug",                 // bug | perf
  "severity": "blocker",
  "whats_wrong": "A missing product renders the not-found page with a 200 status, so a missing page reads as real to crawlers and the browser.",
  "root_cause": {
    "file": "routes/product/[id].tsx", "line": 18,
    "mechanism": "Handler returns page({ product: null }) on miss instead of throwing; Fresh sets 404 only from a thrown HttpError, so the 200 render path runs.",
    "quote": "if (!product) return page({ product: null });"
  },
  "fix": {
    "change": "throw new HttpError(404) on miss; let routes/_error.tsx render it.",
    "reference": "deno-fresh2 → references/advanced/error-handling.md",
    "risk": "low"                    // low | medium | high — high/ambiguous → fixer leaves it noted, not guessed
  },
  "verify": { "how": "curl -i http://localhost:8000/product/nope | head -1", "expect": "HTTP/1.1 404" },
  "evidence_refs": ["fixes-evidence/soft-404.png"],
  "needs_repro": null,
  "notes": ""
}
```

The orchestrator: **confirmed** → a `fixes.md` section (the fix queue); **refuted**
→ dropped, optionally noted in "Checked and healthy"; **needs_repro** → the
orchestrator runs the named check at the MCP, then promotes or drops. Dedupe
findings that resolve to the **same** `file:line` into one section.
