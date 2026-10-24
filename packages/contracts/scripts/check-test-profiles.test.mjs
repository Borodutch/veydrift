import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {profileProblems, unoptimizedTestFiles} from "./check-test-profiles.mjs";

test("production gas suites retain production modules and linked libraries", () => {
  const config = readFileSync(new URL("../foundry.toml", import.meta.url), "utf8");
  for (const file of ["test/VeydriftGame.t.sol", "test/VeydriftMoonSupplyBatch.t.sol"]) {
    assert.match(profileProblems(file, "contract Test {}", new Set()).join(" "), /production-profile linked libraries/);
    assert.ok(!unoptimizedTestFiles(config).includes(file));
  }
  assert.deepEqual(profileProblems("test/Ordinary.t.sol", "contract Test {}", new Set()), []);
});
