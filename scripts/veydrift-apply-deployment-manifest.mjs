#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const options = parseArgs(process.argv.slice(2));
const manifestPath = options.manifest ?? usage("Missing --manifest <file>.");
const manifest = readManifest(manifestPath);

validateManifest(manifest);

const backendEnv = {
  VEYDRIFT_DEPLOYMENT_MODE: options.mode ?? "test",
  VEYDRIFT_CHAIN_ID: String(manifest.network.chainId),
  VEYDRIFT_NETWORK_NAME: manifest.network.name,
  VEYDRIFT_CONTRACT_ADDRESS: manifest.contracts.game,
  VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS: manifest.contracts.settlement,
  VEYDRIFT_GAME_CONTRACT_ADDRESS: manifest.contracts.game,
  VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS: manifest.contracts.allianceSystem,
  VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS: manifest.contracts.randomnessEngine,
  VEYDRIFT_MOON_CONTRACT_ADDRESS: manifest.contracts.moonSystem,
  VEYDRIFT_METAL_TOKEN_ADDRESS: manifest.contracts.resourceTokens.metal,
  VEYDRIFT_CRYSTAL_TOKEN_ADDRESS: manifest.contracts.resourceTokens.crystal,
  VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS: manifest.contracts.resourceTokens.deuterium,
  VEYDRIFT_INDEX_FROM_BLOCK: manifest.deployment.indexFromBlock,
  VEYDRIFT_DEPLOYMENT_MANIFEST_SCHEMA: manifest.schema,
  VEYDRIFT_DEPLOYMENT_COMMIT: manifest.deployment.commit,
  VEYDRIFT_DEPLOYMENT_ABI_HASH: manifest.deployment.abiHash,
  VEYDRIFT_DEPLOYMENT_TIMESTAMP: manifest.generatedAt
};

const frontendEnv = {
  VITE_VEYDRIFT_API_URL: options["api-url"] ?? "https://api-test.veydrift.com"
};

if (options["backend-env-out"]) {
  writeFileSync(options["backend-env-out"], envFile(backendEnv));
}
if (options["frontend-env-out"]) {
  writeFileSync(options["frontend-env-out"], envFile(frontendEnv));
}

if (!options["backend-env-out"] && !options["frontend-env-out"]) {
  process.stdout.write(JSON.stringify({ backendEnv, frontendEnv }, null, 2));
  process.stdout.write("\n");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) usage(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usage(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function validateManifest(current) {
  if (current.schema !== "veydrift.deployment.v1") fail("Unsupported manifest schema.");
  if (!Number.isSafeInteger(current.network?.chainId) || current.network.chainId <= 0) fail("Invalid network.chainId.");
  if (!current.network?.name) fail("Missing network.name.");
  if (!/^[0-9]+$/.test(current.deployment?.blockNumber ?? "")) fail("Invalid deployment.blockNumber.");
  if (!/^[0-9]+$/.test(current.deployment?.indexFromBlock ?? "")) fail("Invalid deployment.indexFromBlock.");
  if (!current.deployment?.commit) fail("Missing deployment.commit.");
  if (!current.deployment?.abiHash) fail("Missing deployment.abiHash.");
  for (const [label, address] of Object.entries({
    game: current.contracts?.game,
    settlement: current.contracts?.settlement,
    allianceSystem: current.contracts?.allianceSystem,
    randomnessEngine: current.contracts?.randomnessEngine,
    moonSystem: current.contracts?.moonSystem,
    metal: current.contracts?.resourceTokens?.metal,
    crystal: current.contracts?.resourceTokens?.crystal,
    deuterium: current.contracts?.resourceTokens?.deuterium
  })) {
    if (!addressPattern.test(address ?? "")) fail(`Invalid address for ${label}.`);
  }
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Could not read deployment manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function envFile(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function usage(message) {
  fail(`${message}\nUsage: node scripts/veydrift-apply-deployment-manifest.mjs --manifest <file> [--backend-env-out <file>] [--frontend-env-out <file>] [--api-url <url>]`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
