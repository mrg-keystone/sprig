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
| 1 | blocker | bug | Unknown slug returns 200 (soft 404) | routes/blog/[slug].tsx |
| 2 | high | perf | Row-expand animates height (drops frames) | islands/Row.tsx |
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

**Root cause** — `path/to/file.tsx:LINE` — the mechanism, proven from the code (a
short quote of the offending line earns its place). Name the backend file if the
cause is server-side.

**Fix** — the concrete change, anchored to the canonical pattern: "throw
`HttpError(404)` … see build → `references/advanced/error-handling.md`." Not
"handle the error better."

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
### ☐ [BLOCKER · bug] Subscribe island is dead — clicking does nothing

**What's wrong** — On `/`, the "Subscribe" button renders but clicking it never
adds the email or shows feedback; the whole page's interactivity is gone.

**Evidence** — `fixes-evidence/subscribe-noop.png` (count stayed 0 after 3 clicks);
console: `Failed to resolve module specifier "fresh-island:Subscribe.tsx"`.

**Root cause** — `islands/Subscribe.tsx` was added while `deno task dev` was
running, so the island registry drifted and the client entry emitted a bare
`fresh-island:Subscribe.tsx` specifier. The browser reads `fresh-island:` as a URL
scheme → 404 → **no island on the page hydrates** (one bad specifier takes them
all down). The source is correct; the running server is stale.

**Fix** — Restart the dev server (`deno task dev`); for CI/preview, test the prod
build. Adding an island/route file always needs a restart — see build →
`references/playwright-and-dev-loop.md`.

**Verify fixed** — reload `/`, click Subscribe → the count increments and the
confirmation appears; `browser_console_messages` shows no `fresh-island:` error;
`curl -s localhost:8000/ | grep -c 'fresh-island:'` → `0`.

### ☐ [HIGH · perf] Row expand animates `height` — drops ~38% of frames

**What's wrong** — Expanding a table row stutters visibly; the longer the list, the
worse.

**Evidence** — `fixes-evidence/row-expand-jank.json`: dropped-frame 0.38, max frame
61 ms while expanding row 4 (1280×800, dev). One `long-animation-frame` of 72 ms.

**Root cause** — `islands/Row.tsx:44` transitions `height` (`transition: height
240ms`), forcing layout + paint every frame for every row below it.

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
| **Form PRG / redirect** | Playwright: submit → `waitForURL("**/thanks")`; or `curl -i -X POST … \| grep -i location` → `303`. |
| **Dead island / hydration** | Drive it: interact → assert the DOM value changed (a story test, or `isolate test` on the island's case). Dead = no change. |
| **Hydration mismatch** | Reload; assert **no** `Expected server HTML` warning in `browser_console_messages`. |
| **Component-level bug/regression** | `deno run -A jsr:@mrg-keystone/isolate test --root .` — the component's `isolate/` cases assert events/render in isolation (see build → `references/isolate.md`). |
| **Whole-story regression** | Add/restore the matching `tests/user_stories.test.ts` step and run it against a **fresh** server (build → `playwright-and-dev-loop.md`). |
| **Perf (jank/CLS/INP/long task)** | Re-run the same `browser_evaluate` instrument under the same trigger; assert the number crossed back under threshold. State the conditions. |
| **Network (size/headers/waterfall)** | Re-check `browser_network_requests`: status, `transferSize`, `cache-control`, parallel vs serial. |
| **Backend live-vs-stub** | Assert the adapter returns `live:true` and the in-process `fetch` is `ok`; confirm in the **prod build** (`deno task build` → `deno serve`), where the env/store bugs surface. |
| **Env / secret leakage** | `grep -r "<secret>" _fresh/` → no hits; island reads the expected `FRESH_PUBLIC_*` value. |

A good verification is **specific and runnable**: a command with an expected
output, or an assertion that fails today and passes once fixed. "Check that it
works" is not a verification.
