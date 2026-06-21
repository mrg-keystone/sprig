import { Injectable, signal, type WritableAccessor } from "@sprig/core";

export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";

/**
 * scope "client": a DOM-only store that lives only in hydrated islands. It is NOT resolvable
 * during SSR — injecting it on the server throws (the boundary working as intended). Because it
 * is providedIn:"root", every island shares the one client-root instance, so a theme change in
 * <theme-toggle> is observed by any other island reading the same signal.
 */
@Injectable({ scope: "client", providedIn: "root" })
export class Prefs {
  readonly theme: WritableAccessor<Theme> = signal<Theme>("light");
  readonly density: WritableAccessor<Density> = signal<Density>("comfortable");

  toggleTheme(): void {
    this.theme.set(this.theme() === "light" ? "dark" : "light");
  }
  setDensity(d: Density): void {
    this.density.set(d);
  }
}
