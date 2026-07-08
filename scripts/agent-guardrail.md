## Never crawl the filesystem for framework source

Your `find` is Claude Code's bundled **bfs** (multithreaded). A search rooted at `/`
(`find / …`, or a whole-disk `grep -r … /`) fans out across the entire volume and pegs
several cores for minutes — and it is **never** the right way to locate sprig internals or
build artifacts. **Do not run `find /` or any whole-disk search.** Everything agents have
historically crawled the disk for is already at hand:

- **Sprig internals** — islands & `isolate` (`isolate-events`, `sprig isolate`), the
  component model, routing, serving/SSR, templates — are documented in the skill references
  installed alongside you. Read them directly instead of hunting the runtime source:
  - `~/.claude/skills/sprig:build/references/{isolate,component-model,routing,serving,templates}.md`
  - `~/.claude/skills/sprig:audit/references/{playwright-mcp-recipes,sprig-bug-catalog}.md`
  - `~/.claude/skills/sprig:breakdown/references/{capture-recipes,isolate-format}.md`
- **To resolve an import alias** (e.g. `@mrg-keystone/sprig`, `#assert`): read the PROJECT's
  `deno.json` `imports` map — the alias is defined there and nowhere else. Never search for it.
- **To find the sprig runtime's real `.ts` in the cache:** run `deno info jsr:@mrg-keystone/sprig`
  (or `deno info <specifier>`) — it prints the exact cached path in milliseconds. If you must
  grep vendored source, scope it to that path or to `~/Library/Caches/deno`, never `/`.
- **Playwright screenshots / console logs** land in the PROJECT's own `.playwright-mcp/`
  (at the app root) and `~/Library/Caches/ms-playwright-mcp/` — look there, never crawl the
  disk for the `.png` or `.log`.
- **Build output** (compiled islands, previews) lives under the app's own `dist/` /
  `.sprig/` — check the project tree, not the whole volume.

If something genuinely isn't in the project or the caches above, say so and ask — do not
escalate to a root-wide `find`.
