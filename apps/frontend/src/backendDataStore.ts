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
  inspectReferralCode,
  persistReferralClaimIntent,
  resolvePaidAllianceInvite,
  recordReferralClaimTransaction,
  recordReferralRedemptionTransaction,
  readMigrationReservation,
  readWalletNativeBalance,
  settlementFundingWithWalletBalance,
  redeemPaidAllianceInvite,
  redeemReferralCode,
  storePaidAllianceInvite,
  fetchRiftState,
  fetchSettlementFundingState,
  fetchShipyardState,
  fetchSystemData,
  fetchWalletOverviewSnapshot,
  fetchWalletPlanets,
  fetchWalletQueues,
  fetchWalletSettlement,
  fetchWatchedPlanets,
  unwatchPlanet,
  watchPlanet,
  updatePlayerProfile,
  validateReferralCode,
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
  type ReferralResolution,
  type PaidAllianceInviteResolution,
  type PaidAllianceInviteRedemption,
  type ReferralRedemption,
  type SettlementFundingState,
  type MigrationReservation,
  type WalletOverviewSnapshotResponse,
  type WalletPlanetsResponse,
  type WalletSettlementResponse,
  type WatchedPlanetsResponse,
  type WatchPlanetMutationResponse,
  REFERRAL_CODE_FRONT_RUN_MESSAGE,
} from "./walletFlow";
import { fetchEntityMedia, normalizeEntityMediaId, updateEntityMedia, type EntityMediaKind, type EntityMediaResponse } from "./entityMedia";
import type { Eip1193Provider } from "./walletFlow";
import { GameStateStore, type GameStateEntry, type GameStatePriority } from "./gameStateStore";
import { backendResourceSnapshot, promoteCanonicalPlanetResources, type BackendResourceState, type CanonicalPlanetResourceSnapshot, type CanonicalPlanetResourceStore } from "./planetResourceStore";
import {
  isResourceSnapshotIndexedAfterTransaction,
  resourceIndexingExpectationForTransaction,
  waitForAllianceApplicationCleared,
  waitForAllianceCreationState,
  waitForAllianceProfileState,
  waitForFleetVisibilityIndexedThrough,
  waitForMissionLaunchState,
  waitForRenamedWalletPlanet,
  waitForStartedBuildingState,
  waitForStartedDefenseProductionState,
  waitForStartedResearchState,
  waitForStartedShipProductionState,
  type AllianceApplicationExpectation,
  type AllianceCreationExpectation,
  type AllianceProfileExpectation,
  type MissionLaunchSnapshot,
  type ResourceIndexingExpectation,
  type StartedBuildingExpectation,
  type StartedDefenseProductionExpectation,
  type StartedDefenseProductionSnapshot,
  type StartedResearchExpectation,
  type StartedShipProductionExpectation,
} from "./postTransactionRefresh";
import { createTransactionActionGate, runWriteTransaction as executeWriteTransaction, type TransactionActionGate, type WriteTransactionDescriptor, type WriteTransactionState } from "./transactionActionGate";

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

/** A typed, store-owned backend read. UI code can subscribe/refetch it but
 * cannot pair an arbitrary cache key with a different loader. */
export type BackendDataQueryDescriptor<T> = {
  readonly key: string;
  readonly read: () => Promise<T>;
  readonly store: BackendDataStore;
};

export type IndexedReadWaitOptions = {
  attempts?: number;
  intervalMs?: number;
  delay?: (ms: number) => Promise<void>;
  timeoutError?: string;
};

declare const backendIndexingPlanBrand: unique symbol;

/**
 * An opaque description of the indexed backend state a confirmed write must
 * expose.  Only BackendDataStore creates plans, so screens cannot install
 * their own pollers, cache writes, or request-time reconciliation.
 */
export type BackendIndexingPlan = {
  readonly [backendIndexingPlanBrand]: true;
};

