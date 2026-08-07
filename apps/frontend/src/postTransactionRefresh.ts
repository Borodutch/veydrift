import type {
  ChainDefenseState,
  ChainShipyardState,
  ChainResearchState,
  FleetMissionVisibilityResponse,
  FleetMissionPlanetReference,
  FleetMissionSummary,
  ChainInfrastructureState,
  ChainAllianceState,
  ManagedPlanetResponse,
  OnChainResources,
  PlayerQueuesResponse,
  QueueStateResponse,
  ResourceSnapshotMetadata,
  WalletSettlementResponse,
  WalletPlanetsResponse,
} from "./walletFlow";
import { serverUnavailableRetryMessage } from "./gameUnavailable";

export type FinishedBuildingExpectation = {
  itemId?: number | undefined;
  targetLevel?: number | undefined;
};

export type FinishedBuildingSnapshot = {
  infrastructure: ChainInfrastructureState;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

export type StartedBuildingExpectation = {
  itemId: number;
  planetId?: string | undefined;
  resourceIndexing?: ResourceIndexingExpectation | undefined;
  targetLevel?: number | undefined;
};

export type StartedBuildingSnapshot = {
  infrastructure: ChainInfrastructureState;
  planetsResponse?: WalletPlanetsResponse | undefined;
  queues: PlayerQueuesResponse;
};

export type StartedDefenseProductionExpectation = {
  itemId: number;
  planetId?: string | undefined;
  quantity: number;
  resourceIndexing?: ResourceIndexingExpectation | undefined;
};

export type StartedDefenseProductionSnapshot = {
  defense: ChainDefenseState;
  queues: PlayerQueuesResponse;
};

export type StartedShipProductionExpectation = {
  itemId: number;
  planetId?: string | undefined;
  quantity: number;
  resourceIndexing?: ResourceIndexingExpectation | undefined;
};

export type StartedShipProductionSnapshot = {
  queues: PlayerQueuesResponse;
  shipyard: ChainShipyardState;
};

export type StartedResearchExpectation = {
  itemId: number;
  resourceIndexing?: ResourceIndexingExpectation | undefined;
  targetLevel?: number | undefined;
};

export type StartedResearchSnapshot = {
  queues: PlayerQueuesResponse;
  research: ChainResearchState;
};

export type FinishedResearchExpectation = {
  itemId?: number | undefined;
  targetLevel?: number | undefined;
};

export type FinishedResearchSnapshot = {
  queues: PlayerQueuesResponse;
  research: ChainResearchState;
};

export type WalletPlanetSyncSnapshot = {
  // Mission visibility is supplementary to a wallet/planet refresh. A transient timeout must not
  // be represented as an authoritative empty mission list: callers retain their last confirmed
  // visibility until a successful visibility response arrives.
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  planetsResponse: WalletPlanetsResponse;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

export type MissionLaunchSnapshot = {
  allActiveMissions: FleetMissionSummary[];
  fleetVisibility: FleetMissionVisibilityResponse;
};

export type PendingMissionLaunchInput = {
  txHash: string;
  owner: string;
  originPlanetId: string;
  targetPlanetId: string;
  originIsMoon?: boolean | undefined;
  targetIsMoon?: boolean | undefined;
  missionType: string;
  ships: Record<string, number | string | undefined>;
  cargo?: Partial<Record<"metal" | "crystal" | "deuterium", number | string | undefined>> | undefined;
  fuelCost?: number | string | undefined;
  originPlanet?: FleetMissionPlanetReference | null | undefined;
  targetPlanet?: FleetMissionPlanetReference | null | undefined;
  submittedAtMs?: number | undefined;
  travelSeconds?: number | undefined;
};

export const PENDING_MISSION_LAUNCH_ID_PREFIX = "pending:";

export type AllianceApplicationExpectation = {
  allianceId: string;
  requester: string;
};

export type AllianceProfileExpectation = {
  allianceId: string;
  tag: string;
  name: string;
  description: string;
};

export type HydratedWalletPlanetSnapshot = WalletPlanetSyncSnapshot & {
  selectedPlanet: ManagedPlanetResponse | NonNullable<WalletSettlementResponse["planet"]>;
};

export type ResourceIndexingExpectation = {
  baseline?: ResourceSnapshotMetadata | undefined;
  receiptBlockNumber?: string | number | bigint | null | undefined;
  transactionHash: string;
};

type WaitOptions = {
  attempts?: number;
  intervalMs?: number;
  delay?: (ms: number) => Promise<void>;
};

type ResourceSnapshotState = {
  resourceSnapshot?: ResourceSnapshotMetadata | null | undefined;
};

// Keep transaction flows as light-client reads: after a receipt, wait for the
// backend-indexed event to become visible instead of fabricating local state.
// Base Sepolia indexing can lag past the old ~12s window under deploy/load.
const DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS = 80;
const DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS = 750;

type MissionLaunchWaitOptions = WaitOptions & {
  expectedMission?: FleetMissionSummary | undefined;
};

export function isFinishedBuildingStateVisible(
  snapshot: Pick<FinishedBuildingSnapshot, "infrastructure" | "queues">,
  expectation: FinishedBuildingExpectation,
): boolean {
  const queueCleared = !snapshot.queues.building?.active && !snapshot.infrastructure.queue?.active;
  if (!queueCleared) return false;

  if (expectation.itemId === undefined || expectation.targetLevel === undefined) {
    return true;
  }

  const row = snapshot.infrastructure.buildings.find((building) => building.id === expectation.itemId);
  return (row?.level ?? 0) >= expectation.targetLevel;
}

export function hydratedWalletPlanetSnapshot(
  snapshot: WalletPlanetSyncSnapshot,
  preferredPlanetId?: string | undefined,
): HydratedWalletPlanetSnapshot | undefined {
  const homePlanetId = snapshot.settlement.homePlanetId ?? snapshot.planetsResponse.homePlanetId;
  if (!homePlanetId) return undefined;

  const selectedPlanet = snapshot.planetsResponse.planets.find((planet) => planet.planetId === (preferredPlanetId ?? homePlanetId))
    ?? snapshot.planetsResponse.planets.find((planet) => planet.planetId === homePlanetId || planet.isHomePlanet)
    ?? snapshot.planetsResponse.planets[0]
    ?? snapshot.settlement.planet
    ?? undefined;

  if (!selectedPlanet) return undefined;
  if (!selectedPlanet.resources?.metal || !selectedPlanet.resources.crystal || !selectedPlanet.resources.deuterium) return undefined;
  if (!Number.isFinite(selectedPlanet.galaxy) || !Number.isFinite(selectedPlanet.system) || !Number.isFinite(selectedPlanet.position)) {
    return undefined;
  }

  return {
    ...snapshot,
    selectedPlanet,
  };
}

export function isStartedBuildingStateVisible(
  snapshot: StartedBuildingSnapshot,
  expectation: StartedBuildingExpectation,
): boolean {
  if (expectation.planetId) {
    const planetId = snapshot.infrastructure.planetId ?? snapshot.infrastructure.homePlanetId;
    if (planetId && planetId !== expectation.planetId) return false;
  }

  if (expectation.resourceIndexing && !isResourceSnapshotIndexedAfterTransaction(
    snapshot.infrastructure.resourceSnapshot,
    expectation.resourceIndexing,
  )) {
    return false;
  }

  return buildingQueueMatches(snapshot.infrastructure.queue, expectation)
    || buildingQueueMatches(snapshot.queues.building, expectation)
    || Boolean(startedBuildingQueueFromWalletPlanets(snapshot.planetsResponse, expectation));
}

export function startedBuildingQueueFromWalletPlanets(
  planetsResponse: WalletPlanetsResponse | undefined,
  expectation: StartedBuildingExpectation,
): QueueStateResponse | undefined {
  const planet = expectation.planetId
    ? planetsResponse?.planets.find((entry) => entry.planetId === expectation.planetId)
    : planetsResponse?.planets.find((entry) => entry.planetId === planetsResponse.homePlanetId || entry.isHomePlanet)
      ?? planetsResponse?.planets[0];

  const queue = planet?.queues.building;
  return buildingQueueMatches(queue, expectation) ? queue ?? undefined : undefined;
}

export function isStartedDefenseProductionVisible(
  snapshot: StartedDefenseProductionSnapshot,
  expectation: StartedDefenseProductionExpectation,
): boolean {
  if (expectation.planetId && snapshot.defense.homePlanetId !== expectation.planetId) return false;
  if (expectation.resourceIndexing && !isResourceSnapshotIndexedAfterTransaction(
    snapshot.defense.resourceSnapshot,
    expectation.resourceIndexing,
  )) {
    return false;
  }

  return defenseQueueMatches(snapshot.defense.queue, expectation)
    || defenseQueueMatches(snapshot.queues.defense, expectation);
}

export function isStartedShipProductionVisible(
  snapshot: StartedShipProductionSnapshot,
  expectation: StartedShipProductionExpectation,
): boolean {
  if (expectation.planetId && (snapshot.shipyard.planetId ?? snapshot.shipyard.homePlanetId) !== expectation.planetId) return false;
  if (expectation.resourceIndexing && !isResourceSnapshotIndexedAfterTransaction(
    snapshot.shipyard.resourceSnapshot,
    expectation.resourceIndexing,
  )) {
    return false;
  }

  return shipQueueMatches(snapshot.shipyard.queue, expectation)
    || shipQueueMatches(snapshot.queues.ship, expectation);
}

export function isStartedResearchStateVisible(
  snapshot: StartedResearchSnapshot,
  expectation: StartedResearchExpectation,
): boolean {
  if (expectation.resourceIndexing && !isResourceSnapshotIndexedAfterTransaction(
    snapshot.research.resourceSnapshot,
    expectation.resourceIndexing,
  )) {
    return false;
  }

  return researchQueueMatches(snapshot.research.queue, expectation)
    && researchQueueMatches(snapshot.queues.research, expectation);
}

export function isResourceSnapshotIndexedAfterTransaction(
  snapshot: ResourceSnapshotMetadata | null | undefined,
  expectation: ResourceIndexingExpectation,
): boolean {
  if (!snapshot) return false;

  const transactionHash = normalizeTransactionHash(expectation.transactionHash);
  const snapshotTransactionHash = normalizeTransactionHash(snapshot.transactionHash);
  if (transactionHash && snapshotTransactionHash === transactionHash) return true;

  const receiptBlock = parseBlockNumber(expectation.receiptBlockNumber);
  const snapshotBlock = parseBlockNumber(snapshot.blockNumber);
  if (receiptBlock !== undefined && snapshotBlock !== undefined && snapshotBlock >= receiptBlock) return true;

  const baseline = expectation.baseline;
  if (!baseline) return false;

  const baselineBlock = parseBlockNumber(baseline.blockNumber);
  if (snapshotBlock !== undefined && baselineBlock !== undefined && snapshotBlock > baselineBlock) return true;

  return resourceSnapshotKey(snapshot) !== resourceSnapshotKey(baseline);
}

export function resourceIndexingExpectationForTransaction(
  transactionHash: string,
  baseline: ResourceSnapshotMetadata | null | undefined,
  receipt: { blockNumber?: string | number | bigint | null } | null | undefined,
): ResourceIndexingExpectation {
  return {
    baseline: baseline ?? undefined,
    receiptBlockNumber: receipt?.blockNumber,
    transactionHash,
  };
}

export function isFinishedResearchStateVisible(
  snapshot: FinishedResearchSnapshot,
  expectation: FinishedResearchExpectation,
): boolean {
  const queueCleared = !snapshot.queues.research?.active && !snapshot.research.queue?.active;
  if (!queueCleared) return false;

  if (expectation.itemId === undefined || expectation.targetLevel === undefined) {
    return true;
  }

  const level = snapshot.research.technologies.find((technology) => technology.id === expectation.itemId)?.level
    ?? snapshot.research.technologyLevels[expectation.itemId.toString()]
    ?? 0;
  return level >= expectation.targetLevel;
}

export function isAllianceApplicationCleared(
  snapshot: ChainAllianceState,
  expectation: AllianceApplicationExpectation,
): boolean {
  return !snapshot.allianceJoinRequests.some((request) =>
    request.allianceId === expectation.allianceId
      && request.requester.toLowerCase() === expectation.requester.toLowerCase()
  );
}

export function isAllianceProfileUpdated(
  snapshot: ChainAllianceState,
  expectation: AllianceProfileExpectation,
): boolean {
  const profile = snapshot.profile;
  if (!profile || profile.active !== true || snapshot.membership.allianceId !== expectation.allianceId) {
    return false;
  }

  return profile.tag === expectation.tag
    && profile.name === expectation.name
    && profile.description === expectation.description;
}

export function missionLaunchMissionsForTransaction(
  snapshot: MissionLaunchSnapshot,
  txHash: string,
  expectedMission?: FleetMissionSummary | undefined,
): FleetMissionSummary[] {
  return missionLaunchMissionsFromList([
    ...activeWalletMissions(snapshot.fleetVisibility),
    ...snapshot.allActiveMissions,
  ], txHash, expectedMission);
}

function missionLaunchMissionsFromList(
  missions: readonly FleetMissionSummary[],
  txHash: string,
  expectedMission?: FleetMissionSummary | undefined,
): FleetMissionSummary[] {
  const normalizedTxHash = normalizeTxHash(txHash);
  const seen = new Set<string>();
  return missions.filter((mission) => {
    const missionTxHash = normalizeTxHash(mission.transactionHash);
    const matchesTransaction = missionTxHash === normalizedTxHash;
    const matchesExpectedLaunch = expectedMission
      ? missionMatchesExpectedLaunch(mission, expectedMission)
      : false;
    if (!matchesTransaction && !matchesExpectedLaunch) return false;
    if (seen.has(mission.missionId)) return false;
    seen.add(mission.missionId);
    return true;
  });
}

export function isMissionLaunchStateVisible(
  snapshot: MissionLaunchSnapshot,
  txHash: string,
  expectedMission?: FleetMissionSummary | undefined,
): boolean {
  return missionLaunchMissionsForTransaction(snapshot, txHash, expectedMission).length > 0;
}

export function pendingMissionLaunchId(txHash: string): string {
  return `${PENDING_MISSION_LAUNCH_ID_PREFIX}${normalizeTxHash(txHash).replace(/^0x/, "").slice(0, 12)}`;
}

export function isPendingMissionLaunch(mission: Pick<FleetMissionSummary, "missionId">): boolean {
  return mission.missionId.startsWith(PENDING_MISSION_LAUNCH_ID_PREFIX);
}

export function pendingMissionLaunch(input: PendingMissionLaunchInput): FleetMissionSummary {
  const submittedAtMs = input.submittedAtMs ?? Date.now();
  const travelSeconds = Math.max(1, Math.ceil(Number(input.travelSeconds) || 60));
  const arrivalSeconds = Math.floor(submittedAtMs / 1_000) + travelSeconds;
  const returnSeconds = arrivalSeconds + travelSeconds;

  return {
    missionId: pendingMissionLaunchId(input.txHash),
    status: "Outbound",
    missionType: input.missionType,
    owner: input.owner,
    originPlanetId: input.originPlanetId,
    targetPlanetId: input.targetPlanetId,
    originIsMoon: Boolean(input.originIsMoon),
    targetIsMoon: Boolean(input.targetIsMoon),
    originPlanet: input.originPlanet ?? null,
    targetPlanet: input.targetPlanet ?? null,
    arrivalAt: String(arrivalSeconds),
    returnAt: String(returnSeconds),
    fuelCost: String(Math.max(0, Math.trunc(Number(input.fuelCost) || 0))),
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: missionResources(input.cargo),
    returnCargo: null,
    ships: missionShips(input.ships),
    transactionHash: normalizeTxHash(input.txHash),
    blockNumber: "",
  };
}

export function mergePendingMissionLaunches(
  current: readonly FleetMissionSummary[] | undefined,
  pending: readonly FleetMissionSummary[],
): FleetMissionSummary[] {
  const rows = current ?? [];
  const canonicalTxHashes = canonicalMissionTransactionHashes(rows);
  const seen = new Set<string>();
  return [
    ...pending.filter((mission) =>
      !canonicalTxHashes.has(normalizeTxHash(mission.transactionHash))
        && missionLaunchMissionsFromList(rows, mission.transactionHash, mission).length === 0
    ),
    ...rows,
  ].filter((mission) => {
    if (seen.has(mission.missionId)) return false;
    seen.add(mission.missionId);
    return true;
  });
}

export function reconcilePendingMissionLaunches(
  pending: readonly FleetMissionSummary[],
  snapshot: MissionLaunchSnapshot,
): FleetMissionSummary[] {
  const missions = [
    ...activeWalletMissions(snapshot.fleetVisibility),
    ...snapshot.allActiveMissions,
  ];
  const canonicalTxHashes = canonicalMissionTransactionHashes(missions);
  return pending.filter((mission) =>
    !canonicalTxHashes.has(normalizeTxHash(mission.transactionHash))
      && missionLaunchMissionsFromList(missions, mission.transactionHash, mission).length === 0
  );
}

export function removePendingMissionLaunchForTransaction(
  pending: readonly FleetMissionSummary[],
  txHash: string,
): FleetMissionSummary[] {
  const normalized = normalizeTxHash(txHash);
  return pending.filter((mission) => normalizeTxHash(mission.transactionHash) !== normalized);
}

function activeWalletMissions(fleetVisibility: FleetMissionVisibilityResponse): FleetMissionSummary[] {
  return [
    ...fleetVisibility.incoming,
    ...fleetVisibility.outgoing,
    ...fleetVisibility.returning,
    ...fleetVisibility.joinableAttacks,
  ];
}

function canonicalMissionTransactionHashes(missions: readonly FleetMissionSummary[]): Set<string> {
  const hashes = new Set<string>();
  for (const mission of missions) {
    if (isPendingMissionLaunch(mission) || !mission.transactionHash) continue;
    const normalized = normalizeTxHash(mission.transactionHash);
    if (isPlaceholderTransactionHash(normalized)) continue;
    hashes.add(normalized);
  }
  return hashes;
}

function normalizeTxHash(txHash: string): string {
  return txHash.trim().toLowerCase();
}

function isPlaceholderTransactionHash(txHash: string): boolean {
  return txHash === "" || txHash === "0x";
}

function missionMatchesExpectedLaunch(
  mission: FleetMissionSummary,
  expected: FleetMissionSummary,
): boolean {
  if (isPendingMissionLaunch(mission)) return false;
  if (mission.owner.toLowerCase() !== expected.owner.toLowerCase()) return false;
  if (mission.originPlanetId !== expected.originPlanetId) return false;
  if (mission.targetPlanetId !== expected.targetPlanetId) return false;
  if (mission.missionType.toLowerCase() !== expected.missionType.toLowerCase()) return false;
  if (!missionResourcesEqual(mission.cargo, expected.cargo)) return false;
  if (!missionShipsEqual(mission.ships, expected.ships)) return false;

  return timestampsWithinMissionLaunchWindow(mission.arrivalAt, expected.arrivalAt)
    || timestampsWithinMissionLaunchWindow(mission.returnAt, expected.returnAt);
}

function timestampsWithinMissionLaunchWindow(actual: string, expected: string): boolean {
  const actualSeconds = Number(actual);
  const expectedSeconds = Number(expected);
  if (!Number.isFinite(actualSeconds) || !Number.isFinite(expectedSeconds)) return false;
  return Math.abs(actualSeconds - expectedSeconds) <= 10 * 60;
}

function missionResourcesEqual(actual: OnChainResources, expected: OnChainResources): boolean {
  return numericString(actual.metal) === numericString(expected.metal)
    && numericString(actual.crystal) === numericString(expected.crystal)
    && numericString(actual.deuterium) === numericString(expected.deuterium);
}

function missionShipsEqual(actual: Record<string, string>, expected: Record<string, string>): boolean {
  const actualEntries = normalizedPositiveEntries(actual);
  const expectedEntries = normalizedPositiveEntries(expected);
  if (actualEntries.length !== expectedEntries.length) return false;
  return actualEntries.every(([key, value], index) => {
    const [expectedKey, expectedValue] = expectedEntries[index] ?? [];
    return key === expectedKey && value === expectedValue;
  });
}

function normalizedPositiveEntries(values: Record<string, string>): Array<[string, string]> {
  return Object.entries(values)
    .map(([key, value]) => [key, numericString(value)] as [string, string])
    .filter(([, value]) => value !== "0")
    .sort(([left], [right]) => left.localeCompare(right));
}

function numericString(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return "0";
  try {
    return BigInt(trimmed).toString();
  } catch {
    return "0";
  }
}

function missionShips(ships: Record<string, number | string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ships)
      .map(([key, value]) => [key, String(Math.max(0, Math.trunc(Number(value) || 0)))])
      .filter(([, value]) => value !== "0")
  );
}

