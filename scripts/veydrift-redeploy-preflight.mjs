#!/usr/bin/env node

import { writeFileSync } from "node:fs";

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? "https://api-test.veydrift.com");
const rpcUrl = options["rpc-url"] ?? process.env.VEYDRIFT_RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const evidence = [];
const blockers = [];

const health = await fetchJsonEvidence("backend:health", `${apiUrl}/health`);
const runtime = await fetchJsonEvidence("backend:runtime-config", `${apiUrl}/runtime-config`);
const indexer = await fetchJsonEvidence("backend:debug-indexer", `${apiUrl}/debug/indexer`);

const gameAddress = normalizedAddress(
  options.game ?? runtime.body?.gameContractAddress ?? runtime.body?.contractAddress,
  "game"
);
const resourceTokens = {
  metal: normalizedAddress(options.metal ?? runtime.body?.resourceTokenAddresses?.metal, "metal", false),
  crystal: normalizedAddress(options.crystal ?? runtime.body?.resourceTokenAddresses?.crystal, "crystal", false),
  deuterium: normalizedAddress(options.deuterium ?? runtime.body?.resourceTokenAddresses?.deuterium, "deuterium", false)
};

let implementationAddress = null;
let proxyUpgradeable = null;
const reserveEvidence = {};

if (gameAddress) {
  const implementationWord = await rpc("eth_getStorageAt", [gameAddress, ERC1967_IMPLEMENTATION_SLOT, "latest"]);
  if (implementationWord.ok) {
    implementationAddress = wordToAddress(implementationWord.value);
    proxyUpgradeable = implementationAddress !== ZERO_ADDRESS;
    evidence.push({
      name: "chain:erc1967-implementation-slot",
      ok: true,
      game: gameAddress,
      implementation: implementationAddress,
      proxyUpgradeable
    });
  } else {
    blockers.push(`Could not read ERC1967 implementation slot for ${gameAddress}: ${implementationWord.error}`);
    evidence.push({
      name: "chain:erc1967-implementation-slot",
      ok: false,
      game: gameAddress,
      error: implementationWord.error
    });
  }
}

for (const [resource, token] of Object.entries(resourceTokens)) {
  if (!gameAddress || !token) continue;
  const [balance, owner] = await Promise.all([
    ethCallRaw(token, encodeSelectorAddress("70a08231", gameAddress)),
    ethCallRaw(token, "0x8da5cb5b")
  ]);
  reserveEvidence[resource] = {
    token,
    balance: balance.ok ? BigInt(balance.value).toString() : null,
    owner: owner.ok ? wordToAddress(owner.value) : null,
    balanceError: balance.ok ? undefined : balance.error,
    ownerError: owner.ok ? undefined : owner.error
  };
  evidence.push({
    name: `chain:${resource}-reserve`,
    ok: balance.ok && owner.ok,
    ...reserveEvidence[resource]
  });
  if (!balance.ok) blockers.push(`Could not read ${resource} reserve balance: ${balance.error}`);
  if (!owner.ok) blockers.push(`Could not read ${resource} token owner: ${owner.error}`);
}

const stateEvidence = summarizeStateEvidence({ health: health.body, indexer: indexer.body });
const hasKnownAlphaState = stateEvidence.signals.some((signal) => signal.value > 0);
const stateEvidenceComplete = health.ok && indexer.ok && stateEvidence.signals.length > 0;
const nonzeroReserves = Object.values(reserveEvidence).some((entry) => BigInt(entry.balance ?? "0") > 0n);

if (!gameAddress) {
  blockers.push("Missing game contract address. Provide --game or fix /runtime-config.");
}
if (!health.ok) {
  blockers.push("Backend /health is unavailable; cannot capture pre-migration readiness/config evidence.");
}
if (!runtime.ok) {
  blockers.push("Backend /runtime-config is unavailable; cannot capture current deployed address evidence.");
}
if (!indexer.ok) {
  blockers.push("Backend /debug/indexer is unavailable; cannot prove indexer state/export position.");
}
if (proxyUpgradeable === false && !options["migration-plan-approved"] && !options["no-alpha-state"]) {
  blockers.push(
    "Live VeydriftGame is not an ERC1967 proxy. Full redeploy is blocked until `Migration plan approved` or `No alpha player state exists` evidence is recorded."
  );
}
if (proxyUpgradeable === false && nonzeroReserves && !options["migration-plan-approved"]) {
  blockers.push(
    "Current game holds nonzero resource reserves. Replacement requires a reviewed reserve migration or token-owner action before broadcast."
  );
}
if (options["no-alpha-state"] && hasKnownAlphaState) {
  blockers.push("`--no-alpha-state` was supplied, but backend/indexer evidence reports existing alpha state.");
}
if (options["no-alpha-state"] && !stateEvidenceComplete) {
  blockers.push("`--no-alpha-state` requires complete backend/indexer evidence proving no alpha state.");
}
if (!options["no-alpha-state"] && !options["migration-plan-approved"] && !stateEvidenceComplete) {
  blockers.push("State evidence is incomplete. Fail closed until backend/indexer state can be exported or a migration plan is approved.");
}
for (const [resource, token] of Object.entries(resourceTokens)) {
  if (!token) blockers.push(`Missing ${resource} resource token address for reserve verification.`);
}

