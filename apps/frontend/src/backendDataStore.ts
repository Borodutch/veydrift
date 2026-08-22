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
import {
  backendResourceSnapshot,
  promoteCanonicalPlanetResources,
  type BackendResourceState,
  type CanonicalPlanetResourceSnapshot,
  type CanonicalPlanetResourceStore,
} from "./planetResourceStore";
import {
  waitForStartedDefenseProductionState,
  type StartedDefenseProductionExpectation,
  type StartedDefenseProductionSnapshot,
} from "./postTransactionRefresh";
import {
  createTransactionActionGate,
  runWriteTransaction as executeWriteTransaction,
  type WriteTransactionDescriptor,
  type WriteTransactionState,
} from "./transactionActionGate";

type WalletReadOptions = {
  source?: "indexed";
  timeoutMs?: number;
  fresh?: boolean;
  signal?: AbortSignal;
  priority?: GameStatePriority;
};

export type BackendDataTag = `kind:${string}` | `wallet:${string}` | `planet:${string}` | `resource:${string}`;

export type BackendDataRefreshOptions = {
  /** Only subscribed resources are refreshed by default. */
  activeOnly?: boolean;
  priority?: GameStatePriority;
};

export type BackendWriteTransactionDescriptor<IndexedSnapshot = void> =
  WriteTransactionDescriptor<IndexedSnapshot> & {
    /**
     * Canonical resources affected by a confirmed mutation.  The wallet UI
     * owns signing, but indexed convergence always returns through this data
     * store rather than page-specific refresh trees.
     */
    invalidateTags?: readonly BackendDataTag[];
  };

type RegisteredResource = {
  key: string;
  load: (signal: AbortSignal) => Promise<unknown>;
  options: {
    deadlineMs?: number | undefined;
    planetId?: string | undefined;
    priority?: GameStatePriority | undefined;
    scope?: string | undefined;
    wallet?: string | undefined;
  };
  tags: ReadonlySet<BackendDataTag>;
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
  requestScope?: string;
};

type GlobalMissionArchiveOptions = {
  missionNumber?: string;
  missionType?: string;
  page?: number;
  pageSize?: number;
  planetId?: string;
  requestScope?: string;
  summaryOnly?: boolean;
};

function cacheKey(kind: string, ...parts: unknown[]): string {
  return `${kind}:${JSON.stringify(parts)}`;
}

function resourceTagsForKey(
  key: string,
  wallet?: string | undefined,
  planetId?: string | undefined,
): ReadonlySet<BackendDataTag> {
  const separator = key.indexOf(":");
  const kind = separator >= 0 ? key.slice(0, separator) : key;
  const tags = new Set<BackendDataTag>([`kind:${kind}`]);
  if (wallet) tags.add(`wallet:${wallet.toLowerCase()}`);
  if (planetId) tags.add(`planet:${planetId}`);
  return tags;
}

/**
 * The single state and refresh boundary for the playable frontend.
 *
 * It owns normalized response data, generations, freshness, failures, and the
 * three-slot priority scheduler. Calling the same read again while it is
 * running returns the existing promise. Screens may keep render projections,
 * but this store is the authoritative runtime snapshot and rejects stale
 * generations before they can replace newer shared state.
 */