function missionResources(
  resources: Partial<Record<"metal" | "crystal" | "deuterium", number | string | undefined>> | undefined,
): FleetMissionSummary["cargo"] {
  return {
    metal: String(Math.max(0, Math.trunc(Number(resources?.metal) || 0))),
    crystal: String(Math.max(0, Math.trunc(Number(resources?.crystal) || 0))),
    deuterium: String(Math.max(0, Math.trunc(Number(resources?.deuterium) || 0))),
  };
}

function buildingQueueMatches(
  queue: QueueStateResponse | null | undefined,
  expectation: StartedBuildingExpectation,
): boolean {
  return Boolean(
    queue?.active
      && queue.itemId === expectation.itemId
      && (expectation.targetLevel === undefined || (queue.targetLevel ?? 0) >= expectation.targetLevel),
  );
}

function normalizeTransactionHash(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "0x" ? normalized : undefined;
}

function parseBlockNumber(value: string | number | bigint | null | undefined): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : undefined;
  if (!value) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function resourceSnapshotKey(snapshot: ResourceSnapshotMetadata): string {
  const resources = snapshot.resources;
  return [
    snapshot.planetId ?? "",
    snapshot.transactionHash ?? "",
    snapshot.blockNumber?.toString() ?? "",
    snapshot.logIndex?.toString() ?? "",
    snapshot.lastSettledAt ?? "",
    resources?.metal ?? "",
    resources?.crystal ?? "",
    resources?.deuterium ?? "",
  ].join(":");
}

