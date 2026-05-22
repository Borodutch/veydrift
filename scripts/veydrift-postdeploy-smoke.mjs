#!/usr/bin/env node
import { readFileSync } from "node:fs";

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? "https://api-test.veydrift.com");
const wallet = options.wallet;
const manifest = options.manifest ? readManifest(options.manifest) : null;
const failures = [];
const evidence = [];
let walletHomePlanetId = null;

await checkJson("health", "/health", (body) => {
  expect(body.ok === true, "health.ok must be true");
  expect(body.configured === true, "health.configured must be true");
  if (manifest) {
    expect(body.chain?.chainId === manifest.network.chainId, "health chain id must match manifest");
    expect(body.chain?.indexFromBlock === manifest.deployment.indexFromBlock, "health indexFromBlock must match manifest");
    expect(body.chain?.gameContractConfigured === true, "health must report game contract configured");
    expect(body.chain?.resourceTokenAddressesConfigured === true, "health must report resource tokens configured");
    expect(body.chain?.allianceContractConfigured === true, "health must report alliance configured");
    expect(body.chain?.moonContractConfigured === true, "health must report moon configured");
    expect(body.chain?.randomnessEngineConfigured === true, "health must report randomness configured");
  }
});

await checkJson("runtime-config", "/runtime-config", (body) => {
  if (manifest) {
    expect(eqAddress(body.gameContractAddress, manifest.contracts.game), "runtime game address must match manifest");
    expect(eqAddress(body.contractAddress, manifest.contracts.settlement), "runtime settlement address must match manifest");
    expect(eqAddress(body.allianceContractAddress, manifest.contracts.allianceSystem), "runtime alliance address must match manifest");
    expect(eqAddress(body.moonContractAddress, manifest.contracts.moonSystem), "runtime moon address must match manifest");
    expect(eqAddress(body.randomnessEngineAddress, manifest.contracts.randomnessEngine), "runtime randomness address must match manifest");
    expect(eqAddress(body.resourceTokenAddresses?.metal, manifest.contracts.resourceTokens.metal), "runtime metal token must match manifest");
    expect(eqAddress(body.resourceTokenAddresses?.crystal, manifest.contracts.resourceTokens.crystal), "runtime crystal token must match manifest");
    expect(eqAddress(body.resourceTokenAddresses?.deuterium, manifest.contracts.resourceTokens.deuterium), "runtime deuterium token must match manifest");
  }
  expect(body.featureSupport?.researchEndpoint === true, "runtime featureSupport.researchEndpoint must be true");
  expect(body.featureSupport?.highscoresEndpoint === true, "runtime featureSupport.highscoresEndpoint must be true");
});

await checkJson("galaxy", "/universe/galaxies/1/systems/1", (body) => {
  expect(Array.isArray(body.planets), "galaxy smoke must return planets");
});

await checkJson("rankings", "/highscores?limit=10", (body) => {
  expect(!body.error, `rankings returned error: ${body.error ?? ""}`);
  expect(body.rankings && typeof body.rankings === "object", "rankings payload must include rankings");
});

if (wallet) {
  await checkWallet("overview:settlement", `/wallet/${wallet}/settlement`, (body) => {
    expect(body.wallet?.toLowerCase() === wallet.toLowerCase(), "settlement wallet must match requested wallet");
    walletHomePlanetId = body.homePlanetId ?? null;
    expect(Boolean(body.homePlanetId), "wallet smoke requires a settled wallet with a home planet");
  });
  if (walletHomePlanetId) {
    await checkWallet("overview:planets", `/wallet/${wallet}/planets`, (body) => {
      expect(!body.error, `planets returned error: ${body.error ?? ""}`);
      expect(Array.isArray(body.planets), "planets payload must include planets array");
      expect(body.planets.length > 0, "settled wallet must return at least one managed planet");
    });
    await checkWallet("infrastructure", `/wallet/${wallet}/infrastructure`, (body) => {
      expect(body.infrastructureAvailable !== false, body.unavailableReason ?? "infrastructure unavailable");
    });
    await checkWallet("defenses", `/wallet/${wallet}/defenses`, (body) => {
      expect(body.productionAvailable !== false, body.unavailableReason ?? "defenses unavailable");
    });
    await checkWallet("research", `/wallet/${wallet}/research`, (body) => {
      expect(body.researchAvailable !== false, body.unavailableReason ?? "research unavailable");
    });
    await checkWallet("shipyard", `/wallet/${wallet}/shipyard`, (body) => {
      expect(body.productionAvailable !== false, body.unavailableReason ?? "shipyard unavailable");
    });
    await checkWallet("alliance", `/wallet/${wallet}/alliance`, (body) => {
      expect(body.allianceAvailable !== false, body.unavailableReason ?? "alliance unavailable");
    });
    await checkWallet("mission-control", `/wallet/${wallet}/fleet-visibility`, (body) => {
      expect(Array.isArray(body.outgoing), "mission control payload must include outgoing missions");
      expect(Array.isArray(body.incoming), "mission control payload must include incoming missions");
      expect(Array.isArray(body.returning), "mission control payload must include returning missions");
    });
    await checkWallet("moon", `/wallet/${wallet}/moon`, (body) => {
      const unsupported = body.unavailableReason?.includes("only supports first-planet settlement");
      expect(!unsupported, body.unavailableReason);
      expect(body.moonAvailable !== false || body.moon === null, body.unavailableReason ?? "moon unavailable");
    });
  }
}

const result = {
  ok: failures.length === 0,
  apiUrl,
  wallet: wallet ?? null,
  evidence,
  failures
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) {
  process.exit(1);
}

async function checkWallet(name, endpoint, validate) {
  await checkJson(name, endpoint, (body) => {
    expect(!body.error, `${name} returned error: ${body.error ?? ""}`);
    validate(body);
  });
}

async function checkJson(name, endpoint, validate) {
  try {
    const response = await fetch(`${apiUrl}${endpoint}`, { headers: { accept: "application/json" } });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      fail(`${name} did not return JSON: HTTP ${response.status}`);
      return;
    }
    evidence.push({ name, endpoint, status: response.status, keys: Object.keys(body).sort() });
    expect(response.ok, `${name} returned HTTP ${response.status}`);
    validate(body);
  } catch (error) {
    fail(`${name} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  failures.push(message);
}

function eqAddress(actual, expected) {
  return typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
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

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Could not read deployment manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function usage(message) {
  console.error(`${message}\nUsage: node scripts/veydrift-postdeploy-smoke.mjs [--manifest <file>] [--api-url <url>] [--wallet <0x...>]`);
  process.exit(1);
}
