# coordinate.md — `spec/` anchored at the git root (rune ⇄ sprig)

**Coordination doc between the `rune`/`keep` repo and the `sprig` repo.**
Owner of this file: the rune-side work (`/Users/raphaelcastro/Documents/programming/rune`).
Companion to [`coms.md`](./coms.md) (the native-integration contract). Started: 2026-06-27.

Goal (user's words): *"the spec folder is in the wrong place. the spec folder needs to be a
sibling of the `.git` folder. this way in a mono repo it encompasses the frontend and the
backend."*

---

## TL;DR

`spec/` is the **shared product/design contract** — `spec/runes` (backend specs), `spec/ui`
(sprig prototype + design system), `spec/misc` (data/cake artifacts), `spec/product` (the
product spec + user stories). In a monorepo the **frontend (sprig) and backend (rune/keep)
are siblings under the git root**, and they must read/write **one** `spec/`, not one each.

Today, **both toolchains anchor `spec/` on the wrong thing** — sprig on the CLI invocation
dir (`appDir`/cwd), rune partly on the spec file's parent dirs and partly on cwd. So a
frontend invoked from `<git>/frontend/` writes `spec/ui` into `<git>/frontend/spec/ui`, while
the backend's cake reads `<git>/backend/spec/misc` — the contract fragments.

**The fix is one shared rule, implemented identically on both sides:** resolve `spec/` by
**walking up to the nearest ancestor that contains `.git`**, and treat that ancestor as the
spec root (`spec/ = <gitRoot>/spec/`). Fall back to today's behavior when there is no `.git`
ancestor (standalone project, or a not-yet-`git init`'d scaffold). **Only `spec/` relocates** —
each package keeps generating its own code into its own `src/` (this is *not* a "move all
output to the git root" change).

The sprig-side change is **tiny**: sprig has exactly one load-bearing `spec/ui` reference and
no root-walking code at all, so it's a ~10-line helper + one call site + a wording pass over
five skill docs.

---

## The shared resolution contract (both sides implement the SAME walk)

This is the agreed interface. Do not diverge without updating both sides + this doc.

```
specRoot(startDir):
  d = absolute(startDir)
  while d != filesystem-root:
    if exists(d + "/.git"):        # a dir OR a file (worktrees use a .git file)
      return d                      # ← the git root; spec/ lives directly under it
    d = parent(d)
  return startDir                   # no .git ancestor → fall back to today's behavior
```

- **`spec/` is always `specRoot(...) + "/spec/"`.** Its subfolders are unchanged:
  `spec/runes`, `spec/ui`, `spec/misc`, `spec/product`.
- **Identical algorithm on both sides.** If rune and sprig walk differently, a monorepo's two
  halves resolve to different `spec/` dirs and the contract splits again. Same rule, same
  fallback.
- **`.git` can be a directory *or* a file.** A normal clone has a `.git/` dir; a `git
  worktree` checkout has a `.git` *file* pointing elsewhere. Test for existence, not "is a
  directory."
- **Fallback is load-bearing, not a footnote.** A standalone single-package repo has its
  `.git` at the project root, so the walk returns the project root and behavior is **identical
  to today**. A freshly scaffolded app that isn't a git repo yet has no `.git` ancestor → fall
  back to the project/app dir. Both must keep working.
- **Only `spec/` is anchored at the git root.** Generated code, build output, and per-package
  `deno.json` stay where they are. The git root answers "where is the shared `spec/`?" — *not*
  "where does my compiler write?"

---

## Target monorepo layout

```
<git-root>/                 # has .git  ← spec/ is a SIBLING of this
  .git/
  spec/                     # ONE shared contract, read+written by BOTH halves
    product/                #   spec.md + user-stories.md   (rune:scope)
    runes/                  #   .rune backend specs          (rune:spec)
    ui/                     #   prototype + design system    (sprig:prototype / :design)
    misc/                   #   data.json, cake.json         (rune:data / rune:cake)
  frontend/                 # a sprig app   (its own deno.json, src/, app/, serve.ts)
  backend/                  # a rune/keep app (its own deno.json, src/<module>/, bootstrap/)
```

(The single-package flat app from [`coms.md`](./coms.md) Q3 — where `spec/`, `src/`, `app/`,
and `deno.json` all sit at one `<root>` — is just the degenerate case where that `<root>` **is**
the git root. The walk returns it unchanged, so flat apps keep working; this doc only adds the
**split-package** monorepo case, where `spec/` must lift above the per-package roots.)

---

## Status matrix

| # | Requirement | State | Where |
|---|---|---|---|
| 1 | A shared `specRoot` walk-up rule (to `.git`, with project-dir fallback) | ✅ SPEC'D | this doc |
| 2 | rune ENGINE resolves `spec/` at the git root | ✅ ALREADY (no change) | `resolveRoot` `spec-root.ts:22-33` returns the git root for a `spec/runes/` spec; LSP `main.rs:52-62` mirrors it |
| 3 | rune RUNTIME (cake) reads the shared `spec/misc` from any cwd | ✅ DONE (rune repo) | keep `fixturesDir()` now walks to `.git` — `fixtures-store/mod.ts` + unit tests |
| 4 | sprig resolves `spec/ui` at the git root | 🔲 **SPRIG TODO** | `framework/.sprig/annotate.ts:151` via `framework/cli.ts:399` |
| 5 | sprig skill docs say "git root", not "project root" | 🔲 **SPRIG TODO** | 5 SKILL.md/README.md files (below) |
| 6 | Only `spec/` relocates; generated `src/` stays per-package | ✅ BY DESIGN | rune sync output stays `<pkgRoot>/src/<m>`; split-package via `--root` |

---

## Task split

### SPRIG side (the other half — actionable) — `/Users/raphaelcastro/Documents/programming/sprig`

Sprig has **exactly one** load-bearing filesystem reference to `spec/ui`, and **no
root-walking code anywhere**, so this is small and self-contained.

1. **Add a `specRoot` helper** (net-new — nothing like it exists in the repo today; no
   `findUp`/git-walk/`gitRoot` helper to reuse). Implement the contract above: walk up from a
   start dir to the nearest ancestor containing a `.git` entry (dir *or* file), else return the
   start dir. ~10 lines, synchronous, no `git` subprocess needed (just `existsSync` up the
   chain).

2. **Anchor the annotate path on it.** Today:
   - `framework/.sprig/annotate.ts:151` — `const notesPath = join(opts.appDir, "spec", "ui",
     "build-notes.json");` (screenshot PNGs at `annotate.ts:239` derive from `notesPath`, so
     they follow automatically).
   - Fed by `framework/cli.ts:399` — `makeAnnotate({ appDir: appAbs, srcDir: join(appAbs,
     "src"), isolateBase: isoBase })`, where `appAbs = resolve(appDir)` (`cli.ts:386`) and
     `appDir = positionals[0] ?? "."` (`cli.ts:331`).
   - **Change:** compute `const specRoot = specRootOf(appAbs);` at the `cli.ts:399` call site,
     pass it into `makeAnnotate` (e.g. add a `specRoot` field to its opts), and change
     `annotate.ts:151` to `join(opts.specRoot, "spec", "ui", "build-notes.json")`. Keep
     `srcDir` anchored on `appAbs` (component discovery is per-app, *not* a `spec/` concern —
     see "do NOT change" below).

3. **Realign the skill-doc wording** (these are Claude instructions, not compiler code — they
   won't break a build, but the build/design/prototype agents will keep writing to
   `cwd/spec/ui` unless the wording matches the new anchor). Change "`spec/ui/` … relative to
   the project root" → "relative to the **git root** (the dir containing `.git`); falls back to
   the project dir outside a git repo" in:
   - `skills/interfaces/README.md:23-25`
   - `skills/sprig:design/SKILL.md:114-120`
   - `skills/sprig:prototype/SKILL.md:79-82`
   - `skills/sprig:breakdown/SKILL.md:38-40`
   - `skills/sprig:build/SKILL.md:323-325`
   (and any other `spec/ui/...` "project root" phrasing those skills carry).

4. **Do NOT change** (verified no `spec/` coupling): `serveSprig`/`sprigUi`/`KeepApi`
   (`packages/keep/mod.ts` — pure in-memory `{backend,handler}` passing, no spec path), the
   `Backend` DI token (`framework/.sprig/core.ts:320`), **`sprig isolate`/the workbench** (it
   discovers components by scanning `<appRoot>/src/**` for `isolate/` subfolders —
   `server/src/core/business/discover/mod.ts:386`, `annotate.ts:68` — *not* via `spec/`), and
   `sprig build`'s `static/` output (`cli.ts:239`, cwd-based, independent of `spec/`).

### RUNE side — DONE / mostly a no-op — `/Users/raphaelcastro/Documents/programming/rune`

Implementing this revealed the rune **engine** needs **no change** — it's already anchored on the
**spec file path**, which reveals where `spec/` is. The one genuinely-broken seam was the
**runtime** (cwd-based), and it's fixed + unit-tested.

1. **`resolveRoot()` — `src/rune/entrypoints/spec-root.ts:22-33` — NO CHANGE.** For a spec at the
   canonical `<root>/spec/runes/foo.rune` it already hops two levels to return `<root>` — i.e. the
   git root, when `spec/` is the git-root sibling. So `rune check`/`sync`/`manifest`/`dev` already
   read the shared `<gitRoot>/spec/runes` + `spec/misc` and the shared `core.rune`, and sync writes
   `heal-rules.json` to the shared `<gitRoot>/spec/misc`. (A `.git` walk *here* would be **wrong** —
   rune's own in-repo fixtures live under the repo's `.git`, so it would resolve them to the repo
   root and write codegen into the real `src/`.)
2. **LSP mirror — `lang/lsp/src/main.rs:52-62` — NO CHANGE.** `core_services_for` mirrors the same
   spec-path `resolveRoot`, so the editor already resolves the shared core at the git root.
3. **keep `fixturesDir()` — `keep/.../fixtures-store/mod.ts` — ✅ CHANGED + UNIT-TESTED.** The one
   genuinely-broken seam: the **runtime/server** path is cwd-based with no spec path to anchor on.
   It now walks cwd → nearest `.git` and prefers `<gitRoot>/spec/misc` (falling back to
   `<cwd>/spec/misc`, then legacy `<cwd>/fixtures`; `KEEP_FIXTURES_DIR` still overrides). So the
   cake reads/writes the **one** shared `spec/misc` even when the backend is launched from a package
   subdir. (`resolveFixturesDir` extracted as a pure, tested helper; this is the rune-side mirror of
   the sprig `annotate` fix above.)
4. **`rune lint`'s root — `src/bootstrap/mod.ts:11-23` — STAYS per-`deno.json`.** Lint/codegen are
   per-package; only `spec/` is shared. The two roots intentionally differ: *spec root = the git
   root (via the spec path, or the keep `.git` walk); output + lint root = the package
   (`deno.json` / `--root`).*

**Split-package output targeting:** with specs shared at `<git>/spec/runes/`, `rune sync` writes
codegen to `<resolveRoot>/src/<m>` — for a flat app that's the backend at the git root (correct);
for a backend in its own subdir, pass `--root <git>/backend` (the existing override, `sync/mod.ts:140`)
so code lands in the package. An automatic spec-root-vs-output-root split is a possible future
enhancement, **not** needed for the shipped flat layout.

---

## Decisions

- **D-walk: anchor `spec/` on a `.git` ancestor walk, with a project-dir fallback.** Chosen
  over (a) a `deno.json`-marker walk — wrong, that's the *package* boundary, and a monorepo has
  several; (b) an env var / config key — invisible and easy to desync across two repos; (c)
  requiring you always invoke from the git root — brittle. The `.git` walk is the one marker
  that means "the monorepo," is identical for both tools, and degrades to today's behavior for
  standalone repos. **Recommended + assumed by this doc.**
- **D-scope: only `spec/` relocates.** Generated code, `static/` build output, and per-package
  `deno.json`/lint roots stay put. The git root answers "where is the shared contract?", not
  "where does my compiler write?" (Matches the user's words: *the **spec** folder*.)
- **D-fallback: no `.git` ⇒ today's behavior.** Standalone project → its own root (unchanged);
  un-init'd scaffold → the project/app dir. No regression for non-monorepo users.

---

## Verification (sprig side)

- **Monorepo:** in `<git>/` (with `.git/`) put a sprig app at `<git>/frontend/`. Run `sprig
  dev frontend`, ⌘/Ctrl-click a component to save a note. **Assert** `build-notes.json` lands
  at `<git>/spec/ui/build-notes.json` — **not** `<git>/frontend/spec/ui/build-notes.json`.
  Screenshot PNGs land beside it in `<git>/spec/ui/`.
- **Standalone (regression):** a single-package sprig app whose project root **is** the git
  root → `spec/ui` resolves exactly as today (the walk returns the project root immediately).
- **No git repo:** a scaffold with no `.git` ancestor → falls back to `appDir/spec/ui` (today's
  behavior); no crash from the walk hitting the filesystem root.

---

## Append log

- 2026-06-27 — rune side: investigated both repos (cited seams above) and wrote this doc.
  **The decision:** `spec/` resolves at the git root via a shared `.git` walk-up (project-dir
  fallback); only `spec/` relocates, generated code stays per-package. **Sprig-side TODO:** (1)
  add the `specRoot` walk-up helper; (2) anchor `framework/.sprig/annotate.ts:151` on it via
  the `framework/cli.ts:399` call site; (3) reword the five skill docs from "project root" →
  "git root (with fallback)". Rune-side TODO tracked on the rune repo: `resolveRoot`
  (`spec-root.ts:22-33`) + LSP mirror (`lang/lsp/src/main.rs:52-62`) + keep `fixturesDir`
  (`fixtures-store/mod.ts:176-197`); lint's per-`deno.json` root stays. Supersedes the flat-root
  assumption in [`coms.md`](./coms.md) Q3 (which only covered the single-package case).
- 2026-06-27 — **rune half IMPLEMENTED (turned out to be a near-no-op).** Reading the engine proved
  `resolveRoot` (`spec-root.ts:22-33`) + the LSP mirror (`main.rs:52-62`) ALREADY return the git root
  for a `spec/runes/` spec (they anchor on the spec PATH), so **neither changed** — and a `.git` walk
  in `resolveRoot` would be actively wrong (rune's in-repo fixtures live under the repo's `.git`). The
  only fix was the cwd-based **runtime** seam: keep `fixturesDir()` (`fixtures-store/mod.ts`) now walks
  to the nearest `.git` and prefers `<gitRoot>/spec/misc` (pure `resolveFixturesDir` helper + 2 unit
  tests, 16/16 green; `KEEP_FIXTURES_DIR` still overrides). lint's per-`deno.json` root stays;
  split-package output uses `--root`. **Net: the sprig-side TODO (annotate + 5 skill docs) is the
  remaining work.**
