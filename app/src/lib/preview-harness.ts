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
import { defineComponent, isSignal } from "@mrg-keystone/sprig";
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
  /** the discovered entry kind ("island" | "component" | "page") — how the ready gate
   *  knows whether to wait for a target island's scope or declare the static SSR final. */
  kind?: string;
  background?: string;
  controlDefs: Record<string, ControlDef>;
  subControlDefs?: Record<string, Record<string, ControlDef>>;
  /** CSS selector per sub group that targets a specific rendered element (e.g. "#submit")
   *  → the control reads/writes that DOM node directly. */
  subTargets?: Record<string, string>;
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
  // value-carrying FORM FIELDS only. A <button> also has .value/.type (so a duck-typed
  // check hijacks it into a useless `value=""`); its meaningful detail is its label, so
  // it falls through to textContent with everything else.
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" ? `checked=${el.checked}` : `value="${el.value}"`;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return `value="${el.value}"`;
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
      const payload = { time: new Date().toLocaleTimeString(), source: describe(el), type: e.type, detail: detailOf(e, el) };
      up({ type: "event", payload });
      // Direct `playwright test` navigation (no shell iframe): the isolate-events capture()
      // binding — when a spec installed it — is the event stream's only consumer, so feed it
      // here. Inside the shell the postMessage above reaches the shell, which forwards to
      // the binding itself (one producer per context, never both).
      if (parent === window) {
        (globalThis as { __isolateEmit?: (e: unknown) => void }).__isolateEmit?.(payload);
      }
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

/** Read a targeted instance's current value, preferring the LIVE DOM property (.value,
 *  .checked, .disabled) over the attribute so non-reflected state (an input's value, a
 *  checkbox's checked) is read correctly; falls back to the attribute, then the default. */
export function readDomControl(el: Element, key: string, def: ControlDef): unknown {
  const e = el as unknown as Record<string, unknown>;
  const hasProp = key in el && typeof e[key] !== "function";
  if (def.type === "boolean") return hasProp ? !!e[key] : el.hasAttribute(key);
  const raw = hasProp ? e[key] : el.getAttribute(key);
  if (raw == null) return controlDefault(def);
  if (def.type === "number" || def.type === "range") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : controlDefault(def);
  }
  return raw;
}

/** Apply a targeted control edit to a DOM element, preferring the LIVE property so the
 *  change shows immediately (.value on an input, .checked on a checkbox, .disabled on a
 *  button); a custom key with no matching property falls back to set/removeAttribute. */
export function writeDomControl(el: Element, key: string, value: unknown): void {
  const e = el as unknown as Record<string, unknown>;
  if (key in el && typeof e[key] !== "function") {
    try {
      e[key] = value; // live property
      return;
    } catch { /* read-only / getter-only property → best-effort attribute fallback below */ }
  }
  if (value === true) el.setAttribute(key, "");
  else if (value === false || value == null) el.removeAttribute(key);
  else el.setAttribute(key, String(value));
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
        // a targeted instance (e.g. "#submit") reads its control values straight off the
        // DOM node; an untargeted group reads them from the case's force-props mock.
        const target = meta.subTargets?.[sel];
        const el = (target && isClient) ? document.querySelector(target) : null;
        const mock = cas.mocks?.[sel];
        const forced = (typeof mock === "object" && mock.props) ? mock.props : {};
        return {
          key: sel,
          name: sel,
          controls: Object.entries(defs).map(([key, def]): ControlView => ({
            scope: "sub",
            key,
            instKey: target ?? sel,
            def,
            value: el ? readDomControl(el, key, def) : (key in forced ? forced[key] : controlDefault(def)),
          })),
        };
      });
      return { name: meta.name, background: meta.background, html: hasHtml ? html : null, controls, instances };
    };

    const up = (msg: Record<string, unknown>) => {
      if (isClient && parent !== window) parent.postMessage({ source: "isolate-stage", ...msg }, "*");
    };
    // stageReady = the isolate-events waitHydrated() contract: the stage is interactive —
    // an island target's scope is captured and the case's _signals applied, or the target
    // is static (the SSR markup IS the final markup). Stamped on THIS frame's globalThis
    // (direct playwright navigation polls it) and carried on every "ready" message (the
    // shell stamps its own frame from it — waitForFunction only sees the main frame).
    let stageReady = false;
    const markReady = () => {
      stageReady = true;
      (globalThis as { __isolateReady?: boolean }).__isolateReady = true;
    };
    const publish = () => up({ type: "ready", hydrated: stageReady, ...surface() });

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
        // a specific rendered element (e.g. "#submit") → set it directly, live, no reload;
        // an unmatched selector is a component instance → mock + server re-render.
        const el = typeof document !== "undefined" ? document.querySelector(d.instKey) : null;
        if (el) {
          writeDomControl(el, d.key, d.value);
          publish();
        } else {
          reloadWith(`_m.${d.instKey}.${d.key}`, d.value);
        }
      }
    };

    if (isClient) {
      active = { publish, applySet }; // this case is now the active bridge
      bindOnce();
      // reset the ready flag for THIS case (soft-nav re-hydrates a new bridge in the same
      // document — the previous case's true must not leak into the new case's wait).
      (globalThis as { __isolateReady?: boolean }).__isolateReady = false;
      // static target: no island scope to wait for — the server-rendered markup is final.
      // (kind fallback: a missing kind — an older manifest — infers from the island host.)
      const islandTarget = meta.kind ? meta.kind === "island" : !!document.querySelector(`sprig-island[data-sel="${meta.selector}"]`);
      if (!islandTarget) markReady();
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
          markReady(); // scope captured + case signals applied → the island is interactive
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
