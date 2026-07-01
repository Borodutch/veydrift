#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import type { Address, DefenseState, ShipyardState } from "./evm";
import {
  compareFleetDefenseParity,
  type FleetDefenseUnitCount,
  type FleetDefenseUnitKind
} from "./fleetDefenseParity";
import { SettlementIndexer } from "./indexer";
import { defenseCount, supportedShipIds } from "./readModels";

type ApiMission = {
  arrivalAt: string;
  missionId: string;
  needsResolution?: boolean;
  owner: Address;
  originPlanetId: string;
  returnAt: string;
  resolutionBlocker?: string;
  status: string;
};

const shipCountSelector = "0x57686701";
const defenseCountSelector = "0x836e3a32";
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const missionStatuses = ["None", "Outbound", "Returning", "Resolved", "Returned", "Recalled"] as const;
const missionParityAbi = [
  {
    type: "function",
    name: "fleetMission",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "missionId" }],
    outputs: [
      { type: "uint8", name: "status" },
      { type: "uint8", name: "missionType" },
      { type: "address", name: "owner" },
      { type: "uint256", name: "originPlanetId" },
      { type: "uint256", name: "targetPlanetId" },
      { type: "uint64", name: "departureAt" },
      { type: "uint64", name: "arrivalAt" },
      { type: "uint64", name: "returnAt" },
      { type: "uint128", name: "fuelCost" },
      {
        type: "tuple",
        name: "cargo",
        components: [
          { type: "uint128", name: "metal" },
          { type: "uint128", name: "crystal" },
          { type: "uint128", name: "deuterium" }
        ]
      },
      { type: "uint256", name: "randomnessRequestId" }
    ]
  },
  {
    type: "function",
    name: "activeFleetMissionCount",
    stateMutability: "view",
    inputs: [{ type: "address", name: "player" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? process.env.VEYDRIFT_API_URL ?? "https://api-test.veydrift.com");
const indexDbPath = options["index-db"] ?? process.env.VEYDRIFT_INDEX_DB_PATH;
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
  const rawState = readRawFleetDefenseState();
  const rawCounts = rawState.counts;
  const activeMissions = await readActiveMissions();
  const missionParity = await readMissionParity(gameAddress, activeMissions);
  const fleetSlotParity = await readFleetSlotParity(gameAddress, rawCounts, activeMissions);
  const chainCounts = await readChainCounts(gameAddress, rawCounts);
  const apiCounts = await readApiCounts(rawCounts, warmupPasses);
  const report = compareFleetDefenseParity(chainCounts, rawCounts, apiCounts);
  const ok = report.ok && missionParity.discrepancies.length === 0 && fleetSlotParity.discrepancies.length === 0;
  const artifact = {
    ...report,
    ok,
    apiUrl,
    rpcUrl: redactUrl(rpcUrl),
    gameAddress,
    missionParity,
    fleetSlotParity,
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
    for (const item of missionParity.discrepancies.slice(0, 25)) {
      console.error(
        `${item.kind}: mission ${item.missionId} api=${item.apiStatus} chain=${item.chainStatus ?? "n/a"} arrivalAt=${item.arrivalAt} returnAt=${item.returnAt} owner=${item.owner}`
      );
    }
    for (const item of fleetSlotParity.discrepancies.slice(0, 25)) {
      console.error(
        `${item.kind}: owner=${item.owner} api=${item.apiActive} chain=${item.chainActive} planet=${item.planetId}`
      );
    }
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

function readRawFleetDefenseState(): { counts: FleetDefenseUnitCount[]; indexer: unknown } {
  if (!indexDbPath) {
    throw new Error("Set --index-db or VEYDRIFT_INDEX_DB_PATH; public fleet/defense debug endpoints are removed.");
  }
  const indexer = new SettlementIndexer({} as ConstructorParameters<typeof SettlementIndexer>[0], 0n, {
    databasePath: indexDbPath,
    readOnly: true
  });
  return {
    counts: indexer.fleetDefenseRawCounts(),
    indexer: indexer.snapshot()
  };
}

async function readActiveMissions(): Promise<ApiMission[]> {
  const body = await fetchJson<{ missions?: ApiMission[] }>(`${apiUrl}/missions`, apiTimeoutMs);
  return (body.missions ?? []).filter((mission) => mission?.missionId && mission?.owner);
}

async function readMissionParity(gameAddress: Address, activeMissions: readonly ApiMission[]): Promise<{
  checked: number;
  discrepancies: Array<{
    arrivalAt: string;
    apiStatus: string;
    chainStatus?: string;
    kind: "api_chain_status_mismatch" | "due_active_mission";
    missionId: string;
    owner: Address;
    returnAt: string;
  }>;
}> {
  const limit = parsePositiveInt(options["mission-parity-limit"], 250);
  const missions = activeMissions.slice(0, limit);
  const calls = missions.map((mission) => ({
    mission,
    data: encodeFunctionData({
      abi: missionParityAbi,
      functionName: "fleetMission",
      args: [BigInt(mission.missionId)]
    })
  }));
  const responses = await rpcBatch(calls.map((call, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_call",
    params: [{ to: gameAddress, data: call.data }, "latest"]
  })));
  const byId = new Map(responses.map((response) => [response.id, response]));
  const discrepancies: Awaited<ReturnType<typeof readMissionParity>>["discrepancies"] = [];
  const now = Math.floor(Date.now() / 1_000);

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (!call) continue;
    const response = byId.get(index + 1);
    if (!response || response.error) {
      throw new Error(`RPC fleetMission(${call.mission.missionId}) failed: ${response?.error?.message ?? "missing response"}`);
    }
    const decoded = decodeFunctionResult({
      abi: missionParityAbi,
      functionName: "fleetMission",
      data: response.result as `0x${string}`
    });
    const chainStatus = missionStatuses[Number(decoded[0])] ?? `Unknown:${String(decoded[0])}`;
    if (call.mission.status !== chainStatus) {
      discrepancies.push({
        arrivalAt: call.mission.arrivalAt,
        apiStatus: call.mission.status,
        chainStatus,
        kind: "api_chain_status_mismatch",
        missionId: call.mission.missionId,
        owner: call.mission.owner,
        returnAt: call.mission.returnAt
      });
    }
    const arrivalDue = call.mission.status === "Outbound"
      && Number(call.mission.arrivalAt) <= now
      && call.mission.needsResolution === true
      && !call.mission.resolutionBlocker;
    const returnDue = (call.mission.status === "Returning" || call.mission.status === "Recalled")
      && Number(call.mission.returnAt) <= now;
    if (arrivalDue || returnDue) {
      discrepancies.push({
        arrivalAt: call.mission.arrivalAt,
        apiStatus: call.mission.status,
        chainStatus,
        kind: "due_active_mission",
        missionId: call.mission.missionId,
        owner: call.mission.owner,
        returnAt: call.mission.returnAt
      });
    }
  }

  return { checked: missions.length, discrepancies };
}

async function readFleetSlotParity(
  gameAddress: Address,
  rawCounts: readonly FleetDefenseUnitCount[],
  activeMissions: readonly ApiMission[]
): Promise<{
  checked: number;
  discrepancies: Array<{
    apiActive: number;
    chainActive: number;
    kind: "active_fleet_slot_mismatch";
    owner: Address;
    planetId: string;
  }>;
}> {
  const owners = ownerPlanetRefs(rawCounts, activeMissions);
  const calls = [...owners.values()].map((ref) => ({
    ref,
    data: encodeFunctionData({
      abi: missionParityAbi,
      functionName: "activeFleetMissionCount",
      args: [ref.owner]
    })
  }));
  const responses = await rpcBatch(calls.map((call, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_call",
    params: [{ to: gameAddress, data: call.data }, "latest"]
  })));
  const byId = new Map(responses.map((response) => [response.id, response]));
  const discrepancies: Awaited<ReturnType<typeof readFleetSlotParity>>["discrepancies"] = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (!call) continue;
    const response = byId.get(index + 1);
    if (!response || response.error) {
      throw new Error(`RPC activeFleetMissionCount(${call.ref.owner}) failed: ${response?.error?.message ?? "missing response"}`);
    }
    const decoded = decodeFunctionResult({
      abi: missionParityAbi,
      functionName: "activeFleetMissionCount",
      data: response.result as `0x${string}`
    });
    const chainActive = Number(decoded);
    const shipyard = await fetchJson<ShipyardState>(
      `${apiUrl}/wallet/${encodeURIComponent(call.ref.owner)}/shipyard?planetId=${encodeURIComponent(call.ref.planetId)}`,
      apiTimeoutMs
    );
    const apiActive = Number(shipyard.fleetSlots?.active ?? 0);
    if (apiActive !== chainActive) {
      discrepancies.push({
        apiActive,
        chainActive,
        kind: "active_fleet_slot_mismatch",
        owner: call.ref.owner,
        planetId: call.ref.planetId
      });
    }
  }

  return { checked: calls.length, discrepancies };
}

function ownerPlanetRefs(
  rawCounts: readonly FleetDefenseUnitCount[],
  activeMissions: readonly ApiMission[]
): Map<string, { owner: Address; planetId: string }> {
  const refs = new Map<string, { owner: Address; planetId: string }>();
  for (const count of rawCounts) {
    refs.set(count.owner.toLowerCase(), { owner: count.owner.toLowerCase() as Address, planetId: count.planetId });
  }
  for (const mission of activeMissions) {
    refs.set(mission.owner.toLowerCase(), {
      owner: mission.owner.toLowerCase() as Address,
      planetId: mission.originPlanetId
    });
  }
  return refs;
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
    "Usage: bun apps/backend/src/fleetDefenseParityGuard.ts [--api-url <url>] [--index-db <path>] [--rpc-url <url>] [--game <address>] [--warmup-passes <n>] [--mission-parity-limit <n>] [--rpc-batch-size <n>] [--api-timeout-ms <n>] [--rpc-timeout-ms <n>] [--out <file>]"
  );
  process.exit(message ? 1 : 0);
}
