# The ideal sprig — a best-DX target

> This document describes the **perfect version of sprig judged by developer
> experience** — for the human building apps with it AND the Claude agent fleets
> it is designed to be driven by. It is deliberately written in terms of *the
> ideal*, not the current implementation. Where it names current behavior, it is
> only to make the target legible; the specs `00`–`10` are the as-built ground
> truth, this is the north star a refactor should steer toward.
>
> Convention: **[CLEAR WIN]** = the ideal is strictly better, ship it.
> **[FORK]** = a genuine product/architecture choice with real tradeoffs; the
> doc states the options and a recommended default, but a human must decide.
> A status suffix overrides the base tag's implied action: **[CLEAR WIN —
> MET]** (and variants — "MET by removal", "advanced by cy-deno") = already
> realized, nothing left to build, kept in the record as the decision trail.
> An **AGREED (coms.md, ‹date›)** annotation on a **[FORK]** = that choice is
> already ratified — don't re-open it; only sub-bullets not so annotated are
> still open. Every ideal must (i) name the concrete DX pain it removes, (ii)
> be achievable within sprig's genuinely-good invariants, and (iii) preserve
> them.

