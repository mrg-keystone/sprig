# contract.md — the waist contract: queries + commands (rune ⇄ sprig)

**Coordination doc between the `rune`/`keep` repo and the `sprig` repo.**
Owner of this file: the rune-side work (`/Users/raphaelcastro/Documents/programming/rune`).
Third sibling to [`coms.md`](./coms.md) (the runtime seam) and [`coordinate.md`](./coordinate.md)
(the shared-`spec/` seam). Started: 2026-07-02.

> Goal (user's words): _"make the sprig (frontend) and rune (backend) pipelines **converge on
> one contract** instead of being hand-wired at the end ('a lot of finagling')."_

---

## TL;DR

The two pipelines are a **diamond**: one product intent at the top, two tracks down the
sides, **one contract at the waist**, one running app at the bottom (the bottom is already
solved — `serveSprig({keep, app})`, see [`coms.md`](./coms.md)). This doc owns the waist:

- **The waist rule** — the contract is **queries + commands, never an editable record.**
- **The two seam formats** — `objects/<type>.json` (reads) + `commands.json` (writes),
  born pre-extracted by the two-seam prototype format (`rnd/proto`).
- **The two bridges** — bridge 1 (up): the prototype's seams seed `rune:spec`, which
  **ratifies** them into canonical DTOs. Bridge 2 (down): `sprig:breakdown` **binds**
  component data-needs to ratified endpoints (drift-checked), and `sprig:build` generates
  a **typed client** from the rune OpenAPI.
- **The on-disk home** — `spec/contract/` at the git root (sibling of `spec/runes`,
  `spec/ui`, `spec/misc`, `spec/product` — layout per [`coordinate.md`](./coordinate.md)).

---

## The agreed interface — the waist rule

> The contract is **queries** (read current-state DTOs) and **commands** (intent verbs).
> **Never an "edit-this-record" endpoint.**

This is the agreed interface. **Do not break it without updating both sides + this doc.**

Why it's load-bearing: `rune:data` reshapes storage to be **immutable / append-only**. If
the contract were CRUD-on-records (`PUT /thing/:id`), that reshaping would break the
frontend. Because the contract is queries + commands, immutability lives **below the
waist** — it changes storage and how current-state is folded, never the read DTO or the
command surface. The UI issues an intent and optimistically reflects it; whether the
backend appends an event, bumps a counter, or overwrites is decided underneath and the UI
never knows.

**The only thing that ever crosses the waist upward** is an *additive* "expose the
history" field — and only when the prototype showed a history panel (a product decision),
never a surprise from `rune:data`.

Concretely, on each side:

- **rune side** — `rune:spec` models every `[ENT]` as either a **query** (`GET`,
  current-state read DTO: `<type>.all`, `<type>.get`) or a **command** (`POST` of an
  intent verb + input DTO: `task.setStatus`, `points.adjust`). No `PUT`/`PATCH`-a-record
  endpoints. (The `@ METHOD /path` clause exists for route shape, not for CRUD semantics.)
- **sprig side** — the UI reads via queries and writes **only** by firing commands,
  optimistically reflecting the intent and reconciling. It never constructs an "edited
  record" to send back.

---

## The two seams (as built — `rnd/proto`)

The two-seam prototype format is the keystone: the prototype is *born* with the contract
pre-extracted. The generic host (`rnd/proto/_start.ts`) does the entire server side; the
prototype author writes only presentation + the two declarations. See `rnd/proto/README.md`.

### Seam 1 — reads: `objects/<type>.json`

One JSON file per object **type**; the file is that type's **collection** (an array of
records, related by id, joined client-side). The filename (minus `.json`) is the type.
This is the draft **read model**: each file maps to a backend type + its **read DTO** +
query endpoints (`<type>.all`, `<type>.get`).

The host seeds an in-memory projection at boot (seed files stay pristine; restart = clean
reset). Adding `objects/comment.json` makes it instantly servable at `/objects/comment`.

### Seam 2 — writes: `commands.json`

Every write the UI performs is a **command** — an intent verb, never an in-place record
edit. Each entry is `{ "type", "kind", "input": {field: "type"}, "does" }` (plus `"field"`
for `append`, `"field"`/`"by"` for `adjust`). Each entry maps 1:1 to a rune command verb +
input DTO, and its `kind` seeds `rune:data`'s immutability strategy:

| `kind` | prototype host does | rune:data strategy (below the waist) |
|---|---|---|
| `create` | append a new object (auto-id) | already-immutable (fresh ids) |
| `set` | record new field values | append-child / aggregate / overwrite-justified — **decided below the waist** |
| `append` | push a child onto a collection field | append-child (history matters) |
| `adjust` | atomic numeric move by `input.by` | aggregate (a derived counter) |
| `remove` | tombstone | remove command + retention policy |

(The vocabulary is authored in `rnd/proto/commands.json` under `"$kinds"` — the file is
self-documenting; the host strips `$`-prefixed keys.)

### The runtime seams + HTTP introspection

The host injects two browser globals (`_start.ts:113-130`) backed by HTTP routes
(`_start.ts:205-269`):

