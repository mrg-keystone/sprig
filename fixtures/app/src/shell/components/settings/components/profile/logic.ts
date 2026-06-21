import { computed, defineComponent, signal } from "@sprig/core";

// Island in the settings 'panel' named outlet: a profile FORM showcasing template-driven
// forms (#ctrl="ngModel" exportAs), [ngClass]/[ngStyle]/[(ngModel)], and a child <star-rating>.
export default defineComponent({
  setup: (_ctx) => {
    const name = signal("Ada");
    const density = signal("comfortable");
    const notify = signal(true);
    const rating = signal(5);
    const saved = signal(false);
    const densities = computed(() => ["comfortable", "compact"]);
    const save = () => {
      saved.value = true;
    };
    const setDensity = (d: string) => {
      density.value = d;
    };
    const onRate = (n: number) => {
      rating.value = n;
    };
    return { name, density, notify, rating, saved, densities, save, setDensity, onRate };
  },
});
