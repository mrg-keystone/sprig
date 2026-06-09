# to-ship

Gaps to close before handing `@mrg-keystone/isolate` to junior devs.

The core is solid and verified (10 unit + 16 e2e + live checks). What's missing
is the **on-ramp** — docs, clear errors, types, and guidance — which is exactly
what less-experienced devs need most. Ship to a senior now; close these first
for juniors.

Priority: **1–3 are blockers**, 4–5 are sharp edges.

---

- [x] **1. Docs — the #1 blocker.** ✅ Wrote a root `README.md` (install + the three
  commands, a guided 5-minute quickstart, discovery + route formula, `fixture.json` +
  case-JSON reference, per-instance controls, event log, `capture()` API, gotchas) — it
  renders on the JSR package page. Also added a skill reference doc (`isolate.md`). All
  the bullets below are covered. Write a `README.md` covering:
  - install + the three commands (`isolate list` / `dev` / `test`)
  - the `components/` · `islands/` · `pages/` convention and `/components/…` vs `/pages/…` routes
  - `fixture.json` schema: `category`, `folder`, `background`, `controls`, `components` (per-sub-component controls)
  - case JSON: bare keys → props, and specials `_name` / `_signals` / `_innerHtml` / `_mocks`
  - per-instance controls (groups keyed by `id`)
  - the event log (controls-only, payloads, type + regex filters)
  - the `capture()` test API (assert the events a component emits)
  - a 5-minute quickstart (add one `isolate/` folder, run `dev`, see it)

- [x] **2. Surface config errors instead of swallowing them.** ✅ `discover()` now
  collects problems (malformed `fixture.json` / case JSON, unresolved component files)
  instead of swallowing them, and returns `{ entries, problems }`. `dev` and `test`
  **fail fast** with a batched report before any scaffold/run (`dev --force` to preview
  the valid components anyway); `list` shows them as warnings. Each problem names the
  file and the parse position. Covered by unit tests in `discover_test.ts`.
  - Follow-up (optional): "file exists but exports the wrong name" still needs a
    module-load check to detect — filename resolution can't see exports.

- [x] **3. Type the test helper.** ✅ `ensureRunner()` now also writes `index.d.ts`
  (and `"types"` in the generated `package.json`) declaring `IsolateEvent`,
  `EventBridge`, `capture(page): Promise<EventBridge>`, `ev.expect`, and
  `ev.events$: Observable<IsolateEvent>` — typed against `@playwright/test`'s `Page`
  and rxjs's `Observable`. Verified: a sample spec type-checks under `tsc --strict`,
  with a `@ts-expect-error` on an unknown field confirming the shape is enforced (not `any`).
  - Follow-up (optional): the package resolves via `~/.isolate-runner/node_modules`
    (NODE_PATH at run time); IDE autocomplete in the host repo may need that on the
    editor's path (a symlink or tsconfig `paths`) to light up.

- [x] **4. Document the spec-writing footguns + helper.** ✅ Added a "Writing component
  tests" section to the README and `isolate.md` (specs live in `cases/<name>/tests/`,
  run via ▸/`isolate test`; both footguns — click-before-hydration, and
  `check()`/`uncheck()` on controlled checkboxes). Shipped a
  `waitHydrated(page, {timeout?})` helper in `isolate-events` (js + types), backed by a
  `__isolateReady` flag the scaffold sets once the stage is mounted + event-wired.
  Verified: a fixture spec uses it (17/17 e2e) and it type-checks under `tsc --strict`.

- [x] **5. Smaller sharp edges.** ✅
  - **stage remount on control edit** — documented in README + `isolate.md` (internal
    `useState` resets; signal/external state survives). Intended behavior, no fix needed.
  - **Windows symlink** — fixed, not just documented. `scaffold.ts`'s `linkOrCopy()`
    tries a dir symlink, then a **junction** (no elevation, still a live link), then a
    warned recursive **copy** (a snapshot — re-run to pick up edits). macOS symlink path
    verified (17/17 e2e); copy action verified to preserve cross-dir relative imports.
    The Windows-only branch *selection* is reasoned, not executed here (no Windows env).

---

## Already done (context)

- Page namespacing (`/components`, `/pages`), per-instance controls, event log
  (type + regex filters, controls-only, disabled-suppression), and the RxJS
  event stream + Playwright test bridge — all green at 16/16 e2e + 10/10 unit.
- Committed on branch `feat/pages-controls-event-stream`.
- Phase 3 (extract the event lib into `@mrg-keystone/isolate/events` subpath
  exports + publish via CI on merge to `main`) is the remaining packaging step.
