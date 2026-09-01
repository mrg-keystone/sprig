# Wiring islands — `sets:` / `reads:` / `edits:`

Sibling islands share state via three directional verbs on the tag where a component is
**instantiated** (signals under the hood). Never wrap siblings in a live parent island to
share a value, and never reach for a shared store module — wire them:

```html
<!-- shell/frame — STATIC (no logic.ts): reads as a story -->
<div class="frame">
  <side-nav sets:org></side-nav>                       <!-- the ORIGIN of org -->
  <org-quick-rename edits:draft={org}></org-quick-rename> <!-- edits it (own field `draft`) -->
  <main><router-outlet reads:org></router-outlet></main>  <!-- pages read it -->
</div>
```

Each participant just declares an ordinary signal field; the tether replaces the field at
hydration. Type `reads:`/`edits:` fields to include `undefined` (pre-seed value):

```ts
org = signal<string | null>(null);                 // origin (sets:) — no widening needed
draft = signal<string | null | undefined>(null);   // edits:/reads: — widened
```

| verb | tether | `.set()` | seeds channel | role |
|---|---|---|---|---|
| `sets:x` | read-write | ok | FIRST `sets:` in template order (later ones adopt) | origin |
| `reads:x` | read-only | **throws** (dev+prod) | no — adopts | consumer |
| `edits:x` | read-write | ok | no — adopts, own initial discarded | edits a value originating elsewhere |

Rules that matter when building:

- Naming creates the channel; longhand `edits:draft={org}` renames only the channel side
  and the `{org}` is a compile-time **literal** (never an expression).
- **Scope is per template**: same name in unrelated templates = different channels.
  Page-declared channels die on navigation; shell-declared ones survive and **retain**
  the last written value across page swaps.
- Buffered: late-hydrating islands adopt the current value; pre-seed reads see
  `undefined`; an early explicit write is never clobbered by a late seed.
- **Forwarding**: `<router-outlet reads:org>` tethers the mounted page's signal matching
  the LOCAL name (`org`); pages without it are untouched; islands nested inside the page
  are not forwarded. Pages themselves carry no verb.
- No verb + not under a forwarding outlet = fully private black box.
- SSR renders every component from its own defaults (`@if (x())` empty states) —
  channels exist only client-side.

Lint (runs in `sprig check`; `sprig build` fails on errors): verb naming an undeclared
signal → error (router-outlet exempt); channel with no `sets:` → error; exactly one
participant → warning; multiple `sets:` → warning. `sprig map` prints every channel
(`org: set by side-nav → edited by org-quick-rename → read by org-detail, app-detail`) —
run it after wiring to prove the dataflow.

**Migration**: nested live islands are no longer the coordination pattern — restructure
to siblings under a static frame + wiring (owner `sets:`, editors `edits:`, consumers
`reads:`, pages via `<router-outlet reads:x>`), and delete manual store/outlet bridges.
