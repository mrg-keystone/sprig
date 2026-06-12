# FieldOps — Clickable Prototype

A single-file, no-install prototype of the dispatch board described in
`dispatch-spec.md`. All data is mock and lives in the browser — refresh the
page (or click **Reset demo data**, top right) to restore the starting state.

## How to run it

Double-click `index.html`. That's it — no server, no internet, no build step.
Works in Chrome, Edge, Safari, or Firefox on any office machine.

## What's in it (maps to the spec)

| Spec item | Where in the prototype |
|---|---|
| Intake queue, sortable by priority | **Intake Queue** tab — sort dropdown (priority / waiting longest / newest / zone) |
| Unassigned + emergency must be LOUD | Pulsing red badge on the Queue tab, sitewide red banner on every other screen, throbbing red cards, red "Unassigned" board column |
| Dispatch board: techs as columns | **Dispatch Board** tab — all 14 techs with status dot (available / on job / driving / off), zone chip, today's load |
| Drag/assign | Drag a card from "Unassigned" onto a tech column — or click **Assign** for a picker sorted by same-zone-first, then lightest load. Off-duty techs are locked out. Drag a card back to "Unassigned" to return it to the queue. |
| Job statuses: assigned → en route → on site → done | One-click advance button on each card; emergencies show red |
| Job detail + status history | Click any card or row — overlay with all job fields and a timestamped timeline |
| Close-out (parts, time on site, follow-up flag); review or bounce back | When a job hits "done", the detail view shows the close-out form with **Approve & close** / **Bounce back to tech** |
| End-of-day summary | **End of Day** tab — jobs closed, emergencies handled, follow-ups created, per-tech recap, closed-jobs table |
| Long customer names / addresses | Seeded with "Greater Metropolitan Property Management LLC, Building C" — truncates with ellipsis on cards, full text on hover and in detail |
| Empty queue shouldn't look broken | Assign everything and the queue shows a friendly "Queue is clear" state |

## Suggested 5-minute demo script

1. **Open on the Intake Queue.** Point out the two pulsing red emergencies and
   the "waiting 52 min" warning — this is the "nobody saw it" fix.
2. Click **Dispatch Board** — the red banner follows you because an emergency
   is still unassigned. Click the banner to jump back.
3. **Assign the furnace emergency** (Harold Brink): click *Assign*, show the
   picker ranking same-zone available techs first, pick *Luis Herrera*.
4. Back on the board, **drag the water-heater emergency** (Priya Raman) onto
   *Omar Haddad* to show drag-assign. Try dragging onto an off-duty tech
   (Nate Polk) — it's blocked.
5. On Luis's column, walk the job through **en route → on site → done** — the
   close-out review opens automatically. Fill in parts, tick "needs
   follow-up", **Approve & close**.
6. Open **End of Day** — the numbers just updated. Click a closed job row to
   show the full history including your close-out.
7. (Optional) Assign the rest, then show the **empty queue** state. Click
   **Reset demo data** to start over for the next person.

## Out of scope (per spec / on purpose)

- Tech phone app — techs appear only as status on the board.
- Persistence/backend — this is a click-through for layout & flow feedback.
- Real intake form — new requests would arrive via calls/web form in the real
  product; here the seed data plays that role.
