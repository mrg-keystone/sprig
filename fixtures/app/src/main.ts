/**
 * App bootstrap: the route table for the "sprig Board" workspace, mounted under keep
 * (see ../README.md).
 *
 * A route maps a URL to a component FOLDER by path string — the whole folder is the component.
 * There is no special "layout": the root component (./shell) is just the route at path "", and
 * its template's <router-outlet> hosts whichever page below matches. Because route-children live
 * under their parent's components/ exactly like tag-children, the pages ARE the shell's
 * components/ — the whole app is one recursive folder-component tree.
 *
 * A route's `children` are either nested primary routes (more URL) or NAMED-outlet routes, which
 * the URL carries as `name=value` segments, e.g.
 *
 *     /board/detail=SPR-101/panel=filters/     detail outlet = an issue, panel outlet = filters
 *     /settings/main=question/sidebar=admin/   main outlet = a topic, sidebar outlet = admin
 *
 * See .sprig/router.ts for the parse/serialize/match engine and .sprig/router.test.ts.
 * `scripts/check-outlets.ts` validates every named-outlet route against a matching
 * <router-outlet name="…"> in its parent's template.
 */
import { bootstrap, defineRoutes } from "@sprig/core";

export const routes = defineRoutes([
  {
    // The root component is just a route: path "" matches everything (consumes no URL); its
    // template's <router-outlet> hosts the matched page. No special `layout` field or directory.
    path: "",
    load: "./shell",
    children: [
      // home — the workspace dashboard
      { path: "", load: "./shell/components/dashboard" },
      { path: "welcome", load: "./shell/components/landing" },
      { path: "about", load: "./shell/components/about" },

      // the kanban board — two NAMED outlets (master-detail panel + a filter side-panel).
      // Outlet targets are the board's own components, beside its tag components.
      {
        path: "board",
        load: "./shell/components/board", // declares <router-outlet name="detail"> + name="panel"
        children: [
          { path: "detail=:issueId", load: "./shell/components/board/components/detail" }, // detail=SPR-101 → issueId
          { path: "panel=filters", load: "./shell/components/board/components/panel-filters" },
        ],
      },

      // a full issue page (dynamic segment → params.id; resolved server-side in resolve.ts)
      { path: "issues/:id", load: "./shell/components/issue" },

      // a user profile (dynamic segment → params.id; resolved in user/resolve.ts)
      { path: "users/:id", load: "./shell/components/user" },

      // the template-feature gallery — one NAMED outlet for the selected example
      {
        path: "docs",
        load: "./shell/components/docs", // declares <router-outlet name="example">
        children: [
          { path: "example=:topic", load: "./shell/components/docs/components/example" }, // example=pipes → topic
        ],
      },

      // settings — THREE named outlets (sidebar nav, main topic, a profile form panel).
      // Every outlet target is one of settings's own components.
      {
        path: "settings",
        load: "./shell/components/settings", // declares <router-outlet name="sidebar"|"main"|"panel">
        children: [
          { path: "sidebar=admin", load: "./shell/components/settings/components/admin" },
          { path: "sidebar=audit", load: "./shell/components/settings/components/audit" },
          { path: "main=:topic", load: "./shell/components/settings/components/main" }, // main=question → topic="question"
          { path: "panel=profile", load: "./shell/components/settings/components/profile" }, // an interactive form island
        ],
      },
    ],
  },
]);

// Services self-register via @Injectable({ providedIn: "root" }) — no providers list needed.
export const app = bootstrap({ routes });

// keep: forward requests to the app handler (Deno.serve((req, info) => api.handler(req, info)))
if (import.meta.main) {
  Deno.serve((req) => app.fetch(req));
}
