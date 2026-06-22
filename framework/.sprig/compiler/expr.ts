// Expression evaluator: walks the grammar's expression sub-AST against a `scope`
// object (the @inputs + loop locals + island setup() result). Read-only — used by
// interpolation, bindings, @if/@for/@switch conditions. No `new Function`.
import { field, named, type Node } from "./node.ts";

export type Scope = Record<string, unknown>;

const GLOBALS: Record<string, unknown> = { true: true, false: false, null: null, undefined: undefined };

export function evalExpr(node: Node | null, scope: Scope): unknown {
  if (!node) return undefined;
  switch (node.type) {
    case "identifier": {
      const n = node.text;
      if (n in scope) return scope[n];
      if (n in GLOBALS) return GLOBALS[n];
      return undefined;
    }
    case "string":
      return unquote(node.text);
    case "number":
      return Number(node.text);
    case "boolean":
      return node.text === "true";
    case "parenthesized":
      return evalExpr(named(node)[0], scope);
    case "non_null_expression":
      return evalExpr(named(node)[0], scope);
    case "member_expression": {
      const obj = evalExpr(field(node, "object"), scope) as Record<string, unknown> | null;
      const prop = field(node, "property")!.text;
      return obj == null ? undefined : obj[prop];
    }
    case "safe_member_expression": {
      const obj = evalExpr(field(node, "object"), scope) as Record<string, unknown> | null;
      const prop = field(node, "property")!.text;
      return obj == null ? undefined : obj[prop];
    }
    case "subscript_expression": {
      const obj = evalExpr(field(node, "object"), scope) as Record<string, unknown> | null;
      const idx = evalExpr(field(node, "index"), scope);
      // deno-lint-ignore no-explicit-any
      return obj == null ? undefined : (obj as any)[idx as any];
    }
    case "call_expression": {
      const fnNode = field(node, "function")!;
      // $any(x) is a compile-time cast — just return x
      if (fnNode.type === "identifier" && fnNode.text === "$any") {
        return evalExpr(named(field(node, "arguments")!)[0], scope);
      }
      const fn = evalExpr(fnNode, scope);
      const argsNode = field(node, "arguments");
      const args = argsNode ? named(argsNode).map((a: Node) => evalExpr(a, scope)) : [];
      // method calls: rebind `this` to the receiver (e.g. items.reduce(...))
      if (fnNode.type === "member_expression" || fnNode.type === "safe_member_expression") {
        const recv = evalExpr(field(fnNode, "object"), scope);
        return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).apply(recv, args) : undefined;
      }
      // a bare call naming a scope member (e.g. a class-component method) → bind `this`
      // to the scope so class-style methods can use `this`; plain closures ignore it.
      if (fnNode.type === "identifier" && (fnNode.text in (scope as object))) {
        return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).apply(scope, args) : undefined;
      }
      return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown)(...args) : undefined;
    }
    case "unary_expression": {
      const op = field(node, "operator")!.text;
      const v = evalExpr(field(node, "operand"), scope);
      return op === "!" ? !v : op === "-" ? -(v as number) : +(v as number);
    }
    case "binary_expression":
      return evalBinary(node, scope);
    case "ternary_expression":
      return evalExpr(field(node, "condition"), scope)
        ? evalExpr(field(node, "consequence"), scope)
        : evalExpr(field(node, "alternative"), scope);
    case "pipe_expression":
      return evalPipe(node, scope);
    case "array":
      return named(node).map((c: Node) => evalExpr(c, scope));
    case "object": {
      const o: Record<string, unknown> = {};
      for (const pair of named(node)) {
        const key = field(pair, "key")!;
        const k = key.type === "string" ? unquote(key.text) : key.text;
        o[k] = evalExpr(field(pair, "value"), scope);
      }
      return o;
    }
    case "arrow_function":
      return makeArrow(node, scope);
    default:
      return undefined;
  }
}

function evalBinary(node: Node, scope: Scope): unknown {
  const op = field(node, "operator")!.text;
  // short-circuit for &&, ||, ??
  const l = evalExpr(field(node, "left"), scope);
  if (op === "&&") return l && evalExpr(field(node, "right"), scope);
  if (op === "||") return l || evalExpr(field(node, "right"), scope);
  if (op === "??") return l ?? evalExpr(field(node, "right"), scope);
  const r = evalExpr(field(node, "right"), scope);
  // deno-lint-ignore no-explicit-any
  const a = l as any, b = r as any;
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": return a % b;
    case "==": return a == b;
    case "!=": return a != b;
    case "===": return a === b;
    case "!==": return a !== b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    default: return undefined;
  }
}

