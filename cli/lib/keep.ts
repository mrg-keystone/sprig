// In-process keep client — the CLI's single door to the server. Every operation is
// a keep endpoint, dispatched in-process via `api.backend.fetch` (no port, no
// subprocess, no token — keep trusts the in-process channel). Importing the server's
// keep `api` resolves because the repo is a Deno workspace (root deno.json): server
// files keep their own `@/` map + decorator compilerOptions even when imported here.
import { api } from "../../server/bootstrap/mod.ts";
import type { DiscoverResult } from "../../server/src/core/business/discover/mod.ts";
import type { TestReport } from "../../server/src/core/business/runner/mod.ts";

// keep mounts each @EndpointController("http") method at /http/<path>; calls are
// POST + JSON body — the same shape the preview app's /api/run route uses.
async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await api.backend.fetch(`/http/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `keep /http/${path} → ${res.status} ${res.statusText}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  return await res.json() as T;
}

export interface TestRunInput {
  files?: string[];
  filter?: string;
  baseUrl?: string;
  projectRoot?: string;
}

/** Discovery + testing — all in-process through keep. The CLI owns no business logic. */
export const keep = {
  // keep's DiscoverResultDto names the array `entrys` (rune pluralizer); normalize
  // it back to the core's `entries` so the commands stay unchanged.
  async discover(projectRoot: string): Promise<DiscoverResult> {
    const r = await call<
      { entrys: DiscoverResult["entries"]; problems: DiscoverResult["problems"] }
    >("get-discovery", { projectRoot });
    return { entries: r.entrys, problems: r.problems };
  },
  testRun(input: TestRunInput): Promise<TestReport> {
    return call<TestReport>("post-test-run", { ...input });
  },
};
