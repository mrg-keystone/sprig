# Quickstart

> Source: https://fresh.deno.dev/docs/introduction + https://fresh.deno.dev/docs/getting-started

## TL;DR
Fresh is a Deno + Preact full-stack web framework. Server-renders by default; ships JS only for "islands" (interactive components). Fresh 2 uses Vite for builds and a unified `App` API for server setup. Best for SSR sites, CRUD, APIs. Not for SPAs.

## Scaffold a project
```
deno run -Ar jsr:@fresh/init ./my-app --tailwind --vscode
```
Runs non-interactively with a directory arg + flags (omit them for the interactive wizard).
**Always scaffold** rather than hand-writing `deno.json` — the initializer pins
mutually-compatible versions and writes the lockfile (SKILL.md, *Bootstrapping*).

## Default project layout
| Path | Purpose |
|---|---|
| `routes/` | Filesystem-routed pages + API endpoints |
| `routes/_app.tsx` | Outer `<html>` shell |
| `routes/_error.tsx` | 404/500 page (Fresh 2 unified) |
| `routes/index.tsx` | Homepage (`/`) |
| `routes/api/` | API endpoints |
| `islands/` | Interactive components (hydrated client-side) |
| `components/` | Server-only components |
| `static/` | Static assets (css, images) |
| `client.ts` | Client entry — imports CSS, etc. |
| `main.ts` | Server entry — instantiates `App` |
| `vite.config.ts` | Vite config (replaces Fresh 1's `dev.ts`) |
| `deno.json` | Deps + tasks |

## main.ts (server entry)
```ts
import { App, staticFiles } from "fresh";

export const app = new App()
  .use(staticFiles())
  .fsRoutes();
```

## vite.config.ts
```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({ plugins: [fresh()] });
```

## client.ts
```ts
import "./assets/styles.css";
```

## Tasks
| Action | Command |
|---|---|
| Dev server | `deno task dev` (runs `vite`) |
| Build | `vite build` |
| Run prod | `deno serve -A _fresh/server.js` |

## Key version note
- Latest 2.3+. Uses Vite by default. JSX precompile transform via Deno for fast SSR.
- OpenTelemetry support is built-in.
- Fresh 2 deploy requires a build step (`deno task build`); unlike Fresh 1, no on-demand build.

## See also
- `migration-guide.md` if upgrading from Fresh 1
- `concepts/architecture.md` for how SSR + islands fit together
- `concepts/file-routing.md` for routing conventions
