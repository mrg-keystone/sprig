## 4. The workbench UI (`app/`)

| part | route / file location | kind | job |
| --- | --- | --- | --- |
| workbench page | route `""` | page | resolves discovery SSR-only via `DiscoveryService.manifest(ISOLATE_PROJECT)` (in-process `Backend.get("/http/get-manifest")` — no TCP hop); hosts the `<workbench>` island |
| gallery pages | routes `/components`, `/pages` | page | static SSR grouping target→category→folder; hosts one `<run-tests>` island per case |
| preview routes | generated `/components\|pages/<category>/[<folder>/]<name>` | generated route | one page per case; renders the target as a sibling of `<stage-bridge>` |
| `<workbench>` | rendered on the workbench page | island | the whole shell: navigator, ⌘K palette, viewport/zoom/grid/background tools, resizable dock (controls/console/tests tabs), toasts, hash routing |
| `<run-tests>` | rendered on the gallery pages, one per case | island | POSTs `/api/http/post-test-run` from the browser — a real network request, unlike the workbench page's in-process manifest call above; endpoint mechanism + no-auth stance: [§3](03-3-the-server-server-a-rune-generated-keep-backend.md) |
| stage-bridge | `lib/preview-harness.ts` (no-render re-export) | island | lives INSIDE the preview iframe as a sibling of the target; implements the postMessage protocol below |

**The dock's tests tab ↔ `<run-tests>` relationship**: unlike the controls tab
(`set`) and console tab (`event`), the tests tab isn't wired through the stage
bridge at all — it is one of three independent `post-test-run` callers, none a
mirror of another and none a link-out to another. All three POST the same
endpoint, `/api/http/post-test-run`, each as its own separate request:

| caller | trigger | scope | local state | never shares |
| --- | --- | --- | --- | --- |
| dock's tests tab | "▸ run tests" → `<workbench>`'s `runTests()` | the active case | a `TestState` (`idle` / `running` / `done`, `results`, `error`) backing the tab; also sets the active case's dot in the navigator's `caseStatus` | a run or result *detail* with the gallery's `<run-tests>` |
| topbar | "Run all tests" → `<workbench>`'s `runAll()` | every case, in sequence | only the navigator's per-case dots (`caseStatus`), each flipped `running` → `pass`/`fail` as its case runs — it never touches the dock tests tab's `TestState` | a run or result *detail* with the gallery's `<run-tests>`, and never populates the dock tests tab's `TestState` |
| gallery page | `<run-tests>` island, one per case | its own one case | its own independent POST + result state | a run or result with the dock's tests tab or the topbar |

The one surface the dock's tests tab and the topbar's "Run all tests" both
write is the navigator's `caseStatus` dots. Beyond that shared dot, each
caller's detail state is private: triggering one never updates another
caller's detail state, and no caller ever shares a run or a result with the
gallery's `<run-tests>`.

**The postMessage protocol** (`source/target: "isolate-stage"`):

| type | direction | payload fields | trigger | receiver's effect |
| --- | --- | --- | --- | --- |
| `set` | shell → stage | `scope`, `key`, `instKey?`, `value` | a dock control edit | stage applies the value by `scope`: `signal` → live `signal.set` on the target's captured `el.__sprigScope`, no reload; `prop` → iframe reload with a `?<key>=<value>` query override; `html` → iframe reload with `_html=<value>`; `sub` → `instKey` is a DOM selector for one sub-component instance (e.g. `#css`) — a match writes it live, no match reloads with `_m.<instKey>.<key>=<value>` |
| `request` | shell → stage | — | shell (re)attaches to an already-booted stage (e.g. soft-nav re-hydration) | stage re-publishes its current state: re-sends `ready` (its payload carries `instances`, below) |
| `ready` | stage → shell | the full control surface — `name`, `background`, `html` (the current innerHtml value, post any `_html` edit, or `null`), `controls`, `instances` — plus `hydrated` flag | stage finishes booting (island: scope attach, `hydrated:true` once `_signals` applied; static: SSR markup is already final — no attach step, `hydrated:true` immediately) | shell mirrors `hydrated` → `__isolateReady` on the main frame; `instances` gives the shell the per-sub-component control groups the dock renders, keyed by the selector `set`'s `instKey` addresses |
| `event` | stage → shell | `{time, source, type, detail}` | a DOM interaction inside the iframe whose target lies within an interactive element — `a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]` — that is not `disabled`/`aria-disabled="true"`; interactions on non-interactive elements emit no `event` | shell forwards it → `__isolateEmit` on the main frame, feeding the dock's console tab; `source` is the matched interactive ancestor as `tagName` or `tagName#id` (not the raw target); `detail` is `key=<k>` for a keydown, `checked=<b>` for a checkbox, `value="<v>"` for input/select/textarea, else the element's trimmed textContent (≤40 chars) |

