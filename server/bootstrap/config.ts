// App configuration (dev-owned): created once by rune sync, never
// overwritten. Centralize environment reads here so the rest of the app
// stays env-free.

export const config = {
  port: Number(Deno.env.get("PORT") ?? 3000),
};
