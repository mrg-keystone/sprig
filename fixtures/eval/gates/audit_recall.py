#!/usr/bin/env python3
"""Gate: /work/fixes.md recalls >=2 of the 3 planted bugs (at least one of the
two HIGH ones), and every cited src file:line exists (zero fabricated
locations). Planted truth in fixtures/eval/audit-app:
  B1 soft-404 — src/pages/widget/resolve.ts returns the notFound view without
     setResponseStatus(404) on a miss.
  B2 dead Like control — src/components/like-button has template.html only
     (a (click) binding with no logic.ts => static, never hydrates).
  B4 /favicon.ico 404 on every page.
(The historical B3 hydration-wipe was fixed IN THE FRAMEWORK and cannot be
re-planted against the mounted working tree.)"""
import os
import re
import sys

FIXES = "/work/fixes.md"
if not os.path.isfile(FIXES):
    sys.exit("FAIL: /work/fixes.md missing")
raw = open(FIXES, errors="replace").read()
text = raw.lower()

b1 = "widget" in text and "404" in text and ("resolve.ts" in text or "setresponsestatus" in text)
b2 = "like" in text and "logic.ts" in text
b4 = "favicon" in text
found = {"B1-soft404": b1, "B2-dead-like": b2, "B4-favicon": b4}
n = sum(found.values())
print("recall:", found)
if n < 2 or not (b1 or b2):
    sys.exit(f"FAIL: recall {n}/3 (need >=2 incl. a HIGH)")

bad = []
for path, line in set(re.findall(r"(src/[\w\-/.]+\.(?:ts|html|css|json))(?::(\d+))?", raw)):
    full = "/work/" + path
    if not os.path.isfile(full):
        bad.append(f"cited file missing: {path}")
    elif line and int(line) > len(open(full, errors="replace").readlines()) + 5:
        bad.append(f"cited line out of range: {path}:{line}")
if bad:
    sys.exit("FAIL fabrication:\n  " + "\n  ".join(bad))
print("no fabricated locations")
