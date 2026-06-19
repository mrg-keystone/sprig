# View Transitions

> Source: https://fresh.deno.dev/docs/advanced/view-transitions

## TL;DR
Opt in by adding `f-view-transition` next to `f-client-nav` on the root. Partial-nav swaps then run inside `document.startViewTransition()` for a free cross-fade. Progressive enhancement — unsupported browsers just navigate without animation.

## Enable
```tsx
<body f-client-nav f-view-transition>
  <Component />
</body>
```

## Customizing
Default is a cross-fade. Use CSS pseudo-elements:
```css
::view-transition-old(root) { animation: fade-out .2s; }
::view-transition-new(root) { animation: fade-in  .2s; }
```
Per-element transitions: assign `view-transition-name` in CSS to specific elements (sidebar, header) so they animate independently while content swaps.

## Browser support
- Chrome 111+, Edge 111+, Safari 18+
- Firefox: in progress
- Unsupported → silent fallback, no polyfill needed

## See also
- `advanced/partials.md` — view transitions are layered on top of partial nav
