# Rendering Markdown

> Source: https://fresh.deno.dev/docs/examples/markdown

## TL;DR
Recommended: `@deno/gfm`. Read the file, `renderMarkdown()` to HTML, dump into a `<div dangerouslySetInnerHTML>`. Inject the bundled `CSS` for default styling.

## Install
```
deno install jsr:@deno/gfm
```

## Route
```tsx
import { define } from "@/utils.ts";
import { CSS, render as renderMarkdown } from "@deno/gfm";

export default define.page(async () => {
  const content = await Deno.readTextFile("./content/example.md");
  const html = renderMarkdown(content);

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});
```

## Alternatives
`marked`, `remark` — also work. `@deno/gfm` is the path of least resistance in Deno.

## See also
- `examples/rendering-raw-html.md` — same XSS warnings apply
