# guarded-app — route guards demo

The smallest sprig app whose point is the `guards:` column of the route table.
A guard is a function that returns **the route the navigation should go to**, as
an array of path segments: return `ctx.path` (the route it was going to hit
anyway) to proceed, any other route to answer with a **302 redirect** there.
Guards use `inject()` for DI and run before `resolve` — a denied page does no
data work.

The app mounts at **`/ui`** (the scaffold/dev-server convention). Guards return
APP-RELATIVE routes — `["login"]`, never `["ui","login"]` — and the framework
prefixes the base onto the redirect `Location` (`/ui/login`).

## Run it

```sh
deno task build && deno task start     # prod-style → http://localhost:8000/ui
# or
deno task dev                          # dev server + HMR (prints its /ui URL)
```

## The route table (src/mod.ts)

| Route | Guards | Behavior |
|---|---|---|
| `/` `/login` `/denied` | — | public |
| `/admin` | `requireAuth` | anonymous → 302 `/ui/login` |
| `/admin/users` | *(inherited)* | protected by the **parent** route's `requireAuth` |
| `/admin/danger` | `requireAuth` → `requireAdmin` | chain runs parent-first; `requireAdmin` is **async**; bob → 302 `/ui/denied` |
| `/go/login/:user` | `loginAs` | **action route**: no `load` — the guard signs you in (via `inject(Session)` + `ctx.params`) and always returns `["admin"]`, so it never renders |
| `/go/logout` | `logout` | clears the session, returns `[]` (the root route) |

## Click path

1. Open `/ui` — you are anonymous. Click **Console** → bounced to the login page.
2. **Log in as bob** → `/go/login/bob`'s guard signs you in → lands on the console.
3. **Danger zone** → `requireAuth` passes, `requireAdmin` bounces bob to `/ui/denied`.
4. **Become admin** → console, then **Danger zone** renders.
5. **Log out** → home, anonymous again.

Or curl it:

```sh
curl -i  localhost:8000/ui/admin              # 302 → /ui/login
curl -iL localhost:8000/ui/go/login/bob       # logs in, follows 302 → console (200)
curl -i  localhost:8000/ui/admin/danger       # bob: 302 → /ui/denied
curl -iL localhost:8000/ui/go/login/admin     # 302 → /ui/admin
curl -i  localhost:8000/ui/admin/danger       # admin: 200
curl -i  localhost:8000/ui/go/logout          # 302 → /ui/
```

The session is a module-scope singleton (`src/services/session.ts`) so the demo
needs no cookies or backend — one shared login per process, on purpose. A real
app would key the session off the request inside a service of the same shape.
