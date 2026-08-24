## 2. sprig's `spec/` obligations

**Conformance checklist** — one glance for 09 [§4](04-4-locked-invariants-sprig-s-half.md), 01
[§8](../01-core-runtime/08-8-spec-root-ts.md), 05
[§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md), and any other implementer:

| Obligation | Checkable rule (the observable violation) | Owner |
|---|---|---|
| Write discipline (steady state) | a write lands outside `spec/ui/**` or `spec/contract/binding.md` — exempts `sprig init`'s one-time neutral-skeleton writes (`deno.json`, `serve.ts`, the `spec/` skeleton, `spec/manifest.json`; see the `init` row below and 05 [§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md)) | owned here |
| Honor the manifest | a `durable` path is rewritten/renamed/deleted, a `merge` path shrinks, or an out-of-range `formatVersion` isn't refused | owned here |
| Root resolution (`.git` walk) | sprig's resolved `spec/` root diverges from `spec/tests/spec-root-vectors.json` | delegated — algorithm: [coordinate.md](../../coordinate.md); module: 01 [§8](../01-core-runtime/08-8-spec-root-ts.md) |
| Contract inputs (hash-stamped, derived) | `client/`'s stamped hash doesn't match `openapi.json`, or a missing/stale `contract/` doesn't refuse with a fix command | owned here |
| Never invoke another toolchain | any shell-out, import, or PATH probe to another toolchain, at build time or any other time | owned here |
| `sprig init` idempotent contributorship | a re-run mutates/removes an existing path, or `init` hard-fails on another toolchain's absence | delegated — gate: 05 [§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md) |

A composed app carries one `spec/` tree at its git root — the shared artifact every
toolchain builds from. The artifact contract itself no longer lives in this file and
is not restated here: **the artifact is self-describing**, and `spec/manifest.json` is
what sprig reads. sprig's obligations against it, as rules:

**Error policy.** Every sprig refusal against `spec/` — an out-of-range `formatVersion`,
a missing/stale `contract/`, a hash mismatch — is a **located error carrying its fix
command**: never a crash, never a silent fallback, never a live regeneration. The rules
below name what triggers a refusal; this is how every one of them fails, including cases
this list doesn't enumerate.

- **Write discipline (steady state).** Outside `sprig init`'s one-time
  neutral-skeleton writes (`deno.json`, `serve.ts`, the `spec/` skeleton,
  `spec/manifest.json` — 05
  [§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md)), sprig
  writes ONLY under **`spec/ui/**`** — checkable per producer:

  | producer/command | path written | contents |
  |---|---|---|
  | `sprig:prototype` | `spec/ui/<app>-prototype/` | `objects/<type>.json` + `commands.json` beside the presentation HTML (`claude/skills/sprig:prototype/SKILL.md:26-28`) |
  | `sprig:design` | `spec/ui/design-system/` | — |
  | `sprig:breakdown` | `spec/ui/breakdown/` | — |
  | annotate | `spec/ui/build-notes.json` | accumulated build notes (`merge` — grow-only) |

  `spec/contract/binding.md` sits in the same permitted zone but is
  HUMAN-authored: no `sprig:*` producer and no `sprig init` write creates or
  touches it — `init` does not scaffold a stub, so the file doesn't exist
  until a human writes it.

  Never under `spec/runes/`, never into the derived machine faces
  (`contract/{draft,openapi.json,client/}`), never scratch into `spec/`.
- **Honor the manifest.** sprig reads `spec/manifest.json` to discover the layout and
  `formatVersion` — it declares a supported range, refuses out-of-range per the error
  policy above — and honors the durability classes the manifest declares:

  | class | sprig's write policy | prohibited operation | example path |
  |---|---|---|---|
  | `durable` | never destructively rewritten/renamed/deleted — appends only, additive + idempotent | rewrite, rename, delete | `spec/runes/` (the durable canonical spec home) |
  | `merge` | only ever grows | any shrink or destructive replace | `spec/ui/build-notes.json` (annotate's accumulated notes) |
  | `derived` | regenerable machine output, treated as never-a-source-of-truth | hand-editing or authoring by hand | `spec/contract/openapi.json` + `spec/contract/client/` |
- **Root resolution — the `.git` walk.** sprig resolves `spec/` with the shared walk
  owned whole by [coordinate.md](../../coordinate.md); sprig's resolver is the
  published `specRootOf()` module, owned by 01
  [§8](../01-core-runtime/08-8-spec-root-ts.md). The golden vectors at
  **`spec/tests/spec-root-vectors.json`** (input tree → expected root) gate sprig's
  implementation in CI — divergence from any other implementer fails a test the day
  it lands. Scope: the walk governs `spec/` resolution ONLY — generated code,
  `static/` build output, per-package `deno.json`/lint roots, and the isolate
  workbench's `<appRoot>/src/**` scan all stay per-package.
- **Contract inputs are committed, hash-stamped, derived.** sprig consumes
  `spec/contract/openapi.json` + `spec/contract/client/` as COMMITTED `derived` files:
  `sprig:build` builds from them **with no other toolchain present**, and verifies the
  hash `client/` is stamped with against `openapi.json`. A mismatch, or a missing/stale
  `contract/`, refuses per the error policy above — e.g. "client is from openapi@abc,
  spec has openapi@def — regenerate" (the old live-refresh in
  `claude/skills/sprig:build/SKILL.md:68-69,236-237` and `references/serving.md:60-64`
  is exactly what this severs). Regeneration is an explicit step run wherever the
  producer lives.
- **sprig never invokes another toolchain.** No shell-out, no import, no PATH probe —
  at build time or any other time. The frontend builds from `spec/` alone.
- **`sprig init` is an idempotent contributor.** The composed app is its **own** git
  repo; `sprig init` contributes to it: the UI half, plus the neutral skeleton — the
  workspace `deno.json`, `serve.ts`, the `spec/` skeleton, `spec/manifest.json` —
  **when absent**. Re-runs are no-ops on what exists; whichever toolchain's `init`
  runs first lays the skeleton and later ones fill only their half; `sprig init`
  **never hard-fails on anything else's absence**.

