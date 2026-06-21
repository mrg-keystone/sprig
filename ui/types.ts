// Shared UI types. The manifest shape mirrors the reference generator's
// flatCases/flatProblems (scaffold.ts); the rest are the shell's view models.

export interface Case {
  target: "component" | "page";
  category: string;
  folder: string;
  component: string;
  name: string;
  label: string;
  route: string;
  kind: "static" | "island";
  tests: string[];
  testFiles: string[];
}

export interface Problem {
  kind: string;
  path: string;
  detail: string;
}

/** One spec outcome as the /api/run route returns it (mapped from keep). */
export interface SpecResult {
  ok: boolean;
  title: string;
  error?: string;
}

/** The /api/run route's response body. */
export interface RunResponse {
  ok?: boolean;
  results?: SpecResult[];
  error?: string;
}

/** Per-case test panel state in the shell. */
export interface TestState {
  status: "idle" | "running" | "done";
  results: SpecResult[];
  error: string | null;
}

export type DotStatus = "idle" | "running" | "pass" | "fail";

export interface Toast {
  id: number;
  tone: string;
  title: string;
  text: string;
}

// The control surface bridged up from the stage iframe (controls.tsx posts it).
export interface ControlDef {
  type?: string;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ControlView {
  scope: string;
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

export interface StageEvent {
  id: number;
  time: string;
  source: string;
  type: string;
  detail: string;
}
