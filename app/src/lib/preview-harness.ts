// preview-harness — the sprig-native replacement for the Preact controls.tsx.
//
// It is a LOGIC-ONLY bridge island (it renders nothing). The per-case preview page
// renders the target component DIRECTLY as a sibling (an island can't host a child
// component on the client), and this bridge:
//   • captures the target island's reactive scope via onIslandMounted (matched by
//     selector), applies the case's initial _signals, and exposes its signals
//     (isSignal) as editable controls — pure introspection, no Preact vnode hook;
//   • shows the declared prop/innerHtml controls from the case;
//   • captures stage DOM events for the console;
//   • speaks the shell's postMessage bridge (ready/event up; set/request down).
// Generated `shared-components/stage-bridge/logic.ts` re-exports this default.
import { defineComponent, isSignal } from "@sprig/core";
import { onIslandMounted } from "../../../framework/.sprig/compiler/hydrate.ts";
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
}
interface CaseData {
  props: Record<string, unknown>;
  signals: Record<string, unknown>;
  innerHtml?: string | null;
}

const STAGE_EVENTS = [
  "click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup",
  "pointerdown", "pointerup", "keydown", "keyup", "input", "change", "submit",
  "reset", "focusin", "focusout",
];
const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]";

export default defineComponent({
  inputs: ["meta", "case"],
  setup: (ctx) => {
    const meta = ctx.input<Meta>("meta", { name: "", selector: "", controlDefs: {} })();
    const cas = ctx.input<CaseData>("case", { props: {}, signals: {}, innerHtml: null })();

    // mutable display state for the control surface (static-target props/innerHtml)
    const props: Record<string, unknown> = { ...cas.props };
    const hasHtml = typeof cas.innerHtml === "string";
    let html: string = hasHtml ? (cas.innerHtml as string) : "";
    let target: Record<string, unknown> | null = null; // the target island's scope
    const isClient = typeof document !== "undefined";

    const surface = (): Surface => {
      const controls: ControlView[] = [];
      for (const [key, def] of Object.entries(meta.controlDefs)) {
        if (def.signal) {
          const live = target && isSignal(target[key])
            ? (target[key] as () => unknown)()
            : cas.signals[key];
          controls.push({ scope: "signal", key, def, value: live });
        } else {
          controls.push({ scope: "prop", key, def, value: props[key] });
        }
      }
      return {
        name: meta.name,
        background: meta.background,
        html: hasHtml ? html : null,
        controls,
        instances: [],
      };
    };

    const up = (msg: Record<string, unknown>) => {
      if (isClient && parent !== window) parent.postMessage({ source: "isolate-stage", ...msg }, "*");
    };
    const ready = () => up({ type: "ready", ...surface() });

    const applySet = (d: { scope: string; key: string; value: unknown }) => {
      if (d.scope === "signal" && target && isSignal(target[d.key])) {
        (target[d.key] as { set: (v: unknown) => void }).set(d.value); // live
      } else if (d.scope === "prop") {
        props[d.key] = d.value; // reflected in the panel (static targets re-render on reload)
      } else if (d.scope === "html") {
        html = String(d.value);
      }
      ready();
    };

    if (isClient) {
      // grab the target island's scope (replayed if it mounted first), apply the
      // case's initial signal values, then publish the surface.
      onIslandMounted((m) => {
        if (m.sel !== meta.selector || target) return;
        target = m.scope;
        for (const [k, v] of Object.entries(cas.signals)) {
          if (isSignal(target[k])) (target[k] as { set: (x: unknown) => void }).set(v);
        }
        ready();
      });

      const describe = (el: Element) =>
        el.id ? `${el.tagName.toLowerCase()}#${el.id}` : el.tagName.toLowerCase();
      const detail = (e: Event, el: Element): string => {
        if (e instanceof KeyboardEvent) return `key=${e.key}`;
        const i = el as HTMLInputElement;
        if (i && typeof i.value === "string" && "type" in i) {
          return i.type === "checkbox" ? `checked=${i.checked}` : `value="${i.value}"`;
        }
        return (el.textContent || "").trim().slice(0, 40);
      };
      for (const t of STAGE_EVENTS) {
        addEventListener(t, (e: Event) => {
          const el = (e.target as Element)?.closest?.(INTERACTIVE);
          if (!el) return;
          up({
            type: "event",
            payload: {
              time: new Date().toLocaleTimeString(),
              source: describe(el),
              type: e.type,
              detail: detail(e, el),
            },
          });
        }, { capture: true });
      }

      addEventListener("message", (e: MessageEvent) => {
        const d = e.data;
        if (!d || d.target !== "isolate-stage") return;
        if (d.type === "set") applySet(d);
        else if (d.type === "request") ready();
      });

      queueMicrotask(ready); // publish once the target has had a chance to mount
    }

    return {}; // a logic-only bridge — renders nothing
  },
});