```js
window.objects  = { types(), all(type), get(type, id) }  // GET /objects, /objects/:type, /objects/:type/:id
window.commands = { list(), run(name, input) }           // GET /commands, POST /commands/:name
```

**The whole contract is introspectable over HTTP** — `GET /objects` + `GET /commands` — so
a tool can read it and derive the rune spec without opening a file. Applied commands are
appended to `events.json` (`GET /events`); **the log is the source of truth, the in-memory
projection is derived** — the same shape `rune:data` builds below the waist for real.

Swap the host's resolver for a real keep backend and **the UI does not change.**

---

## On-disk homes (git root, per `coordinate.md`)

```
spec/
├── product/            # rune:scope (unchanged)
├── ui/
│   ├── design-system/  # sprig:design (unchanged)
│   ├── <app>-prototype/            # NEW SHAPE — the two-seam prototype (was one .html)
│   │   ├── _test-prototype.html    #   presentation only (fixed name — the host serves it)
│   │   ├── objects/<type>.json     #   seam 1 — the read model
│   │   ├── commands.json           #   seam 2 — the write contract
│   │   ├── _start.ts               #   the generic host, copied verbatim from rnd/proto
│   │   ├── deno.json               #   `deno task start` → localhost:8723
│   │   └── feedback/               #   annotate sink (POST /_feedback)
│   └── breakdown/      # sprig:breakdown (data-model.md → superseded by the binding)
├── contract/           # NEW — the ratified contract's home (mostly GENERATED)
│   ├── draft/          #   bridge-1 snapshot: objects/ + commands.json lifted from the prototype
│   ├── openapi.json    #   generated from the built keep backend (/docs/<m>/json export)
│   ├── client/         #   generated typed client (DTO types + query/command wrappers) — sprig:build imports it
│   └── binding.md      #   bridge-2 binding: component → endpoint → DTO (drift-checked)
├── runes/              # rune:spec — ratifies the contract (canonical DTOs live HERE)
└── misc/               # rune:data + cake artifacts (unchanged)
```

- `spec/contract/` is whitelisted in rune's structure lint via `lang/keywords.json`
  (`spec/` node: `"contract/": { $ignore: "*" }`), same treatment as `spec/ui/`.
- The **canonical** contract is the `.rune` spec (`spec/runes/`); `spec/contract/` holds
  the *derived, machine-readable* faces of it plus the prototype-seeded draft. Nothing in
  `spec/contract/` is hand-edited except `binding.md`'s prose.

---

## Bridge 1 (up) — the prototype seeds the spec

The prototype is the **discovery** surface. Its two seams already *are* the draft contract:

1. `sprig:prototype` emits the two-seam format (above) — bridge 1's producer.
2. The seams are snapshotted to `spec/contract/draft/` (copy the files, or introspect a
   running host via `GET /objects` + `GET /commands`).
3. `rune:spec` consumes the draft as its **seed inventory** and **ratifies** it into
   canonical DTOs — the "authored once" moment:
   - `objects/<type>.json` → a `[NON]` type + read DTO + query endpoints
     (`<type>.all`, `<type>.get`).
   - `commands.json` → command verbs + input DTOs; each `kind` rides along as the
     immutability hint `rune:data` consumes.

The prototype is **not** a competing source of truth; it's the input to ratification.
`rune:spec` may rename/merge/split during ratification — but every seam entry must be
either ratified or explicitly dropped (a product decision, noted in the spec).

## Bridge 2 (down) — everyone derives from the ratified contract

- **`sprig:breakdown`** stops re-deriving its own schema (`data-model.md`) and instead
  **binds** each component's data-need to a real endpoint + DTO from the ratified
  contract → `spec/contract/binding.md`. A data-need with no matching endpoint/DTO is a
  checkable **drift error at breakdown time**, not a runtime surprise. (Standalone
  breakdowns with no contract at the git root fall back to the legacy `data-model.md`.)
- **`sprig:build`** generates a **typed client** from the rune OpenAPI into
  `spec/contract/client/` — DTO types + one wrapper per query/command. `resolve.ts` /
  islands import the real DTO types and call real endpoints; no hand-typed shapes.
  (SSR still uses the in-process `Backend` DI token; islands still hop `/api/*` —
  the client wraps both, per [`coms.md`](./coms.md).)

---

## Status matrix

