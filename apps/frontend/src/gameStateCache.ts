import type { Planet } from "./types";
import type {
  ChainAllianceState,
  ChainDefenseState,
  ChainInfrastructureState,
  ChainMoonState,
  ChainResearchState,
  ChainShipyardState,
  FleetMissionArchiveResponse,
  FleetMissionVisibilityResponse,
  ManagedPlanetResponse,
  PlayerProfile,
  PlayerQueuesResponse,
  WalletSettlementResponse,
} from "./walletFlow";

// VEY-242: keep loaded game data visible across a full page reload.
//
// The app already keeps loaded data on screen during in-app polling/refetch
// (in-memory stale-while-revalidate). A hard reload, however, resets every
// React state to empty, so each section falls back to its genuine "first load"
// loader ("Resources loading", "Syncing planetfall", etc.) until the API
// responds. Persisting the last loaded snapshot to sessionStorage and hydrating
// it into the initial state lets a reload show the previous data immediately
// while the live fetch revalidates in the background.
//
// sessionStorage (not localStorage) is deliberate: the cached snapshot survives
// reloads within the same tab session but is dropped when the tab closes, so we
// never persist wallet-derived game state to disk longer than the active
// session. The cache only seeds the initial render; the live fetch and the
// existing freshness/anti-snapback gates remain authoritative.

export const GAME_STATE_SNAPSHOT_VERSION = 2;
export const GAME_STATE_STORAGE_KEY = "veydrift:gameStateSnapshot";

export type PersistedGameState = {
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
  walletPlanets?: ManagedPlanetResponse[] | undefined;
  selectedPlanetId?: string | undefined;
  playerProfile?: PlayerProfile | undefined;
  homePlanetIdentity?: Planet | undefined;
  infrastructureChainState?: ChainInfrastructureState | null | undefined;
  researchState?: ChainResearchState | null | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
  defenseState?: ChainDefenseState | null | undefined;
  moonState?: ChainMoonState | null | undefined;
  allianceState?: ChainAllianceState | null | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  missionArchive?: FleetMissionArchiveResponse | undefined;
};

export type GameStateSnapshot = PersistedGameState & {
  version: number;
  account: string;
  savedAtMs: number;
};

export function normalizeAccount(account: string | undefined): string | undefined {
  return account ? account.toLowerCase() : undefined;
}

// Only a snapshot that carries a settlement is worth persisting/hydrating: the
// settlement is what flips `walletPlanetHydrated` true and therefore what stops
// the full-page "Syncing planetfall" loader from blanking the page on reload.
export function hasPersistableGameState(state: PersistedGameState): boolean {
  return Boolean(state.onChainSettlement);
}

const PERSISTED_KEYS: Array<keyof PersistedGameState> = [
  "onChainSettlement",
  "onChainQueues",
  "walletPlanets",
  "selectedPlanetId",
  "playerProfile",
  "homePlanetIdentity",
  "infrastructureChainState",
  "researchState",
  "shipyardState",
  "defenseState",
  "moonState",
  "allianceState",
  "fleetVisibility",
  "missionArchive",
];

function pickPersistedState(state: PersistedGameState): PersistedGameState {
  const next: PersistedGameState = {};
  for (const key of PERSISTED_KEYS) {
    const value = state[key];
    if (value !== undefined) {
      // Index assignment across a heterogeneous record needs a cast.
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

export function buildGameStateSnapshot(input: {
  account: string | undefined;
  savedAtMs: number;
  state: PersistedGameState;
}): GameStateSnapshot | null {
  const account = normalizeAccount(input.account);
  if (!account) return null;
  if (!hasPersistableGameState(input.state)) return null;
  return {
    version: GAME_STATE_SNAPSHOT_VERSION,
    account,
    savedAtMs: input.savedAtMs,
    ...pickPersistedState(input.state),
  };
}

// Returns the persisted slices to seed initial state with, or undefined when the
// snapshot is missing, stale (version mismatch), or belongs to a different
// wallet than the one now connecting. When `account` is unknown at mount we
// optimistically hydrate the snapshot (it belongs to this tab's previous
// session); a later account mismatch is reconciled by the caller.
export function hydrateGameStateForAccount(
  snapshot: GameStateSnapshot | undefined,
  account: string | undefined,
): PersistedGameState | undefined {
  if (!snapshot) return undefined;
  if (snapshot.version !== GAME_STATE_SNAPSHOT_VERSION) return undefined;
  if (!hasPersistableGameState(snapshot)) return undefined;
  const normalized = normalizeAccount(account);
  if (normalized && snapshot.account !== normalized) return undefined;
  return pickPersistedState(snapshot);
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readGameStateSnapshot(
  storage: StorageLike | undefined = defaultStorage(),
): GameStateSnapshot | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(GAME_STATE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GameStateSnapshot;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (parsed.version !== GAME_STATE_SNAPSHOT_VERSION) return undefined;
    if (typeof parsed.account !== "string" || parsed.account.length === 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeGameStateSnapshot(
  snapshot: GameStateSnapshot,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota errors / disabled storage are non-fatal; the live fetch still runs.
  }
}

export function clearGameStateSnapshot(
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(GAME_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
