import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Base node relay and finality fault harness", { timeout: 120_000 }, () => {
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", "scripts/base-node", "-p", "test_*.py", "-v"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 110_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran [0-9]+ tests/);
});
