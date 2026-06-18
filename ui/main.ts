import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());

// File-system routes:
//   /                        → the v0.4 persistent shell (routes/index.tsx → Shell)
//   /components, /pages      → flat gallery fallbacks (generated per host project)
//   /<prefix>/<cat>/<case>   → per-case preview routes (generated per host project)
//   /api/run                 → proxies the test runner to the keep server
//
// The shell/gallery read the generated manifest.ts (the scaffold step materializes
// it + the per-case routes + symlinks the host's components/islands/pages in).
app.fsRoutes();
