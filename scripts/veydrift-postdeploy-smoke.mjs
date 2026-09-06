#!/usr/bin/env node
import { readFileSync } from "node:fs";

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? "https://api-test.veydrift.com");
const wallet = options.wallet;
const manifest = options.manifest ? readManifest(options.manifest) : null;
const rpcUrl = options["rpc-url"];
const referralSigner = options["referral-signer"];
const referralStartPriceWei = options["referral-start-price-wei"];
const runtimeStressRounds = positiveIntegerOption(options["runtime-stress-rounds"] ?? "12", "runtime-stress-rounds");
const runtimeStressP95Ms = positiveIntegerOption(options["runtime-stress-p95-ms"] ?? "500", "runtime-stress-p95-ms");
const runtimeStressTimeoutMs = positiveIntegerOption(options["runtime-stress-timeout-ms"] ?? "6000", "runtime-stress-timeout-ms");
const requestTimeoutMs = positiveIntegerOption(options["timeout-ms"] ?? String(runtimeStressTimeoutMs), "timeout-ms");
const failures = [];
const evidence = [];
let walletHomePlanetId = null;

if (manifest?.contracts.referralSystem) {
  if (!rpcUrl || !referralSigner || !referralStartPriceWei) {
    usage("Referral manifests require --rpc-url, --referral-signer, and --referral-start-price-wei for config truth checks.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(referralSigner)) usage("--referral-signer must be an EVM address.");
  if (!/^\d+$/.test(referralStartPriceWei)) usage("--referral-start-price-wei must be a non-negative integer string.");
}

await checkJson("health", "/health", (body) => {
  expect(body.ok === true, "health.ok must be true");
  expect(body.configured === true, "health.configured must be true");
  if (manifest) {
    expect(body.chain?.chainId === manifest.network.chainId, "health chain id must match manifest");
    expect(body.chain?.indexFromBlock === manifest.deployment.indexFromBlock, "health indexFromBlock must match manifest");
    expect(
      body.chain?.timedMissileIndexFromBlock === manifest.deployment.timedMissileIndexFromBlock,
      "health timedMissileIndexFromBlock must match the exact upgrade boundary"
    );
    expect(body.chain?.gameContractConfigured === true, "health must report game contract configured");
    expect(body.chain?.resourceTokenAddressesConfigured === true, "health must report resource tokens configured");
    expect(body.chain?.allianceContractConfigured === true, "health must report alliance configured");
    expect(body.chain?.moonContractConfigured === true, "health must report moon configured");
    expect(body.chain?.randomnessEngineConfigured === true, "health must report randomness configured");
    const replay = body.chainSync?.timedMissilePayloadHistoryBackfill;
    expect(replay?.fromBlock === manifest.deployment.timedMissileIndexFromBlock, "timed missile replay must start at the manifest boundary");
    expect(replay?.inProgress === false, "timed missile replay must be complete");
    expect(replay?.lastError === null, "timed missile replay must be error-free");
    expect(Boolean(replay?.completedAt), "timed missile replay must report completion evidence");
    expect(/^\d+$/.test(replay?.throughBlock ?? ""), "timed missile replay must report its through-block");
    expect(/^\d+$/.test(body.chainSync?.latestSyncedBlock ?? ""), "chain sync must report its latest block");
    if (/^\d+$/.test(replay?.throughBlock ?? "") && /^\d+$/.test(body.chainSync?.latestSyncedBlock ?? "")) {
      expect(
        BigInt(replay.throughBlock) >= BigInt(body.chainSync.latestSyncedBlock),
        "timed missile replay must cover the latest synchronized block"
      );
    }
  }
});

await checkJson("runtime-config", "/runtime-config", (body) => {
  if (manifest) {
    expect(eqAddress(body.gameContractAddress, manifest.contracts.game), "runtime game address must match manifest");
    expect(eqAddress(body.contractAddress, manifest.contracts.settlement), "runtime settlement address must match manifest");
    expect(eqAddress(body.allianceContractAddress, manifest.contracts.allianceSystem), "runtime alliance address must match manifest");
    expect(eqAddress(body.moonContractAddress, manifest.contracts.moonSystem), "runtime moon address must match manifest");
    expect(eqAddress(body.randomnessEngineAddress, manifest.contracts.randomnessEngine), "runtime randomness address must match manifest");
    if (manifest.contracts.referralSystem) {
      expect(eqAddress(body.referralSystemAddress, manifest.contracts.referralSystem), "runtime referral system address must match manifest");
      expect(eqAddress(body.referralSignerAddress, referralSigner), "runtime referral signer must match expected signer");
      expect(body.referralStartPriceWei === referralStartPriceWei, "runtime referral start price must match expected on-chain start price");
      expect(body.featureSupport?.referralsConfigured === true, "runtime featureSupport.referralsConfigured must be true when referral system is in manifest");
    }
    expect(eqAddress(body.resourceTokenAddresses?.metal, manifest.contracts.resourceTokens.metal), "runtime metal token must match manifest");
    expect(eqAddress(body.resourceTokenAddresses?.crystal, manifest.contracts.resourceTokens.crystal), "runtime crystal token must match manifest");
    expect(eqAddress(body.resourceTokenAddresses?.deuterium, manifest.contracts.resourceTokens.deuterium), "runtime deuterium token must match manifest");
  }
  expect(body.featureSupport?.researchEndpoint === true, "runtime featureSupport.researchEndpoint must be true");
  expect(body.featureSupport?.highscoresEndpoint === true, "runtime featureSupport.highscoresEndpoint must be true");
});

if (manifest?.contracts.referralSystem) {
  await checkReferralOnChain();
}

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

await checkRuntimeConfigStress(runtimeStressEndpoints());

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

async function checkReferralOnChain() {
  try {
    const [
      configuredGameWord,
      configuredSignerWord,
      migrationFinalizedWord,
      maxCodeLengthWord,
      topUpCooldownWord,
      startPriceWord,
      expectedValidHash,
      importedValidHash,
      expectedHashOnlyHash,
      importedHashOnlyHash,
      expectedValidCountWord,
      importedValidCountWord,
      expectedHashOnlyCountWord,
      importedHashOnlyCountWord,
      redemptionMigrationConfiguredWord,
      expectedRedemptionHash,
      importedRedemptionHash,
      expectedRedemptionCountWord,
      importedRedemptionCountWord
    ] = await Promise.all([
      ethCall(manifest.contracts.referralSystem, "0xc3fe3e28"),
      ethCall(manifest.contracts.referralSystem, "0xdad0eeb7"),
      ethCall(manifest.contracts.referralSystem, "0x4c52a884"),
      ethCall(manifest.contracts.referralSystem, "0x3a81d776"),
      ethCall(manifest.contracts.referralSystem, "0x574bdda8"),
      ethCall(manifest.contracts.game, "0xf1a9af89"),
      ethCall(manifest.contracts.referralSystem, "0x78b26966"),
      ethCall(manifest.contracts.referralSystem, "0x3da16ca6"),
      ethCall(manifest.contracts.referralSystem, "0x0e97551a"),
      ethCall(manifest.contracts.referralSystem, "0xec661291"),
      ethCall(manifest.contracts.referralSystem, "0xa2ca8f37"),
      ethCall(manifest.contracts.referralSystem, "0xeb3b3e12"),
      ethCall(manifest.contracts.referralSystem, "0x0b9f9f4f"),
      ethCall(manifest.contracts.referralSystem, "0xbf3158c2"),
      ethCall(manifest.contracts.referralSystem, "0x89161141"),
      ethCall(manifest.contracts.referralSystem, "0x7a79a30f"),
      ethCall(manifest.contracts.referralSystem, "0xfbc97780"),
      ethCall(manifest.contracts.referralSystem, "0x7a6d789b"),
      ethCall(manifest.contracts.referralSystem, "0xfdf11250")
    ]);
    const configuredGame = decodeAddressWord(configuredGameWord);
    const configuredSigner = decodeAddressWord(configuredSignerWord);
    const migrationFinalized = BigInt(migrationFinalizedWord) === 1n;
    const maxCodeLength = Number(BigInt(maxCodeLengthWord));
    const topUpCooldownSeconds = Number(BigInt(topUpCooldownWord));
    const expectedValidCount = Number(BigInt(expectedValidCountWord));
    const importedValidCount = Number(BigInt(importedValidCountWord));
    const expectedHashOnlyCount = Number(BigInt(expectedHashOnlyCountWord));
    const importedHashOnlyCount = Number(BigInt(importedHashOnlyCountWord));
    const redemptionMigrationConfigured = BigInt(redemptionMigrationConfiguredWord) === 1n;
    const expectedRedemptionCount = Number(BigInt(expectedRedemptionCountWord));
    const importedRedemptionCount = Number(BigInt(importedRedemptionCountWord));
    const onChainStartPriceWei = BigInt(startPriceWord).toString();
    evidence.push({
      name: "referral-on-chain-config",
      referralSystem: manifest.contracts.referralSystem,
      configuredGame,
      configuredSigner,
      migrationFinalized,
      maxCodeLength,
      topUpCooldownSeconds,
      migrationManifest: {
        sourceCommitmentSemantics: "raw legacy code hash or canonical owner-bound commitment",
        expectedValidHash,
        importedValidHash,
        expectedHashOnlyHash,
        importedHashOnlyHash,
        expectedValidCount,
        importedValidCount,
        expectedHashOnlyCount,
        importedHashOnlyCount,
        redemptionMigrationConfigured,
        expectedRedemptionHash,
        importedRedemptionHash,
        expectedRedemptionCount,
        importedRedemptionCount
      },
      startPriceWei: onChainStartPriceWei
    });
    expect(eqAddress(configuredGame, manifest.contracts.game), "referral system game() must match manifest game proxy");
    expect(eqAddress(configuredSigner, referralSigner), "referral system referralSigner() must match expected signer");
    expect(migrationFinalized, "referral code migration must be finalized before rollout");
    expect(maxCodeLength === 24, "referral system must expose the canonical 24-character code limit");
    expect(topUpCooldownSeconds === 86_400, "referral top-up cooldown must be exactly 24 hours");
    expect(expectedValidCount > 0, "referral migration must commit at least one reviewed valid code");
    expect(importedValidCount === expectedValidCount, "referral valid-code migration count must match its reviewed manifest");
    expect(eqHex(importedValidHash, expectedValidHash), "referral valid-code migration hash must match its reviewed manifest");
    expect(expectedHashOnlyCount === 10, "referral migration must preserve the 10 reviewed hash-only legacy codes");
    expect(importedHashOnlyCount === expectedHashOnlyCount, "referral hash-only migration count must match its reviewed manifest");
    expect(eqHex(importedHashOnlyHash, expectedHashOnlyHash), "referral hash-only migration hash must match its reviewed manifest");
    expect(redemptionMigrationConfigured, "referral redemption migration must be explicitly configured");
    expect(importedRedemptionCount === expectedRedemptionCount, "referral redemption migration count must match its reviewed manifest");
    expect(eqHex(importedRedemptionHash, expectedRedemptionHash), "referral redemption migration hash must match its reviewed manifest");
    expect(onChainStartPriceWei === referralStartPriceWei, "game startPrice() must match referral/backend start price");
  } catch (error) {
    fail(`referral on-chain config check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ethCall(to, data) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const body = await response.json();
  if (!response.ok || body.error || typeof body.result !== "string") {
    throw new Error(body.error?.message ?? `RPC HTTP ${response.status}`);
  }
  return body.result;
}

function decodeAddressWord(value) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`invalid address word: ${value}`);
  return `0x${value.slice(-40)}`;
}

function eqHex(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

async function checkJson(name, endpoint, validate) {
  const sample = await timedJson(endpoint, requestTimeoutMs);
  evidence.push({
    name,
    endpoint,
    status: sample.status,
    ms: sample.ms,
    timedOut: sample.timedOut,
    ...(sample.body && typeof sample.body === "object" ? { keys: Object.keys(sample.body).sort() } : {}),
    ...(sample.error ? { error: sample.error } : {})
  });
  if (!sample.ok) {
    fail(sample.timedOut
      ? `${name} timed out after ${requestTimeoutMs}ms`
      : `${name} request failed: ${sample.error ?? `HTTP ${sample.status ?? "unknown"}`}`);
    return;
  }
  validate(sample.body);
}

async function checkRuntimeConfigStress(noisyEndpoints) {
  const runtimeSamples = [];
  const noisySamples = [];
  for (let round = 0; round < runtimeStressRounds; round += 1) {
    const [runtime, ...noisy] = await Promise.all([
      timedJson("/runtime-config", runtimeStressTimeoutMs),
      ...noisyEndpoints.map((endpoint) => timedJson(endpoint, runtimeStressTimeoutMs))
    ]);
    runtimeSamples.push(runtime);
    noisySamples.push(...noisy.map((sample) => ({ ...sample, round })));
  }

  const runtimeLatencies = runtimeSamples.map((sample) => sample.ms).sort((left, right) => left - right);
  const runtimeP95Ms = percentile(runtimeLatencies, 95);
  const badRuntimeSamples = runtimeSamples.filter((sample) => !sample.ok || sample.status === 429 || sample.timedOut);
  const badNoisySamples = noisySamples.filter((sample) => !sample.ok || sample.status === 429 || sample.timedOut);
  evidence.push({
    name: "runtime-config-stress",
    endpoint: "/runtime-config",
    rounds: runtimeStressRounds,
    p95Ms: runtimeP95Ms,
    maxMs: Math.max(0, ...runtimeLatencies),
    noisyEndpoints,
    runtimeStatuses: runtimeSamples.map((sample) => sample.status),
    noisyStatuses: noisySamples.map((sample) => ({ endpoint: sample.endpoint, status: sample.status, error: sample.error }))
  });

  expect(badRuntimeSamples.length === 0, "runtime-config stress returned non-2xx, 429, or timed out");
  expect(badNoisySamples.length === 0, "runtime-config noisy stress endpoints returned non-2xx, 429, or timed out");
  expect(runtimeP95Ms <= runtimeStressP95Ms, `runtime-config stress p95 ${runtimeP95Ms}ms exceeded ${runtimeStressP95Ms}ms`);
}

function runtimeStressEndpoints() {
  const endpoints = [
    "/universe/galaxies/6/systems/9",
    "/universe/galaxies/1/systems/1",
    "/highscores?limit=10"
  ];
  if (wallet) {
    const planetId = walletHomePlanetId ?? "1";
    endpoints.push(
      `/wallet/${wallet}/overview?planetId=${encodeURIComponent(String(planetId))}`,
      `/wallet/${wallet}/infrastructure?planetId=${encodeURIComponent(String(planetId))}`
    );
  }
  return endpoints;
}

async function timedJson(endpoint, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    const body = JSON.parse(text);
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      body,
      error: body?.error ?? undefined,
      timedOut: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();
    return {
      endpoint,
      ok: false,
      status: null,
      ms: Date.now() - started,
      body: null,
      error: message,
      timedOut: normalizedMessage.includes("abort")
    };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index] ?? 0;
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

function positiveIntegerOption(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== String(value)) {
    usage(`--${name} must be a positive integer.`);
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
  console.error(
    `${message}\nUsage: node scripts/veydrift-postdeploy-smoke.mjs [--manifest <file>] ` +
      `[--api-url <url>] [--wallet <0x...>] [--timeout-ms 6000] [--runtime-stress-rounds 12] ` +
      `[--runtime-stress-p95-ms 500] [--runtime-stress-timeout-ms 6000] ` +
      `[--rpc-url <url> --referral-signer <0x...> --referral-start-price-wei <wei>]`
  );
  process.exit(1);
}
