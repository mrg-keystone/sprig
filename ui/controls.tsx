// deno-lint-ignore-file no-explicit-any -- this island hooks the Preact
// `options.vnode` pipeline, walks/clones untyped vnodes, handles raw DOM events,
// and accepts arbitrary control JSON — all inherently `any`.
import { batch, signal, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { options } from "preact";
import { filter, fromEvent, map, merge, Subject } from "rxjs";

// A LOUD stand-in for a component that can't render (missing file, unresolved
// export). The preview must never show a blank stage or a dead route — the card
// names the file, what was expected, and what the module actually exports.
export function IsoError(
  props: {
    title: string;
    file?: string;
    expected?: string;
    seen?: string[];
    hint?: string;
  },
) {
  return (
    <div class="iso-error">
      <h2 class="iso-error__title">⚠ {props.title}</h2>
      {props.file
        ? (
          <p class="iso-error__row">
            <span class="iso-error__key">file</span>
            <code>{props.file}</code>
          </p>
        )
        : null}
      {props.expected
        ? (
          <p class="iso-error__row">
            <span class="iso-error__key">expected</span>
            <code>{props.expected}</code>
          </p>
        )
        : null}
      {props.seen
        ? (
          <p class="iso-error__row">
            <span class="iso-error__key">exports seen</span>
            <code>{props.seen.length ? props.seen.join(", ") : "none"}</code>
          </p>
        )
        : null}
      <p class="iso-error__hint">
        {props.hint ||
          "Fix the export (or the file name) and reload — `isolate list` shows every config problem."}
      </p>
    </div>
  );
}

// --- sub-component mock + control layer ---------------------------------------
// Every preview route is a PAGE: a top-level component and the sub-components it
// renders. We reach those sub-components via Preact's vnode hook (no rebuilds):
//   MOCKS[name]  — from _mocks: "stub" (placeholder) or { props } (forced props),
//                  applied to every instance of that component name.
//   SUB[key]     — LIVE prop overrides for ONE instance. Each instance of a
//                  DECLARED component gets its own controls group; the instance
//                  key is "Name#<id>" when it has an id prop, else just "Name"
//                  (so id-less instances of a type share a group).
// Instances are discovered by recording each declared component the hook sees.
let MOCKS: Record<string, any> = {};
let SUB: Record<string, any> = {};
let DECLARED: Record<string, any> = {};
const SEEN: { name: string; id: string | null; key: string }[] = [];
const STUBS = new Map<string, any>();
function stubFor(name: string) {
  if (!STUBS.has(name)) {
    STUBS.set(
      name,
      () => (
        <span class="iso-stub" title={"mocked <" + name + ">"}>{name}</span>
      ),
    );
  }
  return STUBS.get(name);
}
const prevVnode = (options as any).vnode;
(options as any).vnode = (vnode: any) => {
  const t = vnode.type;
  if (typeof t === "function") {
    const name = t.displayName || t.name;
    if (name) {
      const m = MOCKS[name];
      let stubbed = false;
      if (m) {
        if (m === "stub" || m === true || m.stub) {
          vnode.type = stubFor(name);
          stubbed = true;
        } else if (m.props) vnode.props = { ...vnode.props, ...m.props };
      }
      // Track + inject per-INSTANCE controls for declared components.
      if (DECLARED[name] && !stubbed) {
        const id = vnode.props && vnode.props.id;
        const key = id != null ? name + "#" + id : name;
        if (!SEEN.some((s) => s.key === key)) {
          SEEN.push({ name, id: id != null ? String(id) : null, key });
        }
        const ov = SUB[key];
        if (ov) vnode.props = { ...vnode.props, ...ov };
      }
    }
  }
  if (prevVnode) prevVnode(vnode);
};
function setMocks(m: any) {
  MOCKS = m || {};
}
function setSub(s: any) {
  SUB = s || {};
}
function setDeclared(d: any) {
  DECLARED = d || {};
}

// --- event log ----------------------------------------------------------------
// Captured by delegation on the STAGE container (capture phase): it sees EVERY
// event from every element under test — never the controls panel — and records
// what each one carried (an input's value, the pressed key, a clicked label).
// High-frequency move/scroll/wheel events are left out so the log stays useful;
// the filter narrows the rest.
const STAGE_EVENTS = [
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "keydown",
  "keyup",
  "input",
  "change",
  "submit",
  "reset",
  "focusin",
  "focusout",
];
const EVENTS = signal<
  { id: number; time: string; source: string; type: string; detail: string }[]
>([]);
// Event-type names in first-seen order. Append-only and stable: a new type never
// reorders the existing checkboxes, so logging an event (e.g. a focusout fired by
// clicking a log control) can't shift a checkbox out from under an in-flight click.
const TYPES_SEEN = signal<string[]>([]);
const REGEXES = signal<string[]>([]); // active regex filters (AND), each applied to "source name detail"
const DRAFT = signal(""); // in-progress regex being typed
const HIDDEN = signal<Record<string, boolean>>({}); // event-type name -> hidden
let EVENT_SEQ = 0;
function pushEvent(
  evt: { time: string; source: string; type: string; detail: string },
) {
  EVENT_SEQ += 1;
  EVENTS.value = [{ id: EVENT_SEQ, ...evt }, ...EVENTS.value].slice(0, 300);
  if (!TYPES_SEEN.value.includes(evt.type)) {
    TYPES_SEEN.value = [...TYPES_SEEN.value, evt.type];
  }
}
function describeEl(el: any): string {
  if (!el || !el.tagName) return "?";
  const tag = el.tagName.toLowerCase();
  return el.id ? tag + "#" + el.id : tag;
}
/** What the event carried: an input/checkbox value, the pressed key, or a label. */
function eventDetail(e: any, el: any): string {
  const ty = e.type;
  if (ty === "input" || ty === "change") {
    if (el && (el.type === "checkbox" || el.type === "radio")) {
      return "checked=" + el.checked;
    }
    return el && "value" in el ? JSON.stringify(el.value) : "";
  }
  if (ty === "keydown" || ty === "keyup") return e.key ? "key=" + e.key : "";
  const label = ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  return label && label.length <= 40 ? JSON.stringify(label) : "";
}
// Only events on actual interactive controls are logged — never inert markup
// like the page wrapper div or a heading.
const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role], [tabindex], [contenteditable]";
/** Map a raw DOM event to an IsolateEvent, or null if it isn't on an ENABLED control. */
function toIsolateEvent(e: any) {
  const tgt = e.target;
  const el = tgt && tgt.closest && tgt.closest(INTERACTIVE);
  if (!el) return null; // not a control
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return null; // disabled
  return {
    time: new Date().toLocaleTimeString(),
    source: describeEl(el),
    type: e.type,
    detail: eventDetail(e, el),
  };
}

