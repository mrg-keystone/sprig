# 09 — sprig's external obligations

> This file states what sprig promises the outside world — **as simple rules,
> self-contained** — without knowing who is on the other side. Counterparts appear as
> ROLES (whatever composes sprig; a backend toolchain; a client generator), never as
> named frameworks: sprig works with anything that honors the same artifact and seam
> rules. No live sentence here names another framework or links another framework's
> spec; the History section (§5) is the clearly-marked legacy record of the retired
> cross-framework coordination this file used to carry.

## 1. The composition seam

**Today**, sprig's seam with the outside world is spec 06 §2–§4's `serveSprig`/
`sprigUi`/`KeepApi` composition — the `base`-prefixed dispatch table (`/api/*`,
`/docs*`, `/auth/*`, everything-else→SSR) described there is what a composed app
actually runs.

**The target** this is meant to narrow to is spec 06 §1's **`Frontend` handler**, not
yet built: a complete, directly-servable `(req: Request, info?, backend?: { fetch:
typeof fetch }) => Response | Promise<Response>` app, where the optional fetch-shaped
**third argument** — provided per request by whatever composes sprig — would be the
whole of it. Everything else (root-not-`/api/*`, the request-scoped binding,
fail-loud standalone, no imports either direction) is
[06 §1](06-keep-serving-composition.md)'s four rules; once landed there would be
nothing beyond that seam.

## 2. sprig's `spec/` obligations

A composed app carries one `spec/` tree at its git root — the shared artifact every
toolchain builds from. The artifact contract itself no longer lives in this file and
is not restated here: **the artifact is self-describing**, and `spec/manifest.json` is
what sprig reads. sprig's obligations against it, as rules:

- **Write discipline.** sprig writes ONLY under **`spec/ui/**`** (`sprig:prototype` →
  `spec/ui/<app>-prototype/` with `objects/<type>.json` + `commands.json` beside the
  presentation HTML, `claude/skills/sprig:prototype/SKILL.md:26-28`; `sprig:design` →
  `spec/ui/design-system/`; `sprig:breakdown` → `spec/ui/breakdown/`; annotate →
  `spec/ui/build-notes.json`) **and `spec/contract/binding.md`** (the one hand-authored
  contract prose). Never under `spec/runes/`, never into the derived machine faces
  (`contract/{draft,openapi.json,client/}`), never scratch into `spec/`.
- **Honor the manifest.** sprig reads `spec/manifest.json` to discover the layout and
  `formatVersion` — it declares a supported range and **fails loud out-of-range** with
  a located error — and honors the durability classes the manifest declares:
  **`durable`** paths are never destructively rewritten/renamed/deleted (appends only,
  additive + idempotent), **`merge`** paths only ever grow, **`derived`** paths are
  regenerable machine output sprig treats as never-a-source-of-truth.
- **Root resolution — the `.git` walk.** sprig resolves `spec/` with the shared walk,
  stated whole:
  1. start at the anchor dir;
  2. walk parent-ward to the nearest ancestor containing a `.git` entry — **dir OR
     file** (worktrees use a file);
  3. resolve `<that ancestor>/spec/`;
  4. no `.git` ancestor → fall back to the start dir.

  The golden vectors at **`spec/tests/spec-root-vectors.json`** (input tree → expected
  root) gate sprig's implementation in CI — divergence from any other implementer
  fails a test the day it lands. sprig's resolver is `specRootOf()`
  (`framework/.sprig/spec-root.ts:27-36`; no-`.git` → returns the START dir per
  spec-root.ts:33), a published module; the load-bearing path is
  `framework/cli.ts:1666-1668` → `makeAnnotate` → `<specRoot>/spec/ui/build-notes.json`
  (`annotate.ts:160`). `sprig:breakdown`'s separate `git rev-parse --show-toplevel`
  (`claude/skills/sprig:breakdown/SKILL.md:59-60`;
  `claude/agents/sprig-breakdown-analyst.md:33`) collapses into this one walk. Scope:
  the walk governs `spec/` resolution ONLY — generated code, `static/` build output,
  per-package `deno.json`/lint roots, and the isolate workbench's `<appRoot>/src/**`
  scan all stay per-package.
