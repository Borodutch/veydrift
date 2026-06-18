import type {
  ChainDefenseState,
  ChainInfrastructureState,
  ChainMoonState,
  ChainResearchState,
  ChainRiftState,
  ChainShipyardState,
} from "./walletFlow";

export type PlanetSectionState = {
  infrastructureChainState: ChainInfrastructureState | null;
  moonState: ChainMoonState | null;
  defenseState: ChainDefenseState | null;
  shipyardState: ChainShipyardState | null;
  researchState: ChainResearchState | null;
  riftState: ChainRiftState | null;
};

export type PlanetSectionStore = Record<string, PlanetSectionState>;

export type PlanetSectionValueUpdater<T> = T | ((current: T) => T);

export const emptyPlanetSectionState: PlanetSectionState = {
  infrastructureChainState: null,
  moonState: null,
  defenseState: null,
  shipyardState: null,
  researchState: null,
  riftState: null,
};

export function planetSectionForPlanet(
  store: PlanetSectionStore,
  planetId: string | null | undefined,
): PlanetSectionState {
  return planetId ? store[planetId] ?? emptyPlanetSectionState : emptyPlanetSectionState;
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

export function hasPlanetSectionData(
  section: PlanetSectionState,
  key?: keyof PlanetSectionState,
): boolean {
  if (key) return section[key] !== null;
  return Object.values(section).some((value) => value !== null);
}

function normalizePlanetSectionState(section: Partial<PlanetSectionState>): PlanetSectionState {
  return {
    ...emptyPlanetSectionState,
    ...section,
  };
}
