## 10. Refactor notes

These notes observe the tensions the current composition creates. Most hand off to
a resolution elsewhere — the composition collapse to [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s `Frontend` target, the
auth/rename/path-validation tensions to DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md). Two decide something
small locally: item 1 extracts the dispatch table as data and keeps its order
tests, item 3 unifies the cache-addressing subsystem across two packages.

| # | tension | status | owner |
|---|---|---|---|
| 0 | which piece of today's dispatch dies, leaves sprig, or survives once `Frontend` lands | delegated | [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s collapse table, [§3](03-3-the-servesprig-composition-current-as-built.md).3's migration-fate table; auth: [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s resolved ruling |
| 1 | the dispatch table + its order is the de-facto public gateway spec | decided here — extract as data, keep order tests | this document, item 1 below |
| 2 | legacy bearer mode doubles every auth path | delegated — subset of the wholesale auth collapse | [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s resolved ruling; interim discipline: DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) |
| 3 | `serveAsset` + `assetsVersioner` + build hashing spread across two packages | decided here — unify | this document, item 3 below |
| 4 | the vendor map's fate under `Frontend` | decided — survives, "dies" branch foreclosed | [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s collapse table; DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) |
| 5 | `keep` → `compose` name collision | delegated | DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) |
| 6 | compose-time path validation fails silently | delegated | DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) |

**Standing constraint:** every retirement or survival named below is gated on
[§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s `Frontend` contract landing — until then, today's `serveSprig`/`sprigUi`
composition ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md)–[§9](09-9-zero-composition-derivation.md)) is what ships. Items 0, 1, 2, and 4 below each name what
happens once that lands; the gate itself is stated once here rather than
re-hedged per item.

0. **The `Frontend` contract ([§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)) is the primary reframe.** Land it as sprig's only
   composition surface: sprig would export the directly-servable `Frontend` owning
   root; `serveSprig`/`sprigUi` become thin adapters, then retire ([§3](03-3-the-servesprig-composition-current-as-built.md)). Which piece
   of today's dispatch dies, leaves sprig, or survives is [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s collapse table and
   [§3](03-3-the-servesprig-composition-current-as-built.md).3's migration-fate table — this reframe doesn't re-derive that map, it delegates to
   it. Keep the dispatch-order tests green against whichever composer performs the
   routing. Auth per [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s resolved ruling: built-in auth removed; sprig consumes a session
   from whatever guard layer the app composes.
1. The dispatch table + its order ([§3](03-3-the-servesprig-composition-current-as-built.md).2) is the de-facto public gateway spec — extract
   it as data, keep the order tests. Per the standing constraint above, the
   dispatch STRUCTURE retires with `serveSprig` ([§3](03-3-the-servesprig-composition-current-as-built.md).3), but the ORDER contract
   survives as tests, regardless of which composer ends up performing the
   routing.
2. Legacy bearer mode doubles every auth path (the fwWarnOnce lines mark every
   fallback seam) — but this isn't a standalone deletion timed to infra's KV
   migration: it's a subset of the wholesale auth collapse, retiring together with
   the rest of built-in auth per [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s resolved ruling, gated the same as everything
   else on the standing constraint above. Until then, DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s "session
   mode is declared and fails loud on mismatch" is the interim discipline — a keep
   lacking session members throws at compose instead of silently downgrading the
   app's auth channel to bearer.
3. `serveAsset` + `assetsVersioner` + build hashing form one cache-addressing
   subsystem spread across two packages — unify. The same subsystem is what DX-IDEAL
   [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s "paths are validated at compose time"/prebuilt-AST `assetsDir` threading
   and DX-IDEAL [§3.4](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s "versioning degrades loudly" item both name — unifying it is
   the ground those two build on.
4. The vendor map is a one-entry bespoke CDN. Per the standing constraint above it
   survives into `Frontend` — [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s collapse table (asset paths become root-relative,
   no base) and DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s "sprigUi keeps the vendor guarantee" agree — the "dies"
   branch is foreclosed. Scope stays bespoke: the map grows only when a lib meets the existing VENDOR-slot
   criterion — a browser-global every app/isolate genuinely needs without paying to
   bundle it — never speculatively ahead of a consumer that needs it.
5. `keep` → `compose` rename: `packages/keep/mod.ts` isn't rune's keep, and the name
   collision costs two paragraphs of "it is named after keep, it is not keep" every
   time it needs explaining. The landing plan — coordinated cross-repo timing,
   `SPRIG_IMPORTS` retarget, deprecation alias, codemod — is DX-IDEAL
   [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s ruled recommendation, not re-derived here.
6. Compose-time path validation: `assetsDir`/`srcDir` derivation fails silently
   today — a blank page + N devtools 404s, or prod SSR silently live-parsing every
   template with tree-sitter. Hands off to DX-IDEAL [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md): `stat()` the derived
   paths at compose time and fail loud with the resolved path, extending the same
   instinct already used for the `base === apiPrefix` compose-time throw ([§3](03-3-the-servesprig-composition-current-as-built.md).1);
   thread the resolved `assetsDir` into the prebuilt-AST `templates.json` lookup so
   a composed prod app doesn't silently fall back to live-parsing.
