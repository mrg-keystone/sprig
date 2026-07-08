// Widget detail resolver. Looks up a widget by the :id route param.
import { type Resolve } from "@mrg-keystone/sprig";

const WIDGETS: Record<string, { name: string; blurb: string }> = {
  a: { name: "Sprocket", blurb: "A fine widget." },
  b: { name: "Flange", blurb: "An even finer widget." },
  c: { name: "Grommet", blurb: "The finest widget." },
};

export const resolve: Resolve = ({ params }) => {
  const id = String(params.id ?? "");
  const widget = WIDGETS[id] ?? null;
  return { id, widget, notFound: widget === null };
};
