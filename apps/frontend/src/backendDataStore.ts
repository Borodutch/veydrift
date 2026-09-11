import { GameApiError } from "./gameApiError";
import { fetchEntityMedia, normalizeEntityMediaId, updateEntityMedia, type EntityMediaKind, type EntityMediaResponse } from "./entityMedia";
import { GameStateStore, type GameStateEntry } from "./gameStateStore";
import { playerActivityAwaySince } from "./playerActivityPresence";
import { createTransactionActionGate, type TransactionActionGate, type WriteTransactionOutcome, type WriteTransactionState } from "./transactionActionGate";
import type { Eip1193Provider } from "./walletFlow";
import {
  fetchAllianceState,
  fetchAttackProtectionStatus,
  fetchBattleReports,
  fetchBurningChickenForOwner,
  fetchDefenseState,
  fetchFleetMissionArchive,
  fetchFleetMissionVisibility,
  fetchGameApiJson,
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
  fetchReferralDashboard,
  fetchReferralHistory,
  fetchResearchState,
  fetchRiftState,
  fetchSettlementFundingState,
  fetchShipyardState,
  fetchSupplySources,
  fetchSystemData,
  fetchWalletOverviewSnapshot,
  fetchWalletPlanets,
  fetchWalletQueues,
  fetchWalletSettlement,
  fetchWatchedPlanets,
  inspectReferralCode,
  normalizePageOptions,
  paidAllianceInviteCommitment,
  paidAllianceInviteStoreMessage,
  persistReferralClaimIntent,
  playerActivityPresenceUrl,
  readMigrationReservation,
  readWalletNativeBalance,
  recordPlayerActivityPresence,
  recordReferralClaimTransaction,
  recordReferralRedemptionTransaction,
  recoverPaidAllianceInvites,
  redeemPaidAllianceInvite,
  redeemReferralCode,
  requestPersonalSignature,
  resolvePaidAllianceInvite,
  settlementFundingWithWalletBalance,
  storePaidAllianceInvite,
  unwatchPlanet,
  updatePlayerProfile,
  validateReferralCode,
  watchPlanet,
  type AttackProtectionStatus,
  type BattleReportSummary,
  type BurningChickenConfig,
  type ChainAllianceState,
  type ChainDefenseState,
  type ChainInfrastructureState,
  type ChainMoonState,
  type ChainResearchState,
  type ChainRiftState,
  type ChainShipyardState,
  type FetchHighscoreOptions,
  type FleetMissionArchiveResponse,
  type FleetMissionVisibilityResponse,
  type GlobalActiveMissionsResponse,
  type GlobalMissionArchiveResponse,
  type HighscoreEntry,
  type HighscoreResponse,
  type MigrationReservation,
  type MissileAttackArchiveResponse,
  type MissionDetailResponse,
  type PaidAllianceInviteRedemption,
  type PaidAllianceInviteResolution,
  type PlayerActivityPresence,
  type PlayerActivityResponse,
  type PlayerProfile,
  type PlayerQueuesResponse,
  type RaidFinderDebrisResponse,
  type RaidFinderRiftersResponse,
  type ReferralDashboard,
  type ReferralHistoryResponse,
  type ReferralRedemption,
  type ReferralResolution,
  type SettlementFundingState,
  type SignedMetadataOptions,
  type WalletReadOptions,
  type WalletOverviewSnapshotResponse,
  type WalletPlanetsResponse,
  type WalletSettlementResponse,
  type WatchedPlanetsResponse,
  type WatchPlanetMutationResponse,
} from "./walletFlow";

type SystemReadOptions = {
  detail?: "full";
};

export type BackendDataTag = `kind:${string}` | `wallet:${string}` | `planet:${string}` | `resource:${string}`;

export function backendScopeTags(wallet: string | undefined, planetId: string | undefined, ...kinds: `kind:${string}`[]): BackendDataTag[] {
  return [...(wallet ? [`wallet:${wallet.toLowerCase()}` as const] : []), ...(planetId ? [`planet:${planetId}` as const] : []), ...kinds];
}

export type BackendDataRefreshOptions = {
  /** Only subscribed resources are refreshed by default. */
  activeOnly?: boolean;
};


/** A typed, store-owned backend read. UI code can subscribe/refetch it but
 * cannot pair an arbitrary cache key with a different loader. */
export type BackendDataQueryDescriptor<T> = {
  readonly key: string;
  readonly read: () => Promise<T>;
  readonly store: BackendDataStore;
};


export type RandomnessReadiness = {
  ready: boolean;
  reasons?: string[];
};

/**
 * An opaque post-application canonical refresh or required auxiliary backend
 * action. Only BackendDataStore creates plans, so screens cannot install their
 * own pollers, cache writes, or transaction-indexing predicates.
 */
export type BackendIndexingPlan = {
  readonly store: BackendDataStore;
  readonly keys: readonly string[];
  readonly prepare?: () => Promise<PendingTransactionCompletion[]>;
};

export type BackendWriteTransactionDescriptor = {
  key: string;
  label: string;
  prepare?: () => Promise<void>;
  send: () => Promise<string>;
  errorLabel?: (error: unknown) => string;
  onErrorRefresh?: (error: unknown) => Promise<void> | void;
  onStateChange?: (state: WriteTransactionState) => void;
  /** Shared resources consumed by this action, independent of its display label. */
  conflictKeys?: readonly string[];
  planetIds?: readonly string[];
  chainId?: string;
  /**
   * Canonical resources affected by a confirmed mutation. The wallet UI owns
   * signing, but backend-proven application and trailing refreshes always
   * return through this store rather than page-specific refresh trees.
   */
  invalidateTags?: readonly BackendDataTag[];
  indexing?: BackendIndexingPlan | undefined;
};

/** Backend reservations that must be prepared under the same wallet-scoped
 * gate as first-planet settlement, so retries cannot race a second browser
 * tab or a reconnect. */
export type SettlementRedemptions = {
  allianceInvite?: PaidAllianceInviteRedemption | undefined;
  referral?: ReferralRedemption | undefined;
};

function settlementFundingWithMigrationReservation(
  funding: SettlementFundingState,
  chainReservation: MigrationReservation | null,
  migrationAddress?: string,
): SettlementFundingState {
  const migrationReservation = (chainReservation ?? funding.migrationReservation ?? null)?.claimed
    ? null
    : (chainReservation ?? funding.migrationReservation ?? null);
  const activeMigration = Boolean(migrationReservation?.exists && !migrationReservation.claimed && migrationAddress);
  const migrationClaim = activeMigration ? (funding.migrationClaim ?? null) : null;
  const unavailableReason = funding.unavailableReason ?? (activeMigration && !migrationClaim ? "Migration state snapshot is not ready for this wallet yet." : undefined);
  return {
    ...funding,
    ...(activeMigration
      ? {
          migrationClaim,
          migrationContractAddress: migrationAddress!,
        }
      : {}),
    migrationReservation,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

type RegisteredResource = {
  key: string;
  load: (signal: AbortSignal) => Promise<unknown>;
  options: {
    planetId?: string | undefined;
    wallet?: string | undefined;
  };
  tags: ReadonlySet<BackendDataTag>;
};

type PollingLease = {
  intervalMs: number;
  tags: readonly BackendDataTag[];
};

type ManagedPoller = {
  timer: ReturnType<typeof setInterval>;
  leases: Map<symbol, PollingLease>;
};

type ActivityPresencePoller = {
  timer: ReturnType<typeof setInterval>;
  references: number;
  signature: string;
  handleExit: () => void;
  handleVisibility: () => void;
};

type ActivityPresenceClaim =
  | { promise: Promise<PlayerActivityPresence | null>; status: "pending" }
  | { status: "consumed" };

type ChainEventBridge = {
  close: () => void;
  references: number;
  signature: string;
};

type BackendTransactionStatus = {
  events: Array<{ blockNumber: string; eventName: string; logIndex: string }>;
  indexedEventCount: number;
  latestIndexedBlock: string | null;
  latestSyncedBlock?: string | null;
  phase: "submitted" | "confirmed" | "applied" | "reverted";
  receiptBlock: string | null;
  transactionHash: string;
};

export type PendingTransaction = {
  actionId: string;
  chainId: string;
  submittedAt: number;
  transactionHash: string;
  wallet: string;
  label?: string;
  planetIds?: string[];
  queryKeys?: string[];
  conflictKeys?: string[];
  completions?: PendingTransactionCompletion[];
  /** Applied entries retain only in-session auxiliary saves, never spend locks. */
  phase: "submitted" | "confirmed" | "applied";
};

type PendingTransactionCompletion =
  | { kind: "paid-alliance-invite"; secret: string; signature: string }
  | { kind: "referral-claim"; code: string; commitment: string; signature: string };

function sameChainId(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }
}

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

const INACTIVE_RESOURCE_RETENTION_MS = 120_000;

type BackendDataStoreOptions = {
  inactiveResourceRetentionMs?: number;
  now?: () => number;
  transactionPollIntervalMs?: number;
  transactionRequestTimeoutMs?: number;
  transactionStatusReader?: (transactionHash: string) => Promise<BackendTransactionStatus>;
};

function normalizedCachePart(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedCachePart);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap((key) => record[key] === undefined ? [] : [[key, normalizedCachePart(record[key])]]),
  );
}

function cacheKey(kind: string, ...parts: unknown[]): string {
  return `${kind}:${JSON.stringify(parts.map(normalizedCachePart))}`;
}

function walletCacheKey(kind: string, wallet: string, ...parts: unknown[]): string {
  return cacheKey(kind, wallet.toLowerCase(), ...parts);
}

