#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

const options = parseArgs(process.argv.slice(2));
const fromEnv = Boolean(options["from-env"]);

const manifest = {
  schema: "veydrift.deployment.v1",
  generatedAt: value("timestamp") ?? new Date().toISOString(),
  network: {
    chainId: numberValue("chain-id", "VEYDRIFT_CHAIN_ID"),
    name: value("network-name", "VEYDRIFT_NETWORK_NAME") ?? "Base Sepolia"
  },
  deployment: {
    blockNumber: stringValue("deploy-block", "VEYDRIFT_DEPLOY_BLOCK"),
    indexFromBlock: stringValue("index-from-block", "VEYDRIFT_INDEX_FROM_BLOCK"),
    commit: value("commit") ?? gitCommit(),
    abiHash: value("abi-hash") ?? abiHash(value("abi-file") ?? "packages/contracts/out/VeydriftGame.sol/VeydriftGame.json"),
    deployer: {
      label: value("deployer-label", "VEYDRIFT_DEPLOYER_LABEL") ?? "Veydrift deployer wallet",
      address: optionalAddress(value("deployer-address", "VEYDRIFT_DEPLOYER_ADDRESS"), "deployer-address")
    }
  },
  contracts: {
    game: requiredAddress(value("game", "VEYDRIFT_GAME_CONTRACT_ADDRESS") ?? value(undefined, "VEYDRIFT_CONTRACT_ADDRESS"), "game"),
    settlement: requiredAddress(value("settlement", "VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS") ?? value("game", "VEYDRIFT_GAME_CONTRACT_ADDRESS"), "settlement"),
    resourceTokens: {
      metal: requiredAddress(value("metal", "VEYDRIFT_METAL_TOKEN_ADDRESS"), "metal"),
      crystal: requiredAddress(value("crystal", "VEYDRIFT_CRYSTAL_TOKEN_ADDRESS"), "crystal"),
      deuterium: requiredAddress(value("deuterium", "VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS"), "deuterium")
    },
    allianceSystem: requiredAddress(value("alliance", "VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS"), "alliance"),
    randomnessEngine: requiredAddress(value("randomness", "VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS"), "randomness"),
    moonSystem: requiredAddress(value("moon", "VEYDRIFT_MOON_CONTRACT_ADDRESS"), "moon"),
    auxiliary: auxiliaryContracts(options)
  }
};

if (manifest.deployment.deployer.address === undefined) {
  delete manifest.deployment.deployer.address;
}

validateManifest(manifest);

const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (options.out) {
  writeFileSync(options.out, output);
} else {
  process.stdout.write(output);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      usage(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === "from-env") {
      parsed[key] = true;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      usage(`Missing value for --${key}`);
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function value(key, envKey) {
  if (key && options[key]) return options[key];
  if (fromEnv && envKey) return process.env[envKey];
  return undefined;
}

function stringValue(key, envKey) {
  const current = value(key, envKey);
  if (current === undefined || current === "") return undefined;
  if (!/^[0-9]+$/.test(current)) {
    fail(`${key} must be a non-negative integer string.`);
  }
  return current;
}

function numberValue(key, envKey) {
  const current = value(key, envKey) ?? "84532";
  const parsed = Number.parseInt(current, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== current) {
    fail(`${key} must be a positive safe integer.`);
  }
  return parsed;
}

function optionalAddress(address, field) {
  if (!address) return undefined;
  return requiredAddress(address, field);
}

function requiredAddress(address, field) {
  if (!address) fail(`Missing required address: ${field}.`);
  if (!addressPattern.test(address)) {
    fail(`${field} must be a 0x-prefixed 20-byte EVM address.`);
  }
  return address;
}

function auxiliaryContracts(args) {
  const entries = {};
  for (const [key, current] of Object.entries(args)) {
    if (!key.startsWith("aux-")) continue;
    const name = key.slice("aux-".length);
    entries[name] = requiredAddress(current, key);
  }
  return entries;
}

function abiHash(path) {
  if (!existsSync(path)) {
    fail(`ABI artifact not found at ${path}. Run forge build first or pass --abi-hash.`);
  }
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const abi = JSON.stringify(artifact.abi ?? artifact);
  return `sha256:${createHash("sha256").update(abi).digest("hex")}`;
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function validateManifest(current) {
  if (!current.deployment.blockNumber) fail("Missing deploy block. Pass --deploy-block or VEYDRIFT_DEPLOY_BLOCK.");
  if (!current.deployment.indexFromBlock) {
    current.deployment.indexFromBlock = current.deployment.blockNumber;
  }
  if (BigInt(current.deployment.indexFromBlock) > BigInt(current.deployment.blockNumber)) {
    fail("index-from-block cannot be greater than deploy-block.");
  }
}

function usage(message) {
  const text = `Usage: node scripts/veydrift-deployment-manifest.mjs --deploy-block <block> --game <address> --metal <address> --crystal <address> --deuterium <address> --alliance <address> --randomness <address> --moon <address> [--settlement <address>] [--from-env] [--out <file>]`;
  fail(`${message}\n${text}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
