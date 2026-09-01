# Template wiring — sets: / reads: / edits:

Status: DRAFT (2026-09-01, from the infra shell work). Two shipping units, in
order: the scoped event dispatch patch (§1, ships first, standalone) and the
verb wiring design (§2–§9).

## 1. Companion fix: scoped event dispatch (patch — ships first, standalone)

### Problem

`@mrg-keystone/sprig` 1.0.2 resolves `(event)` handlers by numeric index
(`data-sprig-click="2"`) with only a `root.contains(el)` check per island
listener. When live islands NEST, a child element's index N also fires the
ancestor's handler N (infra: clicking a page row opened the shell's modal;
a page submit could fire the shell's submit — infra/buglist.md 2026-09-01).

### Fix

Dispatch by the element's compile-time **owner stamp**, scoped to the live
island instance that registered it — every rendered element already carries
its component's scope attribute (the CSS-scoping attrs), but that stamp is
per-*component* (shared by every instance of the same component), not
per-instance: two live instances of one component (siblings, or a recursive
tree/menu island) carry the identical stamp. A handler's owner stamp is
fixed at compile time to the stamp of the template that authored that
specific handler binding — never inferred by scanning whichever scope
attribute happens to sit on the hosting element at dispatch time. This is
what keeps ownership unambiguous on a nested component's root tag, which
routinely carries more than one CSS-scoping attribute (its own component's,
plus an enclosing template's, e.g. when that ancestor template binds a
handler directly onto the child's root tag): each such attribute stays tied
to whichever template's compilation emitted it, regardless of how many other
scope attributes share the element. Resolution therefore keys the
handler-table registry by (stamp, index) WITHIN each instance's own table —
a per-island table, scoped to that instance's root — never by stamp alone:
a single instance registers many handlers that all share its one stamp,
differentiated only by index (`data-sprig-click="2"`), so the index stays
part of the key inside the table exactly as it does today; only the table
itself is now per-instance rather than shared. A single document-level
dispatcher is only equivalent if it keys on (instance root, stamp, index)
together; keyed on stamp alone it reintroduces the identical-stamp collision
across two instances of the same component.

On dispatch, walk up from the event target to the NEAREST live island
root, INCLUSIVE of the target itself: if the event target is itself a live
island's root (it anchors that root's own handler table), the walk stops
there immediately without moving to any ancestor; otherwise it continues to
the first ancestor element that anchors a handler table. Resolve the lookup
against only that instance's own table; the walk stops there whether or not
a match is found, so an ancestor instance's table is never consulted, even
when that ancestor happens to hold an entry with an identical stamp (and
identical index — same recursive component). This nearest-root rule is what
disambiguates two NESTED instances of the same
component (test 4): a click inside the inner instance finds the inner
instance's root, and only the inner instance's table, first — the outer
instance's table, despite containing the matching entry, is never reached.

Static components never register (no bindings ⇒ no table); nested live
islands of different components become unambiguous by root containment
(their stamps already differ); two instances of the same component — sibling
or nested — stay disambiguated by the same nearest-root walk, not merely by
each "owning its own table" (owning a table is necessary but not
sufficient — the nearest-root walk is what picks the right one).

Teleported content is the one case this rule does not resolve correctly: the
walk anchors on the CURRENT DOM position, so an element relocated out of its
owning island's subtree finds a different island's root (or none) on the way
up, and that root's table — keyed by its own component's stamp — has no
entry for the teleported element's (stamp, index). The lookup misses. The
same miss happens for any element whose owner stamp belongs to a component
other than the nearest enclosing island: an outer island's handler declared
on an inner island's root tag, or content an outer component renders into an
inner island's subtree. Per "the walk stops there whether or not a match is
found," a miss runs no handler — the event proceeds as an ordinary,
unhandled DOM event, not a fallthrough search of ancestor tables (that
fallthrough is exactly the mechanism test 4 relies on NOT existing).