const result = {
  ok: blockers.length === 0,
  apiUrl,
  rpcUrl: redactUrl(rpcUrl),
  checkedAt: new Date().toISOString(),
  gameAddress,
  implementationAddress,
  proxyUpgradeable,
  resourceTokens,
  reserves: reserveEvidence,
  stateEvidence,
  declarations: {
    noAlphaState: Boolean(options["no-alpha-state"]),
    migrationPlanApproved: Boolean(options["migration-plan-approved"])
  },
  blockers,
  evidence
};

const output = `${JSON.stringify(result, null, 2)}\n`;
if (options.out) {
  writeFileSync(options.out, output);
} else {
  process.stdout.write(output);
}
if (!result.ok) process.exit(1);

async function fetchJsonEvidence(name, url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      evidence.push({ name, ok: false, status: response.status, error: "non-json response" });
      return { ok: false, status: response.status, body: null };
    }
    evidence.push({ name, ok: response.ok, status: response.status, keys: Object.keys(body).sort() });
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    evidence.push({ name, ok: false, error: errorMessage(error) });
    return { ok: false, status: 0, body: null };
  }
}

async function ethCallRaw(to, data) {
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  if (!result.ok) return result;
  return { ok: true, value: result.value };
}

async function rpc(method, params) {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      return { ok: false, error: body.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, value: body.result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function summarizeStateEvidence(sources) {
  const signals = [];
  collectSignals("health", sources.health, signals);
  collectSignals("indexer", sources.indexer, signals);
  return {
    complete: signals.length > 0,
    hasKnownAlphaState: signals.some((signal) => signal.value > 0),
    signals
  };
}

function collectSignals(prefix, value, signals, path = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof child === "number" && Number.isFinite(child) && stateSignalKey(key)) {
      signals.push({ source: prefix, path: nextPath.join("."), value: child });
    } else if (typeof child === "string" && /^[0-9]+$/.test(child) && stateSignalKey(key)) {
      signals.push({ source: prefix, path: nextPath.join("."), value: Number(child) });
    } else if (child && typeof child === "object") {
      collectSignals(prefix, child, signals, nextPath);
    }
  }
}

function stateSignalKey(key) {
  return /planet|moon|queue|fleet|alliance|debris|rift|research|resource|indexed|settled/i.test(key);
}

function normalizedAddress(value, label, required = true) {
  if (!value) {
    if (required) blockers.push(`Missing ${label} address.`);
    return null;
  }
  if (!addressPattern.test(value)) {
    blockers.push(`${label} address is invalid: ${value}`);
    return null;
  }
  return value;
}

function encodeSelectorAddress(selector, address) {
  return `0x${selector}${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function wordToAddress(word) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(word)) return ZERO_ADDRESS;
  return `0x${word.slice(-40)}`;
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function redactUrl(value) {
  return value.replace(/([?&](?:api[_-]?key|key|token)=)[^&]+/gi, "$1<redacted>");
}

function parseArgs(args) {
  const parsed = {};
  const flags = new Set(["migration-plan-approved", "no-alpha-state"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) usage(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "help") usage();
    if (flags.has(key)) {
      parsed[key] = true;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usage(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  if (parsed["migration-plan-approved"] && parsed["no-alpha-state"]) {
    usage("Choose either --migration-plan-approved or --no-alpha-state, not both.");
  }
  return parsed;
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/veydrift-redeploy-preflight.mjs [--api-url <url>] [--rpc-url <url>] [--game <address>] [--metal <address>] [--crystal <address>] [--deuterium <address>] [--migration-plan-approved | --no-alpha-state] [--out <file>]"
  );
  process.exit(message ? 1 : 0);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
