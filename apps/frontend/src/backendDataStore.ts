import {
  fetchAllianceState,
  fetchAttackProtectionStatus,
  fetchBattleReports,
  fetchBurningChickenForOwner,
  fetchDefenseState,
  fetchFleetMissionArchive,
  fetchFleetMissionVisibility,
  fetchGlobalActiveMissions,
  fetchGlobalMissionArchive,
  fetchHighscores,
  fetchInfrastructureState,
  fetchMissileAttackArchive,
  fetchMission,
  fetchMoonState,
  fetchPlayerActivity,
  fetchPlayerHighscore,
  fetchPlayerProfile,
  fetchRaidFinderDebrisTargets,
  fetchRaidFinderRifters,
  fetchResearchState,
  fetchReferralDashboard,
  fetchReferralHistory,
  fetchRiftState,
  fetchSettlementFundingState,
  fetchShipyardState,
  fetchSystemData,
  fetchWalletOverviewSnapshot,
  fetchWalletPlanets,
  fetchWalletQueues,
  fetchWalletSettlement,
  fetchWatchedPlanets,
  type AttackProtectionStatus,
  type BattleReport,
  type BurningChickenConfig,
  type ChainAllianceState,
  type ChainDefenseState,
  type ChainInfrastructureState,
  type ChainMoonState,
  type ChainResearchState,
  type ChainRiftState,
  type ChainShipyardState,
  type FleetMissionArchiveResponse,
  type FleetMissionVisibilityResponse,
  type FetchHighscoreOptions,
  type GlobalActiveMissionsResponse,
  type GlobalMissionArchiveResponse,
  type HighscoreEntry,
  type HighscoreResponse,
  type MissileAttackArchiveResponse,
  type MissionDetailResponse,
  type PlayerActivityResponse,
  type PlayerProfile,
  type PlayerQueuesResponse,
  type RaidFinderDebrisResponse,
  type RaidFinderRiftersResponse,
  type ReferralDashboard,
  type ReferralHistoryResponse,
  type SettlementFundingState,
  type WalletOverviewSnapshotResponse,
  type WalletPlanetsResponse,
  type WalletSettlementResponse,
  type WatchedPlanetsResponse,
} from "./walletFlow";
import {
  fetchEntityMedia,
  updateEntityMedia,
  type EntityMediaKind,
  type EntityMediaResponse,
} from "./entityMedia";
import type { Eip1193Provider } from "./walletFlow";

export type BackendDataStatus = "error" | "idle" | "loading" | "ready";

export type BackendDataEntry<T> = {
  data: T | undefined;
  error: Error | undefined;
  status: BackendDataStatus;
  updatedAt: number | undefined;
};

type WalletReadOptions = {
  source?: "indexed";
  timeoutMs?: number;
};

type FleetMissionVisibilityOptions = WalletReadOptions & {
  includeArchive?: boolean;
};

type FleetMissionArchiveOptions = {
  filter?: "incomingAttacks";
  missionNumber?: string;
  missionType?: string;
  page?: number;
  pageSize?: number;
  planetId?: string;
};

type GlobalMissionArchiveOptions = {
  missionNumber?: string;
  missionType?: string;
  page?: number;
  pageSize?: number;
  planetId?: string;
  summaryOnly?: boolean;
};

type BackendDataListener = () => void;

function cacheKey(kind: string, ...parts: unknown[]): string {
  return `${kind}:${JSON.stringify(parts)}`;
}

/**
 * The single read-side boundary for the playable frontend.
 *
 * It owns the latest response, loading/error metadata, and every in-flight
 * request. Calling the same refresh trigger again while it is running returns
 * the existing promise. UI code never needs its own request mutex or a second
 * backend call for data another surface already requested.
 */
export class BackendDataStore {
  private readonly entries = new Map<string, BackendDataEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<BackendDataListener>();
  private generation = 0;

  constructor(readonly apiBaseUrl: string) {}

