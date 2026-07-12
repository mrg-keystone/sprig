#!/usr/bin/env python3
"""Gate: no agent reverse-engineered the framework — no reads/greps of the Deno
cache's hashed JSR files or of the sprig runtime source (/repos/sprig/framework,
server/src). The docs are supposed to satisfy that information need (a measured
fleet ran 112 cache-spelunking calls to re-derive ResolveCtx; the contract now
lives in references/routing.md). `deno info` itself stays legal — the guardrail
recommends it — only reading the cached/runtime SOURCE counts."""
import glob
import json
import os
import sys

MARKERS = (
    "/.cache/deno/remote", "Caches/deno/remote", "deno/remote/https/jsr.io",
    "/repos/sprig/framework/.sprig", "/repos/sprig/server/src",
)

def agent_type(tp):
    mp = tp[:-6] + ".meta.json"
    try:
        return json.load(open(mp)).get("agentType") or ""
    except Exception:
        return ""

offenders, analyst_lookups = [], []
for tp in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
    for line in open(tp, errors="replace"):
        if not any(m in line for m in MARKERS):
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        for c in ((o.get("message") or {}).get("content") or []):
            if not (isinstance(c, dict) and c.get("type") == "tool_use"):
                continue
            inp = c.get("input") or {}
            probe = inp.get("command", "") + " " + inp.get("file_path", "") + " " + inp.get("path", "")
            if any(m in probe for m in MARKERS):
                row = f"{os.path.basename(tp)}: [{c.get('name')}] {probe.strip()[:140]}"
                # The analyst's ONE scoped lookup per undocumented semantic is sanctioned
                # (it must flag a DOC GAP in its return) — warn, don't fail. Everyone
                # else re-deriving the framework is the measured 112-call disease.
                (analyst_lookups if agent_type(tp) == "sprig-build-analyst" else offenders).append(row)

print(f"framework-spelunking tool uses: {len(offenders)} (+{len(analyst_lookups)} sanctioned analyst lookups)")
for o_ in offenders[:10]:
    print(" ", o_)
for a_ in analyst_lookups[:5]:
    print("  [analyst-warn]", a_)
sys.exit(1 if offenders else 0)
