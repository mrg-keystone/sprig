## How to verify claims in these specs

Every numbered spec cites `file:line` anchors into the `main/` working tree
at version `0.20.36-beta.1` (`@mrg-keystone/sprig` on JSR). An anchor's
grammar is `relative/path:START` or `relative/path:START-END` — the path is
root-relative to the checkout (`framework/.sprig/core.ts`, not an absolute
path), and the range is the whole span the claim covers, not just its first
line. Most anchors in this spec set are ranges (`core.ts:190-256`); a bare
`START` anchors a single line. To verify an anchored claim:

1. Check out `main/` at `0.20.36-beta.1`.
2. `cd` into that checkout — every path and command below (`framework/…`,
   `packages/keep/…`, `app/…`) is relative to its root.
3. Open the cited file at the cited span and check it against the claim.
   Four outcomes, depending on what you're verifying and what you find:
   - **Anchor matches, correct checkout** — corroborated.
   - **Anchor mismatches, correct checkout** — a real discrepancy; the spec
     is stale and should be flagged.
   - **Anchor mismatches, wrong checkout** — not a discrepancy yet; confirm
     you're on `0.20.36-beta.1` first (a different checkout shows drift that
     isn't real), then re-verify.
   - **Named test (tier (a)) passes** — corroborated. **Fails** — before
     concluding the spec is wrong, distinguish a real discrepancy (behavior
     changed) from an environment/setup failure (wrong checkout, missing
     deps, a flaky run); rerun clean before flagging the spec.

Not every claim carries the same weight of evidence. There are three tiers:

- **(a) Named test — strongest.** The claim (or its subsystem's
  contract-checklist section) cites an exact test file. A passing run of
  that test corroborates the claim directly.
- **(b) Source anchor only.** The claim cites a `file:line` anchor and no
  test. Verify it by reading the anchor (step 3 above) — the bulk suites
  below exercise the module but don't isolate this specific claim.
- **(c) Bug ID only** (`#92`, `AE`, `AA/Z/AD`, …). The claim names the bug
  that motivated the rule but cites no test of its own. A bug ID is
  historical provenance — it explains *why* the rule exists — not
  independent evidence that the rule holds today. Treat a bug-ID-only claim
  as tier (b): fall back to its defining `file:line` anchor or spec
  section.

To verify a single behavioral claim, don't run a whole suite — find its named
test in that subsystem's contract-checklist section:
[01 §9](../01-core-runtime/09-9-behavioral-contracts-pinned-by-tests-must-survive-a-refact.md)
(core runtime), [02 §7](../02-template-compiler/08-7-contract-checklist-for-a-refactor-each-pinned-by-a-named-t.md)
(template compiler), [03 §10](../03-islands-and-hydration/10-10-contract-checklist-for-a-refactor.md)
(islands/hydration). Each item there names its pinning test, test family, or
— absent one — falls back to tier (c)/(b) above. The suites below run every
subsystem's tests in bulk; they corroborate the module as a whole but don't
tell you which command exercises any one claim:

```bash
deno test -A framework/.sprig/compiler/*.test.ts   # compiler unit tests (~60): spec 02 (parse/expr/render/mod/…)
                                                    #   plus spec 04's build.ts — both live under compiler/ per
                                                    #   00-overview §4 repo map. Spec 03's island.ts/hydrate.ts also
                                                    #   live under compiler/, but per 03 §10 no client-hydration
                                                    #   test suite exists yet for any of its five families — verify
                                                    #   spec 03 claims by source anchor (tier (b)) until one lands;
                                                    #   per 03 §10 it will land under framework/.sprig/ below, not
                                                    #   this glob.
deno test -A framework/.sprig/*.test.ts            # core runtime tests (spec 01); also where spec 03's client-
                                                    #   hydration suites will land, per 03 §10, once they exist
deno test -A packages/keep/*.test.ts               # composition tests (spec 06)
deno test -A app/spine.test.ts                     # workbench SSR/API spine (spec 07)
deno check framework/cli.ts                        # the sprig CLI (spec 05)
```

### Worked example

Verifying [01 §2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md)'s
injector scope-guard claim — "wrong-side resolution throws … DI does not
cross the SSR/island boundary" (`core.ts:190-256`, bug #92):

1. Check out `main/` at `0.20.36-beta.1` and `cd` into it.
2. Open `framework/.sprig/core.ts:190-256` and read the `#instantiate`
   method's ordering. Confirm the scope guard runs FIRST, before the
   presence-based cache, and throws the "Cannot inject … DI does not cross
   the SSR/island boundary" string on a wrong-side resolution — this is
   tier (b) evidence (source anchor; bug #92 alone would only be tier (c)).
3. Anchor matches → corroborated. Per 01 §9, this claim's tier (a) test is
   `injector.test.ts` *(to add — not yet present)*; once it lands, run it
   directly instead of re-reading the anchor.

The same three-step shape applies to any anchored claim: check out the
pinned version, open the cited span, and either read it (tier (b)/(c)) or
run its named test (tier (a)) per the subsystem's contract-checklist
section.

### Unanchored TARGET claims

A handful of sections describe a design TARGET rather than the as-built
tree — [06 §1](../06-keep-serving-composition/01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s
`Frontend` contract is the current instance, and its own heading and lead
note say so. Nothing has landed for these yet, so there is no `file:line`
to anchor into and none of the above applies. Verify a TARGET claim against
the target's own stated rules and its "Landed correctly when" checklist
(where the section has one), not a checkout. Once the target lands, the
section drops TARGET status and picks up ordinary `file:line` anchors like
any other claim.
