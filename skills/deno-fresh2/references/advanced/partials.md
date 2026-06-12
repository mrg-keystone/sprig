# Partials

> Source: https://fresh.deno.dev/docs/advanced/partials

## TL;DR
Partials are server-rendered chunks that swap into the page without a full reload. Wrap regions in `<Partial name="…">`. Enable client nav by adding `f-client-nav` to a parent. Optionally point links/forms at an alternate render via `f-partial="/url"`.

## Marking a region
```tsx
import { Partial } from "fresh/runtime";

<body f-client-nav>
  <Partial name="content">
    {/* swappable region */}
  </Partial>
</body>
```
`name` must be unique per page so the response can target it.

## Linking that triggers a partial swap
```html
<a href="/about" f-client-nav>About</a>
<!-- or: render a different URL into the same partial -->
<a href="/about" f-partial="/fragments/about">About</a>
```

## Replacement modes
`<Partial name="…" mode="replace" | "append" | "prepend">`. Default is `replace`. For `append`/`prepend`, supply a `key` prop to avoid render bugs.

## Multiple partials in one response
A single response can update multiple `<Partial>` regions simultaneously — emit them all from the responding route.

## Loading indicators
The runtime tracks in-flight partial requests via the `_freshIndicator` global (use it to show a spinner/progress bar).

## Disabling for a subtree
```html
<form f-client-nav={false}>...</form>
```

## Pairs with View Transitions
Add `f-view-transition` on the same root to wrap swaps in `document.startViewTransition()` (see `view-transitions.md`).

## See also
- `advanced/view-transitions.md`
- `advanced/forms.md` — partials work with form submits too