function makeArrow(node: Node, scope: Scope): (...args: unknown[]) => unknown {
  const params = field(node, "parameters")!;
  const names = named(params).filter((c: Node) => c.type === "identifier").map((c: Node) => c.text);
  const body = field(node, "body")!;
  return (...args: unknown[]) => {
    const inner: Scope = { ...scope };
    names.forEach((n: string, i: number) => (inner[n] = args[i]));
    return evalExpr(body, inner);
  };
}

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(.)/g, "$1");
}

// ───────────────────────────────── pipes ────────────────────────────────────
function evalPipe(node: Node, scope: Scope): unknown {
  const value = evalExpr(field(node, "expression"), scope);
  const name = field(node, "name")!.text;
  // Every pipe_argument carries the same repeated field name "argument", so
  // childForFieldName() only ever yields the first (and serialize collapses the
  // rest). Collect ALL pipe_argument children so multi-arg pipes (slice:a:b) work.
  const args = named(node).filter((c: Node) => c.type === "pipe_argument").map((c: Node) =>
    evalExpr(named(c)[0], scope)
  );
  const pipe = PIPES[name];
  return pipe ? pipe(value, args) : value;
}

const PIPES: Record<string, (v: unknown, args: unknown[]) => unknown> = {
  uppercase: (v) => String(v ?? "").toUpperCase(),
  lowercase: (v) => String(v ?? "").toLowerCase(),
  titlecase: (v) =>
    // Unicode-aware: capitalize the FIRST letter of each word, including
    // non-ASCII initials ("éric" → "Éric"). The old /\w\S*/ used ASCII \w.
    String(v ?? "").replace(
      /\p{L}[\p{L}\p{N}]*/gu,
      (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
    ),
  json: (v) => JSON.stringify(v, null, 2),
  slice: (v, a) => (v as unknown[])?.slice(a[0] as number, a[1] as number | undefined),
  number: (v, a) => formatNumber(Number(v), a[0] as string | undefined),
  // Angular's PercentPipe default digitsInfo is "1.0-0" (no fraction digits),
  // not the number/DecimalPipe default of up to 3.
  percent: (v, a) => {
    const n = Number(v) * 100;
    if (!isFinite(n)) return "";
    return `${formatNumber(n, (a[0] as string | undefined) ?? "1.0-0")}%`;
  },
  currency: (v, a) => {
    const n = Number(v);
    if (!isFinite(n)) return "";
    const code = (a[0] as string) ?? "USD";
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
    } catch {
      return `${code} ${n.toFixed(2)}`;
    }
  },
  date: (v, a) => formatDate(v, (a[0] as string) ?? "mediumDate"),
  keyvalue: (v) =>
    Object.entries((v as Record<string, unknown>) ?? {}).map(([key, value]) => ({ key, value })),
  truncate: (v, a) => {
    const s = String(v ?? "");
    const limit = (a[0] as number) ?? 20;
    return s.length > limit ? s.slice(0, limit) + "…" : s;
  },
  i18nPlural: (v, a) => {
    const map = (a[0] as Record<string, string>) ?? {};
    const n = Number(v);
    const key = map[`=${n}`] ?? map.other ?? "";
    return String(key).replace("#", String(n));
  },
  i18nSelect: (v, a) => {
    const map = (a[0] as Record<string, string>) ?? {};
    return map[String(v)] ?? map.other ?? "";
  },
};

function formatNumber(n: number, fmt?: string): string {
  // Non-finite input (undefined/NaN/Infinity) → empty string instead of "NaN".
  if (!isFinite(n)) return "";
  // fmt = "{minInt}.{minFrac}-{maxFrac}", e.g. "1.0-2". The "-{maxFrac}" segment
  // is OPTIONAL in Angular's DigitsInfo grammar; {minInt} controls integer padding.
  let minInt = 1, minFrac = 0, maxFrac = 3;
  if (fmt) {
    const m = fmt.match(/^(\d+)\.(\d+)(?:-(\d+))?$/);
    if (m) {
      minInt = Number(m[1]);
      minFrac = Number(m[2]);
      maxFrac = m[3] !== undefined ? Number(m[3]) : Math.max(minFrac, 3);
    }
  }
  // Clamp to the legal Intl range (0..100) and keep maxFrac >= minFrac so a
  // contradictory/out-of-range digitsInfo can never throw a RangeError.
  minFrac = Math.min(Math.max(minFrac, 0), 100);
  maxFrac = Math.min(Math.max(maxFrac, minFrac), 100);
  minInt = Math.min(Math.max(minInt, 1), 21);
  try {
    return n.toLocaleString("en-US", {
      minimumIntegerDigits: minInt,
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    });
  } catch {
    return String(n);
  }
}

