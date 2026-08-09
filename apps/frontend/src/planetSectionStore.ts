import type {
  ChainDefenseState,
  ChainInfrastructureState,
  ChainMoonState,
  ChainResearchState,
  ChainRiftState,
  ChainShipyardState,
  FleetMissionArchiveResponse,
  FleetMissionSummary,
  FleetMissionVisibilityResponse,
  GlobalMissionArchiveResponse,
  PlayerQueuesResponse,
  WalletSettlementResponse,
} from "./walletFlow";
import type { PlanetType } from "./types";

export type PlanetSectionState = {
  infrastructureChainState: ChainInfrastructureState | null;
  moonState: ChainMoonState | null;
  defenseState: ChainDefenseState | null;
  shipyardState: ChainShipyardState | null;
  researchState: ChainResearchState | null;
  riftState: ChainRiftState | null;
  settlementState?: WalletSettlementResponse | undefined;
  queuesState?: PlayerQueuesResponse | undefined;
  fleetVisibilityState?: FleetMissionVisibilityResponse | undefined;
  missionArchiveState?: FleetMissionArchiveResponse | undefined;
  allActiveMissionsState?: FleetMissionSummary[] | undefined;
  globalMissionArchiveState?: GlobalMissionArchiveResponse | undefined;
  missionArchetypesByCoordinate?: Map<string, PlanetType> | undefined;
  galaxySystemDataByKey?: Record<string, unknown> | undefined;
  sectionStatus: Partial<Record<PlanetSectionDataKey, PlanetSectionRefreshStatus>>;
};

export type PlanetSectionStore = Record<string, PlanetSectionState>;

export type PlanetSectionValueUpdater<T> = T | ((current: T) => T);

export type PlanetSectionRefreshFunction = () => unknown | Promise<unknown>;

export type PlanetSectionRefreshers = Partial<Record<PlanetSectionDataKey, PlanetSectionRefreshFunction>>;

export type PlanetSectionData<K extends PlanetSectionDataKey> = PlanetSectionState[K];

export type PlanetSectionReader<K extends PlanetSectionDataKey> = {
  key: K;
  data: PlanetSectionData<K>;
  status: PlanetSectionRefreshStatus;
  refresh: PlanetSectionRefreshFunction | undefined;
};

export type PlanetSectionAccess = {
  planetId: string | null | undefined;
  section: PlanetSectionState;
  read: <K extends PlanetSectionDataKey>(key: K) => PlanetSectionReader<K>;
  refresh: (key: PlanetSectionDataKey) => unknown | Promise<unknown>;
};

export type PlanetSectionDataKey =
  | "infrastructureChainState"
  | "moonState"
  | "defenseState"
  | "shipyardState"
  | "researchState"
  | "riftState"
  | "settlementState"
  | "queuesState"
  | "fleetVisibilityState"
  | "missionArchiveState"
  | "allActiveMissionsState"
  | "globalMissionArchiveState"
  | "missionArchetypesByCoordinate"
  | "galaxySystemDataByKey";

export type PlanetSectionRefreshStatus = {
  loading: boolean;
  error?: string | undefined;
  lastSuccessfulRefreshAt?: number | undefined;
};

export const emptyPlanetSectionState: PlanetSectionState = {
  infrastructureChainState: null,
  moonState: null,
  defenseState: null,
  shipyardState: null,
  researchState: null,
  riftState: null,
  sectionStatus: {},
};

export function planetSectionForPlanet(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
): PlanetSectionState {
  return planetId ? store[planetId] ?? emptyPlanetSectionState : emptyPlanetSectionState;
}

export function indexedInfrastructurePlanetId(
  store: PlanetSectionStore,
  wallet: string | null | undefined,
): string | undefined {
  if (!wallet) return undefined;
  const normalizedWallet = wallet.toLowerCase();
  return Object.entries(store).find(([, section]) => (
    section.infrastructureChainState?.wallet?.toLowerCase() === normalizedWallet
  ))?.[0];
}

