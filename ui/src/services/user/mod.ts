import { Backend, currentInjector, inject, Injectable, setResponseStatus } from "@sprig/core";

/** User-domain reads, over the keep in-process Backend. Scope "server": it injects
 *  the server-only Backend, so it can only be constructed during SSR (bug #62). */
@Injectable({ scope: "server" })
export class UserService {
  #be = inject(Backend);
  #req = currentInjector();

  async profile(userId: string): Promise<unknown> {
    const { ok, data } = await this.#be.get("/http/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    // A missing/invalid user must surface as HTTP 404, not a 200 page.
    if (!ok || data == null) setResponseStatus(this.#req, 404);
    return data ?? null;
  }
}
