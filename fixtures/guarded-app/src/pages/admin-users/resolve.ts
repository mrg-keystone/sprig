// This page declares NO guard of its own — requireAuth ran because the parent
// `admin` route carries it (guards protect the whole subtree).
import { inject, type Resolve } from "@mrg-keystone/sprig";
import { Session } from "../../services/session.ts";

export const resolve: Resolve = () => ({
  user: inject(Session).user,
  members: ["ada", "bob", "admin"],
});
