/// <reference lib="dom" />
// TEMPLATE WIRING — the client-side channel runtime (template-wiring-spec.md §3).
//
// The three directional verbs (`sets:` / `reads:` / `edits:`) are collected at
// compile time by render.ts (they never reach the DOM as literal attributes) and
// arrive here through the island props bridge (`__wiring`) or, for router-outlet
// forwarding, through the `data-wire`/`data-wire-owner` attributes stamped on the
// emitted <sprig-outlet>. At hydration, hydrate.ts calls tetherIsland/forwardTethers
// BEFORE the island's first effect render, so the first client paint already reads
// the channel.
//
// Semantics implemented here (each an accepted [DECIDE] default of the spec):
//  • CHANNEL SCOPE is per-template with explicit forwarding: a channel is keyed by
//    (declaring template's scope stamp, channel name) inside a REGION — the nearest
//    enclosing <sprig-outlet>'s content, or the document root. Same-named wiring in
//    two different templates never collides (different owner stamps), and a channel
//    declared inside an outlet's content dies when soft-nav swaps that content
//    (teardownWiringInside), while shell-declared channels survive navigation.
//  • FORWARDING is the framework marker `router-outlet` only: its tether forwards to
//    the mounted PAGE's signal matching the attribute's LOCAL name (longhand renames
//    only the channel side). Islands nested INSIDE the page are not forwarded.
//  • RETENTION: a channel outlives any participant — it holds its last written value
//    in its region until that region is torn down.
//  • SEEDING: a channel is created unseeded (undefined). The first `sets:` tether to
//    hydrate seeds it from its own current value UNLESS the channel already holds an
//    explicitly WRITTEN value (a `.set()`/`.value=`/`.update()` through a tether —
//    mere tethering, which adopts the pre-seed `undefined`, does not count). Every
//    other tether — reads:, edits:, and any non-first sets: — adopts the channel's
//    current value; its own initial value is discarded.
//  • ENFORCED DIRECTION: `.set()` through a reads: tether THROWS in dev AND
//    production; only the message detail is dev-specific (component + channel +
//    template line). Write-narrowing beyond that is not checked at runtime (the
//    origin's declared TYPE does not exist at runtime — documented limitation).
//  • TETHERING REPLACES: the channel's accessor (write-guarded for reads:) is
//    assigned onto the component's declared field; constructor-time closures over
//    the pre-tether signal keep observing the stale one (documented).
import { isSignal, signal, type WritableAccessor } from "@mrg-keystone/sprig";
import type { TetherSpec, WiringSpec } from "./render.ts";

interface Channel {
  /** the shared tether accessor — writes through it mark the channel `written` */
  acc: WritableAccessor<unknown>;
  /** internal handle: seeding writes through this so it never counts as `written` */
  raw: WritableAccessor<unknown>;
  /** a sets: origin has tethered (first one seeded; later ones adopt) */
  seeded: boolean;
  /** an explicit write happened — a late-arriving seed must never clobber it */
  written: boolean;
}

// dev-mode flag (rich error detail) — kept in lockstep with hydrate.ts's
// devDiagnostics via setWiringDev (the throw itself ships in production too).
let dev = false;
export function setWiringDev(on: boolean): void {
  dev = on;
}

// ────────────────────────────── channel regions ─────────────────────────────
// A REGION is one render tree's channel namespace: the document root, or one
// <sprig-outlet>'s CONTENT (keyed by the outlet element, which survives soft-nav
// swaps while its content — and so its content's channels — does not). Channels
// inside a region are keyed by (owner stamp, channel name): the owner stamp is the
// scope stamp of the template that DECLARED the wiring, which is what makes the
// scope per-template — `sets:org` in two different templates is two channels.
type Region = Map<string, Channel>;
const regions = new Map<Element | null, Region>();

/** The region an ISLAND HOST's tethers resolve in: its nearest enclosing outlet's
 *  content, or the root. (An island directly inside an outlet — a mounted page —
 *  still region-keys by that outlet: its page-template channels die on swap.) */
function regionKeyFor(el: Element): Element | null {
  return el.closest?.("sprig-outlet") ?? null;
}

function regionOf(key: Element | null): Region {
  let r = regions.get(key);
  if (!r) regions.set(key, (r = new Map()));
  return r;
}

function makeChannel(): Channel {
  const raw = signal<unknown>(undefined);
  const ch: Channel = { acc: undefined!, raw, seeded: false, written: false };
  const acc = (() => raw()) as WritableAccessor<unknown>;
  Object.defineProperty(acc, "value", {
    get: () => raw.value,
    set: (v: unknown) => {
      ch.written = true;
      raw.set(v);
    },
  });
  Object.defineProperty(acc, "signal", { get: () => raw.signal });
  acc.set = (v) => {
    ch.written = true;
    raw.set(v);
  };
  acc.update = (fn) => {
    ch.written = true;
    raw.update(fn);
  };
  ch.acc = acc;
  return ch;
}

function channelOf(region: Region, owner: string, name: string): Channel {
  const key = owner + "\u0000" + name;
  let ch = region.get(key);
  if (!ch) region.set(key, (ch = makeChannel()));
  return ch;
}

// ─────────────────────────────── the tethers ────────────────────────────────
/** The read-only facade a `reads:` tether assigns onto the component's field: it
 *  reads (and subscribes) through the shared channel signal, but EVERY write path
 *  (.set / .update / .value=) throws — dev and production alike; dev names the
 *  component, the channel, and the declaring template line (spec §3 "Enforced
 *  direction"). */
