## 2. Agent-fleet economics (from `optimize.md` + `feedback/`)

The repo is explicitly designed to be **driven by Claude agent fleets** (the `claude/`
skills+agents are deployed on `sprig install`). Forensic analysis of ~116K API requests
found fleets burning most spend across five waste classes (table below). A 40-agent
`sprig:build` fleet paid **608M input tokens** for 1.49M output.

Standing principles now embedded across `claude/` (must survive a refactor of those
assets), each tied to the waste class it kills and where it's enforced:

| Constraint | Waste class it kills | Enforcement home |
|---|---|---|
| 1. Brief completely — agents never search; missing path → `blocked`, never hunt. | Filesystem discovery | Convention only, no gate |
| 2. Facts inline (≤8 lines), bulk behind on-disk artifacts structured for partial reads. | Broadcast megaprompts | Convention only, no gate |
| 3. Verified recipes (lifted from passing fixtures) in high-volume agent defs. | Validator explosions | Machine-gated — `ran:false` tripwire, `cli/commands/test.ts` (spec 07 §2) |
| 4. Receipt verification — a tool's own printed/JSON output IS the state; never re-verify. | Validator explosions | Machine-gated — import-time console guard, `cli/lib/json-stdout.ts` |
| 5. Orchestrators end turn after spawning; never sleep-poll; never search the filesystem. | Poll-sleeping | Convention only, no gate |
| 6. Concurrency 4–6, chunked waves, one PORT per agent. | Retry storms | Convention only, no gate |
| 7. Model pins on fleet roles (never `inherit` except deliberate judgment/creative roles). | Retry storms | Convention only, no gate |
| 8. Accuracy outranks tightness — never suppress a search without a more authoritative replacement; doc-reality drift is a discovery *generator*. | Filesystem discovery | Machine-gated — `check:agent-guardrail` gate + deploy, [08 §2](../08-install-skills-annotate/02-2-claude-asset-deployment-skills-ts.md) |

Direct product consequences already shipped (see `feedback/plan.md`):
- `cli/lib/json-stdout.ts` — first-import console guard so `--json` stdout is exactly one
  JSON document (import-time boot logs go to stderr). Before: a boot log line lands on
  `--json` stdout ahead of the receipt → a fleet's receipt parse fails and records false
  state. After: the guard routes that same log line to stderr → stdout stays exactly one
  document.
- Headless test dialect + `ran:false` tripwire — enforced in `cli/commands/test.ts`
  (spec 07 §2).
- Guardrail sync — writer, `check:agent-guardrail` gate, and deploy mechanics live in
  [08 §2](../08-install-skills-annotate/02-2-claude-asset-deployment-skills-ts.md), which
  points back here for the rationale: a 40-agent fleet can't tolerate hand-edited,
  divergent per-agent guardrails — N drifting copies are the same accuracy-drift waste
  principle 8 above exists to kill.

