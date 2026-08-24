## 2. Claude asset deployment (`skills.ts`)

`sprig install`/`update` deploy the `claude/` tree into user scope by
**whole-entry replace keyed by name**:

| Asset class | Source | Destination (override env) | Trigger / when |
|---|---|---|---|
| Skill folder | `claude/skills/<name>/` | `~/.claude/skills/<name>` (`CLAUDE_SKILLS_DIR`) | `sprig install`/`update`; one FOLDER per skill |
| Agent def | `claude/agents/<name>.md` | `~/.claude/agents/<name>.md` (`CLAUDE_AGENTS_DIR`) | `sprig install`/`update`; flat `.md` files |
| `interfaces/` | `claude/skills/interfaces/` | `~/.claude/skills/interfaces` (`CLAUDE_SKILLS_DIR`) | `sprig install`/`update`; shared cross-skill contracts, carried wholesale despite having no `SKILL.md` |
| `skills-latest` release asset | GitHub release asset (`sprig-skills*.tar.gz`, else the default-branch source archive) | `~/.claude/skills/<name>` (`CLAUDE_SKILLS_DIR`); one FOLDER per skill, same as row 1 | `installSkillsFromDeployment()` — pulled independently of the install/update flow above |

`installSkillsFromDeployment()` fetches that tarball, extracts it into a temp
dir, then calls the SAME `installSkills()` → `installSkill()` → `replaceEntry()`
loop as row 1 — one skill folder at a time. It does **not** `rm -rf` the whole
`~/.claude/skills/` dir: the replace sequence and all four Skip/halt guards
below apply per skill entry, exactly as for a local install, so sibling skills
not present in the fetched tarball are left untouched.

Replace, in order:
1. unlink the destination, if it's a symlink
2. `rm -rf` the destination
3. `cp -R` the source in

Skipped/halted before step 1 runs, for any of:
1. a skill subdir with no `SKILL.md` — skipped entirely, EXCEPT `interfaces/`
2. a destination containing `.git` — never touched; a dev symlink survives
3. a dotfile — skipped
4. no `~/.claude` on disk — skips cleanly, not an error

**Why replace, not merge**: whole-entry replace is what guarantees stray files a
user left inside a managed skill/agent are GONE after install rather than
silently kept alongside the shipped content — a merge strategy can't make that
promise. The `.git` guard exists so a symlinked dev checkout (which legitimately
holds files a plain replace would nuke) survives untouched. `interfaces/` is
exempt from the `SKILL.md` check because it isn't a skill — it's the shared
cross-skill contracts every skill folder assumes exist.

- Pinned by skills.test.ts: stray user files inside a managed skill are GONE after
  install; unrelated skills untouched; symlinked skills replaced without
  write-through.

**Golden path** — `sprig install` deploying `sprig:prototype`, in `~/.claude/skills/`:

Before:
```
sprig:prototype/
  SKILL.md
  assets/proto-host/_start.ts
  stray-notes.txt                             # left by the user; not shipped
sprig:audit/
  SKILL.md                                    # unrelated skill
dev-skill -> /Users/dev/checkout/dev-skill    # symlink; target contains .git
```

After:
```
sprig:prototype/
  SKILL.md
  assets/proto-host/_start.ts                 # stray-notes.txt is GONE
sprig:audit/
  SKILL.md                                    # untouched — different asset
dev-skill -> /Users/dev/checkout/dev-skill    # untouched — .git guard fires
```

Inventory: skills `sprig:audit`, `sprig:breakdown`, `sprig:build`, `sprig:design`,
`sprig:prototype` + `interfaces/` (README, design-system.md, prototype.md,
sprig-app.md, ui-breakdown.md); 14 agents (`sprig-audit-{fixer,hunter,root-cause,
validator}`, `sprig-breakdown-{analyst,capture,spec-writer}`,
`sprig-build-{analyst,component,scaffolder}`, `sprig-design-{author,deriver,
verifier}`, `sprig-prototype-builder`).

**`sprig:prototype` ships executable payloads, not just prose.** The inventory
above lists only family names + `interfaces/`, but a skill FOLDER is copied
verbatim — `installSkill` → `replaceEntry` = `cp -R` the whole dir (skills.ts:66,
§2's opening mechanism) — so everything under `claude/skills/sprig:prototype/`
lands in `~/.claude/skills/sprig:prototype/` with no separate step. Three payloads
ride along:
- **`design-lint/`** — a whole vendored, Deno-native UI anti-pattern linter
  (vendored from the "impeccable" project — github.com/pbakaus/impeccable),
  `cp -R`'d whole with the rest of `sprig:prototype` (~492K, Apache-2.0, entry
  `bin/detect.mjs`). Its engines, rule registry, and browser shim are internal to
  the payload — see its own `LICENSE`/`NOTICE`/docs, not this spec.
- **`assets/proto-host/`** — a copied generic Deno serving harness (`_start.ts` +
  `deno.json`, `deno task start`): the two-seam prototype host that serves the
  AI-authored HTML + `objects/*.json` read model + `commands.json` write contract
  (and an annotate overlay), knowing nothing app-specific.
- **`scripts/detect.mjs`** — a Node-shaped entrypoint the agent calls
  (`node .../scripts/detect.mjs --json <targets>`) that FORWARDS to design-lint's
  `bin/detect.mjs` — resolves it via `$DESIGN_LINT_BIN`/`$DESIGN_LINT_DIR` or by
  walking up for a sibling `design-lint/`, then invokes `deno run` so the
  import-map shim is in effect (design-lint is the single source of truth; the
  skill no longer ships its own engine copy).

**Guardrail sync**: every agent `.md` carries an auto-synced block — the shared
"never crawl the filesystem" guardrail (canonical source `scripts/agent-guardrail.md`)
— stamped verbatim between `<!-- BEGIN sprig-agent-guardrail: scripts/agent-guardrail.md -->`
/ `<!-- END sprig-agent-guardrail -->` markers, anchored just above each agent's
`## Never` heading (appended at end-of-file if that heading is absent). The
writer, `deno task sync:agent-guardrail`, is idempotent — re-running regenerates
the block in place from the canonical source, in every `claude/agents/*.md`. The
CI gate, `deno task check:agent-guardrail`, re-runs the same sync in `--check`
mode and exits 1, listing every agent `.md` whose block is stale or hand-edited,
without writing. Agents deploy as whole files (the replace rule above), so a
synced block travels intact to `~/.claude/agents/` on install — the block must
**never be hand-edited in-tree**; edit `scripts/agent-guardrail.md` and re-sync
instead. Fleet-economics rationale for why this exists: spec 10 §2.

**Release discipline** (README): any release changing a public runtime/compiler
surface must update the matching `claude/skills/*/references/*.md` + agent defs in
the SAME commit (measured failure: 112 tool calls reverse-engineering an undocumented
`ResolveCtx`).

