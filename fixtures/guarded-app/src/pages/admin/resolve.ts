// requireAuth already ran (same request, same route injector), so Session here
// is the instance the guard vouched for — user is never empty on this page.
import { inject, type Resolve } from "@sprig/core";
import { Session } from "../../services/session.ts";

export const resolve: Resolve = () => ({ user: inject(Session).user });
