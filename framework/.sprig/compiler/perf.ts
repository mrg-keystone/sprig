// Hidden INFRA performance reporting (env-gated; deliberately not part of the
// public sprig API or docs). When the hosting infrastructure sets INFRA_PERF=true,
// every SSR'd document ships a tiny inline <head> script that reports page-load
// timing to INFRA_PERF_URL as two fire-and-forget POSTs joined by one navId:
//   #1 fires the instant the <head> starts executing, stamped with
//      performance.timeOrigin — the moment the browser actually STARTED the
//      navigation, so the pair's delta covers network + SSR + render;
//   #2 fires on the window "load" event, stamped with that moment.
// The payload is exactly this shape (infra joins the pair on navId; the earlier
// timestamp is nav-start, the later is page-loaded):
//   { "timestamp": <ISO date>, "navId": <random id>,
//     "route": <location.pathname>, "infra-app-id": <INFRA_APP_ID> }
// SOFT navigations swap the outlet without executing any of the fetched document's
// scripts, so their pair is fired by the client runtime instead — hydrate.ts reads
// the endpoint off __sprig_config.perf (stamped by documentTail when enabled).

export interface PerfConfig {
  /** the collector endpoint (INFRA_PERF_URL) */
  url: string;
  /** the reporting app's identity (INFRA_APP_ID; "" when unset) */
  app: string;
}

/** the env surface perfConfig reads — injectable so tests don't mutate Deno.env */
type EnvReader = { get(key: string): string | undefined };

// INFRA_PERF=true without a URL is a misconfiguration worth surfacing, but only
// once — silent degradation is how the frozen-?v=dev cache bug went unnoticed.
let warnedNoUrl = false;

/** Read the INFRA perf env gate. Enabled iff INFRA_PERF is "true"/"1" (case-
 *  insensitive) AND INFRA_PERF_URL is set; a missing INFRA_APP_ID degrades to "".
 *  A process without env permission (or any env read failure) means OFF — hidden
 *  telemetry must never crash SSR. */
export function perfConfig(env: EnvReader = Deno.env): PerfConfig | null {
  let on: string | undefined, url: string | undefined, app: string | undefined;
  try {
    on = env.get("INFRA_PERF");
    url = env.get("INFRA_PERF_URL");
    app = env.get("INFRA_APP_ID");
  } catch {
    return null; // no --allow-env → the feature is simply off
  }
  const flag = (on ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return null;
  if (!url) {
    if (!warnedNoUrl) {
      warnedNoUrl = true;
      console.warn("[sprig] INFRA_PERF is enabled but INFRA_PERF_URL is not set — perf reporting stays off.");
    }
    return null;
  }
  return { url, app: app ?? "" };
}

/** JSON-embed a string for an inline <script>, escaping "<" so a value containing
 *  "</script>" can never terminate the tag early (the __sprig_config convention). */
function js(v: string): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

/** The inline <head> script covering full document loads ("" when disabled). One
 *  script does both reports so the navId lives in a closure and is trivially
 *  identical for the pair. It must be emitted BEFORE the stylesheet <link> — an
 *  inline script after a pending stylesheet blocks on the CSSOM, which would delay
 *  beacon #1 behind the CSS download. Transport is sendBeacon with a plain JSON
 *  string (text/plain → a "simple" request: no CORS preflight between the page and
 *  a cross-origin collector, and delivery survives an early tab close), with a
 *  keepalive no-cors fetch fallback. Everything is try-wrapped — telemetry must
 *  never break a page. */
export function perfHeadSnippet(cfg: PerfConfig | null): string {
  if (!cfg) return "";
  return `\n  <script>(function(){try{var u=${js(cfg.url)},p=${js(cfg.app)},` +
    `n=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36),` +
    `r=location.pathname,` +
    `s=function(t){try{var b=JSON.stringify({timestamp:t,navId:n,route:r,"infra-app-id":p});` +
    `if(navigator.sendBeacon)navigator.sendBeacon(u,b);` +
    `else fetch(u,{method:"POST",body:b,keepalive:true,mode:"no-cors"}).catch(function(){})}catch(e){}};` +
    `s(new Date(self.performance&&performance.timeOrigin||Date.now()).toISOString());` +
    `addEventListener("load",function(){s(new Date().toISOString())},{once:true})}catch(e){}})()</script>`;
}