function defenseQueueMatches(
  queue: ChainDefenseState["queue"] | PlayerQueuesResponse["defense"],
  expectation: StartedDefenseProductionExpectation,
): boolean {
  return defenseQueueEntries(queue).some((entry) =>
    entry.active
      && entry.itemId === expectation.itemId
      && (entry.quantity ?? 0) >= expectation.quantity
  );
}

function defenseQueueEntries(
  queue: ChainDefenseState["queue"] | PlayerQueuesResponse["defense"],
): NonNullable<ChainDefenseState["queue"]>[] {
  if (!queue) return [];
  return [queue, ...(queue.backlog ?? [])];
}

function shipQueueMatches(
  queue: ChainShipyardState["queue"] | PlayerQueuesResponse["ship"],
  expectation: StartedShipProductionExpectation,
): boolean {
  return shipQueueEntries(queue).some((entry) =>
    entry.active
      && entry.itemId === expectation.itemId
      && (entry.quantity ?? 0) >= expectation.quantity
  );
}

function shipQueueEntries(
  queue: ChainShipyardState["queue"] | PlayerQueuesResponse["ship"],
): NonNullable<ChainShipyardState["queue"]>[] {
  if (!queue) return [];
  return [queue, ...(queue.backlog ?? [])];
}

function researchQueueMatches(
  queue: ChainResearchState["queue"] | PlayerQueuesResponse["research"],
  expectation: StartedResearchExpectation,
): boolean {
  return Boolean(
    queue?.active
    && queue.itemId === expectation.itemId
    && (expectation.targetLevel === undefined || queue.targetLevel === expectation.targetLevel),
  );
}