- **Contract inputs are committed, hash-stamped, derived.** sprig consumes
  `spec/contract/openapi.json` + `spec/contract/client/` as COMMITTED `derived` files:
  `sprig:build` builds from them **with no other toolchain present**, verifies the
  hash `client/` is stamped with against `openapi.json`, and **fails loud on mismatch
  with the fix command** — "client is from openapi@abc, spec has openapi@def —
  regenerate". A missing/stale `contract/` is a located error carrying its fix, never
  a crash and never a live generation (the old live-refresh in
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

## 3. The waist rule — sprig's half

sprig UIs read via **queries** (current-state DTOs) and write ONLY by firing
**command verbs** — the UI optimistically reflects the intent and reconciles against
the next read. A sprig UI **never constructs an "edit-this-record" round-trip**: no
fetch-record → mutate-fields → PUT/PATCH-it-back flow anywhere in a sprig-built app.
The command vocabulary sprig emits is **LOCKED** at five kinds —
`create | set | append | adjust | remove` — and extending it is a breaking contract
change, not a patch.

The seams are born in the prototype and hold all the way down: `sprig:prototype`
declares the read model as `objects/<type>.json` and the write contract as
`commands.json` (`{ type, kind, input, does }`, + `field`/`by` where the kind needs
them) beside a presentation-only HTML, served by a generic host that keeps the
contract introspectable (`GET /objects` + `GET /commands`; applied commands append to
`events.json` — the log is the source of truth, the projection derived). Downstream,
`sprig:breakdown` binds each component's data-need to a ratified query/command in
`spec/contract/binding.md` — drift is a breakdown-time error — so everything below the
read/write surface stays invisible to the UI: storage can reshape freely without
changing what the UI sees, because the UI only ever fires intent and reads state.

## 4. Locked invariants — sprig's half

What a sprig refactor must NOT silently change:

1. **The `Frontend` contract** (06 §1, the refactor TARGET — not yet built): once
   landed, its shape must not drift — the handler type, root-and-never-`/api/*`, the
   optional fetch-shaped third argument as the ENTIRE seam, fail-loud standalone, no
   backend-framework imports.
2. **The request-scoped `Backend` DI token**: bound per request from the third
   argument via `backendClient` — never a singleton; client-side `inject(Backend)`
   throws by design (06 §1 Rule 2).
3. **The `spec/` obligations** (§2): the write discipline; manifest honor + the
   `formatVersion` fail-loud handshake; committed hash-verified contract inputs with
   the located-error-plus-fix on mismatch; never invoking another toolchain; the
   idempotent `init` contributorship.
4. **The waist rule** (§3) and the five-kind command vocabulary.
5. **The golden-vector-gated `.git` walk** (§2): any change to the walk (or its
   documented fallback) must keep `spec/tests/spec-root-vectors.json` green for every
   implementer; the walk's scope stays `spec/`-only.
6. **The scaffold surface + sprig's version pin**: `sprig init`'s emitted layout is a
   stable surface others overlay byte-compatibly — changing what it emits is a
   breaking change to announce, never slip. sprig's own `@mrg-keystone/sprig` pin is
   AUTO-DERIVED — `init` pins EXACT `cliVersion()`, with `sprigRange()`'s
   `^<cliVersion>` (else `^0.19.0`) only as a fallback; no `SPRIG_RANGE` constant
   remains in `framework/cli.ts` (spec 05 §1). `reflect-metadata` stays pinned EXACT
   (`0.1.13`) in scaffolds — a range double-loads the Reflect polyfill and wipes
   decorator metadata.

## 5. History — the retired cross-framework record (LEGACY)

> **LEGACY.** Brand names below are as-built history, clearly marked — never live
> contract. This file previously specified the sprig ⇄ rune "diamond" (the two-track
> pipeline), the `KeepApi`/`bootstrapServer` runtime seam, the two-channel table, and
> the negotiated `spec/` artifact model as a cross-framework negotiation. All of that
> left the live text under the ruling that the frameworks compose without knowing
> each other: the `spec/` artifact became self-describing via `spec/manifest.json`
> (§2) — that part is CURRENT. The runtime seam's collapse to 06 §1's third-argument
> rule is the TARGET §1 describes, not yet landed; the `KeepApi`/`bootstrapServer`
> composition (06 §2–§4) remains the live, current seam until it lands.

- **Provenance.** The retired era was governed by three rune-owned repo-local docs
  (`coms.md` runtime seam, `coordinate.md` spec-anchoring, `contract.md` waist) plus
  the neutral coordination thread `tooling/coms.md` (2026-07-18), where the artifact
  model (durability manifest, never-mutate-durable, hash-stamped derived files, golden
  vectors, own-repo + idempotent `init`s) and the composition seam (the third-arg
  hook) were agreed cross-repo before being restated framework-locally.
- **Resolved rulings on record.** Built-in auth: removed 100%, but only once the
  `Frontend` contract (06 §1) lands (user ruling, 2026-07-18) — today the `/auth`
  gateway and `auth.ts` client are still live; the as-built gateway record and the
  transferred Secure-cookie `[DECIDE]` live in 06 §4; the in-process trust key
  (`x-danet-internal` / localhost-trust) drops with it once landed. The spec-move: rune's `sync` once
  `Deno.rename`d `spec/runes/<m>.rune` into its generated code tree, leaving
  `spec/runes/` empty after a build; resolved 2026-07-18 — `spec/runes/` is the
  durable canonical home sync never relocates (why `sprig:breakdown` can rely on
  reading `spec/runes/*.rune` as durable ratified-contract input,
  `claude/skills/sprig:breakdown/SKILL.md:55-56,138-139`).
- **Locked decisions of the era (still true as history).** Q1: keep's Fresh-era
  exports (`embed`, `EmbeddableBackend`, `KeepState`, `EmbedContext`) deleted; only
  `withBasePath` survived. Q2: the backend package published as `@mrg-keystone/rune`
  (sprig retargeted from the abandoned `@mrg-keystone/keep` name). Q3 (+2026-07-04,
  +2026-07-18): `rune init` scaffolds the composed app by overlaying its backend onto
  sprig's scaffold layout (`overlayRuneBackend()` is unit-tested against a fixture
  sprig scaffold — the origin of invariant §4.6); the 2026-07-04 hard dependency on
  the sprig CLI being installed was severed 2026-07-18 (init became artifact-first —
  now §2's contributorship rule). The dual `@mrg-keystone/sprig` pin: rune's is a
  LITERAL (`init/mod.ts` `SPRIG_IMPORTS`) bumped manually on breaking sprig releases,
  sprig's is auto-derived (§4.6) — a standing hazard; sprig's side, then still a
  frozen literal, was once stale at `^0.2.0` and effectively broken. Dev loops:
  `rune dev` stayed backend-only; the composed UI dev loop is `sprig dev` — two
  intentional paths.
