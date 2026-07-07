import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodeAbiParameters, isHex, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadBackendConfig } from "./config";
import {
  VeydriftGameReader,
  type Address,
  type CanonicalFleetMissionDetails,
  type CanonicalPlanetChainState,
  type ChainReader,
  type FleetMissionSummary,
  type MoonState,
  type QueueState,
  type ResearchState,
  type Resources,
  type SettledPlanetEvent
} from "./evm";

type MigrationSnapshotReader = Pick<
  ChainReader,
  "getCanonicalPlanetState" | "getMoonState" | "getResearchState" | "listCurrentPlanets"
> & {
  listCanonicalFleetMissionDetails?: () => Promise<CanonicalFleetMissionDetails[]>;
  listFleetMissionSummaries?: () => Promise<FleetMissionSummary[]>;
};

type ResourceValue = {
  metal: bigint;
  crystal: bigint;
  deuterium: bigint;
};

type QueueValue = {
  active: boolean;
  itemId: number;
  targetLevel: number;
  quantity: number;
  readyAt: bigint;
  cost: ResourceValue;
};

type MigrationMoonValue = {
  fields: number;
  diameterKm: number;
  createdAt: bigint;
  jumpGateReadyAt: bigint;
  resources: ResourceValue;
  buildingLevels: number[];
  shipCounts: number[];
  defenseCounts: number[];
  buildingQueue: QueueValue;
  defenseQueue: QueueValue;
};

type MigrationPlanetValue = {
  planetId: bigint;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  temperature: number;
  lastSettledAt: bigint;
  name: string;
  resources: ResourceValue;
  buildingLevels: number[];
  shipCounts: number[];
  defenseCounts: number[];
  buildingQueue: QueueValue;
  defenseQueue: QueueValue;
  shipQueue: QueueValue;
  defenseBacklog: QueueValue[];
  shipBacklog: QueueValue[];
  hasMoon: boolean;
  moon: MigrationMoonValue;
};

type MigrationPlayerValue = {
  player: Address;
  homePlanetId: bigint;
  technologyLevels: number[];
  researchQueue: QueueValue;
  planets: MigrationPlanetValue[];
};

type SnapshotMission = {
  missionId: string;
  status: string;
  owner: Address;
  originPlanetId: string;
  cargo: Resources;
  fuelCost: string;
  ships: Record<string, string>;
  originIsMoon?: boolean;
  returnCargo?: Resources | null;
};

export type MigrationSnapshotClaim = {
  statePayload: Hex;
  signature: Hex;
  stateHash: Hex;
};

export type MigrationSnapshotOutput = {
  snapshotMetadata: {
    generatedAt: string;
    cutoffUnix: string;
    chainId: number;
    migrationContractAddress: Address;
    playerCount: number;
    planetCount: number;
    activeMissionCount: number;
    policy: {
      alliances: "excluded";
      missions: "cancelled_returned_to_origin";
      missionFuel: "returned_as_deuterium";
    };
  };
  claims: Record<string, MigrationSnapshotClaim>;
};

export async function buildMigrationSnapshot(
  reader: MigrationSnapshotReader,
  options: {
    chainId: number;
    migrationContractAddress: Address;
    stateSignerPrivateKey: Hex;
    generatedAt?: Date;
  }
): Promise<MigrationSnapshotOutput> {
  if (!reader.listCurrentPlanets || !reader.getCanonicalPlanetState) {
    throw new Error("Current planet and canonical planet readers are required for migration snapshots.");
  }

  const generatedAt = options.generatedAt ?? new Date();
  const cutoffUnix = BigInt(Math.floor(generatedAt.getTime() / 1000));
  const account = privateKeyToAccount(options.stateSignerPrivateKey);
  const planets = await reader.listCurrentPlanets();
  const canonicalEntries = await Promise.all(
    planets.map(async (planet) => [planet.planetId, await reader.getCanonicalPlanetState!(BigInt(planet.planetId))] as const)
  );
  const canonicalByPlanetId = new Map<string, CanonicalPlanetChainState>(canonicalEntries);
  const owners = uniqueOwners(planets);
  const researchByOwner = new Map<string, ResearchState>();
  for (const owner of owners) {
    researchByOwner.set(owner.toLowerCase(), await reader.getResearchState(owner));
  }

  const moonsByPlanetId = new Map<string, MoonState>();
  for (const planet of planets) {
    moonsByPlanetId.set(planet.planetId, await reader.getMoonState(planet.owner, BigInt(planet.planetId)));
  }

  const missions = await readSnapshotMissions(reader);
  const playerStates = buildMigrationPlayerStates({
    planets,
    canonicalByPlanetId,
    researchByOwner,
    moonsByPlanetId,
    missions,
    cutoffUnix
  });

  const claims: Record<string, MigrationSnapshotClaim> = {};
  for (const state of playerStates) {
    const statePayload = encodeMigrationPlayerState(state);
    const stateHash = migrationStateHash({
      chainId: options.chainId,
      migrationContractAddress: options.migrationContractAddress,
      player: state.player,
      statePayload
    });
    const signature = await account.signMessage({ message: { raw: stateHash } });
    claims[state.player.toLowerCase()] = { statePayload, signature, stateHash };
  }

  return {
    snapshotMetadata: {
      generatedAt: generatedAt.toISOString(),
      cutoffUnix: cutoffUnix.toString(),
      chainId: options.chainId,
      migrationContractAddress: options.migrationContractAddress,
      playerCount: playerStates.length,
      planetCount: planets.length,
      activeMissionCount: activeMissions(missions).length,
      policy: {
        alliances: "excluded",
        missions: "cancelled_returned_to_origin",
        missionFuel: "returned_as_deuterium"
      }
    },
    claims
  };
}

