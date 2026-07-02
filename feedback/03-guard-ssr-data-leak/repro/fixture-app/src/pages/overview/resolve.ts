// The protected page's data loader. It reads real records through the trusted
// in-process Backend (serveSprig binds it per request; here the repro binds a fake
// one). resolve() receives ONLY { params, url } — no headers, no cookie — so it
// cannot re-check auth and defensively withhold data. It runs whenever the guard
// let the request through.
import { Backend, inject, type ResolveCtx } from "@sprig/core";

// deno-lint-ignore no-unused-vars
export async function resolve(ctx: ResolveCtx): Promise<Record<string, unknown>> {
  const { data } = await inject(Backend).get<{ calls: unknown[] }>("/overview");
  return { calls: data?.calls ?? [] };
}
