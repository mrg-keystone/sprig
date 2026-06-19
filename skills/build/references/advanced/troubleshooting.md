# Troubleshooting

> Source: https://fresh.deno.dev/docs/advanced/troubleshooting

| Symptom | Fix |
|---|---|
| Outdated Deno | `deno upgrade` |
| Missing/stale packages | `deno install --allow-scripts` (add `-r` to force reinstall) |
| Outdated Fresh | bump from jsr.io/@fresh/core |
| npm package issues via esm.sh | Switch to direct `npm:pkg@version` imports |
| Duplicate Preact in browser | Stop importing from esm.sh; use `npm:` specifiers |
| Deploy fails to start | Run `deno task build`; entry must be `_fresh/server.js`, not `main.ts` |
| `ISOLATE_INTERNAL_FAILURE` | Check build ran + entry path |
| VS Code can't resolve modules/types | Install `denoland.vscode-deno`; enable Deno per-workspace |
| Vite resolution issues | `vite --debug` |
| Vite plugin behavior unclear | Add `vite-plugin-inspect` |

## See also
- `migration-guide.md` — half of "weird errors" come from leftover Fresh 1 patterns
- `advanced/vite.md`
