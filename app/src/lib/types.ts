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

// ── workbench shell view-model (the stage bridge + dock) ─────────────────────

export type DotStatus = "idle" | "running" | "pass" | "fail" | "island" | "page" | string;

export interface Toast {
  id: number;
  tone: string; // "ok" | "fail" | "info"
  title: string;
  text: string;
}

export interface SpecResult {
  ok: boolean;
  title: string;
  error?: string;
}

export interface TestState {
  status: "idle" | "running" | "done";
  results: SpecResult[];
  error: string | null;
}

export interface RunResponse {
  ok?: boolean;
  /** keep's TestReportDto field; the Fresh /api/run proxy renamed it to `results`. */
  testResults?: SpecResult[];
  results?: SpecResult[];
  error?: string;
}

export interface StageEvent {
  id: number;
  time: string;
  source: string;
  type: string;
  detail: string;
}

/** A single editable control bridged from the iframe stage. */
export interface ControlDef {
  type?: string;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ControlView {
  scope: string; // "prop" | "signal" | "sub" | "html"
  key: string;
  instKey?: string;
  value: unknown;
  def?: ControlDef;
}

export interface InstanceView {
  key: string;
  id?: string;
  name: string;
  controls: ControlView[];
}

export interface Surface {
  name: string;
  background?: string;
  html?: string | null;
  controls: ControlView[];
  instances: InstanceView[];
}