export async function waitForFinishedBuildingState(
  load: () => Promise<FinishedBuildingSnapshot>,
  expectation: FinishedBuildingExpectation,
  options: WaitOptions = {},
): Promise<FinishedBuildingSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: FinishedBuildingSnapshot | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      if (isFinishedBuildingStateVisible(latest, expectation)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(finishedBuildingTimeoutMessage(latest, expectation, lastError));
}

export async function waitForStartedBuildingState(
  load: () => Promise<StartedBuildingSnapshot>,
  expectation: StartedBuildingExpectation,
  options: WaitOptions = {},
): Promise<StartedBuildingSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: StartedBuildingSnapshot | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      if (isStartedBuildingStateVisible(latest, expectation)) {
        return latest;
      }
    } catch (error) {
      // The backend may be briefly reloading/rebuilding the indexer and return a
      // transient read failure. Keep polling instead of aborting to a stale,
      // actionable button; only give up once the attempts are exhausted.
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(startedBuildingTimeoutMessage(latest, expectation, lastError));
}

export async function waitForIndexedResourceState<State extends ResourceSnapshotState>(
  load: () => Promise<State>,
  expectation: ResourceIndexingExpectation,
  options: WaitOptions = {},
): Promise<State> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const state = await load();
      lastError = undefined;
      if (isResourceSnapshotIndexedAfterTransaction(state.resourceSnapshot, expectation)) {
        return state;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  const reason = lastError instanceof Error ? ` Last read failed: ${lastError.message}` : "";
  throw new Error(`The confirmed resource change is still syncing with the game API.${reason}`);
}

