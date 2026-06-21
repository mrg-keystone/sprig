// Scaffolded once; fill in the bodies. `sync` preserves this file.
// test.collect — pure. The runner adapter produced the report; collect is the
// identity step that returns it as the REQ output.

import { TestReportDto } from "@/src/testing/dto/test-report.ts";

export class Test {
  collect(testReportDto: TestReportDto): TestReportDto {
    return testReportDto;
  }
}
