## 9. HMR hooks in the client runtime

The edit→SSE-event trigger side (debounce, change-kind dispatch, the AST endpoint)
belongs to the dev server —
[05 §6](../05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md). This section owns the
other half: what `startHmr(base)` (the optional boot-sequence call from
[§3](03-3-client-boot-trigger-arming.md), run before hydration begins) does with each
SSE event once it arrives. `startHmr` opens the `EventSource` on `<base>/_sprig/hmr` and
dispatches every event below from its `onmessage`/`onopen` handlers; the `enableHmr()`
it calls first only flips the `hmrEnabled` flag so islands register as live instances —
it handles no events itself.

| SSE event | client action | live signal state |
| --- | --- | --- |
| `template` | `hotTemplate(sel, ast)` — swap every live instance's nodes/source, update the registry for future mounts, bump each swapped instance's own `tick` signal | **preserved** — re-render runs with the same scope |
| `css` | bump every stylesheet `?v=` | **preserved** — no re-render at all |
| `reload` | `location.reload()` | **wiped** |
| late `onopen` (server restarted) | `location.reload()` | **wiped** |
| `error` | `console.error("[sprig hmr]", msg.message)` | **unaffected** — logged only, no client-state change |

Only `template` and `css` hot-swap in place; every other edit — including `logic.ts`,
the file a developer edits MOST — takes the late-`onopen` row when supervised (the
supervisor restarts the process; the client's late `onopen` fires) or the `reload` row
when unsupervised (05 §6's change→action table routes any-other-`.ts` to whichever
applies), wiping every live island's signal state either way. Only
`StateService`-backed fields survive, and only via `localStorage`, not
through this section's own HMR path. This is the current baseline, not a silent gap:
[DX-IDEAL §3.5](../DX-IDEAL/04-3-per-subsystem-ideal.md) names state-preserving
`logic.ts` HMR as the redesign target this section's `reload`/late-`onopen` rows fall
short of today.

**Trace** — a `counter` island is live, its signal reading `count = 3`. A dev edits
`counter/template.html`: the server reparses and sends
`{type:"template", sel:"counter", template: ast}` (05 §6); the client's
`hotTemplate("counter", ast)` updates the registry and swaps every live `counter`
instance's template, bumping `tick`; the effect re-renders with the SAME scope, so
`count` still reads `3` — no reload, no flash. Contrast editing `counter/logic.ts`
instead: that's any-other-`.ts`, so the server restarts (or, unsupervised, sends
`{type:"reload"}`) and the client does `location.reload()` — `count`'s live signal is
gone, and the fresh hydration re-seeds it from `restoreState()`/`__snapshot`
([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)), not from `3`.

**Late-mount trace** — same edit, a different island lifecycle. A dev edits
`counter/template.html` (server-side reparse and SSE emit exactly as above; `hotTemplate`
also updates the registry entry for `counter`, per the table). BEFORE any island next
remounts, a NEW `counter` instance enters the page mid-session — via a soft-nav
([§7](07-7-soft-navigation-hydrate-ts-500-727.md)) or a `visible` trigger firing
([§3](03-3-client-boot-trigger-arming.md)). Which path it takes depends on whether
`counter`'s chunk was already loaded:
- **Not yet loaded this session:** its chunk's first `registerIsland("counter", entry)`
  call runs; because HMR is enabled, that call fetches `<base>/_sprig/ast/counter`
  instead of trusting the chunk's build-time-baked AST, and hydrates against whatever
  that fetch returns. If the fetch fails (a transient network hiccup against the dev
  endpoint), `registerIsland` falls back to the baked AST and hydrates with that instead
  of blocking the mount.
