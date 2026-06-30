// Adding this logic.ts makes the folder an ISLAND, so the template's
// (click)="like()" hydrates and fires on the client. Pure client state via a
// signal — no server write, so no optimistic pattern needed. Mirrors the
// healthy counter island (src/islands/counter/logic.ts).
import { signal } from "@sprig/core";

export default class LikeButton {
  count = signal(0);
  like() {
    this.count.set(this.count() + 1);
  }
}
