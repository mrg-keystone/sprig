# Component-scoped CSS — co-locate a `*.module.css`

> How to scope styles to one component in Fresh 2. Fresh's only built-in stylesheet
> (the one `client.ts` imports) is **global**, so a hand-written `.css` leaks across the
> whole app and collides by class name. A **CSS Module** is the fix.

## TL;DR
Name the file `*.module.css`, put it in the component's own folder, and import it as an
object of class names. Vite rewrites every class to a hashed, collision-proof name — so two
components can both define `.card` with zero interference. The `.module` suffix is the only
switch; there is no config flag.

## The pattern
```
components/card/
  Card.tsx
  Card.module.css      ← the `.module` suffix is mandatory; `Card.css` stays global
```

```css
/* Card.module.css */
.card  { padding: 1rem; border: 1px solid var(--border); }
.title { font-weight: 800; }
```

```tsx
// Card.tsx — a server component (ships zero JS) or an island, either works
import styles from "./Card.module.css";

export function Card() {
  return (
    <div class={styles.card}>
      <h2 class={styles.title}>Scoped</h2>
    </div>
  );
}
```

Verified in a real Fresh 2 build (dev **and** production): the SSR'd HTML carries the
hashed class (`class="_card_sbtxc_1"`), Fresh auto-injects the matching
`<link rel="stylesheet">`, and the served CSS uses the scoped selector — nothing to wire
up. The hash is content-derived and **stable across renders** (same on server and client),
so islands hydrate without a class mismatch.

## Rules that bite
- **The suffix is the switch.** `Card.module.css` scopes; `Card.css` is global. Renaming is
  the entire difference — there's no config flag.
- **Reference classes through the imported object** (`styles.card`), never as a string
  literal (`class="card"`) — the literal name doesn't exist in the output, so the element
  renders unstyled. For a dynamic/conditional class, index it: `styles[variant]`.
- **A class the module never exports is `undefined`** at `styles.x` — a silent no-class.
  Typos fail quietly; check the rendered `class=""` if a style "didn't apply".
- **Keep genuinely global rules global.** Design tokens (`:root` custom properties),
  `@font-face`, resets, shared `@keyframes`, and element selectors belong in the
  `client.ts`/`_app.tsx` global sheet — a module is for *this component's* class rules.
  Custom properties defined globally are readable from inside a module (`var(--border)`
  above); only the class names are scoped, not the cascade.
- **Use kebab/camel consistently.** `styles["my-class"]` works but `styles.myClass` reads
  cleaner — pick one convention per project.

## See also
- `static-files.md` · `advanced/vite.md` — how assets and Vite handle CSS
- `../rebuild-from-ui-breakdown.md` — the spec's design tokens (`@theme`, fonts, keyframes) go
  in the global shared sheet, not in a module