> **[DECIDE]** Whether a table-lookup miss (teleported content, or any other
> owner/nearest-root mismatch) should also emit a dev-mode diagnostic —
> silent in both dev and production, or a dev-only console warning naming
> the element and its expected owner. Recommended default: warn in dev
> only — turns an inexplicable dead click into a discoverable message during
> development, with no runtime cost in production. Teleporting content (or
> otherwise rendering across island boundaries) with attached handlers is
> unsupported by this dispatch rule; components that need it must not rely
> on `(event)` handlers surviving the move.

> **[DECIDE]** Fallback when an element carries no owner stamp (a component
> compiled without scoped styles, or an element created outside any
> component) — make stamping unconditional at compile time (every rendered
> element gets its owning component's scope attribute regardless of whether
> it has scoped styles), or define an explicit fallback resolution (e.g. the
> old `root.contains(el)` walk) for unstamped elements. Recommended default:
> make stamping unconditional — it's a compiler-only change with no runtime
> cost, and keeps dispatch resolution on one mechanism instead of two.

With §3 (the verb wiring design) shipped, infra's shell returns to a static
frame and nesting disappears from the app — but this fix stands alone as a
correctness repair and ships as a patch release immediately, independent of
that work.

### Tests

1. Nested live islands: child click runs ONLY the child's handler (the infra
   collision, reproduced then fixed).
2. Island under a static parent.
3. Static child under a live island.
4. Two live instances of the SAME component (siblings, and nested — e.g. a
   recursive tree/menu island): each instance's click runs ONLY that
   instance's handler, despite both carrying the identical owner stamp.
