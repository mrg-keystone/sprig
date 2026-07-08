# Widget Store — user stories

The living spec of what the app should do. Each bullet is a contract the audit verifies.

- As a visitor, I can open the home page (`/ui`) and see a greeting. → `/ui` returns **200**.
- As a visitor, I can open a widget by id (`/ui/widget/a`) and see its name and blurb. → a known id returns **200** and shows the widget name.
- As a visitor, opening a **missing** widget (`/ui/widget/nope`) shows a "not found" view **and the response is HTTP 404** (not a soft 404 that returns 200).
- As a visitor, I can click **+1** on the counter and the number goes up **in the page** (the counter island hydrates).
- As a visitor, I can click **♥ Like** and the like is acknowledged in the UI (the like control must actually respond to clicks).
