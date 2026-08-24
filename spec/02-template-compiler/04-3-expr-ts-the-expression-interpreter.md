## 3. expr.ts — the expression interpreter

`evalExpr(node, scope)` — pure interpreter, **no `new Function`** (expr.ts:3). Globals:
`true/false/null/undefined` only; identifier resolution scope → globals → `undefined`.

### Expression coverage

| Category | Example | Evaluation note |
|---|---|---|
| Literals: string / number / boolean | `"hi"`, `42`, `true` | strings pass through `unquote` (never throws — see below) |
| Parenthesized / non-null unwrap | `(a + b)`, `a!` | both evaluate straight through to the inner expression; `!` performs no runtime null check |
| Member / safe-member | `a.b`, `a?.b` | both null-safe (`null`/`undefined` receiver → `undefined`); `?.` ≡ `.` — no behavior difference |
| Subscript | `a[k]` | null-safe like member access |
| Calls | `fn(a, b)` | receiver-once + `this`-rebind contract — see call-semantics contract below |
| Unary | `!a`, `-a`, `+a` | `!` boolean-negates; `-`/`+` coerce the operand to `number` |
| Binary — logical | `a && b`, `a \|\| b`, `a ?? b` | short-circuit: the right side is only evaluated when the left doesn't already determine the result |
| Binary — comparison/arithmetic | `a + b` … `a >= b` | `+ - * / % == != === !== < > <= >=`, standard JS semantics |
| Ternary | `a ? b : c` | only the taken branch is evaluated |
| Pipes | `a \| uppercase` | see pipe table below |
| Array / object literals | `[a, b]`, `{k: v}` | every element/value is evaluated eagerly |
| Arrow functions | `(x) => x + 1` | see arrow-body contract below |

Contracts pinned by tests:
- **`$any(x)` is a compile-time-cast special case**, checked before any other call
  handling: it short-circuits and returns its first argument directly, never
  resolving `$any` itself as a callee (expr.ts:47-50). Without this case `$any`
  would fall through to plain call handling, fail to resolve in scope, and
  silently evaluate to `undefined` — breaking any template that uses it.
- **Method calls evaluate the receiver exactly once** and rebind `this` to it (incl.
  computed member `obj[key]()`); a bare identifier call naming a scope member binds
  `this = scope` (expr.ts:45-78; bugs G/P1).
- **Arrow bodies** use `Object.create(scope)` (prototype preserved so class methods
  resolve; params as own props; shared scope never mutated) (expr.ts:138-151).
- **`unquote` never throws**: `\u{…}`, `\uXXXX`, `\xNN`, named escapes via an
  `Object.create(null)` map (prototype-key guard); malformed escapes degrade to the
  literal char (a RangeError would abort the whole SSR render) (expr.ts:153-183).
- **Event statements** (`evalStatement`, client-side): child scope with `$event` as own
  prop (never leaks), assignment targets support identifier (with signal `.set()`
  detection), member, subscript (expr.ts:383-416).

**Worked example — call semantics.** Given

```
scope = {
  user: { name: "Ann", greet() { return `hi, ${this.name}`; } },
  obj: { fn() { return this === obj; } },
  key: "fn",
  helper() { return this === scope; },
};
```

| Call | Receiver evaluated | Evaluation count | `this` inside the call | Result |
|---|---|---|---|---|
| `user.greet()` | `user` (member `object`) | once | `user` | `"hi, Ann"` |
| `obj[key]()` | `obj` (subscript `object`); `key` resolves the index | once | `obj` | `true` |
| `helper()` | none — bare identifier naming a scope member | — | `scope` | `true` |
| `undeclared()` | none — `undeclared` resolves through scope → globals → `undefined` | — | not applicable (nothing to call) | `undefined` |

Each row is the receiver-once + `this`-rebind contract in practice (bugs G/P1): a
dotted or computed method call evaluates its receiver expression exactly one time and
applies the method with `this` bound to that receiver; a bare call naming a scope
member binds `this` to the whole scope; a callee that resolves to a non-function —
including one that resolves all the way through to `undefined` — degrades to
`undefined` rather than throwing.

**Pipes** (expr.ts:199-284). Multi-arg pipes read every `pipe_argument` child
(`slice:a:b`). Every locale-formatted pipe (`number`, `percent`, `currency`, `date`) is
pinned to the `"en-US"` locale — every `Intl.NumberFormat`/`Intl.DateTimeFormat`/
`toLocaleString` call hardcodes `"en-US"` (expr.ts:238, 253, 306, 340, 352-366) — never
the runtime/browser default, so SSR output and client hydration can never diverge on
locale.

