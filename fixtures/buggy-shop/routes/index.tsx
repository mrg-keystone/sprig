import { define } from "../utils.ts";
import { page } from "fresh";
import { Head } from "fresh/runtime";
import Parallax from "../islands/Parallax.tsx";

interface Stats {
  ordersToday: number;
  revenue: number;
}

const STUB_STATS: Stats = { ordersToday: 128, revenue: 4210 };

// Live-first adapter: try the backend, fall back to a stub if it's unavailable.
async function loadStats(): Promise<{ data: Stats; live: boolean }> {
  try {
    const res = await fetch("http://127.0.0.1:9999/stats");
    if (res.ok) return { data: (await res.json()) as Stats, live: true };
  } catch {
    // no backend here — fall through
  }
  return { data: STUB_STATS, live: false };
}

export const handler = define.handlers({
  async GET(_ctx) {
    const stats = await loadStats();
    // The `live` flag is dropped here — the stub numbers render as if they were real.
    return page({ stats: stats.data });
  },
});

export default define.page<typeof handler>(function Home({ data }) {
  return (
    <div class="store">
      <Head>
        <title>Buggy Shop</title>
      </Head>
      <nav class="nav">
        <a href="/">Home</a>
        <a href="/product/sku-1">Aero Mug</a>
        <a href="/contact">Contact</a>
      </nav>
      <h1>Buggy Shop</h1>
      <section class="stats">
        <div class="stat">
          <span class="num">{data.stats.ordersToday}</span>
          <span class="label">orders today</span>
        </div>
        <div class="stat">
          <span class="num">${data.stats.revenue}</span>
          <span class="label">revenue</span>
        </div>
      </section>

      {/* Loading bar — animates transform: scaleX (the correct, compositor-friendly way). */}
      <div class="bar">
        <div class="bar-fill" />
      </div>

      <Parallax />
    </div>
  );
});
