import { inject, type Resolve, type ResolveCtx } from "@sprig/core";
import { UserService } from "../../services/user/mod.ts";

export const resolve: Resolve = async (ctx: ResolveCtx) => {
  const user = inject(UserService);
  return { profile: await user.profile(ctx.params.id), id: ctx.params.id };
};
