import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validator = join(packageRoot, "scripts/validate-veydrift-uniswap-launch-manifest.mjs");
const manifestPath = join(packageRoot, "manifests/vey-741-base-fork-dry-run.json");
const baseline = JSON.parse(readFileSync(manifestPath, "utf8"));
const zeroHash = `0x${"0".repeat(64)}`;

const validate = (manifest) => {
  const directory = mkdtempSync(join(tmpdir(), "vey-741-manifest-"));
  const path = join(directory, "manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest)}\n`);
  const result = spawnSync(process.execPath, [validator, path], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, VEYDRIFT_SOURCE_COMMIT: "" },
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
};

test("accepts the checked chain-derived manifest", () => {
  const result = validate(baseline);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate, expectedFailure] of [
  ["zero main pool id", (manifest) => { manifest.mainPoolId = zeroHash; }, "mainPoolId"],
  ["zero resource pool id", (manifest) => { manifest.resource0PoolId = zeroHash; }, "resource0PoolId"],
  ["zero main full-range ticks", (manifest) => {
    manifest.mainTickLower = 0;
    manifest.mainTickUpper = 0;
  }, "mainTickLower"],
  ["zero resource full-range ticks", (manifest) => {
    manifest.resource0TickLower = 0;
    manifest.resource0TickUpper = 0;
  }, "resource0TickLower"],
  ["all-zero source commit", (manifest) => { manifest.sourceCommit = "0".repeat(40); }, "sourceCommit"],
]) {
  test(`rejects ${name}`, () => {
    const manifest = structuredClone(baseline);
    mutate(manifest);
    const result = validate(manifest);
    assert.notEqual(result.status, 0, `validator accepted ${name}`);
    assert.match(result.stderr, new RegExp(expectedFailure));
  });
}
