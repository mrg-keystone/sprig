#!/usr/bin/env python3
"""Gate: the standalone isolate runner's own JSON verdict — every case test
green and a non-vacuous suite (>=3 tests). The CLI logs router lines to stdout
before the JSON, so parse from the first brace. Receipt discipline: this JSON
IS the state; the gate runs the suite once, post-run, for the record."""
import json
import sys

raw = open(sys.argv[1], errors="replace").read()
i = raw.find("{")
if i < 0:
    sys.exit("FAIL: no JSON in isolate output:\n" + raw[:500])
try:
    r = json.loads(raw[i:])
except Exception as e:
    sys.exit(f"FAIL: unparsable isolate JSON ({e}):\n" + raw[:500])

total, passed = r.get("total", 0), r.get("passed", 0)
print(f"isolate: ok={r.get('ok')} ran={r.get('ran')} passed={passed}/{total}")
for t in r.get("testResults", []):
    if not t.get("ok"):
        print("  FAIL", t.get("title"), "—", (t.get("error") or "")[:200])
if not (r.get("ok") is True and r.get("ran") is True and total >= 3):
    sys.exit(1)
print("isolate suite green (non-vacuous)")