export function infrastructureSnapshotPlanetId(
  snapshot: ChainInfrastructureState | null | undefined,
  fallbackPlanetId: string | null | undefined,
): string | undefined {
  return snapshot?.planetId ?? snapshot?.homePlanetId ?? fallbackPlanetId ?? undefined;
}

export function planetSectionStatus(
  section: PlanetSectionState,
  key: PlanetSectionDataKey,
): PlanetSectionRefreshStatus {
  return section.sectionStatus[key] ?? { loading: false };
}

export function planetSectionAccessForPlanet(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
  refreshers: PlanetSectionRefreshers = {},
): PlanetSectionAccess {
  const section = planetSectionForPlanet(store, planetId);
  return {
    planetId,
    section,
    read: <K extends PlanetSectionDataKey>(key: K): PlanetSectionReader<K> => ({
      key,
      data: section[key],
      status: planetSectionStatus(section, key),
      refresh: refreshers[key],
    }),
    refresh: (key: PlanetSectionDataKey) => refreshers[key]?.(),
  };
}

export function planetSectionStoreFromInitialState(
  activePlanetId: string | null | undefined,
  state: Partial<PlanetSectionState> | undefined,
): PlanetSectionStore {
  if (!state || !activePlanetId) return {};

  const section = normalizePlanetSectionState(state);

  return hasPlanetSectionData(section) ? { [activePlanetId]: section } : {};
}

export function setPlanetSectionValue<K extends keyof PlanetSectionState>(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
  key: K,
  updater: PlanetSectionValueUpdater<PlanetSectionState[K]>,
): PlanetSectionStore {
  if (!planetId) return store;

  const current = planetSectionForPlanet(store, planetId);
  const nextValue = typeof updater === "function"
    ? (updater as (value: PlanetSectionState[K]) => PlanetSectionState[K])(current[key])
    : updater;

  if (current[key] === nextValue && store[planetId]) return store;

  return {
    ...store,
    [planetId]: {
      ...current,
      [key]: nextValue,
    },
  };
}

export function setPlanetSectionStatus(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
  key: PlanetSectionDataKey,
  status: Partial<PlanetSectionRefreshStatus>,
): PlanetSectionStore {
  if (!planetId) return store;

  const current = planetSectionForPlanet(store, planetId);
  const currentStatus = current.sectionStatus[key] ?? { loading: false };
  const nextStatus = { ...currentStatus, ...status };
  if (
    currentStatus.loading === nextStatus.loading
    && currentStatus.error === nextStatus.error
    && currentStatus.lastSuccessfulRefreshAt === nextStatus.lastSuccessfulRefreshAt
    && store[planetId]
  ) {
    return store;
  }

  return {
    ...store,
    [planetId]: {
      ...current,
      sectionStatus: {
        ...current.sectionStatus,
        [key]: nextStatus,
      },
    },
  };
}

export function setPlanetSectionData<K extends PlanetSectionDataKey>(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
  key: K,
  value: PlanetSectionState[K],
  status?: Partial<PlanetSectionRefreshStatus>,
): PlanetSectionStore {
  const next = setPlanetSectionValue(store, planetId, key, value);
  if (!status) return next;
  return setPlanetSectionStatus(next, planetId, key, status);
}

export function hasPlanetSectionData(
  section: PlanetSectionState,
  key?: PlanetSectionDataKey,
): boolean {
  if (key) return hasDataValue(section[key]);
  return planetSectionDataKeys.some((dataKey) => hasDataValue(section[dataKey]));
}

function normalizePlanetSectionState(section: Partial<PlanetSectionState>): PlanetSectionState {
  return {
    ...emptyPlanetSectionState,
    ...section,
    sectionStatus: section.sectionStatus ?? {},
  };
}

const planetSectionDataKeys: PlanetSectionDataKey[] = [
  "infrastructureChainState",
  "moonState",
  "defenseState",
  "shipyardState",
  "researchState",
  "riftState",
  "settlementState",
  "queuesState",
  "fleetVisibilityState",
  "missionArchiveState",
  "allActiveMissionsState",
  "globalMissionArchiveState",
  "missionArchetypesByCoordinate",
  "galaxySystemDataByKey",
];

function hasDataValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Map) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
