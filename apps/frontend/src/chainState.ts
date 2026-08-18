import {
  buildingContractIds,
  buildingCatalog,
  createInitialPlayableState,
  researchCatalog,
  type BuildingKey,
  type EnergyBalance,
  type PlayableState,
  type Resources,
} from "./playableMvp";
import type {
  ChainInfrastructureState,
  ChainResearchState,
  PlayerQueuesResponse,
  QueueStateResponse,
} from "./walletFlow";
import { timestampToMs } from "./timestampFormat";

type BuildingQueueItem = Extract<NonNullable<PlayableState["queue"]>, { kind: "building" }>;

export function emptyContractState(now = Date.now()): PlayableState {
  return {
    ...createInitialPlayableState(now),
    resources: { metal: 0, crystal: 0, deuterium: 0 },
  };
}

export function infrastructurePlayableState(
  infrastructureState: ChainInfrastructureState | null,
  now = Date.now(),
): PlayableState {
  const state = emptyContractState(now);
  if (!infrastructureState) return state;

  return {
    ...state,
    buildings: buildingLevels(infrastructureState),
    research: Object.fromEntries(
      researchCatalog.map((research) => [
        research.key,
        infrastructureState.technologyLevels?.[research.id.toString()] ?? 0,
      ]),
    ) as PlayableState["research"],
    // VEY-KANEO-473: the playable `resources` (what the infrastructure panel and its
    // affordability gate read) must be the SAME canonical settled-to-now balance the top bar
    // shows — the backend's accrued `resourcesAsOfNow` — not the raw settled `resources` snapshot.
    // Reading the raw snapshot here while the top bar read `resourcesAsOfNow` is exactly what made
    // the bar and the affordability gate disagree (bar "51,561 metal" vs panel "Requires more").
    // Fall back to the raw settled `resources` only when the backend has not populated the accrued
    // field (older deploy / planet still warming).
    resources: toResources(infrastructureState.resourcesAsOfNow ?? infrastructureState.resources) ?? state.resources,
    queue: buildingQueueForDisplay(infrastructureState, now) ?? undefined,
  };
}

export function researchPlayableState(
  state: PlayableState,
  researchState: ChainResearchState | null,
  now = Date.now(),
): PlayableState {
  if (!researchState) {
    return {
      ...state,
      buildings: { ...state.buildings, researchLab: 0 },
      research: zeroResearchLevels(),
      researchQueue: undefined,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
    };
  }

  return {
    ...state,
    buildings: {
      ...state.buildings,
      researchLab: researchState.researchLabLevel,
    },
    research: Object.fromEntries(
      researchCatalog.map((research) => {
        const row = researchState.technologies.find((item) => item.id === research.id);
        return [research.key, row?.level ?? researchState.technologyLevels[research.id.toString()] ?? 0];
      }),
    ) as PlayableState["research"],
    researchQueue: researchQueueForDisplay(researchState.queue, now) ?? undefined,
    // VEY-KANEO-473: same single-source rule as infrastructure — gate research affordability on the
    // canonical settled-to-now `resourcesAsOfNow`, falling back to the raw settled snapshot only when
    // the accrued field is absent.
    resources: toResources(researchState.resourcesAsOfNow ?? researchState.resources) ?? { metal: 0, crystal: 0, deuterium: 0 },
  };
}

export function buildingCosts(infrastructureState: ChainInfrastructureState | null): Partial<Record<BuildingKey, Resources>> {
  if (!infrastructureState) return {};

  return Object.fromEntries(
    buildingCatalog.flatMap((building) => {
      const row = infrastructureState.buildings.find((item) => item.id === buildingContractIds[building.key]);
      const cost = usableBuildingCost(row?.cost, infrastructureState);
      return cost ? [[building.key, cost]] : [];
    }),
  ) as Partial<Record<BuildingKey, Resources>>;
}

// Backend-sourced predicted next-upgrade durations per building (VEY-KANEO-472). Paired
// with buildingCosts so the detail panel renders "Build time"/"Upgrade time" from the
// server value instead of re-deriving it on the client (regressed by #821).
export function buildingDurations(
  infrastructureState: ChainInfrastructureState | null,
): Partial<Record<BuildingKey, number>> {
  if (!infrastructureState) return {};

  return Object.fromEntries(
    buildingCatalog.flatMap((building) => {
      const row = infrastructureState.buildings.find((item) => item.id === buildingContractIds[building.key]);
      return typeof row?.durationSeconds === "number" ? [[building.key, row.durationSeconds]] : [];
    }),
  ) as Partial<Record<BuildingKey, number>>;
}

export function buildingLevels(infrastructureState: ChainInfrastructureState): PlayableState["buildings"] {
  return Object.fromEntries(
    buildingCatalog.map((building) => {
      const row = infrastructureState.buildings.find((item) => item.id === buildingContractIds[building.key]);
      return [building.key, row?.level ?? 0];
    }),
  ) as PlayableState["buildings"];
}

export function resourcesFromChain(value: ChainInfrastructureState["resources"]): Resources | undefined {
  return toResources(value);
}

