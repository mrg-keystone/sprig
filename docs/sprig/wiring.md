<sub>[← sprig docs](./README.md)</sub>

# Wiring islands (`sets:` / `reads:` / `edits:`)

Sibling islands share state through **template wiring**: three directional verbs on the
tag where a component is *instantiated*. Signals under the hood; the dataflow is readable
from the HTML alone — no store modules.

```html
<!-- shell — STATIC (no logic.ts, never hydrates): "side-nav sets the org;
     the quick-rename field edits it under a different name; pages read it." -->
<div class="frame">
  <side-nav sets:org></side-nav>
  <org-quick-rename edits:draft={org}></org-quick-rename>
  <main><router-outlet reads:org></router-outlet></main>
</div>
```

```ts
// side-nav/logic.ts — just a signal; sets:org tethers it read-write
org = signal<string | null>(null);
// org-quick-rename/logic.ts — its `draft` signal, longhand-tethered to channel `org`.
// Widen with `undefined`: reads:/edits: adopt the channel, which is undefined pre-seed.
draft = signal<string | null | undefined>(null);
// pages/org-detail/logic.ts — NO verb on the page; the outlet forwards a read-only
// tether to its `org` signal by name.
org = signal<string | null | undefined>(null);
```

| verb      | tether     | `.set()` | seeds the channel | role |
|-----------|------------|----------|-------------------|------|
| `sets:x`  | read-write | allowed  | yes — the FIRST `sets:` in template order; later ones adopt | the **origin** of x |
| `reads:x` | read-only  | **throws** (dev AND prod) | no — adopts | consumer |
| `edits:x` | read-write | allowed  | no — adopts, own initial value discarded | edits an x originating **elsewhere** |

## Channel rules

- **Naming creates the channel**; same name = same value. Longhand `edits:draft={org}`
  renames only the channel side — the `{...}` value is a compile-time **literal**
  identifier, never an expression.
- **Scope is per template**: the same channel name in two unrelated templates is two
  channels. Page-template channels die on navigation; shell channels survive it.
- **Seeding**: first `sets:` in template order seeds from its own current value
  (enclosing template before mounted page); everyone else adopts and their own initial
  value is discarded. Pre-seed reads observe `undefined` (type fields to include it);
  an explicit early write is never clobbered by a late-arriving seed.
- **Buffered signal, not an event**: late-hydrating islands read the latest value.
- **Retention**: the last written value outlives an unmounting origin, until a new
  `sets:` tethers or the declaring render tree unmounts.
- **`reads:` throws on write** — dev and production (dev names component + channel +
  template line). The template cannot lie about dataflow.
- **Forwarding**: `<router-outlet reads:org>` tethers the mounted page's signal matching
  the attribute's **local** name (`org`, even under longhand renaming); a page without
  it is untouched; islands nested *inside* the page are never forwarded.
- **No verb + no forwarding → black box** (exposes nothing, hears nothing).
- **SSR**: no channels server-side — every component renders its own defaults; tethering
  happens at hydration.

## `sprig map` + lint

```
$ sprig map
org: set by side-nav → edited by org-quick-rename → read by org-detail, app-detail
```

One stable-ordered line per channel, one clause per verb, forwarded pages included.
`sprig check` lints the whole template graph (and `sprig build` fails on errors):

1. verb naming a signal the component doesn't declare → **error** (`router-outlet` exempt);
2. channel with no `sets:` → **error** (no origin);
3. exactly one participant → **warning** (dead wire/typo; the forwarding element never
   counts, a matching routed page counts once);
4. more than one `sets:` → **warning** (two origins).

## Migration note

**Nested live islands are no longer the coordination pattern.** Don't promote a common
parent to a live island to share a value — restructure to **siblings under a static
frame + wiring**: owner gets `sets:`, editors `edits:`, consumers `reads:`, pages join
via `<router-outlet reads:x>`. The static parent ships zero JS and the nested-island
event-collision class disappears.

---

**See also:** [islands.md](./islands.md) · [routing.md](./routing.md) · [cli.md](./cli.md)