function resourceTagsForKey(key: string, wallet?: string | undefined, planetId?: string | undefined): ReadonlySet<BackendDataTag> {
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
 * It owns normalized response data, generations, freshness, and failures.
 * Independent resources load concurrently. Calling the same read again while it is
 * running returns the existing promise. Screens may keep render projections,
 * but this store is the authoritative runtime snapshot and rejects stale
 * generations before they can replace newer shared state.
 */
export class BackendDataStore {
  private readonly state = new GameStateStore();
  /** Serialize wallet prompts only; submitted hashes are observed independently. */
  private readonly transactionGates = new Map<string, TransactionActionGate>();
  private readonly settlementReservationAttempts = new Map<string, Promise<SettlementRedemptions>>();
  /**
   * The one registry of backend reads. A view never owns a second cache: it
   * subscribes to a key and asks this registry to refetch it. The registry is
   * also what lets chain events and writes invalidate data by identity instead
   * of calling page-specific callback trees.
   */
  private readonly resources = new Map<string, RegisteredResource>();
  /**
   * A chain event can arrive after a request starts but before it returns. In
   * that case the in-flight response may predate the event's indexed state, so
   * one trailing read is required after the current transport settles.
   */
  private readonly trailingInvalidations = new Set<string>();
  private readonly trailingInvalidationSettlements = new Set<string>();
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pollers = new Map<string, ManagedPoller>();
  private readonly activityPresencePollers = new Map<string, ActivityPresencePoller>();
  /** A dialog may remount during route/network churn. Its away window is a
   * one-time session claim, while ordinary heartbeats remain silent. */
  private readonly activityPresenceClaims = new Map<string, ActivityPresenceClaim>();
  private readonly chainEventBridges = new Map<string, ChainEventBridge>();
  private readonly transactionRecoveries = new Map<string, Promise<WriteTransactionOutcome>>();
  private readonly sessionTransactions = new Map<string, PendingTransaction>();
  private readonly transactionWakeups = new Set<() => void>();
  private readonly transactionAbort = new AbortController();
  private readonly scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
  /** Refresh intent that became due while hidden. It is coalesced and resumed
   * once, centrally, when the tab is visible again. */
  private readonly deferredHiddenRefreshes = new Set<BackendDataTag>();
  private readonly recoveryKeys = new Set<string>();
  private readonly recoveringKeys = new Set<string>();
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  private contextWallet: string | undefined;
  private contextChainId: string | undefined;
  private hasContext = false;

  private readonly inactiveResourceRetentionMs: number;
  private readonly now: () => number;
  private readonly transactionPollIntervalMs: number;
  private readonly transactionRequestTimeoutMs: number;
  private readonly transactionStatusReader: ((transactionHash: string) => Promise<BackendTransactionStatus>) | undefined;

  constructor(readonly apiBaseUrl: string, options: BackendDataStoreOptions = {}) {
    this.inactiveResourceRetentionMs = options.inactiveResourceRetentionMs ?? INACTIVE_RESOURCE_RETENTION_MS;
    this.now = options.now ?? Date.now;
    this.transactionPollIntervalMs = options.transactionPollIntervalMs ?? 1_000;
    this.transactionRequestTimeoutMs = options.transactionRequestTimeoutMs ?? 10_000;
    this.transactionStatusReader = options.transactionStatusReader;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      // Retire the old persisted UI locks. Backend reads hydrate a new session.
      try { window.localStorage?.removeItem(`veydrift:pending-transactions:${this.apiBaseUrl}`); } catch { /* Storage is optional. */ }
      window.addEventListener?.("online", this.handleResume);
      window.addEventListener?.("pageshow", this.handleResume);
    }
  }

  /**
   * The UI query catalogue. Each descriptor fixes one normalized identity to
   * exactly one store-owned reader; components only declare whether it should
   * be active and render the shared snapshot.
   */
  readonly queries = {
    allianceDetail: (id: string) => this.query(this.key("alliance-detail", id), () => {
      const key = this.key("alliance-detail", id);
      return this.refresh(key, async signal => (await fetchGameApiJson<{ alliance: ChainAllianceState["directory"][number] }>(`${this.apiBaseUrl}/alliance/${encodeURIComponent(id)}`, "Alliance", { signal })).alliance);
    }),
    alliance: (wallet: string, options: WalletReadOptions = {}): BackendDataQueryDescriptor<ChainAllianceState> => {
      const key = walletCacheKey("alliance", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchAllianceState(this.apiBaseUrl, wallet, { ...options, signal }), {
        wallet,
      }));
    },
    attackProtection: (wallet: string, targetPlanetId: string, targetIsMoon = false, options: WalletReadOptions = {}): BackendDataQueryDescriptor<AttackProtectionStatus> => {
      const key = walletCacheKey("attack-protection", wallet, targetPlanetId, targetIsMoon);
      return this.query(key, () => this.refresh(key, (signal) => fetchAttackProtectionStatus(this.apiBaseUrl, wallet, targetPlanetId, targetIsMoon, signal), {
        planetId: targetPlanetId,
        wallet,
      }));
    },
    battleReports: (): BackendDataQueryDescriptor<BattleReportSummary[]> => {
      const key = cacheKey("battle-reports");
      return this.query(key, () => this.refresh(key, (signal) => fetchBattleReports(this.apiBaseUrl, signal), {
      }));
    },
    burningChicken: (owner: string, tokenId: string, config: BurningChickenConfig): BackendDataQueryDescriptor<unknown> => {
      const key = walletCacheKey("burning-chicken", owner, tokenId, config.nftContractAddress.toLowerCase());
      return this.query(key, () => this.refresh(key, (signal) => fetchBurningChickenForOwner(owner, tokenId, config, signal)));
    },
    defenses: this.planetQuery("defenses", fetchDefenseState),
    entityMedia: (entityKind: EntityMediaKind, entityId: string): BackendDataQueryDescriptor<EntityMediaResponse> => {
      entityId = normalizeEntityMediaId(entityKind, entityId);
      const key = cacheKey("entity-media", entityKind, entityId);
      return this.query(key, () => this.refresh(key, (signal) => fetchEntityMedia(this.apiBaseUrl, entityKind, entityId, signal), {}));
    },
    fleetArchive: (wallet: string, options: FleetMissionArchiveOptions = {}): BackendDataQueryDescriptor<FleetMissionArchiveResponse> => {
      options = normalizePageOptions(options);
      const key = walletCacheKey("fleet-archive", wallet, options);
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchFleetMissionArchive(this.apiBaseUrl, wallet, {
            ...options,
            signal,
          }),
        {
          planetId: options.planetId,
          wallet,
        },
      ));
    },
    fleetVisibility: (wallet: string, options: FleetMissionVisibilityOptions = {}): BackendDataQueryDescriptor<FleetMissionVisibilityResponse> => {
      const includeArchive = options.includeArchive === true;
      const key = walletCacheKey("fleet-visibility", wallet, includeArchive);
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchFleetMissionVisibility(this.apiBaseUrl, wallet, {
            ...options,
            includeArchive,
            signal,
          }),
        {
          wallet,
        },
      ));
    },
    globalActiveMissions: (): BackendDataQueryDescriptor<GlobalActiveMissionsResponse> => {
      const key = cacheKey("global-active-missions");
      return this.query(key, () => this.refresh(key, (signal) => fetchGlobalActiveMissions(this.apiBaseUrl, signal), {
      }));
    },
    globalActiveMissionCount: () => this.query(this.key("global-active-mission-count"), () => this.refresh(
      this.key("global-active-mission-count"), signal => fetchGameApiJson<{ totalEntries: number }>(`${this.apiBaseUrl}/missions?status=active&summaryOnly=true`, "Mission count", { signal })
    )),
    globalMissionArchive: (options: GlobalMissionArchiveOptions = {}): BackendDataQueryDescriptor<GlobalMissionArchiveResponse> => {
      options = normalizePageOptions({ ...options, summaryOnly: options.summaryOnly === true });
      const key = cacheKey("global-mission-archive", options);
      return this.query(key, () => this.refresh(key, (signal) => fetchGlobalMissionArchive(this.apiBaseUrl, { ...options, signal }), {
      }));
    },
    highscores: (options: FetchHighscoreOptions | number = {}): BackendDataQueryDescriptor<HighscoreResponse> => {
      const { signal: _signal, ...input } = typeof options === "number" ? { limit: options } as FetchHighscoreOptions : options;
      const normalizedOptions = { ...input, ...(input.currentWallet ? { currentWallet: input.currentWallet.toLowerCase() } : {}), includeAttackProtection: input.includeAttackProtection ?? Boolean(input.currentWallet), limit: input.limit ?? input.pageSize ?? 100 };
      const key = cacheKey("highscores", normalizedOptions);
      return this.query(key, () => this.refresh(key, (signal) => fetchHighscores(this.apiBaseUrl, { ...normalizedOptions, signal }), {
        ...(normalizedOptions.currentWallet ? { wallet: normalizedOptions.currentWallet } : {}),
      }));
    },
    infrastructure: this.planetQuery("infrastructure", fetchInfrastructureState),
    landingActiveMissions: <T>(): BackendDataQueryDescriptor<T[]> => {
      const key = cacheKey("landing-active-missions");
      return this.query(key, () => this.refresh(
        key,
        async (signal) => {
          const data = await fetchGameApiJson<{ missions?: T[] }>(`${this.apiBaseUrl}/missions?status=active&live=1`, "Landing missions", {
            cache: "no-store",
            signal,
            httpErrorMessage: async () => "Failed to load landing missions",
          });
          return data.missions ?? [];
        },
        { },
      ));
    },
    landingHighscores: <T>(): BackendDataQueryDescriptor<T[]> => {
      const key = cacheKey("landing-highscores");
      return this.query(key, () => this.refresh(
        key,
        async (signal) => {
          const params = new URLSearchParams({
            category: "total",
            view: "scoreboard",
            live: "1",
            page: "1",
            pageSize: "250",
          });
          const data = await fetchGameApiJson<{ rankings?: { total?: T[] } }>(`${this.apiBaseUrl}/highscores?${params.toString()}`, "Landing highscores", {
            cache: "no-store",
            signal,
            httpErrorMessage: async () => "Failed to load landing highscores",
          });
          return data.rankings?.total ?? [];
        },
        { },
      ));
    },
    moon: this.planetQuery("moon", fetchMoonState),
    missileArchive: (wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}): BackendDataQueryDescriptor<MissileAttackArchiveResponse> => {
      options = normalizePageOptions(options);
      const key = walletCacheKey("missile-archive", wallet, options);
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchMissileAttackArchive(this.apiBaseUrl, wallet, {
            ...options,
            signal,
          }),
        {
          planetId: options.planetId,
          wallet,
        },
      ));
    },
    mission: (missionId: string): BackendDataQueryDescriptor<MissionDetailResponse> => {
      const key = cacheKey("mission", missionId);
      return this.query(key, () => this.refresh(key, (signal) => fetchMission(this.apiBaseUrl, missionId, signal), {
      }));
    },
    overview: (wallet: string, planetId?: string, options: WalletReadOptions = {}): BackendDataQueryDescriptor<WalletOverviewSnapshotResponse> => {
      const key = walletCacheKey("overview", wallet, planetId);
      // `fresh` means bypass the short-lived value cache, not send duplicate identical requests when
      // the Overview, top bar, and selected-planet surface refresh in the same render turn.
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchWalletOverviewSnapshot(this.apiBaseUrl, wallet, planetId, {
            ...options,
            signal,
          }),
        {
          planetId,
          wallet,
        },
      ));
    },
    paidAllianceInviteResolution: (secret: string): BackendDataQueryDescriptor<PaidAllianceInviteResolution> => {
      const key = cacheKey("paid-alliance-invite-resolution", secret);
      return this.query(key, () => this.refresh(key, (signal) => {
        return resolvePaidAllianceInvite(this.apiBaseUrl, secret, signal);
      }));
    },
    playerActivity: (wallet: string, options: {
      includeProjected?: boolean;
      page?: number;
      pageSize?: number;
      since?: number;
    } = {}): BackendDataQueryDescriptor<PlayerActivityResponse> => {
    options = normalizePageOptions({ ...options, includeProjected: options.includeProjected === true, ...(options.since === undefined ? {} : { since: Math.max(0, Math.floor(options.since)) }) });
    const key = walletCacheKey("player-activity", wallet, options);
    return this.query(key, () => this.refresh(key, (signal) => fetchPlayerActivity(this.apiBaseUrl, wallet, { ...options, signal }), { wallet }));
  },
    playerActivityAwayWindow: (wallet: string) => this.query(this.playerActivityAwayWindowKey(wallet), () => this.claimPlayerActivityAwayWindow(wallet)),
    playerHighscore: (wallet: string): BackendDataQueryDescriptor<HighscoreEntry | null> => {
      const key = walletCacheKey("player-highscore", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchPlayerHighscore(this.apiBaseUrl, wallet, signal), { wallet }));
    },
    planets: (wallet: string, options: WalletReadOptions = {}): BackendDataQueryDescriptor<WalletPlanetsResponse> => {
      const key = walletCacheKey("planets", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchWalletPlanets(this.apiBaseUrl, wallet, { ...options, signal }), {
        wallet,
      }));
    },
    profile: (wallet: string): BackendDataQueryDescriptor<PlayerProfile> => {
      const key = walletCacheKey("profile", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchPlayerProfile(this.apiBaseUrl, wallet, { signal }), { wallet }));
    },
    queues: (wallet: string, planetId?: string, options: WalletReadOptions = {}): BackendDataQueryDescriptor<PlayerQueuesResponse> => {
      const key = walletCacheKey("queues", wallet, planetId);
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchWalletQueues(this.apiBaseUrl, wallet, planetId, {
            ...options,
            signal,
          }),
        {
          planetId,
          wallet,
        },
      ));
    },
    randomnessReadiness: (): BackendDataQueryDescriptor<RandomnessReadiness> => {
      const key = cacheKey("randomness-readiness");
      return this.query(key, () => this.refresh(key, async signal => {
        const payload = await fetchGameApiJson<{ ready?: unknown; reasons?: unknown }>(`${this.apiBaseUrl}/randomness-readiness`, "Randomness readiness", {
          signal, cache: "no-store", timeoutMs: 10_000,
          httpErrorMessage: async response => {
            const body = await response.json() as { reasons?: unknown };
            return Array.isArray(body.reasons) && typeof body.reasons[0] === "string"
              ? body.reasons[0] : `Randomness readiness API failed: ${response.status}`;
          },
        });
        return {
          ready: payload.ready === true,
          ...(Array.isArray(payload.reasons) ? { reasons: payload.reasons.filter((reason): reason is string => typeof reason === "string") } : {}),
        };
      }));
    },
    raidFinderDebris: (options: { limit?: number } = {}): BackendDataQueryDescriptor<RaidFinderDebrisResponse> => {
      options = { limit: options.limit ?? 250 };
      const key = cacheKey("raid-finder-debris", options);
      return this.query(key, () => this.refresh(key, (signal) => fetchRaidFinderDebrisTargets(this.apiBaseUrl, { ...options, signal }), {
      }));
    },
    raidFinderRifters: (options: { limit?: number } = {}): BackendDataQueryDescriptor<RaidFinderRiftersResponse> => {
      options = { limit: options.limit ?? 250 };
      const key = cacheKey("raid-finder-rifters", options);
      return this.query(key, () => this.refresh(key, (signal) => fetchRaidFinderRifters(this.apiBaseUrl, { ...options, signal }), {
      }));
    },
    referralCodeInspection: (wallet: string, code: string): BackendDataQueryDescriptor<ReferralResolution> => {
      const key = walletCacheKey("referral-code-inspection", wallet, code);
      return this.query(key, () => this.refresh(
        key,
        (signal) => {
          return inspectReferralCode(this.apiBaseUrl, code, wallet, signal);
        },
        { wallet },
      ));
    },
    referralCodeValidation: (code: string, invitee?: string): BackendDataQueryDescriptor<ReferralResolution> => {
      const key = cacheKey("referral-code-validation", code, invitee?.toLowerCase());
      return this.query(key, () => this.refresh(
        key,
        (signal) => {
          return validateReferralCode(this.apiBaseUrl, code, invitee, signal);
        },
        invitee ? { wallet: invitee } : {},
      ));
    },
    referralDashboard: (wallet: string): BackendDataQueryDescriptor<ReferralDashboard> => {
      const key = walletCacheKey("referral-dashboard", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchReferralDashboard(this.apiBaseUrl, wallet, signal), { wallet }));
    },
    referralHistory: (wallet: string, page = 1, pageSize = 25): BackendDataQueryDescriptor<ReferralHistoryResponse> => {
      const key = walletCacheKey("referral-history", wallet, page, pageSize);
      return this.query(key, () => this.refresh(key, (signal) => fetchReferralHistory(this.apiBaseUrl, wallet, page, pageSize, signal), { wallet }));
    },
    research: this.planetQuery("research", fetchResearchState),
    rift: this.planetQuery("rift", fetchRiftState),
    runtimeConfig: <T>(url: string): BackendDataQueryDescriptor<T> => {
      const key = cacheKey("runtime-config", url);
      return this.query(key, () => this.refresh(key, (signal) => fetchGameApiJson<T>(url, "Runtime config", {
        signal,
        httpErrorMessage: async (response) => `Runtime config failed with ${response.status}`,
      })));
    },
    shipyard: this.planetQuery("shipyard", fetchShipyardState),
    supplySources: this.planetQuery("supply-sources", fetchSupplySources),
    settlement: (wallet: string, options: WalletReadOptions = {}): BackendDataQueryDescriptor<WalletSettlementResponse> => {
      const key = walletCacheKey("settlement", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchWalletSettlement(this.apiBaseUrl, wallet, { ...options, signal }), {
        wallet,
      }).then((state) => {
        // A queued-only resource can be retired after its final subscriber
        // leaves before transport starts. Treat that normal lifecycle outcome
        // as an unavailable indexed settlement, never as a real payload to
        // dereference or permission to launch another settlement.
        if (!state) {
          return {
            hasFirstPlanet: true,
            homePlanetId: null,
            indexer: { indexedState: "reconciling", safeToServeIndexedState: false },
            planet: null,
            wallet,
          } satisfies WalletSettlementResponse;
        }
        return state;
      }));
    },
    settlementFunding: (wallet: string): BackendDataQueryDescriptor<SettlementFundingState> => {
      const key = walletCacheKey("settlement-funding", wallet);
      return this.query(key, () => this.refresh(key, (signal) => fetchSettlementFundingState(this.apiBaseUrl, wallet, signal), { wallet }));
    },
    settlementFundingProjection: (wallet: string, provider: Eip1193Provider, migrationAddress: string | undefined, providerIdentity: string | undefined): BackendDataQueryDescriptor<SettlementFundingState> => {
      const key = walletCacheKey("settlement-funding-projection", wallet, migrationAddress?.toLowerCase(), providerIdentity);
      return this.query(key, () => this.refresh(
        key,
        async () => {
          const [backendFunding, walletBalanceWei, chainMigrationReservation] = await Promise.all([
            this.settlementFunding(wallet),
            readWalletNativeBalance(provider, wallet),
            readMigrationReservation(provider, migrationAddress, wallet),
          ]);
          return settlementFundingWithMigrationReservation(
            settlementFundingWithWalletBalance(backendFunding, walletBalanceWei),
            chainMigrationReservation,
            migrationAddress,
          );
        },
        {
          wallet,
        },
      ));
    },
    system: <T = unknown>(galaxy: number, system: number, options: SystemReadOptions = {}): BackendDataQueryDescriptor<T> => {
      const requestOptions = options;
      const key = cacheKey("system", galaxy, system, requestOptions);
      return this.query(key, () => this.refresh(
        key,
        (signal) =>
          fetchSystemData(this.apiBaseUrl, galaxy, system, {
            ...requestOptions,
            signal,
          }) as Promise<T>,
        {
        },
      ));
    },
    watchedPlanets: (wallet: string, options: { page?: number; pageSize?: number; timeoutMs?: number } = {}): BackendDataQueryDescriptor<WatchedPlanetsResponse> => {
      options = normalizePageOptions(options);
      const key = walletCacheKey("watched-planets", wallet, {
        page: options.page,
        pageSize: options.pageSize,
      });
      return this.query(key, () => this.refresh(key, (signal) => fetchWatchedPlanets(this.apiBaseUrl, wallet, { ...options, signal }), {
        wallet,
      }));
    },
  };
