# Vite Plugin Options

> Source: https://fresh.deno.dev/docs/advanced/vite

## TL;DR
`fresh()` plugin in `vite.config.ts` accepts options for entry points and directories. Place `fresh()` first in the plugin array. The plugin handles JSX, Preact aliasing, HMR (Prefresh), island discovery, client/server bundle splitting.

## All options
```ts
fresh({
  serverEntry: "./main.ts",   // default
  clientEntry: "./client.ts", // default
  islandsDir: "./islands",    // default
  routeDir: "./routes",       // default
  staticDir: "static",        // string | string[]
  ignore: /node_modules/,     // optional regex to skip
  islandSpecifiers: [],       // extra third-party packages treated as islands
});
```

## Combining plugins
```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [fresh(), tailwindcss()],
});
```
Fresh first, then others.

## What the plugin does
- Configures JSX for Preact
- Aliases `react`/`react-dom` → Preact
- Enables HMR via Prefresh
- Discovers islands; bundles them separately
- Validates client/server import boundaries

## Debugging
- `vite --debug`
- Add `vite-plugin-inspect` to see plugin transformations in a UI

## See also
- `quickstart.md` — minimal `vite.config.ts`
- `migration-guide.md` — Fresh 1 didn't use Vite