5. Owner/nearest-root mismatch (teleported content, or an outer component's
   content rendered into an inner island's subtree): the lookup misses — no
   handler runs, and no ancestor table is consulted as a fallback.

### Release

Ships as a patch release as soon as its tests pass — no dependency on the
verb wiring design below.

## 2. Goal

**The app must be understandable from the HTML alone, at a high level.** A
stranger opening the templates should be able to narrate the app: what's on
screen, where every piece of shared state originates, who consumes it, and
what the user can change. Composition AND coordination live in markup —
no invisible store modules gluing islands together behind the template's back.

Two structural requirements from the infra work:
- Island children under **static parents** stay the norm (a parent with no
  bindings has no logic, no hydration, no cost).
- **Sibling islands coordinate** without promoting their common parent to a
  live island wrapping everything (that's how infra hit the nested-island
  event collision, and it hydrates a huge tree to share one value).

## 3. The design

Signals under the hood. Three directional verbs in the template, attached
where a component is instantiated:

```html
<!-- shell/template.html — STATIC: no logic.ts, never hydrates.
     Read it aloud: "side-nav sets the org; the quick-rename field edits it
     under a different name; pages read it." -->
<div class="frame">
  <side-nav sets:org></side-nav>
  <org-quick-rename edits:draft={org}></org-quick-rename>
  <main class="content">
    <router-outlet reads:org></router-outlet>
  </main>
</div>
```

```ts
// components/side-nav/logic.ts — nothing new to learn: it's just a signal
export default class SideNav {
  org = signal<string | null>(null);   // tethered by sets:org → read-write
  pick(o: string) { this.org.set(o); }
}
```

```ts
// components/org-quick-rename/logic.ts — its own signal is named `draft`,
// longhand-tethered to the `org` channel: read-write, but it does not
// ORIGINATE org — side-nav's sets:org does. Drop side-nav from the template
// and org-quick-rename alone would trip the "no sets: participant" lint
// (§6): an editor of a value nothing originates is a bug, not a channel.
export default class OrgQuickRename {
  // widened to include `undefined`: an edits: field adopts the channel's
  // value, which reads `undefined` if it tethers before org's `sets:` seeds it
  draft = signal<string | null | undefined>(null);   // tethered by edits:draft={org} → read-write, adopts org's value
  rename(o: string) { this.draft.set(o); }
}
```

```ts
// pages/org-detail/logic.ts
export default class OrgDetail {
  // widened to include `undefined`: a reads: field adopts the channel's
  // value, which reads `undefined` if it tethers before org's `sets:` seeds it
  org = signal<string | null | undefined>(null);   // tethered by reads:org → READ-ONLY
}
```

### The verbs

| verb      | tether     | `.set()` through the tether | seeds the channel's initial value | satisfies the origin lint (§6) | role in the story |
|-----------|------------|------------------------------|-------------------------------------|-----------------------------------|--------------------|
| `sets:x`  | read-write | allowed | only the FIRST `sets:` in template order seeds it — any later `sets:` on the same channel tethers like `edits:` (adopts the current value, does not reseed) | yes | the ORIGIN of x — this component decides what x is |
| `reads:x` | read-only  | throws | no — adopts the channel's value | no | a consumer of x — uses it, cannot write it |
| `edits:x` | read-write | allowed | no — adopts the channel's value (own initial value discarded) | no | modifies an x that ORIGINATES ELSEWHERE (e.g. a rename field editing a name that exists before it mounts) |

`sets:` and `edits:` are mechanically identical (read-write); they differ in
narrative role and in the lint (§6): every channel needs at least one `sets:`
origin — `edits:` deliberately does not satisfy that, because an editor of a
value nothing originates is a bug.

### Semantics

- `sets:org` tethers the component's own signal named `org` to a **channel**
  named `org`. Writing the name is what creates the channel; components
  naming the same channel share the same value.
- Longhand `sets:org={selectedOrg}` tethers the component's `org` signal to
  channel `selectedOrg` (names differ, or two instances join different
  channels). Same longhand for `reads:`/`edits:` — see `edits:draft={org}`
  above. The name inside `{...}` here is a literal channel-name identifier,
  not an interpolated template expression — despite the shared braces, it is
  not evaluated against the surrounding scope. It must be a compile-time
  constant: the whole-app static analysis in §5/§6 resolves every channel
  without evaluating the template, which only works if the name is fixed at
  compile time.
- **Enforced direction.** The template cannot lie about dataflow — that is
  what "source of truth" means here: `.set()` through a `reads:` tether
  throws in dev AND production alike, never a silent production no-op. Only
  the diagnostic detail is dev-mode-specific — in dev, the error message
  names the component, the channel, and the shell template line; production
  may strip that detail to a generic message, but the throw itself always
  ships.
- **Tethering replaces, not bridges.** At hydration, the tether assigns the
  channel's signal onto the component's own field, replacing whatever local
  signal was there. The field keeps its ordinary writable signal type in
  every case — a `reads:` field is declared exactly like a `sets:`/`edits:`
  field (see `org-detail` above); there is no separate read-only signal
  type. What `reads:` changes is the assigned signal's runtime behavior, not
  its static type: its `.set()` is write-guarded and throws at hydration
  time and after (per "Enforced direction" above), so the field-level
  assignment still typechecks as an ordinary writable-field assignment, and
  the write protection is caught at the call site of `.set()`, at runtime,
  not at the tether assignment. Code that captured the pre-tether signal
  directly (e.g. a `computed` built in the constructor from a local variable
  rather than `this.field`) keeps observing the stale, untethered signal;
  derive computeds/subscriptions from `this.field`, or build them after
  hydration, if they need to see tethered writes.
- **Type agreement between participants.** **The channel's type is the first
  `sets:` participant's declared signal type** — the origin's type IS the
  channel's type, nothing widens it. The tether then assigns that same
  channel signal directly onto every other participant's `this.field`, so
  every other participant's declared field type must be assignable FROM the
  origin's type — the same requirement as any other assignment in the
  component's own language. The `org-quick-rename` and `org-detail` examples
  above rely on this: side-nav's origin declares
  `signal<string | null>(null)`, and both consumers declare the wider
  `signal<string | null | undefined>(null)` — exactly the `undefined`
  widening the pre-seed-read `[DECIDE]` below requires. The design intent is
  that the origin's field never observes a value outside its own declared
  type, even though every read-write participant (including a later
  `sets:`/`edits:` tether) writes through that same shared signal object —
  but how that intent is actually enforced is a product decision this
  document has not made; see below.

  > **[DECIDE]** A mutable `Signal<T>` container is naturally invariant, so
  > whether "narrower origin type assignable into wider consumer field"
  > actually typechecks depends on how this builder declares `Signal<T>`'s
  > `set` (bivariant method-syntax vs. strict property-syntax checking) —
  > unpinned by this document. And even where the field-level assignment
  > does typecheck, ordinary assignment typechecking has no way to hold a
  > `.set()` call on a wider consumer field to the narrower channel/origin
  > type instead of the field's own declared type — a write like
  > `this.draft.set(undefined)` on a field typed to include `undefined`
  > cannot fail to compile under ordinary typechecking alone, and no
  > dedicated lint rule is specified to catch it either. Two coherent
  > resolutions: (a) require every participant on a channel to declare the
  > IDENTICAL signal type — removes the widening this section otherwise
  > relies on, and pushes the pre-seed-`undefined` case (below) onto every
  > participant, including the origin; or (b) keep the per-participant type
  > widening as written above, and enforce write narrowing at runtime
  > instead of compile time — a `.set()` call whose value falls outside the
  > origin's type throws the same dev/production error that a `reads:`
  > misuse throws (per "Enforced direction" above). Recommended default:
  > (b) — it preserves the already-decided `undefined`-widening behavior
  > instead of undoing it, and reuses the throw mechanism this document
  > already specifies for direction violations rather than inventing a new
  > one.
- **Channel scope:** the render tree that declared the wiring (in practice
  one document). Channels are not global app state; they die when that
  render tree unmounts — not when any single participant does. A channel
  outlives a `sets:` origin that unmounts while readers remain (e.g. an
  outlet-swapped page moving on).

  > **[DECIDE]** What counts as "the render tree that declared the wiring"
  > once a `<router-outlet>` mounts a page into it — does the mounted page's
  > own template join the SAME scope/channel namespace as its shell, so any
  > same-named `sets:`/`reads:`/`edits:` anywhere in the app resolves to one
  > channel (matching §5's `app: set by app-list → read by app-detail`,
  > where neither page shows a shell or a forwarding outlet), or is each
  > mounted template its own scope that only joins a parent's channel via an
  > explicit forwarding tether on the outlet that mounts it (matching §6's
  > "a `<router-outlet>` … connects the template that declares it to every
  > template that can mount under it" and the "no verb, and not mounted
  > under a forwarding tether → fully private" rule)? This changes how
  > `sprig map` and the §6 lint resolve channel identity and count
  > participants. Recommended default: scope-per-template with explicit
  > forwarding required — matches how the outlet-forwarding and lint rules
  > are already written, keeps a page's internal state from silently leaking
  > into an unrelated page that happens to reuse a signal name, and requires
  > §5's `app:` line to be backed by an actual forwarding `<router-outlet
  > sets:app>`/`reads:app` pair rather than by same-name coincidence.

  > **[DECIDE]** What the channel holds once its only `sets:` origin
  > unmounts and no replacement has tethered yet — retain the last written
  > value, reset to `undefined`, or tear the channel down (readers throw or
  > reset). Recommended default: retain the last written value until a new
  > `sets:` participant tethers or the render tree itself unmounts — matches
  > the "buffered signal, not event" model and keeps outlet-forwarded
  > readers stable across navigation.

- **Buffered (signal, not event):** the channel holds the latest value.
  Hydration order between islands is not guaranteed; a late-hydrating island
  reads the current value on tether and never misses an earlier write.
- **Initial value:** the channel starts from the FIRST `sets:` component's
  current signal value in template order. Every other participant's tether —
  `reads:`, `edits:`, and any `sets:` past the first on the same channel —
  adopts the channel's current value instead of seeding it (their own
  initial value is discarded); "first `sets:` in template order" is the
  channel's only seed source, full stop.

  > **[DECIDE]** If a later-in-template-order participant (an `edits:` or a
  > second `sets:`) hydrates and writes before the first-in-template-order
  > `sets:` has hydrated, does that first `sets:`'s seed — once it does
  > hydrate — overwrite the write, or is seeding skipped once the channel
  > already holds a value? Recommended default: seeding is skipped once the
  > channel holds a value written by an explicit `.set()` call — merely
  > having been tethered (and having adopted the pre-seed `undefined`
  > placeholder, per the `[DECIDE]` below) does not count as "holding a
  > value," so a `sets:` origin that is genuinely first to hydrate always
  > seeds cleanly, even if a `reads:`/`edits:` participant tethered before
  > it. "First `sets:` in template order" is the seed source only while the
  > channel has received no write yet, so an actual write is never silently
  > clobbered by a late-arriving seed.

  > **[DECIDE]** What a `reads:`/`edits:` component observes when it tethers
  > before any `sets:` participant has hydrated (its own initial value is
  > discarded, and the channel isn't seeded yet). Recommended default:
  > `undefined` — distinguishes "not seeded yet" from a component-supplied
  > `null`, so callers can guard on it the same way as any other
  > not-yet-loaded value. Because of the type-agreement rule above, this
  > means any component that may observe a channel before it's seeded must
  > type its tethered field to include `undefined` (e.g.
  > `signal<string | null | undefined>(null)`) — the §3 examples below widen
  > `org-quick-rename`'s and `org-detail`'s fields for exactly this reason;
  > a `sets:` origin's own field never needs the widening, since it seeds
  > from its own value rather than adopting the channel's.

  > **[DECIDE]** "Template order" is undefined once a channel spans more
  > than one template via outlet forwarding (§6): there's no stated ordering
  > between a shell's `sets:`/`edits:` participants and a page's, mounted
  > under its `<router-outlet>`. Recommended default: the enclosing
  > template's participants precede the mounted page's, in each template's
  > own document order — the shell (and everything in it) always renders
  > before `<router-outlet>` resolves and mounts a page into it, so this
  > matches the order components actually instantiate in.

- **SSR:** channels do not exist server-side; every component SSRs from its
  own defaults (the usual `@if (x())` empty-state discipline). Hydration
  tethers the channels client-side.
- `<router-outlet reads:org>` forwards the tether to whatever page mounts:
  a page with an `org` signal gets the read-only tether; a page without one
  is untouched. The match is against the attribute's own name (`org`) even
  under longhand renaming — `<router-outlet reads:org={selectedOrg}>` still
  requires the mounted page's signal to be named `org`; only the shared
  channel is renamed to `selectedOrg`.
- **No verb, and not mounted under a forwarding tether → fully private.** A
  component with no wiring attribute of its own, mounted somewhere no
  enclosing `<router-outlet>` (or other forwarding element) forwards a
  matching channel to it, exposes nothing and hears nothing. Black box. A
  page mounted under a forwarding outlet is the one exception — see the
  bullet above: it gets tethered by matching signal name even though its
  own template tag carries no verb, because the verb lives on the outlet
  that mounts it, not on the page.

## 4. Why this shape (rejected alternatives, with reasons)

- `bind:org` (Svelte-style symmetric): shows coupling but not FLOW — no
  direction, no story. Rejected against the §2 goal.
- `shows:` as the consumer verb: lies when the consumer doesn't display the
  value (`<router-outlet shows:org>` shows nothing; guards/filters consume
  without displaying). `reads:` is true in every case.
- `@state` declaration + `[(x)]` banana-in-a-box: extra ceremony; rejected.
- `model="org"`: terse but magical; plain-attribute namespace collision.
- `@Output()/@Input()` decorators: explicit but verbose; fire-and-forget
  events need buffering anyway (they become signals in disguise); two-way
  needs the `x`/`xChange` pair. Ceremony without power.
- Shared store modules: invisible in the template; violates §2 outright.

## 5. `sprig map`

Because the templates now CONTAIN the dataflow, the CLI can render it:

```
$ sprig map
org:  set by side-nav → read by router pages (org-detail, app-detail)
app:  set by app-list → read by app-detail
```

> **[DECIDE]** The sample above doesn't render `edits:` participants (e.g.
> §3's `org-quick-rename edits:draft={org}`) — undecided whether an editor
> gets its own clause, is folded into the setter's, or is omitted from the
> line entirely. Recommended default: its own clause in tether order, e.g.
> `org: set by side-nav → edited by org-quick-rename → read by router pages
> (org-detail, app-detail)` — keeps the map's one-clause-per-verb shape so
> all three verbs are provable from the HTML, per §2.

If a tool can draw the architecture from the HTML alone, the HTML really is
the source of truth — `sprig map` is the proof and the regression guard.

## 6. Lint (required, not optional)

Analysis here and in `sprig map` (§5) runs over the whole app's template
graph, not one file at a time: a `<router-outlet>` (or other forwarding
element) connects the template that declares it to every template that can
mount under it via the app's routing, so a channel spanning a shell and its
pages resolves together.

- A wiring verb naming a signal the component doesn't have → **error** —
  except on a forwarding component (e.g. `<router-outlet reads:org>`, §3),
  which is exempt from this check for tethers it forwards rather than owns.

  > **[DECIDE]** How a component is recognized as a forwarder for this
  > exemption — special-cased by framework element name (`router-outlet`
  > only), a framework marker any component can declare, or any component
  > may forward any verb it names. Recommended default: a framework marker
  > (e.g. a `forwards` declaration on the component) — keeps the exemption
  > explicit and auditable instead of hard-coding one element name.

- A channel with no `sets:` participant (only `reads:`/`edits:`) → **error**:
  the value has no origin.
- A channel with exactly one participant → **warning** (dead wire or typo).
- More than one `sets:` on a channel → **warning** (two origins is usually a
  bug; silence with an explicit opt-in if a real case appears).

  > **[DECIDE]** What counts as a "participant" for rules 3 and 4 once a
  > forwarding element is on the channel: does the forwarding element itself
  > (`<router-outlet reads:org>`) count independently of whether any page
  > satisfies it, or does it contribute nothing on its own and only the
  > pages it resolves to count — and if the latter, does a route-mounted
  > page that *may* mount count once, or once per route that can reach it?
  > Recommended default: the forwarding element never counts itself (rule 1
  > already treats it as a conduit, not an owner of the channel); each
  > distinct page template in the routing graph that declares the matching
  > signal counts as one participant, regardless of how many routes can
  > mount it — the count tracks the number of components that actually
  > read/write the channel, not the number of ways to reach them. Under
  > this default, a shell with `<side-nav sets:org>` and
  > `<router-outlet reads:org>` where no reachable page declares an `org`
  > signal has exactly one participant (`side-nav`) and triggers the rule-3
  > warning.

## 7. Docs (part of the change, not an afterthought)

Ship in the same release:
- `docs/guide.md`: a "Wiring islands" section — the three verbs, the
  channel rules, the shell example above, `sprig map`.
- The framework skill docs (`docs/sprig/`, the SKILL surface the build agents
  read): same section, condensed to the agent-facing form.
- Migration note: nested live islands are no longer the way to coordinate —
  restructure to siblings + wiring (infra is the worked example).

## 8. Test plan (framework repo)

1. Sibling islands under a static parent: `sets:` writes, `reads:` sees it.
2. `edits:` tether: writes propagate like `sets:` (read-write), but its own
   initial value is discarded on tether and it alone does not satisfy the
   origin lint (§6 rule 2) — paired with a `sets:` origin, its writes reach
   other readers.
3. `reads:` tether: `.set()` throws with the named-component dev error.
4. Late hydration: reader hydrates after the setter wrote — sees the value.
5. Initial value: first `sets:` in template order seeds the channel; a
   reader's own default is discarded on tether.
6. SSR: components render from their own defaults; no channel server-side.
7. Longhand: two instances of one component joined to different channels.
8. Outlet forwarding: page with a matching signal tethers; page without is
   untouched; navigation swaps pages and re-tethers correctly.
9. Lint: all four rules of §6 (error, error, warning, warning).
10. `sprig map` output matches the wired templates.

## 9. Rollout

1. Minor release: verbs + enforcement + lint + `sprig map` + docs (§7).
2. infra: shell → static frame with `side-nav` as a sibling island wired
   `sets:org`, and `<router-outlet reads:org>` forwarding it to whichever
   page declares a matching `org` signal (pages carry no verb of their own —
   §3); delete the `#fromOutlet` workaround guards in
   ui/src/shell/logic.ts; bump the pin; update infra's own notes.