/** Declarative affected keys, tracked with the hash. No nested refresh runners. */
  readonly indexing = {
    refresh: (tags: readonly BackendDataTag[]): BackendIndexingPlan => this.createIndexingPlan(this.keysForScope(tags)),
    resourceChange: (wallet: string, planetId: string, bodyKind: "planet" | "moon" = "planet"): BackendIndexingPlan =>
      this.createIndexingPlan([walletCacheKey(bodyKind === "moon" ? "moon" : "infrastructure", wallet, planetId)]),
    settledPlanet: (wallet: string): BackendIndexingPlan => this.createIndexingPlan([walletCacheKey("settlement", wallet), walletCacheKey("planets", wallet)]),
    referralClaim: (wallet: string, code: string, commitment: string, signature: string | (() => string)): BackendIndexingPlan =>
      this.createIndexingPlan([walletCacheKey("referral-dashboard", wallet), ...this.keysForScope([`wallet:${wallet.toLowerCase()}`, "kind:referral-history"])], async () => {
        const resolvedSignature = typeof signature === "function" ? signature() : signature;
        if (!resolvedSignature) throw new Error("Referral claim authorization is unavailable.");
        return [{ kind: "referral-claim", code, commitment, signature: resolvedSignature }];
      }),
    production: (wallet: string, planetId: string | undefined, kind: "infrastructure" | "shipyard" | "defenses" | "research"): BackendIndexingPlan =>
      this.productionPlan(wallet, planetId, kind),
    all: (plans: readonly BackendIndexingPlan[]): BackendIndexingPlan => {
      plans.forEach(plan => this.assertIndexingPlan(plan));
      return this.createIndexingPlan(plans.flatMap(plan => plan.keys), () => this.prepareIndexingPlans(plans));
    },
    fleetVisibility: (wallet: string, tags: readonly BackendDataTag[] = []): BackendIndexingPlan =>
      this.createIndexingPlan([walletCacheKey("fleet-visibility", wallet, false), ...this.keysForScope(tags)]),
    missionLaunch: (wallet: string, tags: readonly BackendDataTag[] = []): BackendIndexingPlan =>
      this.createIndexingPlan([walletCacheKey("fleet-visibility", wallet, false), this.key("global-active-missions"), ...this.keysForScope(tags)]),
    alliance: (wallet: string): BackendIndexingPlan => this.createIndexingPlan([walletCacheKey("alliance", wallet)]),
    paidAllianceInvite: (wallet: string, provider: Eip1193Provider, secret: string): BackendIndexingPlan =>
      this.createIndexingPlan([walletCacheKey("alliance", wallet)], async () => [{
        kind: "paid-alliance-invite", secret,
        signature: await requestPersonalSignature(provider, wallet, paidAllianceInviteStoreMessage(wallet, paidAllianceInviteCommitment(secret))),
      }]),
    planetRename: (wallet: string): BackendIndexingPlan => this.createIndexingPlan([walletCacheKey("planets", wallet)]),
    planetAbsent: (wallet: string): BackendIndexingPlan => this.createIndexingPlan([walletCacheKey("planets", wallet), walletCacheKey("settlement", wallet)]),
    moonExists: (wallet: string, planetId: string): BackendIndexingPlan => this.createIndexingPlan([walletCacheKey("moon", wallet, planetId), walletCacheKey("planets", wallet)]),
  };

  refresh<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      planetId?: string | undefined;
      wallet?: string | undefined;
    } = {},
  ): Promise<T> {
    this.registerResource(key, load, options);
    return this.readRegisteredResource(this.resources.get(key)!) as Promise<T>;
  }

  private planetQuery<T>(kind: string, load: (apiUrl: string, wallet: string, planetId?: string, options?: WalletReadOptions) => Promise<T>) {
    return (wallet: string, planetId?: string, options: WalletReadOptions = {}) => {
      const key = walletCacheKey(kind, wallet, planetId);
      return this.query(key, () => this.refresh(key,
        signal => load(this.apiBaseUrl, wallet, planetId, { ...options, signal }),
        { wallet, planetId },
      ));
    };
  }

  private query<T>(key: string, read: () => Promise<T>): BackendDataQueryDescriptor<T> {
    return { key, read, store: this };
  }

  refetch(key: string): Promise<unknown> | undefined {
    const resource = this.resources.get(key);
    if (!resource) return undefined;
    return this.readRegisteredResource(resource);
  }

  /** Invalidate canonical resources by identity, then refresh active views. */
  invalidate(tags: readonly BackendDataTag[], options: BackendDataRefreshOptions = {}): Promise<PromiseSettledResult<unknown>[]> {
    const wanted = new Set(tags);
    return this.invalidateKeys([...this.resources.values()].filter(resource => [...resource.tags].some(tag => wanted.has(tag))).map(resource => resource.key), options);
  }

  private invalidateKeys(keys: readonly string[], options: BackendDataRefreshOptions = {}): Promise<PromiseSettledResult<unknown>[]> {
    return Promise.allSettled([...new Set(keys)].flatMap(key => {
      const resource = this.resources.get(key);
      return resource ? [this.refreshInvalidatedResource(resource, options)] : [];
    }));
  }

  private canRefreshResource(resource: RegisteredResource, activeOnly = true): boolean {
    return !this.transactionAbort.signal.aborted
      && this.resources.get(resource.key) === resource
      && (typeof navigator === "undefined" || navigator.onLine !== false)
      && (typeof document === "undefined" || document.visibilityState !== "hidden")
      && (!activeOnly || this.state.subscriberCount(resource.key) > 0);
  }

  /** Shared invalidation path; completion reads additionally wait past the commit barrier. */
  private async refreshInvalidatedResource(resource: RegisteredResource, options: BackendDataRefreshOptions = {}, afterCurrentRead = false): Promise<unknown> {
    this.state.invalidate(resource.key);
    if (!this.canRefreshResource(resource, options.activeOnly !== false)) return;
    if (this.state.hasInFlight(resource.key)) {
      if (!afterCurrentRead) {
        this.trailingInvalidations.add(resource.key);
        return;
      }
      // Reuse any event-triggered trailing read, but never the pre-commit read.
      await this.state.inFlightSettled(resource.key);
      if (!this.canRefreshResource(resource, options.activeOnly !== false)) return;
    }
    const result = await this.readRegisteredResource(resource);
    if (afterCurrentRead && this.resources.get(resource.key) === resource && this.state.snapshot(resource.key)?.freshness !== "fresh") {
      throw new Error("The affected state changed during refresh.");
    }
    return result;
  }

  /** One lifecycle for gameplay. Timed projections change even without logs;
   * all other reads have a slow safety refresh if an event was lost. Only
   * mounted queries participate, and independent keys never wait for a slot. */
  startGameplaySync(wallet: string): () => void {
    // Shell and page may both retain sync. They share one store-owned policy.
    const disconnect = this.connectChainEvents(wallet, { debounceMs: 3_000 });
    const stop = this.startPolling(`gameplay:${wallet.toLowerCase()}`, [], 10_000);
    // The shared poller calls the store policy, not page-supplied refresh trees.
    return () => { stop(); disconnect(); };
  }

  private refreshGameplay(): void {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const timed = new Set(["settlement", "infrastructure", "moon", "queues", "fleet-visibility", "global-active-missions", "global-active-mission-count", "mission"]);
    const keys = [...this.resources.values()].filter(resource => {
      if (!this.state.subscriberCount(resource.key)) return false;
      if (resource.options.wallet && resource.options.wallet.toLowerCase() !== this.contextWallet) return false;
      const kind = resource.key.slice(0, resource.key.indexOf(":"));
      const snapshot = this.state.snapshot(resource.key);
      const age = this.now() - (snapshot?.lastSuccessfulUpdate ?? 0);
      const data = snapshot?.data as { queue?: { active?: boolean }; planets?: Array<{ queues?: Record<string, { active?: boolean } | null> }> } | undefined;
      const producing = data?.queue?.active || data?.planets?.some(planet => Object.values(planet.queues ?? {}).some(queue => queue?.active));
      return !this.state.hasInFlight(resource.key) && age >= (timed.has(kind) || producing ? 10_000 : 120_000);
    }).map(resource => resource.key);
    void this.invalidateKeys(keys);
  }

  /**
   * Store-owned polling. Screens can register visibility/route intent, but do
   * not create timers or duplicate refresh loops themselves.
   */
  startPolling(name: string, tags: readonly BackendDataTag[], intervalMs: number): () => void {
    const owner = Symbol(name);
    const existing = this.pollers.get(name);
    if (existing) {
      existing.leases.set(owner, { intervalMs, tags: [...tags] });
      this.reconfigurePolling(existing);
      return () => this.releasePolling(name, owner);
    }
    const poller: ManagedPoller = {
      // Replaced immediately below by the effective lease configuration.
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      leases: new Map([[owner, { intervalMs, tags: [...tags] }]]),
    };
    this.pollers.set(name, poller);
    this.reconfigurePolling(poller);
    return () => this.releasePolling(name, owner);
  }

  /** Force-stop every owner of a named poller, for terminal teardown only. */
  stopPolling(name: string): void {
    const poller = this.pollers.get(name);
    if (!poller) return;
    clearInterval(poller.timer);
    this.pollers.delete(name);
  }

  stopAllPolling(): void {
    for (const name of this.pollers.keys()) this.stopPolling(name);
    for (const name of this.activityPresencePollers.keys()) this.stopPlayerActivityPresence(name);
    for (const bridge of this.chainEventBridges.values()) bridge.close();
    this.chainEventBridges.clear();
  }

  /** Terminal lifecycle cleanup for an unused API-base store. Components do
   * not call this during ordinary navigation; the shared registry releases
   * stores only when their base URL is no longer retained by the app shell. */
  dispose(): void {
    clearTimeout(this.recoveryTimer);
    this.recoveryKeys.clear();
    this.recoveringKeys.clear();
    this.transactionAbort.abort();
    for (const wake of this.transactionWakeups) wake();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    if (typeof window !== "undefined") {
      window.removeEventListener?.("online", this.handleResume);
      window.removeEventListener?.("pageshow", this.handleResume);
    }
    this.stopAllPolling();
    for (const timer of this.scheduledRefreshes.values()) clearTimeout(timer);
    this.scheduledRefreshes.clear();
    for (const timer of this.evictionTimers.values()) clearTimeout(timer);
    this.evictionTimers.clear();
    this.resources.clear();
    this.trailingInvalidations.clear();
    this.trailingInvalidationSettlements.clear();
    this.deferredHiddenRefreshes.clear();
    this.activityPresenceClaims.clear();
    this.settlementReservationAttempts.clear();
    this.transactionGates.clear();
    this.state.dispose();
  }

  /** Public landing data has one store-owned refresh policy and SSE bridge. */
  startLandingFeedPolling(): () => void {
    return this.startPolling("landing-active-missions", ["kind:landing-active-missions"], 60_000);
  }

  startLandingAlliancePolling(): () => void {
    return this.startPolling("landing-highscores", ["kind:landing-highscores"], 300_000);
  }

  /** Presence is backend data, so its heartbeat belongs here rather than in a dialog. */
  startPlayerActivityPresence(wallet: string): () => void {
    const name = `player-activity-presence:${wallet.toLowerCase()}`;
    const existing = this.activityPresencePollers.get(name);
    if (existing) {
      existing.references += 1;
      return () => this.releasePlayerActivityPresence(name);
    }
    const markPresent = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.recordPlayerActivityPresence(wallet).catch(() => {
        // A later heartbeat retries transient API failures without poisoning a
        // dialog-local loading state.
      });
    };
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      markPresent();
    };
    const handleExit = () => this.recordPlayerActivityPresenceOnExit(wallet);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handleExit);
    this.activityPresencePollers.set(name, {
      timer: setInterval(markPresent, 30_000),
      references: 1,
      signature: "player-activity-presence:30000",
      handleExit,
      handleVisibility,
    });
    return () => this.releasePlayerActivityPresence(name);
  }

  scheduleRefresh(key: string, delayMs: number): () => void {
    this.cancelScheduledRefresh(key);
    this.scheduledRefreshes.set(
      key,
      setTimeout(() => {
        this.scheduledRefreshes.delete(key);
        void this.invalidateKeys([key]);
      }, delayMs),
    );
    return () => this.cancelScheduledRefresh(key);
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
      this.commitBackendSnapshot("chain-sync-health", false, [wallet], {
        wallet,
      });
      return () => {};
    }

    const normalizedWallet = wallet.toLowerCase();
    const signature = JSON.stringify({ debounceMs: options.debounceMs ?? 500 });
    const existing = this.chainEventBridges.get(normalizedWallet);
    if (existing) {
      if (existing.signature !== signature) {
        throw new Error("Chain event bridge options must match for the same wallet.");
      }
      existing.references += 1;
      return () => this.releaseChainEventBridge(normalizedWallet);
    }

    const events = new window.EventSource(`${this.apiBaseUrl}/chain/events`);
    const debounceMs = options.debounceMs ?? 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pendingKeys = new Set<string>();
    const flush = () => {
      timer = undefined;
      if (pendingKeys.size === 0) return;
      const keys = [...pendingKeys];
      pendingKeys.clear();
      void this.invalidateKeys(keys);
    };
    const queue = (keys: readonly string[]) => {
      keys.forEach((key) => pendingKeys.add(key));
      if (timer !== undefined) return;
      timer = setTimeout(flush, debounceMs);
    };
    let wasHealthy = false;
    const activeScopeKeys = (planetIds?: string[]) => [...this.resources.values()].filter(resource =>
      (!resource.options.wallet || resource.options.wallet.toLowerCase() === normalizedWallet)
      && (!planetIds || !resource.options.planetId || planetIds.includes(resource.options.planetId))
    ).map(resource => resource.key);
    const updateHealth = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { ready?: boolean };
        const healthy = payload.ready === true;
        // The first ready message and every recovery close the connect/read
        // race. Ordinary heartbeats do not refresh gameplay or expose revisions.
        if (healthy && !wasHealthy) this.queueRecovery(activeScopeKeys(), true);
        wasHealthy = healthy;
        this.commitBackendSnapshot("chain-sync-health", healthy, [wallet], { wallet });
      } catch { wasHealthy = false; }
    };
    const onChainEvent = (event: MessageEvent) => {
      let planetIds: string[] | undefined;
      try {
        const payload = JSON.parse(event.data) as { wallets?: unknown; planetIds?: unknown };
        if (Array.isArray(payload.wallets) && payload.wallets.every(w => typeof w === "string")) {
          if (!payload.wallets.some(w => w.toLowerCase() === normalizedWallet)) return;
          if (Array.isArray(payload.planetIds) && payload.planetIds.every(id => typeof id === "string")) planetIds = payload.planetIds;
        }
      } catch { /* An unscoped/legacy event requires a conservative catch-up. */ }
      // Only complete planet scopes can exclude off-chain metadata. Unknown
      // events still catch up everything; alliance scores and roster resources
      // remain dependencies even when planet ownership itself did not change.
      const unrelated = new Set(["profile", "entity-media", "runtime-config", "chain-sync-health"]);
      queue(activeScopeKeys(planetIds).filter(key => !planetIds || !unrelated.has(key.slice(0, key.indexOf(":")))));
    };
    events.addEventListener("chain-event", onChainEvent);
    events.addEventListener("sync-status", updateHealth);
    events.onerror = () => {
      wasHealthy = false;
      this.commitBackendSnapshot("chain-sync-health", false, [wallet], { wallet });
    };
    const close = () => {
      if (timer !== undefined) clearTimeout(timer);
      events.close();
    };
    this.chainEventBridges.set(normalizedWallet, {
      close,
      references: 1,
      signature,
    });
    return () => this.releaseChainEventBridge(normalizedWallet);
  }

  setContext(wallet?: string, planetId?: string, chainId?: string): void {
    const nextWallet = wallet?.toLowerCase();
    const changed = !this.hasContext || nextWallet !== this.contextWallet || chainId !== this.contextChainId;
    this.hasContext = true;
    this.contextChainId = chainId;
    if (!changed) return;
    const previousWallet = this.contextWallet;
    this.contextWallet = nextWallet;
    for (const wake of this.transactionWakeups) wake();
    if (nextWallet) this.resumePendingTransactions(nextWallet, chainId);

    // An API-base store survives account switching. Retaining wallet A's
    // canonical entries after moving to wallet B wastes the unbounded dynamic
    // cache and makes accidental old-account projections possible. Clear only
    // wallet-scoped entries; public/global feeds remain shared and an older
    // in-flight wallet response is generation-blocked by `clear`.
    if (!previousWallet || previousWallet === nextWallet) return;
    const walletTag: BackendDataTag = `wallet:${previousWallet}`;
    for (const resource of [...this.resources.values()]) {
      if (!resource.tags.has(walletTag)) continue;
      this.cancelEviction(resource.key);
      this.resources.delete(resource.key);
      this.trailingInvalidations.delete(resource.key);
      this.trailingInvalidationSettlements.delete(resource.key);
      this.state.clear(resource.key);
    }
    // Some store projections publish canonical entries directly (overview
    // fan-out, resource promotion, chain health, write state). They are still
    // account-owned data and must not survive a wallet switch merely because
    // no screen happened to register their source resource first.
    this.state.clearWallet(previousWallet);

    // Provider/account effects release their own references as they rerender,
    // but an immediate close prevents an old wallet's EventSource from
    // continuing to publish into a newly selected session in the meantime.
    const bridge = this.chainEventBridges.get(previousWallet);
    bridge?.close();
    this.chainEventBridges.delete(previousWallet);
    this.activityPresenceClaims.delete(previousWallet);
    for (const key of this.settlementReservationAttempts.keys()) {
      if (key.startsWith(`settlement-reservation:${previousWallet}:`)) {
        this.settlementReservationAttempts.delete(key);
      }
    }
    void planetId;
  }

  subscribe(listener: () => void): () => void {
    return this.state.subscribe(listener);
  }

  subscribeKey(key: string, listener: () => void): () => void {
    this.cancelEviction(key);
    const unsubscribe = this.state.subscribeKey(key, listener);
    return () => {
      unsubscribe();
      this.scheduleEviction(key);
    };
  }

  key(kind: string, ...parts: unknown[]): string {
    return cacheKey(kind, ...parts);
  }

  /** Event-bridge health is a store projection, so it has a typed key even
   * though no HTTP loader owns it. */
  chainSyncHealthKey(wallet: string): string {
    return walletCacheKey("chain-sync-health", wallet);
  }

  writeTransactionKey(key?: string, wallet?: string, planetId?: string): string {
    if (planetId) return cacheKey("write-transaction", wallet?.toLowerCase() ?? "global", key ?? "global", planetId);
    return cacheKey("write-transaction", wallet?.toLowerCase() ?? "global", key ?? "global");
  }

  private publishWriteTransactionState(state: WriteTransactionState, walletScope = "global"): void {
    if (this.hasContext && walletScope !== "global" && this.contextWallet !== walletScope) return;
    // Write status is UI state, but it is still scoped to the initiating
    // wallet.  Without this metadata `clearWallet()` cannot retire a
    // confirmed/failed action from a previous account after an account switch.
    const options = walletScope === "global" ? undefined : { wallet: walletScope };
    this.state.publish(this.writeTransactionKey(undefined, walletScope), state, options);
    if (state.key) this.state.publish(this.writeTransactionKey(state.key, walletScope, state.planetId), state, options);
    if (state.key) {
      const group = `group:${state.key.split(":")[0]}`;
      this.state.publish(this.writeTransactionKey(group, walletScope), state, options);
      if (state.planetId) this.state.publish(this.writeTransactionKey(group, walletScope, state.planetId), state, options);
    }
  }

  private transactionWalletScope(tags: readonly BackendDataTag[] | undefined): string {
    return tags?.find((tag): tag is `wallet:${string}` => tag.startsWith("wallet:"))?.slice("wallet:".length).toLowerCase() ?? "global";
  }

  private transactionGateFor(walletScope: string): TransactionActionGate {
    const existing = this.transactionGates.get(walletScope);
    if (existing) return existing;
    const gate = createTransactionActionGate();
    this.transactionGates.set(walletScope, gate);
    return gate;
  }
  private pendingTransactions(): PendingTransaction[] {
    return [...this.sessionTransactions.values()];
  }

  private writePendingTransaction(entry: PendingTransaction): void {
    this.sessionTransactions.set(entry.transactionHash.toLowerCase(), entry);
  }

  private removePendingTransaction(transactionHash: string): void {
    this.sessionTransactions.delete(transactionHash.toLowerCase());
  }

  private pendingTransactionMatchesChain(entry: PendingTransaction, chainId = this.contextChainId): boolean {
    return !chainId || entry.chainId === "unknown" || sameChainId(entry.chainId, chainId);
  }

  private transactionConflicts(entry: PendingTransaction, keys: readonly string[]): boolean {
    if (entry.phase === "applied") return false;
    // Unscoped actions conservatively conflict with all writes for this wallet.
    const pending = entry.conflictKeys ?? ["wallet"];
    return pending.includes("wallet") || keys.includes("wallet") || pending.some((key) => keys.includes(key));
  }

  isTransactionPending(wallet: string | undefined, conflictKeys: readonly string[] = ["wallet"]): boolean {
    const scope = wallet?.toLowerCase() ?? "global";
    return this.transactionGates.get(scope)?.isRunning() === true || this.pendingTransactions().some((entry) =>
      entry.wallet === scope && this.pendingTransactionMatchesChain(entry) && this.transactionConflicts(entry, conflictKeys)
    );
  }

  pendingTransactionState(wallet: string | undefined, planetId?: string): WriteTransactionState | undefined {
    const entry = this.pendingTransactions().find((candidate) => candidate.wallet === wallet?.toLowerCase()
      && candidate.phase !== "applied"
      && this.pendingTransactionMatchesChain(candidate)
      && (!candidate.planetIds?.length || (planetId !== undefined && candidate.planetIds.includes(planetId))));
    return entry ? this.state.value<WriteTransactionState>(this.writeTransactionKey(entry.actionId, entry.wallet, entry.planetIds?.[0])) : undefined;
  }

  private canObserveTransaction(entry: PendingTransaction): boolean {
    return !this.transactionAbort.signal.aborted
      && (typeof navigator === "undefined" || navigator.onLine !== false)
      && (typeof document === "undefined" || document.visibilityState !== "hidden")
      && (!this.hasContext || this.contextWallet === entry.wallet)
      && this.pendingTransactionMatchesChain(entry);
  }

  private waitForTransactionWake(delayMs?: number): Promise<void> {
    if (this.transactionAbort.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wake = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.transactionWakeups.delete(wake);
        resolve();
      };
      this.transactionWakeups.add(wake);
      if (delayMs !== undefined) timer = setTimeout(wake, Math.min(delayMs, 2_147_483_647));
    });
  }

  private resumePendingTransactions(wallet: string, expectedChainId = this.contextChainId): void {
    for (const entry of this.pendingTransactions()) {
      if (entry.wallet === wallet.toLowerCase() && this.pendingTransactionMatchesChain(entry, expectedChainId)) {
        void this.trackPendingTransaction(entry);
      }
    }
  }

  private async refreshTransactionResources(entry: PendingTransaction): Promise<void> {
    const resources = [...this.resources.values()].filter((resource) => entry.queryKeys ? entry.queryKeys.includes(resource.key) :
      resource.options.wallet?.toLowerCase() === entry.wallet
      && (!resource.options.planetId || entry.planetIds === undefined || entry.planetIds.includes(resource.options.planetId))
    );
    await Promise.all(resources.map(resource => this.refreshInvalidatedResource(resource, {}, true)));
  }

  private trackPendingTransaction(
    entry: PendingTransaction,
    onStateChange?: (state: WriteTransactionState) => void,
  ): Promise<WriteTransactionOutcome> {
    const identity = entry.transactionHash.toLowerCase();
    const existing = this.transactionRecoveries.get(identity);
    if (existing) return existing;
    let appliedRefresh: Promise<void> | undefined;
    const hasCompletions = Boolean(entry.completions?.length);
    let attempts = 0;
    let lastPhase: WriteTransactionState["phase"] | undefined;
    const publish = (phase: WriteTransactionState["phase"], error?: Error) => {
      if (!this.canObserveTransaction(entry)) return;
      const current = this.state.value<WriteTransactionState>(this.writeTransactionKey(entry.actionId, entry.wallet, entry.planetIds?.[0]));
      // A follow-up save from an older transaction must not overwrite a newer action.
      if (entry.phase === "applied" && current && (current.phase === "pending" || (current.txHash && current.txHash !== entry.transactionHash))) return;
      if (lastPhase === phase && current?.txHash === entry.transactionHash) return;
      lastPhase = phase;
      const state: WriteTransactionState = {
        key: entry.actionId,
        phase,
        label: phase === "success" ? (entry.label ?? "Action") + " completed."
          : phase === "error" ? "Transaction reverted. Please try again."
          : entry.phase === "applied" ? "Transaction completed. Finishing setup…"
          : (entry.label ? entry.label + ": " : "") + "Processing…",
        txHash: entry.transactionHash,
        ...(entry.planetIds?.[0] ? { planetId: entry.planetIds[0] } : {}),
        ...(error ? { error } : {}),
      };
      this.publishWriteTransactionState(state, entry.wallet);
      try { onStateChange?.(state); } catch { /* UI callbacks cannot end recovery. */ }
    };
    const recovery = (async (): Promise<WriteTransactionOutcome> => {
      while (!this.transactionAbort.signal.aborted) {
        if (!this.canObserveTransaction(entry)) {
          await this.waitForTransactionWake();
          continue;
        }
        publish(entry.phase === "applied" ? "applied" : entry.phase === "confirmed" ? "indexing" : "confirming");
        try {
          if (entry.phase !== "applied") {
            const status = await this.readBackendTransactionStatus(entry.transactionHash);
            if (!this.canObserveTransaction(entry)) continue;
            if (status.transactionHash?.toLowerCase() !== identity || !["submitted", "confirmed", "applied", "reverted"].includes(status.phase)) {
              throw new Error("Unexpected transaction status response.");
            }
            if (status.phase === "reverted") {
              const error = new Error("The transaction reverted.");
              this.removePendingTransaction(entry.transactionHash);
              publish("error", error);
              return { outcome: "reverted", txHash: entry.transactionHash, error };
            }
            if (status.phase !== "submitted" && entry.phase === "submitted") {
              entry.phase = "confirmed";
              attempts = 0;
              publish("confirmed");
              publish("indexing");
            }
            if (status.phase === "applied") {
              entry.phase = "applied";
              this.writePendingTransaction(entry);
              // Release gameplay conflicts and refresh immediately, independently
              // of invite/referral recovery saves. Never recheck an applied receipt.
              appliedRefresh = this.refreshTransactionResources(entry).catch(() => {});
              lastPhase = undefined;
              publish("applied");
            }
          }
          if (entry.phase === "applied") {
            while (entry.completions?.length) {
              const completion = entry.completions[0]!;
              if (completion.kind === "paid-alliance-invite") {
                await storePaidAllianceInvite(this.apiBaseUrl, entry.wallet, completion.secret, completion.signature);
              } else {
                await this.recordReferralClaimAfterIndexing(entry.wallet, completion.code, completion.commitment, entry.transactionHash, completion.signature);
              }
              // Checkpoint successful auxiliary writes separately from reads;
              // a later refresh failure must not repeat a completed operation.
              entry.completions = entry.completions.slice(1);
              this.writePendingTransaction(entry);
            }
            // Backend application is terminal. Read failures belong to the query
            // store and must not resurrect a completed transaction's spend lock.
            this.removePendingTransaction(entry.transactionHash);
            publish("success");
            await appliedRefresh;
            // Recovery metadata changed after the indexed gameplay refresh.
            if (hasCompletions) await this.refreshTransactionResources(entry).catch(() => {});
            return { outcome: "indexed", txHash: entry.transactionHash };
          }
        } catch (error) {
          // Invalid requests/auth failures need a lifecycle wake (e.g. restored session),
          // not an endless timer loop. They never mean an on-chain transaction reverted.
          if (error instanceof GameApiError && !error.retryable) {
            await this.waitForTransactionWake();
            continue;
          }
          if (error instanceof GameApiError && error.retryAfterMs !== undefined) {
            await this.waitForTransactionWake(error.retryAfterMs);
            continue;
          }
          // Transient transport failures retain the submitted hash and normal backoff.
        }
        await this.waitForTransactionWake(Math.min(30_000, this.transactionPollIntervalMs * 2 ** Math.min(attempts++, 5)));
      }
      return { outcome: entry.phase === "applied" ? "indexed" : entry.phase, txHash: entry.transactionHash };
    })().finally(() => {
      this.transactionRecoveries.delete(identity);
    });
    this.transactionRecoveries.set(identity, recovery);
    return recovery;
  }