export type BackendWriteTransactionDescriptor = Omit<WriteTransactionDescriptor<void>, "applyIndexedState" | "waitForIndexed"> & {
  /**
   * Canonical resources affected by a confirmed mutation.  The wallet UI
   * owns signing, but indexed convergence always returns through this data
   * store rather than page-specific refresh trees.
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
    deadlineMs?: number | undefined;
    planetId?: string | undefined;
    priority?: GameStatePriority | undefined;
    scope?: string | undefined;
    wallet?: string | undefined;
  };
  tags: ReadonlySet<BackendDataTag>;
};

type PollingLease = {
  intervalMs: number;
  priority: GameStatePriority;
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
  | { promise: Promise<PlayerActivityPresence>; status: "pending" }
  | { status: "consumed" };

type ChainEventBridge = {
  close: () => void;
  references: number;
  signature: string;
};

type IndexingPlanRunner = (receipt: unknown, txHash: string) => Promise<void>;

type ReceiptBlock = {
  blockNumber?: string | number | bigint | null;
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

const INACTIVE_RESOURCE_RETENTION_MS = 120_000;

type BackendDataStoreOptions = {
  inactiveResourceRetentionMs?: number;
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

function resourceTagsForKey(key: string, wallet?: string | undefined, planetId?: string | undefined): ReadonlySet<BackendDataTag> {
  const separator = key.indexOf(":");
  const kind = separator >= 0 ? key.slice(0, separator) : key;
  const tags = new Set<BackendDataTag>([`kind:${kind}`]);
  if (wallet) tags.add(`wallet:${wallet.toLowerCase()}`);
  if (planetId) tags.add(`planet:${planetId}`);
  return tags;
}

function hasIndexedSettlementResources(settlement: WalletSettlementResponse): boolean {
  const planet = settlement.planet;
  if (!settlement.hasFirstPlanet || !settlement.homePlanetId || !planet) return false;
  const settledAt = Number(planet.lastSettledAt);
  if (!Number.isFinite(settledAt) || settledAt <= 0) return false;
  const resources = planet.resources;
  return !(resources.metal === "0" && resources.crystal === "0" && resources.deuterium === "0");
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
  /** EVM nonces must serialize per wallet, not across unrelated accounts that
   * happen to share this API-base store after a browser account switch. */
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
  private readonly trailingInvalidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly trailingInvalidationSettlements = new Set<string>();
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pollers = new Map<string, ManagedPoller>();
  private readonly activityPresencePollers = new Map<string, ActivityPresencePoller>();
  /** A dialog may remount during route/network churn. Its away window is a
   * one-time session claim, while ordinary heartbeats remain silent. */
  private readonly activityPresenceClaims = new Map<string, ActivityPresenceClaim>();
  private readonly chainEventBridges = new Map<string, ChainEventBridge>();
  private readonly scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
  /** Refresh intent that became due while hidden. It is coalesced and resumed
   * once, centrally, when the tab is visible again. */
  private readonly deferredHiddenRefreshes = new Map<BackendDataTag, GameStatePriority>();
  private readonly indexingPlanRunners = new WeakMap<object, IndexingPlanRunner>();
  private contextWallet: string | undefined;
  /**
   * Detail endpoints are separate cache keys but project into one canonical
   * planet-resource entity. Track request start order per body so an earlier
   * endpoint response that arrives late cannot replace a newer detail read.
   */
  private readonly planetResourceReadGenerations = new Map<string, number>();

  private readonly inactiveResourceRetentionMs: number;

  constructor(readonly apiBaseUrl: string, options: BackendDataStoreOptions = {}) {
    this.inactiveResourceRetentionMs = options.inactiveResourceRetentionMs ?? INACTIVE_RESOURCE_RETENTION_MS;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  /**
   * The UI query catalogue. Each descriptor fixes one normalized identity to
   * exactly one store-owned reader; components only declare whether it should
   * be active and render the shared snapshot.
   */
  readonly queries = {
    alliance: (wallet: string) => this.query(this.key("alliance", wallet), () => this.alliance(wallet)),
    attackProtection: (wallet: string, planetId: string, targetIsMoon = false) => this.query(this.key("attack-protection", wallet, planetId, targetIsMoon), () => this.attackProtection(wallet, planetId, targetIsMoon)),
    battleReports: () => this.query(this.key("battle-reports"), () => this.battleReports()),
    burningChicken: (owner: string, tokenId: string, config: BurningChickenConfig) => this.query(this.key("burning-chicken", owner, tokenId, config), () => this.burningChicken(owner, tokenId, config)),
    defenses: (wallet: string, planetId: string) => this.query(this.key("defenses", wallet, planetId), () => this.defenses(wallet, planetId)),
    entityMedia: (kind: EntityMediaKind, entityId: string) => this.query(this.key("entity-media", kind, entityId), () => this.entityMedia(kind, entityId)),
    fleetArchive: (wallet: string, options: FleetMissionArchiveOptions = {}) => this.query(this.key("fleet-archive", wallet, options), () => this.fleetArchive(wallet, options)),
    fleetVisibility: (wallet: string, options: FleetMissionVisibilityOptions = {}) => this.query(this.key("fleet-visibility", wallet, options.includeArchive), () => this.fleetVisibility(wallet, options)),
    globalActiveMissions: () => this.query(this.key("global-active-missions"), () => this.globalActiveMissions()),
    globalMissionArchive: (options: GlobalMissionArchiveOptions = {}) => this.query(this.key("global-mission-archive", options), () => this.globalMissionArchive(options)),
    highscores: (options: FetchHighscoreOptions = {}) => this.query(this.key("highscores", options), () => this.highscores(options)),
    infrastructure: (wallet: string, planetId: string) => this.query(this.key("infrastructure", wallet, planetId), () => this.infrastructure(wallet, planetId)),
    landingActiveMissions: <T>() => this.query(this.key("landing-active-missions"), () => this.landingActiveMissions<T>()),
    landingHighscores: <T>() => this.query(this.key("landing-highscores"), () => this.landingHighscores<T>()),
    moon: (wallet: string, planetId: string) => this.query(this.key("moon", wallet, planetId), () => this.moon(wallet, planetId)),
    missileArchive: (wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}) => this.query(this.key("missile-archive", wallet, options), () => this.missileArchive(wallet, options)),
    mission: (missionId: string) => this.query(this.key("mission", missionId), () => this.mission(missionId)),
    overview: (wallet: string, planetId?: string) => this.query(this.key("overview", wallet, planetId), () => this.overview(wallet, planetId)),
    paidAllianceInviteResolution: (secret: string) => this.query(this.key("paid-alliance-invite-resolution", secret), () => this.paidAllianceInviteResolution(secret)),
    playerActivity: (wallet: string, options: { page?: number; pageSize?: number; since?: number; includeProjected?: boolean } = {}) => this.query(this.key("player-activity", wallet, options), () => this.playerActivity(wallet, options)),
    playerHighscore: (wallet: string) => this.query(this.key("player-highscore", wallet), () => this.playerHighscore(wallet)),
    planets: (wallet: string) => this.query(this.key("planets", wallet), () => this.planets(wallet)),
    profile: (wallet: string) => this.query(this.key("profile", wallet), () => this.profile(wallet)),
    queues: (wallet: string, planetId?: string) => this.query(this.key("queues", wallet, planetId), () => this.queues(wallet, planetId)),
    raidFinderDebris: (options: { limit?: number } = {}) => this.query(this.key("raid-finder-debris", options), () => this.raidFinderDebris(options)),
    raidFinderRifters: (options: { limit?: number } = {}) => this.query(this.key("raid-finder-rifters", options), () => this.raidFinderRifters(options)),
    referralCodeInspection: (wallet: string, code: string) => this.query(this.key("referral-code-inspection", wallet, code), () => this.referralCodeInspection(wallet, code)),
    referralCodeValidation: (code: string, wallet?: string) => this.query(this.key("referral-code-validation", code, wallet), () => this.referralCodeValidation(code, wallet)),
    referralDashboard: (wallet: string) => this.query(this.key("referral-dashboard", wallet), () => this.referralDashboard(wallet)),
    referralHistory: (wallet: string, page: number, pageSize: number) => this.query(this.key("referral-history", wallet, page, pageSize), () => this.referralHistory(wallet, page, pageSize)),
    research: (wallet: string, planetId: string) => this.query(this.key("research", wallet, planetId), () => this.research(wallet, planetId)),
    rift: (wallet: string, planetId: string) => this.query(this.key("rift", wallet, planetId), () => this.rift(wallet, planetId)),
    runtimeConfig: <T>(url: string) => this.query(this.key("runtime-config", url), () => this.runtimeConfig<T>(url)),
    shipyard: (wallet: string, planetId: string) => this.query(this.key("shipyard", wallet, planetId), () => this.shipyard(wallet, planetId)),
    settlement: (wallet: string) => this.query(this.key("settlement", wallet), () => this.settlement(wallet)),
    settlementFunding: (wallet: string) => this.query(this.key("settlement-funding", wallet), () => this.settlementFunding(wallet)),
    system: <T = unknown>(galaxy: number, system: number, options: { detail?: "full" } = {}) => this.query(this.key("system", galaxy, system, options), () => this.system<T>(galaxy, system, options)),
    watchedPlanets: (wallet: string, options: { page?: number; pageSize?: number } = {}) => this.query(this.key("watched-planets", wallet, options), () => this.watchedPlanets(wallet, options)),
  };

  /**
   * Store-created plans are the only post-receipt convergence API exposed to
   * screens. They contain expectation data, never UI callbacks or transport
   * loaders, so every retry remains an ordinary indexed backend read.
   */
  readonly indexing = {
    refresh: (tags: readonly BackendDataTag[]): BackendIndexingPlan => this.createIndexingPlan(async () => this.refreshIndexedTags(tags)),
    resourceChange: (wallet: string, planetId: string, bodyKind: "planet" | "moon" = "planet", baseline: ResourceIndexingExpectation["baseline"] = undefined): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const expectation = resourceIndexingExpectationForTransaction(txHash, baseline, receipt as ReceiptBlock);
        if (bodyKind === "moon") {
          await this.waitForIndexedResource(
            () =>
              this.moon(wallet, planetId, {
                fresh: true,
                priority: "transaction",
              }),
            expectation,
          );
        } else {
          await this.waitForIndexedResource(
            () =>
              this.shipyard(wallet, planetId, {
                fresh: true,
                priority: "transaction",
              }),
            expectation,
          );
        }
      }),
    settledPlanet: (wallet: string): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        await this.waitForIndexed(
          () =>
            this.settlement(wallet, {
              fresh: true,
              priority: "transaction",
            }),
          hasIndexedSettlementResources,
          {
            attempts: 8,
            intervalMs: 2_000,
            timeoutError: "Settlement is confirmed, but the game API is still indexing starter resources. Retry once backend sync catches up.",
          },
        );
      }),
    referralClaim: (wallet: string, code: string, commitment: string, signature: string | (() => string)): BackendIndexingPlan =>
      this.createIndexingPlan(async (_receipt, txHash) => {
        const resolvedSignature = typeof signature === "function" ? signature() : signature;
        if (!resolvedSignature) {
          throw new Error("Referral claim authorization is unavailable.");
        }
        await this.recordReferralClaimAfterIndexing(wallet, code, commitment, txHash, resolvedSignature);
      }),
    startedBuilding: (wallet: string, expectation: StartedBuildingExpectation, baseline: ResourceIndexingExpectation["baseline"] = undefined): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const indexedExpectation = {
          ...expectation,
          resourceIndexing: resourceIndexingExpectationForTransaction(txHash, baseline, receipt as ReceiptBlock),
        };
        await waitForStartedBuildingState(
          async () => ({
            infrastructure: await this.infrastructure(wallet, indexedExpectation.planetId, { fresh: true, priority: "transaction" }),
            planetsResponse: await this.planets(wallet, {
              fresh: true,
              priority: "transaction",
            }),
            queues: await this.queues(wallet, indexedExpectation.planetId, {
              fresh: true,
              priority: "transaction",
            }),
          }),
          indexedExpectation,
        );
      }),
    startedShipProduction: (wallet: string, expectation: StartedShipProductionExpectation, baseline: ResourceIndexingExpectation["baseline"] = undefined): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const indexedExpectation = {
          ...expectation,
          resourceIndexing: resourceIndexingExpectationForTransaction(txHash, baseline, receipt as ReceiptBlock),
        };
        await waitForStartedShipProductionState(
          async () => ({
            queues: await this.queues(wallet, indexedExpectation.planetId, {
              fresh: true,
              priority: "transaction",
            }),
            shipyard: await this.shipyard(wallet, indexedExpectation.planetId, {
              fresh: true,
              priority: "transaction",
            }),
          }),
          indexedExpectation,
        );
      }),
    startedDefenseProduction: (wallet: string, expectation: StartedDefenseProductionExpectation, baseline: ResourceIndexingExpectation["baseline"] = undefined): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const indexedExpectation = {
          ...expectation,
          resourceIndexing: resourceIndexingExpectationForTransaction(txHash, baseline, receipt as ReceiptBlock),
        };
        await this.waitForStartedDefenseProduction(wallet, indexedExpectation);
      }),
    startedResearch: (wallet: string, planetId: string, expectation: StartedResearchExpectation, baseline: ResourceIndexingExpectation["baseline"] = undefined): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const indexedExpectation = {
          ...expectation,
          resourceIndexing: resourceIndexingExpectationForTransaction(txHash, baseline, receipt as ReceiptBlock),
        };
        await waitForStartedResearchState(
          async () => ({
            queues: await this.queues(wallet, planetId, {
              fresh: true,
              priority: "transaction",
            }),
            research: await this.research(wallet, planetId, {
              fresh: true,
              priority: "transaction",
            }),
          }),
          indexedExpectation,
        );
      }),
    /** Independent indexed predicates can be observed together. */
    all: (plans: readonly BackendIndexingPlan[]): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        const runners = plans.map((plan) => {
          const run = this.indexingPlanRunners.get(plan as object);
          if (!run) {
            throw new Error("The write supplied an indexing plan from a different data store.");
          }
          return run;
        });
        await Promise.all(runners.map((run) => run(receipt, txHash)));
      }),
    /** Use this only where later visibility depends on earlier indexed state. */
    sequence: (plans: readonly BackendIndexingPlan[]): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt, txHash) => {
        for (const plan of plans) {
          const run = this.indexingPlanRunners.get(plan as object);
          if (!run) {
            throw new Error("The write supplied an indexing plan from a different data store.");
          }
          await run(receipt, txHash);
        }
      }),
    fleetVisibility: (wallet: string, tags: readonly BackendDataTag[] = []): BackendIndexingPlan =>
      this.createIndexingPlan(async (receipt) => {
        await waitForFleetVisibilityIndexedThrough(
          () =>
            this.fleetVisibility(wallet, {
              fresh: true,
              includeArchive: false,
            }),
          (receipt as ReceiptBlock).blockNumber,
        );
        await this.refreshIndexedTags(tags);
      }),
    missionLaunch: (wallet: string, expectedMission: (txHash: string) => import("./walletFlow").FleetMissionSummary | undefined, tags: readonly BackendDataTag[] = []): BackendIndexingPlan =>
      this.createIndexingPlan(async (_receipt, txHash) => {
        await waitForMissionLaunchState(
          async (): Promise<MissionLaunchSnapshot> => ({
            allActiveMissions: (await this.globalActiveMissions()).missions,
            fleetVisibility: await this.fleetVisibility(wallet, {
              fresh: true,
              includeArchive: false,
            }),
          }),
          txHash,
          { expectedMission: expectedMission(txHash) },
        );
        await this.refreshIndexedTags(tags);
      }),
    alliance: (wallet: string, expectation?: AllianceApplicationExpectation | AllianceProfileExpectation | AllianceCreationExpectation): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        if (!expectation) {
          await this.alliance(wallet, { fresh: true });
          return;
        }
        if ("allianceId" in expectation && "requester" in expectation) {
          await waitForAllianceApplicationCleared(() => this.alliance(wallet, { fresh: true }), expectation);
        } else if ("allianceId" in expectation) {
          await waitForAllianceProfileState(() => this.alliance(wallet, { fresh: true }), expectation);
        } else {
          await waitForAllianceCreationState(() => this.alliance(wallet, { fresh: true }), expectation);
        }
      }),
    paidAllianceInvite: (wallet: string, provider: Eip1193Provider, secret: string): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        await storePaidAllianceInvite(this.apiBaseUrl, provider, wallet, secret);
        await this.alliance(wallet, { fresh: true });
      }),
    planetRename: (wallet: string, planetId: string, name: string): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        await this.waitForIndexed(
          () => this.planets(wallet, { fresh: true, priority: "transaction" }),
          (snapshot) => snapshot.planets.some((planet) => planet.planetId === planetId && planet.name === name),
          {
            timeoutError: "The renamed planet is still syncing with the game API.",
          },
        );
      }),
    planetAbsent: (wallet: string, planetId: string): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        await this.waitForIndexed(
          () => this.planets(wallet, { fresh: true, priority: "transaction" }),
          (snapshot) => !snapshot.planets.some((planet) => planet.planetId === planetId),
          {
            timeoutError: "The abandoned planet is still syncing with the game API.",
          },
        );
      }),
    moonExists: (wallet: string, planetId: string): BackendIndexingPlan =>
      this.createIndexingPlan(async () => {
        await this.waitForIndexed(
          () =>
            this.moon(wallet, planetId, {
              fresh: true,
              priority: "transaction",
            }),
          (snapshot) => Boolean(snapshot?.moon),
          {
            timeoutError: "The confirmed moon is still syncing with the game API.",
          },
        );
      }),
  };

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
      // A cache resource, not a route, owns its transport.  Page-local scope
      // strings used to let an unmount cancel another view's shared read and
      // then present retained stale data as fresh.  Keep a stable internal
      // scope only for diagnostics; cache reads are never route-cancelled.
      scope: `backend-data:${key}`,
    };
    this.registerResource(key, load, readOptions);
    const read = this.state.read(key, load, readOptions);
    void read.then(
      () => this.flushTrailingInvalidation(key),
      () => this.flushTrailingInvalidation(key),
    );
    void read.finally(() => this.scheduleEviction(key)).catch(() => {
      // The canonical entry carries the failure; eviction is best-effort.
    });
    return read;
  }

  private query<T>(key: string, read: () => Promise<T>): BackendDataQueryDescriptor<T> {
    return { key, read, store: this };
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
    if (snapshot?.data !== undefined && snapshot.freshness === "fresh" && snapshot.lastSuccessfulUpdate !== undefined && Date.now() - snapshot.lastSuccessfulUpdate < maxAgeMs) {
      return Promise.resolve(snapshot.data);
    }
    return this.refresh(key, load, options);
  }

  refetch(key: string, options: BackendDataRefreshOptions = {}): Promise<unknown> | undefined {
    const resource = this.resources.get(key);
    if (!resource) return undefined;
    return this.readRegisteredResource(resource, options, true);
  }

  /** Invalidate canonical resources by identity, then refresh active views. */
  invalidate(tags: readonly BackendDataTag[], options: BackendDataRefreshOptions = {}): Promise<PromiseSettledResult<unknown>[]> {
    const wanted = new Set(tags);
    const reads: Promise<unknown>[] = [];
    for (const resource of this.resources.values()) {
      if (![...resource.tags].some((tag) => wanted.has(tag))) continue;
      // Mark every matching canonical entry stale, including inactive source
      // planets in a batch mutation. They will not lie about freshness when a
      // player navigates back later; only currently subscribed resources are
      // eagerly transported again.
      this.state.invalidate(resource.key);
      if (options.activeOnly !== false && this.state.subscriberCount(resource.key) === 0) continue;
      if (this.state.hasInFlight(resource.key)) {
        this.trailingInvalidations.add(resource.key);
        continue;
      }
      const refresh = this.readRegisteredResource(resource, options, false);
      if (refresh) reads.push(refresh);
    }
    return Promise.allSettled(reads);
  }

  /**
   * Store-owned polling. Screens can register visibility/route intent, but do
   * not create timers or duplicate refresh loops themselves.
   */
  startPolling(name: string, tags: readonly BackendDataTag[], intervalMs: number, priority: GameStatePriority): () => void {
    const owner = Symbol(name);
    const existing = this.pollers.get(name);
    if (existing) {
      existing.leases.set(owner, { intervalMs, priority, tags: [...tags] });
      this.reconfigurePolling(existing);
      return () => this.releasePolling(name, owner);
    }
    const poller: ManagedPoller = {
      // Replaced immediately below by the effective lease configuration.
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      leases: new Map([[owner, { intervalMs, priority, tags: [...tags] }]]),
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

  /** Public landing data has one store-owned refresh policy and SSE bridge. */
  startLandingFeedPolling(): () => void {
    return this.startPolling("landing-active-missions", ["kind:landing-active-missions"], 60_000, "background");
  }

  startLandingAlliancePolling(): () => void {
    return this.startPolling("landing-highscores", ["kind:landing-highscores"], 300_000, "background");
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

  scheduleRefresh(name: string, tags: readonly BackendDataTag[], delayMs: number, priority: GameStatePriority): () => void {
    this.cancelScheduledRefresh(name);
    this.scheduledRefreshes.set(
      name,
      setTimeout(() => {
        this.scheduledRefreshes.delete(name);
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          this.deferHiddenRefresh(tags, priority);
          return;
        }
        void this.invalidate(tags, { activeOnly: true, priority });
      }, delayMs),
    );
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
        this.commitBackendSnapshot("chain-sync-health", Boolean(payload.connected && payload.subscribedToHeads && payload.subscribedToLogs), [wallet], { wallet });
      } catch {
        this.commitBackendSnapshot("chain-sync-health", false, [wallet], {
          wallet,
        });
      }
    };
    const onChainEvent = (event: MessageEvent) => {
      const tags: BackendDataTag[] = [
        `wallet:${wallet.toLowerCase()}`,
        "kind:attack-protection",
        "kind:fleet-visibility",
        "kind:global-active-missions",
        "kind:global-mission-archive",
        "kind:battle-reports",
        "kind:highscores",
        "kind:landing-active-missions",
        "kind:landing-highscores",
        "kind:player-highscore",
        "kind:raid-finder-debris",
        "kind:raid-finder-rifters",
        "kind:system",
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
    events.onerror = () =>
      this.commitBackendSnapshot("chain-sync-health", false, [wallet], {
        wallet,
      });
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

  setContext(wallet?: string, planetId?: string): void {
    const nextWallet = wallet?.toLowerCase();
    if (nextWallet === this.contextWallet) return;
    const previousWallet = this.contextWallet;
    this.contextWallet = nextWallet;

    // An API-base store survives account switching. Retaining wallet A's
    // canonical entries after moving to wallet B wastes the unbounded dynamic
    // cache and makes accidental old-account projections possible. Clear only
    // wallet-scoped entries; public/global feeds remain shared and an older
    // in-flight wallet response is generation-blocked by `clear`.
    if (!previousWallet) return;
    const walletTag: BackendDataTag = `wallet:${previousWallet}`;
    for (const resource of [...this.resources.values()]) {
      if (!resource.tags.has(walletTag)) continue;
      this.cancelEviction(resource.key);
      this.resources.delete(resource.key);
      this.trailingInvalidations.delete(resource.key);
      this.trailingInvalidationSettlements.delete(resource.key);
      const trailing = this.trailingInvalidationTimers.get(resource.key);
      if (trailing !== undefined) clearTimeout(trailing);
      this.trailingInvalidationTimers.delete(resource.key);
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

  writeTransactionKey(key?: string, wallet?: string): string {
    return cacheKey("write-transaction", wallet?.toLowerCase() ?? "global", key ?? "global");
  }

  private publishWriteTransactionState(state: WriteTransactionState, walletScope = "global"): void {
    // Write status is UI state, but it is still scoped to the initiating
    // wallet.  Without this metadata `clearWallet()` cannot retire a
    // confirmed/failed action from a previous account after an account switch.
    const options = walletScope === "global" ? undefined : { wallet: walletScope };
    this.state.publish(this.writeTransactionKey(undefined, walletScope), state, options);
    if (state.key) this.state.publish(this.writeTransactionKey(state.key, walletScope), state, options);
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

  private createIndexingPlan(run: IndexingPlanRunner): BackendIndexingPlan {
    const plan = {} as BackendIndexingPlan;
    this.indexingPlanRunners.set(plan as object, run);
    return plan;
  }

  private async refreshIndexedTags(tags: readonly BackendDataTag[]): Promise<void> {
    if (tags.length === 0) return;
    const results = await this.invalidate(tags, {
      activeOnly: false,
      priority: "transaction",
    });
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) throw rejected.reason;
  }

  async runWriteTransaction(descriptor: BackendWriteTransactionDescriptor): Promise<boolean> {
    const { indexing, invalidateTags, ...transaction } = descriptor;
    const indexingRunner = indexing ? this.indexingPlanRunners.get(indexing as object) : undefined;
    if (indexing && !indexingRunner) {
      throw new Error("The write supplied an indexing plan from a different data store.");
    }
    const walletScope = this.transactionWalletScope(descriptor.invalidateTags);
    const completed = await executeWriteTransaction(this.transactionGateFor(walletScope), {
      ...transaction,
      ...(indexingRunner
        ? {
            waitForIndexed: async (receipt, txHash) => {
              return indexingRunner(receipt, txHash);
            },
          }
        : {}),
      onStateChange: (state) => {
        this.publishWriteTransactionState(state, walletScope);
        descriptor.onStateChange?.(state);
      },
      onConfirmedIndexingFailure: async () => {
        // The chain receipt is final even though the backend has not yet
        // published a matching snapshot. Invalidate every affected resource
        // and force an indexed re-read; this preserves the error state while
        // ensuring no planet can keep displaying the pre-write value as fresh.
        if (invalidateTags && invalidateTags.length > 0) {
          await this.invalidate(invalidateTags, {
            activeOnly: false,
            priority: "transaction",
          });
        }
      },
    });
    if (completed && invalidateTags && invalidateTags.length > 0) {
      await this.invalidate(invalidateTags, {
        activeOnly: true,
        priority: "transaction",
      });
    }
    return completed;
  }

  async runExclusiveTransaction<T>(key: string, label: string, action: () => Promise<T>, wallet?: string): Promise<T | undefined> {
    const walletScope = wallet?.toLowerCase() ?? "global";
    return this.transactionGateFor(walletScope).run(key, async () => {
      this.publishWriteTransactionState({
        key,
        label,
        phase: "pending",
        stage: "wallet",
      }, walletScope);
      try {
        const result = await action();
        this.publishWriteTransactionState({
          key,
          label,
          phase: "success",
          stage: "applied",
        }, walletScope);
        return result;
      } catch (error) {
        this.publishWriteTransactionState({
          error,
          key,
          label,
          phase: "error",
          stage: "failed",
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

  /**
   * Polls only indexed API reads until a caller-provided indexed predicate is
   * true. Reconciliation itself remains exclusively backend-owned; this is
   * merely one shared way for mutations to observe its published result.
   */
  async waitForIndexed<T>(load: () => Promise<T>, indexed: (value: T) => boolean, options: IndexedReadWaitOptions = {}): Promise<T> {
    const attempts = options.attempts ?? 12;
    const intervalMs = options.intervalMs ?? 1_000;
    const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = await load();
      if (indexed(value)) return value;
      if (attempt < attempts - 1) await delay(intervalMs);
    }
    throw new Error(options.timeoutError ?? "Timed out waiting for indexed state.");
  }

  /**
   * Wait for a backend-published resource snapshot after a confirmed write.
   * This deliberately does not perform reconciliation in the browser: each
   * read is an ordinary indexed API read and the backend decides when it is
   * safe to serve the transaction's state.
   */
  waitForIndexedResource<T extends { resourceSnapshot?: unknown }>(load: () => Promise<T>, expectation: ResourceIndexingExpectation, options: IndexedReadWaitOptions = {}): Promise<T> {
    return this.waitForIndexed(load, (state) => isResourceSnapshotIndexedAfterTransaction(state.resourceSnapshot as Parameters<typeof isResourceSnapshotIndexedAfterTransaction>[0], expectation), {
      ...options,
      timeoutError: options.timeoutError ?? "The confirmed resource change is still syncing with the game API.",
    });
  }

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
    const key = cacheKey(kind, ...parts);
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

  /**
   * Publish an action-level failure into the canonical lifecycle instead of
   * retaining a shell-local error state. Clearing it restores the latest
   * canonical snapshot's normal freshness state.
   */
  setSnapshotError(kind: string, error: string | undefined, parts: unknown[] = []): void {
    this.markBackendFailure(kind, error, parts);
  }

  /** Remove a canonical snapshot only when its source is no longer applicable. */
  private discardBackendSnapshot(kind: string, ...parts: unknown[]): void {
    this.state.clear(cacheKey(kind, ...parts));
  }

  private scheduleEviction(key: string): void {
    if (this.state.subscriberCount(key) > 0 || this.evictionTimers.has(key)) return;
    this.evictionTimers.set(
      key,
      setTimeout(() => {
        this.evictionTimers.delete(key);
        if (!this.state.forget(key)) return;
        this.resources.delete(key);
        this.trailingInvalidations.delete(key);
        this.trailingInvalidationSettlements.delete(key);
        const trailing = this.trailingInvalidationTimers.get(key);
        if (trailing !== undefined) clearTimeout(trailing);
        this.trailingInvalidationTimers.delete(key);
      }, this.inactiveResourceRetentionMs),
    );
  }

  private cancelEviction(key: string): void {
    const timer = this.evictionTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.evictionTimers.delete(key);
  }

  coordinateRefresh<T>(key: string, priority: GameStatePriority, load: (signal: AbortSignal) => Promise<T>, deadlineMs = 10_000): Promise<T> {
    return this.refresh(cacheKey("coordinated-refresh", key), load, {
      deadlineMs,
      priority,
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
    // A query key fully identifies its loader inputs. Later equivalent reads
    // may provide a newer closure or policy, so update the descriptor without
    // letting a route-local cancellation scope become canonical.
    const descriptor: RegisteredResource = {
      key,
      load: load as (signal: AbortSignal) => Promise<unknown>,
      options: {
        ...options,
        // Scopes belong to individual subscriptions, never to the canonical
        // resource descriptor that SSE/write invalidation refreshes later.
        scope: undefined,
      },
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
    const priority = leases.reduce<GameStatePriority>((effective, lease) => this.higherPriority(effective, lease.priority), "background");
    poller.timer = this.createPollTimer(tags, intervalMs, priority);
  }

  private higherPriority(left: GameStatePriority, right: GameStatePriority): GameStatePriority {
    const priority: Record<GameStatePriority, number> = {
      transaction: 0,
      "selected-planet": 1,
      "mission-control": 2,
      background: 3,
    };
    return priority[left] <= priority[right] ? left : right;
  }

  private deferHiddenRefresh(tags: readonly BackendDataTag[], priority: GameStatePriority): void {
    for (const tag of tags) {
      const current = this.deferredHiddenRefreshes.get(tag);
      this.deferredHiddenRefreshes.set(tag, current ? this.higherPriority(current, priority) : priority);
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (this.deferredHiddenRefreshes.size === 0) return;
    const byPriority = new Map<GameStatePriority, BackendDataTag[]>();
    for (const [tag, priority] of this.deferredHiddenRefreshes) {
      const tags = byPriority.get(priority) ?? [];
      tags.push(tag);
      byPriority.set(priority, tags);
    }
    this.deferredHiddenRefreshes.clear();
    for (const [priority, tags] of byPriority) {
      void this.invalidate(tags, { activeOnly: true, priority });
    }
  };

  private createPollTimer(tags: readonly BackendDataTag[], intervalMs: number, priority: GameStatePriority): ReturnType<typeof setInterval> {
    return setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        this.deferHiddenRefresh(tags, priority);
        return;
      }
      void this.invalidate(tags, { activeOnly: true, priority });
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

  private readRegisteredResource(resource: RegisteredResource, options: BackendDataRefreshOptions, dedupe: boolean): Promise<unknown> {
    const read = this.state.read(resource.key, resource.load, {
      ...resource.options,
      dedupe,
      priority: options.priority ?? resource.options.priority,
      // Invalidation is store-owned and must not be cancelled when a route
      // unmounts or a selected planet changes.
      scope: `backend-data:${resource.key}`,
    });
    void read.then(
      () => this.flushTrailingInvalidation(resource.key),
      () => this.flushTrailingInvalidation(resource.key),
    );
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
    void this.readRegisteredResource(resource, { priority: "transaction" }, false).catch(() => {
      // The canonical resource snapshot keeps last-good data and its normal
      // failure state. A later poll/manual retry can recover transient errors.
    });
  }

  /** Canonical resource promotion lives beside the backend cache, never in a page. */
  promoteResourceState(
    state: BackendResourceState | null | undefined,
    options: {
      bodyKind?: "moon" | "planet";
      confirmedTransaction?: boolean;
      planetId?: string | null | undefined;
      requestGeneration?: number | undefined;
      sourcePriority?: number | undefined;
      wallet?: string | null | undefined;
    } = {},
  ): CanonicalPlanetResourceSnapshot | undefined {
    const candidate = backendResourceSnapshot(state, {
      ...(options.bodyKind === undefined ? {} : { bodyKind: options.bodyKind }),
      ...(options.planetId === undefined ? {} : { planetId: options.planetId }),
      ...(options.sourcePriority === undefined ? {} : { sourcePriority: options.sourcePriority }),
      ...(options.requestGeneration === undefined ? {} : { requestGeneration: options.requestGeneration }),
      ...(options.wallet ? { wallet: options.wallet } : {}),
    });
    const wallet = options.wallet?.toLowerCase() ?? candidate?.wallet?.toLowerCase();
    if (!candidate || !wallet) return candidate;
    const current = this.value<CanonicalPlanetResourceStore>("canonical-planet-resources", wallet) ?? {};
    const next = promoteCanonicalPlanetResources(current, candidate, {
      ...(options.confirmedTransaction === undefined ? {} : { confirmedTransaction: options.confirmedTransaction }),
    });
    if (next !== current)
      this.commitBackendSnapshot("canonical-planet-resources", next, [wallet], {
        wallet,
      });
    return candidate;
  }

  private planetResourceReadGeneration(wallet: string, planetId: string | undefined, bodyKind: "planet" | "moon", resourceKey: string, forceNewRead: boolean): number | undefined {
    if (!planetId) return undefined;
    const identity = `${wallet.toLowerCase()}:${bodyKind}:${planetId}`;
    const existing = this.planetResourceReadGenerations.get(identity) ?? 0;
    // A deduplicated caller is joining the already-started transport, not
    // starting a newer cross-endpoint read. Reuse its generation so that
    // ordinary query sharing cannot invalidate its own response.
    if (!forceNewRead && this.state.hasInFlight(resourceKey)) return existing;
    const next = existing + 1;
    this.planetResourceReadGenerations.set(identity, next);
    return next;
  }

  promoteWalletPlanetResources(wallet: string, planets: readonly WalletPlanetsResponse["planets"][number][]): void {
    for (const planet of planets) {
      this.promoteResourceState(planet, {
        planetId: planet.planetId,
        sourcePriority: 10,
        wallet,
      });
      if (planet.moon?.exists) {
        this.promoteResourceState(planet.moon, {
          bodyKind: "moon",
          planetId: planet.planetId,
          sourcePriority: 10,
          wallet,
        });
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
      this.promoteResourceState(state.planet, {
        planetId: state.homePlanetId,
        sourcePriority: 20,
        wallet,
      });
      return state;
    });
  }

  overview(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<WalletOverviewSnapshotResponse> {
    const key = cacheKey("overview", wallet, planetId);
    // `fresh` means bypass the short-lived value cache, not send duplicate identical requests when
    // the Overview, top bar, and selected-planet surface refresh in the same render turn.
    return this.refresh(
      key,
      (signal) =>
        fetchWalletOverviewSnapshot(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    ).then((snapshot) => {
      // Overview is a backend-produced aggregate of the same indexed state
      // exposed by these individual queries. Fan it out here, at the data
      // boundary, so shells never need to publish their own copies merely to
      // hydrate the planet picker after one aggregate read. An older overview
      // transport can resolve after a newer generation; only the aggregate
      // value currently accepted by GameStateStore may fan out into those
      // other canonical keys.
      if (this.value<WalletOverviewSnapshotResponse>("overview", wallet, planetId) === snapshot) {
        this.publishOverviewSnapshot(wallet, planetId, snapshot);
      }
      return snapshot;
    });
  }

  private publishOverviewSnapshot(wallet: string, planetId: string | undefined, snapshot: WalletOverviewSnapshotResponse): void {
    const normalizedWallet = wallet.toLowerCase();
    this.commitBackendSnapshot("planets", snapshot.planetsResponse, [wallet], {
      wallet,
    });
    this.commitBackendSnapshot("settlement", snapshot.settlement, [wallet], {
      wallet,
    });
    this.commitBackendSnapshot("queues", snapshot.queues, [wallet, planetId], {
      planetId,
      wallet,
    });
    this.commitBackendSnapshot("fleet-visibility", snapshot.fleetVisibility, [wallet, false], { wallet });
    this.promoteWalletPlanetResources(normalizedWallet, snapshot.planetsResponse.planets);
    this.promoteResourceState(snapshot.settlement.planet, {
      planetId: snapshot.settlement.homePlanetId,
      sourcePriority: 20,
      wallet: normalizedWallet,
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
    const key = cacheKey("watched-planets", wallet, {
      page: options.page,
      pageSize: options.pageSize,
    });
    return this.refresh(key, (signal) => fetchWatchedPlanets(this.apiBaseUrl, wallet, { ...options, signal }), {
      deadlineMs: options.timeoutMs ?? 25_000,
      priority: "background",
      wallet,
    });
  }

  queues(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<PlayerQueuesResponse> {
    const key = cacheKey("queues", wallet, planetId);
    return this.refresh(
      key,
      (signal) =>
        fetchWalletQueues(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: options.priority ?? "selected-planet",
        wallet,
      },
    );
  }

  infrastructure(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainInfrastructureState> {
    const key = cacheKey("infrastructure", wallet, planetId);
    const requestGeneration = this.planetResourceReadGeneration(wallet, planetId, "planet", key, options.fresh === true);
    return this.refresh(
      key,
      (signal) =>
        fetchInfrastructureState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    ).then((state) => {
      this.promoteResourceState(state, {
        planetId,
        requestGeneration,
        wallet,
      });
      return state;
    });
  }

  moon(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainMoonState> {
    const key = cacheKey("moon", wallet, planetId);
    const requestGeneration = this.planetResourceReadGeneration(wallet, planetId, "moon", key, options.fresh === true);
    return this.refresh(
      key,
      (signal) =>
        fetchMoonState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    ).then((state) => {
      this.promoteResourceState(state, {
        bodyKind: "moon",
        planetId,
        requestGeneration,
        wallet,
      });
      return state;
    });
  }

  shipyard(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainShipyardState> {
    const key = cacheKey("shipyard", wallet, planetId);
    const requestGeneration = this.planetResourceReadGeneration(wallet, planetId, "planet", key, options.fresh === true);
    return this.refresh(
      key,
      (signal) =>
        fetchShipyardState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    ).then((state) => {
      this.promoteResourceState(state, {
        planetId,
        requestGeneration,
        wallet,
      });
      return state;
    });
  }

  defenses(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
    const key = cacheKey("defenses", wallet, planetId);
    const requestGeneration = this.planetResourceReadGeneration(wallet, planetId, "planet", key, options.fresh === true);
    return this.refresh(
      key,
      (signal) =>
        fetchDefenseState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: options.priority ?? "selected-planet",
        wallet,
      },
    ).then((state) => {
      this.promoteResourceState(state, {
        planetId,
        requestGeneration,
        wallet,
      });
      return state;
    });
  }

  /**
   * The authoritative post-write refresh for defense production. It polls and
   * publishes the same defense and queue entries consumed by every screen, so
   * transaction feedback cannot drift from a separately managed component
   * snapshot.
   */
  waitForStartedDefenseProduction(wallet: string, expectation: StartedDefenseProductionExpectation): Promise<StartedDefenseProductionSnapshot> {
    return waitForStartedDefenseProductionState(async () => {
      const [defense, queues] = await Promise.all([
        this.defenses(wallet, expectation.planetId, {
          fresh: true,
          priority: "transaction",
        }),
        this.queues(wallet, expectation.planetId, {
          fresh: true,
          priority: "transaction",
        }),
      ]);
      return { defense, queues };
    }, expectation);
  }

  research(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
    const key = cacheKey("research", wallet, planetId);
    const requestGeneration = this.planetResourceReadGeneration(wallet, planetId, "planet", key, options.fresh === true);
    return this.refresh(
      key,
      (signal) =>
        fetchResearchState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    ).then((state) => {
      this.promoteResourceState(state, {
        planetId,
        requestGeneration,
        wallet,
      });
      return state;
    });
  }

  rift(wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainRiftState> {
    const key = cacheKey("rift", wallet, planetId);
    return this.refresh(
      key,
      (signal) =>
        fetchRiftState(this.apiBaseUrl, wallet, planetId, {
          ...options,
          signal,
        }),
      {
        deadlineMs: options.timeoutMs,
        planetId,
        priority: "selected-planet",
        wallet,
      },
    );
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
    return this.refresh(key, (signal) => fetchPlayerProfile(this.apiBaseUrl, wallet, { signal }), { wallet });
  }

  settlementFunding(wallet: string): Promise<SettlementFundingState> {
    const key = cacheKey("settlement-funding", wallet);
    return this.refresh(key, (signal) => fetchSettlementFundingState(this.apiBaseUrl, wallet, signal), { wallet });
  }

  /** Store-owned projection for settlement funding. Backend funding and the
   * wallet's chain-only balance/reservation are committed under one canonical
   * identity so an old provider/network result cannot overwrite a newer
   * wallet session in the settlement UI. */
  settlementFundingForProvider(
    wallet: string,
    provider: Eip1193Provider,
    migrationAddress: string | undefined,
    providerIdentity: string | undefined,
  ): Promise<SettlementFundingState> {
    const key = cacheKey("settlement-funding-projection", wallet, migrationAddress, providerIdentity);
    return this.refresh(
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
        priority: "selected-planet",
        wallet,
      },
    );
  }

  referralDashboard(wallet: string): Promise<ReferralDashboard> {
    const key = cacheKey("referral-dashboard", wallet);
    return this.refresh(key, (signal) => fetchReferralDashboard(this.apiBaseUrl, wallet, signal), { wallet });
  }

  referralHistory(wallet: string, page = 1, pageSize = 25): Promise<ReferralHistoryResponse> {
    const key = cacheKey("referral-history", wallet, page, pageSize);
    return this.refresh(key, (signal) => fetchReferralHistory(this.apiBaseUrl, wallet, page, pageSize, signal), { wallet });
  }

  referralCodeInspection(wallet: string, code: string): Promise<ReferralResolution> {
    const key = cacheKey("referral-code-inspection", wallet, code);
    return this.refresh(
      key,
      (signal) => {
        // The adapter does not yet accept AbortSignal, but this remains a
        // canonical store-owned request with generation/failure handling.
        void signal;
        return inspectReferralCode(this.apiBaseUrl, code, wallet);
      },
      { wallet },
    );
  }

  referralCodeValidation(code: string, invitee?: string): Promise<ReferralResolution> {
    const key = cacheKey("referral-code-validation", code, invitee);
    return this.refresh(
      key,
      (signal) => {
        void signal;
        return validateReferralCode(this.apiBaseUrl, code, invitee);
      },
      invitee ? { wallet: invitee } : {},
    );
  }

  paidAllianceInviteResolution(secret: string): Promise<PaidAllianceInviteResolution> {
    const key = cacheKey("paid-alliance-invite-resolution", secret);
    return this.refresh(key, (signal) => {
      void signal;
      return resolvePaidAllianceInvite(this.apiBaseUrl, secret);
    });
  }

  playerActivity(
    wallet: string,
    options: {
      includeProjected?: boolean;
      page?: number;
      pageSize?: number;
      since?: number;
    } = {},
  ): Promise<PlayerActivityResponse> {
    const key = cacheKey("player-activity", wallet, options);
    return this.refresh(key, (signal) => fetchPlayerActivity(this.apiBaseUrl, wallet, { ...options, signal }), { wallet });
  }

  recordPlayerActivityPresence(wallet: string): Promise<PlayerActivityPresence> {
    return recordPlayerActivityPresence(this.apiBaseUrl, wallet);
  }

  /**
   * Atomically advances the shared server watermark and returns an away window
   * at most once for this wallet in this browser session. Retried background
   * heartbeats intentionally never become dialog claims.
   */
  claimPlayerActivityAwayWindow(wallet: string): Promise<PlayerActivityPresence | null> {
    const normalizedWallet = wallet.toLowerCase();
    const existing = this.activityPresenceClaims.get(normalizedWallet);
    if (existing?.status === "consumed") return Promise.resolve(null);
    if (existing?.status === "pending") return existing.promise;

    const promise = this.recordPlayerActivityPresence(wallet).then((presence) => {
      this.activityPresenceClaims.set(normalizedWallet, { status: "consumed" });
      return presence;
    }).catch((error: unknown) => {
      const current = this.activityPresenceClaims.get(normalizedWallet);
      if (current?.status === "pending" && current.promise === promise) {
        this.activityPresenceClaims.delete(normalizedWallet);
      }
      throw error;
    });
    this.activityPresenceClaims.set(normalizedWallet, { promise, status: "pending" });
    return promise;
  }

  recordPlayerActivityPresenceOnExit(wallet: string): void {
    const url = playerActivityPresenceUrl(this.apiBaseUrl, wallet);
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, "")) return;
    void fetch(url, { keepalive: true, method: "POST" }).catch(() => {});
  }

  highscores(options: FetchHighscoreOptions | number = 100): Promise<HighscoreResponse> {
    const normalizedOptions = options;
    const key = cacheKey("highscores", normalizedOptions);
    return this.refresh(key, (signal) => fetchHighscores(this.apiBaseUrl, typeof normalizedOptions === "number" ? normalizedOptions : { ...normalizedOptions, signal }), {
      priority: "background",
      ...(typeof normalizedOptions === "number" || !normalizedOptions.currentWallet ? {} : { wallet: normalizedOptions.currentWallet }),
    });
  }

  playerHighscore(wallet: string): Promise<HighscoreEntry | null> {
    const key = cacheKey("player-highscore", wallet);
    return this.refresh(key, (signal) => fetchPlayerHighscore(this.apiBaseUrl, wallet, signal), { wallet });
  }

  raidFinderDebris(options: { limit?: number } = {}): Promise<RaidFinderDebrisResponse> {
    const key = cacheKey("raid-finder-debris", options);
    return this.refresh(key, (signal) => fetchRaidFinderDebrisTargets(this.apiBaseUrl, { ...options, signal }), {
      priority: "background",
    });
  }

  raidFinderRifters(options: { limit?: number } = {}): Promise<RaidFinderRiftersResponse> {
    const key = cacheKey("raid-finder-rifters", options);
    return this.refresh(key, (signal) => fetchRaidFinderRifters(this.apiBaseUrl, { ...options, signal }), {
      priority: "background",
    });
  }

  system<T = unknown>(galaxy: number, system: number, options: { detail?: "full" } = {}): Promise<T> {
    const key = cacheKey("system", galaxy, system, options);
    return this.refresh(
      key,
      (signal) =>
        fetchSystemData(this.apiBaseUrl, galaxy, system, {
          ...options,
          signal,
        }) as Promise<T>,
      {
        priority: "background",
      },
    );
  }

  randomnessReadiness<T = unknown>(): Promise<T> {
    const key = cacheKey("randomness-readiness");
    return this.refresh(key, async (signal) => {
      const response = await fetch(`${this.apiBaseUrl}/randomness-readiness`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      const payload = (await response.json()) as T & { reasons?: unknown };
      if (!response.ok) {
        const reason = Array.isArray(payload.reasons) && typeof payload.reasons[0] === "string" ? payload.reasons[0] : `Randomness readiness API failed: ${response.status}`;
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

  attackProtection(wallet: string, targetPlanetId: string, targetIsMoon = false, options: WalletReadOptions = {}): Promise<AttackProtectionStatus> {
    const key = cacheKey("attack-protection", wallet, targetPlanetId, targetIsMoon);
    return this.refresh(key, (signal) => fetchAttackProtectionStatus(this.apiBaseUrl, wallet, targetPlanetId, targetIsMoon, signal), {
      dedupe: !options.fresh,
      deadlineMs: options.timeoutMs,
      planetId: targetPlanetId,
      priority: options.priority ?? "transaction",
      wallet,
    });
  }

  fleetVisibility(wallet: string, options: FleetMissionVisibilityOptions = {}): Promise<FleetMissionVisibilityResponse> {
    const key = cacheKey("fleet-visibility", wallet, options.includeArchive);
    return this.refresh(
      key,
      (signal) =>
        fetchFleetMissionVisibility(this.apiBaseUrl, wallet, {
          ...options,
          signal,
        }),
      {
        dedupe: !options.fresh,
        deadlineMs: options.timeoutMs,
        priority: "mission-control",
        wallet,
      },
    );
  }

  fleetArchive(wallet: string, options: FleetMissionArchiveOptions = {}): Promise<FleetMissionArchiveResponse> {
    const key = cacheKey("fleet-archive", wallet, options);
    return this.refresh(
      key,
      (signal) =>
        fetchFleetMissionArchive(this.apiBaseUrl, wallet, {
          ...options,
          signal,
        }),
      {
        planetId: options.planetId,
        priority: "mission-control",
        wallet,
      },
    );
  }

  missileArchive(wallet: string, options: { page?: number; pageSize?: number; planetId?: string } = {}): Promise<MissileAttackArchiveResponse> {
    const key = cacheKey("missile-archive", wallet, options);
    return this.refresh(
      key,
      (signal) =>
        fetchMissileAttackArchive(this.apiBaseUrl, wallet, {
          ...options,
          signal,
        }),
      {
        planetId: options.planetId,
        priority: "mission-control",
        wallet,
      },
    );
  }

  globalActiveMissions(): Promise<GlobalActiveMissionsResponse> {
    const key = cacheKey("global-active-missions");
    return this.refresh(key, (signal) => fetchGlobalActiveMissions(this.apiBaseUrl, signal), {
      priority: "mission-control",
    });
  }

  landingActiveMissions<T>(): Promise<T[]> {
    const key = cacheKey("landing-active-missions");
    return this.refresh(
      key,
      async (signal) => {
        const response = await fetch(`${this.apiBaseUrl}/missions?status=active&live=1`, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal,
        });
        if (!response.ok) throw new Error("Failed to load landing missions");
        const data = (await response.json()) as { missions?: T[] };
        return data.missions ?? [];
      },
      { priority: "background" },
    );
  }

  landingHighscores<T>(): Promise<T[]> {
    const key = cacheKey("landing-highscores");
    return this.refresh(
      key,
      async (signal) => {
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
        const data = (await response.json()) as { rankings?: { total?: T[] } };
        return data.rankings?.total ?? [];
      },
      { priority: "background" },
    );
  }

  globalMissionArchive(options: GlobalMissionArchiveOptions = {}): Promise<GlobalMissionArchiveResponse> {
    const key = cacheKey("global-mission-archive", options);
    return this.refresh(key, (signal) => fetchGlobalMissionArchive(this.apiBaseUrl, { ...options, signal }), {
      priority: "mission-control",
    });
  }

  mission(missionId: string): Promise<MissionDetailResponse> {
    const key = cacheKey("mission", missionId);
    return this.refresh(key, (signal) => fetchMission(this.apiBaseUrl, missionId, signal), {
      priority: "mission-control",
    });
  }

  battleReports(): Promise<BattleReport[]> {
    const key = cacheKey("battle-reports");
    return this.refresh(key, (signal) => fetchBattleReports(this.apiBaseUrl, signal), {
      priority: "mission-control",
    });
  }

  entityMedia(entityKind: EntityMediaKind, entityId: string): Promise<EntityMediaResponse> {
    const key = cacheKey("entity-media", entityKind, entityId);
    return this.refresh(key, (signal) => fetchEntityMedia(this.apiBaseUrl, entityKind, entityId, signal), {});
  }

  async saveEntityMedia(provider: Eip1193Provider, wallet: string, entityKind: EntityMediaKind, entityId: string, mediaUrl: string): Promise<EntityMediaResponse> {
    const response = await this.runExclusiveTransaction(
      `entity-media:${entityKind}:${normalizeEntityMediaId(entityKind, entityId)}`,
      "Save media",
      () => updateEntityMedia(this.apiBaseUrl, provider, wallet, entityKind, entityId, mediaUrl),
      wallet,
    );
    if (!response) throw new Error("Another game action is already in progress.");
    this.commitBackendSnapshot("entity-media", response, [entityKind, entityId]);
    await this.invalidate([`kind:entity-media`], {
      activeOnly: true,
      priority: "transaction",
    });
    return response;
  }

  /**
   * Watch mutations are signed backend writes, not contract transactions. They
   * still use the shared mutation gate and invalidate every subscribed watched
   * view instead of patching one component's local page in place.
   */
  async setPlanetWatched(provider: Eip1193Provider, wallet: string, planetId: string, watched: boolean): Promise<WatchPlanetMutationResponse> {
    const response = await this.runExclusiveTransaction(
      `watched-planet:${wallet.toLowerCase()}:${planetId}`,
      watched ? "Unwatch planet" : "Watch planet",
      () => watched ? unwatchPlanet(this.apiBaseUrl, provider, wallet, planetId) : watchPlanet(this.apiBaseUrl, provider, wallet, planetId),
      wallet,
    );
    if (!response) throw new Error("Another game action is already in progress.");
    await this.invalidate([`wallet:${wallet.toLowerCase()}`, "kind:watched-planets"], { activeOnly: true, priority: "transaction" });
    return response;
  }

  /** Signed profile updates share the store-owned mutation gate and refresh policy. */
  async savePlayerProfile(provider: Eip1193Provider, wallet: string, displayName: string, description: string | null): Promise<PlayerProfile> {
    const profile = await this.runExclusiveTransaction(
      `profile:${wallet.toLowerCase()}`,
      "Save profile",
      () => updatePlayerProfile(this.apiBaseUrl, provider, wallet, displayName, description),
      wallet,
    );
    if (!profile) throw new Error("Another game action is already in progress.");
    this.commitBackendSnapshot("profile", profile, [wallet], { wallet });
    await this.invalidate([`wallet:${wallet.toLowerCase()}`, "kind:profile", "kind:settlement", "kind:alliance"], { activeOnly: true, priority: "transaction" });
    return profile;
  }

  /** Record a confirmed referral redemption and invalidate shared referral views. */
  async recordReferralRedemption(code: string, invitee: string, txHash: string): Promise<void> {
    await recordReferralRedemptionTransaction(this.apiBaseUrl, code, invitee, txHash);
    await this.invalidate([`wallet:${invitee.toLowerCase()}`, "kind:referral-dashboard", "kind:referral-history"], { activeOnly: true, priority: "transaction" });
  }

  /** Persist signed referral-claim recovery data through the shared mutation boundary. */
  async persistReferralClaimIntent(wallet: string, code: string, commitment: string, signature: string): Promise<void> {
    await persistReferralClaimIntent(this.apiBaseUrl, wallet, code, commitment, signature);
  }

  /**
   * The claim contract event is indexed asynchronously. Keep its retry and
   * reconciliation policy here so settlement UI never owns a second polling
   * lifecycle. All reads are backend API reads; this does not reconcile chain
   * state in the browser.
   */
  async recordReferralClaimAfterIndexing(wallet: string, code: string, commitment: string, txHash: string, signature: string): Promise<ReferralDashboard> {
    const attempts = 12;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const dashboard = await recordReferralClaimTransaction(this.apiBaseUrl, wallet, code, commitment, txHash, signature);
        this.commitBackendSnapshot("referral-dashboard", dashboard, [wallet], { wallet });
        await this.invalidate([`wallet:${wallet.toLowerCase()}`, "kind:referral-dashboard", "kind:referral-history"], { activeOnly: true, priority: "transaction" });
        return dashboard;
      } catch (error) {
        if (!isReferralClaimIndexingLag(error) || attempt === attempts - 1) throw error;
        try {
          const current = await inspectReferralCode(this.apiBaseUrl, code, wallet);
          if (current.ownership === "reserved") throw new Error(REFERRAL_CODE_FRONT_RUN_MESSAGE);
        } catch (inspectionError) {
          if (inspectionError instanceof Error && inspectionError.message === REFERRAL_CODE_FRONT_RUN_MESSAGE) {
            throw inspectionError;
          }
          // Preserve the original unconfirmed-transaction error while the
          // backend is temporarily unavailable or catching up.
        }
        await waitForBackendIndexing(2_500);
      }
    }
    throw new Error("Referral claim indexing did not return a dashboard.");
  }

  burningChicken(owner: string, tokenId: string, config: BurningChickenConfig): Promise<unknown> {
    const key = cacheKey("burning-chicken", owner, tokenId, config.nftContractAddress);
    return this.refresh(key, (signal) => fetchBurningChickenForOwner(owner, tokenId, config, signal));
  }
}

export function createBackendDataStore(apiBaseUrl: string): BackendDataStore {
  return new BackendDataStore(apiBaseUrl.replace(/\/+$/, ""));
}

function isReferralClaimIndexingLag(error: unknown): boolean {
  return /referral claim transaction is not indexed|referral_claim_unconfirmed/i.test(error instanceof Error ? error.message : String(error));
}

function waitForBackendIndexing(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
