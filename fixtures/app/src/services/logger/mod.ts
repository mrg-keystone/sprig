import { Injectable } from "@sprig/core";

/**
 * Isomorphic service (scope "both"): injectable during SSR *and* inside hydrated islands.
 * Each side gets its own instance — there is no shared state across the wire.
 */
@Injectable({ scope: "both", providedIn: "root" })
export class Logger {
  debug(...args: unknown[]): void {
    console.debug("[sprig]", ...args);
  }
  info(...args: unknown[]): void {
    console.info("[sprig]", ...args);
  }
}
