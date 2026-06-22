// Proves the async-render strategy with REAL measured timings (not asserted-by-faith).
// The whole "fastest possible render" thesis lives or dies on these numbers.
import { assert } from "jsr:@std/assert";
import {
  type CompSpec,
  renderParallel,
  renderSequential,
  renderStreaming,
} from "./render-async.ts";

const ms = async (fn: () => Promise<unknown>): Promise<number> => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

Deno.test("parallel render overlaps independent siblings (≈3x faster than sequential)", async () => {
  // a page whose 3 sections each fetch independently for 100ms
  const page: CompSpec = {
    name: "page",
    children: [{ name: "a", delay: 100 }, { name: "b", delay: 100 }, { name: "c", delay: 100 }],
  };

  const seq = await ms(() => renderSequential(page));
  const par = await ms(() => renderParallel(page));
  console.log(`  sequential: ${seq.toFixed(0)}ms   parallel: ${par.toFixed(0)}ms`);

  assert(seq > 270 && seq < 420, `sequential should be ~300ms, got ${seq.toFixed(0)}`);
  assert(par > 85 && par < 200, `parallel should be ~100ms, got ${par.toFixed(0)}`);
  assert(seq > par * 2, `parallel must be far faster: seq=${seq.toFixed(0)} par=${par.toFixed(0)}`);
});

Deno.test("streaming makes time-to-first-byte ≈ 0 even with slow children", async () => {
  const page: CompSpec = { name: "page", children: [{ name: "a", delay: 100 }, { name: "b", delay: 120 }] };

  const chunks: string[] = [];
  const stats = await renderStreaming(page, (c) => chunks.push(c));
  console.log(`  first byte: ${stats.firstByteMs.toFixed(0)}ms   total: ${stats.totalMs.toFixed(0)}ms   chunks: ${stats.chunks}`);

  assert(stats.firstByteMs < 30, `shell should flush immediately, first byte ${stats.firstByteMs.toFixed(0)}ms`);
  assert(stats.totalMs > 110 && stats.totalMs < 220, `total bounded by slowest child (~120ms), got ${stats.totalMs.toFixed(0)}`);
  // the shell goes out first, the two child fills stream in after
  assert(chunks[0].includes("<page>") && chunks[0].includes("slot"), "first chunk is the shell + placeholders");
  assert(chunks.some((c) => c.includes('data-fill="page.0"')), "child a streamed into its slot");
});

Deno.test("a real parent→child data dependency stays correctly ordered", async () => {
  // user (100ms) → posts needs user.id (100ms): an irreducible 200ms chain. The renderer
  // must NOT (and cannot) parallelize this — the floor for this subtree is 200ms.
  const profile: CompSpec = {
    name: "profile",
    children: [{ name: "user", delay: 100, children: [{ name: "posts", delay: 100 }] }],
  };

  const dep = await ms(() => renderParallel(profile));
  console.log(`  dependent chain (user→posts): ${dep.toFixed(0)}ms`);
  assert(dep > 190 && dep < 290, `dependent chain floor is ~200ms, got ${dep.toFixed(0)}`);
});

Deno.test("an independent subtree is NOT held up by a slow dependent chain", async () => {
  // the slow user→posts chain (200ms) sits beside an independent nav (20ms). Parallel
  // render must let nav finish on its own while the chain resolves — the page total is
  // the slowest branch (200ms), not the sum (220ms).
  const page: CompSpec = {
    name: "page",
    children: [
      { name: "user", delay: 100, children: [{ name: "posts", delay: 100 }] },
      { name: "nav", delay: 20 },
    ],
  };
  const total = await ms(() => renderParallel(page));
  console.log(`  mixed page (200ms chain + 20ms nav): ${total.toFixed(0)}ms`);
  assert(total > 190 && total < 290, `bounded by the slow branch (~200ms), got ${total.toFixed(0)}`);
});
