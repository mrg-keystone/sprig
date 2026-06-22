// Shared resolver for generated preview pages. The base case (props/signals/
// innerHtml) is baked at generation time; control edits to a STATIC component's
// props arrive as URL query overrides (the bridge reloads the iframe with them),
// so the page re-renders the target with the edited value. Island signals are
// edited live and never reach here.
import type { ResolveCtx } from "@sprig/core";

interface Meta {
  name: string;
  selector: string;
  background?: string;
  controlDefs: Record<string, unknown>;
}
interface CaseData {
  props: Record<string, unknown>;
  signals: Record<string, unknown>;
  innerHtml?: string | null;
  mocks?: Record<string, unknown>;
}

/** Coerce a query string back to a primitive (true/false/number/string). */
function coerce(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function previewResolve(meta: Meta, base: CaseData, ctx: ResolveCtx) {
  const props = { ...base.props };
  let innerHtml = base.innerHtml ?? null;
  const q = ctx?.url?.searchParams;
  if (q) {
    for (const [k, v] of q) {
      if (k === "_html") innerHtml = v;
      else props[k] = coerce(v);
    }
  }
  // __mocks (child-component overrides) are read by the renderer (renderDocument →
  // renderComponent) and threaded to the client so the island re-render applies them.
  return { meta, caseData: { props, signals: base.signals, innerHtml }, __mocks: base.mocks ?? {} };
}
