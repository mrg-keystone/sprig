## 4. The biggest cross-cutting forks

The per-subsystem `[FORK]` tags throughout [§3](04-3-per-subsystem-ideal.md) (including [§3](04-3-per-subsystem-ideal.md).10 and [§3](04-3-per-subsystem-ideal.md).11) are
almost the complete list of open product/architecture decisions in this
document — this section is not a second, exhaustive inventory of them. It
collects the handful whose blast radius crosses subsystem boundaries or whose
sequencing affects the rest of the build order ([§5](06-5-build-order-max-dx-leverage-first.md)), each with a recommended
default, plus two items (7 and 8) that don't trace back to any single [§3](04-3-per-subsystem-ideal.md)
subsystem at all: repo-structuring decisions that belong to no per-subsystem
spec and so originate here:

1. **Template type-safety** — invest in typed templates (big compiler work, huge DX
   ceiling) or explicitly declare templates dynamically-typed. *Recommend: commit to
   typed; the silence is the current defect.*
2. **Node-level fine-grained reactivity** — bind a signal write to the specific
   node(s) it feeds instead of re-rendering the whole island subtree to a string
   and morphing it in ([§3](04-3-per-subsystem-ideal.md).3) — the largest blast radius on the board (it touches
   the compiler, the interpreter, and every island's update path) and the
   largest of the genuinely architectural builds this document names ([§0](01-0-the-one-line-thesis.md)).
   *Recommend: commit to it as the target; sequence it after the diagnostics
   floor ([§5](06-5-build-order-max-dx-leverage-first.md)) since it's the largest single investment in the runtime.*
3. **`logic.ts` HMR** — per-island re-import + re-hydrate vs accept full-reload.
   *Recommend: ship it for the leaf-island common case.*
4. **The daisyUI/utility CSS leak** — namespace the framework-emitted daisyUI +
   utility CSS (kills the collision class structurally, but taxes every daisyUI
   usage app-wide with a rewritten class vocabulary — daisyUI classes are
   author-facing markup, not just emitted output) vs keep it global + warn on
   collision at build (preserves bare daisyUI ergonomics, turns the collision
   into a located dev diagnostic instead of a silent style bug). *Recommend:
   keep daisyUI global + warn on collision at build* — component-to-component
   isolation is already solved by attribute scoping (`[sX]`); the namespacing
   option's cost (an app-wide daisyUI class-reference rewrite) outweighs
   closing an already-diagnosable collision structurally.
5. **Auth default (INTERIM only)** — opt-in (right for a general framework) vs
   default-to-MRG-infra (only right if sprig stays MRG-internal). This fork is scoped
   to the interim: a resolved user ruling (06 §4, restated in 09 §5, 2026-07-18) removes
   built-in auth 100% once the `Frontend` contract lands, after which app auth becomes a
   pluggable guard layer owned by neither sprig nor any backend. *Recommend for the
   interim: opt-in, `infraUrl` required — but don't deepen the built-in-auth investment;
   the end-state is the pluggable guard layer (auth ruling at [§3](04-3-per-subsystem-ideal.md).6).*
6. **`@defer`** — implement it vs reject-with-a-located-error. *Recommend: reject until
   implemented; never ship it silently inert.*
7. **Monorepo split** — settled: stay a single package with internal module
   boundaries, not a split into independently publishable packages (e.g. CLI,
   runtime, workbench as separate repos/packages). No subsystem in this document
   needs an independent release cadence yet. This is a repo-topology call with no
   per-subsystem owner, and genuinely low developer-felt DX (it lands on
   contributors, not app-devs) — de-prioritized relative to hydration +
   diagnostics, which is where the developer actually lives. Revisit only if a
   subsystem needs an independent release cadence.
8. **The hidden `.sprig/` dir** — settled: stays a hidden, undocumented dotfile
   directory rather than becoming a visible, documented part of the project
   layout. The dotfile convention already signals "generated/internal, don't
   hand-edit." Like item 7, this is a repo-topology call with no per-subsystem
   owner, and genuinely low developer-felt DX (it lands on contributors, not
   app-devs) — de-prioritized relative to hydration + diagnostics, which is
   where the developer actually lives.
9. **The diamond orchestrator** — a unifying `diamond` CLI (the full driver that spawns
   and wires both dev loops) vs hash-stamped artifacts + a read-only `status`. The
   "home repo" ownership question is already settled ([§3](04-3-per-subsystem-ideal.md).9, AGREED coms.md
   2026-07-18): the composed app is its own git repo, neither rune's nor sprig's, and
   both `init`s are idempotent contributors that never hard-fail on the other's
   absence — so the remaining fork is only the driver's build, not who owns the tree.
   *Recommend: ship the cheap status version unconditionally; treat the driver as a
   later fork.*