export function energyBalanceFromChain(
  value: ChainInfrastructureState["energyBalance"],
): EnergyBalance | undefined {
  if (!value) return undefined;
  return {
    deuteriumConsumed: 0,
    produced: Number(value.produced),
    required: Number(value.required),
    scaleBps: Number(value.scaleBps),
    ...(value.sources ? { sources: {
      solarPlant: Number(value.sources.solarPlant),
      fusionReactor: Number(value.sources.fusionReactor),
      fusionReactorDeuteriumConsumed: Number(value.sources.fusionReactorDeuteriumConsumed),
      solarSatellites: Number(value.sources.solarSatellites),
      solarSatelliteCount: value.sources.solarSatelliteCount,
      solarSatelliteEnergy: Number(value.sources.solarSatelliteEnergy),
    } } : {}),
  };
}

export function buildingQueueForDisplay(
  infrastructureState: ChainInfrastructureState,
  now = Date.now(),
): PlayableState["queue"] {
  return buildingQueueItemForDisplay(infrastructureState.queue, now);
}

export function activeBuildingQueueResponse(
  queues: PlayerQueuesResponse | undefined,
  infrastructureState: ChainInfrastructureState | null,
): QueueStateResponse | null {
  if (infrastructureState?.queue?.active) return infrastructureState.queue;
  if (queues?.building?.active) return queues.building;
  return null;
}

export function isBuildingQueueReadyToFinish(
  queue: QueueStateResponse | null | undefined,
  now = Date.now(),
): boolean {
  if (!queue?.active) return false;
  // VEY-KANEO-465: use the backend-derived readiness (`asOfNow.complete`,
  // VEY-KANEO-464) instead of comparing `readyAt` to the client clock. Fall back
  // to the timestamp comparison only when the backend has not populated `asOfNow`
  // (older deploy), so readiness still resolves during the transition.
  if (queue.asOfNow) return queue.asOfNow.complete;
  const readyAt = queueTimestampMs(queue.readyAt);
  return readyAt !== undefined && readyAt <= now;
}

export function buildingQueueItemForDisplay(
  queue: QueueStateResponse | null,
  now = Date.now(),
): BuildingQueueItem | undefined {
  if (!queue?.active || queue.itemId === undefined) return undefined;
  const building = buildingCatalog.find((item) => buildingContractIds[item.key] === queue.itemId);
  if (!building) return undefined;

  const readyAt = queueTimestampMs(queue.readyAt) ?? now;
  const chainStartedAt = queueTimestampMs(queue.startedAt);
  // VEY-KANEO-465: anchor the progress bar to the backend's queue `startedAt`
  // (VEY-KANEO-464) — no client duration estimate. When the backend omits
  // startedAt, fall back to readyAt (no progress fill) rather than fabricating a
  // start time from the cost and building levels.
  const startedAt = chainStartedAt !== undefined && chainStartedAt < readyAt
    ? chainStartedAt
    : readyAt;
  return {
    kind: "building",
    key: building.key,
    label: building.label,
    readyAt,
    startedAt,
    targetLevel: queue.targetLevel ?? 0,
  };
}

export function researchQueueForDisplay(
  queue: QueueStateResponse | null,
  _now = Date.now(),
  options: {
    buildings?: PlayableState["buildings"] | undefined;
    research?: PlayableState["research"] | undefined;
    researchNetworkLabLevels?: readonly number[] | undefined;
  } = {},
): PlayableState["researchQueue"] {
  if (!queue?.active || queue.itemId === undefined) return undefined;
  const research = researchCatalog.find((item) => item.id === queue.itemId);
  if (!research) return undefined;

  const readyAt = queueTimestampMs(queue.readyAt);
  if (readyAt === undefined) return undefined;
  const chainStartedAt = queueTimestampMs(queue.startedAt);
  // A missing start has no honest percentage. Keep the active queue visible but
  // omit startedAt so every progress surface renders its indeterminate state.
  const startedAt = chainStartedAt !== undefined && chainStartedAt < readyAt
    ? chainStartedAt
    : undefined;

  return {
    kind: "research",
    key: research.key,
    label: research.label,
    readyAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    targetLevel: queue.targetLevel ?? 0,
  };
}

function zeroResearchLevels(): PlayableState["research"] {
  return Object.fromEntries(researchCatalog.map((research) => [research.key, 0])) as PlayableState["research"];
}

function queueTimestampMs(value: string | null | undefined): number | undefined {
  return timestampToMs(value);
}

function toResources(resources: ChainInfrastructureState["resources"] | ChainInfrastructureState["buildings"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

function usableBuildingCost(
  resources: ChainInfrastructureState["buildings"][number]["cost"] | null | undefined,
  infrastructureState: ChainInfrastructureState,
): Resources | undefined {
  const cost = toResources(resources);
  if (!cost) return undefined;

  if (isIndexedInfrastructureState(infrastructureState) && isZeroResources(cost)) {
    return undefined;
  }

  return cost;
}

function isIndexedInfrastructureState(infrastructureState: ChainInfrastructureState): boolean {
  return infrastructureState.source === "contract-state-indexer" || infrastructureState.stale === true;
}

function isZeroResources(resources: Resources): boolean {
  return resources.metal === 0 && resources.crystal === 0 && resources.deuterium === 0;
}
