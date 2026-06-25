# interfaces/ — the contracts between pipeline stages

These files are the **only thing skills reference across their boundaries.** Each stage
reads its input contract and writes its output contract; **no skill names another skill, and
no skill reaches into another skill's files.** That decoupling is the point: rename, reorder,
or swap a stage and the contracts don't move.

## The pipeline

```
design ──► prototype ──► breakdown ──► build ──► audit
```

Strictly **linear** — each stage consumes **only** its immediate predecessor's output.

| Contract | Producer | Consumer | The artifact |
|---|---|---|---|
| [`design-system`](design-system.md) | design | prototype | `spec/ui/design-system/` — a brand-themed design-system folder |
| [`prototype`](prototype.md) | prototype | breakdown | `spec/ui/<app>-prototype.html` — one self-contained mock |
| [`ui-breakdown`](ui-breakdown.md) | breakdown | build | `spec/ui/breakdown/` — the build spec |
| [`sprig-app`](sprig-app.md) | build | audit | a running sprig app |

The first three artifacts share one home — **`spec/ui/`** at the project root — so each stage
finds its input at a known path (`design-system/`, `<app>-prototype.html`, `breakdown/`). The
`build` stage reads `spec/ui/breakdown/` and emits the app; `audit` exercises the running app.

## Rules

- **Contracts are named by the artifact, not the skill.** They reference pipeline **roles**
  (design / prototype / breakdown / build / audit), never a skill's directory name — so
  renaming a skill (`sprig:build`, `sprig:breakdown`, `sprig:audit`) touches dir names and
  frontmatter, **not** these contracts.
- **A skill references a contract by one stable relative path:** `../interfaces/<artifact>.md`.
  `interfaces/` is a sibling of every skill directory in **both** layouts — the dev checkout
  (`skills/<skill>/` ↔ `skills/interfaces/`) and the flat install
  (`~/.claude/skills/sprig:<skill>/` ↔ `~/.claude/skills/interfaces/`) — so the one path
  resolves either way.
- **Each skill's SKILL.md states only its edges:** "consumes `<X>`, produces `<Y>`," plus one
  thin "next stage" pointer. Everything about the artifact's *format* lives in the contract.
- A contract change is a **breaking change for both** its producer and its consumer — update
  both sides together.

## Install

The bundle installer copies this directory to `~/.claude/skills/interfaces/`, and the skills
install flat as `~/.claude/skills/sprig:<name>`, so the `../interfaces/` path resolves after
install exactly as in the dev checkout. The umbrella is a **`sprig:` name prefix** (a
`plugin:skill` namespace), not a subdirectory: Claude Code only discovers skills that are
**direct children** of `~/.claude/skills/`, so a nested `~/.claude/skills/sprig/<name>` would
never load.
