// SKELETON PLACEHOLDER — the real guestbook page (resolve { messages, signedCount },
// the composer→wall→toast optimistic loop, the §7 grid fix) is filled in by the
// component work per spec/ui/breakdown/pages/guestbook/guestbook.md.
//
// A page is its template + this class. onServerInit runs on the server before the page
// renders — set fields here (fetch data via inject(Backend)) and the template binds to
// them. The instance is snapshotted to the browser; onBrowserInit runs there.
//
// NOTE: a client-bundled logic.ts must import siblings with a RELATIVE path — the build
// bundler does not resolve the `$.` deno.json aliases inside a client island chunk.
import { inject } from "@sprig/core";
import State from "../../services/state/mod.ts";

export default class Guestbook {
  title = "(loading…)";
  state = inject(State); // persisted across navigation + reload

  onServerInit() {
    this.title = "Hearth";
  }
}
