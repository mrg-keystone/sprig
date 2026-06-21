import { Injectable, signal, type WritableAccessor } from "@sprig/core";

export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/**
 * scope "client": a toast bus shared by every island (providedIn:"root" → one client-root
 * instance). Any island can push(); <toast-host> in the shell renders the queue and dismisses.
 * Lives client-side only, so it is never resolvable during SSR.
 */
@Injectable({ scope: "client", providedIn: "root" })
export class Notify {
  readonly toasts: WritableAccessor<Toast[]> = signal<Toast[]>([]);
  #seq = 0;

  push(kind: ToastKind, text: string): void {
    this.toasts.update((list) => [...list, { id: ++this.#seq, kind, text }]);
  }
  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
