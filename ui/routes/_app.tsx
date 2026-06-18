// deno-lint-ignore-file react-no-danger -- the inline script is an intentional
// pre-paint embed-detection hook (no flash); it sets data-embed when iframed.
import type { ComponentType } from "preact";

export default function App({ Component }: { Component: ComponentType }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>isolate</title>
        {
          /* When this page is iframed by the v0.4 shell stage, mark it embed so the
            preview shows component-only (panel/log/back hidden, driven via the
            parent dock). Runs before paint, so there's no flash. */
        }
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.parent!==window)document.documentElement.setAttribute('data-embed','')}catch(e){}",
          }}
        />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
