// The demo's auth state. MODULE-SCOPE on purpose: one shared login for the whole
// process, so the fixture needs no cookies or backend — click "log in" and every
// subsequent request sees it. A real app would key the session off the request
// (cookie → session store) inside a service shaped exactly like this one.
import { Injectable } from "@sprig/core";

let currentUser: string | null = null;

@Injectable()
export class Session {
  get user(): string | null {
    return currentUser;
  }
  login(name: string): void {
    currentUser = name;
  }
  logout(): void {
    currentUser = null;
  }
}
