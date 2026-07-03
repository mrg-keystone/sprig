# proto-host — the generic two-seam prototype host (bundled copy)

`_start.ts` + `deno.json`, copied **verbatim** into every new prototype folder
(`spec/ui/<app>-prototype/`). Never edited per-app: everything app-specific lives in
the three authored files (`_test-prototype.html`, `objects/*.json`, `commands.json`).

Source of truth: the sprig repo's `rnd/proto/` — update there, then re-copy here and
re-run the skill install. Contract: `/contract.md` at the sprig repo root.
