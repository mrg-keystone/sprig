import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { emitThemeCss } from "./build.ts";

Deno.test("emitThemeCss: utility tokens → @theme, the rest → :root", () => {
  const css = emitThemeCss({
    default: "brand",
    themes: {
      brand: {
        "color-scheme": "light",
        "--color-primary": "#5048E5",
        "--radius-box": "0.5rem",
        "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "--text-step-0": "0.9375rem",
        "--step-0": "1rem",
        "--dur-fast": "200ms",
        "--color-base-content-30": "color-mix(in oklch, var(--color-base-content) 30%, transparent)",
      },
    },
  });

  // namespaced + static → @theme (so Tailwind emits utilities)
  const themeBlock = css.slice(css.indexOf("@theme"), css.indexOf("}"));
  assertStringIncludes(themeBlock, "--color-primary: #5048E5;");
  assertStringIncludes(themeBlock, "--radius-box: 0.5rem;");
  assertStringIncludes(themeBlock, "--ease-standard: cubic-bezier(0.2, 0, 0, 1);");
  assertStringIncludes(themeBlock, "--text-step-0: 0.9375rem;");

  // non-namespace, var()-referencing, and color-scheme → :root
  assertStringIncludes(css, ":root {");
  assertStringIncludes(css, "color-scheme: light;");
  assertStringIncludes(css, "--step-0: 1rem;");
  assertStringIncludes(css, "--dur-fast: 200ms;");

  // the tint references var() → must NOT be hoisted into @theme
  assertEquals(themeBlock.includes("--color-base-content-30"), false);
  assertStringIncludes(css, "--color-base-content-30: color-mix(");
});

Deno.test("emitThemeCss: non-default themes become [data-theme] override blocks", () => {
  const css = emitThemeCss({
    default: "brand-dark",
    themes: {
      "brand-dark": { "color-scheme": "dark", "--color-primary": "#6366F1" },
      brand: { "color-scheme": "light", "--color-primary": "#5048E5" },
    },
  });
  assertStringIncludes(css, '[data-theme="brand"] {');
  assertStringIncludes(css, "color-scheme: light;");
  assertStringIncludes(css, "--color-primary: #5048E5;");
  // the default theme is the baseline (:root) — it never gets a [data-theme] block
  assertEquals(css.includes('[data-theme="brand-dark"]'), false);
});

Deno.test("emitThemeCss: a single theme needs no explicit default", () => {
  const css = emitThemeCss({ themes: { only: { "--color-primary": "#000" } } });
  assertStringIncludes(css, "@theme {");
  assertStringIncludes(css, "--color-primary: #000;");
});

Deno.test("emitThemeCss: rejects a non-variable key (governance)", () => {
  assertThrows(
    () => emitThemeCss({ themes: { brand: { background: "red" } } }),
    Error,
    "not allowed",
  );
});

Deno.test("emitThemeCss: rejects multiple themes with no default", () => {
  assertThrows(
    () => emitThemeCss({ themes: { a: { "--x": "1" }, b: { "--x": "2" } } }),
    Error,
    'no "default"',
  );
});

Deno.test("emitThemeCss: rejects a non-string value", () => {
  assertThrows(
    () => emitThemeCss({ themes: { brand: { "--x": 5 as unknown as string } } }),
    Error,
    "must be a string",
  );
});

Deno.test("emitThemeCss: rejects a default that names no theme", () => {
  assertThrows(
    () => emitThemeCss({ default: "ghost", themes: { brand: { "--x": "1" } } }),
    Error,
    "no theme has that name",
  );
});
