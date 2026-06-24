# design-lint

A standalone, Deno-native UI anti-pattern linter. Scans HTML/CSS/JSX files (or a
live URL) for design-quality issues — low contrast, flat type hierarchy, bounce
easing, AI-generated palette tells, em-dash overuse, layout-thrash transitions,
and ~35 other rules.

Vendored from the [impeccable](https://github.com/pbakaus/impeccable) detection
engine (Apache-2.0) and ported to run under Deno with **no npm / node_modules**.
See `NOTICE` for attribution and the list of changes.

## Why this exists

The upstream engine ships as an npm package. This vendors just the detection
engine so it can ride along in a Deno toolchain — no separate package for devs
to install. The engine source under `src/engine/**` is unmodified; only the
browser driver was swapped (Puppeteer → Astral) via an import-map shim.

## Usage

```sh
# Static scan (zero dependencies, no browser) — the CI path
deno task lint src/
deno task lint index.html
deno task lint --json src/        # machine-readable

# Live URL scan (full browser render via Astral; downloads Chromium on first run)
deno task lint:url https://example.com
deno task lint:url --json http://localhost:8000/
```

Flags: `--json` (JSON output), `--gpt` / `--gemini` (also report provider-specific
generated-code tells). Exit code is `2` when findings exist, `0` when clean —
so it drops straight into CI.

## Layout

```
deno.json                     tasks + import map (puppeteer -> astral shim)
bin/detect.mjs                CLI entry (wraps the engine's detectCli)
shims/puppeteer-astral.mjs    Puppeteer-compatible surface backed by Astral
src/engine/**                 vendored impeccable detection engine (unmodified)
LICENSE / NOTICE              Apache-2.0 + statement of modifications
```

## Vendoring into another repo

Copy the whole `design-lint/` directory in. The only external reference is the
`jsr:@astral/astral` import (pinned in `deno.json`), fetched on demand by Deno.
The static-scan path needs no network and no browser.