function readGuard(ch: Channel, sel: string, t: TetherSpec): WritableAccessor<unknown> {
  const deny = (): never => {
    throw new Error(
      dev
        ? `[sprig] reads: tether is read-only: <${sel}> tried to write channel "${t.c}" ` +
          `through its reads: tether (field "${t.f}"` +
          (t.l ? `, wired at template line ${t.l}` : "") +
          `). Only a sets:/edits: tether may write — change the verb where <${sel}> is instantiated.`
        : "[sprig] reads: tether is read-only",
    );
  };
  const acc = (() => ch.acc()) as WritableAccessor<unknown>;
  Object.defineProperty(acc, "value", { get: () => ch.acc.value, set: deny });
  Object.defineProperty(acc, "signal", { get: () => ch.acc.signal });
  acc.set = deny;
  acc.update = deny;
  return acc;
}

/** Apply ONE tether to a hydrated component scope: resolve/create the channel,
 *  seed it iff this is the first `sets:` and nothing was explicitly written yet,
 *  then REPLACE the component's field with the channel accessor (write-guarded
 *  for `reads:`). */
function applyTether(ch: Channel, scope: Record<string, unknown>, t: TetherSpec, sel: string): void {
  if (t.v === "sets") {
    if (!ch.seeded && !ch.written) {
      // seed from the origin's CURRENT value (the field is normally a signal
      // accessor; a plain value seeds as-is). Bypasses the `written` flag: a seed
      // is not an explicit write, so a genuinely-first sets: still seeds cleanly
      // even when a reads:/edits: tethered (and adopted `undefined`) before it.
      const cur = scope[t.f];
      ch.raw.set(isSignal(cur) ? cur.value : cur);
    }
    ch.seeded = true; // non-first sets: adopts like edits: — never reseeds
  }
  scope[t.f] = t.v === "reads" ? readGuard(ch, sel, t) : ch.acc;
}

/** Tether a hydrating island's own declared verbs (its `__wiring` props-bridge
 *  entry, collected at compile time from the DECLARING template). Called by
 *  hydrateIsland before the first effect render. */
export function tetherIsland(el: Element, scope: Record<string, unknown>, wiring: WiringSpec, sel: string): void {
  const region = regionOf(regionKeyFor(el));
  for (const t of wiring.t ?? []) {
    applyTether(channelOf(region, wiring.o ?? "", t.c), scope, t, sel);
  }
}

// a data-wire token: verb:localName=channelName (identifiers only — see render.ts)
const WIRE_TOKEN = /^(sets|reads|edits):([A-Za-z_$][\w$-]*)=([A-Za-z_$][\w$]*)$/;

/** OUTLET FORWARDING (spec §3): when the island hydrating is the PAGE mounted
 *  directly under a forwarding <sprig-outlet> (`<router-outlet reads:org>`), each
 *  forwarded tether whose LOCAL name matches one of the page's own SIGNAL fields
 *  tethers that field to the channel the outlet's DECLARING template owns. A page
 *  without a matching signal is untouched; an island nested INSIDE the page (another
 *  island host between it and the outlet) is never forwarded. */
export function forwardTethers(el: Element, scope: Record<string, unknown>, sel: string): void {
  const outlet = el.closest?.("sprig-outlet");
  if (!outlet) return;
  const spec = outlet.getAttribute("data-wire");
  if (!spec) return;
  // only the page ROOT island mounted in the outlet is forwarded — not islands the
  // page composes inside itself.
  const enclosing = el.parentElement?.closest?.("sprig-island");
  if (enclosing && outlet.contains(enclosing)) return;
  const owner = outlet.getAttribute("data-wire-owner") ?? "";
  // the channel lives in the OUTLET's own region (the render tree that declared the
  // outlet — usually the shell/root), NOT in the outlet's content region: that is
  // what lets the value survive the page swap.
  const region = regionOf(outlet.parentElement ? regionKeyFor(outlet.parentElement) : null);
  for (const token of spec.split(/\s+/)) {
    const m = WIRE_TOKEN.exec(token);
    if (!m) continue;
    const [, v, local, channel] = m;
    if (!isSignal(scope[local])) continue; // no matching signal → the page is untouched
    applyTether(
      channelOf(region, owner, channel),
      scope,
      { v: v as TetherSpec["v"], f: local, c: channel },
      sel,
    );
  }
}

/** Drop every channel region whose outlet-content was discarded: the region keyed
 *  by an outlet at/inside `root` (soft-nav is about to replace its innerHTML), or by
 *  an already-detached outlet. Channels declared by templates mounted INSIDE that
 *  outlet die here (page-scoped channels die on navigation); the root region — and
 *  any region above the swap point — retains its channels and their last written
 *  values. Called from hydrate.ts teardownInside. */
export function teardownWiringInside(root: ParentNode | null): void {
  for (const key of [...regions.keys()]) {
    if (key === null) continue; // the root region lives as long as the document
    if (!key.isConnected || (root != null && (root === (key as unknown as ParentNode) || root.contains(key)))) {
      regions.delete(key);
    }
  }
}

/** Test-only: forget every channel region (a fresh document). */
export function resetWiring(): void {
  regions.clear();
}