| Pipe | Argument signature | Output / behavior |
|---|---|---|
| `uppercase` | none | `String(v ?? "").toUpperCase()` |
| `lowercase` | none | `String(v ?? "").toLowerCase()` |
| `titlecase` | none | capitalizes the first letter of each word and lower-cases the rest of that word, Unicode-aware; iterates by code point (astral-safe — a surrogate-pair initial uppercases correctly); e.g. `"iPhone"` → `"Iphone"`, not `"IPhone"` |
| `json` | none | `JSON.stringify(v, null, 2)` |
| `slice` | `start, end?` | `(v as unknown[])?.slice(start, end)` |
| `number` | `digitsInfo?` (default `"1.0-3"`) | locale-formatted number; DigitsInfo clamped to the legal Intl range (0-100 fraction digits, 1-21 integer digits) so a contradictory/out-of-range value can never throw; non-finite input → `""` |
| `percent` | `digitsInfo?` (default `"1.0-0"`) | percent-formatted via `Intl.NumberFormat`'s `style: "percent"` (the ×100 happens inside Intl, never a lossy `*100` float multiply); DigitsInfo clamped the same way as `number`; non-finite input → `""` |
| `currency` | `currencyCode?` (default `"USD"`) | currency-formatted via `Intl.NumberFormat`'s `style: "currency"`; non-finite input → `""`; no DigitsInfo argument — the currency code is the only argument this pipe reads |
| `date` | `format?` (default `"mediumDate"`) | one of the 12 named forms — the 4 combined date+time styles pair `dateStyle`/`timeStyle` **asymmetrically** (not matched pairs): `short`(dateStyle short/timeStyle short), `medium`(dateStyle medium/timeStyle **short**), `long`(dateStyle long/timeStyle **medium**), `full`(dateStyle full/timeStyle **long**) — plus their date-only/time-only suffixed variants `shortDate mediumDate longDate fullDate shortTime mediumTime longTime fullTime`, each a plain single-style form — or, for any other `format` value, a custom token pattern read left-to-right, longest-match-first, against the full token vocabulary `yyyy yy y MMMM MMM MM M dd d EEEE EEE HH H hh h mm ss a` (unmatched characters pass through literally); **date-only ISO parsed as LOCAL midnight** (avoids SSR-vs-client TZ drift); `yy` never emits a sign |
| `keyvalue` | none | `Object.entries(v ?? {}).map(([key, value]) => ({key, value}))` |
| `truncate` | `limit?` (default `20`) | truncates by code point (astral-safe), appends `…`; non-positive limit = unchanged string |
| `i18nPlural` | `map: Record<string, string>` | picks `map["=" + n]` else `map.other`, replaces `#` with `n`; never leaks `"NaN"` — non-finite input falls to `other` and drops the `#` placeholder |
| `i18nSelect` | `map: Record<string, string>` | `map[String(v)] ?? map.other ?? ""` |

> **[DECIDE]** An unrecognized pipe name resolves today by silent passthrough (the
> raw value, un-piped) instead of a build error — the same silent-inert class
> DX-IDEAL's "remove the silence" thesis flags for a fix. Whether the refactor
> keeps silent passthrough or turns an unrecognized pipe into a located build
> diagnostic is a product decision, not this spec's to make unilaterally.
> Recommended default: a located build error (`unknown pipe 'curency'; did you
> mean 'currency'?`) — the pipe vocabulary above is closed and known at compile
> time, so nothing is lost by rejecting a typo instead of silently rendering the
> unpiped value.

### Acceptance criteria

| Guarantee | Input | Expected output |
|---|---|---|
| Non-finite input never renders `"NaN"` (`number`/`percent`/`currency`) | `{{ undefined \| number }}` | `""` |
| `i18nPlural` never leaks `"NaN"` | `{{ (0/0) \| i18nPlural:{other:"other"} }}` | `"other"` (falls to `other`) |
| Date-only ISO parses as LOCAL midnight | `{{ "2026-07-19" \| date:"yyyy-MM-dd" }}` | `"2026-07-19"` in every server/client timezone — never shifts a day early or late |
| Malformed `\xNN` degrades to the literal char | `'\xG1'` | `xG1` (never throws) |
| Non-positive `truncate` limit leaves the string unchanged | `{{ "hello" \| truncate:0 }}` | `"hello"` |