export async function waitForStartedDefenseProductionState(
  load: () => Promise<StartedDefenseProductionSnapshot>,
  expectation: StartedDefenseProductionExpectation,
  options: WaitOptions = {},
): Promise<StartedDefenseProductionSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: StartedDefenseProductionSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isStartedDefenseProductionVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(startedDefenseProductionTimeoutMessage(latest, expectation));
}

export async function waitForStartedShipProductionState(
  load: () => Promise<StartedShipProductionSnapshot>,
  expectation: StartedShipProductionExpectation,
  options: WaitOptions = {},
): Promise<StartedShipProductionSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: StartedShipProductionSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isStartedShipProductionVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(startedShipProductionTimeoutMessage(latest, expectation));
}

export async function waitForStartedResearchState(
  load: () => Promise<StartedResearchSnapshot>,
  expectation: StartedResearchExpectation,
  options: WaitOptions = {},
): Promise<StartedResearchSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: StartedResearchSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isStartedResearchStateVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(startedResearchTimeoutMessage(latest, expectation));
}

export async function waitForFinishedResearchState(
  load: () => Promise<FinishedResearchSnapshot>,
  expectation: FinishedResearchExpectation,
  options: WaitOptions = {},
): Promise<FinishedResearchSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: FinishedResearchSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isFinishedResearchStateVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(finishedResearchTimeoutMessage(latest, expectation));
}

