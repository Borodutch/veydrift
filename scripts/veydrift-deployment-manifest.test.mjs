import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const address = (digit) => `0x${digit.repeat(40)}`;
const hash = (digit) => `0x${digit.repeat(64)}`;

test("postdeploy smoke fails closed until timed-missile replay covers chain sync", () => {
  const source = readFileSync("scripts/veydrift-postdeploy-smoke.mjs", "utf8");
  assert.match(source, /timedMissileIndexFromBlock === manifest\.deployment\.timedMissileIndexFromBlock/);
  assert.match(source, /replay\.throughBlock\) >= BigInt\(body\.chainSync\.latestSyncedBlock\)/);
  assert.match(source, /timed missile replay must be complete/);
  assert.match(source, /timed missile replay must be error-free/);
  assert.match(source, /EIP-1967 Game implementation must match manifest/);
  assert.match(source, /active Game runtime code hash must match manifest/);
  assert.match(source, /Game upgrade receipt block must match exact manifest boundary/);
  assert.match(source, /Game upgrade receipt must emit Upgraded\(expected implementation\) from the proxy/);
  assert.match(source, /Game must remain unpaused after upgrade/);
  assert.match(source, /running backend build SHA must match manifest commit/);
  assert.match(source, /final health must not remain in timed-missile standby/);
});

test("deployment manifest carries referral system into backend env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "veydrift-manifest-"));
  const manifestPath = join(tempDir, "manifest.json");
  const backendEnvPath = join(tempDir, "backend.env");

  runNode([
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
    "--timed-missile-index-from-block", "123",
    "--upgrade-tx", hash("a"),
    "--game-implementation", address("9"),
    "--game-implementation-code-hash", hash("b"),
    "--chain-id", "84532",
    "--game", address("1"),
    "--settlement", address("1"),
    "--alliance", address("2"),
    "--randomness", address("3"),
    "--moon", address("4"),
    "--referral", address("5"),
    "--metal", address("6"),
    "--crystal", address("7"),
    "--deuterium", address("8"),
    "--abi-hash", "sha256:test",
    "--out", manifestPath,
  ]);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.contracts.referralSystem, address("5"));
  assert.equal(manifest.deployment.timedMissileIndexFromBlock, "123");
  assert.equal(manifest.deployment.activation.transactionHash, hash("a"));
  assert.equal(manifest.deployment.activation.gameImplementation, address("9"));
  assert.equal(manifest.deployment.activation.gameImplementationCodeHash, hash("b"));

  runNode([
    "scripts/veydrift-apply-deployment-manifest.mjs",
    "--manifest", manifestPath,
    "--backend-env-out", backendEnvPath,
  ]);

  const backendEnv = readFileSync(backendEnvPath, "utf8");
  assert.match(backendEnv, new RegExp(`^VEYDRIFT_REFERRAL_SYSTEM_ADDRESS=${address("5")}$`, "m"));
  assert.match(backendEnv, /^VEYDRIFT_TIMED_MISSILE_INDEX_FROM_BLOCK=123$/m);
  assert.match(backendEnv, /^VEYDRIFT_TIMED_MISSILE_STANDBY=false$/m);
  assert.match(backendEnv, new RegExp(`^VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION=${address("9")}$`, "m"));
  assert.match(backendEnv, new RegExp(`^VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION_CODE_HASH=${hash("b")}$`, "m"));
});

test("deployment manifest omits referral system when not configured", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "veydrift-manifest-"));
  const manifestPath = join(tempDir, "manifest.json");
  const backendEnvPath = join(tempDir, "backend.env");

  runNode([
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
    "--chain-id", "84532",
    "--upgrade-tx", hash("a"),
    "--game-implementation", address("9"),
    "--game-implementation-code-hash", hash("b"),
    "--game", address("1"),
    "--settlement", address("1"),
    "--alliance", address("2"),
    "--randomness", address("3"),
    "--moon", address("4"),
    "--metal", address("6"),
    "--crystal", address("7"),
    "--deuterium", address("8"),
    "--abi-hash", "sha256:test",
    "--out", manifestPath,
  ]);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(Object.hasOwn(manifest.contracts, "referralSystem"), false);
  assert.equal(manifest.deployment.timedMissileIndexFromBlock, "123");

  runNode([
    "scripts/veydrift-apply-deployment-manifest.mjs",
    "--manifest", manifestPath,
    "--backend-env-out", backendEnvPath,
  ]);

  const backendEnv = readFileSync(backendEnvPath, "utf8");
  assert.equal(backendEnv.includes("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS"), false);
});

test("deployment manifest rejects a guessed timed missile replay boundary", () => {
  const result = spawnSync(process.execPath, [
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
    "--timed-missile-index-from-block", "122",
    "--chain-id", "84532",
    "--upgrade-tx", hash("a"),
    "--game-implementation", address("9"),
    "--game-implementation-code-hash", hash("b"),
    "--game", address("1"),
    "--settlement", address("1"),
    "--alliance", address("2"),
    "--randomness", address("3"),
    "--moon", address("4"),
    "--metal", address("6"),
    "--crystal", address("7"),
    "--deuterium", address("8"),
    "--abi-hash", "sha256:test",
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must equal the exact upgrade receipt block/);
});

test("deployment manifest consumer rejects a replay boundary changed after generation", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "veydrift-manifest-"));
  const manifestPath = join(tempDir, "manifest.json");
  runNode([
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
    "--chain-id", "84532",
    "--upgrade-tx", hash("a"),
    "--game-implementation", address("9"),
    "--game-implementation-code-hash", hash("b"),
    "--game", address("1"),
    "--settlement", address("1"),
    "--alliance", address("2"),
    "--randomness", address("3"),
    "--moon", address("4"),
    "--metal", address("6"),
    "--crystal", address("7"),
    "--deuterium", address("8"),
    "--abi-hash", "sha256:test",
    "--out", manifestPath
  ]);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.deployment.timedMissileIndexFromBlock = "122";
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const result = spawnSync(process.execPath, [
    "scripts/veydrift-apply-deployment-manifest.mjs",
    "--manifest", manifestPath
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must equal the exact upgrade receipt block/);
});

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `node ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}
