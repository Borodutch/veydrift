import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const address = (digit) => `0x${digit.repeat(40)}`;

test("deployment manifest carries referral system into backend env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "veydrift-manifest-"));
  const manifestPath = join(tempDir, "manifest.json");
  const backendEnvPath = join(tempDir, "backend.env");

  runNode([
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
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

  runNode([
    "scripts/veydrift-apply-deployment-manifest.mjs",
    "--manifest", manifestPath,
    "--backend-env-out", backendEnvPath,
  ]);

  const backendEnv = readFileSync(backendEnvPath, "utf8");
  assert.match(backendEnv, new RegExp(`^VEYDRIFT_REFERRAL_SYSTEM_ADDRESS=${address("5")}$`, "m"));
});

test("deployment manifest omits referral system when not configured", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "veydrift-manifest-"));
  const manifestPath = join(tempDir, "manifest.json");
  const backendEnvPath = join(tempDir, "backend.env");

  runNode([
    "scripts/veydrift-deployment-manifest.mjs",
    "--deploy-block", "123",
    "--chain-id", "84532",
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

  runNode([
    "scripts/veydrift-apply-deployment-manifest.mjs",
    "--manifest", manifestPath,
    "--backend-env-out", backendEnvPath,
  ]);

  const backendEnv = readFileSync(backendEnvPath, "utf8");
  assert.equal(backendEnv.includes("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS"), false);
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