export function buildMigrationPlayerStates(input: {
  planets: SettledPlanetEvent[];
  canonicalByPlanetId: ReadonlyMap<string, CanonicalPlanetChainState>;
  researchByOwner: ReadonlyMap<string, ResearchState>;
  moonsByPlanetId: ReadonlyMap<string, MoonState>;
  missions: SnapshotMission[];
  cutoffUnix: bigint;
}): MigrationPlayerValue[] {
  const planetsByOwner = new Map<string, MigrationPlanetValue[]>();
  const ownerAddressByKey = new Map<string, Address>();

  for (const planet of input.planets) {
    const canonical = input.canonicalByPlanetId.get(planet.planetId);
    if (!canonical) throw new Error(`Missing canonical state for planet ${planet.planetId}.`);
    const key = planet.owner.toLowerCase();
    ownerAddressByKey.set(key, planet.owner);
    const planetState = migrationPlanetValue(planet, canonical, input.moonsByPlanetId.get(planet.planetId), input.cutoffUnix);
    planetsByOwner.set(key, [...(planetsByOwner.get(key) ?? []), planetState]);
  }

  for (const mission of activeMissions(input.missions)) {
    foldCancelledMissionIntoOrigin(mission, planetsByOwner);
  }

  return [...planetsByOwner.entries()].map(([ownerKey, planets]) => {
    const owner = ownerAddressByKey.get(ownerKey);
    if (!owner) throw new Error(`Missing owner address for ${ownerKey}.`);
    const research = input.researchByOwner.get(ownerKey);
    const homePlanetId = research?.homePlanetId ?? planets[0]?.planetId.toString() ?? "0";
    return {
      player: owner,
      homePlanetId: BigInt(homePlanetId),
      technologyLevels: fixedLevels(15, research?.technologies ?? [], "level"),
      researchQueue: researchQueueValue(research?.queue ?? null),
      planets: planets.sort((left, right) => Number(left.planetId - right.planetId))
    };
  }).sort((left, right) => left.player.localeCompare(right.player));
}

export function migrationStateHash(input: {
  chainId: number;
  migrationContractAddress: Address;
  player: Address;
  statePayload: Hex;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes" }
    ],
    [BigInt(input.chainId), input.migrationContractAddress, input.player, input.statePayload]
  ));
}

export function encodeMigrationPlayerState(state: MigrationPlayerValue): Hex {
  return encodeAbiParameters(migrationPlayerStateParameters, [state as never]);
}

async function readSnapshotMissions(reader: MigrationSnapshotReader): Promise<SnapshotMission[]> {
  if (reader.listCanonicalFleetMissionDetails) {
    return (await reader.listCanonicalFleetMissionDetails()).map((mission) => ({
      missionId: mission.missionId,
      status: mission.status,
      owner: mission.owner,
      originPlanetId: mission.originPlanetId,
      cargo: mission.cargo,
      fuelCost: mission.fuelCost,
      ships: mission.ships,
      originIsMoon: mission.originIsMoon
    }));
  }
  return reader.listFleetMissionSummaries ? await reader.listFleetMissionSummaries() : [];
}