private createIndexingPlan(keys: readonly string[], prepare?: () => Promise<PendingTransactionCompletion[]>): BackendIndexingPlan {
    return { store: this, keys: [...new Set(keys)], ...(prepare ? { prepare } : {}) };
  }

  private assertIndexingPlan(plan: BackendIndexingPlan): void {
    if (plan.store !== this) throw new Error("The write supplied an indexing plan from a different data store.");
  }

  private productionPlan(wallet: string, planetId: string | undefined, kind: string): BackendIndexingPlan {
    return this.createIndexingPlan([
      walletCacheKey(kind, wallet, planetId), walletCacheKey("infrastructure", wallet, planetId),
      this.queries.queues(wallet, planetId).key, this.queries.queues(wallet).key, walletCacheKey("planets", wallet),
    ]);
  }

  /** Within a mutation, wallet/planet/kind are intersected, not OR-ed into
   * a wallet-wide refresh. Wallet-global dependencies remain eligible. */
  private keysForScope(tags: readonly BackendDataTag[]): string[] {
    if (!tags.length) return [];
    const wallets = tags.filter(tag => tag.startsWith("wallet:"));
    const planets = tags.filter(tag => tag.startsWith("planet:"));
    const kinds = tags.filter(tag => tag.startsWith("kind:"));
    return [...this.resources.values()].filter(resource =>
      (!wallets.length || !resource.options.wallet || wallets.some(tag => resource.tags.has(tag)))
      && (!planets.length || !resource.options.planetId || planets.some(tag => resource.tags.has(tag)))
      && (!kinds.length || kinds.some(tag => resource.tags.has(tag)))
    ).map(resource => resource.key);
  }
  private async prepareIndexingPlans(plans: readonly BackendIndexingPlan[]): Promise<PendingTransactionCompletion[]> {
    const completions: PendingTransactionCompletion[] = [];
    for (const plan of plans) {
      this.assertIndexingPlan(plan);
      completions.push(...(await plan.prepare?.() ?? []));
    }
    return completions;
  }

  async runWriteTransaction(descriptor: BackendWriteTransactionDescriptor): Promise<WriteTransactionOutcome> {
    const indexingPlan = descriptor.indexing;
    if (indexingPlan) this.assertIndexingPlan(indexingPlan);
    if (this.transactionAbort.signal.aborted) return { outcome: "not-submitted" };
    const walletScope = this.transactionWalletScope(descriptor.invalidateTags);
    const planetIds = [...(descriptor.planetIds ?? descriptor.invalidateTags?.filter((tag) => tag.startsWith("planet:")).map((tag) => tag.slice(7)) ?? [])];
    const conflictKeys = [...(descriptor.conflictKeys ?? (planetIds.length ? planetIds.map((id) => "planet:" + id) : ["wallet"]))];
    const previous = this.pendingTransactions().find((entry) =>
      entry.wallet === walletScope && this.pendingTransactionMatchesChain(entry, descriptor.chainId) && this.transactionConflicts(entry, conflictKeys)
    );
    if (previous) {
      const recovery = this.trackPendingTransaction(previous);
      // A click blocked by a different action must not report that action's
      // success as its own, or submit automatically after it finishes.
      return previous.actionId === descriptor.key ? recovery : { outcome: "not-submitted" };
    }
    const publish = (state: WriteTransactionState) => {
      this.publishWriteTransactionState({ ...state, ...(planetIds[0] ? { planetId: planetIds[0] } : {}) }, walletScope);
      try { descriptor.onStateChange?.(state); } catch { /* UI callbacks cannot alter submission. */ }
    };
    try {
      const entry = await this.transactionGateFor(walletScope).run(descriptor.key, async () => {
        const assertSubmissionContext = () => {
          if (this.transactionAbort.signal.aborted || (this.hasContext && this.contextWallet !== walletScope)) {
            throw new Error("Wallet changed before submission. Please try again.");
          }
          if (this.contextChainId && descriptor.chainId && !sameChainId(this.contextChainId, descriptor.chainId)) {
            throw new Error("Network changed before submission. Please try again.");
          }
          if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You are offline. Reconnect before trying again.");
        };
        assertSubmissionContext();
        publish({ key: descriptor.key, phase: "pending", label: descriptor.label + ": Awaiting wallet" });
        await descriptor.prepare?.();
        assertSubmissionContext();
        const completions = await indexingPlan?.prepare?.();
        assertSubmissionContext();
        const transactionHash = await descriptor.send();
        const pending: PendingTransaction = {
          phase: "submitted",
          actionId: descriptor.key, chainId: descriptor.chainId ?? this.contextChainId ?? "unknown",
          submittedAt: this.now(), transactionHash, wallet: walletScope,
          label: descriptor.label, planetIds, conflictKeys,
          queryKeys: indexingPlan ? [...indexingPlan.keys] : this.keysForScope(descriptor.invalidateTags ?? []).filter(key => {
            const planetId = this.resources.get(key)?.options.planetId;
            return !planetId || planetIds.includes(planetId);
          }),
          ...(completions?.length ? { completions } : {}),
        };
        // Track in this session before releasing the wallet gate or observing status.
        this.writePendingTransaction(pending);
        return pending;
      });
      if (!entry) return { outcome: "not-submitted" };
      return this.trackPendingTransaction(entry, descriptor.onStateChange);
    } catch (error) {
      try { await descriptor.onErrorRefresh?.(error); } catch { /* Preserve the submission error. */ }
      publish({
        error, key: descriptor.key, phase: "error",
        label: descriptor.errorLabel?.(error) ?? (error instanceof Error ? error.message : "The action could not be submitted."),
      });
      return { error, outcome: "not-submitted" };
    }
  }

  private async readBackendTransactionStatus(transactionHash: string): Promise<BackendTransactionStatus> {
    if (this.transactionStatusReader) return this.transactionStatusReader(transactionHash);
    return fetchGameApiJson<BackendTransactionStatus>(`${this.apiBaseUrl}/transactions/${encodeURIComponent(transactionHash)}/status`, "Transaction status", {
      cache: "no-store", signal: this.transactionAbort.signal, timeoutMs: this.transactionRequestTimeoutMs,
      httpErrorMessage: async response => `Transaction status HTTP ${response.status}`,
    });
  }

  async runExclusiveTransaction<T>(key: string, label: string, action: () => Promise<T>, wallet?: string, conflictKey?: string): Promise<T | undefined> {
    const walletScope = wallet?.toLowerCase() ?? "global";
    return this.transactionGateFor(conflictKey ? `${walletScope}:metadata:${conflictKey}` : walletScope).run(key, async () => {
      this.publishWriteTransactionState({
        key,
        label,
        phase: "pending",
      }, walletScope);
      try {
        const result = await action();
        this.publishWriteTransactionState({
          key,
          label,
          phase: "success",
        }, walletScope);
        return result;
      } catch (error) {
        this.publishWriteTransactionState({
          error,
          key,
          label,
          phase: "error",
        }, walletScope);
        throw error;
      }
    });
  }

  /**
   * Reserve settlement-only referral/invite data while the caller is already
   * inside `runWriteTransaction.prepare`. The cache makes the reservation
   * idempotent for a repeated wallet prompt/retry, while `setContext` clears
   * it when the account changes. This deliberately does not create a second
   * transaction gate (which would deadlock the active settlement write).
   */
  prepareSettlementRedemptions(
    wallet: string,
    options: {
      paidAllianceInviteSecret?: string | undefined;
      referralCode?: string | undefined;
    },
  ): Promise<SettlementRedemptions> {
    const normalizedWallet = wallet.toLowerCase();
    const referralCode = options.referralCode?.trim();
    const secret = options.paidAllianceInviteSecret?.trim();
    const key = `settlement-reservation:${normalizedWallet}:${secret ?? ""}:${referralCode ?? ""}`;
    const existing = this.settlementReservationAttempts.get(key);
    if (existing) return existing;
    const reservation = (async (): Promise<SettlementRedemptions> => {
      if (secret) {
        return { allianceInvite: await redeemPaidAllianceInvite(this.apiBaseUrl, secret, wallet) };
      }
      if (!referralCode) return {};
      const resolution = await this.referralCodeValidation(referralCode, wallet);
      if (!resolution.valid) throw new Error(resolution.message);
      return { referral: await redeemReferralCode(this.apiBaseUrl, referralCode, wallet) };
    })();
    this.settlementReservationAttempts.set(key, reservation);
    void reservation.catch(() => {
      // A failed reservation is retryable. Keep successful reservations for
      // the current wallet/session because the backend treats them as a
      // settlement commitment that the later chain transaction consumes.
      if (this.settlementReservationAttempts.get(key) === reservation) {
        this.settlementReservationAttempts.delete(key);
      }
    });
    return reservation;
  }

  /** Recover paid-invite secrets through the same wallet-scoped action gate
   * as contract writes. The response is a short-lived canonical snapshot and
   * is cleared with its wallet context. */
  async recoverPaidAllianceInvites(wallet: string, provider: Eip1193Provider): Promise<Array<{ commitment: string; secret: string }>> {
    const normalizedWallet = wallet.toLowerCase();
    const recovered = await this.runExclusiveTransaction(
      "paid-alliance-invite-recovery",
      "Paid alliance invite recovery",
      async () => {
        if (this.contextWallet && this.contextWallet !== normalizedWallet) {
          throw new Error("Wallet changed before invite recovery could begin.");
        }
        const invites = await recoverPaidAllianceInvites(this.apiBaseUrl, provider, wallet);
        if (this.contextWallet && this.contextWallet !== normalizedWallet) {
          throw new Error("Wallet changed while invite recovery was in progress.");
        }
        this.commitBackendSnapshot("paid-alliance-invite-recovery", invites, [wallet], { wallet });
        return invites;
      },
      wallet,
    );
    return recovered ?? [];
  }

  /** Centralized bounded polling for a canonical backend read that is not
   * associated with a known transaction hash (for example wallet bootstrap).
   * It only observes backend state and never performs chain reconciliation. */

  snapshot<T>(key: string): GameStateEntry<T> | undefined {
    return this.state.snapshot<T>(key);
  }

  /** Whether a canonical query can be reused without another transport. */
  isFresh(key: string, maxAgeMs = 5_000): boolean {
    const snapshot = this.state.snapshot(key);
    return Boolean(snapshot?.data !== undefined && snapshot.freshness === "fresh" && snapshot.lastSuccessfulUpdate !== undefined && Date.now() - snapshot.lastSuccessfulUpdate < maxAgeMs);
  }

  value<T>(kind: string, ...parts: unknown[]): T | undefined {
    return this.state.value<T>(cacheKey(kind, ...parts));
  }

  /** Apply an actual backend response to its canonical snapshot. */
  private commitBackendSnapshot<T>(
    kind: string,
    data: T,
    parts: unknown[] = [],
    options: {
      planetId?: string | undefined;
      wallet?: string | undefined;
    } = {},
  ): void {
    const key = cacheKey(kind, ...parts.map(part => options.wallet && part === options.wallet ? options.wallet.toLowerCase() : part));
    this.state.publish(key, data, options);
    // Store projections (overview fan-out, chain health, successful signed
    // mutations) do not always have a registered transport resource. They
    // still need the same bounded lifecycle as descriptor-backed entries.
    this.scheduleEviction(key);
  }

  /** Record a backend transport failure while retaining any last-good data. */
  private markBackendFailure(kind: string, error: string | undefined, parts: unknown[] = []): void {
    const key = cacheKey(kind, ...parts);
    this.state.fail(key, error);
    this.scheduleEviction(key);
  }

  private scheduleEviction(key: string): void {
    if (this.transactionAbort.signal.aborted || this.state.subscriberCount(key) > 0 || this.evictionTimers.has(key)) return;
    this.evictionTimers.set(
      key,
      setTimeout(() => {
        this.evictionTimers.delete(key);
        if (!this.state.forget(key)) return;
        this.resources.delete(key);
        this.trailingInvalidations.delete(key);
        this.trailingInvalidationSettlements.delete(key);
      }, this.inactiveResourceRetentionMs),
    );
  }

  private cancelEviction(key: string): void {
    const timer = this.evictionTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.evictionTimers.delete(key);
  }

  private registerResource<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      planetId?: string | undefined;
      wallet?: string | undefined;
    },
  ): void {
    // A query key fully identifies its loader inputs. Later equivalent reads
    // may provide a newer closure or policy, so update the descriptor.
    const descriptor: RegisteredResource = {
      key,
      load: load as (signal: AbortSignal) => Promise<unknown>,
      options,
      tags: resourceTagsForKey(key, options.wallet, options.planetId),
    };
    const existing = this.resources.get(key);
    if (!existing) {
      this.resources.set(key, descriptor);
      return;
    }
    existing.load = descriptor.load;
    existing.options = descriptor.options;
    existing.tags = new Set([...existing.tags, ...descriptor.tags]);
  }

  private releasePolling(name: string, owner: symbol): void {
    const poller = this.pollers.get(name);
    if (!poller) return;
    poller.leases.delete(owner);
    if (poller.leases.size === 0) {
      this.stopPolling(name);
      return;
    }
    this.reconfigurePolling(poller);
  }

  private reconfigurePolling(poller: ManagedPoller): void {
    clearInterval(poller.timer);
    const leases = [...poller.leases.values()];
    const tags = [...new Set(leases.flatMap((lease) => lease.tags))];
    const intervalMs = Math.min(...leases.map((lease) => lease.intervalMs));
    poller.timer = this.createPollTimer(tags, intervalMs);
  }

  private deferHiddenRefresh(tags: readonly BackendDataTag[]): void {
    for (const tag of tags) {
      this.deferredHiddenRefreshes.add(tag);
    }
  }

  private readonly handleResume = (): void => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    for (const wake of this.transactionWakeups) wake();
    const tags = [...this.deferredHiddenRefreshes.keys()];
    this.deferredHiddenRefreshes.clear();
    if (this.contextWallet) this.resumePendingTransactions(this.contextWallet);
    this.queueRecovery([...this.resources.values()].filter(resource =>
      (!resource.options.wallet || resource.options.wallet.toLowerCase() === this.contextWallet)
      || [...resource.tags].some(tag => tags.includes(tag))
    ).map(resource => resource.key));
  };

  /** Resume and SSE-ready can arrive together. Union their keys before loading;
   * real chain events use invalidateKeys directly and retain trailing refreshes. */
  private queueRecovery(keys: readonly string[], streamReady = false): void {
    if (this.transactionAbort.signal.aborted) return;
    // A ready stream is a new read barrier: requests begun before it may have
    // missed a commit. Only duplicate browser lifecycle triggers can reuse them.
    keys.forEach(key => { if (streamReady || !this.recoveringKeys.has(key)) this.recoveryKeys.add(key); });
    if (this.recoveryTimer !== undefined || this.recoveryKeys.size === 0) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      const pending = [...this.recoveryKeys];
      this.recoveryKeys.clear();
      for (const key of pending) {
        this.recoveringKeys.add(key);
        // Do not let a second recovery trigger dirty its own in-progress read.
        // A read that predates recovery is still invalidated and refreshed again.
        const refresh = this.invalidateKeys([key]);
        void Promise.allSettled([refresh, this.state.inFlightSettled(key)]).finally(() => this.recoveringKeys.delete(key));
      }
    }, 0);
  }

  private readonly handleVisibilityChange = (): void => {
    this.handleResume();
  };

  private createPollTimer(tags: readonly BackendDataTag[], intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => {
      if (tags.length === 0) { this.refreshGameplay(); return; }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        this.deferHiddenRefresh(tags);
        return;
      }
      void this.invalidate(tags, { activeOnly: true, });
    }, intervalMs);
  }

  private releasePlayerActivityPresence(name: string): void {
    const poller = this.activityPresencePollers.get(name);
    if (!poller) return;
    poller.references -= 1;
    if (poller.references > 0) return;
    this.stopPlayerActivityPresence(name);
  }

  private releaseChainEventBridge(wallet: string): void {
    const bridge = this.chainEventBridges.get(wallet);
    if (!bridge) return;
    bridge.references -= 1;
    if (bridge.references > 0) return;
    bridge.close();
    this.chainEventBridges.delete(wallet);
  }

  private stopPlayerActivityPresence(name: string): void {
    const poller = this.activityPresencePollers.get(name);
    if (!poller) return;
    document.removeEventListener("visibilitychange", poller.handleVisibility);
    window.removeEventListener("pagehide", poller.handleExit);
    clearInterval(poller.timer);
    this.activityPresencePollers.delete(name);
  }

  private readRegisteredResource(resource: RegisteredResource): Promise<unknown> {
    const read = this.state.read(resource.key, resource.load, resource.options);
    void read.finally(() => {
      this.flushTrailingInvalidation(resource.key);
      this.scheduleEviction(resource.key);
    }).catch(() => { /* The canonical entry carries the failure. */ });
    return read;
  }

  private flushTrailingInvalidation(key: string): void {
    if (!this.trailingInvalidations.delete(key)) return;
    if (this.state.hasInFlight(key)) {
      this.trailingInvalidations.add(key);
      // A consumer deadline can happen before a cooperative AbortSignal
      // transport finishes. Wait for the real transport lifecycle instead of
      // spinning timer retries or issuing a duplicate read under bad network.
      const settled = this.state.inFlightSettled(key);
      if (settled && !this.trailingInvalidationSettlements.has(key)) {
        this.trailingInvalidationSettlements.add(key);
        void settled.finally(() => {
          this.trailingInvalidationSettlements.delete(key);
          this.flushTrailingInvalidation(key);
        });
      }
      return;
    }
    const resource = this.resources.get(key);
    if (!resource) return;
    // Resume/subscription will recover inactive keys; do not restart background work.
    if (!this.canRefreshResource(resource)) return;
    void this.readRegisteredResource(resource).catch(() => {
      // The canonical resource snapshot keeps last-good data and its normal
      // failure state. A later poll/manual retry can recover transient errors.
    });
  }

  settlement(wallet: string, options: WalletReadOptions = {}): Promise<WalletSettlementResponse> {
    return this.queries.settlement(wallet, options).read();
  }
