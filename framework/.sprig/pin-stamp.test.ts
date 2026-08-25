// Regression tests for the pin-stamp/migration contract. The founding incident:
// a stale 0.21.1 CLI ran `sprig build` on an app pinned to @mrg-keystone/sprig@1.0.0
// and silently DOWNGRADED the pin to 0.21.1 (via the legacy-name migration path,
// which restamped EVERY entry's version) — resurrecting a fixed SSR bug.
import { assert, assertEquals } from "@std/assert";
import { migrateImports, pinnedSprigVersion, stampImports } from "./pin-stamp.ts";

Deno.test("stampImports upgrades an older pin to the CLI version", () => {
  const res = stampImports(
    { "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@0.20.0" },
    "1.0.0",
  );
  assert(res.changed);
  assertEquals(res.imports["@mrg-keystone/sprig"], "jsr:@mrg-keystone/sprig@1.0.0");
  assertEquals(res.aheadPin, null);
});

Deno.test("stampImports NEVER downgrades a pin ahead of the CLI", () => {
  const imports = {
    "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@1.0.0",
    "@mrg-keystone/sprig/keep": "jsr:@mrg-keystone/sprig@1.0.0/keep",
  };
  const res = stampImports(imports, "0.21.1");
  assert(!res.changed, "an ahead pin must be left alone");
  assertEquals(res.imports, imports);
  assertEquals(res.aheadPin, "1.0.0", "the caller warns with the kept pin");
});

Deno.test("stampImports handles range pins (^/~) and local overrides", () => {
  // range ahead of the CLI → kept
  const ahead = stampImports({ "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@^2" }, "1.0.0");
  assert(!ahead.changed);
  assertEquals(ahead.aheadPin, "2");
  // local override → never touched
  const local = stampImports({ "@mrg-keystone/sprig": "../sprig/main/framework/mod.ts" }, "1.0.0");
  assert(!local.changed);
  // absent key → never added
  const absent = stampImports({ "@std/path": "jsr:@std/path@^1" }, "1.0.0");
  assert(!absent.changed);
});

Deno.test("migrateImports is a BYTE-IDENTICAL no-op on a modern app", () => {
  const imports = {
    "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@1.0.0",
    "@mrg-keystone/sprig/keep": "jsr:@mrg-keystone/sprig@1.0.0/keep",
    "@std/path": "jsr:@std/path@^1",
  };
  // the CLI is OLDER than the pin — pre-fix, migrateVal restamped every entry
  const res = migrateImports(imports, "0.21.1");
  assert(!res.changed, "no legacy names → nothing to migrate");
  assertEquals(res.imports, imports);
});

Deno.test("migrateImports renames legacy entries and re-pins them to the CLI", () => {
  const res = migrateImports(
    {
      "@sprig/core": "jsr:@sprig/core@0.19.0",
      "@sprig/keep": "jsr:@sprig/core@0.19.0/keep",
      "@std/path": "jsr:@std/path@^1",
    },
    "1.0.0",
  );
  assert(res.changed);
  assertEquals(res.imports, {
    "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@1.0.0",
    "@mrg-keystone/sprig/keep": "jsr:@mrg-keystone/sprig@1.0.0/keep",
    "@std/path": "jsr:@std/path@^1",
  });
});

Deno.test("migrateImports lets a local override on the modern key win over a legacy key", () => {
  const res = migrateImports(
    {
      "@sprig/core": "jsr:@sprig/core@0.19.0",
      "@mrg-keystone/sprig": "../sprig/main/framework/mod.ts",
    },
    "1.0.0",
  );
  assert(res.changed, "the legacy key is dropped");
  assertEquals(res.imports, { "@mrg-keystone/sprig": "../sprig/main/framework/mod.ts" });
});

Deno.test("pinnedSprigVersion reads exact, range, and subpath pins", () => {
  assertEquals(pinnedSprigVersion("jsr:@mrg-keystone/sprig@1.0.0"), "1.0.0");
  assertEquals(pinnedSprigVersion("jsr:@mrg-keystone/sprig@^1.2.3/keep"), "1.2.3");
  assertEquals(pinnedSprigVersion("jsr:@std/path@^1"), null);
});