export async function waitForAllianceApplicationCleared(
  load: () => Promise<ChainAllianceState>,
  expectation: AllianceApplicationExpectation,
  options: WaitOptions = {},
): Promise<ChainAllianceState> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: ChainAllianceState | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      if (isAllianceApplicationCleared(latest, expectation)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(allianceApplicationClearTimeoutMessage(latest, expectation, lastError));
}

export async function waitForAllianceProfileState(
  load: () => Promise<ChainAllianceState>,
  expectation: AllianceProfileExpectation,
  options: WaitOptions = {},
): Promise<ChainAllianceState> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: ChainAllianceState | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      if (isAllianceProfileUpdated(latest, expectation)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(allianceProfileUpdateTimeoutMessage(latest, expectation, lastError));
}

export async function waitForMissionLaunchState(
  load: () => Promise<MissionLaunchSnapshot>,
  txHash: string,
  options: MissionLaunchWaitOptions = {},
): Promise<MissionLaunchSnapshot> {
  const attempts = options.attempts ?? DEFAULT_POST_TRANSACTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: MissionLaunchSnapshot | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      if (isMissionLaunchStateVisible(latest, txHash, options.expectedMission)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(missionLaunchTimeoutMessage(txHash, lastError));
}

export async function waitForHydratedWalletPlanet(
  load: () => Promise<WalletPlanetSyncSnapshot>,
  preferredPlanetId?: string | undefined,
  options: WaitOptions = {},
): Promise<HydratedWalletPlanetSnapshot> {
  const attempts = options.attempts ?? 24;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: WalletPlanetSyncSnapshot | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      const hydrated = hydratedWalletPlanetSnapshot(latest, preferredPlanetId);
      if (hydrated) return hydrated;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(walletPlanetHydrationTimeoutMessage(latest, lastError, attempts * intervalMs));
}

export async function waitForRenamedWalletPlanet(
  load: () => Promise<WalletPlanetSyncSnapshot>,
  expectation: { planetId: string; name: string },
  options: WaitOptions = {},
): Promise<HydratedWalletPlanetSnapshot> {
  const attempts = options.attempts ?? 24;
  const intervalMs = options.intervalMs ?? DEFAULT_POST_TRANSACTION_REFRESH_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  let latest: WalletPlanetSyncSnapshot | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      latest = await load();
      lastError = undefined;
      const hydrated = hydratedWalletPlanetSnapshot(latest, expectation.planetId);
      if (hydrated?.selectedPlanet.name === expectation.name) return hydrated;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(renamedPlanetTimeoutMessage(latest, lastError, expectation, attempts * intervalMs));
}

function finishedBuildingTimeoutMessage(
  snapshot: FinishedBuildingSnapshot | undefined,
  expectation: FinishedBuildingExpectation,
  lastError?: unknown,
): string {
  const recovery = transientGameStateReadFailureMessage(lastError);
  if (recovery) return recovery;

  const queueActive = Boolean(snapshot?.queues.building?.active || snapshot?.infrastructure.queue?.active);
  const buildingLevel = expectation.itemId === undefined
    ? undefined
    : snapshot?.infrastructure.buildings.find((building) => building.id === expectation.itemId)?.level;
  const target = expectation.targetLevel === undefined ? "the completed level" : `Level ${expectation.targetLevel}`;

  if (queueActive) {
    return "Building transaction confirmed, but the completed building queue is still syncing. Try refreshing the game state in a few seconds.";
  }

  if (buildingLevel !== undefined && expectation.targetLevel !== undefined && buildingLevel < expectation.targetLevel) {
    return `Building transaction confirmed, but the API still shows Level ${buildingLevel} instead of ${target}. Try refreshing the game state in a few seconds.`;
  }

  return "Building transaction confirmed, but the completed building state is still syncing. Try refreshing the game state in a few seconds.";
}

function transientGameStateReadFailureMessage(error: unknown): string | undefined {
  if (!isTransientGameStateReadFailure(error)) return undefined;

  return serverUnavailableRetryMessage();
}

export function isTransientGameStateReadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|load failed|network|err_http2|timed out reading .+ from the game api|api failed: 5\d\d|backend_not_configured|rpc http|rate limit|too many requests/i.test(message);
}

