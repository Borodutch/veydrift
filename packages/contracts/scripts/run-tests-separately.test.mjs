import {test} from "node:test";
import assert from "node:assert/strict";
import {forgeTestArgs} from "./run-tests-separately.mjs";

test("only staged multi-transaction driver receives an aggregate gas override", () => {
  assert.deepEqual(forgeTestArgs("VeydriftStagedCombat.t.sol"), [
    "test", "--match-path", "test/VeydriftStagedCombat.t.sol", "--isolate", "--gas-limit", "100000000000",
  ]);
  assert.deepEqual(forgeTestArgs("VeydriftGame.t.sol"), ["test", "--match-path", "test/VeydriftGame.t.sol"]);
});

test("keyless environment fixtures serialize without changing any gas allowance", () => {
  assert.deepEqual(forgeTestArgs("VeydriftCoalitionUpgradeKeyless.t.sol"), [
    "test", "--match-path", "test/VeydriftCoalitionUpgradeKeyless.t.sol", "--threads", "1",
  ]);
});
