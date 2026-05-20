import {
  buildingContractIds,
  buildingCatalog,
  buildingDurationEstimate,
  createInitialPlayableState,
  researchCatalog,
  type BuildingKey,
  type PlayableState,
  type Resources,
} from "./playableMvp";
import type {
  ChainInfrastructureState,
  ChainResearchState,
  QueueStateResponse,
} from "./walletFlow";

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
    resources: toResources(infrastructureState.resources) ?? state.resources,
    queue: buildingQueueForDisplay(infrastructureState, now) ?? undefined,
  };
}

export function researchPlayableState(
  state: PlayableState,
  researchState: ChainResearchState | null,
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
    researchQueue: researchQueueForDisplay(researchState.queue) ?? undefined,
    resources: toResources(researchState.resources) ?? { metal: 0, crystal: 0, deuterium: 0 },
  };
}

export function buildingCosts(infrastructureState: ChainInfrastructureState | null): Partial<Record<BuildingKey, Resources>> {
  if (!infrastructureState) return {};

  return Object.fromEntries(
    buildingCatalog.flatMap((building) => {
      const row = infrastructureState.buildings.find((item) => item.id === buildingContractIds[building.key]);
      const cost = toResources(row?.cost);
      return cost ? [[building.key, cost]] : [];
    }),
  ) as Partial<Record<BuildingKey, Resources>>;
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

export function buildingQueueForDisplay(
  infrastructureState: ChainInfrastructureState,
  now = Date.now(),
): PlayableState["queue"] {
  return buildingQueueItemForDisplay(infrastructureState.queue, buildingLevels(infrastructureState), now);
}

export function buildingQueueItemForDisplay(
  queue: QueueStateResponse | null,
  buildings: PlayableState["buildings"],
  now = Date.now(),
): BuildingQueueItem | undefined {
  if (!queue?.active || queue.itemId === undefined) return undefined;
  const building = buildingCatalog.find((item) => buildingContractIds[item.key] === queue.itemId);
  if (!building) return undefined;

  const readyAt = queueTimestampMs(queue.readyAt) ?? now;
  const chainStartedAt = queueTimestampMs(queue.startedAt);
  const cost = toResources(queue.cost) ?? { metal: 0, crystal: 0, deuterium: 0 };
  const durationMs = buildingDurationEstimate(buildings, cost) * 1_000;
  const startedAt = chainStartedAt !== undefined && chainStartedAt < readyAt
    ? chainStartedAt
    : readyAt - durationMs;
  return {
    kind: "building",
    key: building.key,
    label: building.label,
    readyAt,
    startedAt,
    targetLevel: queue.targetLevel ?? 0,
  };
}

export function researchQueueForDisplay(queue: QueueStateResponse | null): PlayableState["researchQueue"] {
  if (!queue?.active || queue.itemId === undefined) return undefined;
  const research = researchCatalog.find((item) => item.id === queue.itemId);
  if (!research) return undefined;

  const readyAt = queue.readyAt ? Number(queue.readyAt) * 1_000 : Date.now();
  return {
    kind: "research",
    key: research.key,
    label: research.label,
    readyAt,
    startedAt: Date.now(),
    targetLevel: queue.targetLevel ?? 0,
  };
}

function zeroResearchLevels(): PlayableState["research"] {
  return Object.fromEntries(researchCatalog.map((research) => [research.key, 0])) as PlayableState["research"];
}

function queueTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return timestamp * 1_000;
}

function toResources(resources: ChainInfrastructureState["resources"] | ChainInfrastructureState["buildings"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}
