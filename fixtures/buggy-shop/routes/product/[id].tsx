import { define } from "../../utils.ts";
import { page } from "fresh";
import { Head } from "fresh/runtime";
import AddToCart from "../../islands/AddToCart.tsx";

interface Product {
  id: string;
  name: string;
  price: number;
  blurb: string;
}

// Read at request time (the correct pattern — edits show up without a restart).
async function loadProduct(id: string): Promise<Product | null> {
  const catalog = JSON.parse(
    await Deno.readTextFile(new URL("../../data/products.json", import.meta.url)),
  ) as Record<string, Product>;
  return catalog[id] ?? null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const product = await loadProduct(ctx.params.id);
    // A missing product renders a "not found" page — but with HTTP 200 (soft 404).
    return page({ product });
  },
});

export default define.page<typeof handler>(function ProductPage({ data }) {
  if (!data.product) {
    return (
      <div class="store">
        <Head>
          <title>Not found</title>
        </Head>
        <h1>Product not found</h1>
        <a href="/">&larr; Home</a>
      </div>
    );
  }
  const p = data.product;
  return (
    <div class="store">
      <Head>
        <title>{p.name}</title>
      </Head>
      <nav class="nav">
        <a href="/">Home</a>
      </nav>
      <h1>{p.name}</h1>
      <p class="blurb">{p.blurb}</p>
      <p class="price">${p.price}</p>
      <AddToCart />
    </div>
  );
});