The bridge binds listeners once per document and delegates through a module-level
`active` handle (survives soft-nav re-hydration).

**Fixture data injection** — `previewResolve(meta, base, ctx)` is the SSR seam
(returns `{meta, caseData, __mocks}`); the bridge is the live seam. Island targets
carry NO input bindings on their tag: among `props`/`_innerHtml`/`_signals` case
data, only `_signals` binds to an island, applied post-hydration (`#css`
sub-controls and `_mocks` reach an island too, but by writing the DOM/children
directly rather than through the tag's bindings — see the `#css` and `_mocks`
rows below). Rows below are data kinds, columns are the
target's `meta.kind`:

| data kind | island (`kind:"island"`) | static (`kind:"static"`) |
| --- | --- | --- |
| `props` (bare keys) | seed-dock-only: values seed the dock's prop-control display, never reach the island (its tag has no input bindings). Edit → iframe reload; island itself unaffected | SSR: `base.props` + query-string overrides bind directly to the target. Edit → iframe reload with query overrides |
| `_innerHtml` | N/A — static-only field, island tag has no input bindings | SSR: `_innerHtml` → `innerHtml` on the target. Edit → iframe reload with query overrides |
| `_mocks` | SSR: `_mocks: {<childName>: "stub" \| true \| {stub?, props?}}` → child mock/stub (returned as `__mocks`); applies to child components regardless of the parent's own kind. Edit → iframe reload with query overrides | same as island column |
| `_signals` | not applied at SSR (bridge applies post-hydration: grabs `el.__sprigScope`, retry 60×40ms for hydration order, then marks ready). Edit → live `signal.set`, no reload | N/A — a static target's SSR markup is final and ready immediately; no signal scope |
| `#css` sub-control (full-form `target:"#css"` only) | direct-DOM write, both initial apply and edits — bypasses props/signals entirely | direct-DOM write, same |

**Acceptance criteria** — the protocol and fixture-injection tables above must hold:
- Listeners (DOM events + `message`) bind exactly once per document; soft-nav to a
  new case swaps the module-level `active` handle instead of adding a second set —
  they never accumulate across cases.
- `__isolateReady` resets to `false` at the start of every case, before that case's
  own readiness is determined.
- A static target's stage posts `ready` with `hydrated:true` immediately — no scope
  wait.
- An island target's stage posts `ready` with `hydrated:true` only after its scope
  is attached and the case's `_signals` are applied, retried up to 60× at 40ms
  intervals.
- A `set` with `scope:"signal"` mutates the live signal, no reload; `scope:"prop"`,
  `scope:"html"`, and an unmatched `scope:"sub"` each reload the iframe with a query
  override instead.
- `request` re-publishes the stage's current state — it never re-derives a new one.
- The dock's tests tab and the gallery's `<run-tests>` island never share a run or a
  result: triggering one never updates the other.
- "Run all tests" writes only the navigator's `caseStatus` dots, one per case — it
  never populates the dock tests tab's `TestState`; that detail is written only by
  the dock's own "▸ run tests", for the active case.

**Worked example — an island case, end to end:** route
`/components/inputs/counter/default` (the `counter` component's `default` case) hits
the generated preview page. Generation already decided `counter` is an island
(`targetTag`, [§2](02-2-the-isolate-cli-cli.md) rule 6) and gave its tag no input
bindings; `previewResolve(meta, base, ctx)` passes `base`'s case data (here
`_signals: {count: 5}`, unedited) through, folds in any query overrides, and returns
`{meta, caseData, __mocks}`. The page renders `<counter>` as a sibling of
`<stage-bridge [meta] [caseData]>` inside the preview iframe. The iframe boots: the
stage-bridge island grabs `<counter>`'s `el.__sprigScope`, applies `_signals` via
`signal.set` (retry 60×40ms for hydration order), then posts `{type:"ready", ...}`
with the control surface + `hydrated:true`. The shell mirrors `hydrated` →
`__isolateReady` and reveals the dock. The user drags the `count` control to `6`: the
shell posts `{type:"set", scope:"signal", key:"count", value:6}`; the stage sets it
live via `signal.set` — no reload. Contrast a static case (e.g. a static `card`
component's `default` case): its stage-bridge has no attach step, so it posts `ready`
with `hydrated:true` immediately — the shell reveals the dock right away, no retry
wait. A `prop` edit (`{type:"set", scope:"prop", key:"title", value:"…"}`) then posts
no live `set` — the shell reloads the iframe with the edited value as a query
override.

