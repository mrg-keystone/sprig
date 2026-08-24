## 1. The organizing principle: split the error philosophy by mode

sprig applies one rule everywhere: *never throw at runtime, degrade silently*
(unquote never throws, entity decode never throws, unknown pipe passes through,
unknown identifier → `undefined`, dead syntax renders nothing, a caught error
becomes a bare 500). Not every item on that list is the same kind of silence,
and the ideal treats them differently:

- **Mistake-masking silences** — a typo'd pipe name, an undefined scope
  identifier, dead/inert syntax (`*ngIf`, an eagerly-rendering `@defer`) — are
  the framework silently accepting something the developer almost certainly got
  wrong. Silence is the worst possible response to these, and they are what the
  mode split below targets.
- **Legitimate leniency** — `unquote` never throwing on a malformed escape,
  entity decode never throwing on an unrecognized entity — is CORRECT behavior
  on CORRECT content, not a masked mistake: browsers render an unknown entity
  like `&notreal;` as literal text, and templates legitimately contain bare
  `&`. Loud-failing these would flood the dev overlay with false positives on
  templates that are working exactly as authored. They stay quiet in every
  mode, in dev and in prod alike.
- **Already-happened runtime errors** — a caught error becoming a bare 500 —
  are neither a masked mistake being silently accepted nor legitimate
  tolerance of correct content; the failure already occurred and was caught.
  This bucket doesn't get *silenced*, it gets *split by mode on how much of
  the failure to show*: dev renders the real error + stack + phase, prod
  keeps the opaque 500 body. See below.

That rule is **correct for production SSR's per-request runtime path** (never
500 a page over a mistake it has no way to detect at that point) but is
**wrong wherever the mistake is detectable earlier** — at build or wiring
time, in every mode, not just for the authoring loop.

**The ideal makes mistake-masking silences loud, by whichever mechanism fits
how early the mistake is detectable:**

- **Structurally detectable before a request ever runs → an error in EVERY
  mode.** A typo'd pipe name or parseable-but-inert syntax like `*ngIf`
  fails the build itself ([§3](04-3-per-subsystem-ideal.md).2) — there is one build for dev and
  prod, so a build error never ships either bundle. `@defer`'s eager-render
  inertness gets the same treatment, just via a FORK on the mechanism
  (implement it for real, or reject it as a build error too) — either way,
  shipping it half-parsed with no signal is not an option ([§3](04-3-per-subsystem-ideal.md).2). A
  fail-open grant, an unresolved route `load`/`guards` entry, or a
  `StateService` key collision fails at `bootstrap()`'s wiring time
  ([§3](04-3-per-subsystem-ideal.md).1) — the same wiring code runs in prod, so these throw in prod
  too, not just dev. Production does **not** stay silent-degrade for these;
  it fails closed.
- **Detectable only per-request, at runtime, with no build-time or
  wiring-time detector, IF templates stay dynamically typed** (an unknown
  scope identifier resolving to `undefined` is the remaining case on the
  opening list with no earlier catch point) — these are what actually split
  by mode. This holds only under today's dynamically-typed templates;
  [§3.2](04-3-per-subsystem-ideal.md) proposes a per-component `.d.ts`
  binding every interpolation to `logic.ts`'s scope type so `deno check`
  catches `{{ user.naem }}` at build — if that path is taken, a top-level
  unknown identifier moves into the structurally-detectable, fail-closed-in-
  prod bucket above instead of this one. §3.2 itself requires staying
  dynamically typed to be an explicit, stated choice rather than a silent
  default; this remainder-bucket treatment is only correct for as long as
  that choice stands. Dev becomes loud-fail-with-location: gated on the
  existing `cfg.hmr` dev flag, they emit a diagnostic naming the component
  folder, the `template.html:line`, the phase, the cause, and a fix hint.
  Production keeps degrading silently for exactly this remainder —
  byte-identical bundle, no behavior change, no stack leaks (preserves
  invariant 4) — because there is no earlier, loud-without-guessing point to
  catch it under dynamic typing.
- **A caught runtime error (the bare 500)** mode-splits the same way but on
  the response body itself, not just on a diagnostic: dev renders the real
  error + stack + phase into the page, prod's body stays the opaque string
  ([§3](04-3-per-subsystem-ideal.md).1 "the 500 names its phase"). This is mode-splitting an
  already-happened failure, not leaving a masked mistake silent.

The legitimate-leniency paths above are exempt from all of this — they stay
quiet in every mode, in dev and in prod alike.

"Gated on `cfg.hmr`" is a runtime condition, not a bundle-inclusion decision.
Invariant 4 ([§6](07-6-what-must-not-change-the-good-dx-to-protect.md)) is byte-for-byte: the dev bundle IS the prod bundle, and
dev behavior comes from the existing data flags/env ONLY, never from bytes
that differ between the two. This diagnostics layer follows that invariant
exactly — the diagnostic code (much of it living in `hydrate.ts`: props-bridge
validation [§3](04-3-per-subsystem-ideal.md).3, hydration-failure stamping [§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).3/[§3](04-3-per-subsystem-ideal.md).3, soft-nav fallback
logging [§3](04-3-per-subsystem-ideal.md).3, the render-count badge [§3](04-3-per-subsystem-ideal.md).3, directly inside the per-island
chunks [§3](04-3-per-subsystem-ideal.md).4's build receipt reports) ships in the SAME bytes to dev and prod,
dead-gated behind the runtime `if (cfg.hmr)` check, exactly like every other
mode split in this document.

This diagnostics surface does tax the prod bundle-size numbers ([§3](04-3-per-subsystem-ideal.md).4's
build receipt reports), even though the dead-gated code never executes in
prod. A leaner prod bundle — carving the diagnostics into a separate
dev-only chunk that never ships to prod — is explicitly not taken: it would
break invariant 4's byte-for-byte guarantee ([§6](07-6-what-must-not-change-the-good-dx-to-protect.md), on the
must-not-change list). The diagnostics code ships in the same bundle bytes
to dev and prod, dead-gated behind the runtime `cfg.hmr` check, so dev and
prod stay byte-identical.

The raw material for this already exists and is currently thrown away: every AST
node carries `startIndex`/`endIndex`; the HMR loop already injects an overlay
channel; the island introspection hooks (`liveCount`, the `loading` set,
`onIslandMounted`) already exist — they are simply aimed at the test harness
instead of the developer.

