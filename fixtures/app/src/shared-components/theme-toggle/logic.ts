import { computed, defineComponent, inject } from "@sprig/core";
import { Prefs } from "../../services/prefs/mod.ts";

// ISLAND: injects the CLIENT-scoped Prefs (resolvable only in hydrated islands).
// Reads the shared theme signal and flips it on click — every island sharing
// the client-root Prefs observes the change.
export default defineComponent(() => {
  const prefs = inject(Prefs);
  const isDark = computed(() => prefs.theme() === "dark");
  const toggle = () => prefs.toggleTheme();
  return { isDark, toggle };
});
