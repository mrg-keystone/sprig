// Scaffolded once; fill in the bodies. `sync` preserves this file.
// The `os:` boundary — delegates to the ported core/runner.ts (spec discovery +
// path-safety filter + Playwright spawn + report parse; non-destructive runner
// status check). Faults bubble up from core (no-match/runner-unavailable/timeout)
// as thrown Error(<slug>); provision wraps status to raise "provision-failed".
// `collect` here is unused (the business Runner owns collect). The optional
// `deps` enable deterministic fault tests.

import { RunnerStatusDto } from "@/src/testing/dto/runner-status.ts";
import { TestReportDto } from "@/src/testing/dto/test-report.ts";
import { TestRunRequestDto } from "@/src/testing/dto/test-run-request.ts";
import {
  type RunDeps,
  type RunnerStatus,
  runnerStatus as realStatus,
  runTests,
} from "@/src/core/business/runner/mod.ts";

export interface ProvisionDeps {
  status?: () => Promise<RunnerStatus>;
}

export class Runner {
  async run(
    testRunRequestDto: TestRunRequestDto,
    deps?: RunDeps,
  ): Promise<TestReportDto> {
    return (await runTests(testRunRequestDto, deps)) as TestReportDto;
  }

  async provision(
    projectRoot: string,
    deps: ProvisionDeps = {},
  ): Promise<RunnerStatusDto> {
    // Status-only: never npm-installs inside a request. The CLI's ensureRunner
    // does the heavy provisioning; this reports readiness.
    void projectRoot;
    const status = deps.status ?? realStatus;
    try {
      return (await status()) as RunnerStatusDto;
    } catch {
      throw new Error("provision-failed");
    }
  }

  collect(runnerStatusDto: RunnerStatusDto): Promise<RunnerStatusDto> {
    return Promise.resolve(runnerStatusDto);
  }
}
