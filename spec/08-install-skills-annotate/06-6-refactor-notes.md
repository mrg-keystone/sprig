## 6. Refactor notes

Catalog of observed tensions in install/skills/annotate; each hands off to its
resolution in DX-IDEAL [§3.8](../DX-IDEAL/04-3-per-subsystem-ideal.md) and its
refactor driver in spec 10 [§2](../10-known-issues-and-refactor-drivers/02-2-agent-fleet-economics-from-optimize-md-feedback.md)–[§3](../10-known-issues-and-refactor-drivers/03-3-docs-move-with-the-api-release-discipline-from-readme-md.md)
— this doc names the problem, §3.8 owns the fix.

1. `init` cannot run from zero: on a fresh machine the very first command —
   `deno run -A jsr:@mrg-keystone/sprig init` — can't scaffold, because
   `installRoot()` has no `import.meta.dirname` on a remote run and exits with
   "run `sprig install`" ([§1](01-1-why-a-local-install-exists-at-all.md)), so
   the real on-ramp is install → init, not init. Hand off to DX-IDEAL §3.8
   "`init` works from zero, no install required first".
2. Four distribution channels (JSR publish set, GitHub runtime bundle, GitHub skills
   release, and the standalone `mrg-keystone/isolate` release → `~/.isolate` — [§1](01-1-why-a-local-install-exists-at-all.md))
   with different contents. Hand off to DX-IDEAL §3.8 "`init` works from zero,
   no install required first", which pairs the embedded-scaffold fix above with
   naming this four-channel split as the install-simplicity target: fewer
   channels a new machine has to reason about.
3. The install is imperatively copied state with `.old` backup; failed installs and
   `~/.sprig` wipes have been observed (spec 10 [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).6). Hand off to
   DX-IDEAL §3.8 "A manifest + `sprig doctor`/`--repair`".
4. Skills deployment "whole-entry replace" deletes user edits inside managed skill
   folders by design. Hand off to DX-IDEAL §3.8 "`update` never silently
   destroys user edits" (diff each managed entry against the shipped-hash
   manifest; back up any locally-changed file to
   `~/.claude/.sprig-overwritten/<ts>/`, not a silent `rm -rf`) — but that
   policy must reconcile with spec 10 [§2](../10-known-issues-and-refactor-drivers/02-2-agent-fleet-economics-from-optimize-md-feedback.md):
   the guardrail blocks inside `claude/` agent defs are AUTO-SYNCED,
   framework-owned content, never hand-edited, so a blanket "back up locally-
   changed files" policy must diff against the shipped-hash manifest rather
   than treat every deployed-vs-local difference as a user edit worth
   preserving.
5. annotate.ts mixes two products (component feedback vs prototype feedback) behind
   one overlay. Hand off to DX-IDEAL §3.8 "`annotate` is its own verb".
6. `docs/guide.md` has no isolate content at all (only a root README blurb),
   and both it and `cli/README.md` describe stale Vite/Fresh-era architecture,
   with no getting-started path connecting `sprig init`'s scaffold output to a
   working app. Hand off to DX-IDEAL §3.8 "`docs/guide.md` moves with the API
   too, and a real getting-started path exists", and to spec 10
   [§3](../10-known-issues-and-refactor-drivers/03-3-docs-move-with-the-api-release-discipline-from-readme-md.md)'s
   publish-blocking release-lint — docs update in the same commit as the
   public surface they document.
