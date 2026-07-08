#!/usr/bin/env python3
"""Gate: no agent (main session included) ran pkill/killall/kill -9 during the
run. Port-war kills are a measured fleet failure mode (174 pkills in one
historical build); every parallel builder is briefed its own PORT instead."""
import glob
import json
import os
import sys

BAD = ("pkill", "killall", "kill -9")

offenders = []
for tp in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
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
                    offenders.append(f"{os.path.basename(tp)}: {cmd[:120]}")

print(f"kill-command tool uses: {len(offenders)}")
for o_ in offenders[:10]:
    print(" ", o_)
sys.exit(1 if offenders else 0)
