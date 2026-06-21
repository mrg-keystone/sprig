import { Injectable, inject } from "@sprig/core";
import { Logger } from "../logger/mod.ts";

export interface User {
  id: string;
  name: string;
  bio: string;
  role: "owner" | "maintainer" | "contributor";
  /** a hex colour for the avatar fallback (drives [style.--avatar] / [style.background]). */
  color: string;
  /** arbitrary profile facts, iterated in the profile via the `keyvalue` pipe. */
  facts: Record<string, string>;
}

/**
 * scope "server": the data source. In a real app it calls the in-process keep backend (no
 * network hop, no token). It is resolved during SSR — e.g. in shell/components/user/resolve.ts — and its
 * result is serialized to the island as an @input. Trying to inject() it inside island code
 * throws (DI does not cross the wire); that's the boundary working as intended.
 *
 * Note: a service may itself inject() other services — here Logger — resolved from the same
 * injector that created this instance.
 */
@Injectable({ scope: "server", providedIn: "root" })
export class UserService {
  #log = inject(Logger);
  #users: User[] = [
    {
      id: "ada",
      name: "Ada Lovelace",
      bio: "Wrote the first algorithm intended for a machine.",
      role: "owner",
      color: "#7c3aed",
      facts: { Pronouns: "she/her", Timezone: "GMT", Joined: "2026-01-04" },
    },
    {
      id: "alan",
      name: "Alan Turing",
      bio: "Formalised computation and the Turing machine.",
      role: "maintainer",
      color: "#2563eb",
      facts: { Pronouns: "he/him", Timezone: "GMT", Joined: "2026-01-11" },
    },
    {
      id: "grace",
      name: "Grace Hopper",
      bio: "Pioneered machine-independent programming languages.",
      role: "maintainer",
      color: "#059669",
      facts: { Pronouns: "she/her", Timezone: "EST", Joined: "2026-02-02" },
    },
  ];

  all(): User[] {
    return this.#users;
  }
  byId(id: string): User | undefined {
    this.#log.debug("UserService.byId", id);
    return this.#users.find((u) => u.id === id);
  }
  /** Resolve a set of ids to users (for issue assignees → <avatar-stack>). */
  byIds(ids: string[]): User[] {
    return ids.map((id) => this.byId(id)).filter((u): u is User => u !== undefined);
  }
}
