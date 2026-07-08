// Login island — demo of sprig's BUILT-IN auth (login/getUserData/logout/warmAuth,
// re-exported from @mrg-keystone/sprig). All state is signals so the template swaps
// to "login works" client-side the moment the popup resolves.
import { AuthError, getUserData, login, logout, signal, warmAuth } from "@mrg-keystone/sprig";

type Profile = { name: string; email: string };

export default class Login {
  user = signal<Profile | null>(null);
  error = signal("");
  busy = signal(false);

  onBrowserInit() {
    warmAuth(); // preload Firebase SDK + config so the click opens the popup fast
    // Existing session? /auth/me resolves the httpOnly cookie server-side.
    void getUserData().then((u) => {
      if (u) this.user.set({ name: u.name, email: u.email });
    });
  }

  async doLogin() {
    this.error.set("");
    this.busy.set(true);
    try {
      // A popup flow's result is unknowable client-side — this is the legitimate await-first case.
      this.user.set(await login());
    } catch (e) {
      this.error.set(e instanceof AuthError ? e.message : "Sign-in failed. Try again.");
    } finally {
      this.busy.set(false);
    }
  }

  doLogout() {
    // Optimistic: show the signed-out view immediately; logout() is idempotent and never throws.
    this.user.set(null);
    this.error.set("");
    void logout();
  }
}
