import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Dedupe Preact so the host's symlinked islands/components share ONE preact
  // instance with the app. Without this the host code can resolve its own copy,
  // and controls.tsx's vnode hook (the mock layer) never sees its sub-components.
  resolve: {
    dedupe: [
      "preact",
      "preact/hooks",
      "preact/jsx-runtime",
      "@preact/signals",
      "@preact/signals-core",
    ],
  },
  server: {
    port: 8321,
    strictPort: false,
    // The scaffold step appends the host project root here (symlink targets) when
    // it materializes this template into ~/isolate/<project>. Standalone, allow
    // the app dir so the dev server can read it.
    fs: { allow: [Deno.cwd()] },
  },
  plugins: [
    // Ignore the host's isolate/ fixture folders so they aren't treated as routes.
    fresh({
      ignore: [/node_modules/, new RegExp("/(islands|components|pages)/.*/isolate/")],
    }),
    tailwindcss(),
  ],
});
