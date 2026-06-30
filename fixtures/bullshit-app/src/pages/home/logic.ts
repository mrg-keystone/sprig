// A page is its template + this class. onServerInit runs on the server before the
// page renders — set fields here (fetch data via inject(Backend)) and the template
// binds to them. The instance is snapshotted to the browser; onBrowserInit runs there.
import { inject } from "@sprig/core";
import State from "../../services/state/mod.ts";

export default class Home {
  name = "(loading…)";
  state = inject(State); // persisted across navigation + reload

  onServerInit() {
    this.name = "sprig";
  }
}