function startedBuildingTimeoutMessage(
  snapshot: StartedBuildingSnapshot | undefined,
  expectation: StartedBuildingExpectation,
  lastError?: unknown,
): string {
  const recovery = transientGameStateReadFailureMessage(lastError);
  if (recovery) return recovery;

  const infrastructureQueue = snapshot?.infrastructure.queue;
  const overviewQueue = snapshot?.queues.building;
  const infrastructureTarget = infrastructureQueue?.active && infrastructureQueue.itemId === expectation.itemId
    ? infrastructureQueue.targetLevel ?? "unknown"
    : "missing";
  const overviewTarget = overviewQueue?.active && overviewQueue.itemId === expectation.itemId
    ? overviewQueue.targetLevel ?? "unknown"
    : "missing";
  const target = expectation.targetLevel === undefined ? "the next level" : `Level ${expectation.targetLevel}`;

  return `Building transaction confirmed, but indexed building queue state is still syncing. Expected item ${expectation.itemId} ${target}; Infrastructure page target: ${infrastructureTarget}; Overview target: ${overviewTarget}. Try refreshing in a few seconds.`;
}

function startedDefenseProductionTimeoutMessage(
  snapshot: StartedDefenseProductionSnapshot | undefined,
  expectation: StartedDefenseProductionExpectation,
): string {
  const defenseQueue = snapshot?.defense.queue;
  const overviewQueue = snapshot?.queues.defense;
  const defenseQuantity = matchingDefenseQueueQuantity(defenseQueue, expectation.itemId);
  const overviewQuantity = matchingDefenseQueueQuantity(overviewQueue, expectation.itemId);

  return `Defense production transaction confirmed, but indexed defense queue state is still syncing. Expected item ${expectation.itemId} x${expectation.quantity}; Defenses page queue x${defenseQuantity}; Overview queue x${overviewQuantity}. Try refreshing in a few seconds.`;
}

function matchingDefenseQueueQuantity(
  queue: ChainDefenseState["queue"] | PlayerQueuesResponse["defense"] | undefined,
  itemId: number,
): number {
  return defenseQueueEntries(queue ?? null)
    .filter((entry) => entry.active && entry.itemId === itemId)
    .reduce((total, entry) => total + (entry.quantity ?? 0), 0);
}

function startedShipProductionTimeoutMessage(
  snapshot: StartedShipProductionSnapshot | undefined,
  expectation: StartedShipProductionExpectation,
): string {
  const shipyardQueue = snapshot?.shipyard.queue;
  const overviewQueue = snapshot?.queues.ship;
  const shipyardQuantity = matchingShipQueueQuantity(shipyardQueue, expectation.itemId);
  const overviewQuantity = matchingShipQueueQuantity(overviewQueue, expectation.itemId);

  return `Ship production transaction confirmed, but indexed shipyard queue state is still syncing. Expected item ${expectation.itemId} x${expectation.quantity}; Shipyard page queue x${shipyardQuantity}; Overview queue x${overviewQuantity}. Try refreshing in a few seconds.`;
}

function matchingShipQueueQuantity(
  queue: ChainShipyardState["queue"] | PlayerQueuesResponse["ship"] | undefined,
  itemId: number,
): number {
  return shipQueueEntries(queue ?? null)
    .filter((entry) => entry.active && entry.itemId === itemId)
    .reduce((total, entry) => total + (entry.quantity ?? 0), 0);
}

function startedResearchTimeoutMessage(
  snapshot: StartedResearchSnapshot | undefined,
  expectation: StartedResearchExpectation,
): string {
  const researchQueue = snapshot?.research.queue;
  const overviewQueue = snapshot?.queues.research;
  const researchTarget = researchQueue?.active && researchQueue.itemId === expectation.itemId
    ? researchQueue.targetLevel ?? "unknown"
    : "missing";
  const overviewTarget = overviewQueue?.active && overviewQueue.itemId === expectation.itemId
    ? overviewQueue.targetLevel ?? "unknown"
    : "missing";
  const target = expectation.targetLevel === undefined ? "the next level" : `Level ${expectation.targetLevel}`;

  return `Research transaction confirmed, but indexed research queue state is still syncing. Expected item ${expectation.itemId} ${target}; Research page target: ${researchTarget}; Overview target: ${overviewTarget}. Try refreshing in a few seconds.`;
}

