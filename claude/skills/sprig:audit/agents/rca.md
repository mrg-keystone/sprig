# Root-cause — stage 2 agent brief

Spawn **one agent per bug** (cluster tightly-related bugs into one), **in parallel**
— send them in a single message with multiple Agent calls; cap ~6–8 concurrent. Each
does read-only code tracing (frontend **and** backend, no browser, no edits) to pin
the bug to a `file:line` and prove the mechanism. Because they touch only source,
they don't contend for the browser. Use `subagent_type: "Explore"` for pure tracing,
or the general-purpose agent if a tiny local repro (run a handler, `deno check`) is
needed.

Their fix won't just be filed — the **fixer applies it next** — so the cause must be
right and the fix concrete and anchored to the canonical build pattern.

## The brief to paste (fill per bug)

```
You are a root-cause analyst on a sprig app audit. Investigate ONE bug and return
a structured finding. READ-ONLY: no edits, no browser, no servers. Think step by
step: from the evidence, to what the code does, to the exact line that causes it.
sprig is a Deno SSR framework with folder-components + island hydration — NOT
Fresh/Preact/Next; reason from its model, not theirs.

PROJECT ROOT: <abs path>
PROJECT MAP: src/ (shell/ pages/ components/ islands/ services/)  main.ts serve.ts
  component styles.css co-located  ·  backend: <owns-data | fronts keep at <dir>>

THE BUG (from the hunter)
- id/title: <B1 — Unknown /ui/product/:id returns 200>
- category/severity: <bug|perf> / <blocker|high|med|low>
- where seen: <route/element>     layer lead: <ui|server|client|backend>
- evidence (look at these files): <fixes-evidence/...>, <status/console/number>
- hunter's lead: <one line>
- catalog row (if any): <paste from references/sprig-bug-catalog.md>

DO THIS
1. From the evidence, state what the app does vs. what it should do (check
   user-stories.md if relevant).
2. Trace to the exact file:line. Span the stack as needed — pages & resolve.ts,
   @Injectable services (setResponseStatus, inject()-after-await, scope), islands
   (hydration, serialization, signals, unguarded globals, listeners), components,
   CSS/keyframes, shell, main.ts (the route table), serve.ts (serveSprig/keep), and
   the backend (in-process Backend, keep DTOs, env/tasks). Quote the few lines that prove it.
3. Verdict: CONFIRMED (you can point at the cause), REFUTED (code shows it's
   actually correct — say why; a false positive removed is a win), or NEEDS_REPRO
   (real but needs a browser/runtime check — name the exact check).
4. If CONFIRMED, give the concrete fix anchored to a named build reference,
   and a single runnable verification with its expected result.

Never invent a file:line. If you can't find it, return NEEDS_REPRO with what's
missing. Default to REFUTED when the code clearly shows the suspected bug isn't real.

RETURN your final message as this exact JSON, nothing else.
```

## Return shape (the finding)

```json
{
  "id": "B1",
  "title": "Unknown /ui/product/:id returns HTTP 200 (soft 404)",
  "verdict": "confirmed",            // confirmed | refuted | needs_repro
  "category": "bug",                 // bug | perf
  "severity": "blocker",
  "whats_wrong": "A missing product renders the not-found view with a 200 status, so a missing page reads as real to crawlers and the browser.",
  "root_cause": {
    "file": "src/services/product/mod.ts", "line": 24,
    "mechanism": "On a missing product the service returns null but never calls setResponseStatus(req, 404), so the matched route renders at the default 200.",
    "quote": "if (!ok || data == null) return null;  // no setResponseStatus(this.#req, 404)"
  },
  "fix": {
    "change": "capture currentInjector() at construction; setResponseStatus(this.#req, 404) on miss.",
    "reference": "build → references/component-model.md (sprig docs → data-and-di)",
    "risk": "low"                    // low | medium | high — high/ambiguous → fixer leaves it noted, not guessed
  },
  "verify": { "how": "curl -i http://localhost:8000/ui/product/nope | head -1", "expect": "HTTP/1.1 404" },
  "evidence_refs": ["fixes-evidence/soft-404.png"],
  "needs_repro": null,
  "notes": ""
}
```

The orchestrator: **confirmed** → a `fixes.md` section (the fix queue); **refuted**
→ dropped, optionally noted in "Checked and healthy"; **needs_repro** → the
orchestrator runs the named check at the MCP, then promotes or drops. Dedupe
findings that resolve to the **same** `file:line` into one section.
