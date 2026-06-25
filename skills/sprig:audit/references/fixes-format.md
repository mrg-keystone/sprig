# fixes.md — format, example, and verification recipes

`fixes.md` is the artifact that flows through the whole pipeline: **ROOT-CAUSE
writes** one section per confirmed issue, the **FIX agent ticks** each box and
appends a `**Fixed**` note as it lands the change, and the **VALIDATE agent
confirms** each Verify check holds. At the end it's both the changelog and the
proof. One section per issue, ordered blocker → high → medium → low.

**The checkbox lifecycle:** `### ☐` (written by ROOT-CAUSE, awaiting fix) →
`### ☑` + a `**Fixed**` line (FIX applied it) → confirmed green by VALIDATE. A fix
the fixer couldn't safely make stays `### ☐` with a `**Deferred** — <why>` line, so
the final file honestly shows fixed-vs-open at a glance. Use `☐`/`☑` (or `- [ ]` /
`- [x]` if the user's tooling prefers it — the safe default for GitHub markdown).

## File structure

```md
# fixes.md — <app name> audit

<one-line scope: what was exercised, dev vs build, date>. N issues
(B blockers, H high, M medium, L low). Evidence in `fixes-evidence/`.

| # | Severity | Cat | Issue | Where |
|---|---|---|---|---|
| 1 | blocker | bug | Unknown slug returns 200 (soft 404) | src/services/blog/mod.ts |
| 2 | high | perf | Row-expand animates height (drops frames) | src/islands/row/styles.css |
| … |

---

## Issues

### ☐ [BLOCKER · bug] <title>
…the section skeleton below…

### ☐ [HIGH · perf] <title>
…

---

## Needs investigation
Reproduced but not root-caused, or suspected but not reproduced — each with what's
known and what would confirm it. (Empty is fine: "Needs investigation: none.")

## Checked and healthy
The notable things verified to be *correct* — refuted false positives and patterns
a reader might worry about but shouldn't. Buys the report trust.
```

## The section skeleton

Each issue is a checkbox section with exactly these fields, in order — they map to
the user's ask (explain the issue · the cause · how to verify the fix), plus the
evidence and the fix you can't verify without:

```md
### ☐ [SEVERITY · category] Short, specific title

**What's wrong** — the symptom in plain terms: what the user (or crawler, or
reduced-motion user) actually experiences. No jargon-only descriptions.

**Evidence** — the proof you captured: `fixes-evidence/<file>.png`, a console line,
a network entry, an HTTP status, or a measured number *with its conditions*
("INP 480 ms after clicking Subscribe, 1280×800, dev"). Link, don't describe.

**Root cause** — `src/path/to/file.ts:LINE` — the mechanism, proven from the code (a
short quote of the offending line earns its place). Name the backend file if the
cause is server-side.

**Fix** — the concrete change, anchored to the canonical pattern:
"`setResponseStatus(req, 404)` on miss … see build → `references/component-model.md`."
Not "handle the error better."

**Verify fixed** — a single runnable check and its expected result (recipes below).
This is the box's exit criteria: when this passes, tick ☐ → ☑.

**Fixed** — *(appended by the FIX agent)* what changed, at `file:line`. Or
**Deferred** — *(if the fixer couldn't safely make it)* why, and what's needed.
```

ROOT-CAUSE writes everything down to **Verify fixed**. The **FIX** agent flips the
header to `### ☑` and appends the **Fixed** line (or leaves `### ☐` + **Deferred**).
**VALIDATE** then confirms the **Verify fixed** check actually passes on a fresh
server. Use `☐`/`☑` or `- [ ]` / `- [x]` — `- [ ]` is the safe GitHub-markdown
default.

## Worked example (excerpt)

```md
### ☐ [BLOCKER · bug] Subscribe is dead — clicking does nothing

**What's wrong** — On `/ui`, the "Subscribe" button renders but clicking it never
adds the email or shows feedback; nothing reacts.

**Evidence** — `fixes-evidence/subscribe-noop.png` (input unchanged after 3 clicks);
console clean; no island chunk for `subscribe` in the network log.

**Root cause** — `src/components/subscribe/` has a `template.html` with a
`(click)="add()"` binding but **no `logic.ts`**, so it's a *static* folder — it ships
zero JS and the `(event)` never fires. A folder is an island only if it has a
`logic.ts`.

**Fix** — Add `src/components/subscribe/logic.ts` (`defineComponent({ setup })`) that
owns the `add()` handler + signal state (and move the folder under `islands/` if you
group by convention) — see build → `references/component-model.md`.

**Verify fixed** — reload `/ui`, wait for hydration, click Subscribe → the email is
added and the confirmation appears; the network log shows the island chunk loaded;
console clean.

### ☐ [HIGH · perf] Row expand animates `height` — drops ~38% of frames

**What's wrong** — Expanding a table row stutters visibly; the longer the list, the
worse.

**Evidence** — `fixes-evidence/row-expand-jank.json`: dropped-frame 0.38, max frame
61 ms while expanding row 4 (1280×800, dev). One `long-animation-frame` of 72 ms.

**Root cause** — `src/islands/row/styles.css:44` transitions `height`
(`transition: height 240ms`), forcing layout + paint every frame for every row below it.

**Fix** — Animate `grid-template-rows: 0fr → 1fr` (or `transform: scaleY`) instead
of `height` (layout-property animations repaint every frame).

**Verify fixed** — re-run the jank recorder while expanding the same row → dropped
< 0.10, no `long-animation-frame` > 50 ms.
```

## Verification recipes

Pick the check that actually proves *this* issue is gone. Favor ones that drop
straight into the project's existing harness (Playwright story tests, `isolate`).

| Issue type | "Verify fixed" recipe |
|---|---|
| **Status code** (soft 404, auth bounce, API error code) | `curl -i <url> \| head -1` → expected status. The most reliable status proof; also the cheapest. |
| **Server write (optimistic) / rollback** | Playwright: interact → assert the UI updates instantly; force the `/api` call to fail → assert it rolls back + shows an error (no `location.reload()`). |
| **Dead island / hydration** | Drive it: `waitHydrated` then interact → assert the DOM value changed (a story test, or the island's `isolate/` case). Dead = no change. |
| **SSR / DI throw** | Reload; assert **no** unguarded-global or `DI does not cross the SSR/island boundary` throw in `browser_console_messages`, and the route is `200`. |
| **Component-level bug/regression** | `sprig isolate` (or run the case's `tests/*.spec.ts`) — the component's `isolate/` cases assert events/render in isolation (see build → `references/isolate.md`). |
| **Whole-story regression** | Add/restore the matching Playwright story test and run it against a **fresh** server (restart `sprig dev`, or `sprig build` → `sprig serve`). |
| **Perf (jank/CLS/INP/long task)** | Re-run the same `browser_evaluate` instrument under the same trigger; assert the number crossed back under threshold. State the conditions. |
| **Network (size/headers/waterfall)** | Re-check `browser_network_requests`: status, `transferSize`, `cache-control`, parallel vs serial. |
| **Backend live-vs-stub** | Assert the service returns `live:true` and the in-process `Backend` call is `ok`; confirm in the **prod build** (`sprig build` → `sprig serve`), where the env/store bugs surface. |
| **Env / secret leakage** | `grep -r "<secret>" static/` → no hits (secrets stay server-side; islands only get serialized `@inputs` / `/api` responses). |

A good verification is **specific and runnable**: a command with an expected
output, or an assertion that fails today and passes once fixed. "Check that it
works" is not a verification.
