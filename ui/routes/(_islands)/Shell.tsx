import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { cases, problems } from "../../manifest.ts";
import type {
  Case,
  ControlView,
  DotStatus,
  RunResponse,
  StageEvent,
  Surface,
  TestState,
  Toast,
} from "../../types.ts";

const SECTIONS = [
  { label: "Components", target: "component" },
  { label: "Pages", target: "page" },
];

function groupBy<T>(arr: T[], keyFn: (x: T) => string): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const x of arr) {
    const k = keyFn(x);
    (m[k] = m[k] || []).push(x);
  }
  return m;
}

export default function Shell() {
  const all = cases;
  const active = useSignal(all.length ? all[0].route : "");
  const search = useSignal("");
  const collapsed = useSignal<Record<string, boolean>>({});
  const palOpen = useSignal(false);
  const palQ = useSignal("");
  const palSel = useSignal(0);
  const toasts = useSignal<Toast[]>([]);
  const bannerOpen = useSignal(problems.length > 0);
  const running = useSignal(false);
  const seq = useRef(0);
  const evSeq = useRef(0);
  const palInput = useRef<HTMLInputElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  // dock + stage tools + the stage bridge (filled by postMessage from the iframe)
  const dockTab = useSignal("controls");
  const dockOpen = useSignal(true);
  const dockH = useSignal(280);
  const caseStatus = useSignal<Record<string, DotStatus>>({}); // route -> status
  const vp = useSignal("fit");
  const zoom = useSignal(1);
  const grid = useSignal(false);
  const bg = useSignal("#ffffff");
  const kbd = useSignal(false); // emulated mobile keyboard on/off
  const kbdMode = useSignal("ios"); // "ios" (overlay) | "android" (resize)
  const surface = useSignal<Surface | null>(null);
  const events = useSignal<StageEvent[]>([]); // bridged stage events
  const conQ = useSignal("");
  const conHidden = useSignal<Record<string, boolean>>({});
  const tests = useSignal<TestState>({
    status: "idle",
    results: [],
    error: null,
  });

  const toast = (tone: string, title: string, text: string) => {
    const id = ++seq.current;
    toasts.value = [...toasts.value, { id, tone, title, text }];
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 5000);
  };
  const activeCase = (): Case | undefined =>
    all.find((c) => c.route === active.value);
  const reset = () => {
    surface.value = null;
    events.value = [];
    tests.value = { status: "idle", results: [], error: null };
  };
  const go = (route: string) => {
    if (route !== active.value) reset();
    active.value = route;
    location.hash = route;
    palOpen.value = false;
  };

  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(location.hash.replace(/^#/, ""));
      if (h && h !== active.value && all.some((c) => c.route === h)) {
        reset();
        active.value = h;
      }
    };
    fromHash();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        palOpen.value = true;
        palQ.value = "";
        palSel.value = 0;
      } else if (e.key === "Escape") palOpen.value = false;
    };
    addEventListener("hashchange", fromHash);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("hashchange", fromHash);
      removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (palOpen.value && palInput.current) palInput.current.focus();
  }, [palOpen.value]);

  const q = search.value.trim().toLowerCase();
  const matches = (c: Case) =>
    !q ||
    (c.category + " " + c.component + " " + c.label).toLowerCase().includes(q);
  const shown = all.filter(matches);

  const pq = palQ.value.trim().toLowerCase();
  const palItems =
    (!pq
      ? all
      : all.filter((c) =>
        (c.component + " " + c.category + " " + c.label).toLowerCase().includes(
          pq,
        )
      )).slice(0, 50);

  // Run one case's specs and reflect the verdict on its navigator dot.
  const runCase = async (c: Case) => {
    if (!c.testFiles.length) return null;
    caseStatus.value = { ...caseStatus.value, [c.route]: "running" };
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tests: c.testFiles }),
      });
      const j: RunResponse = await res.json();
      const results = j.results || [];
      const pass = !!j.ok && results.length > 0 &&
        results.every((r) => r.ok);
      caseStatus.value = {
        ...caseStatus.value,
        [c.route]: pass ? "pass" : "fail",
      };
      return {
        pass,
        results,
        error: (!j.ok && !results.length) ? (j.error || "run failed") : null,
      };
    } catch (e) {
      caseStatus.value = { ...caseStatus.value, [c.route]: "fail" };
      return {
        pass: false,
        results: [],
        error: String((e as Error)?.message || e),
      };
    }
  };
  const runAll = async () => {
    const withTests = all.filter((c) => c.testFiles.length);
    if (!withTests.length) {
      toast("info", "No tests", "No spec files were discovered.");
      return;
    }
    running.value = true;
    let passed = 0;
    for (const c of withTests) {
      const r = await runCase(c);
      if (r && r.pass) passed++;
    }
    running.value = false;
    if (passed === withTests.length) {
      toast(
        "ok",
        "All cases passed",
        passed + "/" + withTests.length + " cases green.",
      );
    } else {
      toast(
        "fail",
        "Some cases failed",
        passed + "/" + withTests.length + " cases passed.",
      );
    }
  };

  // Drag the dock taller/shorter.
  const startDockResize = (e: PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dockH.value;
    const onMove = (ev: PointerEvent) => {
      dockH.value = Math.max(
        120,
        Math.min(globalThis.innerHeight - 160, startH + (startY - ev.clientY)),
      );
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  // Receive the stage's control surface + events from the iframe (the bridge in
  // controls.tsx posts them up when embedded).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "isolate-stage") return;
      if (d.type === "ready") {
        surface.value = {
          name: d.name,
          background: d.background,
          html: d.html,
          controls: d.controls || [],
          instances: d.instances || [],
        };
        if (d.background) bg.value = d.background;
      } else if (d.type === "instances") {
        if (surface.value) {
          surface.value = { ...surface.value, instances: d.instances || [] };
        }
      } else if (d.type === "event") {
        events.value = [
          { id: ++evSeq.current, ...d.payload } as StageEvent,
          ...events.value,
        ].slice(0, 300);
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, []);

  const sendSet = (msg: Record<string, unknown>) => {
    try {
      if (frame.current && frame.current.contentWindow) {
        frame.current.contentWindow.postMessage(
          { target: "isolate-stage", type: "set", ...msg },
          "*",
        );
      }
    } catch (_e) { /* ignore */ }
  };
  const editControl = (c: ControlView, value: unknown) => {
    sendSet({ scope: c.scope, key: c.key, instKey: c.instKey, value });
    const s = surface.value;
    if (!s) return;
    const upd = (x: ControlView) =>
      (x.scope === c.scope && x.key === c.key && x.instKey === c.instKey)
        ? { ...x, value }
        : x;
    surface.value = {
      ...s,
      controls: s.controls.map(upd),
      instances: s.instances.map((inst) => ({
        ...inst,
        controls: inst.controls.map(upd),
      })),
    };
  };

  const widget = (c: ControlView, onChange: (v: unknown) => void) => {
    const def = c.def || {};
    const type = def.type ||
      (typeof c.value === "boolean"
        ? "boolean"
        : typeof c.value === "number"
        ? "number"
        : "text");
    if (type === "select") {
      return (
        <select
          class="ci"
          value={c.value == null ? "" : String(c.value)}
          onChange={(e) => onChange(e.currentTarget.value)}
        >
          {(def.options || []).map((o) => (
            <option key={String(o)} value={String(o)}>{String(o)}</option>
          ))}
        </select>
      );
    }
    if (type === "range") {
      return (
        <span class="crange">
          <input
            type="range"
            min={def.min == null ? 0 : def.min}
            max={def.max == null ? 100 : def.max}
            step={def.step == null ? 1 : def.step}
            value={String(c.value == null ? 0 : c.value)}
            onInput={(e) => onChange(Number(e.currentTarget.value))}
          />
          <span class="val">{String(c.value == null ? 0 : c.value)}</span>
        </span>
      );
    }
    if (type === "color") {
      return (
        <input
          type="color"
          class="swatch"
          value={String(c.value == null ? "#000000" : c.value)}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      );
    }
    if (type === "boolean") {
      return (
        <input
          type="checkbox"
          class="cbox"
          checked={!!c.value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    }
    if (type === "number") {
      return (
        <input
          type="number"
          class="ci"
          value={String(c.value == null ? 0 : c.value)}
          onInput={(e) => onChange(Number(e.currentTarget.value))}
        />
      );
    }
    return (
      <input
        type="text"
        class="ci"
        value={c.value == null ? "" : String(c.value)}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
    );
  };

  const renderControlsTab = () => {
    const s = surface.value;
    if (!s) return <div class="ctrl-empty">Loading the stage…</div>;
    const hasHtml = s.html != null;
    if (!s.controls.length && !hasHtml && !s.instances.length) {
      return <div class="ctrl-empty">no editable props</div>;
    }
    return (
      <div class="ctrls-body">
        {(s.controls.length || hasHtml)
          ? (
            <div class="ctrl-group">
              <div class="ctrl-group__h">{s.name}</div>
              {s.controls.map((c) => (
                <div class="ctrl-row" key={c.scope + c.key}>
                  <label>
                    {c.key}
                    {c.scope === "signal"
                      ? <span class="sig">signal</span>
                      : null}
                  </label>
                  {widget(c, (v) =>
                    editControl(c, v))}
                </div>
              ))}
              {hasHtml
                ? (
                  <div class="ctrl-row">
                    <label>_innerHtml</label>
                    <input
                      class="ci"
                      value={s.html ?? ""}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        sendSet({ scope: "html", value: v });
                        surface.value = { ...s, html: v };
                      }}
                    />
                  </div>
                )
                : null}
            </div>
          )
          : null}
        {s.instances.map((inst) => (
          <div class="ctrl-group" key={inst.key}>
            <div class="ctrl-group__h">
              {inst.id ? inst.name + " #" + inst.id : inst.name}
              <span class="pill">instance</span>
            </div>
            {inst.controls.map((c) => (
              <div class="ctrl-row" key={c.key}>
                <label>{c.key}</label>
                {widget(c, (v) => editControl(c, v))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderConsoleTab = () => {
    const list = events.value;
    const cq = conQ.value.trim().toLowerCase();
    const hidden = conHidden.value;
    const types = [...new Set(list.map((e) => e.type))];
    const visible = list.filter((e) =>
      !hidden[e.type] &&
      (!cq ||
        (e.source + " " + e.type + " " + e.detail).toLowerCase().includes(cq))
    );
    return (
      <div class="con">
        <div class="con-head">
          <input
            class="con-filter"
            placeholder="filter…"
            value={conQ.value}
            onInput={(e) => {
              conQ.value = e.currentTarget.value;
            }}
          />
          <div class="con-types">
            {types.map((ty) => (
              <button
                type="button"
                class={"con-type" + (hidden[ty] ? " off" : "")}
                key={ty}
                onClick={() => {
                  conHidden.value = { ...hidden, [ty]: !hidden[ty] };
                }}
              >
                {ty}
              </button>
            ))}
          </div>
          <span class="con-count">{visible.length + " / " + list.length}</span>
          {list.length
            ? (
              <button
                type="button"
                class="con-clear"
                onClick={() => {
                  events.value = [];
                }}
              >
                clear
              </button>
            )
            : null}
        </div>
        <div class="con-list">
          {visible.length === 0
            ? (
              <div class="con-empty">
                {list.length
                  ? "nothing matches the filter"
                  : "no events yet — interact with the component on the stage"}
              </div>
            )
            : null}
          {visible.map((e) => (
            <div class="con-row" key={e.id}>
              <span class="con-time">{e.time}</span>
              <span class="con-src">{e.source}</span>
              <span class="con-type-c">{e.type}</span>
              <span class="con-detail">{e.detail}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTestsTab = () => {
    const c = activeCase();
    const files = c ? c.testFiles : [];
    const names = c ? c.tests : [];
    const t = tests.value;
    const run = async () => {
      if (!files.length || !c) return;
      tests.value = { status: "running", results: [], error: null };
      caseStatus.value = { ...caseStatus.value, [c.route]: "running" };
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tests: files }),
        });
        const j: RunResponse = await res.json();
        const results = j.results || [];
        const pass = !!j.ok && results.length > 0 &&
          results.every((r) => r.ok);
        tests.value = {
          status: "done",
          results,
          error: (!j.ok && !results.length) ? (j.error || "run failed") : null,
        };
        caseStatus.value = {
          ...caseStatus.value,
          [c.route]: pass ? "pass" : "fail",
        };
      } catch (e) {
        tests.value = {
          status: "done",
          results: [],
          error: String((e as Error)?.message || e),
        };
        caseStatus.value = { ...caseStatus.value, [c.route]: "fail" };
      }
    };
    return (
      <div class="tests">
        <div class="tests-bar">
          <button
            type="button"
            class="run-btn"
            onClick={run}
            disabled={!files.length || t.status === "running"}
          >
            {t.status === "running" ? "running…" : "▸ run tests"}
          </button>
          <span class="tests-summary">
            {files.length
              ? names.length + " spec(s) · " + files.length + " file(s)"
              : "no tests for this case"}
          </span>
        </div>
        {t.error
          ? (
            <div class="spec-err">
              <span class="lbl">run error</span>
              {"\n" + t.error}
            </div>
          )
          : null}
        {t.results.length
          ? (
            <div class="spec-file">
              <div class="spec-file__h">results</div>
              {t.results.map((r, i) => (
                <div class="spec" key={i}>
                  <span class={"ico " + (r.ok ? "pass" : "fail")}>
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span class="name">{r.title}</span>
                </div>
              ))}
            </div>
          )
          : (t.status !== "running" && !t.error && names.length
            ? (
              <div class="spec-file">
                <div class="spec-file__h">specs</div>
                {names.map((n, i) => (
                  <div class="spec" key={i}>
                    <span class="ico idle">○</span>
                    <span class="name">{n}</span>
                  </div>
                ))}
              </div>
            )
            : null)}
      </div>
    );
  };

  // An emulated mobile keyboard tray. Purely visual + space-reserving: it shrinks
  // the iframe (a real viewport) so the component reflows as it would with a real
  // on-screen keyboard up. Not a functional input.
  const renderKeyboard = () => (
    <div class="kbd" aria-hidden="true">
      {[["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], [
        "a",
        "s",
        "d",
        "f",
        "g",
        "h",
        "j",
        "k",
        "l",
      ]].map((row, i) => (
        <div class="kbd-row" key={i}>
          {row.map((k) => <span class="kbd-key" key={k}>{k}</span>)}
        </div>
      ))}
      <div class="kbd-row">
        <span class="kbd-key dark wide">⇧</span>
        {["z", "x", "c", "v", "b", "n", "m"].map((k) => (
          <span class="kbd-key" key={k}>{k}</span>
        ))}
        <span class="kbd-key dark wide">⌫</span>
      </div>
      <div class="kbd-row">
        <span class="kbd-key dark">123</span>
        <span class="kbd-key dark">🌐</span>
        <span class="kbd-key space">space</span>
        <span class="kbd-key return">return</span>
      </div>
    </div>
  );

  const cur = activeCase();

  return (
    <div id="app">
      <header class="topbar">
        <div class="brand">
          <span class="logo">◧</span>
          <span>isolate</span>
          <span class="ver">v0.4</span>
        </div>
        <button
          type="button"
          class="kbd-search"
          onClick={() => {
            palOpen.value = true;
            palQ.value = "";
            palSel.value = 0;
          }}
        >
          <span>⌕</span>
          <span>Jump to a case…</span>
          <span class="k">⌘K</span>
        </button>
        <div class="spacer"></div>
        <button
          type="button"
          class="tbtn"
          onClick={runAll}
          disabled={running.value}
        >
          <span class="dot"></span>
          {running.value ? "Running…" : "Run all tests"}
        </button>
      </header>

      <div class="body">
        <nav class="sidebar">
          <div class="sb-search">
            <input
              value={search.value}
              onInput={(e) => {
                search.value = e.currentTarget.value;
              }}
              placeholder="Filter components…  ( / )"
              autocomplete="off"
            />
          </div>
          <div class="sb-scroll">
            {shown.length === 0
              ? (
                <div class="sb-empty">
                  {all.length
                    ? "No cases match your filter."
                    : "No components yet. Drop an isolate/ folder next to any component to see it here."}
                </div>
              )
              : SECTIONS.map((sec) => {
                const inSec = shown.filter((c) => c.target === sec.target);
                if (!inSec.length) return null;
                const cats = groupBy(inSec, (c) => c.category);
                return (
                  <div class="sb-section" key={sec.target}>
                    <div
                      class={"sb-section__h" +
                        (sec.target === "component" ? " is-comp" : "")}
                    >
                      {sec.label}
                    </div>
                    {Object.keys(cats).sort().map((cat) => {
                      const ck = sec.target + "/" + cat;
                      const isColl = !!collapsed.value[ck];
                      const comps = groupBy(cats[cat], (c) => c.component);
                      return (
                        <div
                          class={"sb-cat" + (isColl ? " collapsed" : "")}
                          key={ck}
                        >
                          <button
                            type="button"
                            class="sb-cat__h"
                            onClick={() => {
                              collapsed.value = {
                                ...collapsed.value,
                                [ck]: !isColl,
                              };
                            }}
                          >
                            <span class="sb-cat__caret">▸</span>
                            <span>{cat}</span>
                            <span class="sb-cat__count">
                              {cats[cat].length}
                            </span>
                          </button>
                          <div class="sb-cases">
                            {Object.keys(comps).sort().map((comp) => (
                              <div class="sb-comp-group" key={comp}>
                                <div class="sb-comp">{comp}</div>
                                {comps[comp].map((c) => (
                                  <button
                                    type="button"
                                    class={"sb-case" +
                                      (c.route === active.value
                                        ? " active"
                                        : "")}
                                    onClick={() => go(c.route)}
                                    key={c.route}
                                  >
                                    <span class="sb-case__label">
                                      {c.label}
                                    </span>
                                    <span
                                      class={"sb-case__status " +
                                        (caseStatus.value[c.route] || c.kind)}
                                      title={caseStatus.value[c.route] ||
                                        c.kind}
                                    >
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </nav>

        <main class="main">
          {bannerOpen.value && problems.length
            ? (
              <div class="banner">
                <span>⚠</span>
                <div>
                  <b>{problems.length} config problem(s)</b>{" "}
                  — these previews are broken.
                  {problems.map((p) => (
                    <div key={p.path + p.detail}>
                      <code>{p.path}</code> {p.detail}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  class="x"
                  onClick={() => {
                    bannerOpen.value = false;
                  }}
                >
                  ×
                </button>
              </div>
            )
            : null}
          <div class="stage-head">
            {cur
              ? (
                <div class="crumb">
                  <span class="seg">{cur.category}</span>
                  <span class="sep">/</span>
                  <span class="cur">{cur.component} · {cur.label}</span>
                  <span class={"kind " + cur.kind}>{cur.kind}</span>
                </div>
              )
              : (
                <div class="crumb">
                  <span class="seg">nothing selected</span>
                </div>
              )}
            <div class="stage-tools">
              <div class="seg-group">
                {["fit", "360", "768", "1024", "full"].map((v) => (
                  <button
                    type="button"
                    class={vp.value === v ? "on" : ""}
                    key={v}
                    onClick={() => {
                      vp.value = v;
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                class={"tool-ico" + (kbd.value ? " on" : "")}
                title="toggle emulated mobile keyboard"
                onClick={() => {
                  kbd.value = !kbd.value;
                }}
              >
                ⌨
              </button>
              {kbd.value
                ? (
                  <div class="seg-group">
                    <button
                      type="button"
                      class={kbdMode.value === "ios" ? "on" : ""}
                      title="iOS: overlay — keyboard floats over a full-height layout (reproduces the fixed-bar-hidden / content-under-keyboard bugs)"
                      onClick={() => {
                        kbdMode.value = "ios";
                      }}
                    >
                      iOS
                    </button>
                    <button
                      type="button"
                      class={kbdMode.value === "android" ? "on" : ""}
                      title="Android: resizes-content — the layout viewport actually shrinks"
                      onClick={() => {
                        kbdMode.value = "android";
                      }}
                    >
                      Android
                    </button>
                  </div>
                )
                : null}
              <button
                type="button"
                class="tool-ico"
                title="zoom out"
                onClick={() => {
                  zoom.value = Math.max(
                    0.25,
                    Math.round((zoom.value - 0.1) * 100) / 100,
                  );
                }}
              >
                −
              </button>
              <button
                type="button"
                class="tool-ico"
                title="reset zoom"
                onClick={() => {
                  zoom.value = 1;
                }}
              >
                {Math.round(zoom.value * 100) + "%"}
              </button>
              <button
                type="button"
                class="tool-ico"
                title="zoom in"
                onClick={() => {
                  zoom.value = Math.min(
                    2,
                    Math.round((zoom.value + 0.1) * 100) / 100,
                  );
                }}
              >
                +
              </button>
              <button
                type="button"
                class={"tool-ico" + (grid.value ? " on" : "")}
                title="toggle grid"
                onClick={() => {
                  grid.value = !grid.value;
                }}
              >
                ▦
              </button>
              <input
                type="color"
                class="swatch"
                title="stage background"
                value={bg.value}
                onInput={(e) => {
                  bg.value = e.currentTarget.value;
                }}
              />
              {cur
                ? (
                  <a
                    class="stage-open tool-ico"
                    href={active.value}
                    target="_blank"
                    title="open this preview in its own tab"
                  >
                    ↗
                  </a>
                )
                : null}
            </div>
          </div>
          <div
            class={"stage-host" + (grid.value ? " grid" : "")}
            style={"background:" + bg.value}
          >
            {active.value
              ? (
                <div
                  class={"stage-canvas" + (kbd.value
                    ? " with-kbd " +
                      (kbdMode.value === "android"
                        ? "kbd-resize"
                        : "kbd-overlay")
                    : "")}
                  style={"width:" + (vp.value === "fit" || vp.value === "full"
                    ? "100%"
                    : vp.value + "px") +
                    ";transform:scale(" + zoom.value + ")"}
                >
                  <iframe
                    ref={frame}
                    class="stage-frame"
                    key={active.value}
                    src={active.value}
                  >
                  </iframe>
                  {kbd.value ? renderKeyboard() : null}
                </div>
              )
              : (
                <div class="stage-empty">
                  Select a case from the navigator to preview it here.
                </div>
              )}
          </div>

          <section
            class={"dock" + (dockOpen.value ? "" : " collapsed")}
            style={dockOpen.value ? "height:" + dockH.value + "px" : ""}
          >
            {dockOpen.value
              ? <div class="dock-resize" onPointerDown={startDockResize}></div>
              : null}
            <div class="dock-tabs">
              <button
                type="button"
                class={"dock-tab" + (dockTab.value === "controls" ? " on" : "")}
                onClick={() => {
                  dockTab.value = "controls";
                  dockOpen.value = true;
                }}
              >
                controls
              </button>
              <button
                type="button"
                class={"dock-tab" + (dockTab.value === "console" ? " on" : "")}
                onClick={() => {
                  dockTab.value = "console";
                  dockOpen.value = true;
                }}
              >
                console{events.value.length
                  ? <span class="badge accent">{events.value.length}</span>
                  : null}
              </button>
              <button
                type="button"
                class={"dock-tab" + (dockTab.value === "tests" ? " on" : "")}
                onClick={() => {
                  dockTab.value = "tests";
                  dockOpen.value = true;
                }}
              >
                tests{cur && cur.tests.length
                  ? <span class="badge">{cur.tests.length}</span>
                  : null}
              </button>
              <button
                type="button"
                class="dock-collapse"
                title={dockOpen.value ? "collapse" : "expand"}
                onClick={() => {
                  dockOpen.value = !dockOpen.value;
                }}
              >
                {dockOpen.value ? "▾" : "▴"}
              </button>
            </div>
            {dockOpen.value
              ? (
                <div class="dock-body">
                  {dockTab.value === "controls"
                    ? renderControlsTab()
                    : dockTab.value === "console"
                    ? renderConsoleTab()
                    : renderTestsTab()}
                </div>
              )
              : null}
          </section>
        </main>
      </div>

      {palOpen.value
        ? (
          <div
            class="palette-back"
            onClick={(e) => {
              if (e.target === e.currentTarget) palOpen.value = false;
            }}
          >
            <div class="palette">
              <input
                ref={palInput}
                placeholder="Jump to a case — type a component, category, or case name…"
                value={palQ.value}
                onInput={(e) => {
                  palQ.value = e.currentTarget.value;
                  palSel.value = 0;
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    palSel.value = Math.min(
                      palSel.value + 1,
                      palItems.length - 1,
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    palSel.value = Math.max(palSel.value - 1, 0);
                  } else if (e.key === "Enter") {
                    const it = palItems[palSel.value];
                    if (it) go(it.route);
                  } else if (e.key === "Escape") palOpen.value = false;
                }}
              />
              <div class="palette-list">
                {palItems.length === 0
                  ? <div class="pal-empty">No matches.</div>
                  : palItems.map((c, i) => (
                    <div
                      class={"pal-item" + (i === palSel.value ? " sel" : "")}
                      key={c.route}
                      onClick={() => go(c.route)}
                      onMouseEnter={() => {
                        palSel.value = i;
                      }}
                    >
                      <span>{c.component} · {c.label}</span>
                      <span class="crumbs">{c.category}</span>
                      <span class="pk">{c.kind}</span>
                    </div>
                  ))}
              </div>
              <div class="pal-foot">
                <span>
                  <span class="k">↑↓</span> navigate
                </span>
                <span>
                  <span class="k">↵</span> open
                </span>
                <span>
                  <span class="k">esc</span> close
                </span>
              </div>
            </div>
          </div>
        )
        : null}

      <div class="toasts">
        {toasts.value.map((t) => (
          <div class={"toast " + t.tone} key={t.id}>
            <div>
              <div class="tt">{t.title}</div>
              <div class="tx">{t.text}</div>
            </div>
            <button
              type="button"
              class="x"
              onClick={() => {
                toasts.value = toasts.value.filter((x) => x.id !== t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
