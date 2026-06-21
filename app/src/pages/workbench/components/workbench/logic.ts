// workbench — the isolate v0.4 persistent shell, ported from the Fresh island
// Shell.tsx to a single sprig island. setup() runs on the server (SSR initial
// paint) AND on the client (hydration); window/document side effects are guarded
// to the client. The navigator/palette/console derived views are computed() so
// the template can iterate plain arrays. The stage bridge (postMessage to/from
// the iframe) and test runs are unchanged — data over the wire, framework-agnostic.
import { computed, defineComponent, effect, signal } from "@sprig/core";
import type {
  Case,
  ControlView,
  DotStatus,
  Problem,
  RunResponse,
  StageEvent,
  Surface,
  TestState,
  Toast,
} from "../../../../lib/types.ts";

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

const isClient = typeof document !== "undefined";

export default defineComponent({
  inputs: ["cases", "problems", "previewBase"],
  setup: (ctx) => {
    const cases = ctx.input<Case[]>("cases", []);
    const problems = ctx.input<Problem[]>("problems", []);
    const previewBase = ctx.input<string>("previewBase", "");
    const all = (): Case[] => cases() ?? [];
    // the iframe / open-in-tab URL: previewBase (a running host app) + the case route.
    const frameSrc = computed(() => (previewBase() ?? "") + active());

    const active = signal(all().length ? all()[0].route : "");
    const search = signal("");
    const collapsed = signal<Record<string, boolean>>({});
    const palOpen = signal(false);
    const palQ = signal("");
    const palSel = signal(0);
    const toasts = signal<Toast[]>([]);
    const bannerOpen = signal((problems() ?? []).length > 0);
    const running = signal(false);

    // dock + stage tools + the stage bridge (filled by postMessage from the iframe)
    const dockTab = signal("controls");
    const dockOpen = signal(true);
    const dockH = signal(280);
    const caseStatus = signal<Record<string, DotStatus>>({}); // route -> status
    const vp = signal("fit");
    const zoom = signal(1);
    const grid = signal(false);
    const bg = signal("#ffffff");
    const kbd = signal(false);
    const kbdMode = signal("ios");
    const surface = signal<Surface | null>(null);
    const events = signal<StageEvent[]>([]);
    const conQ = signal("");
    const conHidden = signal<Record<string, boolean>>({});
    const tests = signal<TestState>({ status: "idle", results: [], error: null });

    let seq = 0;
    let evSeq = 0;

    const toast = (tone: string, title: string, text: string) => {
      const id = ++seq;
      toasts.set([...toasts(), { id, tone, title, text }]);
      setTimeout(() => toasts.set(toasts().filter((t) => t.id !== id)), 5000);
    };
    const dismissToast = (id: number) => toasts.set(toasts().filter((t) => t.id !== id));

    const activeCase = computed<Case | undefined>(() => all().find((c) => c.route === active()));
    const reset = () => {
      surface.set(null);
      events.set([]);
      tests.set({ status: "idle", results: [], error: null });
    };
    const go = (route: string) => {
      if (route !== active()) reset();
      active.set(route);
      if (isClient) location.hash = route;
      palOpen.set(false);
    };

    // ── navigator (filtered + grouped sections → categories → components → cases) ──
    const matches = (c: Case, q: string) =>
      !q || (c.category + " " + c.component + " " + c.label).toLowerCase().includes(q);

    const nav = computed(() => {
      const q = search().trim().toLowerCase();
      const cs = caseStatus();
      const act = active();
      const coll = collapsed();
      return SECTIONS.flatMap((sec) => {
        const inSec = all().filter((c) => c.target === sec.target && matches(c, q));
        if (!inSec.length) return [];
        const cats = groupBy(inSec, (c) => c.category);
        const catNodes = Object.keys(cats).sort().map((cat) => {
          const ck = sec.target + "/" + cat;
          const comps = groupBy(cats[cat], (c) => c.component);
          return {
            cat,
            ck,
            count: cats[cat].length,
            collapsed: !!coll[ck],
            comps: Object.keys(comps).sort().map((comp) => ({
              comp,
              cases: comps[comp].map((c) => ({
                ...c,
                status: cs[c.route] || c.kind,
                isActive: c.route === act,
              })),
            })),
          };
        });
        return [{ label: sec.label, target: sec.target, isComp: sec.target === "component", cats: catNodes }];
      });
    });
    const navEmpty = computed(() => nav().length === 0);
    const toggleCat = (ck: string) => collapsed.set({ ...collapsed(), [ck]: !collapsed()[ck] });
    const onSearch = (e: Event) => search.set((e.target as HTMLInputElement).value);

    // ── ⌘K palette ──
    const palItems = computed<Case[]>(() => {
      const pq = palQ().trim().toLowerCase();
      const list = !pq
        ? all()
        : all().filter((c) => (c.component + " " + c.category + " " + c.label).toLowerCase().includes(pq));
      return list.slice(0, 50);
    });
    const openPalette = () => {
      palOpen.set(true);
      palQ.set("");
      palSel.set(0);
    };
    const onPalInput = (e: Event) => {
      palQ.set((e.target as HTMLInputElement).value);
      palSel.set(0);
    };
    const onPalKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        palSel.set(Math.min(palSel() + 1, palItems().length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        palSel.set(Math.max(palSel() - 1, 0));
      } else if (e.key === "Enter") {
        const it = palItems()[palSel()];
        if (it) go(it.route);
      } else if (e.key === "Escape") palOpen.set(false);
    };
    const palBackdrop = (e: Event) => {
      if (e.target === e.currentTarget) palOpen.set(false);
    };

    // ── test runs (network channel: /api/http/post-test-run) ──
    const runCase = async (c: Case) => {
      if (!c.testFiles.length) return null;
      caseStatus.set({ ...caseStatus(), [c.route]: "running" });
      try {
        const res = await fetch("/api/http/post-test-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: c.testFiles }),
        });
        const j: RunResponse = await res.json();
        const results = j.testResults || j.results || [];
        const pass = !!j.ok && results.length > 0 && results.every((r) => r.ok);
        caseStatus.set({ ...caseStatus(), [c.route]: pass ? "pass" : "fail" });
        return { pass, results, error: (!j.ok && !results.length) ? (j.error || "run failed") : null };
      } catch (e) {
        caseStatus.set({ ...caseStatus(), [c.route]: "fail" });
        return { pass: false, results: [], error: String((e as Error)?.message || e) };
      }
    };
    const runAll = async () => {
      const withTests = all().filter((c) => c.testFiles.length);
      if (!withTests.length) {
        toast("info", "No tests", "No spec files were discovered.");
        return;
      }
      running.set(true);
      let passed = 0;
      for (const c of withTests) {
        const r = await runCase(c);
        if (r && r.pass) passed++;
      }
      running.set(false);
      if (passed === withTests.length) {
        toast("ok", "All cases passed", passed + "/" + withTests.length + " cases green.");
      } else {
        toast("fail", "Some cases failed", passed + "/" + withTests.length + " cases passed.");
      }
    };
    const runTests = async () => {
      const c = activeCase();
      const files = c ? c.testFiles : [];
      if (!files.length || !c) return;
      tests.set({ status: "running", results: [], error: null });
      caseStatus.set({ ...caseStatus(), [c.route]: "running" });
      try {
        const res = await fetch("/api/http/post-test-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files }),
        });
        const j: RunResponse = await res.json();
        const results = j.testResults || j.results || [];
        const pass = !!j.ok && results.length > 0 && results.every((r) => r.ok);
        tests.set({ status: "done", results, error: (!j.ok && !results.length) ? (j.error || "run failed") : null });
        caseStatus.set({ ...caseStatus(), [c.route]: pass ? "pass" : "fail" });
      } catch (e) {
        tests.set({ status: "done", results: [], error: String((e as Error)?.message || e) });
        caseStatus.set({ ...caseStatus(), [c.route]: "fail" });
      }
    };

    // ── tests tab view-model ──
    const testFiles = computed<string[]>(() => activeCase()?.testFiles ?? []);
    const testNames = computed<string[]>(() => activeCase()?.tests ?? []);
    const showSpecList = computed(() => {
      const t = tests();
      return !t.results.length && t.status !== "running" && !t.error && testNames().length > 0;
    });

    // ── console tab view-model ──
    const conTypes = computed<string[]>(() => [...new Set(events().map((e) => e.type))]);
    const conVisible = computed<StageEvent[]>(() => {
      const cq = conQ().trim().toLowerCase();
      const hidden = conHidden();
      return events().filter((e) =>
        !hidden[e.type] &&
        (!cq || (e.source + " " + e.type + " " + e.detail).toLowerCase().includes(cq))
      );
    });
    const toggleConType = (ty: string) => conHidden.set({ ...conHidden(), [ty]: !conHidden()[ty] });
    const onConFilter = (e: Event) => conQ.set((e.target as HTMLInputElement).value);
    const clearEvents = () => events.set([]);

    // ── stage tools ──
    const setVp = (v: string) => vp.set(v);
    const setKbdMode = (m: string) => kbdMode.set(m);
    const toggleKbd = () => kbd.set(!kbd());
    const toggleGrid = () => grid.set(!grid());
    const zoomOut = () => zoom.set(Math.max(0.25, Math.round((zoom() - 0.1) * 100) / 100));
    const zoomReset = () => zoom.set(1);
    const zoomIn = () => zoom.set(Math.min(2, Math.round((zoom() + 0.1) * 100) / 100));
    const zoomPct = computed(() => Math.round(zoom() * 100) + "%");
    const onBg = (e: Event) => bg.set((e.target as HTMLInputElement).value);
    const stageWidth = computed(() => (vp() === "fit" || vp() === "full") ? "100%" : vp() + "px");
    const canvasStyle = computed(() => "width:" + stageWidth() + ";transform:scale(" + zoom() + ")");
    const canvasKbdClass = computed(() =>
      kbd() ? (kbdMode() === "android" ? "kbd-resize" : "kbd-overlay") : ""
    );
    const hostStyle = computed(() => "background:" + bg());

    // ── dock ──
    const setDock = (tab: string) => {
      dockTab.set(tab);
      dockOpen.set(true);
    };
    const toggleDock = () => dockOpen.set(!dockOpen());
    const dockStyle = computed(() => dockOpen() ? "height:" + dockH() + "px" : "");
    const startDockResize = (e: PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = dockH();
      const onMove = (ev: PointerEvent) =>
        dockH.set(Math.max(120, Math.min(globalThis.innerHeight - 160, startH + (startY - ev.clientY))));
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
    };

    // ── stage bridge (postMessage to/from the iframe) ──
    const frame = (): HTMLIFrameElement | null =>
      isClient ? document.querySelector<HTMLIFrameElement>(".stage-frame") : null;
    const sendSet = (msg: Record<string, unknown>) => {
      try {
        const f = frame();
        f?.contentWindow?.postMessage({ target: "isolate-stage", type: "set", ...msg }, "*");
      } catch { /* ignore */ }
    };
    const editControl = (c: ControlView, value: unknown) => {
      sendSet({ scope: c.scope, key: c.key, instKey: c.instKey, value });
      const s = surface();
      if (!s) return;
      const upd = (x: ControlView) =>
        (x.scope === c.scope && x.key === c.key && x.instKey === c.instKey) ? { ...x, value } : x;
      surface.set({
        ...s,
        controls: s.controls.map(upd),
        instances: s.instances.map((inst) => ({ ...inst, controls: inst.controls.map(upd) })),
      });
    };
    // widget helpers: resolve the control's widget type + read a typed value off the event.
    const controlType = (c: ControlView): string => {
      const def = c.def || {};
      return def.type ||
        (typeof c.value === "boolean" ? "boolean" : typeof c.value === "number" ? "number" : "text");
    };
    const editText = (c: ControlView, e: Event) => editControl(c, (e.target as HTMLInputElement).value);
    const editNumber = (c: ControlView, e: Event) => editControl(c, Number((e.target as HTMLInputElement).value));
    const editBool = (c: ControlView, e: Event) => editControl(c, (e.target as HTMLInputElement).checked);
    const editHtml = (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      sendSet({ scope: "html", value: v });
      const s = surface();
      if (s) surface.set({ ...s, html: v });
    };
    const hasControls = computed(() => {
      const s = surface();
      return !!s && (s.controls.length > 0 || s.html != null);
    });
    const controlsEmpty = computed(() => {
      const s = surface();
      return !!s && !s.controls.length && s.html == null && !s.instances.length;
    });

    // ── client-only effects ──
    if (isClient) {
      const fromHash = () => {
        const h = decodeURIComponent(location.hash.replace(/^#/, ""));
        if (h && h !== active() && all().some((c) => c.route === h)) {
          reset();
          active.set(h);
        }
      };
      fromHash();
      addEventListener("hashchange", fromHash);
      addEventListener("keydown", (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
          e.preventDefault();
          openPalette();
        } else if (e.key === "Escape") palOpen.set(false);
      });
      addEventListener("message", (e: MessageEvent) => {
        const d = e.data;
        if (!d || d.source !== "isolate-stage") return;
        if (d.type === "ready") {
          surface.set({
            name: d.name,
            background: d.background,
            html: d.html,
            controls: d.controls || [],
            instances: d.instances || [],
          });
          if (d.background) bg.set(d.background);
        } else if (d.type === "instances") {
          const s = surface();
          if (s) surface.set({ ...s, instances: d.instances || [] });
        } else if (d.type === "event") {
          events.set([{ id: ++evSeq, ...d.payload } as StageEvent, ...events()].slice(0, 300));
        }
      });
      // focus the palette input when it opens
      effect(() => {
        if (palOpen()) {
          queueMicrotask(() => document.querySelector<HTMLInputElement>(".palette input")?.focus());
        }
      });
    }

    return {
      // static lists (kept out of the template — string literals there must be single-quoted)
      vpModes: ["fit", "360", "768", "1024", "full"],
      kbdR1: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
      kbdR2: ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
      kbdR3: ["z", "x", "c", "v", "b", "n", "m"],
      // signals / state
      active, search, palOpen, palQ, palSel, toasts, bannerOpen, running,
      problems, dockTab, dockOpen, vp, zoom, grid, bg, kbd, kbdMode, surface, conQ,
      // derived
      nav, navEmpty, palItems, activeCase, hasAny: computed(() => all().length > 0),
      testFiles, testNames, showSpecList, tests, conTypes, conVisible,
      zoomPct, canvasStyle, canvasKbdClass, hostStyle, dockStyle, hasControls, controlsEmpty,
      conHidden, caseStatus, events, previewBase, frameSrc,
      // methods
      go, toggleCat, onSearch, openPalette, onPalInput, onPalKey, palBackdrop,
      runAll, runTests, setVp, setKbdMode, toggleKbd, toggleGrid, zoomOut, zoomReset, zoomIn, onBg,
      setDock, toggleDock, startDockResize, dismissToast, closeBanner: () => bannerOpen.set(false),
      editControl, controlType, editText, editNumber, editBool, editHtml,
      toggleConType, onConFilter, clearEvents,
    };
  },
});
