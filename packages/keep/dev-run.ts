// Run by `sprig dev` (with SPRIG_DEV=1): wraps the project's production handler
// (serve.ts's serveSprig default) with the compiler's HMR dev server. It imports the
// member's main.ts to get the SAME renderer the app uses — so reparse() here makes
// SSR fresh there — and the member's dev.ts to build the wrapper. Args: <member> <entry> <base>.
const [member = "ui", entry = "serve.ts", base = "/ui"] = Deno.args;
const root = Deno.cwd();

const prod = (await import(new URL(entry, `file://${root}/`).href)).default;
const { renderer } = await import(`file://${root}/${member}/src/main.ts`);
const { createDevServer } = await import(`file://${root}/${member}/.sprig/compiler/dev.ts`);

const dev = createDevServer({ renderer, base, outDir: `${root}/static`, handler: prod });
const port = Number(Deno.env.get("PORT") ?? 8000);
Deno.serve({ port }, (req: Request, info: Deno.ServeHandlerInfo) => dev.fetch(req, info));
