import { Backend, currentInjector, inject, Injectable, setResponseStatus } from "@sprig/core";

/** Board-domain reads. A thin, injectable service over the keep in-process Backend
 *  (no token, no TCP) — pages' resolve.ts inject this instead of touching Backend.
 *  Scope "server": it injects the server-only Backend, so it can only ever be
 *  constructed during SSR — declaring it "both" was a false contract (bug #62). */
@Injectable({ scope: "server" })
export class BoardService {
  #be = inject(Backend);
  // Captured synchronously at construction (while the request injector is active),
  // so a later async lookup can still report a not-found status to bootstrap.fetch.
  #req = currentInjector();

  async board(): Promise<unknown> {
    const { data } = await this.#be.get("/http/board", { method: "POST" });
    return data ?? null;
  }

  async dashboard(): Promise<unknown> {
    const { data } = await this.#be.get("/http/dashboard", { method: "POST" });
    return data ?? null;
  }

  async issue(issueId: string): Promise<unknown> {
    const { ok, data } = await this.#be.get("/http/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId }),
    });
    // A missing/invalid single resource must surface as HTTP 404, not a 200 page.
    if (!ok || data == null) setResponseStatus(this.#req, 404);
    return data ?? null;
  }
}
