// View encapsulation (Angular "Emulated" model, no Shadow DOM — SSR-friendly).
// Each component gets a stable scope id. At SSR every element from that component's
// template carries the id as a bare marker attribute; at build each rule in the
// component's styles.css is rewritten so its KEY (rightmost) compound selector also
// requires that marker. Result: a component's styles can only land on that
// component's own elements — they never leak to or clobber another component.
//
// Rightmost-only scoping is sufficient for the encapsulation guarantee: the styled
// element always carries the marker, so a rule from component A can never style an
// element of component B (whose elements carry B's marker).

/** Stable, SYNCHRONOUS scope id from a selector (FNV-1a 32-bit). MUST be identical
 *  on the build side (CSS rewrite) and the SSR side (element markers). */
export function scopeId(selector: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < selector.length; i++) {
    h ^= selector.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "s" + (h >>> 0).toString(16).padStart(8, "0");
}

/** A component's view-encapsulation scope id, derived from its UNIQUE folder path
 *  (relative to srcDir) rather than its bare basename — so two folders that share a
 *  basename (e.g. shared-components/issue-card vs pages/board/components/issue-card)
 *  get DIFFERENT scope ids and their styles never cross-apply. The build side (CSS
 *  rewrite) and the SSR side (element markers) MUST both call this with the same
 *  relative dir. Path separators are normalised so it is OS-independent. */
export function componentScopeId(relDir: string): string {
  return scopeId(relDir.replace(/\\/g, "/"));
}

// At-rules whose body is NOT a list of style rules (descriptors / keyframe stops
// / nothing): their inner content must be left opaque (no scoping, no recursion).
// Every OTHER at-rule (@media, @supports, @container, @layer, @scope, @document,
// and rule-bearing newcomers like @starting-style) wraps ordinary style rules and
// must be recursed into so its inner rules get the scope marker too.
const SKIP = /^@(-?\w+-)?(keyframes|font-face|page|property|charset|import|namespace|counter-style)\b/i;

/** Rewrite every rule in `css` so its key compound is scoped to `[attr]`. */
export function scopeCss(css: string, attr: string): string {
  return processBlock(stripComments(css), `[${attr}]`);
}

/** Strip /* … *\/ comments, but treat CSS string literals ("…"/'…') and url(…)
 *  token contents as opaque — a /* inside a string or URL is NOT a comment. */
