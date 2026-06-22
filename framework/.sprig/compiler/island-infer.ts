// ─────────────────────────── island inference + build report ───────────────────────────
// Phase 3: decide static vs island, syntactically, with no data-flow guessing.
//
// A component ships + runs JS (is an island) iff it has BROWSER BEHAVIOUR:
//   • its template binds an (event) or [(two-way)],  OR
//   • its class defines onBrowserInit / onBrowserDestroy.
// Otherwise it's static — final HTML, zero JS — EVEN with onServerInit, signals, or
// one-way bindings/interpolation, all of which resolve at render time.
//
// Because island-ness is now inferred rather than declared by file presence, the build
// must REPORT it per component (formatReport) so the decision is never silent.
import { named, type Node } from "./node.ts";

const BROWSER_HOOKS = ["onBrowserInit", "onBrowserDestroy"];

/** Any (event) or [(two-way)] binding anywhere in the template means client wiring. */
function templateHasClientBinding(root: Node): boolean {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "event_binding" || n.type === "two_way_binding") return true;
    for (const c of named(n)) stack.push(c);
  }
  return false;
}

function classHasBrowserHook(cls: unknown): boolean {
  const proto = typeof cls === "function" ? (cls as { prototype?: Record<string, unknown> }).prototype : undefined;
  return !!proto && BROWSER_HOOKS.some((h) => typeof proto[h] === "function");
}

export interface Classification {
  kind: "static" | "island";
  reasons: string[];
}

export function classify(opts: { template?: Node | null; componentClass?: unknown }): Classification {
  const reasons: string[] = [];
  if (opts.template && templateHasClientBinding(opts.template)) reasons.push("template binds an (event)/[(two-way)]");
  if (classHasBrowserHook(opts.componentClass)) reasons.push("class defines onBrowserInit/onBrowserDestroy");
  return { kind: reasons.length ? "island" : "static", reasons };
}

export interface ComponentReport {
  name: string;
  kind: "static" | "island";
  reasons: string[];
  /** island chunk size in bytes (static components are 0) */
  bytes?: number;
}

/** A legible per-component report — static components show 0kb, islands show why they
 *  ship JS and how much. Printed by the build so inferred island-ness stays visible. */
export function formatReport(rows: ComponentReport[]): string {
  const w = Math.max(9, ...rows.map((r) => r.name.length));
  return rows
    .map((r) => {
      const size = r.kind === "island" ? `${((r.bytes ?? 0) / 1024).toFixed(1)}kb` : "0kb";
      const why = r.kind === "island" && r.reasons.length ? `  ← ${r.reasons.join("; ")}` : "";
      return `  ${r.name.padEnd(w)}  ${r.kind.padEnd(6)}  ${size.padStart(6)}${why}`;
    })
    .join("\n");
}
