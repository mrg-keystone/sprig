## 3. The waist rule — sprig's half

The waist rule is owned canonically by [`contract.md`](../../contract.md) at the git
root — LOCKED there as **D-waist**, **D-kinds**, **D-history**, **D-home**; this
section restates sprig's half only, framework-locally. `sprig:prototype`'s SKILL
(`claude/skills/sprig:prototype/SKILL.md`) owns the two-seam prototype format itself —
the seams are *born* there, not designed here. `contract.md` and its siblings
are live, rune-owned cross-repo coordination docs — that is
[§5](05-5-history-the-retired-cross-framework-record-legacy.md)'s ruling, not
this section's call.

| seam | artifact | shape/verb | the forbidden move |
|---|---|---|---|
| reads | `objects/<type>.json` | `GET` current-state DTO | never a mutable record |
| writes | `commands.json` | `POST` intent verb | never PUT/PATCH-a-record |

What a sprig UI does:

- **Reads via queries.** Every read is a current-state DTO off the read seam above.
- **Writes only by firing command verbs.** Every write is an intent verb off the
  write seam above.
- **Optimistically reflects, then reconciles.** The UI reflects the fired intent
  immediately and reconciles against the next read — e.g. fire
  `task.setStatus{done}` → the checkbox flips immediately → the next read of
  `objects/task.json` reconciles the row.

  **Decided: the read wins on divergence.** If the next read disagrees with
  the optimistic reflection — the command was rejected, or another writer
  raced it — the UI snaps its optimistic reflection to the reconciled server
  state, no silent retry, no keeping the stale optimistic value. This is
  sprig-side behavior the UI owns, not `contract.md`'s.

What a sprig UI never does:

- **Never constructs an "edit-this-record" round-trip.** No
  fetch-record → mutate-fields → PUT/PATCH-it-back flow anywhere in a sprig-built
  app.
- **Never extends the command vocabulary.** The kinds sprig emits are **LOCKED**
  at five — `create | set | append | adjust | remove` — extending it is a
  breaking contract change, not a patch.

The downstream binding rule:

- **Binds, never re-derives.** `sprig:breakdown` binds each component's
  data-need to a ratified query/command in `spec/contract/binding.md` — drift is
  a breakdown-time error. Everything below the read/write surface stays
  invisible to the UI: storage can reshape freely without changing what the UI
  sees, because the UI only ever fires intent and reads state.

Host mechanics — the generic host, HTTP introspection (`GET /objects` /
`GET /commands`), the append-only event log, and each seam's exact on-disk shape —
are `sprig:prototype`'s and `contract.md`'s territory, not sprig's half of the waist
rule.