function migrationPlanetValue(
  planet: SettledPlanetEvent,
  canonical: CanonicalPlanetChainState,
  moonState: MoonState | undefined,
  cutoffUnix: bigint
): MigrationPlanetValue {
  const moon = moonState?.moon?.exists
    ? migrationMoonValue(moonState)
    : emptyMoonValue();
  return {
    planetId: BigInt(planet.planetId),
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
    fields: planet.fields,
    temperature: planet.temperature,
    lastSettledAt: cutoffUnix,
    name: planet.name ?? "",
    resources: resourceValue(canonical.resources),
    buildingLevels: fixedLevels(16, canonical.buildings, "level"),
    shipCounts: fixedLevels(16, canonical.ships, "count"),
    defenseCounts: fixedLevels(10, canonical.defenses, "count"),
    buildingQueue: buildingQueueValue(canonical.queues.building),
    defenseQueue: productionQueueValue(canonical.queues.defense),
    shipQueue: productionQueueValue(canonical.queues.ship),
    defenseBacklog: (canonical.queues.defense?.backlog ?? []).map(productionQueueValue),
    shipBacklog: (canonical.queues.ship?.backlog ?? []).map(productionQueueValue),
    hasMoon: moonState?.moon?.exists === true,
    moon
  };
}

function migrationMoonValue(state: MoonState): MigrationMoonValue {
  const moon = state.moon;
  if (!moon) return emptyMoonValue();
  return {
    fields: moon.fields,
    diameterKm: moon.diameterKm,
    createdAt: BigInt(moon.createdAt),
    jumpGateReadyAt: BigInt(moon.jumpGateReadyAt),
    resources: resourceValue(state.resources),
    buildingLevels: fixedLevels(4, state.buildings, "level"),
    shipCounts: fixedLevels(16, state.ships, "count"),
    defenseCounts: fixedLevels(10, state.defenses, "count"),
    buildingQueue: buildingQueueValue(state.queue),
    defenseQueue: productionQueueValue(state.defenseQueue)
  };
}

function foldCancelledMissionIntoOrigin(
  mission: SnapshotMission,
  planetsByOwner: Map<string, MigrationPlanetValue[]>
): void {
  const planets = planetsByOwner.get(mission.owner.toLowerCase());
  const planet = planets?.find((candidate) => candidate.planetId === BigInt(mission.originPlanetId));
  if (!planet) {
    throw new Error(`Cannot cancel mission ${mission.missionId}: origin planet ${mission.originPlanetId} is not in owner snapshot.`);
  }

  const targetShips = mission.originIsMoon ? planet.moon.shipCounts : planet.shipCounts;
  if (mission.originIsMoon && !planet.hasMoon) {
    throw new Error(`Cannot cancel mission ${mission.missionId}: origin moon ${mission.originPlanetId} is missing.`);
  }

  for (const [key, value] of Object.entries(mission.ships)) {
    const id = missionShipKeyToId(key);
    if (id === null) continue;
    targetShips[id] = checkedUint32((targetShips[id] ?? 0) + Number(value), `mission ${mission.missionId} ship ${key}`);
  }

  const resources = missionResourcesToReturn(mission);
  const targetResources = mission.originIsMoon ? planet.moon.resources : planet.resources;
  targetResources.metal += resources.metal;
  targetResources.crystal += resources.crystal;
  targetResources.deuterium += resources.deuterium;
}

function missionResourcesToReturn(mission: SnapshotMission): ResourceValue {
  const cargo = mission.returnCargo && mission.status !== "Outbound" ? mission.returnCargo : mission.cargo;
  const resources = resourceValue(cargo);
  resources.deuterium += BigInt(mission.fuelCost || "0");
  return resources;
}

function activeMissions(missions: SnapshotMission[]): SnapshotMission[] {
  return missions.filter((mission) =>
    mission.status === "Outbound"
      || mission.status === "Returning"
      || mission.status === "Recalled"
  );
}

function resourceValue(resources: Resources): ResourceValue {
  return {
    metal: BigInt(resources.metal),
    crystal: BigInt(resources.crystal),
    deuterium: BigInt(resources.deuterium)
  };
}

function emptyResourcesValue(): ResourceValue {
  return { metal: 0n, crystal: 0n, deuterium: 0n };
}