// The page's event stream: ONE RxJS Observable of IsolateEvents. The UI renders
// from it, and (via the __isolateEmit hook) Playwright tests can observe it too.
const events$ = new Subject<
  { time: string; source: string; type: string; detail: string }
>();
(globalThis as any).__isolate = { events$ };

/** Wire stage DOM events into events$, and events$ into the UI + the test hook. */
function attachStageEvents(root: HTMLElement) {
  const domSub = merge(
    ...STAGE_EVENTS.map((t) => fromEvent(root, t, { capture: true })),
  )
    .pipe(map(toIsolateEvent), filter((x) => x != null))
    .subscribe((evt) => events$.next(evt as any));
  const sink = events$.subscribe((evt) => {
    pushEvent(evt);
    const g = globalThis as any;
    if (typeof g.__isolateEmit === "function") g.__isolateEmit(evt);
  });
  return () => {
    domSub.unsubscribe();
    sink.unsubscribe();
  };
}

function compileRegex(p: string): RegExp | null {
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}
function EventLog() {
  const all = EVENTS.value;
  const hidden = HIDDEN.value;
  const patterns = REGEXES.value;
  const res = patterns.map(compileRegex);

  // Event types seen so far (stable order), each toggleable via a checkbox.
  const types = TYPES_SEEN.value;

  const events = all.filter((e) => {
    if (hidden[e.type]) return false;
    const hay = e.source + " " + e.type + " " + e.detail;
    for (const re of res) if (re && !re.test(hay)) return false; // AND across patterns
    return true;
  });

  const addDraft = () => {
    const p = DRAFT.value.trim();
    if (p && !REGEXES.value.includes(p)) REGEXES.value = [...REGEXES.value, p];
    DRAFT.value = "";
  };
  const removeAt = (i: number) => {
    REGEXES.value = REGEXES.value.filter((_, j) => j !== i);
  };
  // Derive hidden from the checkbox's own checked state (not a stored toggle), so a
  // double-fired change event stays idempotent.
  const setHidden = (ty: string, hide: boolean) => {
    HIDDEN.value = { ...HIDDEN.value, [ty]: hide };
  };

  return (
    <section class="iso-log">
      <header class="iso-log__head">
        <span class="iso-log__title">events</span>
        <span class="iso-log__count">{events.length + "/" + all.length}</span>
        <input
          class="iso-log__filter"
          placeholder="add regex…"
          value={DRAFT.value}
          onInput={(e) => {
            DRAFT.value = (e.currentTarget as HTMLInputElement).value;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button
          type="button"
          class="iso-log__add"
          title="add regex filter"
          onClick={addDraft}
        >
          +
        </button>
        <span class="iso-log__chips">
          {patterns.map((p, i) => (
            <span
              class={"iso-log__chip" + (res[i] ? "" : " iso-log__chip--bad")}
              key={p}
              title={res[i] ? "" : "invalid regex"}
            >
              /{p}/
              <button
                type="button"
                class="iso-log__chip-x"
                title="remove"
                onClick={() => removeAt(i)}
              >
                ×
              </button>
            </span>
          ))}
        </span>
        {all.length
          ? (
            <button
              type="button"
              class="iso-log__clear"
              onClick={() => {
                EVENTS.value = [];
                TYPES_SEEN.value = [];
              }}
            >
              clear
            </button>
          )
          : null}
      </header>
      {types.length
        ? (
          <div class="iso-log__types">
            {types.map((ty) => (
              <label class="iso-log__type" key={ty}>
                <input
                  type="checkbox"
                  checked={!hidden[ty]}
                  onChange={(e) =>
                    setHidden(
                      ty,
                      !(e.currentTarget as HTMLInputElement).checked,
                    )}
                />
                {ty}
              </label>
            ))}
          </div>
        )
        : null}
      <ol class="iso-log__list">
        {events.length === 0
          ? (
            <li class="iso-log__empty">
              {all.length
                ? "nothing matches the filter"
                : "no events yet — interact with the component"}
            </li>
          )
          : null}
        {events.map((e) => (
          <li class="iso-log__row" key={e.id}>
            <span class="iso-log__time">{e.time}</span>
            <span class="iso-log__src">{e.source}</span>
            <span class="iso-log__name">{e.type}</span>
            {e.detail ? <span class="iso-log__detail">{e.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Initial value for a sub-component control the case doesn't set (mirrors discover's controlDefault). */
function widgetDefault(def: any) {
  if (def && def.value !== undefined) return def.value;
  switch (def && def.type) {
    case "boolean":
      return false;
    case "number":
    case "range":
      return (def && def.min != null) ? def.min : 0;
    case "select":
      return def && def.options ? def.options[0] : undefined;
    case "color":
      return "#000000";
    default:
      return "";
  }
}

/** Seed one instance's control values from its _mocks props (by name), else the widget default. */
function seedRow(defs: any, seed: any) {
  const row: Record<string, any> = {};
  const s = seed || {};
  for (const k of Object.keys(defs || {})) {
    row[k] = (k in s) ? s[k] : widgetDefault(defs[k]);
  }
  return row;
}

function widgetType(def: any, value: any) {
  if (def && def.type) return def.type;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

function Widget(
  props: {
    def?: any;
    value: any;
    onChange: (v: any) => void;
    textarea?: boolean;
  },
) {
  const { def, value, onChange } = props;
  const type = props.textarea ? "textarea" : widgetType(def, value);

  if (type === "select") {
    return (
      <select
        class="ctrl-input"
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
      >
        {((def && def.options) || []).map((o: any) => (
          <option key={String(o)} value={String(o)}>{String(o)}</option>
        ))}
      </select>
    );
  }
  if (type === "range") {
    const min = def && def.min != null ? def.min : 0;
    const max = def && def.max != null ? def.max : 100;
    const step = def && def.step != null ? def.step : 1;
    return (
      <span class="ctrl-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={String(value ?? 0)}
          onInput={(e) =>
            onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="ctrl-range__val">{String(value ?? 0)}</span>
      </span>
    );
  }
  if (type === "color") {
    return (
      <input
        type="color"
        value={String(value ?? "#000000")}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) =>
          onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    );
  }
  if (type === "number") {
    return (
      <input
        class="ctrl-input"
        type="number"
        value={String(value ?? 0)}
        onInput={(e) =>
          onChange(Number((e.currentTarget as HTMLInputElement).value))}
      />
    );
  }
  if (type === "textarea") {
    return (
      <textarea
        class="ctrl-input ctrl-textarea"
        value={value == null ? "" : String(value)}
        onInput={(e) =>
          onChange((e.currentTarget as HTMLTextAreaElement).value)}
      />
    );
  }
  return (
    <input
      class="ctrl-input"
      type="text"
      value={value == null ? "" : String(value)}
      onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
    />
  );
}

function Field(props: { label: string; children: any }) {
  return (
    <label class="ctrl-field">
      <span class="ctrl-field__label">{props.label}</span>
      {props.children}
    </label>
  );
}

function SignalField(props: { name: string; def?: any; sig: any }) {
  const v = props.sig.value; // reactive read
  return (
    <Field label={props.name + " · signal"}>
      <Widget
        def={props.def}
        value={v}
        onChange={(nv) => {
          props.sig.value = nv;
        }}
      />
    </Field>
  );
}

export function Controls(
  props: {
    Component: any;
    name?: string;
    config: any;
    defs?: any;
    subDefs?: any;
    background?: string;
  },
) {
  const { Component, config } = props;
  setMocks(config.mocks);
  const defs = props.defs || {};
  const subDefs = props.subDefs || {};
  setDeclared(subDefs); // tell the vnode hook which sub-components to track + inject
  const stageRef = useRef<HTMLDivElement>(null);
  const state = useSignal<Record<string, any>>({ ...(config.props || {}) });
  const html = useSignal<string | null>(config.innerHtml ?? null);
  const sigs = useMemo(() => {
    const m: Record<string, any> = {};
    for (const k of Object.keys(config.signals || {})) {
      m[k] = signal(config.signals[k]);
    }
    return m;
  }, []);
  // Live overrides keyed by instance key, plus the instances the stage actually
  // rendered. Both start empty; we fill them once the stage has mounted (below).
  const subState = useSignal<Record<string, any>>({});
  const instances = useSignal<
    { name: string; id: string | null; key: string }[]
  >([]);
  const stageBump = useSignal(0); // stage remount key — bumped only on a control edit
  setSub(subState.value); // push current overrides before the component's children render

  // After mount the vnode hook has recorded every declared sub-component instance
  // the stage rendered (in SEEN). Surface them as controls groups and seed each
  // instance's controls from its _mocks props / widget defaults.
  useEffect(() => {
    if (!SEEN.length) return;
    const next = { ...subState.peek() };
    for (const inst of SEEN) {
      if (!next[inst.key]) {
        const seed = (config.mocks && config.mocks[inst.name] &&
          config.mocks[inst.name].props) || {};
        next[inst.key] = seedRow(subDefs[inst.name], seed);
      }
    }
    batch(() => {
      instances.value = SEEN.slice();
      subState.value = next;
    });
  }, []);

  // Capture every event the stage fires (scoped to the stage container, so the
  // controls panel's own inputs never leak into the log). Once this effect has
  // run, the stage is mounted AND interactive — flag it so the waitHydrated()
  // test helper can wait for a click to actually do something (clicking before
  // hydration is a silent no-op).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const detach = attachStageEvents(el);
    (globalThis as any).__isolateReady = true;
    return () => {
      (globalThis as any).__isolateReady = false;
      detach();
    };
  }, []);

  const s = state.value;
  const compProps: Record<string, any> = {};
  for (const k of Object.keys(s)) compProps[k] = s[k];
  for (const k of Object.keys(sigs)) compProps[k] = sigs[k];
  if (html.value != null) {
    compProps.dangerouslySetInnerHTML = { __html: html.value };
  }

  // Sub-component overrides are injected by the vnode hook, which only re-applies
  // when the component's children are recreated. @preact/signals skips re-rendering
  // a signal-using component on a parent render with equal props, so we remount the
  // stage (via a key bump) when a sub-control is edited. We bump ONLY on edits —
  // never on the initial seed — so the stage is never torn down mid-interaction.
  const stageKey = String(stageBump.value);

  const set = (k: string, v: any) => {
    state.value = { ...state.value, [k]: v };
  };
  const setInst = (key: string, k: string, v: any) => {
    subState.value = {
      ...subState.value,
      [key]: { ...subState.value[key], [k]: v },
    };
    stageBump.value += 1;
  };

  // --- v0.4 shell bridge -----------------------------------------------------
  // When this preview is iframed by the shell, its panel + log are hidden (CSS,
  // via data-embed) and the parent dock drives controls/console instead. Post the
  // control surface + every stage event UP; apply control edits sent DOWN. The
  // (hidden) in-iframe Controls is still the single source of truth for the stage.
  const isEmbed = typeof window !== "undefined" && globalThis.parent !== window;
  const buildInstances = () =>
    instances.value.map((inst) => ({
      key: inst.key,
      name: inst.name,
      id: inst.id,
      controls: Object.keys(subDefs[inst.name] || {}).map((k) => ({
        scope: "sub",
        instKey: inst.key,
        key: k,
        def: subDefs[inst.name][k],
        value: (subState.value[inst.key] || {})[k],
      })),
    }));
  useEffect(() => {
    if (!isEmbed) return;
    const post = (msg: any) => {
      try {
        globalThis.parent.postMessage({ source: "isolate-stage", ...msg }, "*");
      } catch (_e) { /* ignore */ }
    };
    const surface = () => {
      const controls: any[] = [];
      for (const k of Object.keys(state.value)) {
        controls.push({
          scope: "prop",
          key: k,
          def: defs[k] || null,
          value: state.value[k],
        });
      }
      for (const k of Object.keys(sigs)) {
        controls.push({
          scope: "signal",
          key: k,
          def: defs[k] || null,
          value: sigs[k].value,
        });
      }
      return {
        name: props.name || "component",
        background: props.background || "#ffffff",
        html: html.value,
        controls,
        instances: buildInstances(),
      };
    };
    const onMsg = (e: any) => {
      const d = e.data;
      if (!d || d.target !== "isolate-stage") return;
      if (d.type === "set") {
        if (d.scope === "prop") set(d.key, d.value);
        else if (d.scope === "signal" && sigs[d.key]) {
          sigs[d.key].value = d.value;
        } else if (d.scope === "html") html.value = d.value;
        else if (d.scope === "sub") setInst(d.instKey, d.key, d.value);
      } else if (d.type === "request") post({ type: "ready", ...surface() });
    };
    globalThis.addEventListener("message", onMsg);
    const sub = events$.subscribe((evt) =>
      post({ type: "event", payload: evt })
    );
    post({ type: "ready", ...surface() });
    return () => {
      globalThis.removeEventListener("message", onMsg);
      sub.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!isEmbed) return;
    try {
      globalThis.parent.postMessage({
        source: "isolate-stage",
        type: "instances",
        instances: buildInstances(),
      }, "*");
    } catch (_e) { /* ignore */ }
  }, [instances.value]);

  const propKeys = Object.keys(s);
  const sigKeys = Object.keys(sigs);
  const insts = instances.value;
  const selfEmpty = propKeys.length === 0 && sigKeys.length === 0 &&
    html.value == null;
  const empty = selfEmpty && insts.length === 0;

  return (
    <div class="ctrl">
      <div
        class="ctrl-stage"
        ref={stageRef}
        style={"background:" + (props.background || "#ffffff")}
      >
        <Component key={stageKey} {...compProps} />
      </div>
      <aside class="ctrl-panel">
        <h3 class="ctrl-title">controls</h3>
        {empty ? <p class="ctrl-empty">no editable props</p> : null}
        {!selfEmpty
          ? (
            <fieldset class="ctrl-group">
              <legend class="ctrl-group__legend">
                {props.name || "component"}
              </legend>
              {propKeys.map((k) => (
                <Field key={k} label={k}>
                  <Widget
                    def={defs[k]}
                    value={s[k]}
                    onChange={(v) => set(k, v)}
                  />
                </Field>
              ))}
              {sigKeys.map((k) => (
                <SignalField key={k} name={k} def={defs[k]} sig={sigs[k]} />
              ))}
              {html.value != null
                ? (
                  <Field label="_innerHtml">
                    <Widget
                      textarea
                      value={html.value}
                      onChange={(v) => {
                        html.value = v;
                      }}
                    />
                  </Field>
                )
                : null}
            </fieldset>
          )
          : null}
        {insts.map((inst) => (
          <fieldset class="ctrl-group" key={inst.key}>
            <legend class="ctrl-group__legend">
              {inst.id ? inst.name + " #" + inst.id : inst.name}
            </legend>
            {Object.keys(subDefs[inst.name] || {}).map((k) => (
              <Field key={k} label={k}>
                <Widget
                  def={subDefs[inst.name][k]}
                  value={subState.value[inst.key]?.[k]}
                  onChange={(v) =>
                    setInst(inst.key, k, v)}
                />
              </Field>
            ))}
          </fieldset>
        ))}
      </aside>
      <EventLog />
    </div>
  );
}
