import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate } from "/Users/raphaelcastro/Documents/programming/tooling/sprig/framework/.sprig/compiler/parse.ts";
import { renderNodes, type Handler } from "/Users/raphaelcastro/Documents/programming/tooling/sprig/framework/.sprig/compiler/render.ts";
import { componentsForPage, registerIslandSelectors } from "/Users/raphaelcastro/Documents/programming/tooling/sprig/framework/.sprig/compiler/hydrate.ts";

const doc = new DOMParser().parseFromString(`<html><body></body></html>`, "text/html")!;
Object.defineProperty(globalThis, "document", { configurable: true, value: doc });

const tplText = await Deno.readTextFile("/Users/raphaelcastro/Documents/programming/tooling/sprig/app/src/pages/workbench/components/workbench/template.html");
const tpl = await parseTemplate(tplText);
registerIslandSelectors({ workbench: "wbscope", "run-tests": "rt", "stage-bridge": "sb" });

const handlers: Handler[] = [];
const scope: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? () => (k === "nav" || k === "toasts" || k === "palItems" || k === "problems" || k === "vpModes" ? [] : k === "surface" || k === "activeCase" ? null : k === "running" || k === "palOpen" || k === "bannerOpen" || k === "kbd" || k === "grid" ? false : "") : undefined), has: () => true });
const html = renderNodes(named(tpl), { scope, registry: componentsForPage("workbench"), source: tpl.text, handlers, scopeAttr: "wbscope" });
const m = html.match(/<sprig-island[^>]*/g);
console.log("island shells in output:", m ? m.slice(0, 3) : "NONE");
