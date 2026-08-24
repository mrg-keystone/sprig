## 5. History — the closed cross-framework negotiation (LEGACY era)

> **LEGACY ERA.** Brand names below are as-built history, clearly marked — never live
> contract. This file previously specified the sprig ⇄ rune "diamond" (the two-track
> pipeline), the `KeepApi`/`bootstrapServer` runtime seam, the two-channel table, and
> the negotiated `spec/` artifact model as a cross-framework negotiation between two
> frameworks that compose without knowing each other. That negotiation is closed, and
> its results are restated framework-locally — the runtime seam's Today/Target status
> lives in [§1](01-1-the-composition-seam.md), the `spec/` artifact's CURRENT state in
> [§2](02-2-sprig-s-spec-obligations.md). What follows is that settled record. The
> coordination files that governed the negotiation (`coms.md`, `coordinate.md`,
> `contract.md`) are themselves LIVE, not retired — see below.

**Settled — the cross-framework negotiation.**

- **Provenance.** The retired era was governed by three rune-owned repo-local docs
  (`coms.md` runtime seam, `coordinate.md` spec-anchoring, `contract.md` waist) plus
  the neutral coordination thread `tooling/coms.md` (2026-07-18), where the artifact
  model (durability manifest, never-mutate-durable, hash-stamped derived files, golden
  vectors, own-repo + idempotent `init`s) and the composition seam (the third-arg
  hook) were agreed cross-repo before being restated framework-locally.
- **Rulings on record**, restated framework-locally:

  | Ruling | As-built (retired era) | Resolution + date | Status | Live home now |
  |---|---|---|---|---|
  | Q1 — keep's Fresh-era exports | `embed`, `EmbeddableBackend`, `KeepState`, `EmbedContext` | Deleted; only `withBasePath` survived | Closed | — |
  | Q2 — backend package name | `@mrg-keystone/keep` (abandoned) | Republished as `@mrg-keystone/rune`; sprig retargeted | Closed | — |
  | Q3 — `rune init` scaffold composition | Hard dependency on the sprig CLI being installed | `overlayRuneBackend()` overlays rune's backend onto sprig's scaffold layout (unit-tested against a fixture sprig scaffold); CLI dependency severed, `init` became artifact-first — +2026-07-04, +2026-07-18 | Closed | [§4](04-4-locked-invariants-sprig-s-half.md).6 (invariant origin); [§2](02-2-sprig-s-spec-obligations.md) (contributorship rule) |
  | Built-in auth | `/auth` gateway + `auth.ts` client; in-process trust key (`x-danet-internal`/localhost-trust) | Removed 100% — but only once the `Frontend` contract lands — user ruling, 2026-07-18 | **GATED — not done.** `/auth` gateway + `auth.ts` client still live; TARGET (06 [§1](../06-keep-serving-composition/01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)) not yet built | 06 [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md) (as-built gateway record + transferred Secure-cookie rule) |
  | Spec-move — `spec/runes/` durability | rune's `sync` `Deno.rename`d `spec/runes/<m>.rune` into its generated code tree, emptying `spec/runes/` after a build | `spec/runes/` is the durable canonical home sync never relocates — resolved 2026-07-18 | Closed | `claude/skills/sprig:breakdown/SKILL.md:55-56,138-139` |
  | Dual `@mrg-keystone/sprig` pin | sprig's side a frozen literal, once stale at `^0.2.0` and effectively broken | sprig's side moved to auto-derived; rune's (`init/mod.ts` `SPRIG_IMPORTS`) stays a manually-bumped literal | Standing hazard — closed on sprig's side, open on rune's | [§4](04-4-locked-invariants-sprig-s-half.md).6 |
  | Dev loops | — | `rune dev` stays backend-only; `sprig dev` is the composed UI loop — two intentional paths | Closed | — |

**Settled — the coordination files are live, not retired.**

`coms.md`, `coordinate.md`, and `contract.md` are LIVE, rune-owned cross-repo
coordination docs — they are not part of the retired record above. §2–§4 is sprig's
framework-local restatement of its own half of those docs, not a retirement of the
shared originals. Evidence: `contract.md` is the current waist keystone ("Do not break
it without updating both sides + this doc"; decisions D-waist/D-kinds/D-history/D-home
are all LOCKED), `coordinate.md` carries an append-log entry dated 2026-07-18 and is
modified in the working tree, and both are explicitly "between the rune/keep repo and
the sprig repo." This settles the framing consistently in the three places it touches
— the repo map, the three-products list, and invariant 7 — all three now read LIVE, not
retired.
