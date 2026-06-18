// Scaffolded once; fill in the bodies. `sync` preserves this file.
// runner.collect — pure identity over the status the provision adapter produced.
// run/provision here are generated artifacts of `runner` being both a business
// subject and an os: adapter; they are NOT wired (the os: adapter owns them).

import { RunnerStatusDto } from "@/src/testing/dto/runner-status.ts";
import { TestReportDto } from "@/src/testing/dto/test-report.ts";
import { TestRunRequestDto } from "@/src/testing/dto/test-run-request.ts";

export class Runner {
  run(_testRunRequestDto: TestRunRequestDto): TestReportDto {
    throw new Error("unused — see data/runner adapter");
  }
  provision(_projectRoot: string): RunnerStatusDto {
    throw new Error("unused — see data/runner adapter");
  }
  collect(runnerStatusDto: RunnerStatusDto): RunnerStatusDto {
    return runnerStatusDto;
  }
}