- **Already loaded** (an earlier instance registered `counter`'s chunk this session):
  `loadIsland` finds `registry.has("counter")` true and calls `hydratePending` directly —
  no fetch. It hydrates from the registry entry, which `hotTemplate` already updated to
  the edited AST when the SSE event landed.

Either way the new instance renders the EDITED template, not the one baked in at build
time — the first path by fetching it fresh, the second by reading what `hotTemplate`
already wrote into the registry.

**Acceptance criteria** — what a correct implementation of this section must satisfy:
- **Template swap preserves state:** a live island's signal survives a `template` swap
  (`hotTemplate`) unchanged; it is reset only by a `reload`, never by a `hotTemplate`
  call.
- **CSS swap never re-renders:** a `css` event preserves every live island's state by
  construction — it bumps stylesheet `?v=` only, never touching an island's effect, so
  no re-render happens at all.
- **`reload`/reconnect-`onopen` wipe all live signal state:** both routes end in
  `location.reload()`; the fresh hydration that follows re-seeds every island from
  `restoreState()`/`__snapshot` ([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)),
  not from its pre-reload value. Only `StateService`-backed fields survive, and only via
  `localStorage` — never through this section's own HMR path.
- **The INITIAL `onopen` never reloads:** `startHmr`'s `es.onopen` handler only reloads
  on a LATER open (`connected` already `true` — the dev server restarted); the first
  open at boot sets `connected = true` and logs, nothing else.
- **A late-mounting island renders the CURRENT edited AST:** a not-yet-loaded island
  whose chunk first loads mid live-edit session fetches `<base>/_sprig/ast/<sel>` and
  renders what that fetch returns; only a fetch failure falls back to the build-time
  baked AST. An already-loaded island's late mount (`loadIsland` finding
  `registry.has(sel)` true) skips the fetch entirely and hydrates from the registry
  entry `hotTemplate` already updated. Both paths render the edited AST.
- **`liveCount()` is bounded to the mounted set only right after a `hotTemplate`
  sweep:** `hotTemplate`'s document-contains sweep is the ONLY code path that prunes
  `live` (see Mechanics, below). A soft-nav teardown with no follow-up template edit
  leaves its detached instances in `live`, so `liveCount` over-counts until the next
  `hotTemplate` call prunes them — it is not bounded unconditionally across soft-navs.

> **Decided:** no test in this section's citation set asserts these criteria yet, the
> way `hydrate-restore-order.test.ts` pins hydration order ([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)).
> A new test, `hmr-state-preserve.test.ts`, is the pin: it asserts a live island's
> signal value is unchanged across a `hotTemplate` swap and reset only by
> `reload`/reconnect-`onopen`, following the same "pinned by \<file\>" convention this
> doc family uses. Cite it here once it lands.

**Mechanics.** Hydrated instances register into `live` with a `swap(template)` that
replaces nodes/source and bumps the tracked `tick` signal, driving the re-render above.
`hotTemplate(sel, ast)` updates the registry (future mounts) + swaps every live
instance, pruning detached ones. The dormant receiver in `registerIsland` refreshes
baked ASTs from `<base>/_sprig/ast/<sel>` only when HMR is enabled; fetch failure falls
back to the baked AST. This exists for a late-mounting island: one that hydrates mid
live-edit session (a soft-nav, a lazy `visible` trigger firing after the edit) must
pick up the CURRENT edited template, not the stale AST baked in at build time — hence
the fetch. It's HMR-gated so prod, which never has a live edit to catch up on, never
issues it. And the baked-AST fallback means a transient hiccup on the AST endpoint
never blanks a mount that the baked AST would otherwise render fine.

`liveCount(): number` (hydrate.ts:308) is an exported diagnostic returning
`live.length` — the count of currently-live instances, exposed so tooling can assert
the registry stays bounded to the currently-mounted set. Only ONE path prunes `live`:
`hotTemplate`'s "pruning detached ones," which fires on a template edit. Soft-nav
teardown (§7) — `teardownInside(root)` — prunes the torn-down subtree's entries from
`mounted`/`armed`/`islandMounts` before an outlet swap
([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)), but it never
touches `live`. So a soft-nav that isn't followed by a template edit leaves that nav's
detached instances sitting in `live` — `liveCount` over-counts until the next
`hotTemplate` call sweeps them out. `liveCount` is bounded to the currently-mounted set
only immediately after a `hotTemplate` sweep, not unconditionally across soft-navs.

