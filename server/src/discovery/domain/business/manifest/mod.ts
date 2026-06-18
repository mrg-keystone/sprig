// Scaffolded once; fill in the bodies. `sync` preserves this file.
// The manifest is the gallery view model. Today it is the discovery result
// projected 1:1 (entries + problems); this is where future denormalization for
// the navigator/tree would live.

import { DiscoverResultDto } from "@/src/discovery/dto/discover-result.ts";
import { ManifestDto } from "@/src/discovery/dto/manifest.ts";

export class Manifest {
  private result: DiscoverResultDto = { entrys: [], problems: [] };

  fromDiscovery(discoverResultDto: DiscoverResultDto): Manifest {
    this.result = discoverResultDto;
    return this;
  }

  toDto(): ManifestDto {
    return {
      entrys: this.result.entrys,
      problems: this.result.problems,
    };
  }
}
