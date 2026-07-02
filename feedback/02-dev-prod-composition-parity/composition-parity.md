# Proposal + implementation: the rune composition root is a CLI artifact, and `sprig dev` serves the real prod composition

**Status:** implemented on branch `feat/dev-prod-composition-parity` (framework/cli.ts). This
doc is both the rationale and the change description.

## The problem (a real prod incident)

`sprig build --rune` generates `<gitRoot>/serve.ts` — the composition root that folds the
keep backend (`/api`, `/docs`) around the sprig app (`/ui`). Two properties of that file,
today, combine into a foot-gun:

1. **It's a committed source file** that the deploy build *also* regenerates on every
   deploy. So it looks editable, but any hand-edit is either clobbered (if you keep the
   marker) or **fails the deploy build** (the generator refuses to overwrite a marker-less
   file — `writeRuneServe`). There is no supported way to add an app-level route (e.g. a
   `/auth` login gateway) to the real prod entrypoint.
2. **`sprig dev` does NOT serve that composition.** Dev builds its handler from the sprig
   app alone via `sprigUi({ app })` — no keep backend. So `/api`, `/docs`, and anything
   mounted at the composition root are absent in dev but present in prod.

Downstream (alfred) this produced a classic "works in dev, 404s in prod": a `/auth` gateway
mounted in a `ui/serve.ts` that *looked* like the prod entry (its header even said
"Production host entry") but that production never runs — because prod runs the generated
git-root `serve.ts`. The new client shipped, asked `/auth/firebase-config`, and prod 404'd.
The eventual fix — wrap the `sprigApp` export so unmatched paths fall through the app — is a
*discovered* pattern, not a documented seam.

This is the SECOND dev/prod divergence in this codebase in two days (the first was the
stale-immutable-bundle wedge in `../01-stale-bundle-wedge/bug-report.md`). Same root theme: **dev and prod were never
running the same thing.**

## The fix (both halves)

### A. The composition root is a build artifact — never committed
`writeRuneServe` now appends `/serve.ts` to `<gitRoot>/.gitignore`. The deploy build
regenerates it; `sprig dev` composes it in-process (below). It never needs to live in git,
so it can't drift, can't be hand-edited into a broken state, and can't misrepresent itself
as "the" entry. (A fresh clone runs `sprig build --rune` — already the documented step —
before `deno serve serve.ts`.)

### B. `sprig dev` serves EXACTLY the prod composition
`dev()` now detects a rune monorepo (`detectRuneComposition`: a `.git` root above the app
with a sibling `<dir>/bootstrap/mod.ts` that calls `bootstrapServer`). When found, it builds
the dev handler from **`serveSprig({ keep: api, app: sprigApp, base, assetsDir })`** — the
same call the generated root makes — instead of `sprigUi({ app })`. So `/api`, `/docs`, and
any route the app forwards (e.g. `/auth`) are live in dev, HMR and all. A pure-UI app (no
backend sibling) keeps the old `sprigUi`-only path. Env parity: the git-root `.env` is
loaded first (non-overriding), the dev twin of prod's `deno serve --env-file=.env`, so the
backend reads `INFRA_URL`/creds at module-eval exactly as in prod.

`detectRuneComposition` is deliberately soft — it never warns, defaults, or exits (unlike the
`--rune` build path); a non-monorepo just falls through to UI-only.

## Verified

Against alfred (keep backend in `server/`, sprig UI in `ui/`), through the patched
`sprig dev ui`:

| Surface | Result | Meaning |
|---|---|---|
| `GET /ui/login` | 200 | app served |
| `POST /api/http/overview` | 401 | **keep composed + auth-gated** (was absent in dev before) |
| `GET /auth/firebase-config` | 200 | app-forwarded route live in dev |
| `GET /docs` | 200 | keep docs surface live in dev |

And `sprig build --rune ui` regenerates `serve.ts` byte-identically **and** adds `/serve.ts`
to `.gitignore`.

## Open follow-ups (not in this change)
- A first-class extension seam on `ServeSprigConfig` (e.g. `before?: (req) => Response | null`
  or a routes map) so `/auth`-style app routes don't need the `sprigApp`-wrapping trick at
  all. The parity fix makes the trick *work everywhere*; a real seam would make it
  *unnecessary*.
- The scaffolded `ui/serve.ts` still carries a "Production host entry" header — with the root
  now the sole entry, that twin should be removed or relabeled by the generator.
