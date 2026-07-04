// Shared resolver for generated preview pages. The base case (props/signals/
// innerHtml) is baked at generation time; control edits to a STATIC component's
// props arrive as URL query overrides (the bridge reloads the iframe with them),
// so the page re-renders the target with the edited value. Island signals are
// edited live and never reach here.
import type { ResolveCtx } from "@mrg-keystone/sprig";

interface Meta {
  name: string;
  selector: string;
  background?: string;
  controlDefs: Record<string, unknown>;
}
type Mock = "stub" | { stub?: boolean; props?: Record<string, unknown> };
interface CaseData {
  props: Record<string, unknown>;
  signals: Record<string, unknown>;
  innerHtml?: string | null;
  mocks?: Record<string, Mock>;
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
  // child-component overrides: the base case's mocks, plus any live edits arriving as
  // `_m.<selector>.<key>=value` query params (the bridge reloads with them).
  const mocks: Record<string, Mock> = structuredClone(base.mocks ?? {});
  if (q) {
    for (const [k, v] of q) {
      const m = k.match(/^_m\.([^.]+)\.(.+)$/);
      if (!m) continue;
      const [, sel, key] = m;
      const cur = mocks[sel];
      const entry = (cur && typeof cur === "object") ? cur : (mocks[sel] = {});
      (entry.props ??= {})[key] = coerce(v);
    }
  }
  // __mocks is read by the renderer (renderDocument → renderComponent) and threaded to
  // the client so the island re-render applies them; caseData.mocks feeds the panel.
  return { meta, caseData: { props, signals: base.signals, innerHtml, mocks }, __mocks: mocks };
}
