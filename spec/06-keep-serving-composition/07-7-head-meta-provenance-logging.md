## 7. Head-meta provenance + logging

> **Scope.** This section covers the injection MECHANISM (`injectHeadMeta`) and the
> provenance tags it carries — not the full head contract. Every tag/script SSR
> injects (`app.css`, `client.js` modulepreload, the vendored chart script, the perf
> beacon snippet, `git-*` meta, …) is owned by 04
> [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md) —
> the `git-*` meta this section produces is one row of that table. WHERE in the
> response pipeline the wrap runs is owned by
> [§3](03-3-the-servesprig-composition-current-as-built.md) row 9, which already
> states the SSR response "is then wrapped by `injectHeadMeta`".

`buildMetaReader(assetsDir)` reads `build-info.json` once (memoized for the life of
the deployment) and renders the provenance tags (`mod.ts:614-631`):

| meta tag | `build-info.json` field | when emitted |
| --- | --- | --- |
| `git-repo` | `repo` | `repo` is present as a non-empty string |
| `git-commit` | `commit` | `commit` is present as a non-empty string |
| `git-branch` | `branch` | `branch` is present as a non-empty string |
| `build-time` | `buildTime` | `buildTime` is present as a non-empty string |

Each tag is gated independently — a partially-populated `build-info.json` emits only
the fields it has, HTML-escaped (`&`/`"`/`<`).

`injectHeadMeta(res, meta)` splices `meta` right after the opening `<head>` via a
streaming `TransformStream`, so the tags land in the first flushed chunk without
buffering the rest of the body (`mod.ts:636-671`). Its guard sequence, checked in this
exact order, is the head-meta half's own acceptance criteria:

1. **`meta` is empty** — either no `build-info.json` on disk (dev, no build ran), in
   which case `buildMetaReader`'s catch branch resolves the reader's output to `""`
   with the comment "no build-info → emit nothing" (`mod.ts:626-628`); or a
   `build-info.json` that exists but has none of `repo`/`commit`/`branch`/`buildTime`
   as a non-empty string, in which case every `tag()` call is gated off and the
   concatenated result is `""` too (`mod.ts:625`). Either way this fires BEFORE the
   content-type/body test below even runs: `injectHeadMeta`'s empty-`meta`
   short-circuit turns it into a pure pass-through at the top of the function
   (`mod.ts:637`).
2. **Not HTML, or no body** — the response's `content-type` header doesn't include
   `text/html`, or `res.body` is `null` — returned completely unchanged.
3. **HTML with a body** — spliced: `meta` lands in the first flushed chunk, and
   `content-length` is dropped from the response. The spliced body is longer than the
   original by exactly the injected tags' byte length, so the original header would
   under-report and truncate the response in transit; dropping it lets the transport
   re-derive the length (or fall back to chunked encoding).
4. **No `<head>` in the first 8KB of the stream** — the accumulated chunk is flushed
   unmodified and splicing gives up for the rest of the response; it ships without
   provenance tags rather than buffering indefinitely — it never re-scans later chunks
   for a `<head>` that showed up late.

`FRAMEWORK_LOGGING` covers two distinct logging channels, both stamped with the same
`[fw:<scope>]` line prefix (`mod.ts:196-230`):

| channel | trigger | scope tag | gating | dedup |
| --- | --- | --- | --- | --- |
| opt-in trace (`fwLog`) | `FRAMEWORK_LOGGING=1\|true\|on\|*\|all` (every scope) or a comma list naming `compose`/`auth`/`session`/`guard` | `[fw:<scope>]` | off by default; env read once at import | none — every gated call logs |
| always-on once-per-key (`fwWarnOnce`) | unconditional — fires even with `FRAMEWORK_LOGGING` off, the silent-fallback fix | `[fw:auth]` (baked into the message; not scope-gated, since the point is to fire regardless of the trace flag) | always on | `key = "legacy:<path>:<reason>"` — one warning per (path, reason) per process, not per request |

Line shape is free-form per `fwLog` call site; the two contract lines below are the
ones `framework-logging.test.ts` pins exact wording on.

**`fwLog` LEGACY FALLBACK detail line** (`mod.ts:450`) — pinned by
framework-logging.test.ts's subprocess test, which asserts `[fw:auth]`, `LEGACY
FALLBACK`, `reason=no-intakeSession`, and the `[fw:session]`-scope line `engine
surfaced to gateway: intakeSession=no` (`mod.ts:598-602`/`810-814`):

```text
[fw:auth] <path> → LEGACY FALLBACK: mintSession returned null (reason=<reason>); proxying to infra; NO cookie set
```

**`fwWarnOnce` LEGACY bearer-mode message** (`mod.ts:437-451`) — pinned by
framework-logging.test.ts's default-env tests, which assert `LEGACY bearer mode`, the
degrading path (`/auth/login`/`/auth/exchange`), the degrade reason
(`DISABLED`/`ABSENT`), and `No sprig_session cookie will be set`; a dedup test confirms
an identical second fallback re-warns zero times:

```text
[fw:auth] <path> → LEGACY bearer mode: <detail>. No sprig_session cookie will be set — the SSR guard will bounce authed pages to /login. If you expected cookie sessions, this is the bug (set KEEP_SESSION_KV=1 + INFRA_URL, and check the engine reached serveSprig). Set FRAMEWORK_LOGGING=1 for the full auth trace.
```

Neither channel ever logs a secret (idToken/bearer/opaque token); the session id,
emails, grants, and cookie attributes are already surfaced to the client, so logging
them is fine.

