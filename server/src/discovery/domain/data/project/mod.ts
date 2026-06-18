// Scaffolded once; fill in the bodies. `sync` preserves this file.
// The `fs:` boundary — delegates to the ported core/discover.ts scanner and
// maps its ComponentEntry shape onto the DTO (root -> sourceRoot, entries ->
// entrys; the open maps pass straight through as @Allow() fields).
// Fault: a failed scan throws Error("scan-failed") (keyed in heal-rules).
// The optional `deps.discover` enables deterministic fault tests.

import { DiscoverResultDto } from "@/src/discovery/dto/discover-result.ts";
import { discover as realDiscover } from "@/src/core/business/discover/mod.ts";

export interface ScanDeps {
  discover?: typeof realDiscover;
}

export class Project {
  async scan(projectRoot: string, deps: ScanDeps = {}): Promise<DiscoverResultDto> {
    const discover = deps.discover ?? realDiscover;
    let r;
    try {
      r = await discover(projectRoot || Deno.cwd());
    } catch {
      throw new Error("scan-failed");
    }
    return {
      entrys: r.entries.map((e) => ({
        slug: e.slug,
        label: e.label,
        kind: e.kind,
        sourceRoot: e.root,
        target: e.target,
        dir: e.dir,
        isolateDir: e.isolateDir,
        componentFile: e.componentFile,
        exportName: e.exportName,
        category: e.category,
        folder: e.folder,
        background: e.background,
        controlDefs: e.controlDefs,
        subControlDefs: e.subControlDefs,
        cases: e.cases.map((c) => ({
          name: c.name,
          label: c.label,
          jsonPath: c.jsonPath,
          props: c.props,
          innerHtml: c.innerHtml,
          signals: c.signals,
          mocks: c.mocks,
          route: c.route,
          tests: c.tests.map((t) => ({ name: t.name, file: t.file })),
        })),
      })),
      problems: r.problems.map((p) => ({
        kind: p.kind,
        path: p.path,
        detail: p.detail,
      })),
    } as DiscoverResultDto;
  }
}
