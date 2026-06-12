# Rendering Raw HTML

> Source: https://fresh.deno.dev/docs/examples/rendering-raw-html

## TL;DR
Use Preact's `dangerouslySetInnerHTML={{ __html: "…" }}`. The name is intentionally scary — only render trusted/sanitized HTML. XSS lives here.

## Example
```tsx
<div dangerouslySetInnerHTML={{ __html: "<h1>Raw</h1>" }} />
```

## Rules
- Only inject HTML you produced or pre-sanitized.
- Never inject untrusted user content directly.
- Common safe uses: syntax-highlighted code blocks, rendered Markdown.

## See also
- `examples/markdown.md`
