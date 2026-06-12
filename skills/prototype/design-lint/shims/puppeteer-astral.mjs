/**
 * Puppeteer-compatible shim backed by Astral (Deno-native headless Chrome).
 *
 * The vendored impeccable engine calls `import('puppeteer')` for URL scanning.
 * deno.json's import map aliases the bare specifier "puppeteer" to this file,
 * so the engine source stays byte-for-byte identical to upstream while running
 * under Deno with no npm/node_modules.
 *
 * Only the Puppeteer surface the engine actually uses is implemented:
 *   default.launch({ headless, args }) -> Browser
 *   Browser.newPage() -> Page
 *   Browser.close()
 *   Page.setViewport({ width, height })
 *   Page.goto(url, { waitUntil, timeout })
 *   Page.evaluate(fnOrString, ...args)
 *   Page.screenshot({ encoding, clip, captureBeyondViewport }) -> base64 string
 *   Page.close()
 */
import { launch } from "@astral/astral";

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function wrapPage(astralPage) {
  return {
    _astral: astralPage,

    // Astral fixes viewport at newPage time; best-effort resize if available.
    async setViewport(viewport) {
      try {
        if (typeof astralPage.setViewportSize === "function") {
          await astralPage.setViewportSize(viewport);
        }
      } catch { /* viewport is advisory for the detector */ }
    },

    async goto(url, options = {}) {
      const waitUntil = options.waitUntil === "networkidle0" ||
          options.waitUntil === "networkidle2"
        ? "networkidle0"
        : "load";
      return astralPage.goto(url, { waitUntil });
    },

    // Puppeteer: evaluate(fn, arg1, arg2). Astral: evaluate(fn, { args }).
    // A raw string (the injected browser bundle) is evaluated as-is.
    async evaluate(fnOrString, ...args) {
      if (typeof fnOrString === "string") {
        return astralPage.evaluate(fnOrString);
      }
      return args.length
        ? astralPage.evaluate(fnOrString, { args })
        : astralPage.evaluate(fnOrString);
    },

    async screenshot(options = {}) {
      const opts = {};
      if (options.clip) {
        // Astral's CDP screenshot rejects a clip without `scale` (the response
        // comes back undefined and it throws while destructuring). Puppeteer
        // defaults scale to 1, so mirror that.
        opts.clip = {
          x: options.clip.x,
          y: options.clip.y,
          width: options.clip.width,
          height: options.clip.height,
          scale: options.clip.scale ?? 1,
        };
      }
      const bytes = await astralPage.screenshot(opts);
      return options.encoding === "base64" ? toBase64(bytes) : bytes;
    },

    async close() {
      try {
        await astralPage.close();
      } catch { /* page may already be gone */ }
    },
  };
}

function wrapBrowser(astralBrowser) {
  return {
    _astral: astralBrowser,
    async newPage() {
      const page = await astralBrowser.newPage();
      return wrapPage(page);
    },
    async close() {
      try {
        await astralBrowser.close();
      } catch { /* already closed */ }
    },
  };
}

const puppeteer = {
  async launch(options = {}) {
    const astralBrowser = await launch({
      headless: options.headless ?? true,
      args: options.args ?? [],
    });
    return wrapBrowser(astralBrowser);
  },
};

// detect-url.mjs uses `puppeteer.default.launch(...)`, matching the npm
// default-export shape under Node ESM interop.
export default puppeteer;
export { puppeteer };
