// View-model types for the workbench, mirroring the isolate UI's shapes (the
// flattened per-case unit the sidebar/gallery render). Derived from the keep
// server's discovery DTOs (EntryDto → CaseDto).

export interface Problem {
  kind: string;
  path: string;
  detail: string;
}

/** One previewable case (a component/page + a named fixture), flattened from a
 *  discovery EntryDto and one of its CaseDto cases. */
export interface Case {
  target: string; // "component" | "page"
  category: string;
  folder: string;
  component: string; // entry label
  name: string; // case name
  label: string; // case label
  route: string; // iframe src for this case
  kind: string; // "static" | "island"
  tests: string[]; // test titles
  testFiles: string[]; // spec file paths (for /api/http/post-test-run)
}

export interface Manifest {
  cases: Case[];
  problems: Problem[];
  count: number;
}