function formatDate(v: unknown, fmt: string): string {
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v ?? "");
  const opts: Record<string, Intl.DateTimeFormatOptions> = {
    short: { dateStyle: "short", timeStyle: "short" },
    medium: { dateStyle: "medium", timeStyle: "short" },
    long: { dateStyle: "long", timeStyle: "medium" },
    full: { dateStyle: "full", timeStyle: "long" },
    shortDate: { dateStyle: "short" },
    mediumDate: { dateStyle: "medium" },
    longDate: { dateStyle: "long" },
    fullDate: { dateStyle: "full" },
    shortTime: { timeStyle: "short" },
    mediumTime: { timeStyle: "medium" },
    longTime: { timeStyle: "long" },
    fullTime: { timeStyle: "full" },
  };
  if (opts[fmt]) return new Intl.DateTimeFormat("en-US", opts[fmt]).format(d);
  // Otherwise treat fmt as a custom token pattern (yyyy-MM-dd, "MMM d, y", …)
  // instead of leaking the raw ISO machine timestamp.
  return formatDatePattern(d, fmt);
}

function formatDatePattern(d: Date, pattern: string): string {
  const pad = (x: number, len = 2) => String(x).padStart(len, "0");
  const tokens: Record<string, () => string> = {
    yyyy: () => String(d.getFullYear()).padStart(4, "0"),
    yy: () => pad(d.getFullYear() % 100),
    y: () => String(d.getFullYear()),
    MMMM: () => d.toLocaleString("en-US", { month: "long" }),
    MMM: () => d.toLocaleString("en-US", { month: "short" }),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    dd: () => pad(d.getDate()),
    d: () => String(d.getDate()),
    EEEE: () => d.toLocaleString("en-US", { weekday: "long" }),
    EEE: () => d.toLocaleString("en-US", { weekday: "short" }),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => pad(((d.getHours() + 11) % 12) + 1),
    h: () => String(((d.getHours() + 11) % 12) + 1),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    a: () => (d.getHours() < 12 ? "AM" : "PM"),
  };
  // Longest tokens first so "yyyy" wins over "yy", "MMMM" over "MMM", etc.
  return pattern.replace(
    /yyyy|yy|y|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g,
    (t) => tokens[t](),
  );
}

// ─────────────────── event statements (client hydration) ────────────────────
import { named as _named } from "./node.ts";

/** Evaluate an (event) handler against `scope` with `$event` bound. The grammar's
 *  `_event_body` is a HIDDEN rule, so tree-sitter inlines its `;`-separated
 *  statements as direct children of the `event_binding`. Pass the whole
 *  `event_binding` node here to run EVERY statement; a bare single statement node
 *  is also accepted (it runs on its own). Supports calls and assignments. */
export function evalStatement(handler: Node, scope: Scope, event: unknown): void {
  // inherit from scope (don't spread) so a class-instance scope keeps its prototype
  // methods resolvable in handlers; $event is an own prop and the scope isn't mutated.
  const s: Scope = Object.create(scope as object);
  (s as Record<string, unknown>).$event = event;
  // When handed the event_binding parent, the statements are its named children
  // minus the leading `binding_name`. A lone statement node runs by itself.
  const stmts = handler.type === "event_binding"
    ? _named(handler).filter((c: Node) => c.type !== "binding_name")
    : [handler];
  for (const stmt of stmts) {
    if (stmt.type === "assignment") {
      assignTo(field(stmt, "left"), evalExpr(field(stmt, "right"), s), s);
    } else {
      evalExpr(stmt, s);
    }
  }
}

function assignTo(left: Node | null, value: unknown, scope: Scope): void {
  if (!left) return;
  if (left.type === "identifier") {
    const target = scope[left.text] as { set?: (v: unknown) => void } | undefined;
    if (target && typeof target.set === "function") target.set(value);
    else scope[left.text] = value;
  } else if (left.type === "member_expression") {
    const obj = evalExpr(field(left, "object"), scope) as Record<string, unknown> | null;
    if (obj) obj[field(left, "property")!.text] = value;
  } else if (left.type === "subscript_expression") {
    // arr[i] = x / obj['k'] = x — evaluate the receiver and the index expression.
    const obj = evalExpr(field(left, "object"), scope) as Record<PropertyKey, unknown> | null;
    if (obj) obj[evalExpr(field(left, "index"), scope) as PropertyKey] = value;
  }
}
