# proto — the prototype format (fake backend, real seam)

A clickable prototype that **separates the UI from the backend across two seams**,
so the two can be built apart and assembled later. No backend decisions are baked
in: the "backend" is faked by the host. The UI is pure HTML + CSS + JS.

```
deno task start          # → http://localhost:8723
```

## The whole idea

The AI building this writes **only presentation + two tiny declarations.** The host
(`_start.ts`) is generic — it knows nothing about this app — and does the entire
server side. So the thing that matters is the HTML/CSS/JS.

| You author | File(s) | Role |
|---|---|---|
| **UI** | `_test-prototype.html` | Pure presentation. Holds **no data**. Talks only to the two seams. |
| **Reads** | `objects/*.json` | One file per object **type** — its collection (the read model). |
| **Writes** | `commands.json` | The commands the UI can fire — **intents, not record edits**. |
| The host gives you (don't touch) | `_start.ts` | Serves the UI, answers both seams, keeps the append-only log, injects annotate. |

## The two seams

The UI never reads files, never knows where data lives, never edits a record.

**Reads — ask for objects of a type:**
```js
await window.objects.all("task")        // → GET /objects/task
await window.objects.get("user", "u1")  // → GET /objects/user/u1
await window.objects.types()            // → GET /objects   → ["project","task","user"]
```

**Writes — fire an intent (a command), never mutate a record:**
```js
await window.commands.run("task.create",    { project:"p1", title:"…", assignee:"u2", points:3 })
await window.commands.run("task.setStatus",  { id:"t2", status:"done" })
await window.commands.list()            // → GET /commands  (the write contract)
```

The UI updates **optimistically**, fires the command, and reconciles (or reverts)
when the host answers — see `cycleStatus` / `addTask` in the HTML.

## Why writes are commands, not record edits

This is the load-bearing rule. A naive prototype would `PUT /objects/task/t2` — edit
a record in place. **Don't.** That bakes a mutable-record assumption the real backend
can't honor, because the real data design (rune:data) makes things **append-only /
immutable**. So every write is an **intent verb** instead:

- The UI says *"set this task's status to done"* — an intent.
- The host appends it to `events.json` (the append-only log — the source of truth)
  and updates the in-memory read model the UI reads back.
- **Whether the real backend stores that as an appended event, a counter bump, or an
  overwrite is decided later, below the seam — and the UI never changes.**

That is what lets the UI and the backend be built at the same time: they share a
stable contract of **queries (objects) + commands (intents)**, and immutability lives
underneath it.

## `commands.json` — the write contract

Each entry is one command. `kind` is the write shape (the host applies it
generically — you never write a reducer), and it maps straight to how the real
backend will store it:

| `kind` | what the host does | maps to (rune:data) |
|---|---|---|
| `create` | append a new object (auto-id) | already-immutable (fresh ids) |
| `set` | record new field values on an object | append-child / aggregate / overwrite — decided below the seam |
| `append` | push a child onto a collection field (`field`) | append-child (history matters) |
| `adjust` | atomically move a numeric field by `input.by` (`field`) | aggregate (a derived counter) |
| `remove` | tombstone an object | a remove command + retention |

Add a command by adding an entry — no host code changes.

## `objects/` — the read model

Each file is one type; its contents are that type's collection. They relate by id
(`task.assignee` → `user.id`); the UI does the join client-side. Add
`objects/comment.json` and it's instantly servable at `/objects/comment`. The host
seeds an **in-memory** copy at boot, so commands mutate a live projection while these
authored seed files stay pristine — a restart is a clean reset. `events.json` (the
command log) persists.

## How it maps to the real backend (why this shape)

The format **is** the contract, pre-extracted:

- `objects/<type>.json` → a backend type + its **read DTO** + a query endpoint
  (`<type>.all`, `<type>.get`).
- `commands.json` → **command verbs + input DTOs**; each `kind` seeds the
  immutability strategy.
- The whole contract is introspectable over HTTP — `GET /objects` + `GET /commands` —
  so a tool can read it and derive the backend spec without opening a file.

Swap `_start.ts`'s resolver for a real keep backend and **the UI does not change.**
That generic host is the reusable "framework" bit — it's what graduates to
`/dev-tools` (where `annotate` already lives), so app prototypes stay this thin.

## annotate

The host wraps every page with annotate (a host concern, not in the HTML).
**⌘/Ctrl+click any element**, type a note → appended to `feedback/feedback.json` with
the element selector, text, page, and timestamp. A badge bottom-right shows the count.

## Try it

1. `deno task start`
2. Open the URL. Click between projects (**Mobile beta** is the empty state).
3. **Click a task's status pill** to advance it (an optimistic `set` command).
4. **Type in "Add a task…"** and hit Enter (an optimistic `create` command).
5. Hit `http://localhost:8723/events` — watch the append-only command log fill up.
6. Hit `http://localhost:8723/commands` and `/objects/task` to see the raw contract.
7. ⌘/Ctrl+click a task title, leave a note, watch `feedback/feedback.json` fill up.