function fixedLevels<T extends { id: number }>(
  length: number,
  rows: readonly T[],
  field: T extends { level: number } ? "level" : "count"
): number[] {
  const values = Array.from({ length }, () => 0);
  for (const row of rows) {
    const value = field === "level"
      ? (row as T & { level: number }).level
      : (row as T & { count: number }).count;
    if (row.id >= 0 && row.id < length) values[row.id] = value;
  }
  return values;
}

function buildingQueueValue(queue: QueueState | null | undefined): QueueValue {
  return {
    active: queue?.active === true,
    itemId: queue?.active && queue.itemId !== undefined ? queue.itemId : 0,
    targetLevel: queue?.active && queue.targetLevel !== undefined ? queue.targetLevel : 0,
    quantity: 0,
    readyAt: queue?.active && queue.readyAt ? BigInt(queue.readyAt) : 0n,
    cost: queue?.active ? resourceValue(queue.cost) : emptyResourcesValue()
  };
}

function productionQueueValue(queue: QueueState | null | undefined): QueueValue {
  return {
    active: queue?.active === true,
    itemId: queue?.active && queue.itemId !== undefined ? queue.itemId : 0,
    targetLevel: 0,
    quantity: queue?.active && queue.quantity !== undefined ? queue.quantity : 0,
    readyAt: queue?.active && queue.readyAt ? BigInt(queue.readyAt) : 0n,
    cost: queue?.active ? resourceValue(queue.cost) : emptyResourcesValue()
  };
}

function researchQueueValue(queue: QueueState | null | undefined): QueueValue {
  return {
    active: queue?.active === true,
    itemId: queue?.active && queue.itemId !== undefined ? queue.itemId : 0,
    targetLevel: queue?.active && queue.targetLevel !== undefined ? queue.targetLevel : 0,
    quantity: 0,
    readyAt: queue?.active && queue.readyAt ? BigInt(queue.readyAt) : 0n,
    cost: queue?.active ? resourceValue(queue.cost) : emptyResourcesValue()
  };
}

function emptyMoonValue(): MigrationMoonValue {
  return {
    fields: 0,
    diameterKm: 0,
    createdAt: 0n,
    jumpGateReadyAt: 0n,
    resources: emptyResourcesValue(),
    buildingLevels: Array.from({ length: 4 }, () => 0),
    shipCounts: Array.from({ length: 16 }, () => 0),
    defenseCounts: Array.from({ length: 10 }, () => 0),
    buildingQueue: buildingQueueValue(null),
    defenseQueue: productionQueueValue(null)
  };
}

function uniqueOwners(planets: SettledPlanetEvent[]): Address[] {
  const owners = new Map<string, Address>();
  for (const planet of planets) owners.set(planet.owner.toLowerCase(), planet.owner);
  return [...owners.values()].sort((left, right) => left.localeCompare(right));
}

function checkedUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid uint32 ${label}: ${value}`);
  }
  return value;
}

function missionShipKeyToId(key: string): number | null {
  return missionShipKeyIds[key] ?? null;
}

function parseAddress(value: string | undefined, label: string): Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address.`);
  }
  return value as Address;
}