function finishedResearchTimeoutMessage(
  snapshot: FinishedResearchSnapshot | undefined,
  expectation: FinishedResearchExpectation,
): string {
  const queueActive = Boolean(snapshot?.queues.research?.active || snapshot?.research.queue?.active);
  const level = expectation.itemId === undefined
    ? undefined
    : snapshot?.research.technologies.find((technology) => technology.id === expectation.itemId)?.level
      ?? snapshot?.research.technologyLevels[expectation.itemId.toString()];
  const target = expectation.targetLevel === undefined ? "the completed level" : `Level ${expectation.targetLevel}`;

  if (queueActive) {
    return "Research transaction confirmed, but the completed research queue is still syncing. Try refreshing the game state in a few seconds.";
  }

  if (level !== undefined && expectation.targetLevel !== undefined && level < expectation.targetLevel) {
    return `Research transaction confirmed, but the API still shows Level ${level} instead of ${target}. Try refreshing the game state in a few seconds.`;
  }

  return "Research transaction confirmed, but the completed research state is still syncing. Try refreshing the game state in a few seconds.";
}

function allianceApplicationClearTimeoutMessage(
  snapshot: ChainAllianceState | undefined,
  expectation: AllianceApplicationExpectation,
  lastError?: unknown,
): string {
  const recovery = transientGameStateReadFailureMessage(lastError);
  if (recovery) return recovery;

  const stillVisible = snapshot?.allianceJoinRequests.some((request) =>
    request.allianceId === expectation.allianceId
      && request.requester.toLowerCase() === expectation.requester.toLowerCase()
  ) ?? true;

  if (stillVisible) {
    return "Alliance application transaction confirmed, but the pending application is still syncing in the game API. Try refreshing Alliance state in a few seconds.";
  }

  return "Alliance application transaction confirmed, but Alliance state is still syncing. Try refreshing Alliance state in a few seconds.";
}

function allianceProfileUpdateTimeoutMessage(
  snapshot: ChainAllianceState | undefined,
  expectation: AllianceProfileExpectation,
  lastError?: unknown,
): string {
  const recovery = transientGameStateReadFailureMessage(lastError);
  if (recovery) return recovery;

  if (snapshot?.membership.allianceId !== expectation.allianceId) {
    return "Alliance profile transaction confirmed, but your current alliance state is still syncing. Try refreshing Alliance state in a few seconds.";
  }

  const profile = snapshot.profile;
  if (!profile) {
    return "Alliance profile transaction confirmed, but the updated alliance profile is still syncing in the game API. Try refreshing Alliance state in a few seconds.";
  }

  if (profile.description !== expectation.description) {
    return "Alliance profile transaction confirmed, but the updated description is still syncing in the game API. Try refreshing Alliance state in a few seconds.";
  }

  return "Alliance profile transaction confirmed, but the updated alliance profile is still syncing in the game API. Try refreshing Alliance state in a few seconds.";
}

function missionLaunchTimeoutMessage(txHash: string, lastError?: unknown): string {
  const recovery = transientGameStateReadFailureMessage(lastError);
  if (recovery) return recovery;

  return `Mission transaction ${txHash} confirmed, but the launched mission is still syncing in the game API. Try refreshing mission state in a few seconds.`;
}

function walletPlanetHydrationTimeoutMessage(
  snapshot: WalletPlanetSyncSnapshot | undefined,
  lastError: unknown,
  waitedMs: number,
): string {
  const waitedSeconds = Math.round(waitedMs / 1_000);
  const homePlanetId = snapshot?.settlement.homePlanetId ?? snapshot?.planetsResponse.homePlanetId ?? null;
  const planetCount = snapshot?.planetsResponse.planets.length ?? 0;
  const reason = lastError instanceof Error
    ? lastError.message
    : homePlanetId
      ? `home planet ${homePlanetId} is visible, but complete resources are not hydrated yet`
      : "home planet id is not visible from the game API yet";

  return `Settlement transaction is confirmed, but the game API did not hydrate a complete planet after ${waitedSeconds}s. Last status: ${reason}. Indexed planets: ${planetCount}. Retry in a few seconds; if it repeats, share this status with the transaction hash.`;
}

function renamedPlanetTimeoutMessage(
  snapshot: WalletPlanetSyncSnapshot | undefined,
  lastError: unknown,
  expectation: { planetId: string; name: string },
  waitedMs: number,
): string {
  const waitedSeconds = Math.round(waitedMs / 1_000);
  const hydrated = snapshot ? hydratedWalletPlanetSnapshot(snapshot, expectation.planetId) : undefined;
  const latestName = hydrated?.selectedPlanet.name ?? "unavailable";
  const reason = lastError instanceof Error ? lastError.message : `latest name: ${latestName}`;

  return `Rename transaction is confirmed, but indexed planet ${expectation.planetId} did not show "${expectation.name}" after ${waitedSeconds}s. Last status: ${reason}. Retry in a few seconds; if it repeats, share this status with the transaction hash.`;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
