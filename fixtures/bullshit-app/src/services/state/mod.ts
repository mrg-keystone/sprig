// Your app's persisted state. Add serializable fields and inject(State) anywhere
// (pages, islands). The framework serializes it to localStorage on every navigation
// and on reload, and restores it on load — so state survives both. state.reset()
// restores these defaults AND clears the saved copy in localStorage.
import { Injectable, StateService } from "@sprig/core";

@Injectable({ providedIn: "root", scope: "both" })
export default class State extends StateService {
  static key = "app"; // stable localStorage key (class names are minified in prod)
  count = 0;
}