function stripComments(s: string): string {
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") {
      // copy the whole quoted string verbatim (honouring backslash escapes)
      const q = c;
      out += c;
      i++;
      while (i < n) {
        out += s[i];
        if (s[i] === "\\") { i++; if (i < n) { out += s[i]; i++; } continue; }
        if (s[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // url( … ) — its contents are an opaque token when not quoted
    if ((c === "u" || c === "U") && /^url\(/i.test(s.slice(i, i + 4))) {
      out += s.slice(i, i + 4);
      i += 4;
      while (i < n && s[i] !== ")") {
        if (s[i] === '"' || s[i] === "'") {
          const q = s[i];
          out += s[i];
          i++;
          while (i < n) {
            out += s[i];
            if (s[i] === "\\") { i++; if (i < n) { out += s[i]; i++; } continue; }
            if (s[i] === q) { i++; break; }
            i++;
          }
          continue;
        }
        out += s[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function processBlock(css: string, token: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ws = i;
    while (i < n && /\s/.test(css[i])) i++;
    out += css.slice(ws, i);
    if (i >= n) break;

    // read the prelude up to { ; or } — ignoring grouping chars inside strings
    let j = i, dp = 0, db = 0;
    while (j < n) {
      const c = css[j];
      if (c === '"' || c === "'") { j = skipString(css, j); continue; }
      if (c === "(") dp++;
      else if (c === ")") dp--;
      else if (c === "[") db++;
      else if (c === "]") db--;
      else if (dp === 0 && db === 0 && (c === "{" || c === ";" || c === "}")) break;
      j++;
    }
    const prelude = css.slice(i, j);
    const term = css[j];

    if (j >= n || term === ";" || term === "}") {
      out += prelude + (j < n && term !== "}" ? css[j] : term === "}" ? "}" : "");
      i = j + 1;
      continue;
    }
    // term === "{" — find the matching close (ignoring braces inside strings)
    let depth = 0, k = j;
    for (; k < n; k++) {
      const c = css[k];
      if (c === '"' || c === "'") { k = skipString(css, k) - 1; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    const inner = css.slice(j + 1, k);
    const head = prelude.trim();
    if (head.startsWith("@")) {
      // SKIP: at-rules whose body is not style rules → opaque. Everything else
      // (@media/@supports/… and rule-bearing newcomers like @starting-style) is
      // recursed so its inner rules are scoped too.
      if (SKIP.test(head)) out += prelude + "{" + inner + "}";
      else out += prelude + "{" + processBlock(inner, token) + "}";
    } else {
      // recurse into the body too, so nested style rules (native CSS nesting)
      // get their key compound scoped; plain declarations pass through unchanged.
      out += scopeSelectorList(prelude, token) + " {" + processBlock(inner, token) + "}";
    }
    i = k + 1;
  }
  return out;
}

/** Advance past a CSS string literal that starts at index `i` (css[i] is the
 *  opening quote), honouring backslash escapes. Returns the index just AFTER the
 *  closing quote (or n if unterminated). */
function skipString(s: string, i: number): number {
  const q = s[i];
  i++;
  const n = s.length;
  while (i < n) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === q) return i + 1;
    i++;
  }
  return n;
}

function scopeSelectorList(list: string, token: string): string {
  return splitTop(list, ",").map((s) => scopeSelector(s.trim(), token)).join(", ");
}

function scopeSelector(sel: string, token: string): string {
  if (!sel) return sel;
  // :host / :host(x) → the scope marker itself
  if (sel === ":host") return token;

  // :host()/:host-context() handling. These pseudo-classes bind to the host
  // element, so they only ever appear at the HEAD of the selector. We parse
  // that head into: a chain of ancestor guards (from each :host-context(LIST)),
  // and the host element's own compound(s) (from :host(LIST), or the bare
  // marker). Comma-lists inside either are DISTRIBUTED across fully-scoped
  // output selectors so no top-level comma member is ever left unscoped — the
  // bug this guards against is a list member leaking as a bare global selector.
  const host = parseHostHead(sel, token);
  if (host) {
    const out: string[] = [];
    for (const anc of host.ancestorCombos) {
      const ancStr = anc.length ? anc.join(" ") + " " : "";
      for (const hc of host.hostCompounds) {
        // scope the key compound of `host-compound + descendant suffix`; the
        // host compound already carries the marker, so when the suffix is empty
        // insertToken leaves it alone (`[token].on`), and when it is non-empty
        // the marker lands on the suffix's key compound instead.
        out.push(ancStr + scopeKeyCompound(hc + host.suffix, token));
      }
    }
    return out.join(", ");
  }

  return scopeKeyCompound(sel, token);
}

/** Scope the rightmost (key) compound of a single selector (no top-level commas,
 *  no :host pseudos): the head (ancestor compounds) is left unscoped except for
 *  unwrapping any :global(), and the key compound gets the marker. */
function scopeKeyCompound(sel: string, token: string): string {
  // find the start of the rightmost (key) compound — after the last top-level
  // combinator (string- and escape-aware so quoted/escaped chars don't count)
  let dp = 0, db = 0, keyStart = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { i = skipString(sel, i) - 1; continue; }
    if (c === "(") dp++;
    else if (c === ")") dp--;
    else if (c === "[") db++;
    else if (c === "]") db--;
    else if (dp === 0 && db === 0 && (c === " " || c === ">" || c === "+" || c === "~" || c === "\t" || c === "\n")) {
      keyStart = i + 1;
    }
  }
  // the head (ancestor compounds) is left unscoped; just unwrap any :global() there
  const head = sel.slice(0, keyStart).replace(/:global\(([^)]*)\)/g, "$1");
  return head + insertToken(sel.slice(keyStart), token);
}

interface HostHead {
  /** Cartesian product of the :host-context guards — each entry is the ancestor
   *  chain (one member per guard) that must enclose the host. Empty `[[]]` when
   *  there are no host-context guards. */
  ancestorCombos: string[][];
  /** The host element's own scoped compound(s) — e.g. `[token].a`, `[token].b`
   *  for `:host(.a, .b)`, or just `[token]` for a bare/implicit host. */
  hostCompounds: string[];
  /** The descendant part following the host pseudos (leading combinator kept). */
  suffix: string;
}

/** Parse the leading :host-context()/:host()/:host pseudos of `sel`. Returns
 *  null when `sel` has no host pseudo at its head (caller then scopes normally). */
function parseHostHead(sel: string, token: string): HostHead | null {
  let i = 0;
  const n = sel.length;
  let consumedAny = false;
  const guards: string[][] = [];
  const hostInners: string[][] = [];

  while (i < n) {
    // allow whitespace BETWEEN consecutive host pseudos, but remember where it
    // started so a trailing-descendant gap is preserved in the suffix.
    let p = i;
    while (p < n && /\s/.test(sel[p])) p++;

    if (sel.startsWith(":host-context(", p)) {
      const close = matchParen(sel, p + ":host-context".length);
      if (close < 0) break;
      const inner = sel.slice(p + ":host-context(".length, close);
      guards.push(splitTop(inner, ",").map((m) => m.trim()).filter((m) => m.length));
      i = close + 1;
      consumedAny = true;
      continue;
    }
    if (sel.startsWith(":host(", p)) {
      const close = matchParen(sel, p + ":host".length);
      if (close < 0) break;
      const inner = sel.slice(p + ":host(".length, close);
      hostInners.push(splitTop(inner, ",").map((m) => m.trim()).filter((m) => m.length));
      i = close + 1;
      consumedAny = true;
      continue;
    }
    // bare :host (a word boundary, not the start of :host( or :host-context()
    if (sel.startsWith(":host", p) && !/[\w-]/.test(sel[p + 5] ?? "")) {
      i = p + 5;
      consumedAny = true;
      continue;
    }
    break;
  }

  if (!consumedAny) return null;

  // host compound(s): distribute commas inside :host(...). With multiple
  // :host(...) groups, take the cartesian product and concatenate members.
  let hostCompounds: string[];
  if (hostInners.length) {
    hostCompounds = cartesian(hostInners).map((combo) => token + combo.join(""));
  } else {
    // bare :host, or only :host-context (implicit host) → just the marker.
    hostCompounds = [token];
  }

  // ancestor chains: cartesian product across guards keeps each output selector
  // a single concrete chain (one alternative per guard, in document order).
  const ancestorCombos = guards.length ? cartesian(guards) : [[]];

  return { ancestorCombos, hostCompounds, suffix: sel.slice(i) };
}

/** Index of the `)` that closes the `(` at `sel[open]` (string/escape-aware). */
function matchParen(sel: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sel.length; i++) {
    const c = sel[i];
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { i = skipString(sel, i) - 1; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Cartesian product of a list of member-lists, preserving order. */
function cartesian(lists: string[][]): string[][] {
  let combos: string[][] = [[]];
  for (const list of lists) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const member of list) next.push([...combo, member]);
    }
    combos = next;
  }
  return combos;
}

function insertToken(compound: string, token: string): string {
  if (!compound) return token;
  // :global(x) escape hatch → unscoped
  if (compound.includes(":global(")) return compound.replace(/:global\(([^)]*)\)/g, "$1");
  // already scoped (came from :host / :host-context): the token may sit at the
  // head (`[token].active`), the tail, or be the whole compound — never re-add it.
  if (compound === token || compound.startsWith(token) || compound.endsWith(token)) return compound;
  // insert the attribute before the first REAL pseudo (so `.a:hover` →
  // `.a[token]:hover`). Skip backslash-escaped colons (`.foo\:bar` is a class
  // literally named `foo:bar`, not a pseudo) and quoted strings.
  const idx = firstPseudo(compound);
  return idx >= 0
    ? compound.slice(0, idx) + token + compound.slice(idx)
    : compound + token;
}

/** Index of the first real pseudo-class/element introducer (`:`/`::`) in a key
 *  compound, ignoring backslash-escaped colons and colons inside strings. -1 if
 *  none. */
function firstPseudo(compound: string): number {
  let db = 0;
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i];
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { i = skipString(compound, i) - 1; continue; }
    if (c === "[") { db++; continue; }
    if (c === "]") { db--; continue; }
    // a ":" inside an attribute selector ([xlink:href]) is a namespaced attr
    // name, NOT a pseudo introducer — only the bracket-depth-0 colon counts.
    if (c === ":" && db === 0) return i;
  }
  return -1;
}

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let dp = 0, db = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { i = skipString(s, i) - 1; continue; }
    if (c === "(") dp++;
    else if (c === ")") dp--;
    else if (c === "[") db++;
    else if (c === "]") db--;
    else if (c === sep && dp === 0 && db === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}
