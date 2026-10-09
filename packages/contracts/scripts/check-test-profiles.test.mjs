import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {profileProblems, unoptimizedTestFiles} from "./check-test-profiles.mjs";

test("real-stack Game gas regressions retain production modules and libraries", () => {
  assert.match(profileProblems("test/VeydriftGame.t.sol", "", new Set()).join(" "), /production-profile linked libraries/);
  const config = readFileSync(new URL("../foundry.toml", import.meta.url), "utf8");
  assert.ok(!unoptimizedTestFiles(config).includes("test/VeydriftGame.t.sol"));
});