| # | Requirement | State | Where |
|---|---|---|---|
| 1 | Two-seam prototype format (the keystone) | ✅ DONE | `rnd/proto` (host + README + examples) |
| 2 | `contract.md` keystone doc | ✅ DONE | this file |
| 3 | `sprig:prototype` emits the two seams (bridge 1 producer) | ✅ DONE | `claude/skills/sprig:prototype/SKILL.md`, `claude/agents/sprig-prototype-builder.md`, `claude/skills/interfaces/prototype.md` |
| 4 | `rune:spec` waist rule + seed ratification (bridge 1 consumer) | ✅ DONE | rune: `claude/skills/rune:spec/SKILL.md`, `claude/agents/rune-spec-author.md` |
| 5 | `rune:scope` hands off the seams as the seed inventory | ✅ DONE | rune: `claude/skills/rune:scope/SKILL.md` |
| 6 | `rune:data` stays below the waist | ✅ DONE | rune: `claude/skills/rune:data/SKILL.md`, `claude/agents/rune-data-designer.md`, `claude/agents/rune-data-reconciler.md` |
| 7 | `sprig:breakdown` binds instead of re-deriving (bridge 2) | ✅ DONE | `claude/skills/sprig:breakdown/SKILL.md`, `claude/skills/interfaces/ui-breakdown.md`, `claude/agents/sprig-breakdown-analyst.md`, `claude/agents/sprig-breakdown-spec-writer.md` |
| 8 | `sprig:build` generates the typed client (bridge 2) | ✅ DONE (discipline declared) | `claude/skills/sprig:build/SKILL.md`, `claude/agents/sprig-build-scaffolder.md`, `references/serving.md` |
| 9 | `spec/contract/` allowed by rune's structure lint | ✅ DONE | rune: `lang/keywords.json` `spec/` node + structure rule test |
| 10 | `interfaces/` declares the cross-boundary contract | ✅ DONE | `claude/skills/interfaces/README.md` |
| 11 | Typed-client **generator tooling** (mechanical `openapi.json` → `client/`) | ✅ DONE | `dev-tools/contract` — `contract client` (deterministic `dtos.ts` + `client.ts`; tested against the real e2e/checkout OpenAPI incl. emitted-code type-check + runtime) |
| 12 | Contract snapshot tooling (prototype seams → `spec/contract/draft/`) | ✅ DONE | `dev-tools/contract` — `contract snapshot <folder\|url>` (pristine-seed copy, or live-host introspection over `GET /objects` + `GET /commands`) |

## Task split

### RUNE side (`/Users/raphaelcastro/Documents/programming/rune`)
- [x] Waist rule in `rune:spec` (SKILL granularity block + spec-author procedure/never).
- [x] Bridge-1 seed consumption in `rune:scope` ("Feeding rune:spec" + procedure seed step).
- [x] Below-the-waist guardrails in `rune:data` designer + reconciler.
- [x] Whitelist `spec/contract/` in `lang/keywords.json` + structure-rule test.
- [ ] Later: emit/refresh `spec/contract/openapi.json` as part of the build pipeline.

### SPRIG side (`/Users/raphaelcastro/Documents/programming/sprig`)
- [x] `sprig:prototype` + builder agent emit the two-seam format; `interfaces/prototype.md`
      re-declares the artifact shape.
- [x] `sprig:breakdown` + analyst bind against the contract (binding.md, drift errors);
      legacy `data-model.md` only when no contract exists.
- [x] `sprig:build` + scaffolder + `references/serving.md` consume the typed client.
- [x] `interfaces/README.md` lists the cross-boundary contract, pointing here.
- [x] The `contract` CLI (rows 11-12) — landed as `@dev-tools/contract`
      (`/Users/raphaelcastro/Documents/programming/dev-tools/contract`; `deno task install`
      → a global `contract` command).

## Decisions

- **D-waist (LOCKED):** queries + commands, never an editable record. The single rule the
  whole diamond hangs on.
- **D-kinds (LOCKED):** the write-side vocabulary is `create | set | append | adjust |
  remove`, authored in `commands.json`, consumed by `rune:data` as the immutability seed.
  Extending it is a breaking contract change (both repos + this doc).
- **D-history (LOCKED):** history crosses the waist upward only additively, and only as a
  product decision made visible by the prototype — never as a `rune:data` side effect.
- **D-home (LOCKED):** the ratified contract's machine faces live in `spec/contract/` at
  the git root; the canonical source stays the `.rune` spec in `spec/runes/`.
- **D-fallback:** breakdown without a contract at the git root falls back to legacy
  `data-model.md` (standalone mock breakdowns stay useful outside the diamond).

## Append log

- 2026-07-02 (later) — rows 11-12 closed: `@dev-tools/contract` CLI (dev-tools workspace) —
  `contract snapshot` (prototype folder or live host → `spec/contract/draft/`) +
  `contract client` (keep OpenAPI → `spec/contract/client/`, field-source params routed,
  `x-keep-process` as JSDoc, cross-module DTO collision handling). 8 tests green incl. a
  type-check + runtime pass on the emitted client; ground-truth fixtures dumped from rune's
  `e2e/checkout` via the in-process `backend.fetch`.
- 2026-07-02 — doc created (executing rune's `upgrades.md`). Skills re-edged on both
  sides per the modification map: waist rule into `rune:spec`, bridge-1 seed into
  `rune:scope`, below-the-waist guardrails into `rune:data`'s designer/reconciler,
  two-seam output into `sprig:prototype`, binding into `sprig:breakdown`, typed-client
  discipline into `sprig:build`, contract row into `interfaces/README.md`,
  `spec/contract/` whitelisted in rune's structure lint. Rows 11-12 (mechanical tooling)
  left open deliberately — the formats are hand-usable today.
