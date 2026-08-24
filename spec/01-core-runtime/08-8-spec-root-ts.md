## 8. spec-root.ts

`specRootOf(startDir)` (`framework/.sprig/spec-root.ts:27-36`) walks up to the nearest
ancestor containing a `.git` entry (**dir OR file** — worktrees) and returns it, else the
start dir. It is one of three `spec/`-resolution mechanisms across the sprig/rune ecosystem
— two of them literally named `spec-root.ts`, one per repo — that must not be conflated:

| resolver | repo / path | mechanism | returns | must `.git`-walk? | why |
|---|---|---|---|---|---|
| sprig `specRootOf` | `framework/.sprig/spec-root.ts:27-36` (this repo) | `.git`-walk | the nearest `.git`-ancestor dir (dir or file), else the unchanged start dir | yes | this section's own resolver — see the shared-walk contract below |
| keep `fixturesDir()` / `resolveFixturesDir` | `fixtures-store/mod.ts` (rune/keep repo) | the same `.git`-walk, plus an env override and a `spec/misc` fallback chain | `<gitRoot>/spec/misc`, falling back to `<cwd>/spec/misc` → legacy `<cwd>/fixtures`; `KEEP_FIXTURES_DIR` overrides all of it | yes | must land on the same `.git` ancestor sprig does, or a monorepo's two halves resolve to different `spec/` dirs and the shared contract splits — but only the walk step is shared/golden-gated, not the env override or the fallback chain |
| rune `resolveRoot` | `src/rune/entrypoints/spec-root.ts:22-33` (a **different repo**) | spec-PATH hop — two levels up from a `spec/runes/foo.rune` path | `<root>`, the dir `spec/` lives directly under | **NO** | rune's own in-repo fixtures live under the repo's `.git`; a `.git`-walk here would resolve to the repo root and emit codegen into the real `src/`. The spec-PATH hop already lands on the git root when `spec/` is a git-root sibling, so a walk is neither needed nor safe |

sprig's resolver must stay byte-identical to keep's on the shared `.git`-walk step only
(input tree → expected root) — not the whole `fixturesDir` function, which layers an env
override and a fallback chain sprig's resolver has no equivalent of. The shared walk
contract is owned by `coordinate.md` and restated in
`../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md`, gated by golden vectors.

**Acceptance criteria** (gated by the golden vectors at `spec/tests/spec-root-vectors.json`,
input tree → expected root):
- A `.git` DIRECTORY ancestor resolves to that ancestor.
- A `.git` FILE ancestor (a worktree checkout) resolves identically to a directory ancestor.
- An input with no `.git` ancestor anywhere in its parent chain returns the start dir
  unchanged.
- On every vector, sprig's resolved root equals keep's `.git`-walk result — the conformance
  gate.

Not re-exported from core, and not a public importable export at all: per
[01 §1](01-1-public-api-surface-all-of-mrg-keystone-sprig.md#internal-but-must-survive) it
ships as internal `publish.include` bytes — reachable so the CLI can run it, not importable
by an app author — and is free to be renamed or restructured internally in a refactor.

