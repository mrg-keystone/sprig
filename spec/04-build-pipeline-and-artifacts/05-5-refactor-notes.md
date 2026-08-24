## 5. Refactor notes

Observed as-built build-pipeline tensions. Items 1 and 2 hand off entirely to their
DX-IDEAL resolution — the analysis and fork is worked there, not re-derived here. Item
3 splits: its lookup-miss half hands off the same way, but its public-`static/`
exposure half is decided in this document. Item 4 names a bounding constraint —
`deno bundle`'s plugin-less contract — that no DX-IDEAL section resolves; it only
shapes which path another section's fork may take.

| # | tension | status | owner |
|---|---|---|---|
| 1 | dual-core failure class defended across build/config/runtime | delegated | [DX-IDEAL §3.1](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "Dual-runtime recovery is visible" |
| 2 | Tailwind/daisyUI emits unscoped utility CSS | delegated | [DX-IDEAL §3.2](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "Framework-emitted utility CSS is namespaced, not user class names" |
| 3 | templates.json is server-only but lives in the publicly-served `static/`/`assetsDir` | split — lookup-miss half delegated, exposure half decided here | lookup: [DX-IDEAL §3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "The prebuilt-AST lookup gets the same `assetsDir`"; exposure: this document, item 3 below |
| 4 | `deno bundle`'s plugin-less flag contract | bounding constraint | none — no DX-IDEAL section resolves it; it only shapes which path §3.4's "Incremental dev rebuild" may take |

**Standing constraint (invariant 4,
[00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)):**
the dev bundle IS the prod bundle, byte-identical, from the SAME build — not that a
refactor's new output must match today's bytes. Items 1 and 4 below both touch build
tooling and are gated by this one invariant; it is stated once here rather than
re-derived per item.

1. The dual-core failure class is defended in three places — build (sentinel scan),
   config (forced import map, workspace hoisting), and runtime (one-shot reload) — a
   redesign should make "exactly one runtime" structural rather than defended.
   Resolved in
   [DX-IDEAL §3.1](../DX-IDEAL/04-3-per-subsystem-ideal.md) "Dual-runtime recovery is
   visible" (a dev banner instead of an easily-missed console line) plus its
   unconditional `detectDualRuntime()` guardrail — the analysis and fork are worked
   there, not here. The standing constraint above binds regardless of which fork
   wins: whatever single-runtime design ships, its own dev output and prod output
   must remain byte-identical — the constraint is dev/prod parity, not preservation
   of today's exact bytes.
2. Tailwind/daisyUI emit UNSCOPED utility/component CSS from any class name in sources
   (known collision hole — see spec 10 [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).3).
   Resolved in [DX-IDEAL §3.2](../DX-IDEAL/04-3-per-subsystem-ideal.md)
   "Framework-emitted utility CSS is namespaced, not user class names" — recommended
   fix: keep daisyUI global, warn on collision at build.
3. templates.json couples build output to SSR input; it is server-only yet lives in
   the publicly-served `static/` dir (served path exists). The lookup-miss half —
   `serveSprig` failing to find it under a composed layout and silently falling
   back to live tree-sitter parsing — is resolved in
   [DX-IDEAL §3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md) "The prebuilt-AST lookup
   gets the same `assetsDir`." That fix threads the SAME `assetsDir` `serveSprig`
   already resolves ($SPRIG_ASSETS_DIR else `<cwd>/static` — spec 04 §1, DX-IDEAL
   §3.6) through the lookup, which only works if templates.json still lives inside
   that directory — it does not address the public-dir EXPOSURE itself, which no
   DX-IDEAL bullet owns.

   Decided: templates.json stays inside `assetsDir`/`static/`, not relocated —
   moving it out would break §3.6's own fix, whose lookup depends on templates.json
   living wherever the rest of serving already resolves `assetsDir` to. The
   public-dir exposure is accepted as-is: the file is servable but never referenced
   by any client code (no `<script>`/fetch ever points at it), so the residual risk
   is limited to an attacker reading prebuilt template ASTs off a known path — not a
   live exposure. Closing that read path entirely (e.g. an extension block-list in
   `serveAsset`) is asset-serving-hardening design (spec 06 §5), out of scope here.
   `build-info.json` shares templates.json's public location (it lands in this same
   `static/` — [§2](02-2-the-artifact-set-static.md)) but arrives via its own,
   separately-timed deploy/stamp step; cited here for that timing/ownership
   parallel, not as a precedent for a non-public location.
4. `deno bundle` (esbuild) flags — `--platform browser --minify --code-splitting` —
   are the whole bundler contract; no plugins. Point 2's daisyUI collision is a
   separate tool's problem, not this one's: the colliding CSS is emitted by
   `@tailwindcss/cli` in step 5 (`buildCss`), not `deno bundle` in step 3, and that
   CSS pipeline IS plugin-based (`@plugin "daisyui"`) — a `deno bundle` plugin was
   never the relevant lever there; DX-IDEAL §3.2 treats emission-namespacing as
   feasible-but-costly, not bundler-blocked. This plugin-less contract is, however,
   WHY [DX-IDEAL §3.4](../DX-IDEAL/04-3-per-subsystem-ideal.md) "Incremental dev rebuild"
   (a persistent esbuild context, rebuilding only the changed entry's graph) must
   run a path DIVERGENT from this one — the same section's "Source maps served in
   dev" stays on this contract, serving the already-produced `.map` sidecars rather
   than diverging. Either way, the standing constraint above holds: the incremental
   path's output must be proven byte-identical to `deno bundle`'s — it doesn't get
   to change output bytes for speed.
