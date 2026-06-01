import type {
  ChainDefenseState,
  FleetMissionVisibilityResponse,
  ChainInfrastructureState,
  ManagedPlanetResponse,
  PlayerQueuesResponse,
  WalletSettlementResponse,
  WalletPlanetsResponse,
} from "./walletFlow";

export type FinishedBuildingExpectation = {
  itemId?: number | undefined;
  targetLevel?: number | undefined;
};

export type FinishedBuildingSnapshot = {
  infrastructure: ChainInfrastructureState;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

export type CollectedResourcesExpectation = {
  planetId: string;
  previousLastSettledAt?: string | undefined;
};

export type CollectedResourcesSnapshot = {
  infrastructure: ChainInfrastructureState;
  settlement: WalletSettlementResponse;
};

export type StartedDefenseProductionExpectation = {
  itemId: number;
  planetId?: string | undefined;
  quantity: number;
};

export type StartedDefenseProductionSnapshot = {
  defense: ChainDefenseState;
  queues: PlayerQueuesResponse;
};

export type WalletPlanetSyncSnapshot = {
  fleetVisibility: FleetMissionVisibilityResponse;
  planetsResponse: WalletPlanetsResponse;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

export type HydratedWalletPlanetSnapshot = WalletPlanetSyncSnapshot & {
  selectedPlanet: ManagedPlanetResponse | NonNullable<WalletSettlementResponse["planet"]>;
};

type WaitOptions = {
  attempts?: number;
  intervalMs?: number;
  delay?: (ms: number) => Promise<void>;
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

export function isCollectedResourcesStateVisible(
  snapshot: CollectedResourcesSnapshot,
  expectation: CollectedResourcesExpectation,
): boolean {
  const settlementPlanet = snapshot.settlement.planet;
  if (!settlementPlanet || settlementPlanet.planetId !== expectation.planetId) return false;
  if (snapshot.infrastructure.homePlanetId !== expectation.planetId) return false;
  if (!snapshot.infrastructure.resources) return false;

  const settlementResources = settlementPlanet.resources;
  const resourcesMatch = settlementResources.metal === snapshot.infrastructure.resources.metal
    && settlementResources.crystal === snapshot.infrastructure.resources.crystal
    && settlementResources.deuterium === snapshot.infrastructure.resources.deuterium;
  if (!resourcesMatch) return false;

  if (!expectation.previousLastSettledAt) return true;
  return BigInt(settlementPlanet.lastSettledAt) > BigInt(expectation.previousLastSettledAt);
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

export function isStartedDefenseProductionVisible(
  snapshot: StartedDefenseProductionSnapshot,
  expectation: StartedDefenseProductionExpectation,
): boolean {
  if (expectation.planetId && snapshot.defense.homePlanetId !== expectation.planetId) return false;

  return defenseQueueMatches(snapshot.defense.queue, expectation)
    && defenseQueueMatches(snapshot.queues.defense, expectation);
}

function defenseQueueMatches(
  queue: ChainDefenseState["queue"] | PlayerQueuesResponse["defense"],
  expectation: StartedDefenseProductionExpectation,
): boolean {
  return Boolean(
    queue?.active
    && queue.itemId === expectation.itemId
    && (queue.quantity ?? 0) >= expectation.quantity,
  );
}

export async function waitForFinishedBuildingState(
  load: () => Promise<FinishedBuildingSnapshot>,
  expectation: FinishedBuildingExpectation,
  options: WaitOptions = {},
): Promise<FinishedBuildingSnapshot> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
  const delay = options.delay ?? defaultDelay;
  let latest: FinishedBuildingSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isFinishedBuildingStateVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(finishedBuildingTimeoutMessage(latest, expectation));
}

export async function waitForStartedDefenseProductionState(
  load: () => Promise<StartedDefenseProductionSnapshot>,
  expectation: StartedDefenseProductionExpectation,
  options: WaitOptions = {},
): Promise<StartedDefenseProductionSnapshot> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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

export async function waitForCollectedResourcesState(
  load: () => Promise<CollectedResourcesSnapshot>,
  expectation: CollectedResourcesExpectation,
  options: WaitOptions = {},
): Promise<CollectedResourcesSnapshot> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
  const delay = options.delay ?? defaultDelay;
  let latest: CollectedResourcesSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isCollectedResourcesStateVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(collectedResourcesTimeoutMessage(latest, expectation));
}

export async function waitForHydratedWalletPlanet(
  load: () => Promise<WalletPlanetSyncSnapshot>,
  preferredPlanetId?: string | undefined,
  options: WaitOptions = {},
): Promise<HydratedWalletPlanetSnapshot> {
  const attempts = options.attempts ?? 12;
  const intervalMs = options.intervalMs ?? 1_500;
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
  const attempts = options.attempts ?? 12;
  const intervalMs = options.intervalMs ?? 1_500;
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

function collectedResourcesTimeoutMessage(
  snapshot: CollectedResourcesSnapshot | undefined,
  expectation: CollectedResourcesExpectation,
): string {
  const lastSettledAt = snapshot?.settlement.planet?.lastSettledAt ?? "unavailable";
  const hasInfrastructureResources = Boolean(snapshot?.infrastructure.resources);
  return `Collect transaction confirmed, but indexed wallet resources for planet ${expectation.planetId} are still syncing. Last settledAt: ${lastSettledAt}; infrastructure resources loaded: ${hasInfrastructureResources}. Try refreshing in a few seconds.`;
}

function finishedBuildingTimeoutMessage(
  snapshot: FinishedBuildingSnapshot | undefined,
  expectation: FinishedBuildingExpectation,
): string {
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

function startedDefenseProductionTimeoutMessage(
  snapshot: StartedDefenseProductionSnapshot | undefined,
  expectation: StartedDefenseProductionExpectation,
): string {
  const defenseQueue = snapshot?.defense.queue;
  const overviewQueue = snapshot?.queues.defense;
  const defenseQuantity = defenseQueue?.active && defenseQueue.itemId === expectation.itemId
    ? defenseQueue.quantity ?? 0
    : 0;
  const overviewQuantity = overviewQueue?.active && overviewQueue.itemId === expectation.itemId
    ? overviewQueue.quantity ?? 0
    : 0;

  return `Defense production transaction confirmed, but indexed defense queue state is still syncing. Expected item ${expectation.itemId} x${expectation.quantity}; Defenses page queue x${defenseQuantity}; Overview queue x${overviewQuantity}. Try refreshing in a few seconds.`;
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

  return `Settlement transaction is confirmed, but the game API did not hydrate a complete planet after ${waitedSeconds}s. Last status: ${reason}. Indexed planets: ${planetCount}. Retry sync in a few seconds; if it repeats, share this status with the transaction hash.`;
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

  return `Rename transaction is confirmed, but indexed planet ${expectation.planetId} did not show "${expectation.name}" after ${waitedSeconds}s. Last status: ${reason}. Retry sync in a few seconds; if it repeats, share this status with the transaction hash.`;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
