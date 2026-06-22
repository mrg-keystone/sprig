// ─────────────────────────── async server render (spike) ───────────────────────────
// Phase 1 of "render as fast as humanly possible". This is the ALGORITHM the production
// server renderer will adopt, validated standalone first (render-async.test.ts) so it
// never destabilizes the existing sync renderNodes (which the client re-render shares).
//
// The model: a component tree where each component may have an async onServerInit (a
// data fetch). We compare three strategies and MEASURE them:
//   1. sequential  — the naive depth-first waterfall (what a naive async traversal does)
//   2. parallel    — await own init, then render children concurrently (Promise.all);
//                    independent siblings overlap, real parent→child deps stay ordered
//   3. streaming   — flush the shell + placeholders on the FIRST byte, then stream each
//                    child subtree in out-of-order as it resolves (time-to-first-byte ≈ 0)
//
// The floor any of these can reach is the longest chain of truly-dependent fetches —
// nothing accidental should be serialized beyond that.

export interface CompSpec {
  name: string;
  /** onServerInit latency in ms (a fetch). Omit/0 = instant. */
  delay?: number;
  children?: CompSpec[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A component's async server setup — the awaited `onServerInit` (a fetch). Must finish
 *  before the component renders, or the template reads stale field-init values. */
async function onServerInit(c: CompSpec): Promise<void> {
  if (c.delay) await sleep(c.delay);
}

/** 1. Naive waterfall: await each component's init depth-first, in order. Even
 *  independent siblings are serialized — this is the slow default to beat. */
export async function renderSequential(c: CompSpec): Promise<string> {
  await onServerInit(c);
  let inner = "";
  for (const child of c.children ?? []) inner += await renderSequential(child);
  return `<${c.name}>${inner}</${c.name}>`;
}

/** 2. Parallel: await THIS component's init (its children's inputs may depend on it),
 *  then render all children concurrently. Independent siblings overlap; a genuine
 *  parent→child data dependency stays ordered because a child's init can't begin until
 *  the parent's init has resolved. The critical path collapses to the deepest real chain. */
export async function renderParallel(c: CompSpec): Promise<string> {
  await onServerInit(c);
  const kids = await Promise.all((c.children ?? []).map(renderParallel));
  return `<${c.name}>${kids.join("")}</${c.name}>`;
}

export interface StreamStats {
  firstByteMs: number;
  totalMs: number;
  chunks: number;
}

/** 3. Streaming: flush the shell + a placeholder per child on the first byte (TTFB ≈ 0),
 *  resolve children concurrently, and stream each subtree in as it finishes — out of
 *  order, each with a marker the client swaps into its slot. A slow child delays only
 *  its own hole, never the byte stream or its siblings. */
export async function renderStreaming(
  root: CompSpec,
  write: (chunk: string) => void,
): Promise<StreamStats> {
  const start = performance.now();
  let firstByteMs = -1;
  let chunks = 0;
  const emit = (s: string) => {
    if (firstByteMs < 0) firstByteMs = performance.now() - start;
    chunks++;
    write(s);
  };

  await onServerInit(root); // the shell's own data — usually instant
  const kids = root.children ?? [];
  // FIRST BYTE: the shell + placeholders go out immediately, before any child resolves
  emit(`<${root.name}>` + kids.map((k, i) => `<slot id="${root.name}.${i}" data-for="${k.name}"></slot>`).join("") + `</${root.name}>`);

  // resolve every child subtree concurrently; stream each in the instant it's ready
  await Promise.all(kids.map(async (k, i) => {
    const html = await renderParallel(k);
    emit(`<template data-fill="${root.name}.${i}">${html}</template>`);
  }));

  return { firstByteMs, totalMs: performance.now() - start, chunks: chunks };
}
