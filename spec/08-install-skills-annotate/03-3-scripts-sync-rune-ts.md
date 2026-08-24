## 3. `scripts/sync-rune.ts`

The version-pin member of the invariant-sync family alongside the guardrail sync
(§2): it edits build-repo `deno.json`s only, never touches or deploys the `claude/`
tree (§2's job), and is a maintainer task, not part of `sprig install`. Fleet-cost
rationale for the family: 10 §2. Release/docs discipline for API-surface changes:
10 §3.

`deno task sync:rune [version]` repins `@mrg-keystone/rune`:

| | |
|---|---|
| Version source | No arg → newest `@mrg-keystone/rune` on JSR (authoritative `api.jsr.io`); `[version]` → that value |
| Targets written | `server/deno.json`, every `fixtures/*/deno.json` |
| Post-step | Relock `deno.lock` |
| Downstream consumer | `runeRange()` reads `server/deno.json` at `sprig init` |

**Example** — `deno task sync:rune 0.20.31`, `server/deno.json` imports map:

```json
// before
"@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^0.20.28"
// after
"@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^0.20.31"
```

The identical edit lands in every `fixtures/*/deno.json`, `deno.lock` is relocked
against the new resolution, and the next `sprig init` run gets `0.20.31` back out of
`server/deno.json` via `runeRange()`.

The string `sync:rune` writes (and `runeRange()` reads back at `sprig init`)
is a caret range, not an exact pin: the writer builds it as
`` `jsr:@${scope}/${name}@^${version}` ``, so a re-run for `0.20.31` produces
`@^0.20.31`, floating patch and minor.

**Invariant**: every rune-importing `deno.json` in the repo must pin the IDENTICAL
version — `server/deno.json` and every `fixtures/*/deno.json` are that set (the
same two categories "Targets written" lists above and the drift gate below
checks). `server/deno.json` is canonical because `sprig init` scaffolds new apps
from it via `runeRange()`, while `fixtures/*` must compile against the exact rune
the server ships — drift means fixtures exercise a rune version prod never sees.

`server/deno.json` and `fixtures/*/deno.json` are exhaustively every
rune-importing `deno.json` in the repo today: the workspace's other two
members, `cli/deno.json` and `app/deno.json`, carry no `@mrg-keystone/rune`
pin, and neither does the root `deno.json` — `server/` is the workspace's
sole rune importer. `sync:rune`'s `TARGETS` list reflects exactly this: it
hardcodes `server/deno.json` and enumerates `fixtures/*/deno.json` via a
directory scan, with nothing outside those two categories.

**Drift gate**: unlike the guardrail sync (§2), which ships both a writer and a
`--check` CI gate (`deno task check:agent-guardrail`), root `deno.json`'s `tasks`
map has no `check:rune` counterpart — version-pin drift is not CI-gated today.
Add one, symmetric with `check:agent-guardrail` (§2): a `deno task check:rune
--check` diffing every `fixtures/*/deno.json` pin against `server/deno.json` and
failing the build on mismatch — otherwise drift stays silent until a fixture's
tests fail against a stale rune, the exact failure mode the invariant above
exists to prevent.

