import type {
  ChainDefenseState,
  ChainShipyardState,
  ChainResearchState,
  FleetMissionVisibilityResponse,
  ChainInfrastructureState,
  ChainAllianceState,
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

export type StartedDefenseProductionExpectation = {
  itemId: number;
  planetId?: string | undefined;
  quantity: number;
};

export type StartedDefenseProductionSnapshot = {
  defense: ChainDefenseState;
  queues: PlayerQueuesResponse;
};

export type StartedShipProductionExpectation = {
  itemId: number;
  planetId?: string | undefined;
  quantity: number;
};

export type StartedShipProductionSnapshot = {
  queues: PlayerQueuesResponse;
  shipyard: ChainShipyardState;
};

export type StartedResearchExpectation = {
  itemId: number;
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
  fleetVisibility: FleetMissionVisibilityResponse;
  planetsResponse: WalletPlanetsResponse;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

export type AllianceApplicationExpectation = {
  allianceId: string;
  requester: string;
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

export function isStartedShipProductionVisible(
  snapshot: StartedShipProductionSnapshot,
  expectation: StartedShipProductionExpectation,
): boolean {
  if (expectation.planetId && (snapshot.shipyard.planetId ?? snapshot.shipyard.homePlanetId) !== expectation.planetId) return false;

  return shipQueueMatches(snapshot.shipyard.queue, expectation)
    && shipQueueMatches(snapshot.queues.ship, expectation);
}

export function isStartedResearchStateVisible(
  snapshot: StartedResearchSnapshot,
  expectation: StartedResearchExpectation,
): boolean {
  return researchQueueMatches(snapshot.research.queue, expectation)
    && researchQueueMatches(snapshot.queues.research, expectation);
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

function shipQueueMatches(
  queue: ChainShipyardState["queue"] | PlayerQueuesResponse["ship"],
  expectation: StartedShipProductionExpectation,
): boolean {
  return Boolean(
    queue?.active
    && queue.itemId === expectation.itemId
    && (queue.quantity ?? 0) >= expectation.quantity,
  );
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
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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

export async function waitForStartedShipProductionState(
  load: () => Promise<StartedShipProductionSnapshot>,
  expectation: StartedShipProductionExpectation,
  options: WaitOptions = {},
): Promise<StartedShipProductionSnapshot> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
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

  return "The game API or RPC is temporarily unavailable while the confirmed transaction state is being checked. Keeping the last known game state and retrying from live sync; this is not a wallet network mismatch.";
}

export function isTransientGameStateReadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|load failed|network|err_http2|timed out reading .+ from the game api|api failed: 5\d\d|backend_not_configured|rpc http|rate limit|too many requests/i.test(message);
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

function startedShipProductionTimeoutMessage(
  snapshot: StartedShipProductionSnapshot | undefined,
  expectation: StartedShipProductionExpectation,
): string {
  const shipyardQueue = snapshot?.shipyard.queue;
  const overviewQueue = snapshot?.queues.ship;
  const shipyardQuantity = shipyardQueue?.active && shipyardQueue.itemId === expectation.itemId
    ? shipyardQueue.quantity ?? 0
    : 0;
  const overviewQuantity = overviewQueue?.active && overviewQueue.itemId === expectation.itemId
    ? overviewQueue.quantity ?? 0
    : 0;

  return `Ship production transaction confirmed, but indexed shipyard queue state is still syncing. Expected item ${expectation.itemId} x${expectation.quantity}; Shipyard page queue x${shipyardQuantity}; Overview queue x${overviewQuantity}. Try refreshing in a few seconds.`;
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
