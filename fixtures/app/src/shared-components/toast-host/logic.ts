import { defineComponent, inject } from "@sprig/core";
import { Notify } from "../../services/notify/mod.ts";

// Island: injects the CLIENT-scoped Notify bus and renders its toast queue.
export default defineComponent(() => {
  const notify = inject(Notify);
  const toasts = notify.toasts;
  const dismiss = (id: number) => notify.dismiss(id);
  const onDone = (_e: unknown) => {};
  return { toasts, dismiss, onDone };
});
