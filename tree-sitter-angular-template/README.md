# tree-sitter-angular-template

A **custom** [tree-sitter](https://tree-sitter.github.io/) grammar for Angular component
templates. It parses the whole Angular template surface — HTML structure, every binding
form, the built-in control-flow blocks, the legacy structural-directive microsyntax, and
an Angular expression sublanguage (pipes, ternary, safe-nav, arrow fns, literals).

It is verified against [`../fixtures/golden.html`](../fixtures/golden.html) (the "golden"
fixture that exercises every feature in [`../angular-html-features.md`](../angular-html-features.md)):
that file parses to a **1952-node AST with zero `ERROR`/`MISSING` nodes**. The parsed
tree is checked in at [`../fixtures/golden.ast.sexp`](../fixtures/golden.ast.sexp).

## Layout

| File | What |
|------|------|
| `grammar.js` | the grammar (single source of truth) |
| `src/scanner.c` | external scanner — open-tag stack, raw-text, implicit/auto-close end tags |
| `src/tag.h` | HTML tag table (void elements + auto-close rules) used by the scanner |
| `queries/highlights.scm` | syntax-highlight queries |
| `test/corpus/*.txt` | 56 corpus tests (`tree-sitter test`) |
| `tree-sitter.json` / `package.json` | tree-sitter + npm metadata |
| `src/` | generated parser (`parser.c`, `grammar.json`, `node-types.json`) |

## Build & parse

`tree-sitter generate` evaluates `grammar.js` with a JS runtime. On this machine `node`
is behind an nvm lazy-loader, so pass the real binary explicitly:

```sh
cd tree-sitter-angular-template

# generate the parser from grammar.js
tree-sitter generate --js-runtime /opt/homebrew/bin/node

# compile it (also compiles src/scanner.c and links it in)
tree-sitter build

# parse the golden fixture (run from this dir so the local grammar is used)
tree-sitter parse ../fixtures/golden.html          # prints the S-expression AST
tree-sitter parse ../fixtures/golden.html --quiet  # exit code only (0 == no errors)

# run the corpus test suite
tree-sitter test
```

## What it parses

- **HTML** — paired elements, self-closing component tags (`<c />`), **HTML5 void
  elements with or without a slash** (`<br>`, `<img src=x>`, `<input>`), **implicit/auto-close
  end tags** (`<li>a<li>b`, `<p>…<div>`, `<tr><td>a<td>b`, `<dt>/<dd>`), **raw-text
  `<script>`/`<style>` bodies**, comments, text, namespaced tags (`<svg:circle>`).
  Single- **and** double-quoted plain attribute values.
- **Interpolation** — `{{ expr }}` (incl. inside attribute values).
- **Bindings** — property `[p]`, attribute `[attr.x]`, class `[class.x]`, style with units
  `[style.width.px]` / `[style.width.%]`, CSS custom props `[style.--v]`, namespaced
  `[attr.xlink:href]`, events `(e)` incl. key combos, two-way `[(x)]`, animation
  `[@trig]` / `(@trig.done)`.
- **Refs & inputs** — `#ref`, `#ref="exportAs"`, `let-name` / `let-name="key"`.
- **Control flow** — `@if/@else if/@else` (incl. `; as`), `@for` (`track`, `@empty`, all
  `$index/$count/$first/$last/$even/$odd`, aliases), `@switch/@case/@default`,
  `@defer` (every trigger, `prefetch`, `@placeholder`/`@loading`/`@error`), `@let`.
- **Legacy structural directives** — `*ngIf` (`else` / `then…else` / `as`), `*ngFor`
  (`trackBy` + index/first/last/even/odd), `*ngSwitch*`, `*ngTemplateOutlet` (`context`),
  desugared `<ng-template [ngIf]>`.
- **Expressions** — pipes (chained, args), ternary, `??`, `?.`, `!`, `$any`, member/call
  chains, **keyed access `a[0]` / `a['k']`**, unary/binary with JS precedence, arrow
  functions, array/object literals (string/number keys), string/decimal/scientific/
  leading-dot numbers, `$event` and friends.

## External scanner

`src/scanner.c` is a hand-written C tokenizer compiled alongside the generated parser. The
regex lexer in `grammar.js` is stateless; the scanner adds the state HTML needs:

- **Open-tag stack** — every start tag pushes its (lowercased) name; end tags / implicit
  ends pop it. Serialized across edits for incremental parsing.
- **Raw text** — after `<script>`/`<style>`, the body is consumed verbatim up to the
  matching `</script>`/`</style>`, so `<`, `>`, `{`, `}` inside don't parse as markup.
- **Implicit / auto-close end tags** — emits a (hidden) `_implicit_end_tag` per HTML's
  rules: void elements (`<br>`, `<img>`), `<li>`/`<dt>`/`<dd>`, `<p>` before block
  elements, `<tr>`/`<td>`/`<th>`, `<optgroup>`, `<colgroup>`, `<rb>`/`<rt>`/`<rp>`, and at
  EOF / a parent's close. The void + auto-close tables live in `src/tag.h`.

The scanner and tag table are adapted from
[`tree-sitter-html`](https://github.com/tree-sitter/tree-sitter-html) (MIT) — the entry
symbols are renamed to `tree_sitter_angular_template_*` and the element rules in `grammar.js`
are wired to its externals (`_start_tag_name`, `_script_start_tag_name`,
`_style_start_tag_name`, `_end_tag_name`, `erroneous_end_tag_name`, `/>`,
`_implicit_end_tag`, `raw_text`, `comment`). All the Angular-specific machinery (bindings,
`@`-blocks, microsyntax, the expression sublanguage) is original and composes on top.

## Design notes

- **One declared conflict** (`_expression` vs `arrow_parameters` — the classic
  `(x) => …` vs `(x)` ambiguity); everything else falls out of operator precedence.
- The grammar was hardened by an adversarial stress test (6 feature dimensions, ~70
  generated fragments, independent re-verification of each failure). 11 of 12 confirmed
  gaps were fixed inline; the 12th (implicit end tags) plus raw text are now handled by the
  external scanner. Remaining cuts are documented below.

## Known limitations (deliberate)

Valid Angular/HTML this grammar does **not** handle. None occur in `golden.html`.

| Construct | Why not |
|-----------|---------|
| Double-quoted **string literals in expressions** (`{{ "x" }}`, `@case ("a")`) | Ambiguous with the `"` attribute delimiter; Angular's idiom is `'…'`. Would need context-split expression rules. |
| **Unquoted** attribute values (`<div id=main>`) | Low value; fixture always quotes. |
| Optional **call / keyed** safe-nav (`a?.()`, `a?.[i]`) | Niche; `a?.b` / `a?.b()` do parse. |
| **Template literals** (`` `hi ${x}` ``) | Angular 18.2+; niche. |
| Text immediately after a void tag (`<br>x`) attaches as a child until the next tag/EOF | Matches `tree-sitter-html`; use `<br/>` or a following tag. |

Constructs Angular itself rejects (object spread, computed/shorthand object keys,
block-body arrows, comma sequences, top-level assignment in interpolation) are correctly
**not** accepted.
