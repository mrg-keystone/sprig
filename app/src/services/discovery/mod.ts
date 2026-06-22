// DiscoveryService — reads the keep `server`'s discovery manifest in-process via
// the Backend token (no TCP, no token), and flattens it into the per-case view
// model the workbench sidebar + gallery render. Server-scoped: SSR only.
import { Backend, inject, Injectable } from "@sprig/core";
import type { Case, Manifest, Problem } from "../../lib/types.ts";

interface RawTest {
  name: string;
  file: string;
}
interface RawCase {
  name: string;
  label: string;
  route: string;
  tests?: RawTest[];
}
interface RawEntry {
  label: string;
  kind: string;
  target: string;
  category: string;
  folder: string;
  cases?: RawCase[];
}
interface RawManifest {
  entrys?: RawEntry[];
  problems?: Problem[];
}

@Injectable({ scope: "server" })
export class DiscoveryService {
  #be = inject(Backend);

  async manifest(projectRoot: string): Promise<Manifest> {
    const { ok, data } = await this.#be.get<RawManifest>("/http/get-manifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    });
    const raw: RawManifest = ok && data ? data : {};
    const cases: Case[] = (raw.entrys ?? []).flatMap((e) =>
      (e.cases ?? []).map((c): Case => ({
        target: e.target,
        category: e.category,
        folder: e.folder,
        component: e.label,
        name: c.name,
        label: c.label,
        route: c.route,
        kind: e.kind,
        tests: (c.tests ?? []).map((t) => t.name),
        testFiles: (c.tests ?? []).map((t) => t.file).filter(Boolean),
      }))
    );
    // The "broken previews" banner is for real config errors only — drop the
    // advisory "unsupported" notes (e.g. a case using the deferred _mocks feature).
    const problems = (raw.problems ?? []).filter((p) => p.kind !== "unsupported");
    return { cases, problems, count: cases.length };
  }
}
