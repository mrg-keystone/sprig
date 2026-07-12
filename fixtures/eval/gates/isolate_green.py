#!/usr/bin/env python3
"""Gate: the standalone isolate runner's own JSON verdict — every case test
green and a non-vacuous suite (>=3 tests). The CLI logs router lines to stdout
before the JSON, so parse from the first brace. Receipt discipline: this JSON
IS the state; the gate runs the suite once, post-run, for the record."""
import json
import sys

raw = open(sys.argv[1], errors="replace").read()
err = open(sys.argv[2], errors="replace").read() if len(sys.argv) > 2 else ""
MIN_TOTAL = int(sys.argv[3]) if len(sys.argv) > 3 else 3
i = raw.find("{")
if i < 0:
    sys.exit("FAIL: no JSON in isolate output:\n" + raw[:400] +
             ("\n--- stderr tail ---\n" + err[-600:] if err.strip() else ""))
try:
    r = json.loads(raw[i:])
except Exception as e:
    sys.exit(f"FAIL: unparsable isolate JSON ({e}):\n" + raw[:400] +
             ("\n--- stderr tail ---\n" + err[-600:] if err.strip() else ""))

total, passed = r.get("total", 0), r.get("passed", 0)
print(f"isolate: ok={r.get('ok')} ran={r.get('ran')} passed={passed}/{total}")
if r.get("error"):
    print("  error:", str(r["error"])[:300])
for t in r.get("testResults", []):
    if not t.get("ok"):
        print("  FAIL", t.get("title"), "—", (t.get("error") or "")[:200])
if not (r.get("ok") is True and r.get("ran") is True and total >= MIN_TOTAL):
    sys.exit(1)
print(f"isolate suite green (non-vacuous, total {total} >= {MIN_TOTAL})")
