export default function AddToCart() {
  // `qty` is a plain local variable, not a signal — clicking mutates it but never
  // triggers a re-render, so the badge is stuck at 1.
  let qty = 1;
  return (
    <div class="cart">
      <button id="add" type="button" onClick={() => { qty += 1; }}>
        Add to cart
      </button>
      <span id="qty" class="badge">{qty}</span>
    </div>
  );
}