overview(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<WalletOverviewSnapshotResponse> {
    return this.queries.overview(wallet, planetId, options).read();
  }

  planets(wallet: string, options: WalletReadOptions = {}): Promise<WalletPlanetsResponse> {
    return this.queries.planets(wallet, options).read();
  }

  watchedPlanets(wallet: string, options: { page?: number; pageSize?: number; timeoutMs?: number } = {}): Promise<WatchedPlanetsResponse> {
    return this.queries.watchedPlanets(wallet, options).read();
  }

  queues(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<PlayerQueuesResponse> {
    return this.queries.queues(wallet, planetId, options).read();
  }

  infrastructure(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainInfrastructureState> {
    return this.queries.infrastructure(wallet, planetId, options).read();
  }

  moon(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainMoonState> {
    return this.queries.moon(wallet, planetId, options).read();
  }

  shipyard(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainShipyardState> {
    return this.queries.shipyard(wallet, planetId, options).read();
  }

  defenses(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
    return this.queries.defenses(wallet, planetId, options).read();
  }

  research(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
    return this.queries.research(wallet, planetId, options).read();
  }

  rift(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainRiftState> {
    return this.queries.rift(wallet, planetId, options).read();
  }

  alliance(wallet: string, options: WalletReadOptions = {}): Promise<ChainAllianceState> {
    return this.queries.alliance(wallet, options).read();
  }

  profile(wallet: string): Promise<PlayerProfile> {
    return this.queries.profile(wallet).read();
  }

  settlementFunding(wallet: string): Promise<SettlementFundingState> {
    return this.queries.settlementFunding(wallet).read();
  }

  /** Store-owned projection for settlement funding. Backend funding and the
   * wallet's chain-only balance/reservation are committed under one canonical
   * identity so an old provider/network result cannot overwrite a newer
   * wallet session in the settlement UI. */
  settlementFundingForProvider(wallet: string, provider: Eip1193Provider, migrationAddress: string | undefined, providerIdentity: string | undefined): Promise<SettlementFundingState> {
    return this.queries.settlementFundingProjection(wallet, provider, migrationAddress, providerIdentity).read();
  }

  referralDashboard(wallet: string): Promise<ReferralDashboard> {
    return this.queries.referralDashboard(wallet).read();
  }

  referralHistory(wallet: string, page = 1, pageSize = 25): Promise<ReferralHistoryResponse> {
    return this.queries.referralHistory(wallet, page, pageSize).read();
  }

  referralCodeInspection(wallet: string, code: string): Promise<ReferralResolution> {
    return this.queries.referralCodeInspection(wallet, code).read();
  }

  referralCodeValidation(code: string, invitee?: string): Promise<ReferralResolution> {
    return this.queries.referralCodeValidation(code, invitee).read();
  }

  paidAllianceInviteResolution(secret: string): Promise<PaidAllianceInviteResolution> {
    return this.queries.paidAllianceInviteResolution(secret).read();
  }

  playerActivity(wallet: string, options: {
      includeProjected?: boolean;
      page?: number;
      pageSize?: number;
      since?: number;
    } = {}): Promise<PlayerActivityResponse> {
    return this.queries.playerActivity(wallet, options).read();
  }

  recordPlayerActivityPresence(wallet: string): Promise<PlayerActivityPresence> {
    return recordPlayerActivityPresence(this.apiBaseUrl, wallet);
  }

  playerActivityAwayWindowKey(wallet: string): string {
    return walletCacheKey("player-activity-away-window", wallet);
  }

  private playerActivityAwaySessionKey(wallet: string): string {
    return `veydrift:activity-away-window:${this.apiBaseUrl}:${wallet.toLowerCase()}`;
  }

  private activityAwayWindowConsumedInSession(wallet: string): boolean {
    try {
      return typeof sessionStorage !== "undefined" && sessionStorage.getItem(this.playerActivityAwaySessionKey(wallet)) === "1";
    } catch {
      return false;
    }
  }

  private markActivityAwayWindowConsumedInSession(wallet: string): void {
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(this.playerActivityAwaySessionKey(wallet), "1");
    } catch {
      // Private browsing/storage policy must not prevent normal activity tracking.
    }
  }

  /**
   * Atomically advances the shared server watermark and returns an away window
   * at most once for this wallet in this browser session. Retried background
   * heartbeats intentionally never become dialog claims.
   */
  claimPlayerActivityAwayWindow(wallet: string): Promise<PlayerActivityPresence | null> {
    const normalizedWallet = wallet.toLowerCase();
    const existing = this.activityPresenceClaims.get(normalizedWallet);
    if (existing?.status === "consumed" || this.activityAwayWindowConsumedInSession(wallet)) {
      this.activityPresenceClaims.set(normalizedWallet, { status: "consumed" });
      this.commitBackendSnapshot("player-activity-away-window", null, [wallet], { wallet });
      return Promise.resolve(null);
    }
    if (existing?.status === "pending") return existing.promise;

    const promise = this.recordPlayerActivityPresence(wallet).then((presence) => {
      this.activityPresenceClaims.set(normalizedWallet, { status: "consumed" });
      // A real window is consumed at claim time, not only after the dialog
      // closes. Route changes/remounts must never replay the same window.
      if (playerActivityAwaySince(presence) !== undefined) {
        this.markActivityAwayWindowConsumedInSession(wallet);
      }
      this.commitBackendSnapshot("player-activity-away-window", presence, [wallet], { wallet });
      return presence;
    }).catch((error: unknown) => {
      const current = this.activityPresenceClaims.get(normalizedWallet);
      if (current?.status === "pending" && current.promise === promise) {
        this.activityPresenceClaims.delete(normalizedWallet);
      }
      this.markBackendFailure("player-activity-away-window", error instanceof Error ? error.message : String(error), [wallet.toLowerCase()]);
      throw error;
    });
    this.activityPresenceClaims.set(normalizedWallet, { promise, status: "pending" });
    return promise;
  }

  /** Consume a claimed away window across dialog remounts and disposable API
   * stores for this wallet/browser session. */
  dismissPlayerActivityAwayWindow(wallet: string): void {
    const normalizedWallet = wallet.toLowerCase();
    this.markActivityAwayWindowConsumedInSession(wallet);
    this.activityPresenceClaims.set(normalizedWallet, { status: "consumed" });
    this.commitBackendSnapshot("player-activity-away-window", null, [wallet], { wallet });
  }

  recordPlayerActivityPresenceOnExit(wallet: string): void {
    const url = playerActivityPresenceUrl(this.apiBaseUrl, wallet);
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, "")) return;
    void fetch(url, { keepalive: true, method: "POST" }).catch(() => {});
  }

  highscores(options: FetchHighscoreOptions | number = 100): Promise<HighscoreResponse> {
    return this.queries.highscores(options).read();
  }

  playerHighscore(wallet: string): Promise<HighscoreEntry | null> {
    return this.queries.playerHighscore(wallet).read();
  }

  raidFinderDebris(options: { limit?: number } = {}): Promise<RaidFinderDebrisResponse> {
    return this.queries.raidFinderDebris(options).read();
  }

  raidFinderRifters(options: { limit?: number } = {}): Promise<RaidFinderRiftersResponse> {
    return this.queries.raidFinderRifters(options).read();
  }

  system<T = unknown>(galaxy: number, system: number, options: SystemReadOptions = {}): Promise<T> {
    return this.queries.system<T>(galaxy, system, options).read();
  }

  randomnessReadiness(): Promise<RandomnessReadiness> {
    return this.queries.randomnessReadiness().read();
  }

  runtimeConfig<T>(url: string): Promise<T> {
    return this.queries.runtimeConfig<T>(url).read();
  }

  attackProtection(wallet: string, targetPlanetId: string, targetIsMoon = false, options: WalletReadOptions = {}): Promise<AttackProtectionStatus> {
    return this.queries.attackProtection(wallet, targetPlanetId, targetIsMoon, options).read();
  }

  fleetVisibility(wallet: string, options: FleetMissionVisibilityOptions = {}): Promise<FleetMissionVisibilityResponse> {
    return this.queries.fleetVisibility(wallet, options).read();
  }

  fleetArchive(wallet: string, options: FleetMissionArchiveOptions = {}): Promise<FleetMissionArchiveResponse> {
    return this.queries.fleetArchive(wallet, options).read();
  }

  missileArchive(wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}): Promise<MissileAttackArchiveResponse> {
    return this.queries.missileArchive(wallet, options).read();
  }

  globalActiveMissions(): Promise<GlobalActiveMissionsResponse> {
    return this.queries.globalActiveMissions().read();
  }

  landingActiveMissions<T>(): Promise<T[]> {
    return this.queries.landingActiveMissions<T>().read();
  }

  landingHighscores<T>(): Promise<T[]> {
    return this.queries.landingHighscores<T>().read();
  }

  globalMissionArchive(options: GlobalMissionArchiveOptions = {}): Promise<GlobalMissionArchiveResponse> {
    return this.queries.globalMissionArchive(options).read();
  }

  mission(missionId: string): Promise<MissionDetailResponse> {
    return this.queries.mission(missionId).read();
  }

  battleReports(): Promise<BattleReportSummary[]> {
    return this.queries.battleReports().read();
  }

  entityMedia(entityKind: EntityMediaKind, entityId: string): Promise<EntityMediaResponse> {
    return this.queries.entityMedia(entityKind, entityId).read();
  }

  private async runSignedMetadataMutation<T>(provider: Eip1193Provider, wallet: string, key: string, label: string, action: (options: SignedMetadataOptions) => Promise<T>): Promise<T> {
    const assertContext = () => {
      if (this.transactionAbort.signal.aborted || (this.hasContext && this.contextWallet !== wallet.toLowerCase())) {
        throw new Error("Wallet changed before metadata could be saved.");
      }
    };
    assertContext();
    const response = await this.runExclusiveTransaction(
      key,
      label,
      () => action({
        signal: this.transactionAbort.signal,
        sign: async message => {
          assertContext();
          const signature = await this.transactionGateFor(wallet.toLowerCase()).run(key, () => requestPersonalSignature(provider, wallet, message));
          if (!signature) throw new Error("Another wallet prompt is already open.");
          assertContext();
          return signature;
        },
      }),
      wallet,
      key,
    );
    if (!response) throw new Error("Another game action is already in progress.");
    return response;
  }

  async saveEntityMedia(provider: Eip1193Provider, wallet: string, entityKind: EntityMediaKind, entityId: string, mediaUrl: string): Promise<EntityMediaResponse> {
    entityId = normalizeEntityMediaId(entityKind, entityId);
    const response = await this.runSignedMetadataMutation(provider, wallet, `entity-media:${entityKind}:${entityId}`, "Save media",
      options => updateEntityMedia(this.apiBaseUrl, provider, wallet, entityKind, entityId, mediaUrl, options));
    this.commitBackendSnapshot("entity-media", response, [entityKind, entityId]);
    await this.invalidateKeys([this.key("entity-media", entityKind, entityId)], {
      activeOnly: true,
    });
    return response;
  }

  /**
   * Watch mutations are signed backend writes, not contract transactions. They
   * still use the shared mutation gate and invalidate every subscribed watched
   * view instead of patching one component's local page in place.
   */
  async setPlanetWatched(provider: Eip1193Provider, wallet: string, planetId: string, watched: boolean): Promise<WatchPlanetMutationResponse> {
    const response = await this.runSignedMetadataMutation(
      provider, wallet,
      `watched-planet:${wallet.toLowerCase()}:${planetId}`,
      watched ? "Unwatch planet" : "Watch planet",
      options => watched ? unwatchPlanet(this.apiBaseUrl, provider, wallet, planetId, options) : watchPlanet(this.apiBaseUrl, provider, wallet, planetId, options),
    );
    await this.invalidateKeys(this.keysForScope([`wallet:${wallet.toLowerCase()}`, "kind:watched-planets"]));
    return response;
  }

  /** Signed profile updates share the store-owned mutation gate and refresh policy. */
  async savePlayerProfile(provider: Eip1193Provider, wallet: string, displayName: string, description: string | null): Promise<PlayerProfile> {
    const profile = await this.runSignedMetadataMutation(
      provider, wallet,
      `profile:${wallet.toLowerCase()}`,
      "Save profile",
      options => updatePlayerProfile(this.apiBaseUrl, provider, wallet, displayName, description, options),
    );
    this.commitBackendSnapshot("profile", profile, [wallet], { wallet });
    await this.invalidateKeys(this.keysForScope([`wallet:${wallet.toLowerCase()}`, "kind:planets", "kind:settlement", "kind:alliance", "kind:alliance-detail", "kind:player-highscore", "kind:highscores", "kind:landing-highscores", "kind:system"]));
    return profile;
  }

  /** Record a confirmed referral redemption and invalidate shared referral views. */
  async recordReferralRedemption(code: string, invitee: string, txHash: string): Promise<void> {
    await recordReferralRedemptionTransaction(this.apiBaseUrl, code, invitee, txHash);
    await this.invalidateKeys(this.keysForScope([`wallet:${invitee.toLowerCase()}`, "kind:referral-dashboard", "kind:referral-history"]));
  }

  /** Persist signed referral-claim recovery data through the shared mutation boundary. */
  async persistReferralClaimIntent(wallet: string, code: string, commitment: string, signature: string): Promise<void> {
    await persistReferralClaimIntent(this.apiBaseUrl, wallet, code, commitment, signature);
  }

  /**
   * The backend transaction boundary already proved the claim event applied.
   * Keep the auxiliary recovery-data write and canonical referral refresh in
   * the shared store so settlement UI never owns another mutation lifecycle.
   */
  async recordReferralClaimAfterIndexing(wallet: string, code: string, commitment: string, txHash: string, signature: string): Promise<ReferralDashboard> {
    const dashboard = await recordReferralClaimTransaction(this.apiBaseUrl, wallet, code, commitment, txHash, signature);
    this.commitBackendSnapshot("referral-dashboard", dashboard, [wallet], { wallet });
    return dashboard;
  }

  burningChicken(owner: string, tokenId: string, config: BurningChickenConfig): Promise<unknown> {
    return this.queries.burningChicken(owner, tokenId, config).read();
  }
}

export function createBackendDataStore(apiBaseUrl: string): BackendDataStore {
  return new BackendDataStore(apiBaseUrl.replace(/\/+$/, ""));
}



const sharedBackendDataStores = new Map<string, BackendDataStore>();
const sharedBackendDataStoreLeases = new Map<string, number>();
const sharedBackendDataStoreDisposals = new Map<string, ReturnType<typeof setTimeout>>();

export function backendDataStoreFor(apiBaseUrl: string): BackendDataStore {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  const existing = sharedBackendDataStores.get(normalizedApiBaseUrl);
  if (existing) return existing;
  const store = createBackendDataStore(normalizedApiBaseUrl);
  sharedBackendDataStores.set(normalizedApiBaseUrl, store);
  return store;
}

/** Keep an API-base store alive while a mounted application surface depends on
 * it. Releasing the last lease tears down listeners, pollers, and caches; this
 * prevents config changes from retaining obsolete stores without allowing one
 * surface to dispose another surface's active store. */
export function retainBackendDataStore(apiBaseUrl: string): () => void {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  const pendingDisposal = sharedBackendDataStoreDisposals.get(normalizedApiBaseUrl);
  if (pendingDisposal) {
    clearTimeout(pendingDisposal);
    sharedBackendDataStoreDisposals.delete(normalizedApiBaseUrl);
  }
  backendDataStoreFor(normalizedApiBaseUrl);
  sharedBackendDataStoreLeases.set(normalizedApiBaseUrl, (sharedBackendDataStoreLeases.get(normalizedApiBaseUrl) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (sharedBackendDataStoreLeases.get(normalizedApiBaseUrl) ?? 1) - 1;
    if (remaining > 0) {
      sharedBackendDataStoreLeases.set(normalizedApiBaseUrl, remaining);
      return;
    }
    sharedBackendDataStoreLeases.delete(normalizedApiBaseUrl);
    // Defer final disposal through the current turn. This preserves a store
    // across development strict-effect cleanup/reacquire while still releasing
    // it promptly after a real unmount or runtime-config transition.
    const timer = setTimeout(() => {
      sharedBackendDataStoreDisposals.delete(normalizedApiBaseUrl);
      if ((sharedBackendDataStoreLeases.get(normalizedApiBaseUrl) ?? 0) > 0) return;
      const store = sharedBackendDataStores.get(normalizedApiBaseUrl);
      store?.dispose();
      sharedBackendDataStores.delete(normalizedApiBaseUrl);
    }, 0);
    sharedBackendDataStoreDisposals.set(normalizedApiBaseUrl, timer);
  };
}

/** Release API-base stores that are not reachable from the current runtime
 * configuration. This prevents preview/config transitions from retaining
 * document listeners, timers, and response maps for the life of the tab. */
export function disposeBackendDataStoresExcept(apiBaseUrls: readonly (string | undefined)[]): void {
  const retained = new Set(apiBaseUrls.filter((value): value is string => value !== undefined).map((value) => value.replace(/\/+$/, "")));
  for (const [apiBaseUrl, store] of sharedBackendDataStores) {
    if (retained.has(apiBaseUrl) || (sharedBackendDataStoreLeases.get(apiBaseUrl) ?? 0) > 0) continue;
    const pendingDisposal = sharedBackendDataStoreDisposals.get(apiBaseUrl);
    if (pendingDisposal) {
      clearTimeout(pendingDisposal);
      sharedBackendDataStoreDisposals.delete(apiBaseUrl);
    }
    store.dispose();
    sharedBackendDataStores.delete(apiBaseUrl);
  }
}
