/// <reference lib="dom" />
// Dev-only HMR client (bundled into client.js by `sprig build --dev`, started by the
// dev loader BEFORE islands hydrate). Opens an SSE channel to the dev server and
// applies updates in place — no Vite, no bundler module graph:
//   template → hotTemplate(): swap the island's AST, keep its scope → STATE PRESERVED
//   css      → bump every <link rel=stylesheet> href → repaint, zero JS, zero state
//   reload   → full reload (a logic/server/runtime change the dev server already rebuilt)
import { enableHmr, hotTemplate } from "./hydrate.ts";
import type { SerializedTemplate } from "./serialize.ts";

interface HmrMsg {
  type: "template" | "css" | "reload" | "error";
  sel?: string;
  template?: SerializedTemplate;
  v?: string;
  message?: string;
}

export function startHmr(base: string): void {
  enableHmr(); // must run before bootstrapIslands so islands register as live instances
  const es = new EventSource(`${base}/_sprig/hmr`);
  es.onmessage = (e: MessageEvent) => {
    const msg = JSON.parse(e.data) as HmrMsg;
    if (msg.type === "template" && msg.sel && msg.template) {
      hotTemplate(msg.sel, msg.template);
      log(`template ↻ ${msg.sel} (state kept)`);
    } else if (msg.type === "css") {
      swapCss(msg.v ?? String(performance.now()));
      log("css ↻");
    } else if (msg.type === "reload") {
      log("reload");
      location.reload();
    } else if (msg.type === "error") {
      console.error("[sprig hmr]", msg.message);
    }
  };
  // EventSource auto-reconnects; on dev-server restart the page just resumes.
  es.onopen = () => log("connected");
}

function swapCss(v: string): void {
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
    const u = new URL(link.href);
    u.searchParams.set("v", v);
    link.href = u.toString();
  });
}

function log(m: string): void {
  console.info(`%c[sprig hmr]%c ${m}`, "color:#7c3aed;font-weight:bold", "color:inherit");
}
