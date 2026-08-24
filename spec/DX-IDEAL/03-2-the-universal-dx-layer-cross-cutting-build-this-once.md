## 2. The universal DX layer (cross-cutting — build this once)

### 2.1 A diagnostics contract [CLEAR WIN]
Every failure — across the request path (`guard`, `grant`, `resolve`,
`render`) and the build/authoring/boot lifecycle (`compile`, `hydrate`,
`build`, `serve`) — carries a structured diagnostic tagged with one
canonical, closed `phase` enum: `guard | grant | resolve | render | compile |
hydrate | build | serve`. [§3](04-3-per-subsystem-ideal.md).1's request-path 500 diagnostic
(`guard|grant|resolve|render`) is a subset of this same enum, not a separate
vocabulary. The record shape is
`{ componentFolderPath, location, phase, cause, fixHint }`, where `location`
is always a `file:line` pointer. `componentFolderPath` is optional: present
for a component-scoped failure (`compile`/`render`/`hydrate`), where
`location` is `template.html:line` or `logic.ts:line` relative to it; absent
for a build/serve/boot failure with no owning component (e.g. §3.6's
`assetsDir` empty/missing, §3.4's stale `static/`, §3.6's session-mode
mismatch), where `location` instead names the relevant config/build file
directly (e.g. `sprig.config.ts:12`). One format, one overlay, one log
shape. "Silent-wrong-behavior" is declared a **defect class**: the framework
never ships a new one.

### 2.2 A dev error overlay [CLEAR WIN]
A single in-page overlay (reusing the annotate injection machinery) that surfaces:
compile errors with a clickable frame into the developer's *own* source (never a
generated entry file), template parse/semantic errors, hydration failures,
runtime 500s with phase + stack, and the dual-runtime condition. The
"last-good page stays mounted with state intact" guarantee applies to
CLIENT-SIDE/HMR faults on an already-mounted page — a template edit, a signal
error, a hydration failure arriving over the SSE channel after initial load —
where a mounted page genuinely exists to preserve. It does NOT apply to an
initial-load SSR 500: SSR runs before any client mount, so there is no mounted
page to keep alive. That case gets its OWN full-page dev error document
instead — the same diagnostic contract (§2.1) rendered as the page itself
(phase, cause, `template.html:line`/`logic.ts:line`, fix hint) rather than an
overlay atop nothing. Prod ships none of it.

**Streaming SSR needs its own path.** Everything above describes the BUFFERED
render branch (spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 10), which is wrapped in a try/catch. The
streaming branch — the scaffold default whenever `createRenderer`'s
`SsrRenderer.renderStream` is present, which bootstrap prefers over the
buffered path by priority (spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 10; spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)) — has no such
wrapper. A throw before emission begins propagates uncaught out of `fetch()`
(a host-level concern, out of this document's scope, unchanged). A throw
AFTER emission begins is strictly worse: the 200 status and headers are
already sent as the response head, so it can never become a 500 — the stream
simply errors and the transfer terminates abnormally (spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 10).
Left alone, that's a truncated 200 with no signal in either mode. The ideal
splits it the same way as everywhere else:
- **Dev buffers the stream.** Behind `cfg.hmr`, wrap `renderStream`'s output
  in a buffering sink instead of piping it straight to the response: a throw
  anywhere during generation is caught before any byte reaches the client,
  and renders through the SAME full-page dev-error document an initial-load
  SSR 500 gets, named with `phase: "render"` like every other controlled
  error ([§3](04-3-per-subsystem-ideal.md).1). The named cost: for the duration of that request, dev's
  time-to-first-byte no longer matches prod's real streaming behavior —
  an explicit tradeoff for turning a silently truncated page into a located
  diagnostic, not a violation of dev/prod behavioral parity (invariant, [§6](07-6-what-must-not-change-the-good-dx-to-protect.md)),
  which governs SHARED code paths, not byte-arrival timing.
- **Prod routes the caught error through the existing seams.** The stream
  wrapper catches the throw, logs it server-side with `phase: "render"` — the
  SAME log site [§3](04-3-per-subsystem-ideal.md).1's "the 500 names its phase" already writes — and calls
  the opt-in `config.onError` hook (§2.3) with the real error. The response
  body itself is unchanged (still a truncated 200; a head/status already sent
  to the client can't be rewritten), but the failure is no longer wholly
  invisible: an on-call dev with `onError` wired, or grepping the server log,
  finds the same phase-named record a buffered 500 produces.

### 2.3 Observability surfaces [CLEAR WIN]
- `window.__sprig.islands()` → every host's `{ selector, folder, trigger, state, error? }`.
- Island lifecycle stamped on the host: `data-sprig-island-state="registered|armed|loaded|hydrated|failed|released"`.
- A build receipt (see [§3](04-3-per-subsystem-ideal.md).4) and a `sprig doctor` (see [§3](04-3-per-subsystem-ideal.md).8) as the machine-readable
  "state IS the receipt" surfaces agents can trust without re-verifying.
- A `sprig dev --json` diagnostic stream / a `/_sprig/diagnostics` endpoint emitting
  the §2.1 structured diagnostic records as they happen — "receipt IS the state"
  applied to LIVE dev diagnostics, not just point-in-time ones. Today an agent
  driving `sprig dev` has `window.__sprig.islands()`, the build receipt, and `sprig
  doctor --json` for static state, but the only way to learn about a live
  compile/template/hydration failure is to scrape the overlay DOM or grep stderr —
  the one surface in this section with no structured feed.
- **A thin, opt-in prod error-reporting seam** [FORK]. Today a deployed 500
  leaves only the optional `x-sprig-error-phase` header ([§3](04-3-per-subsystem-ideal.md).1) and one server
  log line — there is no prod-side surface at all once a request has left the
  process (no dashboard, no aggregation, nothing an on-call dev can query
  without shell access to the deploy target). Consistent with this document's
  remove-the-silence thesis, add an opt-in `config.onError?(err, {phase,
  matched, requestId})` hook `bootstrap()` calls alongside the existing
  server-side log (never instead of it, never blocking the response) so an
  app can wire its own reporting (Sentry, a webhook, structured log shipping)
  without sprig prescribing one. Off by default; the prod response body and
  headers stay UNCHANGED (invariant 4) — the hook receives the real error
  server-side, but the framework never leaks a stack into the response or into
  the hook's default (no-op) behavior. *Recommend: ship the hook, not a
  bundled reporting integration* — picking a vendor is out of scope for a
  framework; the seam is the ideal, the destination is the app's choice.

### 2.4 The inventory this eliminates
The silent-failure modes the universal layer turns into located dev diagnostics
(each detailed in its subsystem below): fail-open grants; unresolved route
`load`/`guards` entries; the guard `[]`→root
trap; the opaque 500; a mid-stream render throw (a truncated 200 with no
signal, since the head is already sent — §2.2); `inject()`-after-await; StateService prod key collision;
template identifier/pipe typos; inert `*ngIf`/`@defer`; a template with event/
two-way bindings and no sibling `logic.ts` (looks interactive, renders static,
never hydrates); component-tag miss and native-name shadow; daisyUI class
collision; silent non-hydration; props-bridge
value drops; `{setup}` capability cliff; client `output()` no-op; the inert
`onServerDestroy`/`hydrateOnClient`/`destroyOnClient` lifecycle hooks; stale
committed `static/`; silent session-mode downgrade; blank-page asset-path misderivation;
the green-while-broken test exit; the one-bad-fixture blank workbench; case-JSON
props that never reach an island; cross-repo pin/contract drift; the silent
soft-nav→full-nav fallback; the composed-monorepo prod live-parse fallback.

