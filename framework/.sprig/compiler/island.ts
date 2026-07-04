// Builds the ComponentCtx an island's setup() receives. On the SERVER the inputs
// are static (initial SSR); the client hydrate runtime builds an equivalent ctx
// with the bridge inputs and live output wiring.
import { type Accessor, type ComponentCtx, Injector, runInInjector, signal, type WritableAccessor } from "@mrg-keystone/sprig";
import type { Scope } from "./expr.ts";

/** Run an island's setup() with a fresh SERVER component injector active, so
 *  `inject()` resolves inside setup() (scope "both"/"server" services) instead of
 *  throwing — matching the documented DI contract and the inject() error message.
 *  Without this wrap, `current` is undefined during SSR setup() and every inject()
 *  in an island throws (uncaught → HTTP 500). A child("component") injector mirrors
 *  the root → route → component hierarchy. */
export function withServerInjector<T>(fn: () => T): T {
  return runInInjector(new Injector("server", "root").child("component"), fn);
}

export function makeServerCtx(inputs: Scope, emit?: (name: string, value: unknown) => void): ComponentCtx {
  return {
    input<T>(name: string, fallback?: T): Accessor<T> {
      return signal((name in inputs ? inputs[name] : fallback) as T) as Accessor<T>;
    },
    output<T = void>(name: string): (value: T) => void {
      return (value: T) => emit?.(name, value);
    },
    model<T>(name: string, fallback?: T): WritableAccessor<T> {
      return signal((name in inputs ? inputs[name] : fallback) as T);
    },
  };
}