  subscribe(listener: BackendDataListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  entry<T>(key: string): BackendDataEntry<T> {
    return (this.entries.get(key) as BackendDataEntry<T> | undefined) ?? {
      data: undefined,
      error: undefined,
      status: "idle",
      updatedAt: undefined,
    };
  }

  value<T>(key: string): T | undefined {
    return this.entry<T>(key).data;
  }

  write<T>(key: string, data: T): void {
    this.entries.set(key, {
      data,
      error: undefined,
      status: "ready",
      updatedAt: Date.now(),
    });
    this.emit();
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
    this.emit();
  }

  refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;

    const previous = this.entry<T>(key);
    const requestGeneration = this.generation;
    this.entries.set(key, {
      data: previous.data,
      error: undefined,
      status: "loading",
      updatedAt: previous.updatedAt,
    });

    let request!: Promise<T>;
    request = Promise.resolve()
      .then(load)
      .then((data) => {
        if (requestGeneration === this.generation) {
          this.entries.set(key, {
            data,
            error: undefined,
            status: "ready",
            updatedAt: Date.now(),
          });
          this.emit();
        }
        return data;
      })
      .catch((error: unknown) => {
        if (requestGeneration === this.generation) {
          this.entries.set(key, {
            data: previous.data,
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
            updatedAt: previous.updatedAt,
          });
          this.emit();
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    this.emit();
    return request;
  }

  settlement(wallet: string, options: WalletReadOptions = {}): Promise<WalletSettlementResponse> {
    const key = cacheKey("settlement", wallet, options);
    return this.refresh(key, () => fetchWalletSettlement(this.apiBaseUrl, wallet, options));
  }

  overview(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<WalletOverviewSnapshotResponse> {
    const key = cacheKey("overview", wallet, planetId, options);
    return this.refresh(key, () => fetchWalletOverviewSnapshot(this.apiBaseUrl, wallet, planetId, options));
  }

  planets(wallet: string): Promise<WalletPlanetsResponse> {
    const key = cacheKey("planets", wallet);
    return this.refresh(key, () => fetchWalletPlanets(this.apiBaseUrl, wallet));
  }

  watchedPlanets(wallet: string, options: { page?: number; pageSize?: number } = {}): Promise<WatchedPlanetsResponse> {
    const key = cacheKey("watched-planets", wallet, options);
    return this.refresh(key, () => fetchWatchedPlanets(this.apiBaseUrl, wallet, options));
  }

  queues(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<PlayerQueuesResponse> {
    const key = cacheKey("queues", wallet, planetId, options);
    return this.refresh(key, () => fetchWalletQueues(this.apiBaseUrl, wallet, planetId, options));
  }

  infrastructure(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainInfrastructureState> {
    const key = cacheKey("infrastructure", wallet, planetId, options);
    return this.refresh(key, () => fetchInfrastructureState(this.apiBaseUrl, wallet, planetId, options));
  }

  moon(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainMoonState> {
    const key = cacheKey("moon", wallet, planetId, options);
    return this.refresh(key, () => fetchMoonState(this.apiBaseUrl, wallet, planetId, options));
  }

  shipyard(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainShipyardState> {
    const key = cacheKey("shipyard", wallet, planetId, options);
    return this.refresh(key, () => fetchShipyardState(this.apiBaseUrl, wallet, planetId, options));
  }

  defenses(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
    const key = cacheKey("defenses", wallet, planetId, options);
    return this.refresh(key, () => fetchDefenseState(this.apiBaseUrl, wallet, planetId, options));
  }

  research(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
    const key = cacheKey("research", wallet, planetId, options);
    return this.refresh(key, () => fetchResearchState(this.apiBaseUrl, wallet, planetId, options));
  }

  rift(wallet: string, planetId?: string): Promise<ChainRiftState> {
    const key = cacheKey("rift", wallet, planetId);
    return this.refresh(key, () => fetchRiftState(this.apiBaseUrl, wallet, planetId));
  }

  alliance(wallet: string): Promise<ChainAllianceState> {
    const key = cacheKey("alliance", wallet);
    return this.refresh(key, () => fetchAllianceState(this.apiBaseUrl, wallet));
  }

  profile(wallet: string): Promise<PlayerProfile> {
    const key = cacheKey("profile", wallet);
    return this.refresh(key, () => fetchPlayerProfile(this.apiBaseUrl, wallet));
  }

  settlementFunding(wallet: string): Promise<SettlementFundingState> {
    const key = cacheKey("settlement-funding", wallet);
    return this.refresh(key, () => fetchSettlementFundingState(this.apiBaseUrl, wallet));
  }

  referralDashboard(wallet: string): Promise<ReferralDashboard> {
    const key = cacheKey("referral-dashboard", wallet);
    return this.refresh(key, () => fetchReferralDashboard(this.apiBaseUrl, wallet));
  }

  referralHistory(wallet: string, page = 1, pageSize = 25): Promise<ReferralHistoryResponse> {
    const key = cacheKey("referral-history", wallet, page, pageSize);
    return this.refresh(key, () => fetchReferralHistory(this.apiBaseUrl, wallet, page, pageSize));
  }

  playerActivity(
    wallet: string,
    options: { includeProjected?: boolean; page?: number; pageSize?: number; since?: number } = {},
  ): Promise<PlayerActivityResponse> {
    const key = cacheKey("player-activity", wallet, options);
    return this.refresh(key, () => fetchPlayerActivity(this.apiBaseUrl, wallet, options));
  }

  highscores(options: FetchHighscoreOptions | number = 100): Promise<HighscoreResponse> {
    const key = cacheKey("highscores", options);
    return this.refresh(key, () => fetchHighscores(this.apiBaseUrl, options));
  }

  playerHighscore(wallet: string): Promise<HighscoreEntry | null> {
    const key = cacheKey("player-highscore", wallet);
    return this.refresh(key, () => fetchPlayerHighscore(this.apiBaseUrl, wallet));
  }

  raidFinderDebris(options: { limit?: number } = {}): Promise<RaidFinderDebrisResponse> {
    const key = cacheKey("raid-finder-debris", options);
    return this.refresh(key, () => fetchRaidFinderDebrisTargets(this.apiBaseUrl, options));
  }

  raidFinderRifters(options: { limit?: number } = {}): Promise<RaidFinderRiftersResponse> {
    const key = cacheKey("raid-finder-rifters", options);
    return this.refresh(key, () => fetchRaidFinderRifters(this.apiBaseUrl, options));
  }

  system<T = unknown>(galaxy: number, system: number, options: { detail?: "full" } = {}): Promise<T> {
    const key = cacheKey("system", galaxy, system, options);
    return this.refresh(key, () => fetchSystemData(this.apiBaseUrl, galaxy, system, options) as Promise<T>);
  }

  randomnessReadiness<T = unknown>(): Promise<T> {
    const key = cacheKey("randomness-readiness");
    return this.refresh(key, async () => {
      const response = await fetch(`${this.apiBaseUrl}/randomness-readiness`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const payload = await response.json() as T & { reasons?: unknown };
      if (!response.ok) {
        const reason = Array.isArray(payload.reasons) && typeof payload.reasons[0] === "string"
          ? payload.reasons[0]
          : `Randomness readiness API failed: ${response.status}`;
        throw new Error(reason);
      }
      return payload;
    });
  }

  runtimeConfig<T>(url: string): Promise<T> {
    const key = cacheKey("runtime-config", url);
    return this.refresh(key, async () => {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
      return response.json() as Promise<T>;
    });
  }

  attackProtection(wallet: string, targetPlanetId: string): Promise<AttackProtectionStatus> {
    const key = cacheKey("attack-protection", wallet, targetPlanetId);
    return this.refresh(key, () => fetchAttackProtectionStatus(this.apiBaseUrl, wallet, targetPlanetId));
  }

  fleetVisibility(wallet: string, options: FleetMissionVisibilityOptions = {}): Promise<FleetMissionVisibilityResponse> {
    const key = cacheKey("fleet-visibility", wallet, options);
    return this.refresh(key, () => fetchFleetMissionVisibility(this.apiBaseUrl, wallet, options));
  }

  fleetArchive(wallet: string, options: FleetMissionArchiveOptions = {}): Promise<FleetMissionArchiveResponse> {
    const key = cacheKey("fleet-archive", wallet, options);
    return this.refresh(key, () => fetchFleetMissionArchive(this.apiBaseUrl, wallet, options));
  }

  missileArchive(wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}): Promise<MissileAttackArchiveResponse> {
    const key = cacheKey("missile-archive", wallet, options);
    return this.refresh(key, () => fetchMissileAttackArchive(this.apiBaseUrl, wallet, options));
  }

  globalActiveMissions(): Promise<GlobalActiveMissionsResponse> {
    const key = cacheKey("global-active-missions");
    return this.refresh(key, () => fetchGlobalActiveMissions(this.apiBaseUrl));
  }

  landingActiveMissions<T>(): Promise<T[]> {
    const key = cacheKey("landing-active-missions");
    return this.refresh(key, async () => {
      const response = await fetch(`${this.apiBaseUrl}/missions?status=active&live=1`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Failed to load landing missions");
      const data = await response.json() as { missions?: T[] };
      return data.missions ?? [];
    });
  }

  landingHighscores<T>(): Promise<T[]> {
    const key = cacheKey("landing-highscores");
    return this.refresh(key, async () => {
      const params = new URLSearchParams({
        category: "total",
        live: "1",
        page: "1",
        pageSize: "250",
      });
      const response = await fetch(`${this.apiBaseUrl}/highscores?${params.toString()}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Failed to load landing highscores");
      const data = await response.json() as { rankings?: { total?: T[] } };
      return data.rankings?.total ?? [];
    });
  }

  globalMissionArchive(options: GlobalMissionArchiveOptions = {}): Promise<GlobalMissionArchiveResponse> {
    const key = cacheKey("global-mission-archive", options);
    return this.refresh(key, () => fetchGlobalMissionArchive(this.apiBaseUrl, options));
  }

  mission(missionId: string): Promise<MissionDetailResponse> {
    const key = cacheKey("mission", missionId);
    return this.refresh(key, () => fetchMission(this.apiBaseUrl, missionId));
  }

  battleReports(): Promise<BattleReport[]> {
    const key = cacheKey("battle-reports");
    return this.refresh(key, () => fetchBattleReports(this.apiBaseUrl));
  }

  entityMedia(entityKind: EntityMediaKind, entityId: string): Promise<EntityMediaResponse> {
    const key = cacheKey("entity-media", entityKind, entityId);
    return this.refresh(key, () => fetchEntityMedia(this.apiBaseUrl, entityKind, entityId));
  }

  async saveEntityMedia(
    provider: Eip1193Provider,
    wallet: string,
    entityKind: EntityMediaKind,
    entityId: string,
    mediaUrl: string,
  ): Promise<EntityMediaResponse> {
    const response = await updateEntityMedia(
      this.apiBaseUrl,
      provider,
      wallet,
      entityKind,
      entityId,
      mediaUrl,
    );
    this.write(cacheKey("entity-media", entityKind, entityId), response);
    return response;
  }

  burningChicken(owner: string, tokenId: string, config: BurningChickenConfig): Promise<unknown> {
    const key = cacheKey("burning-chicken", owner, tokenId, config.nftContractAddress);
    return this.refresh(key, () => fetchBurningChickenForOwner(owner, tokenId, config));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createBackendDataStore(apiBaseUrl: string): BackendDataStore {
  return new BackendDataStore(apiBaseUrl.replace(/\/+$/, ""));
}

const sharedBackendDataStores = new Map<string, BackendDataStore>();

export function backendDataStoreFor(apiBaseUrl: string): BackendDataStore {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  const existing = sharedBackendDataStores.get(normalizedApiBaseUrl);
  if (existing) return existing;
  const store = createBackendDataStore(normalizedApiBaseUrl);
  sharedBackendDataStores.set(normalizedApiBaseUrl, store);
  return store;
}
