// ─────────────────────────── component lifecycle + state snapshot (spike) ───────────────────────────
// Phase 2 of the render overhaul: the four-hook lifecycle and the server→browser state
// transfer, proven standalone (lifecycle.test.ts) before it rewires the real component
// model. A class-based component (logic.ts) may define any of:
//   onServerInit()    — async; runs on the server, MUST finish before render (it makes
//                       the scope final). The data-loading hook.
//   onBrowserInit()   — runs in the browser after hydration (the single "ready" hook —
//                       no separate onInit/afterViewInit).
//   onServerDestroy() — server instance discarded (release per-request resources).
//   onBrowserDestroy()— client instance torn down (soft-nav etc.) — cleanup.
//
// The two runtimes are DIFFERENT instances; the only thing that crosses the wire is a
// snapshot of the instance's serializable own fields (signal VALUES included), taken
// after onServerInit and restored before onBrowserInit — so the client's first paint
// matches the server's and onBrowserInit sees the server-produced state.
import { isSignal } from "@sprig/core";

// deno-lint-ignore no-explicit-any
type AnyInstance = Record<string, any>;
// deno-lint-ignore no-explicit-any
export interface ComponentClass<P = any> {
  new (props: P): AnyInstance;
}

function isSerializable(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  // NaN / ±Infinity survive typeof "number" but JSON turns them into null silently —
  // drop them so the field keeps its constructor default on the client instead.
  if (t === "number") return Number.isFinite(v);
  if (t === "string" || t === "boolean") return true;
  if (t === "object") {
    // Set/Map JSON.stringify to "{}" WITHOUT throwing — a silent TOTAL data loss that
    // would restore as an empty object on the client. Drop them (like the lossy-number
    // case above) so the field keeps its constructor default instead of being corrupted.
    if (v instanceof Set || v instanceof Map) return false;
    try {
      JSON.stringify(v);
      return true;
    } catch {
      return false;
    }
  }
  return false; // function / symbol / undefined → dropped silently (documented contract)
}

/** Snapshot an instance's serializable own fields. Signal fields contribute their
 *  current VALUE (so reactive state loaded on the server survives to the browser).
 *  Methods live on the prototype and #private fields aren't enumerable, so neither is
 *  captured — exactly the right transfer surface. */
export function snapshotOf(inst: AnyInstance): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const key of Object.keys(inst)) {
    const v = inst[key];
    const val = isSignal(v) ? v() : v;
    if (isSerializable(val)) snap[key] = val;
  }
  return snap;
}

/** Re-seed a fresh instance from the snapshot. A signal field is re-seeded via .set()
 *  (keeping it reactive); a plain field is assigned. Runs BEFORE onBrowserInit. */
export function restore(inst: AnyInstance, snap: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(snap)) {
    const cur = inst[k];
    if (isSignal(cur)) cur.set(val);
    else inst[k] = val;
  }
}

/** SERVER: construct → await onServerInit → render → snapshot → onServerDestroy.
 *  The await is the whole point: nothing renders or snapshots until the scope is final. */
// deno-lint-ignore no-explicit-any
export async function renderOnServer<P = any>(
  Cls: ComponentClass<P>,
  props: P,
): Promise<{ html: string; snapshot: Record<string, unknown> }> {
  const inst = new Cls(props);
  await inst.onServerInit?.(); // ← MUST complete before view() reads the fields
  const html = typeof inst.view === "function" ? inst.view() : "";
  const snapshot = snapshotOf(inst);
  inst.onServerDestroy?.();
  return { html, snapshot };
}

/** CLIENT: construct → restore snapshot → onBrowserInit. The restore lands before
 *  onBrowserInit (and before any re-render) so the first client paint matches the
 *  server and onBrowserInit observes the server-produced state. */
// deno-lint-ignore no-explicit-any
export function hydrateOnClient<P = any>(
  Cls: ComponentClass<P>,
  snapshot: Record<string, unknown>,
  props: P,
): AnyInstance {
  const inst = new Cls(props);
  restore(inst, snapshot);
  inst.onBrowserInit?.();
  return inst;
}

/** CLIENT teardown (soft-nav / conditional removal). */
export function destroyOnClient(inst: AnyInstance): void {
  inst.onBrowserDestroy?.();
}
