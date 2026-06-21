# `deno compile`

> Source: https://fresh.deno.dev/docs/deployment/deno-compile

## TL;DR
Ship as a single executable. Build first, then `deno compile` with `--include _fresh`.

## Commands
```bash
deno task build
deno compile --output my-app --include _fresh -A _fresh/compiled-entry.js
```
`--include _fresh` is **required** — it embeds bundles, CSS, and static files in the binary.

## Runtime env
- `PORT=4000 ./my-app`
- `HOSTNAME=0.0.0.0 ./my-app`

## Cross-compile
```bash
deno compile --target x86_64-unknown-linux-gnu \
  --output my-app --include _fresh -A _fresh/compiled-entry.js
```
See Deno docs for the full target list.

## Caveats
- Binary is large: 50–130 MB (Deno runtime included).
- Dynamic / non-static imports may not be captured.
- Native npm deps must match the target platform.

## See also
- `quickstart.md` — `deno task build` step
