## 3. Docs-move-with-the-API release discipline (from `README.md`)

This driver names the problem; DX-IDEAL [§3.8](../DX-IDEAL/04-3-per-subsystem-ideal.md)
owns the fix — the publish-blocking release-lint. 08 [§6](../08-install-skills-annotate/06-6-refactor-notes.md)
item 6's onboarding-docs tension (stale Vite/Fresh-era `docs/guide.md`) routes here.

A measured failure: releasing `0.20.29` with an undocumented `ResolveCtx` sent build
fleets reverse-engineering the Deno cache (112 tool calls). The release checklist is now:

1. If a release changes any public runtime/compiler surface (`core.ts` exported types,
   template semantics, the isolate CLI's flags or report shape), the SAME commit must
   update the matching `claude/skills/*/references/*.md` and agent defs, and any
   user-facing doc describing that surface (`docs/guide.md`, `cli/README.md`) —
   agent-facing and user-facing docs both move with the API, not just the former.
2. Run framework + runner tests and `deno check cli/main.ts`.
3. Spot-check `claude/skills/sprig:build/references/` examples still typecheck.

The checklist above is interim, not the target: it relies on a human remembering to
update docs in the same commit as the surface change — itself the silence this whole
document exists to remove, the same failure mode DX-IDEAL [§3.9](../DX-IDEAL/04-3-per-subsystem-ideal.md)
resolves everywhere else with "detect drift by a hash/typed signal, not by a human
remembering." Land the lint: DX-IDEAL [§3.8](../DX-IDEAL/04-3-per-subsystem-ideal.md)
designs the resolution — a publish-blocking surface-vs-docs lint comparing the
full public-surface enumeration from item 1 above (`core.ts` exported types,
template semantics, the isolate CLI's flags/report shape) against same-commit
doc changes, folded into the same agent-fleet-economics gate
(spec 10 [§2](02-2-agent-fleet-economics-from-optimize-md-feedback.md)). The
implementation ticket is tracked as C1 in `feedback/plan.md`.

