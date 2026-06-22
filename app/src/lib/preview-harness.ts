// preview-harness — the sprig-native replacement for the Preact controls.tsx.
//
// A LOGIC-ONLY bridge island (renders nothing). The per-case preview page renders
// the target component DIRECTLY as a sibling (an island can't host a child component
// on the client). This bridge:
//   • captures the target island's reactive scope off its DOM node (el.__sprigScope),
//     applies the case's _signals, and exposes its signals (isSignal) as live controls;
//   • shows the declared prop / innerHtml / child-component controls;
//   • captures stage DOM events (skipping disabled elements) for the console;
//   • speaks the shell's postMessage bridge (ready/event up; set/request down).
//
// The stage's DOM-event + message listeners are bound ONCE per iframe document and
// read the *current* case via a module-level handle — the preview app uses soft-nav,
// so switching cases re-hydrates a new bridge in the SAME document; without this the
// listeners would accumulate and each event would be logged N times.
import { defineComponent, isSignal } from "@sprig/core";
import type { ControlView, Surface } from "./types.ts";

interface ControlDef {
  type?: string;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  signal?: boolean;
  value?: unknown;
}
interface Meta {
  name: string;
  selector: string;
  background?: string;
  controlDefs: Record<string, ControlDef>;
  subControlDefs?: Record<string, Record<string, ControlDef>>;
}
interface CaseData {
  props: Record<string, unknown>;
  signals: Record<string, unknown>;
  innerHtml?: string | null;
  mocks?: Record<string, { props?: Record<string, unknown> } | string>;
}

/** The currently-mounted bridge for this document — updated on every (soft-nav) case. */
interface ActiveBridge {
  publish: () => void;
  applySet: (d: { scope: string; key: string; value: unknown; instKey?: string }) => void;
}

const STAGE_EVENTS = [
  "click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup",
  "pointerdown", "pointerup", "keydown", "keyup", "input", "change", "submit",
  "reset", "focusin", "focusout",
];
const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]";

const isClient = typeof document !== "undefined";
let active: ActiveBridge | null = null;
let bound = false;

function describe(el: Element): string {
  return el.id ? `${el.tagName.toLowerCase()}#${el.id}` : el.tagName.toLowerCase();
}
function detailOf(e: Event, el: Element): string {
  if (e instanceof KeyboardEvent) return `key=${e.key}`;
  const i = el as HTMLInputElement;
  if (i && typeof i.value === "string" && "type" in i) {
    return i.type === "checkbox" ? `checked=${i.checked}` : `value="${i.value}"`;
  }
  return (el.textContent || "").trim().slice(0, 40);
}

/** Bind the stage's DOM-event + message listeners ONCE per document; they delegate
 *  to whichever bridge is currently active. */
function bindOnce(): void {
  if (bound || !isClient) return;
  bound = true;
  const up = (msg: Record<string, unknown>) => {
    if (parent !== window) parent.postMessage({ source: "isolate-stage", ...msg }, "*");
  };
  for (const t of STAGE_EVENTS) {
    addEventListener(t, (e: Event) => {
      const el = (e.target as Element)?.closest?.(INTERACTIVE);
      // a disabled / aria-disabled control is inert — don't log its events
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      up({
        type: "event",
        payload: { time: new Date().toLocaleTimeString(), source: describe(el), type: e.type, detail: detailOf(e, el) },
      });
    }, { capture: true });
  }
  addEventListener("message", (e: MessageEvent) => {
    const d = e.data;
    if (!d || d.target !== "isolate-stage") return;
    if (d.type === "set") active?.applySet(d);
    else if (d.type === "request") active?.publish();
  });
}

function controlDefault(def: ControlDef): unknown {
  if (def.value !== undefined) return def.value;
  if (def.type === "boolean") return false;
  if (def.type === "number" || def.type === "range") return def.min ?? 0;
  if (def.type === "select") return def.options?.[0] ?? "";
  if (def.type === "color") return "#000000";
  return "";
}

export default defineComponent({
  inputs: ["meta", "caseData"],
  setup: (ctx) => {
    const meta = ctx.input<Meta>("meta", { name: "", selector: "", controlDefs: {} })();
    const cas = ctx.input<CaseData>("caseData", { props: {}, signals: {}, innerHtml: null })();

    const props: Record<string, unknown> = { ...cas.props };
    const hasHtml = typeof cas.innerHtml === "string";
    let html: string = hasHtml ? (cas.innerHtml as string) : "";
    let target: Record<string, unknown> | null = null;

    const surface = (): Surface => {
      const controls: ControlView[] = [];
      for (const [key, def] of Object.entries(meta.controlDefs)) {
        if (def.signal) {
          const live = target && isSignal(target[key]) ? (target[key] as () => unknown)() : cas.signals[key];
          controls.push({ scope: "signal", key, def, value: live });
        } else {
          controls.push({ scope: "prop", key, def, value: props[key] });
        }
      }
      const instances = Object.entries(meta.subControlDefs ?? {}).map(([sel, defs]) => {
        const mock = cas.mocks?.[sel];
        const forced = (typeof mock === "object" && mock.props) ? mock.props : {};
        return {
          key: sel,
          name: sel,
          controls: Object.entries(defs).map(([key, def]): ControlView => ({
            scope: "sub",
            key,
            instKey: sel,
            def,
            value: key in forced ? forced[key] : controlDefault(def),
          })),
        };
      });
      return { name: meta.name, background: meta.background, html: hasHtml ? html : null, controls, instances };
    };

    const up = (msg: Record<string, unknown>) => {
      if (isClient && parent !== window) parent.postMessage({ source: "isolate-stage", ...msg }, "*");
    };
    const publish = () => up({ type: "ready", ...surface() });

    // edit a static prop / innerHtml / child-component prop by reloading the preview
    // with the value as a query override (the resolver merges it, the server re-renders).
    const reloadWith = (key: string, value: unknown) => {
      const u = new URL(location.href);
      u.searchParams.set(key, String(value));
      location.replace(u.href);
    };
    const applySet = (d: { scope: string; key: string; value: unknown; instKey?: string }) => {
      if (d.scope === "signal" && target && isSignal(target[d.key])) {
        (target[d.key] as { set: (v: unknown) => void }).set(d.value); // live (island signal)
        publish();
      } else if (d.scope === "prop") {
        props[d.key] = d.value;
        reloadWith(d.key, d.value);
      } else if (d.scope === "html") {
        html = String(d.value);
        reloadWith("_html", d.value);
      } else if (d.scope === "sub" && d.instKey) {
        reloadWith(`_m.${d.instKey}.${d.key}`, d.value);
      }
    };

    if (isClient) {
      active = { publish, applySet }; // this case is now the active bridge
      bindOnce();
      // grab the target island's scope off its DOM node (robust to chunk boundaries),
      // apply the case's initial _signals, then publish. Retry for hydration order.
      const tryAttach = (tries = 0) => {
        if (target) return;
        const el = document.querySelector(`sprig-island[data-sel="${meta.selector}"]`);
        const sc = el && (el as unknown as { __sprigScope?: Record<string, unknown> }).__sprigScope;
        if (sc) {
          target = sc;
          for (const [k, v] of Object.entries(cas.signals)) {
            if (isSignal(target[k])) (target[k] as { set: (x: unknown) => void }).set(v);
          }
          publish();
        } else if (tries < 60) {
          setTimeout(() => tryAttach(tries + 1), 40);
        }
      };
      tryAttach();
      queueMicrotask(publish);
    }

    return {}; // a logic-only bridge — renders nothing
  },
});
