## 9. Zero-composition derivation

`serveSprig`/`sprigUi` compute `entryRoot` from the running entrypoint on every call —
it has no config option of its own. `srcDir`, `assetsDir`, `base`, `routes`, and `app`
each fall back to a derived default whenever the corresponding config option is
omitted. One row per derived value, in dependency order — `entryRoot` anchors
`srcDir`/`assetsDir`, `srcDir` feeds `routes`, and `base` + `routes` feed `app`,
composed last:

| value | derived from | default (derived value) | when/how to override |
|---|---|---|---|
| `entryRoot` | dir of `Deno.mainModule` (the git-root `serve.ts`) | `<dir of Deno.mainModule>`; `null` for a non-file entry (jsr:/https:/test harness) | no override — when `null`, downstream derivations fail (see failure modes below) |
| `srcDir` | `deriveUiDir("src")`, where `deriveUiDir(sub) = <entryRoot>/ui/<sub>` (bare cwd-relative `sub` only when there is no file anchor) | `<entryRoot>/ui/src` | no direct `srcDir` config option — pass `app` explicitly to skip this derivation |
| `assetsDir` | `entryRoot` | `<entryRoot>/ui/static` | pass `assetsDir` explicitly ([§3](03-3-the-servesprig-composition-current-as-built.md).1) — required when the layout deviates (see failure modes below) |
| `base` | `serveSprig`/`sprigUi`'s `base?` option | see [§3](03-3-the-servesprig-composition-current-as-built.md).1; under the §1 target the app mounts at root instead — root `/`, root-relative `/_assets/*` — whether the `base` param survives (defaulting `""`) or is removed outright is [§3](03-3-the-servesprig-composition-current-as-built.md).3's call, not this section's | pass `base` explicitly ([§3](03-3-the-servesprig-composition-current-as-built.md).1) |
| `routes` | `resolveAppRoutes(srcDir)` (`mod.ts:708-722`) — same resolution `sprig dev`'s `appRoutes` runs | `<srcDir>/routers/root/routes.json` or legacy `<srcDir>/root.json` present → [§8](08-8-json-folder-routing.md)'s `loadRoutes`; else import `<srcDir>/mod.ts` and use its exported `routes` array (this is how the scaffold's TS routes — `ui/src/mod.ts` `export const routes = defineRoutes([...])`, spec 05 [§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md) — reach a derived prod composition) | no override — neither source present fails (see failure modes below) |
| `app` | `serveSprig`/`sprigUi`'s `app?` option | omitted → composed LAZILY on first request (memoized) via `composeApp(srcDir, base)` — see the assembly note below | pass `app` (a bootstrapped `{fetch}`) directly — bypasses `srcDir`/`routes` derivation |

**Assembly.** `composeApp(srcDir, base) = createRenderer(srcDir, base, { dev:
!!SPRIG_DEV }) + bootstrap({routes, base, renderer})` (`packages/keep/mod.ts:727-730`
— both `serveSprig` and `sprigUi` do this today; the target `Frontend` handler
([§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)) would too).
`createRenderer` here is spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)'s
`createRenderer` — construction, registries, and the `templates.json`/tree-sitter
fallback are specified there, not here.

**Why lazy, why no knobs.** `app` composes lazily on first request, memoized, rather
than eagerly at `serveSprig`/`sprigUi`'s call time, so those calls keep their
synchronous `{ fetch }` return (`mod.ts:784-788`) — composing eagerly would force an
`await` (route resolution can `import()` `<srcDir>/mod.ts`) inside what every caller
today treats as a synchronous config step. `srcDir` and `routes` carry no config knob
of their own because both exist only to feed this one composition step; the sole
escape hatch is passing a fully-composed `app` directly, which bypasses both
derivations at once rather than adding knobs that could disagree with what `app` was
actually built from.

**Derivation is correct when:**

- `entryRoot` is the dir of `Deno.mainModule` for a file (`file:`) entry, else `null`.
- `srcDir` is `<entryRoot>/ui/src`.
- `assetsDir` is `<entryRoot>/ui/static`.
- `routes` resolve from `<srcDir>/routers/root/routes.json` (or legacy `root.json`)
  when present, else `<srcDir>/mod.ts`'s exported `routes` array.
- `app` is `composeApp(srcDir, base)`.
- passing `app` explicitly skips the `srcDir`/`routes` derivation entirely.
- passing `assetsDir` explicitly replaces the `<entryRoot>/ui/static` default outright.
- a non-file entry yields `entryRoot = null` without failing at derivation — the `null`
  propagates and fails downstream instead (see failure modes below).

**Zero-config walkthrough.** Entry `file:///home/me/app/serve.ts` → `entryRoot =
/home/me/app` → `srcDir = /home/me/app/ui/src`, `assetsDir =
/home/me/app/ui/static` → `routes` resolved from
`/home/me/app/ui/src/routers/root/routes.json` (or, absent that, its `mod.ts`
exported `routes` array) → `app` composed lazily on first request via
`composeApp(srcDir, base)`.

**Derivation failures.**

| trigger | symptom | fix |
|---|---|---|
| non-file entry (jsr:/https:/test harness) | `entryRoot` is `null` — `deriveUiDir` falls back to the bare cwd-relative `srcDir`/`assetsDir` (`"src"`/`"static"`), which is almost certainly wrong; fails loudly downstream (`resolveAppRoutes` throws, or `/_assets/*` 404s) rather than at derivation | pass `app` and `assetsDir` explicitly |
| no `<srcDir>/routers/root/routes.json` (or legacy `root.json`) and no `<srcDir>/mod.ts` `routes` export | throws, naming both options | add one of the two route sources under `srcDir` |
| `assetsDir` layout deviates from `<entryRoot>/ui/static` (e.g. the workbench building into `$SPRIG_WB_ROOT/static`) | every `/_assets/*` 404s | pass `assetsDir` explicitly |

