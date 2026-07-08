#!/usr/bin/env python3
"""Gate: the hunter treated the server as parent-owned — it never killed,
port-probed, or (re)started it. Scans the hunter agents' Bash tool uses for
pkill/lsof/killall/server-start commands (curl is fine)."""
import glob
import json
import os
import sys

BAD = ("pkill", "lsof", "killall", "deno serve", "sprig dev", "deno task start", "kill -9")

metas = glob.glob(os.path.expanduser("~/.claude/projects/**/agent-*.meta.json"), recursive=True)
hunters, offenders = 0, []
for mp in metas:
    try:
        if json.load(open(mp)).get("agentType") != "sprig-audit-hunter":
            continue
    except Exception:
        continue
    hunters += 1
    tp = mp[: -len(".meta.json")] + ".jsonl"
    if not os.path.isfile(tp):
        continue
    for line in open(tp, errors="replace"):
        if not any(b in line for b in BAD):
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        for c in ((o.get("message") or {}).get("content") or []):
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "Bash":
                cmd = (c.get("input") or {}).get("command", "")
                if any(b in cmd for b in BAD):
                    offenders.append(cmd[:120])

print(f"hunters: {hunters}, discipline violations: {len(offenders)}")
for o_ in offenders[:10]:
    print(" ", o_)
if hunters == 0:
    sys.exit("FAIL: no sprig-audit-hunter agent ran")
sys.exit(1 if offenders else 0)
