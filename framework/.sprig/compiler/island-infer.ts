// ─────────────────────────── island inference + build report ───────────────────────────
// ⚠️ PROTOTYPE — NOT WIRED INTO THE BUILD. The shipping framework declares island-ness by
// FILE PRESENCE (a folder with a `logic.ts` is an island), exactly as the docs state. The
// syntactic inference below is an unadopted alternative model; `classify`/`formatReport` are
// referenced only by island-infer.test.ts. Do not read the description below as the
// framework's actual behavior. Adopting this model (build would then ship less JS — e.g. an
// onServerInit-only page becomes static) OR deleting this prototype is an OPEN decision; it
// changes the documented contract, so it must be made deliberately, not inferred from here.
//
// Phase 3 (proposed): decide static vs island, syntactically, with no data-flow guessing.
//
// A component ships + runs JS (is an island) iff it has BROWSER BEHAVIOUR:
//   • its template binds an (event) or [(two-way)],  OR
//   • its class defines onBrowserInit / onBrowserDestroy.
// Otherwise it's static — final HTML, zero JS — EVEN with onServerInit, signals, or
// one-way bindings/interpolation, all of which resolve at render time.
//
// In this proposed model island-ness would be INFERRED rather than declared by file presence,
// so the build would REPORT it per component (formatReport) to keep the decision visible.
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
