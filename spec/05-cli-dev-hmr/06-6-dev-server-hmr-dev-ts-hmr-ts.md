## 6. Dev server + HMR (`dev.ts`, `hmr.ts`)

`createDevServer` wraps the PROD handler and adds: a 60ms-debounced
`Deno.watchFs(srcDir)`, an SSE channel `<base>/_sprig/hmr`, and a live AST endpoint
(contract below). Rebuilds are serialized through one in-flight drain loop; each
change kind is isolated in try/catch.

**AST endpoint contract:**
| | |
|---|---|
| method + path | `GET <base>/_sprig/ast/<sel>` |
| `200` | body = the AST JSON — the SAME shape as the `template` event's `template` field (schema below) |
| `400` | `<sel>` is a malformed selector (an unparseable percent-escape) |
| `404` | `<sel>` is a well-formed but unknown selector |
| bare-selector ambiguity | a page-local island and a same-basename global component both match — the island wins |
| consumer | 03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s late-mount fetch, catching up a mid-session hydration; falls back to the baked AST on failure |

Change → action table:
| edit kind | server action | SSE event + payload | client action ([03 §9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md) row) |
|---|---|---|---|
| `template.html` | `renderer.reparse(relDir)` | if changed: `{type:"template", sel, template: astFor(relDir)}` | `template` row |
| `styles.css` / `src/css-variables.json` | `buildCss` | `{type:"css", v}` | `css` row |
| any other `.ts` | supervised: supervisor restart (exit 75) — ESM can't evict a cached module subgraph; unsupervised: rebuild | supervised: none — channel drops, client reconnects; unsupervised: `{type:"reload"}` | supervised → late-`onopen` row; unsupervised → `reload` row |
| anything else | NONE — matches no branch (dev.ts:94-104) | none | n/a — stale until the next restart |
| any of the above, if the reparse/`buildCss`/rebuild throws | caught in that kind's own try/catch (isolated per kind above) | `{type:"error", message}` + a LOUD required `console.error` in the dev-server terminal (dev.ts:31-42) — the fix for rebuilds that used to fail silently in dev while the identical build failed the prod deploy | `error` row |

