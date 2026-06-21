// Child-process orchestration for the preview app: stream pumps, server start +
// ready-URL detection, the browser opener, and idempotent signal cleanup.

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/;

/** Stream a child pipe to our stdout, invoking onLine for each complete line. */
export async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await Deno.stdout.write(value);
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
}

/** Quietly drain a child stream, invoking onLine per complete line (no echo). */
export async function drain(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
  } catch { /* stream closed */ }
}

/** Spawn `deno task dev` in appDir; resolve once it logs its URL (90s timeout). */
export function startServer(
  appDir: string,
): Promise<{ child: Deno.ChildProcess; baseURL: string }> {
  const child = new Deno.Command("deno", {
    args: ["task", "dev"],
    cwd: appDir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  return new Promise((resolve, reject) => {
    let done = false;
    drain(child.stdout, (line) => {
      const m = line.match(URL_RE);
      if (m && !done) {
        done = true;
        resolve({ child, baseURL: m[0].replace(/\/$/, "") });
      }
    });
    drain(child.stderr, () => {});
    setTimeout(() => {
      if (!done) {
        done = true;
        try {
          child.kill("SIGTERM");
        } catch { /* already dead */ }
        reject(new Error("preview server did not start in time"));
      }
    }, 90_000);
  });
}

/** Open a URL in the default browser (best-effort, cross-platform). */
export function openBrowser(url: string) {
  const cmd = Deno.build.os === "windows"
    ? "start"
    : Deno.build.os === "darwin"
    ? "open"
    : "xdg-open";
  try {
    new Deno.Command(cmd, { args: [url] }).spawn();
  } catch { /* no opener available */ }
}

/** Register SIGINT/SIGTERM handlers that run an idempotent cleanup, then exit. */
export function onShutdown(cleanup: () => void) {
  let cleaned = false;
  const run = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    try {
      Deno.addSignalListener(sig, () => {
        run();
        Deno.exit(0);
      });
    } catch { /* signal not supported here */ }
  }
  return run;
}

export { URL_RE };
