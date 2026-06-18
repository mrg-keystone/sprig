import "reflect-metadata";
// App bootstrap (dev-owned): created once by rune sync, never overwritten —
// tune the app name, port, or keep options freely. The module registry
// (bootstrap/modules.ts) is regenerated as runes are added and removed.

import { bootstrapServer } from "@mrg-keystone/keep";
import { config } from "@/bootstrap/config.ts";
import { modules } from "@/bootstrap/modules.ts";

export const api = await bootstrapServer("server", modules, { port: config.port });

if (import.meta.main) {
  await api.listen();
  console.log(
    `server on http://localhost:${config.port} — emulator at /docs/<module>`,
  );
}