export class BackendDataStore {
  private readonly state = new GameStateStore();
  private readonly transactionGate = createTransactionActionGate();
  /**
   * The one registry of backend reads. A view never owns a second cache: it
   * subscribes to a key and asks this registry to refetch it. The registry is
   * also what lets chain events and writes invalidate data by identity instead
   * of calling page-specific callback trees.
   */
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
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
    const readOptions = {
      ...options,
      scope: options.scope ?? this.contextScope,
    };
    this.registerResource(key, load, readOptions);
    return this.state.read(key, load, readOptions);
  }

  /**
   * Return a recent canonical value without causing a duplicate transport.
   * Explicit Refresh buttons still use `refetch`, so freshness is never hidden
   * behind an unbounded cache.
   */
  ensure<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      maxAgeMs?: number;
      deadlineMs?: number | undefined;
      planetId?: string | undefined;
      priority?: GameStatePriority | undefined;
      scope?: string | undefined;
      wallet?: string | undefined;
    } = {},
  ): Promise<T> {
    const snapshot = this.state.snapshot<T>(key);
    const maxAgeMs = options.maxAgeMs ?? 5_000;
    if (
      snapshot?.data !== undefined
      && snapshot.freshness === "fresh"
      && snapshot.lastSuccessfulUpdate !== undefined
      && Date.now() - snapshot.lastSuccessfulUpdate < maxAgeMs
    ) {
      return Promise.resolve(snapshot.data);
    }
    return this.refresh(key, load, options);
  }

  refetch(key: string, options: BackendDataRefreshOptions = {}): Promise<unknown> | undefined {
    const resource = this.resources.get(key);
    if (!resource) return undefined;
    return this.state.read(key, resource.load, {
      ...resource.options,
      dedupe: true,
      priority: options.priority ?? resource.options.priority,
    });
  }

  /** Invalidate canonical resources by identity, then refresh active views. */
  invalidate(tags: readonly BackendDataTag[], options: BackendDataRefreshOptions = {}): Promise<PromiseSettledResult<unknown>[]> {
    const wanted = new Set(tags);
    const reads: Promise<unknown>[] = [];
    for (const resource of this.resources.values()) {
      if (![...resource.tags].some((tag) => wanted.has(tag))) continue;
      if (options.activeOnly !== false && this.state.subscriberCount(resource.key) === 0) continue;
      const refresh = this.refetch(resource.key, options);
      if (refresh) reads.push(refresh);
    }
    return Promise.allSettled(reads);
  }

  /**
   * Store-owned polling. Screens can register visibility/route intent, but do
   * not create timers or duplicate refresh loops themselves.
   */
  startPolling(name: string, tags: readonly BackendDataTag[], intervalMs: number, priority: GameStatePriority): () => void {
    this.stopPolling(name);
    const poll = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.invalidate(tags, { activeOnly: true, priority });
    };
    this.pollers.set(name, setInterval(poll, intervalMs));
    return () => this.stopPolling(name);
  }

  stopPolling(name: string): void {
    const poller = this.pollers.get(name);
    if (!poller) return;
    clearInterval(poller);
    this.pollers.delete(name);
  }

  stopAllPolling(): void {
    for (const name of this.pollers.keys()) this.stopPolling(name);
  }

  scheduleRefresh(
    name: string,
    tags: readonly BackendDataTag[],
    delayMs: number,
    priority: GameStatePriority,
  ): () => void {
    this.cancelScheduledRefresh(name);
    this.scheduledRefreshes.set(name, setTimeout(() => {
      this.scheduledRefreshes.delete(name);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.invalidate(tags, { activeOnly: true, priority });
    }, delayMs));
    return () => this.cancelScheduledRefresh(name);
  }

  cancelScheduledRefresh(name: string): void {
    const timer = this.scheduledRefreshes.get(name);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.scheduledRefreshes.delete(name);
  }

  /**
   * One chain-event bridge for the whole frontend. It never calls a screen
   * callback; events only invalidate canonical resources and let their normal
   * registered loaders repopulate snapshots.
   */
  connectChainEvents(wallet: string, options: { debounceMs?: number } = {}): () => void {
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      this.publish("chain-sync-health", false, [wallet], { wallet });
      return () => {};
    }

    const events = new window.EventSource(`${this.apiBaseUrl}/chain/events`);
    const debounceMs = options.debounceMs ?? 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pendingTags = new Set<BackendDataTag>();
    const flush = () => {
      timer = undefined;
      if (pendingTags.size === 0) return;
      const tags = [...pendingTags];
      pendingTags.clear();
      void this.invalidate(tags, { activeOnly: true, priority: "transaction" });
    };
    const queue = (tags: readonly BackendDataTag[]) => {
      tags.forEach((tag) => pendingTags.add(tag));
      if (timer !== undefined) return;
      timer = setTimeout(flush, debounceMs);
    };
    const updateHealth = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          connected?: boolean;
          subscribedToHeads?: boolean;
          subscribedToLogs?: boolean;
        };
        this.publish(
          "chain-sync-health",
          Boolean(payload.connected && payload.subscribedToHeads && payload.subscribedToLogs),
          [wallet],
          { wallet },
        );
      } catch {
        this.publish("chain-sync-health", false, [wallet], { wallet });
      }
    };
    const onChainEvent = (event: MessageEvent) => {
      const tags: BackendDataTag[] = [
        `wallet:${wallet.toLowerCase()}`,
        "kind:fleet-visibility",
        "kind:global-active-missions",
        "kind:global-mission-archive",
        "kind:battle-reports",
      ];
      try {
        const payload = JSON.parse(event.data) as {
          resourceChanges?: Array<{ planetId?: unknown }>;
        };
        for (const change of payload.resourceChanges ?? []) {
          if (typeof change?.planetId === "string") tags.push(`planet:${change.planetId}`);
        }
      } catch {
        // An unparseable event still means the indexed state may have changed.
      }
      queue(tags);
    };

    events.addEventListener("chain-event", onChainEvent);
    events.addEventListener("sync-status", updateHealth);
    events.onerror = () => this.publish("chain-sync-health", false, [wallet], { wallet });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      events.close();
    };
  }

  setContext(wallet?: string, planetId?: string): void {
    const nextScope = cacheKey("context", wallet?.toLowerCase(), planetId);
    if (nextScope === this.contextScope) return;
    this.state.cancelScope(this.contextScope);
    // Pollers are store-owned registrations, not request scopes.  Stopping every
    // poller here would silently disable global Mission Control polling whenever
    // a player switches planets; React does not remount that page effect for a
    // same-wallet planet switch.  Context-bound reads are already cancelled
    // above, while pollers continue to invalidate their declared resource tags.
    this.contextScope = nextScope;
  }

  cancelScope(scope: string): void {
    this.state.cancelScope(scope);
  }

  subscribe(listener: () => void): () => void {
    return this.state.subscribe(listener);
  }

  subscribeKey(key: string, listener: () => void): () => void {
    return this.state.subscribeKey(key, listener);
  }

  key(kind: string, ...parts: unknown[]): string {
    return cacheKey(kind, ...parts);
  }

  writeTransactionKey(key?: string): string {
    return cacheKey("write-transaction", key ?? "global");
  }

  private publishWriteTransactionState(state: WriteTransactionState): void {
    this.state.publish(this.writeTransactionKey(), state);
    if (state.key) this.state.publish(this.writeTransactionKey(state.key), state);
  }

  async runWriteTransaction<IndexedSnapshot = void>(
    descriptor: BackendWriteTransactionDescriptor<IndexedSnapshot>,
  ): Promise<boolean> {
    const { invalidateTags, ...transaction } = descriptor;
    const completed = await executeWriteTransaction(this.transactionGate, {
      ...transaction,
      onStateChange: (state) => {
        this.publishWriteTransactionState(state);
        descriptor.onStateChange?.(state);
      },
    });
    if (completed && invalidateTags && invalidateTags.length > 0) {
      await this.invalidate(invalidateTags, { activeOnly: true, priority: "transaction" });
    }
    return completed;
  }

  async runExclusiveTransaction<T>(
    key: string,
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    return this.transactionGate.run(key, async () => {
      this.publishWriteTransactionState({ key, label, phase: "pending", stage: "wallet" });
      try {
        const result = await action();
        this.publishWriteTransactionState({ key, label, phase: "success", stage: "applied" });
        return result;
      } catch (error) {
        this.publishWriteTransactionState({ error, key, label, phase: "error", stage: "failed" });
        throw error;
      }
    });
  }

  snapshot<T>(key: string): GameStateEntry<T> | undefined {
    return this.state.snapshot<T>(key);
  }

  value<T>(kind: string, ...parts: unknown[]): T | undefined {
    return this.state.value<T>(cacheKey(kind, ...parts));
  }

  publish<T>(
    kind: string,
    data: T,
    parts: unknown[] = [],
    options: { planetId?: string | undefined; wallet?: string | undefined } = {},
  ): void {
    this.state.publish(cacheKey(kind, ...parts), data, options);
  }

  fail(kind: string, error: string | undefined, parts: unknown[] = []): void {
    this.state.fail(cacheKey(kind, ...parts), error);
  }

  clear(kind: string, ...parts: unknown[]): void {
    this.state.clear(cacheKey(kind, ...parts));
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

  private registerResource<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      deadlineMs?: number | undefined;
      planetId?: string | undefined;
      priority?: GameStatePriority | undefined;
      scope?: string | undefined;
      wallet?: string | undefined;
    },
  ): void {
    this.resources.set(key, {
      key,
      load: load as (signal: AbortSignal) => Promise<unknown>,
      options,
      tags: resourceTagsForKey(key, options.wallet, options.planetId),
    });
  }

  /** Canonical resource promotion lives beside the backend cache, never in a page. */
  promoteResourceState(
    state: BackendResourceState | null | undefined,
    options: {
      bodyKind?: "moon" | "planet";
      confirmedTransaction?: boolean;
      planetId?: string | null | undefined;
      wallet?: string | null | undefined;
    } = {},
  ): CanonicalPlanetResourceSnapshot | undefined {
    const candidate = backendResourceSnapshot(state, {
      ...(options.bodyKind === undefined ? {} : { bodyKind: options.bodyKind }),
      ...(options.planetId === undefined ? {} : { planetId: options.planetId }),
      ...(options.wallet ? { wallet: options.wallet } : {}),
    });
    const wallet = options.wallet?.toLowerCase() ?? candidate?.wallet?.toLowerCase();
    if (!candidate || !wallet) return candidate;
    const current = this.value<CanonicalPlanetResourceStore>("canonical-planet-resources", wallet) ?? {};
    const next = promoteCanonicalPlanetResources(current, candidate, {
      ...(options.confirmedTransaction === undefined ? {} : { confirmedTransaction: options.confirmedTransaction }),
    });
    if (next !== current) this.publish("canonical-planet-resources", next, [wallet], { wallet });
    return candidate;
  }

  promoteWalletPlanetResources(wallet: string, planets: readonly WalletPlanetsResponse["planets"][number][]): void {
    for (const planet of planets) {
      this.promoteResourceState(planet, { planetId: planet.planetId, wallet });
      if (planet.moon?.exists) {
        this.promoteResourceState(planet.moon, { bodyKind: "moon", planetId: planet.planetId, wallet });
      }
    }
  }

  settlement(wallet: string, options: WalletReadOptions = {}): Promise<WalletSettlementResponse> {
    const key = cacheKey("settlement", wallet);
    return this.refresh(key, (signal) => fetchWalletSettlement(this.apiBaseUrl, wallet, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      priority: "selected-planet",
      wallet,
    }).then((state) => {
      this.promoteResourceState(state.planet, { planetId: state.homePlanetId, wallet });
      return state;
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
    }).then((state) => {
      this.promoteWalletPlanetResources(wallet, state.planets);
      return state;
    });
  }

  watchedPlanets(wallet: string, options: { page?: number; pageSize?: number; timeoutMs?: number } = {}): Promise<WatchedPlanetsResponse> {
    const key = cacheKey("watched-planets", wallet, { page: options.page, pageSize: options.pageSize });
    return this.refresh(key, (signal) => fetchWatchedPlanets(this.apiBaseUrl, wallet, { ...options, signal }), {
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
      priority: options.priority ?? "selected-planet",
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
    }).then((state) => {
      this.promoteResourceState(state, { planetId, wallet });
      return state;
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
    }).then((state) => {
      this.promoteResourceState(state, { bodyKind: "moon", planetId, wallet });
      return state;
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
    }).then((state) => {
      this.promoteResourceState(state, { planetId, wallet });
      return state;
    });
  }

  defenses(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
    const key = cacheKey("defenses", wallet, planetId);
    return this.refresh(key, (signal) => fetchDefenseState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: options.priority ?? "selected-planet",
      wallet,
    }).then((state) => {
      this.promoteResourceState(state, { planetId, wallet });
      return state;
    });
  }

  /**
   * The authoritative post-write refresh for defense production. It polls and
   * publishes the same defense and queue entries consumed by every screen, so
   * transaction feedback cannot drift from a separately managed component
   * snapshot.
   */
  waitForStartedDefenseProduction(
    wallet: string,
    expectation: StartedDefenseProductionExpectation,
  ): Promise<StartedDefenseProductionSnapshot> {
    return waitForStartedDefenseProductionState(
      async () => {
        const [defense, queues] = await Promise.all([
          this.defenses(wallet, expectation.planetId, { fresh: true, priority: "transaction" }),
          this.queues(wallet, expectation.planetId, { fresh: true, priority: "transaction" }),
        ]);
        return { defense, queues };
      },
      expectation,
    );
  }

  research(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
    const key = cacheKey("research", wallet, planetId);
    return this.refresh(key, (signal) => fetchResearchState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    }).then((state) => {
      this.promoteResourceState(state, { planetId, wallet });
      return state;
    });
  }

  rift(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainRiftState> {
    const key = cacheKey("rift", wallet, planetId);
    return this.refresh(key, (signal) => fetchRiftState(this.apiBaseUrl, wallet, planetId, { ...options, signal }), {
      deadlineMs: options.timeoutMs,
      planetId,
      priority: "selected-planet",
      wallet,
    });
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
    return this.refresh(key, (signal) => fetchPlayerProfile(this.apiBaseUrl, wallet, { signal }));
  }

  settlementFunding(wallet: string): Promise<SettlementFundingState> {
    const key = cacheKey("settlement-funding", wallet);
    return this.refresh(key, (signal) => fetchSettlementFundingState(this.apiBaseUrl, wallet, signal));
  }

  referralDashboard(wallet: string): Promise<ReferralDashboard> {
    const key = cacheKey("referral-dashboard", wallet);
    return this.refresh(key, (signal) => fetchReferralDashboard(this.apiBaseUrl, wallet, signal));
  }

  referralHistory(wallet: string, page = 1, pageSize = 25): Promise<ReferralHistoryResponse> {
    const key = cacheKey("referral-history", wallet, page, pageSize);
    return this.refresh(key, (signal) => fetchReferralHistory(this.apiBaseUrl, wallet, page, pageSize, signal));
  }

  playerActivity(
    wallet: string,
    options: { includeProjected?: boolean; page?: number; pageSize?: number; since?: number } = {},
  ): Promise<PlayerActivityResponse> {
    const key = cacheKey("player-activity", wallet, options);
    return this.refresh(key, (signal) => fetchPlayerActivity(this.apiBaseUrl, wallet, { ...options, signal }));
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
    return this.refresh(key, (signal) => fetchPlayerHighscore(this.apiBaseUrl, wallet, signal));
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
    return this.refresh(key, async (signal) => {
      const response = await fetch(`${this.apiBaseUrl}/randomness-readiness`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
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
    return this.refresh(key, async (signal) => {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
      return response.json() as Promise<T>;
    });
  }

  attackProtection(
    wallet: string,
    targetPlanetId: string,
    targetIsMoon = false,
    options: { requestScope?: string } = {},
  ): Promise<AttackProtectionStatus> {
    const key = cacheKey("attack-protection", wallet, targetPlanetId, targetIsMoon);
    return this.refresh(
      key,
      (signal) => fetchAttackProtectionStatus(this.apiBaseUrl, wallet, targetPlanetId, targetIsMoon, signal),
      { scope: options.requestScope ?? this.contextScope },
    );
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
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("fleet-archive", wallet, fetchOptions);
    return this.refresh(key, (signal) => fetchFleetMissionArchive(this.apiBaseUrl, wallet, { ...fetchOptions, signal }), {
      dedupe: false,
      priority: "mission-control",
      scope: requestScope ?? this.contextScope,
    });
  }

  missileArchive(
    wallet: string,
    options: { page?: number; pageSize?: number; planetId?: string; requestScope?: string } = {},
  ): Promise<MissileAttackArchiveResponse> {
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("missile-archive", wallet, fetchOptions);
    return this.refresh(key, (signal) => fetchMissileAttackArchive(this.apiBaseUrl, wallet, { ...fetchOptions, signal }), {
      dedupe: false,
      priority: "mission-control",
      scope: requestScope ?? this.contextScope,
    });
  }

  globalActiveMissions(options: { requestScope?: string } = {}): Promise<GlobalActiveMissionsResponse> {
    const key = cacheKey("global-active-missions");
    return this.refresh(key, (signal) => fetchGlobalActiveMissions(this.apiBaseUrl, signal), {
      dedupe: false,
      priority: "mission-control",
      scope: options.requestScope ?? this.contextScope,
    });
  }

  landingActiveMissions<T>(): Promise<T[]> {
    const key = cacheKey("landing-active-missions");
    return this.refresh(key, async (signal) => {
      const response = await fetch(`${this.apiBaseUrl}/missions?status=active&live=1`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error("Failed to load landing missions");
      const data = await response.json() as { missions?: T[] };
      return data.missions ?? [];
    });
  }

  landingHighscores<T>(): Promise<T[]> {
    const key = cacheKey("landing-highscores");
    return this.refresh(key, async (signal) => {
      const params = new URLSearchParams({
        category: "total",
        live: "1",
        page: "1",
        pageSize: "250",
      });
      const response = await fetch(`${this.apiBaseUrl}/highscores?${params.toString()}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error("Failed to load landing highscores");
      const data = await response.json() as { rankings?: { total?: T[] } };
      return data.rankings?.total ?? [];
    });
  }

  globalMissionArchive(options: GlobalMissionArchiveOptions = {}): Promise<GlobalMissionArchiveResponse> {
    const { requestScope, ...fetchOptions } = options;
    const key = cacheKey("global-mission-archive", fetchOptions);
    return this.refresh(key, (signal) => fetchGlobalMissionArchive(this.apiBaseUrl, { ...fetchOptions, signal }), {
      dedupe: false,
      priority: "mission-control",
      scope: requestScope ?? this.contextScope,
    });
  }

  mission(missionId: string, options: { requestScope?: string } = {}): Promise<MissionDetailResponse> {
    const key = cacheKey("mission", missionId);
    return this.refresh(key, (signal) => fetchMission(this.apiBaseUrl, missionId, signal), {
      dedupe: false,
      priority: "mission-control",
      scope: options.requestScope ?? this.contextScope,
    });
  }

  battleReports(options: { requestScope?: string } = {}): Promise<BattleReport[]> {
    const key = cacheKey("battle-reports");
    return this.refresh(key, (signal) => fetchBattleReports(this.apiBaseUrl, signal), {
      priority: "mission-control",
      scope: options.requestScope ?? this.contextScope,
    });
  }

  entityMedia(entityKind: EntityMediaKind, entityId: string): Promise<EntityMediaResponse> {
    const key = cacheKey("entity-media", entityKind, entityId);
    return this.refresh(key, (signal) => fetchEntityMedia(this.apiBaseUrl, entityKind, entityId, signal));
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
    return this.refresh(key, (signal) => fetchBurningChickenForOwner(owner, tokenId, config, signal));
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
