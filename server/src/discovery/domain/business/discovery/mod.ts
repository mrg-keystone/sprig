// Scaffolded once; fill in the bodies. `sync` preserves this file.
// discovery.collect — pure. The scan adapter already produced the full result;
// collect is the identity step that hands it back as the REQ output.

import { DiscoverResultDto } from "@/src/discovery/dto/discover-result.ts";

export class Discovery {
  collect(discoverResultDto: DiscoverResultDto): DiscoverResultDto {
    return discoverResultDto;
  }
}
