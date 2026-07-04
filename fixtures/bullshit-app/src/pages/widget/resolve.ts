// Widget detail resolver. Looks up a widget by the :id route param.
//
// BUG (planted, catalog F1 — soft 404): on a missing widget this returns a
// `notFound` view but NEVER calls setResponseStatus(injector, 404), so the
// matched route renders at the default HTTP 200. A missing page reads as real
// to crawlers and the browser. The fix would import { setResponseStatus } and
// set 404 on the miss.
import { currentInjector, setResponseStatus, type Resolve } from "@mrg-keystone/sprig";

const WIDGETS: Record<string, { name: string; blurb: string }> = {
  a: { name: "Sprocket", blurb: "A fine widget." },
  b: { name: "Flange", blurb: "An even finer widget." },
  c: { name: "Grommet", blurb: "The finest widget." },
};

export const resolve: Resolve = ({ params }) => {
  const id = String(params.id ?? "");
  const widget = WIDGETS[id] ?? null;
  // On a miss, set 404 synchronously on the active route injector so
  // bootstrap.fetch emits HTTP 404 instead of the default 200.
  if (widget === null) setResponseStatus(currentInjector(), 404);
  return { id, widget, notFound: widget === null };
};
