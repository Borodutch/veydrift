#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import type { Address, DefenseState, ShipyardState } from "./evm";
import {
  compareFleetDefenseParity,
  type FleetDefenseUnitCount,
  type FleetDefenseUnitKind
} from "./fleetDefenseParity";
import { defenseCount, supportedShipIds } from "./readModels";

type DebugFleetDefenseState = {
  counts?: FleetDefenseUnitCount[];
  indexer?: unknown;
};

const shipCountSelector = "0x57686701";
const defenseCountSelector = "0x836e3a32";
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? process.env.VEYDRIFT_API_URL ?? "https://api-test.veydrift.com");
const rpcUrl = options["rpc-url"] ?? process.env.VEYDRIFT_RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const warmupPasses = parsePositiveInt(options["warmup-passes"], 2);
const apiTimeoutMs = parsePositiveInt(options["api-timeout-ms"], 15_000);
const rpcTimeoutMs = parsePositiveInt(options["rpc-timeout-ms"], 20_000);

try {
  await main();
} catch (error) {
  const artifact = {
    checkedAt: new Date().toISOString(),
    ok: false,
    apiUrl,
    rpcUrl: redactUrl(rpcUrl),
    failure: {
      kind: "guard_execution_failed",
      message: error instanceof Error ? error.message : String(error)
    },
    repairGate: null
  };
  writeArtifact(artifact);
  console.error(`fleet/defense parity guard failed before comparison: ${artifact.failure.message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const gameAddress = await resolveGameAddress();
  const rawState = await fetchJson<DebugFleetDefenseState>(`${apiUrl}/debug/fleet-defense-state`, apiTimeoutMs);
  const rawCounts = rawState.counts ?? [];
  const chainCounts = await readChainCounts(gameAddress, rawCounts);
  const apiCounts = await readApiCounts(rawCounts, warmupPasses);
  const report = compareFleetDefenseParity(chainCounts, rawCounts, apiCounts);
  const artifact = {
    ...report,
    apiUrl,
    rpcUrl: redactUrl(rpcUrl),
    gameAddress,
    checkedPlanets: new Set(rawCounts.map((count) => count.planetId)).size,
    checkedUnits: {
      chain: chainCounts.length,
      raw: rawCounts.length,
      api: apiCounts.length
    },
    indexer: rawState.indexer ?? null,
    repairGate: report.summary.raw_db_mismatch > 0
      ? {
          reason: "raw indexed DB unit counts diverge from on-chain shipCount/defenseCount",
          backendTestCommand: "cd apps/backend && bun run index:seed-current",
          rerunCommand: "cd apps/backend && bun run fleet-defense:parity -- --api-url https://api-test.veydrift.com --out /Users/borodutch/.openclaw/workspace/artifacts/veydrift_fleet_defense_parity_<timestamp>.json"
        }
      : null
  };

  writeArtifact(artifact);

  if (!artifact.ok) {
    for (const item of artifact.discrepancies.slice(0, 25)) {
      console.error(
        `${item.kind}: planet ${item.planetId} ${item.unitKind} ${item.unitId} (${item.unitName}) chain=${item.chain} raw=${item.raw ?? "missing"} api=${item.api ?? "missing"} owner=${item.owner}`
      );
    }
    if (artifact.repairGate) {
      console.error(`raw_db_mismatch repair gate: ${artifact.repairGate.backendTestCommand}; then rerun parity guard.`);
    }
    if (artifact.discrepancies.length > 25) {
      console.error(`...${artifact.discrepancies.length - 25} more discrepancies`);
    }
    process.exit(1);
  }
}

async function resolveGameAddress(): Promise<Address> {
  const explicit = options.game ?? process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS ?? process.env.VEYDRIFT_CONTRACT_ADDRESS;
  if (explicit) return normalizeAddress(explicit, "game");
  const runtime = await fetchJson<Record<string, unknown>>(`${apiUrl}/runtime-config`, apiTimeoutMs);
  return normalizeAddress(
    typeof runtime.gameContractAddress === "string" ? runtime.gameContractAddress : runtime.contractAddress,
    "runtime game"
  );
}

async function readApiCounts(rawCounts: readonly FleetDefenseUnitCount[], warmups: number): Promise<FleetDefenseUnitCount[]> {
  const byPlanet = planetsFromRawCounts(rawCounts);
  const counts: FleetDefenseUnitCount[] = [];

  for (const planet of byPlanet.values()) {
    const encodedWallet = encodeURIComponent(planet.owner);
    const encodedPlanet = encodeURIComponent(planet.planetId);
    let shipyard: ShipyardState | null = null;
    let defenses: DefenseState | null = null;
    for (let pass = 0; pass < warmups; pass += 1) {
      shipyard = await fetchJson<ShipyardState>(`${apiUrl}/wallet/${encodedWallet}/shipyard?planetId=${encodedPlanet}`, apiTimeoutMs);
      defenses = await fetchJson<DefenseState>(`${apiUrl}/wallet/${encodedWallet}/defenses?planetId=${encodedPlanet}`, apiTimeoutMs);
    }
    for (const ship of shipyard?.ships ?? []) {
      counts.push({
        count: ship.count,
        owner: planet.owner,
        planetId: planet.planetId,
        unitId: ship.id,
        unitKind: "ship"
      });
    }
    for (const defense of defenses?.defenses ?? []) {
      counts.push({
        count: defense.count,
        owner: planet.owner,
        planetId: planet.planetId,
        unitId: defense.id,
        unitKind: "defense"
      });
    }
  }

  return counts;
}

async function readChainCounts(gameAddress: Address, rawCounts: readonly FleetDefenseUnitCount[]): Promise<FleetDefenseUnitCount[]> {
  const planets = planetsFromRawCounts(rawCounts);
  const requests = [...planets.values()].flatMap((planet) => [
    ...supportedShipIds.map((unitId) => ({ planet, unitId, unitKind: "ship" as const })),
    ...Array.from({ length: defenseCount }, (_, unitId) => ({ planet, unitId, unitKind: "defense" as const }))
  ]);
  const chunks = chunked(requests, parsePositiveInt(options["rpc-batch-size"], 40));
  const counts: FleetDefenseUnitCount[] = [];
  let id = 1;
  for (const chunk of chunks) {
    const batch = chunk.map((request) => ({ request, rpcId: id++ }));
    const body = batch.map(({ request, rpcId }) => ({
      jsonrpc: "2.0",
      id: rpcId,
      method: "eth_call",
      params: [{
        to: gameAddress,
        data: `${request.unitKind === "ship" ? shipCountSelector : defenseCountSelector}${encodeUint(BigInt(request.planet.planetId))}${encodeUint(BigInt(request.unitId))}`
      }, "latest"]
    }));
    const responses = await rpcBatch(body);
    const responsesById = new Map(responses.map((response) => [response.id, response]));
    for (const { request, rpcId } of batch) {
      const response = responsesById.get(rpcId);
      if (!response || response.error) {
        throw new Error(`RPC eth_call failed for ${request.unitKind} ${request.unitId} on planet ${request.planet.planetId}: ${response?.error?.message ?? "missing response"}`);
      }
      counts.push({
        count: Number(decodeUint(response.result)),
        owner: request.planet.owner,
        planetId: request.planet.planetId,
        unitId: request.unitId,
        unitKind: request.unitKind
      });
    }
  }
  return counts;
}

async function rpcBatch(body: Array<Record<string, unknown>>): Promise<Array<{ error?: { message?: string }; id: number; result: string }>> {
  const response = await fetchWithTimeout(rpcUrl, rpcTimeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  if (!Array.isArray(json)) throw new Error("RPC endpoint did not return a batch response.");
  return json;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, timeoutMs, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return body as T;
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function writeArtifact(artifact: unknown): void {
  const output = `${JSON.stringify(artifact, null, 2)}\n`;
  if (options.out) {
    writeFileSync(options.out, output);
  } else {
    process.stdout.write(output);
  }
}

function planetsFromRawCounts(rawCounts: readonly FleetDefenseUnitCount[]): Map<string, { owner: Address; planetId: string }> {
  const planets = new Map<string, { owner: Address; planetId: string }>();
  for (const count of rawCounts) {
    planets.set(count.planetId, { owner: count.owner.toLowerCase() as Address, planetId: count.planetId });
  }
  return planets;
}

function normalizeAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error(`Missing or invalid ${label} address.`);
  }
  return value.toLowerCase() as Address;
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function decodeUint(hex: string): bigint {
  return BigInt(hex || "0x0");
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function redactUrl(value: string): string {
  return value.replace(/([?&](?:api[_-]?key|key|token)=)[^&]+/gi, "$1<redacted>");
}

function parseArgs(args: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) usage("Missing argument.");
    if (!arg.startsWith("--")) usage(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "help") usage();
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usage(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: bun apps/backend/src/fleetDefenseParityGuard.ts [--api-url <url>] [--rpc-url <url>] [--game <address>] [--warmup-passes <n>] [--rpc-batch-size <n>] [--api-timeout-ms <n>] [--rpc-timeout-ms <n>] [--out <file>]"
  );
  process.exit(message ? 1 : 0);
}