Payload schema (SSE `data:` body — one JSON object per message, default `event:
message`; the discriminator is the body's `type` field, not the SSE `event:` line, so
03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md) dispatches
by reading `payload.type`):
- `{type:"template", sel: string, template: <AST>}` — `sel` is the bare selector
  (Identity rule, below); `template` is the SAME AST shape the AST endpoint contract
  (above) returns and that 03
  [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s
  `hotTemplate(sel, ast)` consumes.
- `{type:"css", v: string}`
- `{type:"reload"}` — no other fields.
- `{type:"error", message: string}` — emitted whenever a reparse/`buildCss`/rebuild
  throws (change→action table, above); paired with the LOUD `console.error` in the
  dev-server terminal (dev.ts:31-42), so a failed rebuild is never silent even with no
  browser watching. 03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s
  `error` row logs it client-side too.

**Settled:** the client stamps the SERVER-SENT `v` on every stylesheet, not a
client-minted token — one version source, matching how `#__sprig_config.v` versions
chunk loads elsewhere (04-build
[§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)).
`v` is a required field on the `css` payload (schema above), so the wire value is
always read; 03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s
`css` row ("bump every stylesheet `?v=`") means this `v`.

`src/css-variables.json` is the LEGACY per-app token source — distinct from, and one
letter off from, the PREFERRED `bootstrap/css-tokens.json` (spec 04
[§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)
item 5, spec 05 [§2](02-2-command-surface.md)). Only `css-variables.json` hot-applies —
it lives inside the watched `srcDir`, hence the dispatch branch above.
`css-tokens.json` lives in `ui/bootstrap/`, OUTSIDE the watched `srcDir`: it has no
dispatch branch and never hot-applies; an edit lands only on the next restart.

The table is total: every other path is dropped by the dispatcher. Notably
`routes.json` (routes load at boot; an edit lands only on the next restart — any `.ts`
edit or a `sprig dev` re-run; `watchProjectForRestart` excludes the app subtree) shares
`css-tokens.json`'s known dev-loop gap: neither hot-applies.

**Identity rule (bug W):** reparse is keyed by relDir (a page-local component never
clobbers a same-basename global), while the SSE `sel` is the bare selector because the
client matches mounted islands by `data-sel` (dev-hmr-reldir.test.ts).

**Trace** — a dev saves `counter/template.html`: `Deno.watchFs` fires, the 60ms
debounce settles, the serialized drain loop picks it up, `renderer.reparse("counter")`
returns changed, and the server emits `{type:"template", sel:"counter", template:
astFor("counter")}` on `<base>/_sprig/hmr` — 03
[§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s `template`
row. Contrast a `counter/logic.ts` save: any-other-`.ts`, so under a supervisor the
process exits 75 and restarts (the client's late `onopen` fires — 03
[§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s
late-`onopen` row); unsupervised, the server rebuilds and emits `{type:"reload"}`
instead (03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)'s
`reload` row).

**Acceptance criteria** — what a correct implementation of this section must satisfy:
- **AST endpoint contract:** every status and body in the contract block above holds
  — `400`/`404`/`200` are mutually exclusive outcomes for a given request, and the
  bare-selector ambiguity always resolves to the island, never the global.
- **Dispatch-table totality:** a watched-path edit matching none of the table's
  branches (`template.html`, `styles.css`, `css-variables.json`, any `.ts`) produces
  NO SSE event and NO server action — the table is total by omission, not by an
  explicit catch-all branch.
- **Serialization:** every rebuild funnels through one in-flight drain loop — a save
  landing mid-build coalesces into the pending set rather than racing a second build
  against the same `outDir`; each change kind (template/css/reload) is isolated in
  its own try/catch so one kind's failure never suppresses the others' updates in the
  same batch.
- **Identity rule:** `reparse`/`astFor` are addressed by relDir (a page-local
  component never clobbers a same-basename global), while the SSE `sel` is
  nonetheless the bare selector, since the client matches mounted islands by
  `data-sel` — pinned by `dev-hmr-reldir.test.ts`.
- **The gate:** the compiled client bundle is byte-identical dev↔prod; only the
  runtime `cfg.hmr` flag differs, so nothing HMR-related executes — or even opens a
  connection — in prod — pinned by `hmr-config-gate.test.ts`.

> **[DECIDE]** The AST endpoint's 400/404 responses, the dispatch table's totality,
> and the drain loop's serialization guarantee are not yet pinned by a named test in
> this section's citation set, unlike the Identity rule (`dev-hmr-reldir.test.ts`) and
> the gate (`hmr-config-gate.test.ts`) above. Recommended default: add a dedicated
> test for each once this section stabilizes, following the same "pinned by
> `<file>`" convention the rest of this doc family uses.

Client side (`hmr.ts`): `startHmr(cfg.base)` is the boot-sequence call (03
[§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md) boot step 2), run
BEFORE hydration. It opens the `EventSource` on `<base>/_sprig/hmr` and dispatches
every `template`/`css`/`reload`/`error` event from its `onmessage`/`onopen` handlers.
It first calls `enableHmr()` (`hydrate.ts`, NOT `hmr.ts`) — that call only flips the
`hmrEnabled` flag so islands register as live instances; it handles no events itself.
**Gate:** the call site is `if (cfg.hmr) startHmr(cfg.base)` (build.ts:176) — nothing
opens in prod; the compiled bundle is byte-identical dev↔prod, only the runtime data
flag `cfg.hmr` differs (hmr-config-gate.test.ts). Per-event client behavior — what
each of `template`, `css`, `reload`, `error`, and a late `onopen` does — is owned by
03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md); see the
change→action table above for which event each edit kind produces.

