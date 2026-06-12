# FieldOps — dispatch board for HVAC service company (working notes)

We run ~14 techs across the metro area. Office staff currently dispatch via a
shared spreadsheet + group text. We want a dispatch board.

## Who uses it
- **Dispatcher** (office) — the main user. Lives in this tool all day.
- Techs only interact via their phones (out of scope here, but the dispatcher
  needs to see tech status).

## Main flow (dispatcher's day)
1. **Job queue** — new service requests come in (from calls / web form). Each
   request: customer name, address, issue summary, priority (emergency / today
   / scheduled), equipment type (furnace, AC, heat pump, water heater).
2. **Assign** — dispatcher drags/assigns a job to a tech. Needs to see each
   tech's current load (jobs today), status (available, on job, driving,
   off), and rough zone (N / S / E / W metro).
3. **Track** — board view of all techs as columns, their jobs as cards in
   order. Job statuses: assigned → en route → on site → done. Emergency jobs
   show red.
4. **Close out** — when a tech marks done, the job needs a close-out: parts
   used (free text), time on site, "needs follow-up" flag. Dispatcher reviews
   and closes, or bounces back.

## Screens we think we need
- Intake queue (new/unassigned jobs, sortable by priority)
- Dispatch board (techs as columns, jobs as draggable-ish cards)
- Job detail (everything about one job, status history, close-out form)
- End-of-day summary (jobs done, emergencies handled, follow-ups created)

## Data we track per job
id, customer, phone, address, zone, equipment, issue, priority, status,
assigned_tech, created_at, time_on_site, parts_used, needs_followup

## Notes / gripes from the office
- "Half the time a job sits unassigned for an hour because nobody saw it" —
  unassigned + emergency needs to be LOUD.
- Customer names can be long ("Greater Metropolitan Property Management LLC,
  Building C") and addresses wrap badly in the spreadsheet.
- Slow afternoons the queue is empty — that's fine, board should not look broken.
