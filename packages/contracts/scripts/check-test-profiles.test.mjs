import assert from "node:assert/strict";
import {test} from "node:test";
import {profileProblems} from "./check-test-profiles.mjs";

test("production gas suites cannot select the unoptimized library graph", () => {
  for (const file of ["test/VeydriftGame.t.sol", "test/VeydriftMoonSupplyBatch.t.sol"]) {
    assert.match(profileProblems(file, "contract Test {}", new Set()).join(" "), /linked libraries/);
  }
  assert.deepEqual(profileProblems("test/Ordinary.t.sol", "contract Test {}", new Set()), []);
});
