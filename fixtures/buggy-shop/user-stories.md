# User stories

- Visit `/` and see the live store stats (orders today, revenue) — real numbers from the backend
- Visit `/product/:id` for a real product (e.g. `sku-1`) and see its name, blurb, and price
- Request `/product/:id` for an unknown id → see a "not found" page AND get HTTP 404 (not a soft 200)
- On a product page, click "Add to cart" → the quantity badge increments
- Submit the contact form with a valid email → land on `/contact/thanks` (303 redirect) with a success message
- Submit the contact form with a missing/invalid email → stay on `/contact` with an inline error (HTTP 422)
- Scroll the home page → the decorative parallax dots move smoothly, no jank
