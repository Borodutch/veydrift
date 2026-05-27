import type {
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
  const reconciledPlanet = reconcileSelectedPlanetWithSettlement(selectedPlanet, snapshot.settlement.planet);
  if (!reconciledPlanet.resources?.metal || !reconciledPlanet.resources.crystal || !reconciledPlanet.resources.deuterium) return undefined;
  if (!Number.isFinite(reconciledPlanet.galaxy) || !Number.isFinite(reconciledPlanet.system) || !Number.isFinite(reconciledPlanet.position)) {
    return undefined;
  }

  return {
    ...snapshot,
    selectedPlanet: reconciledPlanet,
  };
}

function reconcileSelectedPlanetWithSettlement(
  selectedPlanet: ManagedPlanetResponse | NonNullable<WalletSettlementResponse["planet"]>,
  settlementPlanet: WalletSettlementResponse["planet"],
): ManagedPlanetResponse | NonNullable<WalletSettlementResponse["planet"]> {
  if (!settlementPlanet || selectedPlanet.planetId !== settlementPlanet.planetId) {
    return selectedPlanet;
  }

  const selectedLastSettledAt = Number(selectedPlanet.lastSettledAt);
  const settlementLastSettledAt = Number(settlementPlanet.lastSettledAt);
  if (!Number.isFinite(settlementLastSettledAt)) return selectedPlanet;
  if (Number.isFinite(selectedLastSettledAt) && selectedLastSettledAt > settlementLastSettledAt) {
    return selectedPlanet;
  }

  return {
    ...selectedPlanet,
    ...settlementPlanet,
  };
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

export async function waitForCollectedWalletPlanet(
  load: () => Promise<WalletPlanetSyncSnapshot>,
  preferredPlanetId: string | undefined,
  previousLastSettledAtSeconds: number,
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
      const lastSettledAt = Number(hydrated?.selectedPlanet.lastSettledAt);
      if (hydrated && Number.isFinite(lastSettledAt) && lastSettledAt > previousLastSettledAtSeconds) {
        return hydrated;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  throw new Error(collectedWalletPlanetTimeoutMessage(latest, previousLastSettledAtSeconds, lastError, attempts * intervalMs));
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

function collectedWalletPlanetTimeoutMessage(
  snapshot: WalletPlanetSyncSnapshot | undefined,
  previousLastSettledAtSeconds: number,
  lastError: unknown,
  waitedMs: number,
): string {
  const waitedSeconds = Math.round(waitedMs / 1_000);
  if (lastError instanceof Error) {
    return `Resource collection confirmed, but the game API is still syncing updated resources after ${waitedSeconds}s: ${lastError.message}`;
  }

  const hydrated = snapshot ? hydratedWalletPlanetSnapshot(snapshot) : undefined;
  const lastSettledAt = hydrated?.selectedPlanet.lastSettledAt ?? "unavailable";
  return `Resource collection confirmed, but the game API still reports lastSettledAt ${lastSettledAt} instead of a value after ${previousLastSettledAtSeconds} after ${waitedSeconds}s. Retry sync in a few seconds.`;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