function parsePrivateKey(value: string | undefined, label: string): Hex {
  if (!value || !isHex(value) || value.length !== 66) {
    throw new Error(`${label} must be a 32-byte hex private key.`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const loaded = loadBackendConfig();
  if (loaded.problems.length > 0) {
    throw new Error(`Invalid backend config: ${loaded.problems.map((problem) => `${problem.field}: ${problem.message}`).join("; ")}`);
  }
  const destinationMigrationContract = parseAddress(
    process.env.VEYDRIFT_MIGRATION_DESTINATION_CONTRACT_ADDRESS
      ?? process.env.VEYDRIFT_MAINNET_MIGRATION_CONTRACT_ADDRESS
      ?? loaded.config.migrationContractAddress,
    "VEYDRIFT_MIGRATION_DESTINATION_CONTRACT_ADDRESS"
  );
  const outputPath = process.env.VEYDRIFT_MIGRATION_SNAPSHOT_OUTPUT_PATH
    ?? process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH
    ?? ".data/migration-state-payloads.json";
  const destinationChainId = parsePositiveInteger(
    process.env.VEYDRIFT_MIGRATION_DESTINATION_CHAIN_ID
      ?? process.env.VEYDRIFT_MAINNET_CHAIN_ID
      ?? "8453",
    "VEYDRIFT_MIGRATION_DESTINATION_CHAIN_ID"
  );
  const snapshot = await buildMigrationSnapshot(
    new VeydriftGameReader(loaded.config, undefined, { hydrateQueueStartedAt: false }),
    {
      chainId: destinationChainId,
      migrationContractAddress: destinationMigrationContract,
      stateSignerPrivateKey: parsePrivateKey(
        process.env.VEYDRIFT_MIGRATION_STATE_SIGNER_PRIVATE_KEY,
        "VEYDRIFT_MIGRATION_STATE_SIGNER_PRIVATE_KEY"
      )
    }
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.info(
    `wrote ${outputPath}: players=${snapshot.snapshotMetadata.playerCount} planets=${snapshot.snapshotMetadata.planetCount} activeMissions=${snapshot.snapshotMetadata.activeMissionCount}`
  );
}

const resourceComponents = [
  { name: "metal", type: "uint128" },
  { name: "crystal", type: "uint128" },
  { name: "deuterium", type: "uint128" }
] as const;

const productionQueueComponents = [
  { name: "active", type: "bool" },
  { name: "itemId", type: "uint8" },
  { name: "quantity", type: "uint32" },
  { name: "readyAt", type: "uint64" },
  { name: "cost", type: "tuple", components: resourceComponents }
] as const;

const buildingQueueComponents = [
  { name: "active", type: "bool" },
  { name: "itemId", type: "uint8" },
  { name: "targetLevel", type: "uint16" },
  { name: "readyAt", type: "uint64" },
  { name: "cost", type: "tuple", components: resourceComponents }
] as const;

const researchQueueComponents = [
  { name: "active", type: "bool" },
  { name: "itemId", type: "uint8" },
  { name: "targetLevel", type: "uint16" },
  { name: "readyAt", type: "uint64" },
  { name: "cost", type: "tuple", components: resourceComponents }
] as const;

const migrationMoonComponents = [
  { name: "fields", type: "uint16" },
  { name: "diameterKm", type: "uint16" },
  { name: "createdAt", type: "uint64" },
  { name: "jumpGateReadyAt", type: "uint64" },
  { name: "resources", type: "tuple", components: resourceComponents },
  { name: "buildingLevels", type: "uint16[4]" },
  { name: "shipCounts", type: "uint32[16]" },
  { name: "defenseCounts", type: "uint32[10]" },
  { name: "buildingQueue", type: "tuple", components: buildingQueueComponents },
  { name: "defenseQueue", type: "tuple", components: productionQueueComponents }
] as const;

const migrationPlayerStateParameters = [
  {
    type: "tuple",
    components: [
      { name: "player", type: "address" },
      { name: "homePlanetId", type: "uint256" },
      { name: "technologyLevels", type: "uint16[15]" },
      { name: "researchQueue", type: "tuple", components: researchQueueComponents },
      {
        name: "planets",
        type: "tuple[]",
        components: [
          { name: "planetId", type: "uint256" },
          { name: "galaxy", type: "uint16" },
          { name: "system", type: "uint16" },
          { name: "position", type: "uint8" },
          { name: "fields", type: "uint16" },
          { name: "temperature", type: "int16" },
          { name: "lastSettledAt", type: "uint64" },
          { name: "name", type: "string" },
          { name: "resources", type: "tuple", components: resourceComponents },
          { name: "buildingLevels", type: "uint16[16]" },
          { name: "shipCounts", type: "uint32[16]" },
          { name: "defenseCounts", type: "uint32[10]" },
          { name: "buildingQueue", type: "tuple", components: buildingQueueComponents },
          { name: "defenseQueue", type: "tuple", components: productionQueueComponents },
          { name: "shipQueue", type: "tuple", components: productionQueueComponents },
          { name: "defenseBacklog", type: "tuple[]", components: productionQueueComponents },
          { name: "shipBacklog", type: "tuple[]", components: productionQueueComponents },
          { name: "hasMoon", type: "bool" },
          { name: "moon", type: "tuple", components: migrationMoonComponents }
        ]
      }
    ]
  }
] as const;

const missionShipKeyIds: Record<string, number> = {
  smallCargo: 0,
  lightFighter: 1,
  recycler: 2,
  colonyShip: 3,
  largeCargo: 4,
  heavyFighter: 5,
  cruiser: 6,
  battleship: 7,
  bomber: 8,
  destroyer: 10,
  deathstar: 11,
  battlecruiser: 12,
  reaper: 13,
  pathfinder: 14
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
