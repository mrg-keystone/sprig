## 2. The `KeepApi` seam + session types (current, as built)

> **CURRENT.** §2–[§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) are the as-built factual record of today's `serveSprig`-era
> composition — this is what ships now, anchors intact; it is not history. [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s
> `Frontend` contract (where the whole seam narrows to the third argument's
> `{ fetch }`) is the target that would replace this section once §10.0 lands it.

Naming, for the record: a **keep** was the generated backend this package composed
around (00 glossary) — hence this package's historical name, `packages/keep/mod.ts`.
`KeepApi` is the structural cross-framework interface `serveSprig` consumes today:

| member | type | channel / role | required? |
|---|---|---|---|
| `backend` | `{ fetch: typeof fetch }` | in-process client (SSR channel) — the raw `{ fetch }` [§3.2 row 9](03-3-the-servesprig-composition-current-as-built.md) wraps via `backendClient` into [01 §1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)'s `BackendClient`/`Backend` token | always |
| `handler` | `(req: Request, info?: Deno.ServeHandlerInfo) => Response \| Promise<Response>` | the `/api/*` network surface | always |
| `intakeSession` | `(intake: SessionIntake) => Promise<SessionMinted>` | mints a session from a credential ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) `/auth/login`, `/auth/exchange`) | optional, independently — see capability table below |
| `destroySession` | `(id: string) => Promise<void>` | destroys a session server-side ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) `/auth/logout`) | optional, independently — see capability table below |
| `sessions.read` | `(id: string) => Promise<SessionProfile \| null>` | resolves the cookie `id` → profile, for `/auth/me` and the SSR `env.session` thread ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) | optional, independently — see capability table below |

The three optional members — `intakeSession?`, `destroySession?`, `sessions?` —
together are `SessionEngine`, the type [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)'s
`sprigAuth(config: { …, keep?: SessionEngine })` reuses. Each member gates exactly one
capability, independently of the other two — presence of one says nothing about the
others:

| capability (member) | gates | seam-level effect when absent |
|---|---|---|
| `intakeSession` | minting a session from a credential | falls back to legacy bearer mode; per-endpoint behavior in [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `destroySession` | server-side session destruction | falls back to a cookie-clearing no-op; per-endpoint behavior in [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `sessions.read` | resolving the cookie `id` → profile | falls back to legacy bearer mode, `env.session` stays null; per-endpoint behavior in [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |

The generated keep this package composes gates all three together on
`KEEP_SESSION_KV` — in practice they arrive present or absent as a set — but the type
itself carries no such bundling: [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) guards each member separately, so a host could in
principle supply any subset and each capability would fall back to legacy on its own.

One keep exposes two unconditional members — `backend` and `handler` — because DI never
crosses the wire ([01 §1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)'s `Backend` token; [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)
Rule 2 restates it for the target). SSR runs in-process with sprig, so it binds
`backend`'s raw `{ fetch }` straight onto the `Backend` DI token via `backendClient`
([§3.2 row 9](03-3-the-servesprig-composition-current-as-built.md)). An island runs in the browser, outside that process — it cannot
reach an in-process client or inject `Backend` — so it re-fetches over the network
instead, and `handler` is what answers that fetch at `/api/*` ([§3.2 row 7](03-3-the-servesprig-composition-current-as-built.md)). Same
backend, two channels, because DI cannot span the wire and the network can.

One identity threads across three shapes — `SessionIntake` (in), `SessionMinted`
(minted server-side), `SessionProfile` (out); `SessionProfile` is [01 §1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)'s
type (`core.ts:452-456`), not restated here:

```ts
interface SessionIntake {
  credential: string;
  credentialKind: "firebase" | "opaque";
  email?: string;
}

interface SessionMinted {
  id: string;
  creator: string;
  email?: string;
  grants: string[];
}
```

> **Invariant: the opaque session `id` must never reach the client.** Its sole egress
> is the httpOnly `sprig_session` cookie — it is never written into a response body.
> It is absent from every client-visible surface: the `/auth/login`/`/auth/exchange`
> success body, `/auth/me`'s response, and `SessionProfile` itself all omit it. The
> wire-disposition table below is the enforcement of that invariant field-by-field.

| field | type | lives in | wire disposition |
|---|---|---|---|
| `credential` | `string` | `SessionIntake` | server-side only — input to `intakeSession`, never echoed back |
| `credentialKind` | `"firebase" \| "opaque"` | `SessionIntake` | server-side only |
| `id` | `string` (opaque session id) | `SessionMinted` | cookie only — folds into the httpOnly `sprig_session` cookie; never leaves the server, never serialized to the client (not even in `SessionProfile`) |
| `creator` | `string` | `SessionMinted` | the identity the backend resolved the credential to; serialized to the client body **renamed to `name`** (next row) in `/auth/login`/`/auth/exchange`'s success body ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) |
| `name` | `string?` | `SessionProfile` | the client-facing rename of `creator` — the field a client actually reads |
| `email` | `string?` | `SessionIntake` (pass-through input, never used to gate — [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)), `SessionMinted`, `SessionProfile` | serialized to client body as `email` |
| `grants` | `string[]` in `SessionMinted`, `string[]?` in `SessionProfile` | `SessionMinted`, `SessionProfile` | serialized to client body as `grants` — UX-only; enforcement is server-side ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) |

**Golden path**, concrete: a firebase credential enters as `SessionIntake { credential:
"<idToken>", credentialKind: "firebase" }` → `intakeSession` resolves it to
`SessionMinted { id: "sess_abc", creator: "Ada", email: "ada@x", grants: ["admin"] }` →
the cookie carries only `id` (`sprig_session=sess_abc`, httpOnly) while `/auth/login`'s
success body returns `{ name: "Ada", email: "ada@x", grants: ["admin"] }` ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) → a
later SSR request resolves that cookie via `sessions.read("sess_abc")` into
`env.session: SessionProfile { name: "Ada", email: "ada@x", grants: ["admin"] }`
([§3.2 row 9](03-3-the-servesprig-composition-current-as-built.md)) → an island's `fetch("/api/…")` carries the same `sprig_session`
cookie into `handler` ([§3.2 row 7](03-3-the-servesprig-composition-current-as-built.md)).

`KeepApi` retires under [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) once it lands — see §1 Rules 1–2.

