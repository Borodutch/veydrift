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
  playerActivityPresenceUrl,
  recordPlayerActivityPresence,
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
  type PlayerActivityPresence,
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
import {
  GameStateStore,
  type GameStateEntry,
  type GameStatePriority,
} from "./gameStateStore";

type WalletReadOptions = {
  source?: "indexed";
  timeoutMs?: number;
  fresh?: boolean;
  signal?: AbortSignal;
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

function cacheKey(kind: string, ...parts: unknown[]): string {
  return `${kind}:${JSON.stringify(parts)}`;
}

/**
 * The single read-side boundary for the playable frontend.
 *
 * It owns normalized response data, generations, freshness, failures, and the
 * three-slot priority scheduler. Calling the same read again while it is
 * running returns the existing promise. Screens may keep render projections,
 * but this store is the authoritative runtime snapshot and rejects stale
 * generations before they can replace newer shared state.
 */
export class BackendDataStore {
  private readonly state = new GameStateStore();
  private contextScope = "public";

  constructor(readonly apiBaseUrl: string) {}

  refresh<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      dedupe?: boolean;
      deadlineMs?: number | undefined;
      planetId?: string | undefined;
      priority?: GameStatePriority | undefined;
      scope?: string | undefined;
      wallet?: string | undefined;
    } = {},
  ): Promise<T> {
    return this.state.read(key, load, {
      ...options,
      scope: options.scope ?? this.contextScope,
    });
  }

  setContext(wallet?: string, planetId?: string): void {
    const nextScope = cacheKey("context", wallet?.toLowerCase(), planetId);
    if (nextScope === this.contextScope) return;
    this.state.cancelScope(this.contextScope);
    this.contextScope = nextScope;
  }

  cancelScope(scope: string): void {
    this.state.cancelScope(scope);
  }

  subscribe(listener: () => void): () => void {
    return this.state.subscribe(listener);
  }

  key(kind: string, ...parts: unknown[]): string {
    return cacheKey(kind, ...parts);
  }

  snapshot<T>(key: string): GameStateEntry<T> | undefined {
    return this.state.snapshot<T>(key);
  }

  value<T>(kind: string, ...parts: unknown[]): T | undefined {
    return this.state.value<T>(cacheKey(kind, ...parts));
  }

  publish<T>(kind: string, data: T, parts: unknown[] = [], options: { planetId?: string; wallet?: string } = {}): void {
    this.state.publish(cacheKey(kind, ...parts), data, options);
  }

  coordinateRefresh<T>(
    key: string,
    priority: GameStatePriority,
    load: (signal: AbortSignal) => Promise<T>,
    deadlineMs = 10_000,
  ): Promise<T> {
    return this.refresh(cacheKey("coordinated-refresh", key), load, {
      deadlineMs,
      priority,
      scope: this.contextScope,
    });
  }

  settlement(wallet: string, options: WalletReadOptions = {}): Promise<WalletSettlementResponse> {
    const key = cacheKey("settlement", wallet);
    return this.refresh(key, (signal) => fetchWalletSettlement(this.apiBaseUrl, wallet, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      priority: "selected-planet",
      wallet,
    });
  }

  overview(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<WalletOverviewSnapshotResponse> {
    const key = cacheKey("overview", wallet, planetId);
    // `fresh` means bypass the short-lived value cache, not send duplicate identical requests when
    // the Overview, top bar, and selected-planet surface refresh in the same render turn.
    return this.refresh(key, (signal) => fetchWalletOverviewSnapshot(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  planets(wallet: string, options: WalletReadOptions = {}): Promise<WalletPlanetsResponse> {
    const key = cacheKey("planets", wallet);
    return this.refresh(key, (signal) => fetchWalletPlanets(this.apiBaseUrl, wallet, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      priority: "selected-planet",
      wallet,
    });
  }

  watchedPlanets(wallet: string, options: { page?: number; pageSize?: number; timeoutMs?: number } = {}): Promise<WatchedPlanetsResponse> {
    const key = cacheKey("watched-planets", wallet, { page: options.page, pageSize: options.pageSize });
    return this.refresh(key, () => fetchWatchedPlanets(this.apiBaseUrl, wallet, options), {
      deadlineMs: options.timeoutMs ?? 25_000,
      priority: "background",
      wallet,
    });
  }

  queues(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<PlayerQueuesResponse> {
    const key = cacheKey("queues", wallet, planetId);
    return this.refresh(key, (signal) => fetchWalletQueues(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  infrastructure(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainInfrastructureState> {
    const key = cacheKey("infrastructure", wallet, planetId);
    return this.refresh(key, (signal) => fetchInfrastructureState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  moon(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainMoonState> {
    const key = cacheKey("moon", wallet, planetId);
    return this.refresh(key, (signal) => fetchMoonState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  shipyard(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainShipyardState> {
    const key = cacheKey("shipyard", wallet, planetId);
    return this.refresh(key, (signal) => fetchShipyardState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  defenses(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
    const key = cacheKey("defenses", wallet, planetId);
    return this.refresh(key, (signal) => fetchDefenseState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  research(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
    const key = cacheKey("research", wallet, planetId);
    return this.refresh(key, (signal) => fetchResearchState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
  }

  rift(wallet: string, planetId?: string): Promise<ChainRiftState> {
    const key = cacheKey("rift", wallet, planetId);
    return this.refresh(key, () => fetchRiftState(this.apiBaseUrl, wallet, planetId));
  }

  alliance(wallet: string, options: WalletReadOptions = {}): Promise<ChainAllianceState> {
    const key = cacheKey("alliance", wallet);
    return this.refresh(key, (signal) => fetchAllianceState(this.apiBaseUrl, wallet, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      priority: "background",
      wallet,
    });
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

  recordPlayerActivityPresence(wallet: string): Promise<PlayerActivityPresence> {
    return recordPlayerActivityPresence(this.apiBaseUrl, wallet);
  }

  recordPlayerActivityPresenceOnExit(wallet: string): void {
    const url = playerActivityPresenceUrl(this.apiBaseUrl, wallet);
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, "")) return;
    void fetch(url, { keepalive: true, method: "POST" }).catch(() => {});
  }

  highscores(options: (FetchHighscoreOptions & { requestScope?: string }) | number = 100): Promise<HighscoreResponse> {
    const { requestScope, ...fetchOptions } = typeof options === "number" ? { requestScope: undefined } : options;
    const normalizedOptions = typeof options === "number" ? options : fetchOptions;
    const key = cacheKey("highscores", normalizedOptions);
    return this.refresh(key, (signal) => fetchHighscores(
      this.apiBaseUrl,
      typeof normalizedOptions === "number" ? normalizedOptions : { ...normalizedOptions, signal },
    ), { priority: "background", scope: requestScope ?? this.contextScope });
  }

  playerHighscore(wallet: string): Promise<HighscoreEntry | null> {
    const key = cacheKey("player-highscore", wallet);
    return this.refresh(key, () => fetchPlayerHighscore(this.apiBaseUrl, wallet));
  }

  raidFinderDebris(options: { limit?: number; requestScope?: string } = {}): Promise<RaidFinderDebrisResponse> {
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("raid-finder-debris", fetchOptions);
    return this.refresh(key, (signal) => fetchRaidFinderDebrisTargets(this.apiBaseUrl, { ...fetchOptions, signal }), {
      priority: "background",
      scope: requestScope ?? this.contextScope,
    });
  }

  raidFinderRifters(options: { limit?: number; requestScope?: string } = {}): Promise<RaidFinderRiftersResponse> {
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("raid-finder-rifters", fetchOptions);
    return this.refresh(key, (signal) => fetchRaidFinderRifters(this.apiBaseUrl, { ...fetchOptions, signal }), {
      priority: "background",
      scope: requestScope ?? this.contextScope,
    });
  }

  system<T = unknown>(galaxy: number, system: number, options: { detail?: "full"; requestScope?: string } = {}): Promise<T> {
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("system", galaxy, system, fetchOptions);
    return this.refresh(key, (signal) => fetchSystemData(this.apiBaseUrl, galaxy, system, { ...fetchOptions, signal }) as Promise<T>, {
      priority: "background",
      scope: requestScope ?? this.contextScope,
    });
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

  attackProtection(wallet: string, targetPlanetId: string, targetIsMoon = false): Promise<AttackProtectionStatus> {
    const key = cacheKey("attack-protection", wallet, targetPlanetId, targetIsMoon);
    return this.refresh(key, () => fetchAttackProtectionStatus(this.apiBaseUrl, wallet, targetPlanetId, targetIsMoon));
  }

  fleetVisibility(wallet: string, options: FleetMissionVisibilityOptions = {}): Promise<FleetMissionVisibilityResponse> {
    const key = cacheKey("fleet-visibility", wallet, options.includeArchive);
    return this.refresh(key, (signal) => fetchFleetMissionVisibility(this.apiBaseUrl, wallet, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      priority: "mission-control",
      wallet,
    });
  }

  fleetArchive(wallet: string, options: FleetMissionArchiveOptions = {}): Promise<FleetMissionArchiveResponse> {
    const key = cacheKey("fleet-archive", wallet, options);
    return this.refresh(key, () => fetchFleetMissionArchive(this.apiBaseUrl, wallet, options), { dedupe: false });
  }

  missileArchive(wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}): Promise<MissileAttackArchiveResponse> {
    const key = cacheKey("missile-archive", wallet, options);
    return this.refresh(key, () => fetchMissileAttackArchive(this.apiBaseUrl, wallet, options), { dedupe: false });
  }

  globalActiveMissions(): Promise<GlobalActiveMissionsResponse> {
    const key = cacheKey("global-active-missions");
    return this.refresh(key, () => fetchGlobalActiveMissions(this.apiBaseUrl), { dedupe: false });
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
    return this.refresh(key, () => fetchGlobalMissionArchive(this.apiBaseUrl, options), { dedupe: false });
  }

  mission(missionId: string): Promise<MissionDetailResponse> {
    const key = cacheKey("mission", missionId);
    return this.refresh(key, () => fetchMission(this.apiBaseUrl, missionId), { dedupe: false });
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
    return updateEntityMedia(
      this.apiBaseUrl,
      provider,
      wallet,
      entityKind,
      entityId,
      mediaUrl,
    );
  }

  burningChicken(owner: string, tokenId: string, config: BurningChickenConfig): Promise<unknown> {
    const key = cacheKey("burning-chicken", owner, tokenId, config.nftContractAddress);
    return this.refresh(key, () => fetchBurningChickenForOwner(owner, tokenId, config));
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
