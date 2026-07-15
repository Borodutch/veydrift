import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildingIds,
  defenseIds,
  allianceRoleIds,
  shipIds,
  technologyIds
} from "./contractStateSchema";
import type { FleetDefenseUnitCount } from "./fleetDefenseParity";
import {
  attachAttackGroupParticipants,
  decodeAllianceLog,
  decodeAttackMissionLaunch,
  decodeBattleReportLogs,
  decodeBattleReports,
  decodeCompleteFleetMissionLogs,
  decodeDebrisFieldLog,
  decodeIndexedQueueCompletedLog,
  decodeIndexedQueueStartedLog,
  decodeInterplanetaryMissileAttackLog,
  decodeMoonDefenseCountChangedLog,
  decodeMoonCreatedLog,
  decodeMoonChanceReportLog,
  decodeMoonJumpGateLog,
  decodeMoonResourcesSettledLog,
  decodeMoonShipCountChangedLog,
  decodeMoonResourcesChangedLog,
  decodePlanetSettledLog,
  decodePlanetRenamedLog,
  decodeFleetMissionLogs,
  decodeRandomnessFulfilledRequestId,
  decodeReferralClaimLog,
  decodeReferralRedemptionLog,
  decodeReferralRewardClaimLog,
  decodeStartPriceUpdatedLog,
  decodeRiftResourceLog,
  decodeSettledPlanetLog,
  decodeShipCountChangedLog,
  decodeDefenseCountChangedLog,
  fleetMissionNeedsResolution,
  missionBattleRandomnessRequestId,
  isDebrisFieldLog,
  isRandomnessFulfilledLog,
  isBattleReportLog,
  isFleetMissionLog,
  isIndexedQueueCompletedLog,
  isIndexedQueueStartedLog,
  isInterplanetaryMissileAttackLog,
  isAllianceLog,
  isMoonCreatedLog,
  isMoonJumpGateLog,
  isMoonResourcesChangedLog,
  isMoonChanceReportLog,
  isMoonDefenseCountChangedLog,
  isMoonResourcesSettledLog,
  isMoonShipCountChangedLog,
  isPlanetSettledLog,
  isPlanetRenamedLog,
  isReferralClaimLog,
  isReferralRedemptionLog,
  isReferralRewardClaimLog,
  isStartPriceUpdatedLog,
  isRiftResourceLog,
  isSettledPlanetLog,
  isShipCountChangedLog,
  isDefenseCountChangedLog,
  type ChainReader,
  type Address,
  type AllianceIdentity,
  type AllianceState,
  type AllianceJoinRequestSnapshot,
  type AllianceInviteSnapshot,
  type AllianceDiplomacySnapshot,
  type CanonicalPlanetChainState,
  type CanonicalFleetMissionSnapshot,
  type BattleReport,
  type BattleReportDefenderSnapshot,
  type DebrisFieldEvent,
  type DefenseState,
  type FleetMissionPlanetReference,
  type FleetMissionVisibility,
  type FleetMissionSummary,
  type StationedDefenderSummary,
  type IndexedQueueCompletedEvent,
  type IndexedQueueStartedEvent,
  type IndexedReferralClaimEvent,
  type IndexedReferralRedemptionEvent,
  type IndexedReferralRewardClaimEvent,
  type IndexedStartPriceUpdatedEvent,
  type IndexedAllianceEvent,
  type IndexedMoonCreatedEvent,
  type IndexedMoonDefenseCountChangedEvent,
  type IndexedMoonJumpGateEvent,
  type IndexedMoonShipCountChangedEvent,
  type IndexedMoonResourcesChangedEvent,
  type IndexedRiftResourceEvent,
  type IndexedShipCountChangedEvent,
  type IndexedDefenseCountChangedEvent,
  type InterplanetaryMissileAttackEvent,
  type InfrastructureState,
  type ManagedPlanet,
  type MoonState,
  type MoonChanceReportEvent,
  type MoonResourcesSettledEvent,
  type PlanetSettledEvent,
  type PlanetRenamedEvent,
  type PlayerQueues,
  type QueueState,
  type ResearchState,
  type Resources,
  riftRequirements,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  type WalletPlanets,
  diplomacyStatusName,
  startPriceUpdatedEventTopic
} from "./evm";
import {
  calculateIndexedHighscore,
  deriveInfrastructureFields,
  deriveBuildingRows,
  deriveDefenseRows,
  deriveShipRows,
  deriveTechnologyRows,
  usedFieldsFromBuildingRows,
  zeroResources
} from "./readModels";
import type { HighscoreEntry } from "./highscores";
import { playerFallbackName, type PlayerProfile } from "./playerProfiles";
import { planetArchetypeForTemperature } from "./universe";
import { nowSeconds, settleQueueAsOfNow, withMissionAsOfNow } from "./asOfNow";
import { emitObservabilityEvent } from "./observability";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;
export type IndexedDebrisTarget = IndexedDebrisFieldEvent & {
  planet: Pick<SettledPlanetEvent, "name" | "owner" | "planetId" | "galaxy" | "system" | "position" | "temperature">;
};
export type IndexedMoonChanceReportEvent = MoonChanceReportEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

type SettledPlanetIndexCache = {
  stateVersion: string;
  planets: SettledPlanetEvent[];
  byId: Map<string, SettledPlanetEvent>;
  byOwner: Map<string, SettledPlanetEvent[]>;
  bySystem: Map<string, SettledPlanetEvent[]>;
};

type TargetedSettledPlanetCache = {
  stateVersion: string;
  byId: Map<string, SettledPlanetEvent | null>;
  byOwner: Map<string, SettledPlanetEvent[]>;
  bySystem: Map<string, SettledPlanetEvent[]>;
};

type PlanetEventResourceRow = {
  event_json: string;
  metal: string | null;
  crystal: string | null;
  deuterium: string | null;
  last_settled_at: string | null;
  transaction_hash: string | null;
  block_number: string | null;
  log_index: string | null;
};

type IndexedLevelsByIdCache = {
  stateVersion: string;
  values: Map<string, Map<number, number>>;
};

type QueueStateCache = {
  stateVersion: string;
  values: Map<string, QueueState | null>;
};

type TechnologyLevelsCache = {
  stateVersion: string;
  values: Map<string, Record<string, number>>;
};

type AllianceIntelCache = {
  stateVersion: string;
  values: Map<string, Map<string, AllianceIdentity>>;
};

export type IndexerSnapshot = {
  allianceReconciledAt: string | null;
  allianceStaleReason: string | null;
  indexedDebrisFields: number;
  indexedEventLogs: number;
  indexedMoonChanceReports: number;
  indexedMoons: number;
  indexedPlanets: number;
  indexedState: "healthy" | "reconciling" | "stale";
  indexedRiftBalances: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
  lastCurrentStateHealAt: string | null;
  currentStateOneTimeHealCompletedAt: string | null;
  lastCurrentStateHealPlanetsScanned: number | null;
  lastCurrentStateHealRunId: string | null;
  lastCurrentStateHealShipMismatches: number | null;
  lastCanonicalFleetMissionSyncAt: string | null;
  lastCanonicalFleetMissionSyncDurationMs: number | null;
  lastCanonicalFleetMissionSyncError: string | null;
  lastCanonicalFleetMissionSyncRows: number | null;
  lastCanonicalFleetMissionSyncUpdatedRows: number | null;
  lastReconciledAt: string | null;
  lastReconciledBlock: string | null;
  lastReconciliationError: string | null;
  currentStateHealInProgress: boolean;
  currentStateHealRunId: string | null;
  latestIndexedBlock: string | null;
  pendingReconciliationReason: string | null;
  reconciliationInProgress: boolean;
  reorgDetectedAt: string | null;
  safeToServeAllianceState: boolean;
  safeToServeIndexedState: boolean;
  staleReason: string | null;
  startPriceBootstrapDivergence: string | null;
  startPriceSource: string | null;
  startPriceWei: string | null;
};

const writerChainSyncDiagnosticsMetadataKey = "writerChainSyncDiagnostics";
const startPriceWeiMetadataKey = "canonicalStartPriceWei";
const startPriceSourceMetadataKey = "canonicalStartPriceSource";
const startPriceBootstrapWeiMetadataKey = "startPriceBootstrapWei";
const startPriceBootstrapDivergenceMetadataKey = "startPriceBootstrapDivergence";
const startPriceBlockMetadataKey = "canonicalStartPriceBlock";
const startPriceLogIndexMetadataKey = "canonicalStartPriceLogIndex";

export type WriterChainSyncDiagnostics = {
  chainSync: unknown | null;
  chainSyncRpc: unknown | null;
  updatedAt: string;
};

const indexedStateVersionMetadataKey = "indexedStateVersion";

export type SettlementIndexerOptions = {
  database?: Database;
  databasePath?: string;
  readOnly?: boolean;
  // Multi-process API workers share one SQLite DB. The writer is the only process that should run
  // startup materialized-state repair/backfill; readers only need the schema and current rows.
  runStartupBackfill?: boolean;
  // Deployment metadata is a cold-start baseline only. StartPriceUpdated events and
  // explicit canonical rebuild reads supersede it in the persisted read model.
  settlementStartPriceWei?: string;
  // VEY-KANEO-471: when true, fleetMissionVisibility appends one synthetic incoming attack with a
  // populated `stationedDefenders` payload so QA can verify the Stationed defenses panel without a
  // real ≥2-wallet on-chain ACS Defend scenario. Sourced from config.qaSyntheticStationedDefenders,
  // which is already hard-gated to non-production. Defaults to false.
  qaSyntheticStationedDefenders?: boolean;
  // VEY-KANEO-479: when true (the randomness engine is configured for this deployment), an arrived
  // Attack's `needsResolution` is gated on its battle randomness being fulfilled — derived from the
  // ingested RandomnessFulfilled logs. When false, no randomness data is expected and readiness stays
  // on the plain arrival check, preserving behaviour for deployments without the engine.
  randomnessEngineConfigured?: boolean;
  // VEY-KANEO-485: hard deadline (ms) for the chain-read phase of a full cold rebuild. The self-hosted
  // node is the only RPC and caps eth_getLogs at 100k blocks; if the deploy->head backfill stalls, the
  // rebuild rejects with a real error (recorded as lastReconciliationError, retried by the boot-time
  // recovery) instead of sitting in reconciliation_in_progress forever. Omitted/<=0 disables the
  // deadline (the in-memory test indexer has no slow RPC to guard).
  rebuildDeadlineMs?: number;
};

export type BattleReportMaterializationRequest = {
  databasePath: string | null;
  fromBlock: string;
  missionIds: string[];
  reason: "ingest" | "backfill" | "repair";
};

type CountRow = {
  count: number;
};

type CurrentStateHealStats = {
  planetsScanned: number;
  shipMismatches: number;
};

type MetadataRow = {
  value: string;
};

type UniverseSystemSnapshotRow = {
  payload_json: string;
  version: string;
};

type EventRow = {
  event_json: string;
};

type BattleReportReadModelRow = {
  mission_id: string;
  status: "pending" | "ready" | "failed";
  report_json: string | null;
  error: string | null;
  attempts: number;
  duration_ms: number | null;
  block_number: string | null;
  updated_at: string;
};

type AllianceDiplomacyRow = {
  alliance_id: string;
  other_alliance_id: string;
  status_id: number;
  updated_at: string | null;
  initiated_by_alliance_id: string | null;
};

type LegacyUnitMutation = {
  kind: "ship" | "defense";
  planetId: string;
  itemId: number;
  delta: number;
};

type UnitCountSnapshot = {
  fleet: Map<number, number>;
  defenses: Map<number, number>;
};

type QueueRow = {
  backlog_json: string | null;
  crystal_cost: string;
  deuterium_cost: string;
  item_id: number;
  metal_cost: string;
  queue_kind: string;
  quantity: number | null;
  ready_at: string;
  started_at: string | null;
  target_level: number | null;
};

type LegacyQueueRow = {
  cost_json: string;
  event_json: string;
  item_id: number;
  kind: string;
  owner: string | null;
  planet_id: string | null;
  quantity: number | null;
  queue_key: string;
  ready_at: string;
  started_at: string | null;
  target_level: number | null;
};

type LevelRow = {
  id: number;
  value: number;
};

type IndexedPlanetLevelRow = LevelRow & {
  planet_id: string;
};

type IndexedTechnologyLevelRow = LevelRow & {
  owner: string;
};

type MoonRow = {
  event_json: string;
};

type ReferralClaimRow = {
  event_json: string;
};

type ReferralRedemptionRow = {
  event_json: string;
};

type ReferralRewardClaimRow = {
  event_json: string;
};

type RiftBalanceRow = {
  in_game_balance: string;
  locked_balance: string;
  resource_id: number;
};

type PendingWithdrawalRow = {
  amount: string;
  resource_id: number;
  unlocks_at: string;
  withdrawal_key: string;
};

type MoonBuildingQueueRow = {
  crystal_cost: string;
  deuterium_cost: string;
  event_json: string;
  metal_cost: string;
  moon_building_id: number;
  planet_id: string;
  ready_at: string;
  target_level: number;
};

type ResourceColumns = {
  metal: string;
  crystal: string;
  deuterium: string;
};

type PlanetResourceRow = ResourceColumns & {
  block_number: string;
  last_settled_at: string;
  log_index: string;
  transaction_hash: string;
};

type PlayerProfileRow = {
  description: string | null;
  display_name: string | null;
  updated_at: string | null;
  wallet: string;
};

type WatchedPlanetRow = {
  planet_id: string;
  watched_at: string;
};

type PlayerActivityRow = {
  last_active_at: string;
  wallet: string;
};

type AllianceRow = {
  active: number;
  alliance_id: string;
  created_at: string;
  description: string;
  member_count: number;
  name: string;
  owner: string;
  tag: string;
};

type AllianceMemberRow = {
  alliance_id: string;
  joined_at: string;
  role_id: number;
  wallet: string;
};

type AllianceInviteRow = {
  alliance_id: string;
  invited_at: string;
  inviter: string;
  player: string;
};

type AllianceJoinRequestRow = {
  alliance_id: string;
  requested_at: string;
  requester: string;
};

type QueueUpsertEvent = IndexedQueueStartedEvent & {
  backlog?: QueueState[];
  canonicalSnapshot?: boolean;
};

export type IndexedRpcLog = RpcLog & {
  blockTimestamp?: string;
  logIndex?: string;
  removed?: boolean;
};

export type ApplyLogResult = {
  applied: boolean;
  duplicate: boolean;
  ignored: boolean;
  removed: boolean;
  snapshot: IndexerSnapshot;
};

// How many planets the canonical reconcile reads at once. Each planet fans out 4 batched eth_call reads,
// so this bounds the concurrent batches the self-hosted RPC node has to serialize and return intact —
// reading the whole universe in one Promise.all truncated responses and failed the reconcile
// (VEY-KANEO-461). 25 keeps the reconcile completing without making it serial-slow.
const CANONICAL_READ_PLANET_CHUNK = 25;
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const defenseHoldEndedTopic = "0xf72983c656a87e172935581e9c19f22826c62a2c4d552c6dd217c498a9d88586";
// DefenseHold returns are intentionally excluded: the contract emits absolute PlanetShipCountChanged
// credits for survivors. A zero-survivor hold emits no credit event, so replaying its launch vector as
// a legacy return would resurrect ships destroyed while stationed.
const legacyReturnCreditableMissionTypes = new Set(["Transport", "Deploy", "Colonize", "Harvest", "AcsDefend"]);

function systemCacheKey(galaxy: number, system: number): string {
  return `${galaxy}:${system}`;
}

function cloneQueueState(queue: QueueState | null): QueueState | null {
  if (!queue) return null;
  return {
    ...queue,
    cost: { ...queue.cost },
    ...(queue.backlog ? { backlog: queue.backlog.map((entry) => cloneQueueState(entry)!) } : {})
  };
}

export class SettlementIndexer {
  private readonly db: Database;
  private planetRebuildPromise: Promise<IndexerSnapshot> | null = null;
  private rebuildPromise: Promise<IndexerSnapshot> | null = null;
  private currentStateHealPromise: Promise<IndexerSnapshot> | null = null;
  private currentStateHealRunId: string | null = null;
  private targetedHealPlanetIds = new Set<string>();
  private targetedHealPromise: Promise<void> | null = null;
  // Monotonic counter bumped by touch() on every applied state mutation. Read paths memoize
  // whole-universe derivations against it and recompute only when integrated events actually
  // changed state — never per request (VEY-KANEO-467).
  private stateGeneration = 0;
  private missionGeneration = 0;
  private missionReadModelDbVersion: string | null = null;
  private battleReportReadModelDbVersion: string | null = null;
  // Memoized full highscore leaderboard (every owner's score + their planets). The leaderboard is a
  // function of indexed contract-mirror state and is valid until the next event-listener mutation.
  private leaderboardCache:
    | {
      generation: string;
      planetsByOwner: Map<string, SettledPlanetEvent[]>;
      entries: HighscoreEntry[];
    }
    | null = null;
  private missionReadModelCache:
    | {
      missionGeneration: number;
      battleReportGeneration: number;
      asOfSeconds: number;
      summaries: FleetMissionSummary[];
      battleReports: BattleReport[] | null;
    }
    | null = null;
  private decodedMissionLogCache:
    | {
      missionGeneration: number;
      eventMissions: FleetMissionSummary[];
      fulfilledRandomnessRequestIds: ReadonlySet<string>;
      battleReports: BattleReport[];
    }
    | null = null;
  private decodedBattleReportCache:
    | {
      missionGeneration: number;
      battleReportGeneration: number;
      battleReports: BattleReport[];
    }
    | null = null;
  private battleReportsByMissionIdCache:
    | {
      missionGeneration: number;
      battleReportGeneration: number;
      reportsByMissionId: Map<string, BattleReport[]>;
    }
    | null = null;
  private fulfilledRandomnessRequestIdsCache:
    | {
      missionGeneration: number;
      requestIds: ReadonlySet<string>;
    }
    | null = null;
  private battleReportGeneration = 0;
  private missionReferenceCache:
    | {
      source: FleetMissionSummary[];
      summaries: FleetMissionSummary[];
      byId: Map<string, FleetMissionSummary>;
      active: FleetMissionSummary[];
      completed: FleetMissionSummary[];
      activeByTarget: Map<string, FleetMissionSummary[]>;
    }
    | null = null;
  private fleetMissionPlanetReferenceCache:
    | {
      stateVersion: string;
      refs: Map<string, FleetMissionPlanetReference | null>;
    }
    | null = null;
  private canonicalActiveMissionCache = new Map<
    string,
    {
      missionGeneration: number;
      stateVersion: string;
      includeOverduePendingRandomness: boolean;
      fulfilledRandomnessRequestIds: ReadonlySet<string> | null;
      baseMissions: FleetMissionSummary[];
    }
  >();
  private canonicalCompletedMissionCache:
    | {
      missionGeneration: number;
      stateVersion: string;
      missions: FleetMissionSummary[];
    }
    | null = null;
  private settledPlanetIndexCache:
    | SettledPlanetIndexCache
    | null = null;
  private targetedSettledPlanetCache: TargetedSettledPlanetCache | null = null;
  private indexedLevelsByIdCache: IndexedLevelsByIdCache | null = null;
  private queueStateCache: QueueStateCache | null = null;
  private technologyLevelsCache: TechnologyLevelsCache | null = null;
  private allianceIntelCache: AllianceIntelCache | null = null;
  private resolvedBattleMissionIdsCache:
    | {
      missionGeneration: number;
      battleReportGeneration: number;
      missionIds: ReadonlySet<string>;
    }
    | null = null;
  private recentBattleReportsCache = new Map<number, {
    battleReportGeneration: number;
    missionGeneration: number;
    reports: BattleReport[];
  }>();
  private attackLaunchSecondsCache = new Map<string, { missionGeneration: number; launchesByTarget: Map<string, number[]> }>();
  private snapshotCache:
    | {
      expiresAtMs: number;
      generation: number;
      rebuildPromise: Promise<IndexerSnapshot> | null;
      planetRebuildPromise: Promise<IndexerSnapshot> | null;
      currentStateHealPromise: Promise<IndexerSnapshot> | null;
      snapshot: IndexerSnapshot;
    }
    | null = null;
  private canonicalQueueSnapshotBlock: string | null = null;

  constructor(
    private readonly chainReader: Pick<
      ChainReader,
      "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"
    > & Pick<
      Partial<ChainReader>,
      "getDefenseState"
        | "getStartPrice"
        | "getInfrastructureState"
        | "getMoonState"
        | "getPlayerQueues"
        | "getResearchState"
        | "getShipyardState"
        | "listAllianceDirectoryState"
        | "listAllianceJoinRequestState"
        | "listAllianceInviteState"
        | "listAllianceDiplomacyState"
        | "getCanonicalFleetMission"
        | "listAllianceLogs"
        | "listCanonicalFleetMissions"
        | "listContractLogs"
        | "listCurrentPlanets"
        | "getBlockNumber"
        | "getCanonicalPlanetState"
    >,
    private readonly fromBlock: bigint,
    options: SettlementIndexerOptions = {}
  ) {
    const databasePath = options.databasePath ?? ":memory:";
    this.db = options.database ?? openIndexerDatabase(databasePath, options.readOnly ?? false);
    this.qaSyntheticStationedDefenders = options.qaSyntheticStationedDefenders ?? false;
    this.randomnessEngineConfigured = options.randomnessEngineConfigured ?? false;
    this.rebuildDeadlineMs = options.rebuildDeadlineMs && options.rebuildDeadlineMs > 0 ? options.rebuildDeadlineMs : 0;
    if (!options.readOnly) {
      this.migrate(options.runStartupBackfill ?? true);
      this.seedStartPriceBootstrap(options.settlementStartPriceWei ?? null);
    }
  }

  // VEY-KANEO-471: see SettlementIndexerOptions. Read once in fleetMissionVisibility.
  private readonly qaSyntheticStationedDefenders: boolean;
  // VEY-KANEO-479: see SettlementIndexerOptions. Gates arrived-Attack readiness on randomness.
  private readonly randomnessEngineConfigured: boolean;
  // VEY-KANEO-485: see SettlementIndexerOptions. 0 = no cold-rebuild deadline.
  private readonly rebuildDeadlineMs: number;

  snapshot(): IndexerSnapshot {
    const nowMs = Date.now();
    const cached = this.snapshotCache;
    if (
      cached
      && cached.generation === this.stateGeneration
      && cached.rebuildPromise === this.rebuildPromise
      && cached.planetRebuildPromise === this.planetRebuildPromise
      && cached.currentStateHealPromise === this.currentStateHealPromise
      && cached.expiresAtMs > nowMs
    ) {
      return cached.snapshot;
    }

    const currentStateHealInProgress = this.currentStateHealPromise !== null;
    const reconciliationInProgress = this.rebuildPromise !== null || this.planetRebuildPromise !== null || currentStateHealInProgress;
    const indexedPlanets = this.count("indexed_planets");
    const lastReconciledAt = this.metadata("lastReconciledAt");
    const allianceReconciledAt = this.metadata("allianceReconciledAt") ?? lastReconciledAt;
    const lastReconciledBlock = this.metadata("lastReconciledBlock");
    const lastReconciliationError = this.metadata("lastReconciliationError");
    const pendingReconciliationReason = this.metadata("pendingReconciliationReason");
    const blockingStaleReason = this.blockingStaleReason({
      lastReconciledAt,
      lastReconciliationError,
      pendingReconciliationReason
    });
    const staleReason = reconciliationInProgress ? "reconciliation_in_progress" : blockingStaleReason;
    const canServePreviousReconciliation =
      reconciliationInProgress
      && Boolean(lastReconciledAt)
      && isPlanetHydrationPendingReason(blockingStaleReason);
    const safeToServeIndexedState =
      (blockingStaleReason === null || canServePreviousReconciliation)
      && (!reconciliationInProgress || Boolean(lastReconciledAt));
    const allianceStaleReason = this.allianceStaleReason({
      allianceReconciledAt,
      lastReconciliationError,
      reconciliationInProgress
    });
    const snapshot: IndexerSnapshot = {
      allianceReconciledAt,
      allianceStaleReason,
      indexedDebrisFields: this.count("indexed_debris_fields"),
      indexedEventLogs: this.count("indexed_event_logs"),
      indexedMoonChanceReports: this.count("indexed_moon_chance_reports"),
      indexedMoons: this.count("indexed_moons"),
      indexedPlanets,
      indexedState: safeToServeIndexedState ? "healthy" : reconciliationInProgress ? "reconciling" : "stale",
      indexedRiftBalances: this.count("indexed_rift_balances"),
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.metadata("lastRebuiltAt"),
      lastCurrentStateHealAt: this.metadata("lastCurrentStateHealAt"),
      currentStateOneTimeHealCompletedAt: this.metadata("currentStateOneTimeHealCompletedAt"),
      lastCurrentStateHealPlanetsScanned: metadataNumber(this.metadata("lastCurrentStateHealPlanetsScanned")),
      lastCurrentStateHealRunId: this.metadata("lastCurrentStateHealRunId"),
      lastCurrentStateHealShipMismatches: metadataNumber(this.metadata("lastCurrentStateHealShipMismatches")),
      lastCanonicalFleetMissionSyncAt: this.metadata("lastCanonicalFleetMissionSyncAt"),
      lastCanonicalFleetMissionSyncDurationMs: metadataNumber(this.metadata("lastCanonicalFleetMissionSyncDurationMs")),
      lastCanonicalFleetMissionSyncError: this.metadata("lastCanonicalFleetMissionSyncError"),
      lastCanonicalFleetMissionSyncRows: metadataNumber(this.metadata("lastCanonicalFleetMissionSyncRows")),
      lastCanonicalFleetMissionSyncUpdatedRows: metadataNumber(this.metadata("lastCanonicalFleetMissionSyncUpdatedRows")),
      lastReconciledAt,
      lastReconciledBlock,
      lastReconciliationError,
      currentStateHealInProgress,
      currentStateHealRunId: this.currentStateHealRunId,
      latestIndexedBlock: this.metadata("latestIndexedBlock"),
      pendingReconciliationReason,
      reconciliationInProgress,
      reorgDetectedAt: this.metadata("reorgDetectedAt"),
      safeToServeAllianceState: allianceStaleReason === null,
      safeToServeIndexedState,
      staleReason,
      startPriceBootstrapDivergence: this.metadata(startPriceBootstrapDivergenceMetadataKey),
      startPriceSource: this.metadata(startPriceSourceMetadataKey),
      startPriceWei: this.currentStartPriceWei()
    };
    this.snapshotCache = {
      currentStateHealPromise: this.currentStateHealPromise,
      expiresAtMs: nowMs + 1_000,
      generation: this.stateGeneration,
      planetRebuildPromise: this.planetRebuildPromise,
      rebuildPromise: this.rebuildPromise,
      snapshot
    };
    return snapshot;
  }

  recordWriterChainSyncDiagnostics(diagnostics: Pick<WriterChainSyncDiagnostics, "chainSync" | "chainSyncRpc">): void {
    this.setMetadata(
      writerChainSyncDiagnosticsMetadataKey,
      JSON.stringify({
        ...diagnostics,
        updatedAt: new Date().toISOString()
      } satisfies WriterChainSyncDiagnostics),
      { invalidateSnapshot: false }
    );
  }

  writerChainSyncDiagnostics(): WriterChainSyncDiagnostics | null {
    const raw = this.metadata(writerChainSyncDiagnosticsMetadataKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<WriterChainSyncDiagnostics>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.updatedAt !== "string") {
        return null;
      }
      return {
        chainSync: parsed.chainSync ?? null,
        chainSyncRpc: parsed.chainSyncRpc ?? null,
        updatedAt: parsed.updatedAt
      };
    } catch {
      return null;
    }
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    const cached = this.currentSettledPlanetIndexCache();
    if (cached) return [...(cached.bySystem.get(systemCacheKey(galaxy, system)) ?? [])];

    return [...this.targetedSettledPlanetsInSystem(galaxy, system)];
  }

  debrisFieldsInSystem(galaxy: number, system: number): IndexedDebrisFieldEvent[] {
    const rows = this.db.query(`
      SELECT debris.event_json
      FROM contract_debris_fields debris
      INNER JOIN contract_planets planet ON planet.planet_id = debris.planet_id
      WHERE planet.galaxy = ? AND planet.system_number = ?
      ORDER BY planet.position ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const field = parseEvent<DebrisFieldEvent>(row.event_json);
      const planet = this.planet(field.planetId);
      if (!planet) return [];
      return [{ ...field, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  debrisTargets(limit = 250): IndexedDebrisTarget[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db.query(`
      SELECT debris.event_json, planet.event_json AS planet_json
      FROM contract_debris_fields debris
      INNER JOIN contract_planets planet ON planet.planet_id = debris.planet_id
      WHERE CAST(debris.metal AS REAL) > 0 OR CAST(debris.crystal AS REAL) > 0
      ORDER BY (CAST(debris.metal AS REAL) + CAST(debris.crystal AS REAL)) DESC, planet.galaxy ASC, planet.system_number ASC, planet.position ASC
      LIMIT ?
    `).all(boundedLimit) as Array<EventRow & { planet_json: string }>;

    return rows.map((row) => {
      const field = parseEvent<DebrisFieldEvent>(row.event_json);
      const planet = parseEvent<SettledPlanetEvent>(row.planet_json);
      return {
        ...field,
        galaxy: planet.galaxy,
        system: planet.system,
        position: planet.position,
        planet: {
          planetId: planet.planetId,
          name: planet.name,
          owner: planet.owner,
          galaxy: planet.galaxy,
          system: planet.system,
          position: planet.position,
          temperature: planet.temperature
        }
      };
    });
  }

  moonChanceReportsInSystem(galaxy: number, system: number): IndexedMoonChanceReportEvent[] {
    const rows = this.db.query(`
      SELECT report.event_json
      FROM contract_moon_chance_reports report
      INNER JOIN contract_planets planet ON planet.planet_id = report.target_planet_id
      WHERE planet.galaxy = ? AND planet.system_number = ?
      ORDER BY planet.position ASC, report.block_number ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const report = parseEvent<MoonChanceReportEvent>(row.event_json);
      const planet = this.planet(report.targetPlanetId);
      if (!planet) return [];
      return [{ ...report, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  settledPlanets(): SettledPlanetEvent[] {
    return [...this.settledPlanetIndex().planets];
  }

  settledPlanetsByOwner(): Map<string, SettledPlanetEvent[]> {
    return new Map([...this.settledPlanetIndex().byOwner].map(([owner, planets]) => [owner, [...planets]]));
  }

  fleetDefenseRawCounts(): FleetDefenseUnitCount[] {
    const counts: FleetDefenseUnitCount[] = [];
    for (const planet of this.settledPlanets()) {
      for (const unitId of shipIds) {
        counts.push({
          count: this.indexedLevel("contract_ship_counts", "ship_id", planet.planetId, unitId),
          owner: planet.owner.toLowerCase() as Address,
          planetId: planet.planetId,
          unitId,
          unitKind: "ship"
        });
      }
      for (const unitId of defenseIds) {
        counts.push({
          count: this.indexedLevel("contract_defense_counts", "defense_id", planet.planetId, unitId),
          owner: planet.owner.toLowerCase() as Address,
          planetId: planet.planetId,
          unitId,
          unitKind: "defense"
        });
      }
    }
    return counts;
  }

  planet(planetId: string): SettledPlanetEvent | null {
    const cached = this.currentSettledPlanetIndexCache();
    if (cached) return cached.byId.get(planetId) ?? null;

    return this.targetedSettledPlanetById(planetId);
  }

  hasPendingPlanetResources(planetId: string): boolean {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(planetId) as EventRow | null;
    if (!row) return false;
    return isZeroResourcePlaceholder(parseEvent<SettledPlanetEvent>(row.event_json))
      && !this.planetResourceSnapshot(planetId);
  }

  playerProfile(wallet: string): PlayerProfile {
    const normalizedWallet = wallet.toLowerCase() as Address;
    const row = this.db.query(`
      SELECT wallet, display_name, description, updated_at
      FROM player_profiles
      WHERE wallet = lower(?)
    `).get(wallet) as PlayerProfileRow | null;

    return {
      wallet: normalizedWallet,
      displayName: row?.display_name ?? null,
      description: row?.description ?? null,
      fallbackName: playerFallbackName(normalizedWallet),
      updatedAt: row?.updated_at ?? null
    };
  }

  playerProfiles(wallets: Iterable<string>): Map<string, PlayerProfile> {
    const uniqueWallets = [...new Set([...wallets].map((wallet) => wallet.toLowerCase()))];
    return new Map(uniqueWallets.map((wallet) => [wallet, this.playerProfile(wallet)]));
  }

  watchedPlanetIds(wallet: string): string[] {
    const rows = this.db.query(`
      SELECT planet_id
      FROM player_watched_planets
      WHERE wallet = lower(?)
      ORDER BY watched_at DESC, CAST(planet_id AS INTEGER) ASC
    `).all(wallet) as Array<Pick<WatchedPlanetRow, "planet_id">>;

    return rows.map((row) => row.planet_id);
  }

  watchedPlanets(wallet: string, page = 1, pageSize = 25): { total: number; planets: SettledPlanetEvent[] } {
    const limit = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const normalizedPage = Math.max(1, Math.floor(page));
    const offset = (normalizedPage - 1) * limit;
    const totalRow = this.db.query(`
      SELECT COUNT(*) AS count
      FROM player_watched_planets watch
      INNER JOIN contract_planets planet ON planet.planet_id = watch.planet_id
      WHERE watch.wallet = lower(?)
    `).get(wallet) as { count: number } | null;
    const rows = this.db.query(`
      SELECT planet.event_json
      FROM player_watched_planets watch
      INNER JOIN contract_planets planet ON planet.planet_id = watch.planet_id
      WHERE watch.wallet = lower(?)
      ORDER BY watch.watched_at DESC, CAST(watch.planet_id AS INTEGER) ASC
      LIMIT ? OFFSET ?
    `).all(wallet, limit, offset) as EventRow[];

    return {
      total: Number(totalRow?.count ?? 0),
      planets: rows.map((row) => this.withResourceSnapshot(parseEvent<SettledPlanetEvent>(row.event_json)))
    };
  }

  watchPlanet(wallet: Address, planetId: string): { watched: boolean; watchedPlanetIds: string[] } {
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO player_watched_planets (wallet, planet_id, watched_at)
      VALUES (lower(?), ?, ?)
      ON CONFLICT(wallet, planet_id) DO UPDATE SET
        watched_at = excluded.watched_at
    `).run(wallet, planetId, updatedAt);
    this.touch();
    return { watched: true, watchedPlanetIds: this.watchedPlanetIds(wallet) };
  }

  unwatchPlanet(wallet: Address, planetId: string): { watched: boolean; watchedPlanetIds: string[] } {
    this.db.query(`
      DELETE FROM player_watched_planets
      WHERE wallet = lower(?) AND planet_id = ?
    `).run(wallet, planetId);
    this.touch();
    return { watched: false, watchedPlanetIds: this.watchedPlanetIds(wallet) };
  }

  playerLastActiveSeconds(wallets: Iterable<string>): Map<string, number> {
    const uniqueWallets = [...new Set([...wallets].map((wallet) => wallet.toLowerCase()))];
    const activity = new Map<string, number>();
    for (const walletChunk of chunks(uniqueWallets, 500)) {
      if (walletChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT wallet, last_active_at
        FROM indexed_player_activity
        WHERE wallet IN (${walletChunk.map(() => "?").join(",")})
      `).all(...walletChunk) as PlayerActivityRow[];
      for (const row of rows) {
        const seconds = Number(row.last_active_at);
        if (Number.isFinite(seconds) && seconds > 0) {
          activity.set(row.wallet.toLowerCase(), seconds);
        }
      }
    }
    return activity;
  }

  allianceState(wallet: `0x${string}`): AllianceState {
    const normalizedWallet = wallet.toLowerCase() as Address;
    const membership = this.allianceMembership(normalizedWallet);
    const directory = this.allianceDirectory();
    const directoryById = new Map(directory.map((alliance) => [alliance.allianceId, alliance]));
    const pendingInvites = this.allianceInvitesForWallet(normalizedWallet);
    const pendingJoinRequests = this.allianceJoinRequestsForWallet(normalizedWallet);
    const members = membership.allianceId === "0" ? [] : this.allianceMembers(membership.allianceId);
    const allianceJoinRequests = membership.allianceId === "0" ? [] : this.allianceJoinRequestsForAlliance(membership.allianceId);
    const profile = membership.allianceId === "0" ? null : directoryById.get(membership.allianceId) ?? null;
    const diplomacy = membership.allianceId === "0" ? [] : this.allianceDiplomacy(membership.allianceId, directoryById);

    return {
      wallet,
      allianceAvailable: true,
      dismissJoinRequestAvailable: process.env.VEYDRIFT_ALLIANCE_DISMISS_JOIN_REQUEST_ENABLED !== "false",
      membership,
      profile: profile ? {
        active: profile.active,
        tag: profile.tag,
        name: profile.name,
        description: profile.description,
        owner: profile.owner,
        createdAt: profile.createdAt,
        memberCount: profile.memberCount,
        ...(profile.ownerDisplayName !== undefined ? { ownerDisplayName: profile.ownerDisplayName } : {}),
        ...(profile.totalMemberScore !== undefined ? { totalMemberScore: profile.totalMemberScore } : {})
      } : null,
      directory,
      pendingInvites,
      pendingJoinRequests,
      allianceJoinRequests,
      diplomacy,
      activeWars: diplomacy.filter((relation) => relation.status === "war"),
      members
    };
  }

  allianceProfile(allianceId: string): AllianceState["directory"][number] | null {
    return this.allianceDirectory().find((alliance) => alliance.allianceId === allianceId) ?? null;
  }

  allianceIntelForPlayers(wallets: readonly string[]): Map<string, AllianceIdentity> {
    const uniqueWallets = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))];
    if (uniqueWallets.length === 0) return new Map();
    const cache = this.allianceIntelCacheForCurrentVersion();
    const cacheKey = [...uniqueWallets].sort().join(",");
    const cached = cache.values.get(cacheKey);
    if (cached) return new Map(cached);

    const rows = this.db.query(`
      SELECT member.wallet, alliance.alliance_id, alliance.tag, alliance.name
      FROM contract_alliance_members member
      INNER JOIN contract_alliances alliance ON alliance.alliance_id = member.alliance_id
      WHERE alliance.active = 1 AND member.wallet IN (${uniqueWallets.map(() => "?").join(",")})
    `).all(...uniqueWallets) as Array<{ wallet: string; alliance_id: string; tag: string; name: string }>;

    const intel = new Map(rows.map((row) => [
      row.wallet.toLowerCase(),
      {
        allianceId: row.alliance_id,
        tag: row.tag,
        name: row.name
      }
    ]));
    cache.values.set(cacheKey, intel);
    return new Map(intel);
  }

  allianceRelationship(allianceId: string | null | undefined, otherAllianceId: string | null | undefined): ReturnType<typeof diplomacyStatusName> {
    if (!allianceId || !otherAllianceId || allianceId === "0" || otherAllianceId === "0" || allianceId === otherAllianceId) {
      return "none";
    }
    const row = this.db.query(`
      SELECT status_id
      FROM contract_alliance_diplomacy
      WHERE alliance_id = ? AND other_alliance_id = ?
    `).get(allianceId, otherAllianceId) as { status_id: number } | null;
    return diplomacyStatusName(row?.status_id ?? 0);
  }

  upsertPlayerDisplayName(wallet: Address, displayName: string): PlayerProfile {
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO player_profiles (wallet, display_name, updated_at)
      VALUES (lower(?), ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(wallet, displayName, updatedAt);

    return this.playerProfile(wallet);
  }

  upsertPlayerProfile(wallet: Address, displayName: string, description: string | null): PlayerProfile {
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO player_profiles (wallet, display_name, description, updated_at)
      VALUES (lower(?), ?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(wallet, displayName, description, updatedAt);

    return this.playerProfile(wallet);
  }

  private allianceMembership(wallet: Address): AllianceState["membership"] {
    const row = this.db.query(`
      SELECT alliance_id, wallet, role_id, joined_at
      FROM contract_alliance_members
      WHERE wallet = lower(?)
    `).get(wallet) as AllianceMemberRow | null;

    return row ? {
      allianceId: row.alliance_id,
      role: allianceRoleName(row.role_id),
      joinedAt: row.joined_at
    } : {
      allianceId: "0",
      role: "none",
      joinedAt: "0"
    };
  }

  private allianceDirectory(): AllianceState["directory"] {
    const rows = this.db.query(`
      SELECT alliance_id, active, tag, name, description, owner, created_at, member_count
      FROM contract_alliances
      WHERE active = 1
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all() as AllianceRow[];
    return rows.map((row) => {
      const members = this.allianceMembers(row.alliance_id);
      const memberCount = members.length;
      return {
        allianceId: row.alliance_id,
        active: row.active === 1,
        tag: row.tag,
        name: row.name,
        description: row.description,
        owner: row.owner.toLowerCase() as Address,
        ownerDisplayName: this.playerProfile(row.owner).displayName,
        createdAt: row.created_at,
        memberCount,
        totalMemberScore: this.allianceTotalScore(members.map((member) => member.address)),
        members
      };
    });
  }

  private allianceMembers(allianceId: string): NonNullable<AllianceState["directory"][number]["members"]> {
    const rows = this.db.query(`
      SELECT alliance_id, wallet, role_id, joined_at
      FROM contract_alliance_members
      WHERE alliance_id = ?
      ORDER BY CASE role_id WHEN 3 THEN 0 WHEN 2 THEN 1 WHEN 1 THEN 2 ELSE 3 END, joined_at ASC, wallet ASC
    `).all(allianceId) as AllianceMemberRow[];
    return rows.map((row) => {
      const address = row.wallet.toLowerCase() as Address;
      return {
        address,
        displayName: this.playerProfile(address).displayName,
        role: allianceRoleName(row.role_id),
        joinedAt: row.joined_at,
        totalScore: this.walletTotalScore(address)
      };
    });
  }

  private allianceInvitesForWallet(wallet: Address): AllianceState["pendingInvites"] {
    const rows = this.db.query(`
      SELECT alliance_id, player, inviter, invited_at
      FROM contract_alliance_invites
      WHERE player = lower(?)
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all(wallet) as AllianceInviteRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      inviter: row.inviter.toLowerCase() as Address,
      inviterDisplayName: this.playerProfile(row.inviter).displayName,
      invitedAt: row.invited_at
    }));
  }

  private allianceJoinRequestsForWallet(wallet: Address): AllianceState["pendingJoinRequests"] {
    const rows = this.db.query(`
      SELECT alliance_id, requester, requested_at
      FROM contract_alliance_join_requests
      WHERE requester = lower(?)
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all(wallet) as AllianceJoinRequestRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      requester: row.requester.toLowerCase() as Address,
      requesterDisplayName: this.playerProfile(row.requester).displayName,
      requestedAt: row.requested_at
    }));
  }

  private allianceJoinRequestsForAlliance(allianceId: string): AllianceState["allianceJoinRequests"] {
    const rows = this.db.query(`
      SELECT alliance_id, requester, requested_at
      FROM contract_alliance_join_requests
      WHERE alliance_id = ?
      ORDER BY requested_at ASC, requester ASC
    `).all(allianceId) as AllianceJoinRequestRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      requester: row.requester.toLowerCase() as Address,
      requesterDisplayName: this.playerProfile(row.requester).displayName,
      requesterTotalScore: this.walletTotalScore(row.requester.toLowerCase() as Address),
      requesterMembership: this.allianceMembership(row.requester.toLowerCase() as Address),
      requestedAt: row.requested_at
    }));
  }

  private allianceDiplomacy(
    allianceId: string,
    directoryById: ReadonlyMap<string, AllianceState["directory"][number]>
  ): AllianceState["diplomacy"] {
    const rows = this.db.query(`
      SELECT alliance_id, other_alliance_id, status_id, updated_at, initiated_by_alliance_id
      FROM contract_alliance_diplomacy
      WHERE alliance_id = ? AND status_id != 0
      ORDER BY status_id DESC, CAST(other_alliance_id AS INTEGER) ASC
    `).all(allianceId) as AllianceDiplomacyRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      otherAllianceId: row.other_alliance_id,
      status: diplomacyStatusName(row.status_id),
      statusId: row.status_id,
      updatedAt: row.updated_at,
      initiatedByAllianceId: row.initiated_by_alliance_id,
      alliance: directoryById.get(row.other_alliance_id) ?? null
    }));
  }

  private allianceTotalScore(wallets: readonly Address[]): string {
    return wallets.reduce((sum, wallet) => sum + BigInt(this.walletTotalScore(wallet)), 0n).toString();
  }

  private walletTotalScore(wallet: Address): string {
    try {
      return this.highscoreForWallet(wallet).totalUserScore;
    } catch {
      return "0";
    }
  }

  walletSettlement(wallet: `0x${string}`): { wallet: `0x${string}`; hasFirstPlanet: boolean; homePlanetId: string | null; planet: SettledPlanetEvent | null; contractKind: "game" } {
    const planets = this.settledPlanetsForOwner(wallet);
    const planet = planets.find((item) => item.eventName === "PlanetStarted") ?? planets[0] ?? null;

    return {
      wallet,
      hasFirstPlanet: planet !== null,
      homePlanetId: planet?.planetId ?? null,
      planet,
      contractKind: "game"
    };
  }

  currentStartPriceWei(): string | null {
    return this.metadata(startPriceWeiMetadataKey);
  }

  referralClaim(owner: `0x${string}`, commitment: `0x${string}`, txHash: `0x${string}`): IndexedReferralClaimEvent | null {
    const row = this.db.query(`
      SELECT event_json
      FROM indexed_referral_claims
      WHERE owner = lower(?) AND commitment = lower(?) AND transaction_hash = lower(?)
      LIMIT 1
    `).get(owner, commitment, txHash) as ReferralClaimRow | null;

    return row ? parseEvent<IndexedReferralClaimEvent>(row.event_json) : null;
  }

  referralClaims(owner: `0x${string}`): IndexedReferralClaimEvent[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_referral_claims
      WHERE owner = lower(?)
      ORDER BY CAST(block_number AS INTEGER), event_id
    `).all(owner) as ReferralClaimRow[];
    return rows.map((row) => parseEvent<IndexedReferralClaimEvent>(row.event_json));
  }

  referralRedemption(
    inviter: `0x${string}`,
    invitee: `0x${string}`,
    commitment: `0x${string}`,
    txHash: `0x${string}`
  ): IndexedReferralRedemptionEvent | null {
    const row = this.db.query(`
      SELECT event_json
      FROM indexed_referral_redemptions
      WHERE inviter = lower(?) AND invitee = lower(?) AND commitment = lower(?) AND transaction_hash = lower(?)
      LIMIT 1
    `).get(inviter, invitee, commitment, txHash) as ReferralRedemptionRow | null;

    return row ? parseEvent<IndexedReferralRedemptionEvent>(row.event_json) : null;
  }

  referralRedemptionsForInviter(inviter: `0x${string}`): IndexedReferralRedemptionEvent[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_referral_redemptions
      WHERE inviter = lower(?)
      ORDER BY CAST(block_number AS INTEGER), event_id
    `).all(inviter) as ReferralRedemptionRow[];
    return rows.map((row) => parseEvent<IndexedReferralRedemptionEvent>(row.event_json));
  }

  referralRewardClaimsForInviter(inviter: `0x${string}`): IndexedReferralRewardClaimEvent[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_referral_reward_claims
      WHERE inviter = lower(?)
      ORDER BY CAST(block_number AS INTEGER), event_id
    `).all(inviter) as ReferralRewardClaimRow[];
    return rows.map((row) => parseEvent<IndexedReferralRewardClaimEvent>(row.event_json));
  }

  walletPlanets(wallet: `0x${string}`): WalletPlanets {
    const settlement = this.walletSettlement(wallet);
    const planets = this.settledPlanetsForOwner(wallet).map((planet) => {
      const moonState = this.moonState(planet.owner, planet.planetId);
      const moonSummary = moonState.moon
        ? {
            bodyKind: "moon" as const,
            exists: true,
            parentPlanetId: planet.planetId,
            planetId: planet.planetId,
            coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
            resources: moonState.resources,
            ...(moonState.resourcesAsOfNow ? { resourcesAsOfNow: moonState.resourcesAsOfNow } : {}),
            ships: moonState.ships,
            defenses: moonState.defenses
          }
        : null;
      return indexedManagedPlanet(
        planet,
        settlement.homePlanetId,
        this.infrastructureRows(planet.planetId),
        {
          building: this.planetQueue(planet.planetId, "building"),
          defense: this.planetQueue(planet.planetId, "defense"),
          ship: this.planetQueue(planet.planetId, "ship")
        },
        moonSummary
      );
    });

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      queues: {
        research: this.researchQueue(wallet)
      },
      planets
    };
  }

  playerQueues(wallet: `0x${string}`, planetId: string | null): PlayerQueues {
    return {
      wallet,
      homePlanetId: planetId,
      building: planetId ? this.planetQueue(planetId, "building") : null,
      defense: planetId ? this.planetQueue(planetId, "defense") : null,
      ship: planetId ? this.planetQueue(planetId, "ship") : null,
      research: this.researchQueue(wallet)
    };
  }

  fleetMissionVisibility(wallet: `0x${string}`, options: { includeArchive?: boolean } = {}): FleetMissionVisibility {
    const settlement = this.walletSettlement(wallet);
    const walletLower = wallet.toLowerCase();
    const ownedPlanetIds = new Set(
      this.settledPlanetsForOwner(wallet)
        .map((planet) => planet.planetId)
    );
    const includeArchive = options.includeArchive !== false;
    const summaries = this.activeFleetMissionsForWalletVisibility(wallet, [...ownedPlanetIds]);
    // VEY-KANEO-456: index every mission by id so an incoming attack can resolve the allied AcsDefend
    // fleets stationed against it (linked by `counterplayDefenderMissionIds`) into per-defender detail
    // for the Stationed defenses panel. `nowSeconds` drives the lazy as-of-now reconciliation that hides
    // holds which have already elapsed — derived on read from indexed state, no chain read, no poller.
    const summariesById = new Map(summaries.map((mission) => [mission.missionId, mission]));
    const nowSeconds = Math.floor(Date.now() / 1_000);

    const incoming = summaries
      .filter((mission) =>
        isVisibleActiveFleetMission(mission)
        && mission.owner.toLowerCase() !== walletLower
        && ownedPlanetIds.has(mission.targetPlanetId)
        && ["Attack", "AcsAttack", "MissileAttack"].includes(mission.missionType)
        && mission.status === "Outbound"
      )
      .map((attack) => ({
        ...attack,
        stationedDefenders: this.stationedDefendersForAttack(attack, summariesById, nowSeconds)
      }));

    // VEY-KANEO-471: prepend a synthetic populated incoming attack so QA can verify the Stationed
    // defenses panel deterministically. Hard-gated to non-production by config, and additionally only
    // emitted when the wallet actually owns a planet to target — so it never fabricates ownership.
    const syntheticIncoming = this.qaSyntheticStationedDefenders
      ? this.syntheticStationedDefenseAttack(wallet, ownedPlanetIds, nowSeconds)
      : null;

    const visibleIncoming = syntheticIncoming ? [syntheticIncoming, ...incoming] : incoming;
    const outgoing = summaries.filter((mission) =>
      isVisibleActiveFleetMission(mission)
      && mission.owner.toLowerCase() === walletLower
      && mission.status === "Outbound"
    );
    const returning = summaries.filter((mission) =>
      isVisibleActiveFleetMission(mission)
      && mission.owner.toLowerCase() === walletLower
      && (mission.status === "Returning" || mission.status === "Recalled")
    );
    const joinableAttacks = summaries.filter((mission) =>
      isVisibleActiveFleetMission(mission)
      && mission.owner.toLowerCase() !== walletLower
      && !ownedPlanetIds.has(mission.targetPlanetId)
      && mission.missionType === "Attack"
      && mission.status === "Outbound"
    );

    if (!includeArchive) {
      const activeMissions = [
        ...visibleIncoming,
        ...outgoing,
        ...returning,
        ...joinableAttacks
      ];
      return {
        wallet,
        homePlanetId: settlement.homePlanetId,
        incoming: visibleIncoming,
        outgoing,
        returning,
        joinableAttacks,
        completedMissions: [],
        battleReports: this.indexedBattleReportsForMissions(activeMissions)
      };
    }

    const archive = this.fleetMissionArchive(wallet);
    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      incoming: visibleIncoming,
      outgoing,
      returning,
      joinableAttacks,
      completedMissions: archive.completedMissions,
      battleReports: this.indexedBattleReportsForMissions(archive.completedMissions.slice(0, 100))
    };
  }

  fleetMissionArchive(
    wallet: `0x${string}`
  ): Pick<FleetMissionVisibility, "battleReports" | "completedMissions" | "homePlanetId" | "wallet"> & { ownedPlanetIds: Set<string> } {
    const settlement = this.walletSettlement(wallet);
    const walletLower = wallet.toLowerCase();
    const ownedPlanetIds = new Set(
      this.settledPlanetsForOwner(wallet)
        .map((planet) => planet.planetId)
    );
    const completedMissions = this.completedFleetMissionsForWalletFromCanonicalRows(wallet, ownedPlanetIds);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      ownedPlanetIds,
      completedMissions,
      battleReports: []
    };
  }

  fleetMission(missionId: string): FleetMissionSummary | null {
    const mission = this.fleetMissionSummariesFromCanonicalRowsByIds([missionId])[0]
      ?? (
        this.metadata("lastFleetMissionsReconciledAt") === null
          ? this.eventDerivedFleetMissionForMissionId(missionId)
          : null
      );
    return mission ? this.withDefenseHoldCombatOutcome(this.fleetMissionSummaryAsOfNow(mission)) : null;
  }

  private withDefenseHoldCombatOutcome(mission: FleetMissionSummary): FleetMissionSummary {
    if (mission.missionType !== "DefenseHold") return mission;
    const eventMission = this.decodedMissionLogs().eventMissions.find((candidate) => candidate.missionId === mission.missionId);
    const historicalMission = eventMission?.missionType === "DefenseHold"
      ? {
          ...mission,
          ...(eventMission.defenseHoldOutcome ? { defenseHoldOutcome: eventMission.defenseHoldOutcome } : {})
        }
      : mission;
    const directRows = this.db.query(`
      SELECT reports.report_json
      FROM indexed_battle_report_read_models reports
      WHERE reports.status = 'ready'
        AND reports.report_json IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(reports.report_json, '$.stationedDefenders') defenders
          WHERE json_extract(defenders.value, '$.missionId') = ?
      )
      ORDER BY CAST(reports.block_number AS INTEGER) DESC
      LIMIT 1
    `).all(mission.missionId) as Array<Pick<BattleReportReadModelRow, "report_json">>;
    const targetRows = directRows.length > 0 ? [] : this.db.query(`
      SELECT report_json
      FROM indexed_battle_report_read_models
      WHERE status = 'ready'
        AND report_json IS NOT NULL
        AND json_extract(report_json, '$.targetPlanetId') = ?
      ORDER BY CAST(block_number AS INTEGER) DESC
      LIMIT 100
    `).all(mission.targetPlanetId) as Array<Pick<BattleReportReadModelRow, "report_json">>;
    for (const row of [...directRows, ...targetRows]) {
      if (!row.report_json) continue;
      try {
        const report = parseEvent<BattleReport>(row.report_json);
        const attack = this.fleetMissionSummariesFromCanonicalRowsByIds([report.missionId])[0]
          ?? this.eventDerivedFleetMissionForMissionId(report.missionId);
        const defenders = report.stationedDefenders ?? this.stationedDefendersForBattle(attack, report);
        const defender = defenders.find((candidate) => candidate.missionId === mission.missionId);
        if (!defender) continue;
        return {
          ...historicalMission,
          originalShips: positiveShipCounts(defender.ships),
          destroyedShips: defender.destroyedShips ?? null,
          survivingShips: defender.survivingShips ?? null,
          ...(defender.lifecycleOutcome === "Recalled" || defender.lifecycleOutcome === "Expired"
            ? { defenseHoldOutcome: defender.lifecycleOutcome }
            : {})
        };
      } catch {
        continue;
      }
    }
    return { ...historicalMission, originalShips: positiveShipCounts(mission.ships) };
  }

  stationedDefendersForPlanet(planetId: string, asOfSeconds = Math.floor(Date.now() / 1_000)): StationedDefenderSummary[] {
    return this.activeFleetMissionsFromCanonicalRowsForTarget(planetId, { includeOverduePendingRandomness: true })
      .filter((mission) => this.isActiveDefenseHoldForPlanet(mission, planetId, asOfSeconds))
      .map((mission) => this.stationedDefenderSummary(mission, this.defenseHoldWindowEnd(mission)))
      .sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  stationedDefendersForBattle(
    attack: FleetMissionSummary | null | undefined,
    report: BattleReport | null | undefined
  ): StationedDefenderSummary[] {
    if (!attack && !report) return [];
    const attackArrival = Number(attack?.arrivalAt);
    if (!Number.isFinite(attackArrival)) return [];

    const defenders = new Map<string, FleetMissionSummary>();

    if (attack) {
      const counterplayDefenders = this.fleetMissionSummariesFromCanonicalRowsByIds(attack.counterplayDefenderMissionIds ?? []);
      for (const defender of counterplayDefenders) {
        if (!defender || !this.isBattleTimeCounterplay(defender, attack, attackArrival)) continue;
        defenders.set(defender.missionId, defender);
      }
    }

    const targetPlanetId = report?.targetPlanetId ?? attack?.targetPlanetId;
    if (targetPlanetId) {
      // Historical reports must not depend on the current active roster. Decode immutable launch,
      // DefenseHoldStationed/Ended, recall, and return logs so a hold remains attributable after it
      // is recalled, expires, lands, or is wiped out in combat.
      for (const defender of this.decodedMissionLogs().eventMissions) {
        if (!this.isBattleTimeDefenseHoldForPlanet(defender, targetPlanetId, attackArrival)) continue;
        defenders.set(defender.missionId, defender);
      }
    }

    const compositions = this.stationedDefenderBattleCompositions([...defenders.values()], report);
    return [...defenders.values()]
      .map((defender) => this.stationedDefenderSummary(
        defender,
        defender.missionType === "DefenseHold" ? this.defenseHoldWindowEnd(defender) : this.counterplayHoldUntil(defender),
        compositions.get(defender.missionId)
      ))
      .sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  battleReport(missionId: string, options: { includeRawFallback?: boolean } = { includeRawFallback: false }): BattleReport | null {
    const mission = this.fleetMissionSummariesFromCanonicalRowsByIds([missionId])[0] ?? null;
    const reports = mission
      ? this.indexedBattleReportsForMissions([mission], options)
      : this.battleReportsForMissionIds([missionId], options);
    return reports.find((report) => associatedBattleReportMissionIds(report).includes(missionId)) ?? null;
  }

  battleReportMaterializationStatus(missionId: string): {
    status: "missing" | "pending" | "ready" | "failed";
    attempts?: number;
    durationMs?: number | null;
    error?: string | null;
    updatedAt?: string;
  } {
    const row = this.db.query(`
      SELECT status, attempts, duration_ms, error, updated_at
      FROM indexed_battle_report_read_models
      WHERE mission_id = ?
    `).get(missionId) as Pick<BattleReportReadModelRow, "status" | "attempts" | "duration_ms" | "error" | "updated_at"> | null;
    if (!row) return { status: "missing" };
    return {
      status: row.status,
      attempts: row.attempts,
      durationMs: row.duration_ms,
      error: row.error,
      updatedAt: row.updated_at
    };
  }

  battleReports(limit = 100): BattleReport[] {
    return this.recentBattleReports(limit);
  }

  battleReportsForMissions(missions: readonly FleetMissionSummary[]): BattleReport[] {
    return this.indexedBattleReportsForMissions(missions);
  }

  async drainBattleReportMaterializationQueue(): Promise<void> {
    await Promise.resolve();
  }

  pendingBattleReportMaterializationMissionIds(limit = 100): string[] {
    const boundedLimit = Math.max(1, Math.min(2_000, Math.trunc(limit) || 100));
    const queued = this.db.query(`
      SELECT mission_id
      FROM indexed_battle_report_read_models
      WHERE status IN ('pending', 'failed')
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        CAST(COALESCE(block_number, '0') AS INTEGER) ASC,
        updated_at ASC
      LIMIT ?
    `).all(boundedLimit) as Array<{ mission_id: string }>;
    const ids = queued.map((row) => row.mission_id);
    if (ids.length >= boundedLimit) return ids;

    const missing = this.db.query(`
      SELECT json_extract(event_json, '$.topics[1]') AS mission_topic,
        MAX(CAST(block_number AS INTEGER)) AS latest_block
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
        AND json_extract(event_json, '$.topics[1]') IS NOT NULL
      GROUP BY mission_topic
      ORDER BY latest_block ASC
      LIMIT ?
    `).all(Math.min(2_000, boundedLimit * 4)) as Array<{ mission_topic: string | null }>;
    for (const row of missing) {
      const missionId = missionIdFromTopic(row.mission_topic);
      if (!missionId || ids.includes(missionId)) continue;
      if (this.battleReportMaterializationStatus(missionId).status === "ready") continue;
      ids.push(missionId);
      if (ids.length >= boundedLimit) break;
    }
    return ids;
  }

  // Every active mission across the universe (all players), for the Mission Control "All" active tab.
  allActiveFleetMissions(): FleetMissionSummary[] {
    return this.activeFleetMissionsFromCanonicalRows();
  }

  // Every completed mission across the universe (all players), newest-first, for the past "All" tab.
  allCompletedFleetMissions(): FleetMissionSummary[] {
    return this.indexedFleetMissionReferenceIndex().completed;
  }

  activeFleetMissionsForTarget(planetId: string): FleetMissionSummary[] {
    return this.activeFleetMissionsFromCanonicalRowsForTarget(planetId);
  }

  dueUnresolvedFleetMissionsForPlanet(planetId: string, asOfSeconds = nowSeconds()): FleetMissionSummary[] {
    // Include over-due attacks awaiting randomness: they are hidden from active report/intel surfaces,
    // but still block planet actions until settled. Keep this on canonical rows so infrastructure reads
    // do not cold-decode the full historical mission log.
    const candidates = this.activeFleetMissionsFromCanonicalRowsForPlanetTouching(planetId, { includeOverduePendingRandomness: true }).filter((mission) =>
      mission.status === "Outbound"
        && (mission.missionType === "Attack" || mission.missionType === "Harvest")
        && Number(mission.arrivalAt) <= asOfSeconds
        && mission.needsResolution !== true
        && (mission.originPlanetId === planetId || mission.targetPlanetId === planetId)
    ).sort((left, right) => Number(left.arrivalAt) - Number(right.arrivalAt));
    const resolvedBattleMissionIds = this.resolvedBattleMissionIdsForMissions(candidates.map((mission) => mission.missionId));
    return candidates.filter((mission) => !resolvedBattleMissionIds.has(mission.missionId));
  }

  private resolvedBattleMissionIds(): ReadonlySet<string> {
    const cached = this.resolvedBattleMissionIdsCache;
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.battleReportGeneration === this.battleReportGeneration
    ) {
      return cached.missionIds;
    }
    const missionIds = new Set<string>();
    for (const report of this.decodedBattleReportsOnly()) {
      missionIds.add(report.missionId);
      for (const participant of report.participants) {
        missionIds.add(participant.missionId);
      }
    }
    this.resolvedBattleMissionIdsCache = {
      missionGeneration: this.missionGeneration,
      battleReportGeneration: this.battleReportGeneration,
      missionIds
    };
    return missionIds;
  }

  private resolvedBattleMissionIdsForMissions(missionIds: Iterable<string>): ReadonlySet<string> {
    const resolvedMissionIds = new Set<string>();
    for (const report of this.battleReportsForMissionIds(missionIds)) {
      resolvedMissionIds.add(report.missionId);
      for (const participant of report.participants) {
        resolvedMissionIds.add(participant.missionId);
      }
    }
    return resolvedMissionIds;
  }

  pendingFleetSlotSettlementMissionsForWallet(wallet: `0x${string}`, asOfSeconds = nowSeconds()): FleetMissionSummary[] {
    const walletLower = wallet.toLowerCase();
    return this.activeFleetMissionsFromCanonicalRowsForOwner(wallet, { includeOverduePendingRandomness: true })
      .filter((mission) =>
        mission.owner.toLowerCase() === walletLower
        && fleetSlotSettlementBlocksLaunch(mission, asOfSeconds)
      )
      .sort((left, right) => fleetSlotSettlementDueAt(left) - fleetSlotSettlementDueAt(right));
  }

  infrastructureRows(planetId: string): InfrastructureState["buildings"] {
    const completedLevels = new Map<number, number>();
    for (const queue of this.queueSettlement(`building:${planetId}`).completed) {
      if (typeof queue.itemId === "number" && typeof queue.targetLevel === "number") {
        completedLevels.set(queue.itemId, Math.max(completedLevels.get(queue.itemId) ?? 0, queue.targetLevel));
      }
    }
    const levels = this.indexedLevelsById("contract_building_levels", "building_id", "level", planetId);

    return deriveBuildingRows((id) => Math.max(
      levels.get(id) ?? 0,
      completedLevels.get(id) ?? 0
    ));
  }

  shipRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): ShipyardState["ships"] {
    const counts = this.indexedLevelsById("contract_ship_counts", "ship_id", "count", planetId);
    const completedQueueQuantities = this.completedQueueQuantities(`ship:${planetId}`);
    return deriveShipRows(
      (id) => (counts.get(id) ?? 0) + (completedQueueQuantities.get(id) ?? 0),
      this.planet(planetId)?.temperature,
      durationLevels
    );
  }

  resourceProjectionRows(planetId: string, owner: `0x${string}`): {
    buildings: InfrastructureState["buildings"];
    ships: ShipyardState["ships"];
    technologyLevels: Record<string, number>;
  } {
    return {
      buildings: this.contractInfrastructureRows(planetId),
      ships: this.contractShipRows(planetId),
      technologyLevels: this.contractTechnologyLevels(owner)
    };
  }

  completedBuildingQueues(planetId: string): QueueState[] {
    return this.queueSettlement(`building:${planetId}`).completed;
  }

  private contractInfrastructureRows(planetId: string): InfrastructureState["buildings"] {
    const levels = this.indexedLevelsById("contract_building_levels", "building_id", "level", planetId);
    return deriveBuildingRows((id) => levels.get(id) ?? 0);
  }

  private contractShipRows(planetId: string): ShipyardState["ships"] {
    const counts = this.indexedLevelsById("contract_ship_counts", "ship_id", "count", planetId);
    return deriveShipRows(
      (id) => counts.get(id) ?? 0,
      this.planet(planetId)?.temperature
    );
  }

  private contractDefenseRows(planetId: string): DefenseState["defenses"] {
    const counts = this.indexedLevelsById("contract_defense_counts", "defense_id", "count", planetId);
    return deriveDefenseRows(
      (id) => counts.get(id) ?? 0
    );
  }

  private moonShipRows(planetId: string): ShipyardState["ships"] {
    const counts = this.indexedLevelsById("contract_moon_ship_counts", "ship_id", "count", planetId);
    return deriveShipRows(
      (id) => counts.get(id) ?? 0,
      this.planet(planetId)?.temperature
    );
  }

  private moonDefenseRows(planetId: string): DefenseState["defenses"] {
    const counts = this.indexedLevelsById("contract_moon_defense_counts", "defense_id", "count", planetId);
    return deriveDefenseRows((id) => counts.get(id) ?? 0);
  }

  private moonResources(planetId: string | null): Resources {
    if (!planetId) return zeroResources();
    const row = this.moonResourceSnapshot(planetId);
    return row
      ? { metal: row.metal, crystal: row.crystal, deuterium: row.deuterium }
      : zeroResources();
  }

  availableShipRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): ShipyardState["ships"] {
    const counts = this.indexedLevelsById("contract_ship_counts", "ship_id", "count", planetId);
    const completedQueueQuantities = this.completedQueueQuantities(`ship:${planetId}`);
    return deriveShipRows(
      (id) => (counts.get(id) ?? 0) + (completedQueueQuantities.get(id) ?? 0),
      this.planet(planetId)?.temperature,
      durationLevels
    );
  }

  // NOTE: the combat-triggered bounded per-planet canonical reconcile (planetReconcileBlock /
  // setPlanetReconcileBlock / drainFleetMissionReconcilePlanets / reconcilePlanetState) has been REMOVED.
  // It re-read a planet's authoritative ship/defense/resource state from the contract on every settled
  // combat fleet mission. Under the canonical-mirror contract NO runtime event may issue an RPC read —
  // contract_* is seeded once at startup and maintained thereafter solely by event-listener callbacks.
  // Ship/defense debits from combat now rely on the contract's PlanetShipCountChanged /
  // PlanetDefenseCountChanged events, which applyShipCountChangedEvent / applyDefenseCountChangedEvent
  // already integrate authoritatively from the event stream.

  defenseRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): DefenseState["defenses"] {
    const counts = this.indexedLevelsById("contract_defense_counts", "defense_id", "count", planetId);
    const completedQueueQuantities = this.completedQueueQuantities(`defense:${planetId}`);
    return deriveDefenseRows(
      (id) => (counts.get(id) ?? 0) + (completedQueueQuantities.get(id) ?? 0),
      durationLevels
    );
  }

  technologyLevels(wallet: `0x${string}`): Record<string, number> {
    const levels = this.contractTechnologyLevels(wallet);
    for (const queue of this.queueSettlement(`research:${wallet.toLowerCase()}`).completed) {
      if (typeof queue.itemId === "number" && typeof queue.targetLevel === "number") {
        const key = String(queue.itemId);
        levels[key] = Math.max(levels[key] ?? 0, queue.targetLevel);
      }
    }
    return levels;
  }

  private contractTechnologyLevels(wallet: `0x${string}`): Record<string, number> {
    const normalizedWallet = wallet.toLowerCase();
    const cache = this.technologyLevelsCacheForCurrentVersion();
    const cached = cache.values.get(normalizedWallet);
    if (cached) return { ...cached };

    const rows = this.db.query(`
      SELECT technology_id AS id, level AS value
      FROM contract_technology_levels
      WHERE owner = lower(?)
      ORDER BY technology_id ASC
    `).all(wallet) as LevelRow[];

    const levels = Object.fromEntries(rows.map((row) => [String(row.id), row.value]));
    cache.values.set(normalizedWallet, levels);
    return { ...levels };
  }

  fleetSlots(wallet: `0x${string}`): ShipyardState["fleetSlots"] {
    const walletLower = wallet.toLowerCase();
    const asOfSeconds = nowSeconds();
    const active = this.activeFleetMissionsFromCanonicalRowsForOwner(wallet)
      .filter((mission) =>
        mission.owner.toLowerCase() === walletLower
        && !fleetSlotFreedByLazyLaunchSettlement(mission, asOfSeconds)
      )
      .length;
    const technologyLevels = this.technologyLevels(wallet);

    return {
      active,
      limit: 1 + (technologyLevels["4"] ?? 0)
    };
  }

  technologyRows(wallet: `0x${string}`, labLevel?: number): ResearchState["technologies"] {
    const levels = this.technologyLevels(wallet);
    return deriveTechnologyRows((id) => levels[String(id)] ?? 0, labLevel);
  }

  private queueSettlement(queueKeyValue: string, nowSec = nowSeconds()) {
    return settleQueueAsOfNow(this.queueState(queueKeyValue), nowSec);
  }

  private completedQueueQuantities(queueKeyValue: string): Map<number, number> {
    const quantities = new Map<number, number>();
    for (const queue of this.queueSettlement(queueKeyValue).completed) {
      if (typeof queue.itemId === "number" && typeof queue.quantity === "number") {
        quantities.set(queue.itemId, (quantities.get(queue.itemId) ?? 0) + queue.quantity);
      }
    }
    return quantities;
  }

  private moonBuildingLevelAsOfNow(planetId: string, buildingId: number): number {
    // Moon buildings serve the contract-authoritative table directly, like planet buildings.
    return this.indexedLevel("contract_moon_building_levels", "moon_building_id", planetId, buildingId);
  }

  private moonDefenseCountAsOfNow(planetId: string, defenseId: number): number {
    return this.indexedLevel("contract_moon_defense_counts", "defense_id", planetId, defenseId);
  }

  highscoreForWallet(wallet: `0x${string}`, planetIds?: string[]): HighscoreEntry {
    const settlement = this.walletSettlement(wallet);
    const ownedPlanets = (planetIds?.length
      ? planetIds.map((planetId) => this.planet(planetId)).filter((planet): planet is SettledPlanetEvent => (
        planet !== null && planet.owner.toLowerCase() === wallet.toLowerCase()
      ))
      : this.rows<SettledPlanetEvent>(
        "SELECT event_json FROM indexed_planets WHERE owner = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
        wallet
      ));
    const contractTechnologies = this.contractTechnologyLevels(wallet);

    return calculateIndexedHighscore({
      wallet,
      homePlanetId: settlement.homePlanetId,
      planetCount: ownedPlanets.length,
      planets: ownedPlanets.map((planet) => ({
        buildings: this.contractInfrastructureRows(planet.planetId).map(({ id, level }) => ({ id, level })),
        defenses: this.contractDefenseRows(planet.planetId).map(({ id, count }) => ({ id, count })),
        ships: this.contractShipRows(planet.planetId).map(({ id, count }) => ({ id, count }))
      })),
      technologies: deriveTechnologyRows((id) => contractTechnologies[String(id)] ?? 0)
        .map(({ id, level }) => ({ id, level }))
    });
  }

  highscoreEntriesForOwners(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): HighscoreEntry[] {
    const ownersAndPlanets = [...planetsByOwner.entries()];
    if (ownersAndPlanets.length === 0) return [];

    const planetIds = ownersAndPlanets.flatMap(([, planets]) => planets.map((planet) => planet.planetId));
    const buildingsByPlanet = this.indexedPlanetLevelRows("contract_building_levels", "building_id", "level", planetIds);
    const moonBuildingsByPlanet = this.indexedPlanetLevelRows("contract_moon_building_levels", "moon_building_id", "level", planetIds);
    const defensesByPlanet = this.indexedPlanetLevelRows("contract_defense_counts", "defense_id", "count", planetIds);
    const shipsByPlanet = this.indexedPlanetLevelRows("contract_ship_counts", "ship_id", "count", planetIds);
    const technologiesByOwner = this.indexedTechnologyLevelRows(ownersAndPlanets.map(([owner]) => owner));

    return ownersAndPlanets.map(([owner, planets]) => {
      const homePlanet = planets.find((planet) => planet.eventName === "PlanetStarted") ?? planets[0] ?? null;
      return calculateIndexedHighscore({
        wallet: owner as Address,
        homePlanetId: homePlanet?.planetId ?? null,
        planetCount: planets.length,
        planets: planets.map((planet) => ({
          buildings: levelRows(buildingsByPlanet.get(planet.planetId)),
          moonBuildings: levelRows(moonBuildingsByPlanet.get(planet.planetId)),
          defenses: countRows(defensesByPlanet.get(planet.planetId)),
          ships: countRows(shipsByPlanet.get(planet.planetId))
        })),
        technologies: levelRows(technologiesByOwner.get(owner.toLowerCase()))
      });
    });
  }

  // Whole-universe highscore leaderboard, memoized against the persisted indexed-state generation.
  // Reader workers do not see the writer's in-memory stateGeneration, so this uses the shared DB
  // token to avoid serving stale Raid Finder planet resources after another process indexes a spend
  // or raid settlement. (VEY-KANEO-467)
  highscoreLeaderboard(): { planetsByOwner: Map<string, SettledPlanetEvent[]>; entries: HighscoreEntry[] } {
    const generation = this.indexedStateCacheVersion();
    const cached = this.leaderboardCache;
    if (cached && cached.generation === generation) {
      return cached;
    }
    const planetsByOwner = this.settledPlanetsByOwner();
    const entries = this.highscoreEntriesForOwners(planetsByOwner);
    this.leaderboardCache = {
      generation,
      planetsByOwner,
      entries
    };
    return this.leaderboardCache;
  }

  // Monotonic state version, bumped on every applied mutation. Lets read paths key their own
  // memoization off "has the indexed state changed since I last computed this?" (VEY-KANEO-467).
  stateVersion(): number {
    return this.stateGeneration;
  }

  responseCacheVersion(): string {
    // Reader workers do not receive the writer worker's in-memory `stateGeneration`, so route-level
    // caches must include a token persisted into the shared WAL database.
    return `${this.indexedStateCacheVersion()}:${this.currentMissionReadModelDbVersion()}:${this.currentBattleReportReadModelDbVersion()}:${this.productionQueueProjectionCacheVersion()}`;
  }

  universeSystemSummaryVersion(galaxy: number, system: number): string {
    return [
      this.universeSystemFingerprint(galaxy, system, "planets", `
        SELECT planet.planet_id || ':' || planet.owner || ':' || COALESCE(planet.name, '') || ':' || planet.position || ':' || planet.fields || ':' || planet.temperature || ':' || planet.event_json AS value
        FROM contract_planets planet
        WHERE planet.galaxy = ? AND planet.system_number = ?
        ORDER BY planet.position ASC
      `),
      this.universeSystemFingerprint(galaxy, system, "profiles", `
        SELECT profile.wallet || ':' || COALESCE(profile.display_name, '') || ':' || profile.updated_at AS value
        FROM player_profiles profile
        WHERE profile.wallet IN (
          SELECT lower(planet.owner)
          FROM contract_planets planet
          WHERE planet.galaxy = ? AND planet.system_number = ?
        )
        ORDER BY profile.wallet ASC
      `),
      this.universeSystemFingerprint(galaxy, system, "alliances", `
        SELECT member.wallet || ':' || member.alliance_id || ':' || alliance.tag || ':' || alliance.name || ':' || alliance.active AS value
        FROM contract_alliance_members member
        INNER JOIN contract_alliances alliance ON alliance.alliance_id = member.alliance_id
        WHERE member.wallet IN (
          SELECT lower(planet.owner)
          FROM contract_planets planet
          WHERE planet.galaxy = ? AND planet.system_number = ?
        )
        ORDER BY member.wallet ASC, member.alliance_id ASC
      `),
      this.universeSystemFingerprint(galaxy, system, "debris", `
        SELECT debris.planet_id || ':' || debris.metal || ':' || debris.crystal || ':' || debris.block_number || ':' || debris.event_json AS value
        FROM contract_debris_fields debris
        INNER JOIN contract_planets planet ON planet.planet_id = debris.planet_id
        WHERE planet.galaxy = ? AND planet.system_number = ?
        ORDER BY planet.position ASC
      `),
      this.universeSystemFingerprint(galaxy, system, "moons", `
        SELECT moon.planet_id || ':' || moon.exists_flag || ':' || COALESCE(moon.fields, '') || ':' || COALESCE(moon.diameter_km, '') || ':' || COALESCE(moon.created_at, '') || ':' || COALESCE(moon.event_json, '') AS value
        FROM contract_moons moon
        INNER JOIN contract_planets planet ON planet.planet_id = moon.planet_id
        WHERE planet.galaxy = ? AND planet.system_number = ?
        ORDER BY planet.position ASC
      `),
      this.universeSystemFingerprint(galaxy, system, "moon-chance", `
        SELECT report.report_key || ':' || report.target_planet_id || ':' || report.battle_id || ':' || COALESCE(report.outcome_id, '') || ':' || report.block_number || ':' || report.event_json AS value
        FROM contract_moon_chance_reports report
        INNER JOIN contract_planets planet ON planet.planet_id = report.target_planet_id
        WHERE planet.galaxy = ? AND planet.system_number = ?
        ORDER BY planet.position ASC, report.block_number ASC
      `)
    ].join("|");
  }

  materializedUniverseSystemSnapshot(cacheKey: string, version: string): unknown | null {
    const row = this.db.query(`
      SELECT version, payload_json
      FROM contract_universe_system_snapshots
      WHERE cache_key = ?
    `).get(cacheKey) as UniverseSystemSnapshotRow | null;
    if (!row || row.version !== version) return null;
    try {
      return JSON.parse(row.payload_json);
    } catch {
      this.db.query("DELETE FROM contract_universe_system_snapshots WHERE cache_key = ?").run(cacheKey);
      return null;
    }
  }

  storeMaterializedUniverseSystemSnapshot(cacheKey: string, version: string, payload: unknown): void {
    this.db.query(`
      INSERT INTO contract_universe_system_snapshots (cache_key, version, payload_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        version = excluded.version,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(cacheKey, version, JSON.stringify(payload), new Date().toISOString());
  }

  missionResponseCacheVersion(): string {
    return `${this.currentMissionReadModelDbVersion()}:${this.currentBattleReportReadModelDbVersion()}`;
  }

  indexedStateCacheVersion(): string {
    return this.metadata(indexedStateVersionMetadataKey) ?? this.stateGeneration.toString();
  }

  private productionQueueProjectionCacheVersion(nowSec = nowSeconds()): string {
    const rows = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json
      FROM contract_production_queues
      WHERE queue_kind IN ('ship', 'defense')
    `).all() as QueueRow[];

    let completed = 0;
    let nextReadyAt: number | null = null;
    for (const row of rows) {
      const queue = this.productionQueueFromRow(row);
      if (row.backlog_json) {
        const backlog = parseEvent<QueueState[]>(row.backlog_json);
        const sanitizedBacklog = this.sanitizedProductionBacklog(row.queue_kind, queue, Array.isArray(backlog) ? backlog : []);
        if (sanitizedBacklog.length > 0) queue.backlog = sanitizedBacklog;
      }
      const settlement = settleQueueAsOfNow(queue, nowSec);
      completed += settlement.completed.length;
      const readyAt = Number(settlement.queue?.readyAt);
      if (Number.isFinite(readyAt) && readyAt > nowSec) {
        nextReadyAt = nextReadyAt === null ? readyAt : Math.min(nextReadyAt, readyAt);
      }
    }

    return `pq:${completed}:${nextReadyAt ?? "none"}`;
  }

  checkpointWal(mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"): Array<{ busy: number; log: number; checkpointed: number }> {
    return this.db.query(`PRAGMA wal_checkpoint(${mode})`).all() as Array<{ busy: number; log: number; checkpointed: number }>;
  }

  private indexedPlanetLevelRows(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_moon_defense_counts" | "contract_ship_counts",
    idColumn: "building_id" | "defense_id" | "moon_building_id" | "ship_id",
    valueColumn: "count" | "level",
    planetIds: readonly string[]
  ): Map<string, LevelRow[]> {
    const rowsByPlanet = new Map<string, LevelRow[]>();
    for (const planetIdChunk of chunks([...new Set(planetIds)], 500)) {
      if (planetIdChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT planet_id, ${idColumn} AS id, ${valueColumn} AS value
        FROM ${table}
        WHERE planet_id IN (${planetIdChunk.map(() => "?").join(",")})
        ORDER BY planet_id ASC, ${idColumn} ASC
      `).all(...planetIdChunk) as IndexedPlanetLevelRow[];
      for (const row of rows) {
        rowsByPlanet.set(row.planet_id, [...(rowsByPlanet.get(row.planet_id) ?? []), { id: row.id, value: row.value }]);
      }
    }
    return rowsByPlanet;
  }

  private indexedTechnologyLevelRows(owners: readonly string[]): Map<string, LevelRow[]> {
    const rowsByOwner = new Map<string, LevelRow[]>();
    const normalizedOwners = [...new Set(owners.map((owner) => owner.toLowerCase()))];
    for (const ownerChunk of chunks(normalizedOwners, 500)) {
      if (ownerChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT owner, technology_id AS id, level AS value
        FROM contract_technology_levels
        WHERE owner IN (${ownerChunk.map(() => "?").join(",")})
        ORDER BY owner ASC, technology_id ASC
      `).all(...ownerChunk) as IndexedTechnologyLevelRow[];
      for (const row of rows) {
        const owner = row.owner.toLowerCase();
        rowsByOwner.set(owner, [...(rowsByOwner.get(owner) ?? []), { id: row.id, value: row.value }]);
      }
    }
    return rowsByOwner;
  }

  planetQueue(planetId: string, kind: "building" | "defense" | "ship"): QueueState | null {
    return this.queueSettlement(`${kind}:${planetId}`).queue;
  }

  moonQueue(planetId: string): QueueState | null {
    return this.queueSettlement(`moon-building:${planetId}`).queue;
  }

  moonDefenseQueue(planetId: string): QueueState | null {
    return this.queueSettlement(`moon-defense:${planetId}`).queue;
  }

  researchQueue(wallet: `0x${string}`): QueueState | null {
    return this.queueSettlement(`research:${wallet.toLowerCase()}`).queue;
  }

  moonState(wallet: `0x${string}`, planetId: string | null): MoonState {
    const moon = planetId ? this.moon(planetId) : null;
    const resources = this.moonResources(planetId);
    const jumpGateDestinations = this.moonJumpGateDestinations(wallet, planetId);
    return {
      wallet,
      bodyKind: "moon",
      homePlanetId: planetId,
      parentPlanetId: planetId,
      moonAvailable: true,
      ...(moon ? {} : { unavailableReason: "No moon exists for this home planet yet." }),
      resources,
      resourcesAsOfNow: resources,
      ships: planetId ? this.moonShipRows(planetId) : [],
      moon: moon
        ? {
            exists: true,
            planetId: moon.planetId,
            owner: moon.owner,
            fields: moon.fields,
            diameterKm: moon.diameterKm,
            createdAt: moon.createdAt,
            jumpGateReadyAt: moon.jumpGateReadyAt ?? "0"
          }
        : null,
      buildings: moonBuildingRows.map((building) => ({
        ...building,
        level: planetId ? this.moonBuildingLevelAsOfNow(planetId, building.id) : 0,
        cost: zeroResources()
      })),
      fleet: planetId ? this.moonShipRows(planetId) : [],
      queue: planetId ? this.moonQueue(planetId) : null,
      technologyLevels: this.technologyLevels(wallet),
      defenses: moonDefenseRows.map((defense) => ({
        ...defense,
        count: planetId ? this.moonDefenseCountAsOfNow(planetId, defense.id) : 0,
        cost: zeroResources()
      })),
      defenseQueue: planetId ? this.moonDefenseQueue(planetId) : null,
      jumpGateDestinations
    };
  }

  private moonJumpGateDestinations(
    wallet: `0x${string}`,
    currentPlanetId: string | null
  ): NonNullable<MoonState["jumpGateDestinations"]> {
    if (!currentPlanetId) return [];
    const rows = this.db.query(`
      SELECT m.event_json
      FROM indexed_moons m
      JOIN contract_moon_building_levels b
        ON b.planet_id = m.planet_id
        AND b.moon_building_id = 2
        AND b.level > 0
      WHERE m.owner = lower(?)
        AND m.planet_id != ?
      ORDER BY CAST(m.planet_id AS INTEGER) ASC
    `).all(wallet, currentPlanetId) as MoonRow[];

    return rows.map((row) => {
      const moon = parseEvent<IndexedMoonCreatedEvent>(row.event_json);
      const coordinates = `${moon.galaxy}:${moon.system}:${moon.position}`;
      return {
        planetId: moon.planetId,
        label: `Moon ${coordinates}`,
        coordinates,
        jumpGateReadyAt: moon.jumpGateReadyAt ?? "0"
      };
    });
  }

  hasMoon(planetId: string): boolean {
    return Boolean(this.moon(planetId));
  }

  riftState(wallet: `0x${string}`, planetId: string | null): RiftState {
    const buildings = planetId ? this.infrastructureRows(planetId) : [];
    const levels = this.technologyLevels(wallet);
    const riftBuilt = planetId
      ? (buildings.find((building) => building.id === 15)?.level ?? 0) > 0
      : null;
    const balances = this.riftBalances(wallet, planetId);
    const balanceById = new Map(balances.map((row) => [row.resource_id, row]));
    const pending = this.pendingWithdrawals(wallet, planetId);
    return {
      wallet,
      homePlanetId: planetId,
      riftAvailable: riftBuilt !== null,
      unlocked: riftBuilt === true,
      ...(riftBuilt ? {} : {
        unavailableReason: riftBuilt === null
          ? "Settle a home planet before using the Rift."
          : "Build the Rift Stabilizer before using the Rift."
      }),
      withdrawalDelaySeconds: "2592000",
      requirements: riftRequirements(
        riftBuilt,
        buildings.find((building) => building.id === 4)?.level ?? 0,
        buildings.find((building) => building.id === 6)?.level ?? 0,
        levels
      ),
      resources: riftResourceRows.map((resource) => {
        const balance = balanceById.get(resource.resourceId);
        return {
          ...resource,
          tokenAddress: null,
          walletBalance: null,
          allowance: null,
          inGameBalance: balance?.in_game_balance ?? "0",
          lockedBalance: balance?.locked_balance ?? "0"
        };
      }),
      pendingWithdrawals: pending.map((row) => ({
        id: row.withdrawal_key,
        resource: riftResourceRows.find((resource) => resource.resourceId === row.resource_id)?.key ?? "metal",
        amount: row.amount,
        requestedAt: "0",
        unlocksAt: row.unlocks_at,
        ready: BigInt(row.unlocks_at) <= BigInt(Math.floor(Date.now() / 1000))
      }))
    };
  }

  applyEvent(event: SettledPlanetEvent): IndexerSnapshot {
    this.upsertPlanet(event);
    this.touch();
    return this.snapshot();
  }

  applyPlanetSettledEvent(event: PlanetSettledEvent): IndexerSnapshot {
    this.updatePlanetResources(event);
    this.touch();
    return this.snapshot();
  }

  applyMoonResourcesSettledEvent(event: MoonResourcesSettledEvent): IndexerSnapshot {
    this.upsertMoonResourceSnapshot(
      event.planetId,
      event.resources,
      event.lastSettledAt,
      event.transactionHash,
      event.blockNumber,
      event.logIndex
    );
    this.touch();
    return this.snapshot();
  }

  applyDebrisEvent(event: DebrisFieldEvent): IndexerSnapshot {
    this.upsertDebris(event);
    this.touch();
    return this.snapshot();
  }

  applyMoonChanceEvent(event: MoonChanceReportEvent): IndexerSnapshot {
    this.upsertMoonChanceReport(event);
    this.touch();
    return this.snapshot();
  }

  // Recording the log, advancing the indexed head, and applying the event's side effects must commit as
  // ONE atomic unit. Each was previously a separate auto-committed statement, so a handler that threw mid
  // way (e.g. a decode failure) left the event row already inserted — which reads as a permanent duplicate
  // on retry, so the side effect was lost forever — and left `latestIndexedBlock` advanced past an event
  // whose state never applied. That ahead-of-state head then froze the reconcile baseline above
  // already-returned fleets, hiding their ships from the shipyard. Wrapping the body in a transaction
  // means a throw rolls back the row and the head together, so the sync layer can re-apply the log cleanly.
  applyLog(log: IndexedRpcLog): ApplyLogResult {
    return this.db.transaction(() => this.applyLogAtomic(log))();
  }

  private applyLogAtomic(log: IndexedRpcLog): ApplyLogResult {
    const eventId = indexedLogKey(log);
    const existing = this.db.query("SELECT event_json FROM indexed_event_logs WHERE event_id = ?").get(eventId) as EventRow | null;
    if (existing) {
      if (log.removed) {
        this.markReorgDetected();
        this.recordRemovedLog(`${eventId}:removed`, log);
        return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
      }
      const repairedDerivedRows = this.repairDerivedRowsForExistingLog(eventId, parseEvent<IndexedRpcLog>(existing.event_json));
      if (repairedDerivedRows > 0) {
        if (isFleetMissionLog(log)) {
          if (this.applyFleetMissionCompatibilityEvent(log) > 0) {
            this.touch();
          }
        } else if (isBattleReportLog(log)) {
          if (this.applyBattleCompatibilityEvent(log) > 0) {
            this.touch();
          }
        } else if (isMoonChanceReportLog(log)) {
          this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
        } else if (isRandomnessFulfilledLog(log)) {
          this.touch();
        }
        return { applied: true, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
      }
      return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    const inserted = this.recordLog(eventId, log);
    if (!inserted) {
      return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    this.recordLatestBlock(log.blockNumber);

    if (log.removed) {
      this.markReorgDetected();
      this.markStale("removed log/reorg");
      return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
    }

    this.recordPlayerActivityFromLog(eventId, log);

    if (isSettledPlanetLog(log)) {
      this.applyEvent(decodeSettledPlanetLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isPlanetSettledLog(log)) {
      this.applyPlanetSettledEvent(decodePlanetSettledLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonResourcesSettledLog(log)) {
      this.applyMoonResourcesSettledEvent(decodeMoonResourcesSettledLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isPlanetRenamedLog(log)) {
      this.applyPlanetRenamedEvent(decodePlanetRenamedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isDebrisFieldLog(log)) {
      this.applyDebrisEvent(decodeDebrisFieldLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isShipCountChangedLog(log)) {
      this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonResourcesChangedLog(log)) {
      this.applyMoonResourcesChangedEvent(decodeMoonResourcesChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isDefenseCountChangedLog(log)) {
      this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonShipCountChangedLog(log)) {
      this.applyMoonShipCountChangedEvent(decodeMoonShipCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonDefenseCountChangedLog(log)) {
      this.applyMoonDefenseCountChangedEvent(decodeMoonDefenseCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isInterplanetaryMissileAttackLog(log)) {
      this.applyInterplanetaryMissileAttackCompatibilityEvent(decodeInterplanetaryMissileAttackLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isStartPriceUpdatedLog(log)) {
      this.applyStartPriceUpdatedEvent(eventId, decodeStartPriceUpdatedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isReferralClaimLog(log)) {
      this.applyReferralClaimEvent(eventId, decodeReferralClaimLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isReferralRedemptionLog(log)) {
      this.applyReferralRedemptionEvent(eventId, decodeReferralRedemptionLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isReferralRewardClaimLog(log)) {
      this.applyReferralRewardClaimEvent(eventId, decodeReferralRewardClaimLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isIndexedQueueStartedLog(log)) {
      this.applyQueueStartedEvent(decodeIndexedQueueStartedLog(log), {
        settledAt: blockTimestampSeconds(log) ?? Math.floor(Date.now() / 1_000).toString()
      });
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isIndexedQueueCompletedLog(log)) {
      this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonCreatedLog(log)) {
      this.applyMoonCreatedEvent(decodeMoonCreatedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonJumpGateLog(log)) {
      this.applyMoonJumpGateEvent(decodeMoonJumpGateLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isRiftResourceLog(log)) {
      this.applyRiftResourceEvent(decodeRiftResourceLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isAllianceLog(log)) {
      this.applyAllianceEvent(decodeAllianceLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isFleetMissionLog(log)) {
      if (this.applyFleetMissionCompatibilityEvent(log) > 0) {
        this.touch();
      }
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isBattleReportLog(log)) {
      if (this.applyBattleCompatibilityEvent(log) > 0) {
        this.touch();
      }
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonChanceReportLog(log)) {
      this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isRandomnessFulfilledLog(log)) {
      // VEY-KANEO-479: the log is already persisted in indexed_event_logs above; fleet-mission readiness
      // derives the fulfilled-request set from it on read (fulfilledRandomnessRequestIds). Mark it
      // applied — and touch the index — so an arrived Attack flips to "Ready to resolve" on this event.
      this.touch();
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    return { applied: false, duplicate: false, ignored: true, removed: false, snapshot: this.snapshot() };
  }

  async rebuild(options: { deadlineMs?: number } = {}): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }

    const deadlineMs = options.deadlineMs ?? this.rebuildDeadlineMs;
    this.rebuildPromise = this.rebuildUncached(deadlineMs)
      .catch((error) => {
        this.recordReconciliationError(error);
        throw error;
      })
      .finally(() => {
        this.rebuildPromise = null;
        this.planetRebuildPromise = null;
      });
    this.planetRebuildPromise = this.rebuildPromise;
    return this.rebuildPromise;
  }

  async reconcile(reason = "requested"): Promise<IndexerSnapshot> {
    this.markStale(reason);
    return this.rebuild();
  }

  // NOTE: the periodic runtime canonical refresh (refreshCanonicalState/refreshCanonicalStateUncached)
  // has been REMOVED. The normal backend mutates the DB only from event-listener/event-replay callbacks
  // (applyLog). Canonical eth_call rebuild() remains an explicit operator/test tool, not a request path
  // or automatic startup self-heal.

  markStale(reason: string): IndexerSnapshot {
    this.setMetadata("pendingReconciliationReason", reason);
    return this.snapshot();
  }

  clearPendingReconciliationReason(reason: string): IndexerSnapshot {
    if (this.metadata("pendingReconciliationReason") === reason) {
      this.snapshotCache = null;
      this.db.query("DELETE FROM indexer_metadata WHERE key = 'pendingReconciliationReason'").run();
    }
    return this.snapshot();
  }

  healCanonicalPlanets(planetIds: string[]): Promise<void> {
    for (const planetId of planetIds) {
      if (this.planet(planetId)) this.targetedHealPlanetIds.add(planetId);
    }
    if (this.targetedHealPlanetIds.size === 0) return Promise.resolve();
    if (!this.targetedHealPromise) {
      this.targetedHealPromise = this.drainTargetedHealQueue()
        .catch((error) => {
          console.error("Veydrift targeted canonical heal failed", error);
        })
        .finally(() => {
          this.targetedHealPromise = null;
          if (this.targetedHealPlanetIds.size > 0) {
            void this.healCanonicalPlanets([]);
          }
        });
    }
    return this.targetedHealPromise;
  }

  private async drainTargetedHealQueue(): Promise<void> {
    if (!this.chainReader.getCanonicalPlanetState) return;
    const totalStats: CurrentStateHealStats = {
      planetsScanned: 0,
      shipMismatches: 0
    };

    while (this.targetedHealPlanetIds.size > 0) {
      const planetIds = [...this.targetedHealPlanetIds].slice(0, CANONICAL_READ_PLANET_CHUNK);
      for (const planetId of planetIds) {
        this.targetedHealPlanetIds.delete(planetId);
      }
      const planets = planetIds
        .map((planetId) => this.planet(planetId))
        .filter((planet): planet is SettledPlanetEvent => planet !== null);
      const stats = await this.healCurrentCanonicalPlanets(planets, CANONICAL_READ_PLANET_CHUNK);
      totalStats.planetsScanned += stats.planetsScanned;
      totalStats.shipMismatches += stats.shipMismatches;
    }

    if (totalStats.planetsScanned > 0) {
      await this.runHealWrite("targeted current-state heal metadata", () => {
        this.setMetadata("lastCurrentStateHealAt", new Date().toISOString());
        this.setMetadata("lastCurrentStateHealPlanetsScanned", totalStats.planetsScanned.toString());
        this.setMetadata("lastCurrentStateHealShipMismatches", totalStats.shipMismatches.toString());
        this.touch();
      });
    }
  }

  // NOTE: the request-time per-planet RPC self-heal (verifyCanonicalState / healPlanetCanonicalState) has
  // been removed. Runtime healing is allowed only from listener-triggered, queued, planet-scoped events
  // such as combat settlement, where the contract does not emit enough per-unit data to reconstruct exact
  // ship/defense survivors from logs alone. User reads never issue these RPC repairs.

  async replayContractLogs(fromBlock = this.fromBlock, toBlock: bigint | "latest" = "latest"): Promise<IndexerSnapshot> {
    if (!this.chainReader.listContractLogs) {
      throw new Error("contract log replay is unavailable: chain reader cannot list raw contract logs");
    }
    const logs = await this.chainReader.listContractLogs(fromBlock, toBlock);
    for (const log of sortRpcLogs(logs)) {
      this.applyLog(log);
    }
    this.rebuildMaterializedStateFromEventLogs();
    this.setMetadata("lastEventReplayAt", new Date().toISOString());
    if (typeof toBlock === "bigint") {
      this.recordLatestBlock(toBlock.toString());
    }
    return this.snapshot();
  }

  applyLegacyUnitMutationsFromEventLogs(): IndexerSnapshot {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
    `).all() as EventRow[];
    const logs = sortedEventRows(rows);
    const latestAbsoluteUnitTotals = latestAbsoluteUnitTotalsFromLogs(logs);

    let appliedMutations = 0;
    for (const log of logs) {
      if (isInterplanetaryMissileAttackLog(log)) {
        appliedMutations += this.applyGuardedInterplanetaryMissileAttackCompatibilityEvent(
          decodeInterplanetaryMissileAttackLog(log),
          latestAbsoluteUnitTotals,
          log
        );
      } else if (isFleetMissionReturnedLog(log)) {
        appliedMutations += this.applyReturnedFleetCompatibilityEvent(log);
      } else if (isBattleReportLog(log)) {
        appliedMutations += this.applyGuardedBattleCompatibilityEvent(log, latestAbsoluteUnitTotals);
      }
    }
    if (appliedMutations > 0) {
      this.setMetadata("lastLegacyUnitMutationReplayAt", new Date().toISOString());
      this.touch();
    }
    return this.snapshot();
  }

  async syncCanonicalState(
    fromBlock = this.fromBlock,
    toBlock: bigint | "latest" = "latest",
    options: { rebuildDeadlineMs?: number; planetConcurrency?: number } = {}
  ): Promise<{
    replay: IndexerSnapshot;
    rebuild: IndexerSnapshot;
  }> {
    const replay = await this.replayContractLogs(fromBlock, toBlock);
    void options.rebuildDeadlineMs;
    if (
      this.metadata("currentStateOneTimeHealCompletedAt")
      || !this.chainReader.listCurrentPlanets
      || !this.chainReader.getCanonicalPlanetState
    ) {
      return { replay, rebuild: this.snapshot() };
    }
    const rebuild = await this.startCurrentStateHealOnce("canonical-sync-one-time-heal", {
      planetConcurrency: options.planetConcurrency ?? CANONICAL_READ_PLANET_CHUNK
    });
    return { replay, rebuild };
  }

  async seedCurrentCanonicalState(options: { planetConcurrency?: number } = {}): Promise<IndexerSnapshot> {
    if (this.currentStateHealPromise) {
      return this.currentStateHealPromise;
    }

    this.currentStateHealPromise = this.seedCurrentCanonicalStateUncached(options)
      .catch((error) => {
        this.recordReconciliationError(error);
        throw error;
      })
      .finally(() => {
        this.currentStateHealPromise = null;
        this.currentStateHealRunId = null;
        this.planetRebuildPromise = null;
      });
    this.planetRebuildPromise = this.currentStateHealPromise;
    return this.currentStateHealPromise;
  }

  async seedCurrentAllianceState(): Promise<IndexerSnapshot> {
    const allianceDirectory = this.chainReader.listAllianceDirectoryState
      ? await this.chainReader.listAllianceDirectoryState()
      : [];
    const allianceJoinRequests = this.chainReader.listAllianceJoinRequestState
      ? await this.chainReader.listAllianceJoinRequestState()
      : null;
    const allianceDiplomacy = this.chainReader.listAllianceDiplomacyState
      ? await this.chainReader.listAllianceDiplomacyState()
      : null;

    await this.runHealWrite("alliance-only snapshots", () => {
      this.applyAllianceDirectorySnapshot(allianceDirectory);
      this.applyAllianceJoinRequestSnapshot(allianceJoinRequests);
      this.applyAllianceDiplomacySnapshot(allianceDiplomacy);
      this.recordSuccessfulAllianceReconciliation();
      this.setMetadata("lastAllianceStateHealAt", new Date().toISOString());
      this.touch();
    });

    return this.snapshot();
  }

  async syncCanonicalFleetMissions(reason = "periodic"): Promise<IndexerSnapshot> {
    void reason;
    return this.snapshot();
  }

  startFleetMissionStateHealOnce(runId: string): Promise<IndexerSnapshot> {
    const normalizedRunId = runId.trim().slice(0, 128);
    if (!normalizedRunId) return Promise.resolve(this.snapshot());
    if (this.metadata("currentStateOneTimeHealCompletedAt")) {
      return Promise.resolve(this.snapshot());
    }
    if (this.currentStateHealPromise) {
      return this.currentStateHealPromise;
    }
    this.currentStateHealRunId = normalizedRunId;
    this.currentStateHealPromise = this.seedCurrentFleetMissionState(normalizedRunId)
      .catch((error) => {
        this.recordReconciliationError(error);
        this.setMetadata("lastCanonicalFleetMissionSyncError", error instanceof Error ? error.message : String(error));
        throw error;
      })
      .finally(() => {
        this.currentStateHealPromise = null;
        this.currentStateHealRunId = null;
      });
    return this.currentStateHealPromise;
  }

  startCurrentStateHealOnce(runId: string, options: { planetConcurrency?: number } = {}): Promise<IndexerSnapshot> {
    const normalizedRunId = runId.trim().slice(0, 128);
    if (!normalizedRunId) return Promise.resolve(this.snapshot());
    if (this.metadata("currentStateOneTimeHealCompletedAt")) {
      return Promise.resolve(this.snapshot());
    }
    if (this.metadata("lastCurrentStateHealRunId") === normalizedRunId) {
      return Promise.resolve(this.snapshot());
    }
    this.currentStateHealRunId = normalizedRunId;
    return this.seedCurrentCanonicalState(options).then((snapshot) => {
      this.setMetadata("lastCurrentStateHealRunId", normalizedRunId);
      const completedAt = new Date().toISOString();
      this.setMetadata("lastCurrentStateHealAt", completedAt);
      this.setMetadata("currentStateOneTimeHealCompletedAt", completedAt);
      return this.snapshot();
    });
  }

  private async seedCurrentFleetMissionState(runId: string): Promise<IndexerSnapshot> {
    const startedAt = Date.now();
    this.setMetadata("lastCurrentStateHealRunId", runId);
    const fleetMissions = await this.readCurrentFleetMissionHealSnapshot();
    const changedRows = await this.replaceCanonicalFleetMissions(fleetMissions);
    const completedAt = new Date().toISOString();
    await this.runHealWrite("current-state fleet mission heal metadata", () => {
      this.setMetadata("lastCurrentStateHealAt", completedAt);
      this.setMetadata("currentStateOneTimeHealCompletedAt", completedAt);
      this.setMetadata("lastCanonicalFleetMissionSyncAt", completedAt);
      this.setMetadata("lastCanonicalFleetMissionSyncDurationMs", (Date.now() - startedAt).toString());
      this.setMetadata("lastCanonicalFleetMissionSyncRows", fleetMissions.length.toString());
      this.setMetadata("lastCanonicalFleetMissionSyncUpdatedRows", changedRows.toString());
      this.db.query("DELETE FROM indexer_metadata WHERE key = 'lastCanonicalFleetMissionSyncError'").run();
      this.db.query("DELETE FROM indexer_metadata WHERE key = 'lastReconciliationError'").run();
      this.touchMissionReadModel();
      this.touch();
    });
    return this.snapshot();
  }

  private async readCurrentFleetMissionHealSnapshot(): Promise<CanonicalFleetMissionSnapshot[]> {
    if (this.chainReader.getCanonicalFleetMission) {
      const candidateIds = this.currentFleetMissionHealCandidateIds();
      const missions: CanonicalFleetMissionSnapshot[] = [];
      const chunkSize = CANONICAL_READ_PLANET_CHUNK;
      for (const ids of chunks(candidateIds, chunkSize)) {
        const rows = await Promise.all(
          ids.map((missionId) => this.chainReader.getCanonicalFleetMission?.(BigInt(missionId)))
        );
        for (const row of rows) {
          if (row) missions.push(row);
        }
      }
      return missions;
    }
    if (this.chainReader.listCanonicalFleetMissions) {
      return this.chainReader.listCanonicalFleetMissions();
    }
    throw new Error("current-state fleet mission heal is unavailable: chain reader cannot read fleet missions");
  }

  private currentFleetMissionHealCandidateIds(): string[] {
    const rows = this.db.query(`
      SELECT mission_id
      FROM contract_fleet_missions
      WHERE status_id IN (1, 2, 5)
      ORDER BY CAST(mission_id AS INTEGER) ASC
    `).all() as Array<{ mission_id: string }>;
    return rows.map((row) => row.mission_id);
  }

  private async seedCurrentCanonicalStateUncached(options: { planetConcurrency?: number } = {}): Promise<IndexerSnapshot> {
    if (!this.chainReader.listCurrentPlanets) {
      throw new Error("current-state seed is unavailable: chain reader cannot enumerate current planets");
    }
    if (!this.chainReader.getCanonicalPlanetState) {
      throw new Error("current-state seed is unavailable: chain reader cannot read raw canonical planet state");
    }

    const before = this.snapshot();
    const overlapFromBlock = nextBlockOrBase(before.latestIndexedBlock, this.fromBlock);
    const planetEvents = await this.chainReader.listCurrentPlanets();
    const latestBlock = this.chainReader.getBlockNumber ? (await this.chainReader.getBlockNumber()).toString() : null;
    const healStats = await this.withCanonicalQueueSnapshotBlock(latestBlock, () => this.healCurrentCanonicalPlanets(
      planetEvents,
      options.planetConcurrency ?? CANONICAL_READ_PLANET_CHUNK
    ));
    const allianceDirectory = this.chainReader.listAllianceDirectoryState
      ? await this.chainReader.listAllianceDirectoryState()
      : [];
    const allianceCandidateWallets = Array.from(
      new Set(planetEvents.map((planet) => planet.owner.toLowerCase() as Address))
    );
    const allianceJoinRequests = this.chainReader.listAllianceJoinRequestState
      ? await this.chainReader.listAllianceJoinRequestState()
      : null;
    const allianceInvites = this.chainReader.listAllianceInviteState
      ? await this.chainReader.listAllianceInviteState(allianceCandidateWallets)
      : null;
    const allianceDiplomacy = this.chainReader.listAllianceDiplomacyState
      ? await this.chainReader.listAllianceDiplomacyState()
      : null;
    await this.healCurrentCanonicalOwnerState(allianceCandidateWallets, options.planetConcurrency ?? CANONICAL_READ_PLANET_CHUNK);

    const fleetMissions = await this.chainReader.listCanonicalFleetMissions?.();
    if (fleetMissions) {
      await this.replaceCanonicalFleetMissions(fleetMissions);
    }

    if (latestBlock !== null) {
      await this.replayCurrentHealOverlapLogs(overlapFromBlock, BigInt(latestBlock));
    }

    await this.runHealWrite("alliance snapshots", () => {
      this.applyAllianceDirectorySnapshot(allianceDirectory);
      this.applyAllianceJoinRequestSnapshot(allianceJoinRequests);
      this.applyAllianceInviteSnapshot(allianceInvites);
      this.applyAllianceDiplomacySnapshot(allianceDiplomacy);
      this.recordSuccessfulAllianceReconciliation();
      this.setMetadata("lastCurrentStateHealAt", new Date().toISOString());
      this.setMetadata("lastCurrentStateHealPlanetsScanned", healStats.planetsScanned.toString());
      this.setMetadata("lastCurrentStateHealShipMismatches", healStats.shipMismatches.toString());
      this.touch();
      this.recordSuccessfulReconciliation(latestBlock);
    });
    return this.snapshot();
  }

  private async replayCurrentHealOverlapLogs(fromBlock: bigint, toBlock: bigint): Promise<void> {
    if (toBlock < fromBlock) return;
    if (!this.chainReader.listContractLogs) return;

    const logs = sortRpcLogs(await this.chainReader.listContractLogs(fromBlock, toBlock));
    for (const log of logs) {
      await this.runHealOperation(`record overlap log ${indexedLogKey(log)}`, () => {
        this.applyLog(log);
      });
      await this.runHealWrite(`replay overlap log ${indexedLogKey(log)}`, () => {
        this.applyStoredLogSideEffects(log);
      });
    }
  }

  private async healCurrentCanonicalPlanets(
    planets: SettledPlanetEvent[],
    planetConcurrency: number
  ): Promise<CurrentStateHealStats> {
    const readPlanet = this.chainReader.getCanonicalPlanetState;
    if (!readPlanet) {
      throw new Error("current-state seed is unavailable: chain reader cannot read raw canonical planet state");
    }
    const chunkSize = Math.max(1, Math.floor(planetConcurrency));
    const stats: CurrentStateHealStats = {
      planetsScanned: 0,
      shipMismatches: 0
    };

    for (const planetChunk of chunks(planets, chunkSize)) {
      const rows = await Promise.all(
        planetChunk.map((planet) => readPlanet.call(this.chainReader, BigInt(planet.planetId)))
      );
      for (let index = 0; index < rows.length; index += 1) {
        const planet = planetChunk[index];
        const row = rows[index];
        if (!planet || !row) continue;
        stats.planetsScanned += 1;
        stats.shipMismatches += this.countCanonicalShipMismatches(row);
        await this.healPlanetIdentity(planet);
        await this.healPlanetResources(row);
        await this.healPlanetBuildings(row);
        await this.healPlanetShips(row);
        await this.healPlanetDefenses(row);
        await this.healPlanetQueues(row);
      }
    }
    return stats;
  }

  private async healCurrentCanonicalOwnerState(owners: Address[], ownerConcurrency: number): Promise<void> {
    if (!this.chainReader.getResearchState && !this.chainReader.getMoonState) return;
    const chunkSize = Math.max(1, Math.floor(ownerConcurrency));
    for (const ownerChunk of chunks(owners, chunkSize)) {
      const rows = await Promise.all(ownerChunk.map(async (owner) => {
        const [research, moon] = await Promise.all([
          this.chainReader.getResearchState?.(owner),
          this.chainReader.getMoonState?.(owner)
        ]);
        return { owner, research, moon };
      }));
      for (const row of rows) {
        if (row.research) await this.healOwnerResearch(row.owner, row.research);
        if (row.moon?.moon?.exists && row.moon.homePlanetId) await this.healPlanetMoon(row.moon.homePlanetId, row.moon);
      }
    }
  }

  async rebuildPlanets(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    if (this.planetRebuildPromise) {
      return this.planetRebuildPromise;
    }

    this.planetRebuildPromise = this.rebuildPlanetsUncached().finally(() => {
      this.planetRebuildPromise = null;
    });
    return this.planetRebuildPromise;
  }

  // VEY-KANEO-485: the chain-read phase of a full cold rebuild — every getLogs backfill and canonical
  // read — wrapped so the deadline guards the slow, RPC-bound work. The fast synchronous DB write phase
  // runs after the inputs are in hand.
  private async readRebuildInputs() {
    const settledPlanetEvents = await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const currentPlanets = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : null;
    const planetEvents = currentPlanets
      ? mergeCurrentPlanetSnapshots(settledPlanetEvents, currentPlanets)
      : settledPlanetEvents;
    const debrisEvents = await this.chainReader.listDebrisFieldEvents(this.fromBlock, "latest");
    const moonChanceEvents = await this.chainReader.listMoonChanceReportEvents(this.fromBlock, "latest");
    const startPriceWei = this.chainReader.getStartPrice
      ? await this.chainReader.getStartPrice()
      : null;
    const startPriceBlock = startPriceWei !== null && this.chainReader.getBlockNumber
      ? (await this.chainReader.getBlockNumber()).toString()
      : null;
    const canonicalState = await this.readCanonicalState(planetEvents);
    const allianceLogs = this.chainReader.listAllianceLogs
      ? await this.chainReader.listAllianceLogs(this.fromBlock, "latest")
      : [];
    const allianceDirectory = this.chainReader.listAllianceDirectoryState
      ? await this.chainReader.listAllianceDirectoryState()
      : [];
    // Seed the three eventless-migratable alliance sub-states from contract reads (canonical-mirror).
    // Invites have no per-alliance enumeration getter, so probe the known-wallet set (planet owners,
    // the same candidate set as the canonical planet/owner reads) × allianceIds. Optional methods are
    // skipped when the injected reader lacks them, falling back to event-derived rows (no crash).
    const allianceCandidateWallets = Array.from(
      new Set(planetEvents.map((planet) => planet.owner.toLowerCase() as Address))
    );
    const allianceJoinRequests = this.chainReader.listAllianceJoinRequestState
      ? await this.chainReader.listAllianceJoinRequestState()
      : null;
    const allianceInvites = this.chainReader.listAllianceInviteState
      ? await this.chainReader.listAllianceInviteState(allianceCandidateWallets)
      : null;
    const allianceDiplomacy = this.chainReader.listAllianceDiplomacyState
      ? await this.chainReader.listAllianceDiplomacyState()
      : null;
    return {
      settledPlanetEvents,
      planetEvents,
      debrisEvents,
      moonChanceEvents,
      startPriceWei,
      startPriceBlock,
      canonicalState,
      allianceLogs,
      allianceDirectory,
      allianceJoinRequests,
      allianceInvites,
      allianceDiplomacy
    };
  }

  // VEY-KANEO-485: surface a real error if the cold rebuild's chain reads stall past the deadline,
  // instead of leaving the index stuck in reconciliation_in_progress with lastReconciliationError=null
  // forever. The abandoned reads resolve into the void (no DB write runs unless the inputs arrive in
  // time); rebuild()'s catch records the error and the boot-time recovery retries it.
  private withRebuildDeadline<T>(read: Promise<T>, deadlineMs: number): Promise<T> {
    if (!deadlineMs) return read;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`cold reindex chain read exceeded ${deadlineMs}ms deadline`));
      }, deadlineMs);
      (timer as { unref?: () => void }).unref?.();
      read.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  private async rebuildUncached(deadlineMs: number): Promise<IndexerSnapshot> {
    const {
      settledPlanetEvents,
      planetEvents,
      debrisEvents,
      moonChanceEvents,
      startPriceWei,
      startPriceBlock,
      canonicalState,
      allianceLogs,
      allianceDirectory,
      allianceJoinRequests,
      allianceInvites,
      allianceDiplomacy
    } = await this.withRebuildDeadline(this.readRebuildInputs(), deadlineMs);
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM indexed_debris_fields").run();
      this.db.query("DELETE FROM indexed_moon_chance_reports").run();
      this.clearCanonicalState();
      if (startPriceWei !== null) {
        this.applyCanonicalStartPrice(startPriceWei, "rebuild", undefined, undefined, startPriceBlock);
      }
      for (const event of planetEvents) {
        this.upsertPlanet(event);
      }
      const latestBlock = latestEventBlock([...settledPlanetEvents, ...debrisEvents, ...moonChanceEvents, ...allianceLogs]);
      this.withCanonicalQueueSnapshotBlock(maxBlockLabel(this.metadata("latestIndexedBlock"), latestBlock), () => {
        this.applyCanonicalState(canonicalState);
      });
      this.replayEventDerivedQueueStateFromEventLogs(canonicalState);
      for (const event of debrisEvents) {
        this.upsertDebris(event);
      }
      for (const event of moonChanceEvents) {
        this.upsertMoonChanceReport(event);
      }
      for (const log of allianceLogs) {
        this.recordLogIfMissing(log);
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
      this.applyAllianceDirectorySnapshot(allianceDirectory);
      // Seed the three sub-states from chain reads AFTER the event replay so contract reads are
      // authoritative over (possibly incomplete) event-derived rows. A non-null-but-empty snapshot
      // means the chain has none, so the prior clearCanonicalState leaves the table empty (no stale
      // event rows survive). A null snapshot means the reader can't read it — leave event rows as-is.
      this.applyAllianceJoinRequestSnapshot(allianceJoinRequests);
      this.applyAllianceInviteSnapshot(allianceInvites);
      this.applyAllianceDiplomacySnapshot(allianceDiplomacy);
      this.recordSuccessfulAllianceReconciliation();
      this.touch();
      this.recordSuccessfulReconciliation(latestBlock);
    });
    rebuild();
    return this.snapshot();
  }

  private async rebuildPlanetsUncached(): Promise<IndexerSnapshot> {
    const events = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM contract_players").run();
      this.db.query("DELETE FROM contract_planets").run();
      this.db.query("DELETE FROM contract_planet_resources").run();
      for (const event of events) {
        this.upsertPlanet(event);
      }
      this.touch();
    });
    rebuild();
    return this.snapshot();
  }

  private migrate(runStartupBackfill: boolean): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexer_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_profiles (
        wallet TEXT PRIMARY KEY,
        display_name TEXT,
        description TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_watched_planets (
        wallet TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        watched_at TEXT NOT NULL,
        PRIMARY KEY (wallet, planet_id)
      );
      CREATE INDEX IF NOT EXISTS player_watched_planets_wallet_idx ON player_watched_planets (wallet, watched_at DESC);
      CREATE TABLE IF NOT EXISTS indexed_player_activity (
        wallet TEXT PRIMARY KEY,
        last_active_at TEXT NOT NULL,
        event_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_planets (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        galaxy INTEGER NOT NULL,
        system INTEGER NOT NULL,
        position INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_planets_owner_idx ON indexed_planets (owner);
      CREATE INDEX IF NOT EXISTS indexed_planets_coordinates_idx ON indexed_planets (galaxy, system, position);
      CREATE TABLE IF NOT EXISTS indexed_debris_fields (
        planet_id TEXT PRIMARY KEY,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_moon_chance_reports (
        report_key TEXT PRIMARY KEY,
        target_planet_id TEXT NOT NULL,
        battle_id TEXT NOT NULL,
        outcome_id TEXT,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_moon_chance_reports_target_idx
        ON indexed_moon_chance_reports (target_planet_id);
      CREATE TABLE IF NOT EXISTS indexed_event_logs (
        event_id TEXT PRIMARY KEY,
        transaction_hash TEXT NOT NULL,
        log_index TEXT NOT NULL,
        block_number TEXT NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0,
        event_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_event_logs_block_idx
        ON indexed_event_logs (block_number);
      CREATE INDEX IF NOT EXISTS indexed_event_logs_transaction_idx
        ON indexed_event_logs (transaction_hash);
      CREATE INDEX IF NOT EXISTS indexed_event_logs_transaction_lower_idx
        ON indexed_event_logs (lower(transaction_hash));
      CREATE TABLE IF NOT EXISTS indexed_referral_claims (
        event_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        commitment TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_referral_claims_owner_commitment_tx_idx
        ON indexed_referral_claims (owner, commitment, transaction_hash);
      CREATE TABLE IF NOT EXISTS indexed_referral_redemptions (
        event_id TEXT PRIMARY KEY,
        inviter TEXT NOT NULL,
        invitee TEXT NOT NULL,
        commitment TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_referral_redemptions_lookup_idx
        ON indexed_referral_redemptions (inviter, invitee, commitment, transaction_hash);
      CREATE TABLE IF NOT EXISTS indexed_referral_reward_claims (
        event_id TEXT PRIMARY KEY,
        inviter TEXT NOT NULL,
        invitee TEXT NOT NULL,
        commitment TEXT NOT NULL,
        recipient TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_referral_reward_claims_inviter_idx
        ON indexed_referral_reward_claims (inviter, transaction_hash);
      CREATE TABLE IF NOT EXISTS indexed_mission_event_logs (
        event_id TEXT PRIMARY KEY,
        event_kind TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_mission_event_logs_kind_block_idx
        ON indexed_mission_event_logs (event_kind, block_number);
      CREATE INDEX IF NOT EXISTS indexed_mission_event_logs_kind_topic1_block_idx
        ON indexed_mission_event_logs (event_kind, json_extract(event_json, '$.topics[1]'), block_number);
      CREATE TABLE IF NOT EXISTS indexed_battle_report_read_models (
        mission_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        report_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        block_number TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_battle_report_read_models_status_idx
        ON indexed_battle_report_read_models (status, updated_at);
      CREATE TABLE IF NOT EXISTS indexed_unit_count_event_logs (
        event_id TEXT PRIMARY KEY,
        block_number TEXT NOT NULL,
        log_index TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_unit_count_event_logs_position_idx
        ON indexed_unit_count_event_logs (block_number, log_index);
      CREATE INDEX IF NOT EXISTS indexed_unit_count_event_logs_topic1_block_idx
        ON indexed_unit_count_event_logs (json_extract(event_json, '$.topics[1]'), block_number, log_index);
      CREATE TABLE IF NOT EXISTS indexed_planet_queues (
        queue_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        planet_id TEXT,
        owner TEXT,
        item_id INTEGER NOT NULL,
        target_level INTEGER,
        quantity INTEGER,
        ready_at TEXT NOT NULL,
        started_at TEXT,
        cost_json TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_planet_queues_planet_idx
        ON indexed_planet_queues (planet_id, kind);
      CREATE INDEX IF NOT EXISTS indexed_planet_queues_owner_idx
        ON indexed_planet_queues (owner, kind);
      CREATE TABLE IF NOT EXISTS indexed_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_defense_counts (
        planet_id TEXT NOT NULL,
        defense_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, defense_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_ship_counts (
        planet_id TEXT NOT NULL,
        ship_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, ship_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_research_levels (
        owner TEXT NOT NULL,
        technology_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (owner, technology_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_moons (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        fields INTEGER NOT NULL,
        diameter_km INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_moon_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );

      CREATE TABLE IF NOT EXISTS contract_players (
        wallet TEXT PRIMARY KEY,
        home_planet_id TEXT,
        planet_count INTEGER NOT NULL DEFAULT 0,
        active_fleet_mission_count INTEGER NOT NULL DEFAULT 0,
        event_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_planets (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT,
        galaxy INTEGER NOT NULL,
        system_number INTEGER NOT NULL,
        position INTEGER NOT NULL,
        fields INTEGER NOT NULL,
        temperature INTEGER NOT NULL,
        metal_multiplier_bps INTEGER NOT NULL,
        crystal_multiplier_bps INTEGER NOT NULL,
        deuterium_multiplier_bps INTEGER NOT NULL,
        last_settled_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_planets_owner_idx ON contract_planets (owner);
      CREATE INDEX IF NOT EXISTS contract_planets_coordinates_idx
        ON contract_planets (galaxy, system_number, position);
      CREATE TABLE IF NOT EXISTS contract_planet_resources (
        planet_id TEXT PRIMARY KEY,
        metal TEXT NOT NULL,
        crystal TEXT NOT NULL,
        deuterium TEXT NOT NULL,
        last_settled_at TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL,
        log_index TEXT NOT NULL DEFAULT '0x0'
      );
      CREATE TABLE IF NOT EXISTS contract_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_rift_balances (
        owner TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        in_game_balance TEXT NOT NULL,
        locked_balance TEXT NOT NULL,
        PRIMARY KEY (owner, planet_id, resource_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_rift_withdrawals (
        withdrawal_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        amount TEXT NOT NULL,
        unlocks_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_production_queues (
        queue_key TEXT PRIMARY KEY,
        queue_kind TEXT NOT NULL,
        planet_id TEXT,
        owner TEXT,
        item_id INTEGER NOT NULL,
        target_level INTEGER,
        quantity INTEGER,
        ready_at TEXT NOT NULL,
        started_at TEXT,
        metal_cost TEXT NOT NULL,
        crystal_cost TEXT NOT NULL,
        deuterium_cost TEXT NOT NULL,
        backlog_json TEXT,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_production_queues_planet_idx
        ON contract_production_queues (planet_id, queue_kind);
      CREATE INDEX IF NOT EXISTS contract_production_queues_owner_idx
        ON contract_production_queues (owner, queue_kind);
      CREATE VIEW IF NOT EXISTS contract_building_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'building';
      CREATE VIEW IF NOT EXISTS contract_defense_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'defense';
      CREATE VIEW IF NOT EXISTS contract_shipyard_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'ship';
      CREATE VIEW IF NOT EXISTS contract_research_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'research';
      CREATE TABLE IF NOT EXISTS contract_technology_levels (
        owner TEXT NOT NULL,
        technology_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (owner, technology_id)
      );
      CREATE TABLE IF NOT EXISTS contract_ship_counts (
        planet_id TEXT NOT NULL,
        ship_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, ship_id)
      );
      CREATE TABLE IF NOT EXISTS contract_defense_counts (
        planet_id TEXT NOT NULL,
        defense_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, defense_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_legacy_unit_mutations (
        mutation_key TEXT PRIMARY KEY,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_moons (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        exists_flag INTEGER NOT NULL,
        fields INTEGER,
        diameter_km INTEGER,
        created_at TEXT,
        jump_gate_ready_at TEXT,
        event_json TEXT
      );
      CREATE TABLE IF NOT EXISTS contract_moon_resources (
        planet_id TEXT PRIMARY KEY,
        metal TEXT NOT NULL,
        crystal TEXT NOT NULL,
        deuterium TEXT NOT NULL,
        last_settled_at TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL,
        log_index TEXT NOT NULL DEFAULT '0x0'
      );
      CREATE TABLE IF NOT EXISTS contract_moon_ship_counts (
        planet_id TEXT NOT NULL,
        ship_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, ship_id)
      );
      CREATE TABLE IF NOT EXISTS contract_moon_defense_counts (
        planet_id TEXT NOT NULL,
        defense_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, defense_id)
      );
      CREATE TABLE IF NOT EXISTS contract_moon_building_levels (
        planet_id TEXT NOT NULL,
        moon_building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, moon_building_id)
      );
      CREATE TABLE IF NOT EXISTS contract_moon_building_queues (
        planet_id TEXT PRIMARY KEY,
        moon_building_id INTEGER NOT NULL,
        target_level INTEGER NOT NULL,
        ready_at TEXT NOT NULL,
        metal_cost TEXT NOT NULL,
        crystal_cost TEXT NOT NULL,
        deuterium_cost TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_moon_chance_reports (
        report_key TEXT PRIMARY KEY,
        target_planet_id TEXT NOT NULL,
        battle_id TEXT NOT NULL,
        outcome_id TEXT,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_moon_chance_reports_target_idx
        ON contract_moon_chance_reports (target_planet_id);
      CREATE TABLE IF NOT EXISTS contract_debris_fields (
        planet_id TEXT PRIMARY KEY,
        metal TEXT NOT NULL,
        crystal TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_universe_system_snapshots (
        cache_key TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_universe_system_snapshots_version_idx
        ON contract_universe_system_snapshots (version);
      CREATE TABLE IF NOT EXISTS contract_fleet_missions (
        mission_id TEXT PRIMARY KEY,
        status_id INTEGER NOT NULL,
        mission_type_id INTEGER NOT NULL,
        owner TEXT NOT NULL,
        origin_planet_id TEXT NOT NULL,
        target_planet_id TEXT NOT NULL,
        departure_at TEXT NOT NULL,
        arrival_at TEXT NOT NULL,
        return_at TEXT NOT NULL,
        fuel_cost TEXT NOT NULL,
        metal_cargo TEXT NOT NULL,
        crystal_cargo TEXT NOT NULL,
        deuterium_cargo TEXT NOT NULL,
        ships_json TEXT NOT NULL,
        randomness_request_id TEXT,
        event_json TEXT
      );
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_owner_idx
        ON contract_fleet_missions (owner, status_id);
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_target_idx
        ON contract_fleet_missions (target_planet_id, status_id);
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_origin_idx
        ON contract_fleet_missions (origin_planet_id, status_id);
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_status_type_idx
        ON contract_fleet_missions (status_id, mission_type_id);
      CREATE TABLE IF NOT EXISTS contract_rift_withdrawals (
        owner TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        active INTEGER NOT NULL,
        planet_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        unlocks_at TEXT NOT NULL,
        event_json TEXT,
        PRIMARY KEY (owner, resource_id)
      );
      CREATE TABLE IF NOT EXISTS contract_alliances (
        alliance_id TEXT PRIMARY KEY,
        active INTEGER NOT NULL,
        tag TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        owner TEXT NOT NULL,
        created_at TEXT NOT NULL,
        member_count INTEGER NOT NULL,
        event_json TEXT
      );
      CREATE TABLE IF NOT EXISTS contract_alliance_members (
        alliance_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, wallet)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_members_wallet_idx
        ON contract_alliance_members (wallet);
      CREATE TABLE IF NOT EXISTS contract_alliance_invites (
        alliance_id TEXT NOT NULL,
        player TEXT NOT NULL,
        inviter TEXT NOT NULL,
        invited_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, player)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_invites_player_idx
        ON contract_alliance_invites (player);
      CREATE TABLE IF NOT EXISTS contract_alliance_join_requests (
        alliance_id TEXT NOT NULL,
        requester TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, requester)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_join_requests_requester_idx
        ON contract_alliance_join_requests (requester);
      CREATE TABLE IF NOT EXISTS contract_alliance_diplomacy (
        alliance_id TEXT NOT NULL,
        other_alliance_id TEXT NOT NULL,
        status_id INTEGER NOT NULL,
        updated_at TEXT,
        initiated_by_alliance_id TEXT,
        PRIMARY KEY (alliance_id, other_alliance_id)
      );
      CREATE TABLE IF NOT EXISTS contract_highscore_inputs (
        wallet TEXT PRIMARY KEY,
        home_planet_id TEXT,
        buildings_json TEXT NOT NULL DEFAULT '[]',
        defenses_json TEXT NOT NULL DEFAULT '[]',
        ships_json TEXT NOT NULL DEFAULT '[]',
        technologies_json TEXT NOT NULL DEFAULT '[]',
        moon_buildings_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("player_profiles", "description", "TEXT");
    this.ensureColumn("contract_production_queues", "backlog_json", "TEXT");
    this.ensureColumn("contract_planet_resources", "log_index", "TEXT NOT NULL DEFAULT '0x0'");
    this.ensureColumn("contract_alliance_diplomacy", "initiated_by_alliance_id", "TEXT");
    this.backfillStartPriceProjection();
    this.backfillDefenseHoldEndedMissionEvents();
    if (runStartupBackfill) {
      this.backfillMissionEventLogs();
      this.backfillUnitCountEventLogs();
      this.backfillCanonicalTables();
      this.replayFleetMissionRowsFromEventLogs();
    }
  }

  private backfillStartPriceProjection(): void {
    const source = this.metadata(startPriceSourceMetadataKey);
    if (source === "event" || source === "rebuild") return;
    const row = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE lower(json_extract(event_json, '$.topics[0]')) = lower(?)
        AND removed = 0
      ORDER BY CAST(block_number AS INTEGER) DESC, length(log_index) DESC, log_index DESC
      LIMIT 1
    `).get(startPriceUpdatedEventTopic) as EventRow | null;
    if (!row) return;
    const log = parseEvent<IndexedRpcLog>(row.event_json);
    this.applyStartPriceUpdatedEvent(indexedLogKey(log), decodeStartPriceUpdatedLog(log));
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((candidate) => candidate.name === column)) return;
    this.db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }

  private backfillCanonicalTables(): void {
    const now = new Date().toISOString();
    const planets = this.rows<SettledPlanetEvent>("SELECT event_json FROM indexed_planets ORDER BY CAST(planet_id AS INTEGER) ASC");
    for (const planet of planets) {
      this.upsertPlanet(planet);
    }

    const debrisRows = this.rows<DebrisFieldEvent>("SELECT event_json FROM indexed_debris_fields ORDER BY CAST(planet_id AS INTEGER) ASC");
    for (const debris of debrisRows) {
      this.upsertDebris(debris);
    }

    const moonReportRows = this.rows<MoonChanceReportEvent>("SELECT event_json FROM indexed_moon_chance_reports ORDER BY block_number ASC");
    for (const report of moonReportRows) {
      this.upsertMoonChanceReport(report);
    }

    // NOTE: the canonical contract_* level/count/research tables are maintained by event-listener and
    // explicit event-replay callbacks during normal operation. The previous
    // `INSERT OR IGNORE INTO contract_* SELECT ... FROM indexed_*` backfills are removed because they
    // could preserve stale/incomplete rows instead of applying the latest absolute event totals.

    const queueRows = this.db.query(`
      SELECT queue_key, kind, planet_id, owner, item_id, target_level, quantity, ready_at, started_at, cost_json, event_json
      FROM indexed_planet_queues
    `).all() as LegacyQueueRow[];
    for (const queue of queueRows) {
      const cost = parseEvent<ResourceColumns>(queue.cost_json);
      this.db.query(`
        INSERT OR IGNORE INTO contract_production_queues (
          queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity,
          ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, event_json
        )
        VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        queue.queue_key,
        queue.kind,
        queue.planet_id,
        queue.owner,
        queue.item_id,
        queue.target_level,
        queue.quantity,
        queue.ready_at,
        queue.started_at,
        cost.metal,
        cost.crystal,
        cost.deuterium,
        queue.event_json
      );
      if (queue.kind === "moon-building" && queue.planet_id && queue.target_level !== null) {
        this.db.query(`
          INSERT OR IGNORE INTO contract_moon_building_queues (
            planet_id, moon_building_id, target_level, ready_at,
            metal_cost, crystal_cost, deuterium_cost, event_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          queue.planet_id,
          queue.item_id,
          queue.target_level,
          queue.ready_at,
          cost.metal,
          cost.crystal,
          cost.deuterium,
          queue.event_json
        );
      }
    }

    this.db.query(`
      INSERT OR IGNORE INTO contract_highscore_inputs (wallet, home_planet_id, updated_at)
      SELECT wallet, home_planet_id, ?
      FROM contract_players
    `).run(now);

    this.replayMaterializedStateFromEventLogs();
    this.applyLegacyUnitMutationsFromEventLogs();
  }

  private backfillMissionEventLogs(): void {
    const rows = this.db.query(`
      SELECT indexed_event_logs.event_id, indexed_event_logs.event_json
      FROM indexed_event_logs
      LEFT JOIN indexed_mission_event_logs
        ON indexed_mission_event_logs.event_id = indexed_event_logs.event_id
      WHERE indexed_event_logs.removed = 0
        AND indexed_mission_event_logs.event_id IS NULL
    `).all() as Array<EventRow & { event_id: string }>;
    if (rows.length === 0) return;

    const insert = this.db.query(`
      INSERT OR IGNORE INTO indexed_mission_event_logs (event_id, event_kind, block_number, event_json)
      VALUES (?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const row of rows) {
        const log = parseEvent<IndexedRpcLog>(row.event_json);
        const eventKind = this.missionEventKind(log);
        if (!eventKind) continue;
        insert.run(row.event_id, eventKind, blockNumberToDecimal(log.blockNumber), row.event_json);
      }
    })();
  }

  private backfillDefenseHoldEndedMissionEvents(): void {
    const migrationKey = "defenseHoldEndedMissionEventsBackfilledV1";
    if (this.metadata(migrationKey) !== null) return;
    const rows = this.db.query(`
      SELECT event_id, block_number, event_json
      FROM indexed_event_logs
      WHERE removed = 0
        AND lower(json_extract(event_json, '$.topics[0]')) = lower(?)
    `).all(defenseHoldEndedTopic) as Array<EventRow & { event_id: string; block_number: string }>;
    const insert = this.db.query(`
      INSERT OR IGNORE INTO indexed_mission_event_logs (event_id, event_kind, block_number, event_json)
      VALUES (?, 'fleet', ?, ?)
    `);
    this.db.transaction(() => {
      for (const row of rows) insert.run(row.event_id, row.block_number, row.event_json);
      this.setMetadata(migrationKey, new Date().toISOString());
    })();
  }

  backfillBattleReportReadModels(limit = 500): number {
    const boundedLimit = Math.max(1, Math.min(2_000, Math.trunc(limit) || 500));
    const rows = this.db.query(`
      SELECT json_extract(event_json, '$.topics[1]') AS mission_topic,
        MAX(CAST(block_number AS INTEGER)) AS latest_block
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
        AND json_extract(event_json, '$.topics[1]') IS NOT NULL
      GROUP BY mission_topic
      ORDER BY latest_block DESC
      LIMIT ?
    `).all(boundedLimit) as Array<{ mission_topic: string | null }>;

    let materialized = 0;
    for (const row of rows) {
      const missionId = missionIdFromTopic(row.mission_topic);
      if (!missionId) continue;
      const status = this.battleReportMaterializationStatus(missionId);
      if (status.status === "ready") continue;
      if (this.materializeBattleReportReadModel(missionId, "backfill")) materialized += 1;
    }
    return materialized;
  }

  private markBattleReportMaterializationPending(missionId: string, blockNumber: string): void {
    this.db.query(`
      INSERT INTO indexed_battle_report_read_models (
        mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
      )
      VALUES (?, 'pending', NULL, NULL, 0, NULL, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET
        status = CASE
          WHEN indexed_battle_report_read_models.status = 'ready' THEN indexed_battle_report_read_models.status
          ELSE 'pending'
        END,
        error = NULL,
        block_number = excluded.block_number,
        updated_at = excluded.updated_at
    `).run(missionId, blockNumber, new Date().toISOString());
  }

  private materializeBattleReportReadModel(missionId: string, reason: "ingest" | "backfill" | "repair"): boolean {
    const started = performance.now();
    const previous = this.battleReportMaterializationStatus(missionId);
    try {
      const report = this.materializedBattleReportFromLogs(missionId);
      if (!report) {
        const durationMs = Math.max(0, Math.round(performance.now() - started));
        const message = `Battle report logs are incomplete or missing for mission ${missionId}.`;
        this.db.query(`
          INSERT INTO indexed_battle_report_read_models (
            mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
          )
          VALUES (?, 'failed', NULL, ?, 1, ?, NULL, ?)
          ON CONFLICT(mission_id) DO UPDATE SET
            status = 'failed',
            error = excluded.error,
            attempts = indexed_battle_report_read_models.attempts + 1,
            duration_ms = excluded.duration_ms,
            updated_at = excluded.updated_at
        `).run(missionId, message, durationMs, new Date().toISOString());
        this.touchBattleReportReadModel();
        emitObservabilityEvent({
          kind: "battle_report_materialization",
          component: "battle-report-materializer",
          reason,
          missionId,
          status: "failed",
          durationMs,
          error: message
        });
        return false;
      }
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const updatedAt = new Date().toISOString();
      const writeReadyReport = this.db.query(`
        INSERT INTO indexed_battle_report_read_models (
          mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
        )
        VALUES (?, 'ready', ?, NULL, 1, ?, ?, ?)
        ON CONFLICT(mission_id) DO UPDATE SET
          status = 'ready',
          report_json = excluded.report_json,
          error = NULL,
          attempts = indexed_battle_report_read_models.attempts + 1,
          duration_ms = excluded.duration_ms,
          block_number = excluded.block_number,
          updated_at = excluded.updated_at
      `);
      const reportJson = JSON.stringify(report);
      this.db.transaction(() => {
        for (const associatedMissionId of associatedBattleReportMissionIds(report)) {
          writeReadyReport.run(associatedMissionId, reportJson, durationMs, report.blockNumber, updatedAt);
        }
      })();
      this.touchBattleReportReadModel();
      emitObservabilityEvent({
        kind: "battle_report_materialization",
        component: "battle-report-materializer",
        reason,
        missionId,
        status: "ready",
        durationMs,
        blockNumber: report.blockNumber
      });
      return previous.status !== "ready";
    } catch (error) {
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const message = reasonText(error);
      this.db.query(`
        INSERT INTO indexed_battle_report_read_models (
          mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
        )
        VALUES (?, 'failed', NULL, ?, 1, ?, NULL, ?)
        ON CONFLICT(mission_id) DO UPDATE SET
          status = 'failed',
          error = excluded.error,
          attempts = indexed_battle_report_read_models.attempts + 1,
          duration_ms = excluded.duration_ms,
          updated_at = excluded.updated_at
      `).run(missionId, message, durationMs, new Date().toISOString());
      this.touchBattleReportReadModel();
      emitObservabilityEvent({
        kind: "battle_report_materialization",
        component: "battle-report-materializer",
        reason,
        missionId,
        status: "failed",
        durationMs,
        error: message
      }, "warn");
      return false;
    }
  }

  materializeBattleReportReadModelsForWorker(missionIds: Iterable<string>, reason: "ingest" | "backfill" | "repair"): number {
    let materialized = 0;
    for (const missionId of [...new Set([...missionIds].filter((id) => id.length > 0))]) {
      if (this.materializeBattleReportReadModel(missionId, reason)) materialized += 1;
    }
    return materialized;
  }

  private backfillUnitCountEventLogs(): void {
    const existing = this.count("indexed_unit_count_event_logs");
    if (existing > 0) return;

    const rows = this.db.query(`
      SELECT event_id, event_json
      FROM indexed_event_logs
      WHERE removed = 0
    `).all() as Array<EventRow & { event_id: string }>;
    if (rows.length === 0) return;

    const insert = this.db.query(`
      INSERT OR IGNORE INTO indexed_unit_count_event_logs (event_id, block_number, log_index, event_json)
      VALUES (?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const row of rows) {
        const log = parseEvent<IndexedRpcLog>(row.event_json);
        if (!this.isUnitCountSnapshotLog(log)) continue;
        insert.run(row.event_id, blockNumberToDecimal(log.blockNumber), log.logIndex ?? "0x0", row.event_json);
      }
    })();
  }

  private missionEventKind(log: IndexedRpcLog): "fleet" | "battle" | "randomness" | null {
    if (isFleetMissionLog(log)) return "fleet";
    if (isBattleReportLog(log)) return "battle";
    if (isRandomnessFulfilledLog(log)) return "randomness";
    return null;
  }

  private isUnitCountSnapshotLog(log: IndexedRpcLog): boolean {
    if (isShipCountChangedLog(log) || isDefenseCountChangedLog(log)) return true;
    if (!isIndexedQueueCompletedLog(log)) return false;
    const event = decodeIndexedQueueCompletedLog(log);
    return Boolean(
      event.planetId
      && event.total !== undefined
      && (event.eventName === "ShipCompleted" || event.eventName === "DefenseCompleted")
    );
  }

  private replayMaterializedStateFromEventLogs(): void {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
    `).all() as EventRow[];

    for (const log of sortedEventRows(rows)) {
      if (isSettledPlanetLog(log)) {
        this.applyEvent(decodeSettledPlanetLog(log));
      } else if (isPlanetSettledLog(log)) {
        this.applyPlanetSettledEvent(decodePlanetSettledLog(log));
      } else if (isMoonResourcesSettledLog(log)) {
        this.applyMoonResourcesSettledEvent(decodeMoonResourcesSettledLog(log));
      } else if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        if (!this.queueStartProvenCompleted(event)) {
          this.applyQueueStartedEvent(event, { settleResources: false });
        }
      } else if (isIndexedQueueCompletedLog(log)) {
        this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
      } else if (isShipCountChangedLog(log)) {
        this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
      } else if (isMoonResourcesChangedLog(log)) {
        this.applyMoonResourcesChangedEvent(decodeMoonResourcesChangedLog(log));
      } else if (isDefenseCountChangedLog(log)) {
        this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
      } else if (isMoonShipCountChangedLog(log)) {
        this.applyMoonShipCountChangedEvent(decodeMoonShipCountChangedLog(log));
      } else if (isMoonDefenseCountChangedLog(log)) {
        this.applyMoonDefenseCountChangedEvent(decodeMoonDefenseCountChangedLog(log));
      } else if (isMoonJumpGateLog(log)) {
        this.applyMoonJumpGateEvent(decodeMoonJumpGateLog(log));
      } else if (isAllianceLog(log)) {
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
    }
  }

  private rebuildMaterializedStateFromEventLogs(): void {
    this.db.transaction(() => {
      const rows = this.db.query(`
        SELECT event_json
        FROM indexed_event_logs
        WHERE removed = 0
      `).all() as EventRow[];
      if (rows.length === 0) return;

      this.clearEventDerivedMaterializedState();
      for (const log of sortedEventRows(rows)) {
        this.applyStoredLogSideEffects(log);
      }
      this.touch();
    })();
  }

  private clearEventDerivedMaterializedState(): void {
    this.db.query("DELETE FROM indexed_planet_queues").run();
    this.db.query("DELETE FROM indexed_building_levels").run();
    this.db.query("DELETE FROM indexed_defense_counts").run();
    this.db.query("DELETE FROM indexed_ship_counts").run();
    this.db.query("DELETE FROM indexed_research_levels").run();
    this.db.query("DELETE FROM indexed_moons").run();
    this.db.query("DELETE FROM indexed_moon_building_levels").run();
    this.db.query("DELETE FROM indexed_rift_balances").run();
    this.db.query("DELETE FROM indexed_rift_withdrawals").run();
    this.db.query("DELETE FROM contract_planet_resources").run();
    this.db.query("DELETE FROM contract_debris_fields").run();
    this.db.query("DELETE FROM contract_moon_chance_reports").run();
    this.db.query("DELETE FROM contract_moon_resources").run();
    this.db.query("DELETE FROM contract_moon_ship_counts").run();
    this.db.query("DELETE FROM contract_building_levels").run();
    this.db.query("DELETE FROM contract_defense_counts").run();
    this.db.query("DELETE FROM contract_ship_counts").run();
    this.db.query("DELETE FROM contract_moon_defense_counts").run();
    this.db.query("DELETE FROM indexed_legacy_unit_mutations").run();
    this.db.query("DELETE FROM contract_technology_levels").run();
    this.db.query("DELETE FROM contract_production_queues").run();
    this.db.query("DELETE FROM contract_moon_building_queues").run();
    this.db.query("DELETE FROM contract_alliances").run();
    this.db.query("DELETE FROM contract_alliance_members").run();
    this.db.query("DELETE FROM contract_alliance_invites").run();
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
  }

  private applyStoredLogSideEffects(log: IndexedRpcLog): void {
    if (isSettledPlanetLog(log)) {
      this.applyEvent(decodeSettledPlanetLog(log));
    } else if (isPlanetSettledLog(log)) {
      this.applyPlanetSettledEvent(decodePlanetSettledLog(log));
    } else if (isMoonResourcesSettledLog(log)) {
      this.applyMoonResourcesSettledEvent(decodeMoonResourcesSettledLog(log));
    } else if (isPlanetRenamedLog(log)) {
      this.applyPlanetRenamedEvent(decodePlanetRenamedLog(log));
    } else if (isDebrisFieldLog(log)) {
      this.applyDebrisEvent(decodeDebrisFieldLog(log));
    } else if (isShipCountChangedLog(log)) {
      this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
    } else if (isMoonResourcesChangedLog(log)) {
      this.applyMoonResourcesChangedEvent(decodeMoonResourcesChangedLog(log));
    } else if (isDefenseCountChangedLog(log)) {
      this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
    } else if (isMoonShipCountChangedLog(log)) {
      this.applyMoonShipCountChangedEvent(decodeMoonShipCountChangedLog(log));
    } else if (isMoonDefenseCountChangedLog(log)) {
      this.applyMoonDefenseCountChangedEvent(decodeMoonDefenseCountChangedLog(log));
    } else if (isInterplanetaryMissileAttackLog(log)) {
      this.applyInterplanetaryMissileAttackCompatibilityEvent(decodeInterplanetaryMissileAttackLog(log));
    } else if (isIndexedQueueStartedLog(log)) {
      this.applyQueueStartedEvent(decodeIndexedQueueStartedLog(log), {
        settledAt: blockTimestampSeconds(log) ?? Math.floor(Date.now() / 1_000).toString()
      });
    } else if (isIndexedQueueCompletedLog(log)) {
      this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
    } else if (isMoonCreatedLog(log)) {
      this.applyMoonCreatedEvent(decodeMoonCreatedLog(log));
    } else if (isMoonJumpGateLog(log)) {
      this.applyMoonJumpGateEvent(decodeMoonJumpGateLog(log));
    } else if (isRiftResourceLog(log)) {
      this.applyRiftResourceEvent(decodeRiftResourceLog(log));
    } else if (isAllianceLog(log)) {
      this.applyAllianceEvent(decodeAllianceLog(log));
    } else if (isFleetMissionLog(log) || isBattleReportLog(log) || isMoonChanceReportLog(log) || isRandomnessFulfilledLog(log)) {
      if (isMoonChanceReportLog(log)) {
        this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      } else if (isFleetMissionLog(log)) {
        this.applyFleetMissionCompatibilityEvent(log);
        this.touch();
      } else if (isBattleReportLog(log)) {
        this.applyBattleCompatibilityEvent(log);
        this.touch();
      } else {
        this.touch();
      }
    }
  }

  private replayEventDerivedQueueStateFromEventLogs(canonicalState?: CanonicalReconciliationState): void {
    const activeEventQueues = new Set<string>();
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
    `).all() as EventRow[];

    for (const log of sortedEventRows(rows)) {
      if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        if (this.queueStartProvenCompleted(event) || canonicalState?.verifiedEmptyQueues.has(queueKey(event))) {
          activeEventQueues.delete(queueKey(event));
          continue;
        }
        const settledAt = blockTimestampSeconds(log);
        this.applyQueueStartedEvent(event, {
          settleResources: !this.hasCanonicalResourcesForQueue(event, canonicalState),
          ...(settledAt ? { settledAt } : {})
        });
        activeEventQueues.add(queueKey(event));
      } else if (isIndexedQueueCompletedLog(log)) {
        const event = decodeIndexedQueueCompletedLog(log);
        const key = queueKey(event);
        if (activeEventQueues.has(key)) {
          this.applyQueueCompletedEvent(event);
          activeEventQueues.delete(key);
        } else {
          this.applyQueueCompletionEffects(event);
        }
      } else if (isAllianceLog(log)) {
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
    }
  }

  private queueStartProvenCompleted(event: IndexedQueueStartedEvent): boolean {
    if (event.queueKind === "building" && event.planetId && event.targetLevel !== undefined) {
      return this.indexedLevel("contract_building_levels", "building_id", event.planetId, event.itemId) >= event.targetLevel;
    }
    if (event.queueKind === "moon-building" && event.planetId && event.targetLevel !== undefined) {
      return this.indexedLevel("contract_moon_building_levels", "moon_building_id", event.planetId, event.itemId) >= event.targetLevel;
    }
    if (event.queueKind === "research" && event.owner && event.targetLevel !== undefined) {
      const row = this.db.query(`
        SELECT level
        FROM contract_technology_levels
        WHERE owner = lower(?) AND technology_id = ?
      `).get(event.owner, event.itemId) as { level: number } | null;
      return (row?.level ?? 0) >= event.targetLevel;
    }

    return false;
  }

  private async readCanonicalState(planets: SettledPlanetEvent[]): Promise<CanonicalReconciliationState> {
    const state: CanonicalReconciliationState = {
      resources: new Map(),
      planetQueues: new Map(),
      buildings: new Map(),
      defenses: new Map(),
      ships: new Map(),
      research: new Map(),
      researchQueues: new Map(),
      moonBuildings: new Map(),
      moonQueues: new Map(),
      fleetMissions: new Map(),
      verifiedEmptyQueues: new Set()
    };
    const owners = new Set(planets.map((planet) => planet.owner.toLowerCase() as `0x${string}`));

    // Read the universe in bounded planet batches rather than one universe-wide Promise.all. Each planet
    // fans out 4 batched eth_call reads, so the unbounded version fired hundreds of large batches at once
    // — the self-hosted node truncated some responses ("Unexpected end of JSON input") and the canonical
    // reconcile failed deterministically, freezing lastReconciledBlock (VEY-KANEO-461). Chunking caps the
    // in-flight reads so the node returns each batch intact and the reconcile completes.
    for (const planetChunk of chunks(planets, CANONICAL_READ_PLANET_CHUNK)) {
      await Promise.all(planetChunk.map(async (planet) => {
      const planetId = planet.planetId;
      const owner = planet.owner as `0x${string}`;
      const [
        infrastructure,
        defenses,
        shipyard,
        queues
      ] = await Promise.all([
        this.chainReader.getInfrastructureState?.(owner, BigInt(planetId)),
        this.chainReader.getDefenseState?.(owner, BigInt(planetId)),
        this.chainReader.getShipyardState?.(owner, BigInt(planetId)),
        this.chainReader.getPlayerQueues?.(owner, BigInt(planetId))
      ]);

      if (infrastructure) {
        this.addCanonicalResources(state, planetId, infrastructure.resources);
        state.buildings.set(planetId, infrastructure.buildings);
        if (infrastructure.queue?.active) {
          state.planetQueues.set(`building:${planetId}`, infrastructure.queue);
          state.verifiedEmptyQueues.delete(`building:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`building:${planetId}`);
        }
      }
      if (defenses) {
        this.addCanonicalResources(state, planetId, defenses.resources);
        state.defenses.set(planetId, defenses.defenses);
        if (defenses.queue?.active) {
          state.planetQueues.set(`defense:${planetId}`, defenses.queue);
          state.verifiedEmptyQueues.delete(`defense:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`defense:${planetId}`);
        }
      }
      if (shipyard) {
        this.addCanonicalResources(state, planetId, shipyard.resources);
        state.ships.set(planetId, shipyard.ships);
        if (shipyard.queue?.active) {
          state.planetQueues.set(`ship:${planetId}`, shipyard.queue);
          state.verifiedEmptyQueues.delete(`ship:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`ship:${planetId}`);
        }
      }
      if (queues) {
        this.addActiveQueue(state.planetQueues, `building:${planetId}`, queues.building);
        this.addActiveQueue(state.planetQueues, `defense:${planetId}`, queues.defense);
        this.addActiveQueue(state.planetQueues, `ship:${planetId}`, queues.ship);
        this.addActiveResearchQueue(state.researchQueues, owner, queues.research);
        if (queues.building?.active) state.verifiedEmptyQueues.delete(`building:${planetId}`);
        if (queues.defense?.active) state.verifiedEmptyQueues.delete(`defense:${planetId}`);
        if (queues.ship?.active) state.verifiedEmptyQueues.delete(`ship:${planetId}`);
        if (queues.research?.active) state.verifiedEmptyQueues.delete(`research:${owner.toLowerCase()}`);
      }
      }));
    }

    for (const ownerChunk of chunks([...owners], CANONICAL_READ_PLANET_CHUNK)) {
      await Promise.all(ownerChunk.map(async (owner) => {
      // Research and moon state are both wallet-keyed on chain (resolved against the wallet's home
      // planet), so read them together per owner.
      const [research, moon] = await Promise.all([
        this.chainReader.getResearchState?.(owner),
        this.chainReader.getMoonState?.(owner)
      ]);

      // Moon: getMoonState resolves the wallet's home planet's moon. Seed the canonical moon building
      // levels + active moon-building queue keyed by that home planet id. Absent / non-existent moons
      // leave no canonical rows.
      if (moon?.moon?.exists && moon.homePlanetId) {
        state.moonBuildings.set(moon.homePlanetId, moon.buildings);
        if (moon.queue?.active) {
          state.moonQueues.set(moon.homePlanetId, moon.queue);
        }
      }

      if (!research) return;
      if (research.homePlanetId) {
        this.addCanonicalResources(state, research.homePlanetId, research.resources);
      }
      state.research.set(owner, research.technologies);
      if (research.queue?.active) {
        this.addActiveResearchQueue(state.researchQueues, owner, research.queue);
        state.verifiedEmptyQueues.delete(`research:${owner.toLowerCase()}`);
      } else {
        state.verifiedEmptyQueues.add(`research:${owner.toLowerCase()}`);
      }
      }));
    }

    const fleetMissions = await this.chainReader.listCanonicalFleetMissions?.();
    for (const mission of fleetMissions ?? []) {
      state.fleetMissions.set(mission.missionId, mission);
    }

    return state;
  }

  private async readCurrentCanonicalState(
    planets: SettledPlanetEvent[],
    planetConcurrency: number
  ): Promise<CanonicalReconciliationState> {
    const state: CanonicalReconciliationState = {
      resources: new Map(),
      planetQueues: new Map(),
      buildings: new Map(),
      defenses: new Map(),
      ships: new Map(),
      research: new Map(),
      researchQueues: new Map(),
      moonBuildings: new Map(),
      moonQueues: new Map(),
      fleetMissions: new Map(),
      verifiedEmptyQueues: new Set()
    };
    const owners = new Set(planets.map((planet) => planet.owner.toLowerCase() as `0x${string}`));
    const chunkSize = Math.max(1, Math.floor(planetConcurrency));
    const readPlanet = this.chainReader.getCanonicalPlanetState;
    if (!readPlanet) {
      throw new Error("current-state seed is unavailable: chain reader cannot read raw canonical planet state");
    }

    for (const planetChunk of chunks(planets, chunkSize)) {
      const rows = await Promise.all(
        planetChunk.map((planet) => readPlanet.call(this.chainReader, BigInt(planet.planetId)))
      );
      for (const row of rows) {
        this.addCurrentCanonicalPlanetState(state, row);
      }
    }

    for (const ownerChunk of chunks([...owners], chunkSize)) {
      await Promise.all(ownerChunk.map(async (owner) => {
        const [research, moon] = await Promise.all([
          this.chainReader.getResearchState?.(owner),
          this.chainReader.getMoonState?.(owner)
        ]);

        if (moon?.moon?.exists && moon.homePlanetId) {
          state.moonBuildings.set(moon.homePlanetId, moon.buildings);
          if (moon.queue?.active) {
            state.moonQueues.set(moon.homePlanetId, moon.queue);
          }
        }

        if (!research) return;
        if (research.homePlanetId) {
          this.addCanonicalResources(state, research.homePlanetId, research.resources);
        }
        state.research.set(owner, research.technologies);
        if (research.queue?.active) {
          this.addActiveResearchQueue(state.researchQueues, owner, research.queue);
          state.verifiedEmptyQueues.delete(`research:${owner.toLowerCase()}`);
        } else {
          state.verifiedEmptyQueues.add(`research:${owner.toLowerCase()}`);
        }
      }));
    }

    const fleetMissions = await this.chainReader.listCanonicalFleetMissions?.();
    for (const mission of fleetMissions ?? []) {
      state.fleetMissions.set(mission.missionId, mission);
    }

    return state;
  }

  private addCurrentCanonicalPlanetState(state: CanonicalReconciliationState, row: CanonicalPlanetChainState): void {
    const planetId = row.planetId;
    this.addCanonicalResources(state, planetId, row.resources);
    state.buildings.set(planetId, row.buildings);
    state.defenses.set(planetId, row.defenses);
    state.ships.set(planetId, row.ships);

    this.addActiveQueue(state.planetQueues, `building:${planetId}`, row.queues.building);
    this.addActiveQueue(state.planetQueues, `defense:${planetId}`, row.queues.defense);
    this.addActiveQueue(state.planetQueues, `ship:${planetId}`, row.queues.ship);
    if (row.queues.building?.active) {
      state.verifiedEmptyQueues.delete(`building:${planetId}`);
    } else {
      state.verifiedEmptyQueues.add(`building:${planetId}`);
    }
    if (row.queues.defense?.active) {
      state.verifiedEmptyQueues.delete(`defense:${planetId}`);
    } else {
      state.verifiedEmptyQueues.add(`defense:${planetId}`);
    }
    if (row.queues.ship?.active) {
      state.verifiedEmptyQueues.delete(`ship:${planetId}`);
    } else {
      state.verifiedEmptyQueues.add(`ship:${planetId}`);
    }
  }

  private async healPlanetIdentity(planet: SettledPlanetEvent): Promise<void> {
    await this.runHealWrite(`planet ${planet.planetId} identity`, () => {
      this.upsertPlanet(planet);
      this.touch();
    });
  }

  private async healPlanetResources(row: CanonicalPlanetChainState): Promise<void> {
    await this.runHealWrite(`planet ${row.planetId} resources`, () => {
      const reconciledAt = Math.floor(Date.now() / 1_000).toString();
      const blockNumber = this.metadata("lastReconciledBlock") ?? this.metadata("latestIndexedBlock") ?? "0";
      this.upsertPlanetResourceSnapshot(row.planetId, row.resources, reconciledAt, "0x", blockNumber, "0x0", true);
      this.touch();
    });
  }

  private async healPlanetBuildings(row: CanonicalPlanetChainState): Promise<void> {
    await this.runHealWrite(`planet ${row.planetId} buildings`, () => {
      this.db.query("DELETE FROM indexed_building_levels WHERE planet_id = ?").run(row.planetId);
      this.db.query("DELETE FROM contract_building_levels WHERE planet_id = ?").run(row.planetId);
      for (const building of row.buildings) {
        this.upsertIndexedLevel("indexed_building_levels", "building_id", "level", row.planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_building_levels", "building_id", "level", row.planetId, building.id, building.level);
      }
      this.touch();
    });
  }

  private async healPlanetShips(row: CanonicalPlanetChainState): Promise<void> {
    await this.runHealWrite(`planet ${row.planetId} ships`, () => {
      this.db.query("DELETE FROM indexed_ship_counts WHERE planet_id = ?").run(row.planetId);
      this.db.query("DELETE FROM contract_ship_counts WHERE planet_id = ?").run(row.planetId);
      for (const ship of row.ships) {
        this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", row.planetId, ship.id, ship.count);
        this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", row.planetId, ship.id, ship.count);
      }
      this.replayStoredPlanetShipCountLogsAfterSnapshot(row.planetId, this.canonicalQueueSnapshotBlock);
      this.touch();
    });
  }

  private replayStoredPlanetShipCountLogsAfterSnapshot(planetId: string, snapshotBlock: string | null): void {
    if (!snapshotBlock) return;
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_unit_count_event_logs
      WHERE json_extract(event_json, '$.topics[1]') = ?
        AND CAST(block_number AS INTEGER) > CAST(? AS INTEGER)
      ORDER BY CAST(block_number AS INTEGER) ASC, CAST(log_index AS INTEGER) ASC
    `).all(fleetMissionIdTopic(planetId), snapshotBlock) as EventRow[];

    for (const log of sortedEventRows(rows)) {
      if (!isShipCountChangedLog(log)) continue;
      const event = decodeShipCountChangedLog(log);
      if (event.planetId !== planetId) continue;
      this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", event.planetId, event.shipId, event.total);
      this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", event.planetId, event.shipId, event.total);
    }
  }

  private countCanonicalShipMismatches(row: CanonicalPlanetChainState): number {
    let mismatches = 0;
    for (const ship of row.ships) {
      if (this.indexedLevel("contract_ship_counts", "ship_id", row.planetId, ship.id) !== ship.count) {
        mismatches += 1;
      }
    }
    return mismatches;
  }

  private async healPlanetDefenses(row: CanonicalPlanetChainState): Promise<void> {
    await this.runHealWrite(`planet ${row.planetId} defenses`, () => {
      this.db.query("DELETE FROM indexed_defense_counts WHERE planet_id = ?").run(row.planetId);
      this.db.query("DELETE FROM contract_defense_counts WHERE planet_id = ?").run(row.planetId);
      for (const defense of row.defenses) {
        this.upsertIndexedLevel("indexed_defense_counts", "defense_id", "count", row.planetId, defense.id, defense.count);
        this.upsertIndexedLevel("contract_defense_counts", "defense_id", "count", row.planetId, defense.id, defense.count);
      }
      this.touch();
    });
  }

  private async healPlanetQueues(row: CanonicalPlanetChainState): Promise<void> {
    await this.runHealWrite(`planet ${row.planetId} queues`, () => {
      for (const kind of ["building", "defense", "ship"] as const) {
        const key = `${kind}:${row.planetId}`;
        this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(key);
        this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(key);
      }
      this.addActiveQueueToDb("building", row.planetId, row.queues.building);
      this.addActiveQueueToDb("defense", row.planetId, row.queues.defense);
      this.addActiveQueueToDb("ship", row.planetId, row.queues.ship);
      this.touch();
    });
  }

  private addActiveQueueToDb(kind: "building" | "defense" | "ship", planetId: string, queue: QueueState | null | undefined): void {
    if (!queue?.active) return;
    this.upsertCanonicalQueue(kind, planetId, null, queue);
  }

  private async healOwnerResearch(owner: Address, research: ResearchState): Promise<void> {
    await this.runHealWrite(`owner ${owner} research`, () => {
      this.db.query("DELETE FROM indexed_research_levels WHERE owner = lower(?)").run(owner);
      this.db.query("DELETE FROM contract_technology_levels WHERE owner = lower(?)").run(owner);
      for (const technology of research.technologies) {
        this.db.query(`
          INSERT INTO indexed_research_levels (owner, technology_id, level)
          VALUES (lower(?), ?, ?)
          ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
        `).run(owner, technology.id, technology.level);
        this.db.query(`
          INSERT INTO contract_technology_levels (owner, technology_id, level)
          VALUES (lower(?), ?, ?)
          ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
        `).run(owner, technology.id, technology.level);
      }
      const key = `research:${owner.toLowerCase()}`;
      this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(key);
      this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(key);
      this.addActiveResearchQueueToDb(owner, research.queue);
      this.touch();
    });
  }

  private addActiveResearchQueueToDb(owner: Address, queue: QueueState | null | undefined): void {
    if (!queue?.active) return;
    this.upsertCanonicalQueue("research", null, owner, queue);
  }

  private async healPlanetMoon(planetId: string, moon: MoonState): Promise<void> {
    await this.runHealWrite(`planet ${planetId} moon`, () => {
      this.db.query("DELETE FROM indexed_moon_building_levels WHERE planet_id = ?").run(planetId);
      this.db.query("DELETE FROM contract_moon_building_levels WHERE planet_id = ?").run(planetId);
      for (const building of moon.buildings) {
        this.upsertIndexedLevel("indexed_moon_building_levels", "building_id", "level", planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_moon_building_levels", "moon_building_id", "level", planetId, building.id, building.level);
      }
      this.db.query("DELETE FROM contract_moon_building_queues WHERE planet_id = ?").run(planetId);
      this.db.query("DELETE FROM contract_moon_defense_counts WHERE planet_id = ?").run(planetId);
      for (const defense of moon.defenses) {
        this.upsertIndexedLevel("contract_moon_defense_counts", "defense_id", "count", planetId, defense.id, defense.count);
      }
      if (moon.queue?.active) {
        this.upsertCanonicalMoonQueue(planetId, moon.queue);
      }
      this.touch();
    });
  }

  private async runHealWrite(label: string, write: () => void): Promise<void> {
    await this.runHealOperation(label, () => {
      this.db.transaction(write)();
    });
  }

  private async runHealOperation<T>(label: string, operation: () => T): Promise<T> {
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return operation();
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt === maxAttempts) {
          throw error;
        }
        await delay(250 * attempt);
      }
    }
    throw new Error(`failed to heal ${label}`);
  }

  private clearCanonicalState(): void {
    this.db.query("DELETE FROM indexed_planet_queues").run();
    this.db.query("DELETE FROM indexed_building_levels").run();
    this.db.query("DELETE FROM indexed_defense_counts").run();
    this.db.query("DELETE FROM indexed_ship_counts").run();
    this.db.query("DELETE FROM indexed_research_levels").run();
    this.db.query("DELETE FROM indexed_moon_building_levels").run();
    this.db.query("DELETE FROM contract_moon_building_levels").run();
    this.db.query("DELETE FROM contract_moon_defense_counts").run();
    this.db.query("DELETE FROM contract_players").run();
    this.db.query("DELETE FROM contract_planets").run();
    this.db.query("DELETE FROM contract_planet_resources").run();
    this.db.query("DELETE FROM contract_debris_fields").run();
    this.db.query("DELETE FROM contract_moon_chance_reports").run();
    this.db.query("DELETE FROM contract_moon_resources").run();
    this.db.query("DELETE FROM contract_moon_ship_counts").run();
    this.db.query("DELETE FROM contract_building_levels").run();
    this.db.query("DELETE FROM contract_defense_counts").run();
    this.db.query("DELETE FROM contract_ship_counts").run();
    this.db.query("DELETE FROM contract_moon_defense_counts").run();
    this.db.query("DELETE FROM contract_technology_levels").run();
    this.db.query("DELETE FROM contract_production_queues").run();
    this.db.query("DELETE FROM contract_moon_building_queues").run();
    this.db.query("DELETE FROM contract_fleet_missions").run();
    this.touchMissionReadModel();
    this.db.query("DELETE FROM contract_alliances").run();
    this.db.query("DELETE FROM contract_alliance_members").run();
    this.db.query("DELETE FROM contract_alliance_invites").run();
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
  }

  private applyCanonicalState(state: CanonicalReconciliationState): void {
    const reconciledAt = Math.floor(Date.now() / 1_000).toString();
    const blockNumber = this.metadata("lastReconciledBlock") ?? "0";
    for (const [planetId, resources] of state.resources) {
      // Reconcile reads the freshest on-chain balance, so it is authoritative even though it is stamped
      // with lastReconciledBlock rather than a real event block — force past the monotonic guard.
      this.upsertPlanetResourceSnapshot(planetId, resources, reconciledAt, "0x", blockNumber, "0x0", true);
    }
    for (const [planetId, buildings] of state.buildings) {
      for (const building of buildings) {
        this.upsertIndexedLevel("indexed_building_levels", "building_id", "level", planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_building_levels", "building_id", "level", planetId, building.id, building.level);
      }
    }
    for (const [planetId, defenses] of state.defenses) {
      for (const defense of defenses) {
        this.upsertIndexedLevel("indexed_defense_counts", "defense_id", "count", planetId, defense.id, defense.count);
        this.upsertIndexedLevel("contract_defense_counts", "defense_id", "count", planetId, defense.id, defense.count);
      }
    }
    for (const [planetId, ships] of state.ships) {
      for (const ship of ships) {
        this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", planetId, ship.id, ship.count);
        this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", planetId, ship.id, ship.count);
      }
    }
    for (const [owner, technologies] of state.research) {
      for (const technology of technologies) {
        this.db.query(`
        INSERT INTO indexed_research_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(owner, technology.id, technology.level);
        this.db.query(`
          INSERT INTO contract_technology_levels (owner, technology_id, level)
          VALUES (lower(?), ?, ?)
          ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
        `).run(owner, technology.id, technology.level);
      }
    }
    for (const [planetId, buildings] of state.moonBuildings) {
      for (const building of buildings) {
        // indexed_moon_building_levels keys on building_id; contract_moon_building_levels on moon_building_id.
        this.upsertIndexedLevel("indexed_moon_building_levels", "building_id", "level", planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_moon_building_levels", "moon_building_id", "level", planetId, building.id, building.level);
      }
    }
    for (const key of state.verifiedEmptyQueues) {
      this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(key);
      this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(key);
    }
    for (const [key, queue] of state.planetQueues) {
      const [kind, planetId] = key.split(":");
      if (!kind || !planetId || !isPlanetQueueKind(kind)) continue;
      this.upsertCanonicalQueue(kind, planetId, null, queue);
    }
    for (const [owner, queue] of state.researchQueues) {
      this.upsertCanonicalQueue("research", null, owner, queue);
    }
    for (const [planetId, queue] of state.moonQueues) {
      this.upsertCanonicalMoonQueue(planetId, queue);
    }
    let fleetMissionRowsChanged = 0;
    for (const mission of state.fleetMissions.values()) {
      fleetMissionRowsChanged += this.upsertCanonicalFleetMission(mission);
    }
    if (fleetMissionRowsChanged > 0) {
      this.touchMissionReadModel();
    }
  }

  private async replaceCanonicalFleetMissions(missions: CanonicalFleetMissionSnapshot[]): Promise<number> {
    let changedRows = 0;
    await this.runHealWrite("fleet missions", () => {
      const liveIds = new Set(missions.map((mission) => mission.missionId));
      const existingRows = this.db.query("SELECT mission_id FROM contract_fleet_missions").all() as Array<{ mission_id: string }>;
      for (const row of existingRows) {
        if (!liveIds.has(row.mission_id)) {
          changedRows += this.db.query("DELETE FROM contract_fleet_missions WHERE mission_id = ?").run(row.mission_id).changes;
        }
      }
      for (const mission of missions) {
        changedRows += this.upsertCanonicalFleetMission(mission);
      }
      this.setMetadata("lastFleetMissionsReconciledAt", new Date().toISOString());
      if (changedRows > 0) {
        this.touchMissionReadModel();
        this.touch();
      } else {
        this.snapshotCache = null;
      }
    });
    return changedRows;
  }

  private replayFleetMissionRowsFromEventLogs(): void {
    const missions = this.decodedMissionLogs().eventMissions;
    if (missions.length === 0) return;

    let replayedFleetRows = 0;
    for (const mission of missions) {
      replayedFleetRows += this.upsertEventDerivedFleetMissionRow(mission);
    }

    if (replayedFleetRows > 0) {
      this.setMetadata("lastFleetMissionEventReplayAt", new Date().toISOString());
      this.touchMissionReadModel();
      this.touch();
    }
  }

  private upsertEventDerivedFleetMissionRowsFromLogs(logs: IndexedRpcLog[]): FleetMissionSummary[] {
    const partialMissions = [...decodeFleetMissionLogs(logs).values()];
    if (partialMissions.length === 0) return [];

    const upsertedMissions: FleetMissionSummary[] = [];
    let replayedFleetRows = 0;
    for (const partial of partialMissions) {
      const existing = this.fleetMissionSummaryFromContractRow(partial.missionId);
      const mission = mergeFleetMissionSummary(existing, partial);
      if (!isEventDerivedFleetMissionRowReady(existing, mission)) continue;
      replayedFleetRows += this.upsertEventDerivedFleetMissionRow(mission);
      upsertedMissions.push(mission);
    }

    if (replayedFleetRows > 0) {
      this.setMetadata("lastFleetMissionEventReplayAt", new Date().toISOString());
      this.touchMissionReadModel();
      this.touch();
    }
    return upsertedMissions;
  }

  private fleetMissionSummaryFromContractRow(missionId: string): FleetMissionSummary | null {
    const row = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE mission_id = ?
    `).get(missionId) as ContractFleetMissionRow | null;
    return row ? this.canonicalFleetMissionSummary(row) : null;
  }

  private eventDerivedFleetMissionForMissionId(missionId: string): FleetMissionSummary | null {
    const mission = decodeFleetMissionLogs(this.fleetMissionEventLogsForMissionIds([missionId])).get(missionId) ?? null;
    return isStoredFleetMissionSummary(mission) ? mission : null;
  }

  private fleetMissionEventLogsForMissionIds(missionIds: Iterable<string>): IndexedRpcLog[] {
    const missionTopics = [...new Set([...missionIds].filter((missionId) => missionId.length > 0).map(fleetMissionIdTopic))];
    if (missionTopics.length === 0) return [];
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'fleet'
        AND json_extract(event_json, '$.topics[1]') IN (${missionTopics.map(() => "?").join(",")})
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all(...missionTopics) as EventRow[];
    return sortedEventRows(rows);
  }

  private upsertEventDerivedFleetMissionRow(mission: FleetMissionSummary): number {
    const statusId = fleetMissionStatusId(mission.status);
    const missionTypeId = fleetMissionTypeId(mission.missionType);
    if (statusId === null || missionTypeId === null) return 0;

    const existing = this.db.query(`
      SELECT status_id, event_json
      FROM contract_fleet_missions
      WHERE mission_id = ?
    `).get(mission.missionId) as (EventRow & { status_id: number }) | null;
    if (existing) {
      if (fleetMissionStatusProgressRank(fleetMissionStatusLabel(existing.status_id)) > fleetMissionStatusProgressRank(mission.status)) return 0;
      const marker = parseJson<{ source?: string }>(existing.event_json, {});
      const baselineBlock = safeBigInt(this.metadata("lastReconciledBlock"), 0n);
      if (marker.source !== "indexed_mission_event_logs" && safeBigInt(mission.blockNumber, 0n) <= baselineBlock) return 0;
    }

    const eventJson = JSON.stringify({
      source: "indexed_mission_event_logs",
      mission
    });
    const result = this.db.query(`
      INSERT INTO contract_fleet_missions (
        mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id,
        departure_at, arrival_at, return_at, fuel_cost,
        metal_cargo, crystal_cargo, deuterium_cargo, ships_json, randomness_request_id, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET
        status_id = excluded.status_id,
        mission_type_id = excluded.mission_type_id,
        owner = excluded.owner,
        origin_planet_id = excluded.origin_planet_id,
        target_planet_id = excluded.target_planet_id,
        departure_at = excluded.departure_at,
        arrival_at = excluded.arrival_at,
        return_at = excluded.return_at,
        fuel_cost = excluded.fuel_cost,
        metal_cargo = excluded.metal_cargo,
        crystal_cargo = excluded.crystal_cargo,
        deuterium_cargo = excluded.deuterium_cargo,
        ships_json = excluded.ships_json,
        randomness_request_id = excluded.randomness_request_id,
        event_json = excluded.event_json
    `).run(
      mission.missionId,
      statusId,
      missionTypeId,
      mission.owner,
      mission.originPlanetId,
      mission.targetPlanetId,
      mission.launchBlockNumber,
      mission.arrivalAt,
      mission.returnAt,
      mission.fuelCost,
      mission.cargo.metal,
      mission.cargo.crystal,
      mission.cargo.deuterium,
      JSON.stringify(mission.ships),
      missionBattleRandomnessRequestId(mission),
      eventJson
    );
    return result.changes;
  }

  private upsertCanonicalFleetMission(mission: CanonicalFleetMissionSnapshot): number {
    const eventJson = canonicalFleetMissionEventJson(mission);
    const existing = this.db.query(`
      SELECT event_json
      FROM contract_fleet_missions
      WHERE mission_id = ?
    `).get(mission.missionId) as EventRow | null;
    if (existing?.event_json === eventJson) return 0;

    return this.db.query(`
      INSERT INTO contract_fleet_missions (
        mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id,
        departure_at, arrival_at, return_at, fuel_cost,
        metal_cargo, crystal_cargo, deuterium_cargo, ships_json, randomness_request_id, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET
        status_id = excluded.status_id,
        mission_type_id = excluded.mission_type_id,
        owner = excluded.owner,
        origin_planet_id = excluded.origin_planet_id,
        target_planet_id = excluded.target_planet_id,
        departure_at = excluded.departure_at,
        arrival_at = excluded.arrival_at,
        return_at = excluded.return_at,
        fuel_cost = excluded.fuel_cost,
        metal_cargo = excluded.metal_cargo,
        crystal_cargo = excluded.crystal_cargo,
        deuterium_cargo = excluded.deuterium_cargo,
        ships_json = excluded.ships_json,
        randomness_request_id = excluded.randomness_request_id,
        event_json = excluded.event_json
    `).run(
      mission.missionId,
      mission.statusId,
      mission.missionTypeId,
      mission.owner,
      mission.originPlanetId,
      mission.targetPlanetId,
      mission.departureAt,
      mission.arrivalAt,
      mission.returnAt,
      mission.fuelCost,
      mission.cargo.metal,
      mission.cargo.crystal,
      mission.cargo.deuterium,
      "{}",
      mission.randomnessRequestId,
      eventJson
    ).changes;
  }

  private upsertCanonicalMoonQueue(planetId: string, queue: QueueState): void {
    if (queue.itemId === undefined || queue.targetLevel === undefined) return;
    this.upsertQueue({
      eventName: "MoonBuildingStarted",
      transactionHash: "0x",
      blockNumber: this.metadata("lastReconciledBlock") ?? "0",
      queueKind: "moon-building",
      planetId,
      itemId: queue.itemId,
      targetLevel: queue.targetLevel,
      readyAt: queue.readyAt ?? "0",
      ...(queue.startedAt ? { startedAt: queue.startedAt } : {}),
      cost: queue.cost
    });
  }

  private addActiveQueue(queues: Map<string, QueueState>, key: string, queue: QueueState | null | undefined): void {
    if (queue?.active) {
      queues.set(key, queue);
    }
  }

  private addActiveResearchQueue(queues: Map<`0x${string}`, QueueState>, owner: `0x${string}`, queue: QueueState | null | undefined): void {
    if (queue?.active) {
      queues.set(owner, queue);
    }
  }

  private addCanonicalResources(state: CanonicalReconciliationState, planetId: string, resources: Resources | null | undefined): void {
    if (resources && !state.resources.has(planetId)) {
      state.resources.set(planetId, resources);
    }
  }

  private hasCanonicalResourcesForQueue(event: IndexedQueueStartedEvent, state?: CanonicalReconciliationState): boolean {
    if (!state) return false;
    if (event.planetId) return state.resources.has(event.planetId);
    if (event.queueKind !== "research" || !event.owner) return false;

    const settlement = this.walletSettlement(event.owner);
    return Boolean(settlement.homePlanetId && state.resources.has(settlement.homePlanetId));
  }

  private upsertCanonicalQueue(
    kind: "building" | "defense" | "ship" | "research",
    planetId: string | null,
    owner: `0x${string}` | null,
    queue: QueueState
  ): void {
    this.upsertQueue({
      eventName: kind === "building" ? "BuildingStarted" : kind === "defense" ? "DefenseQueued" : kind === "ship" ? "ShipQueued" : "ResearchQueued",
      transactionHash: "0x",
      queueKind: kind,
      ...(planetId ? { planetId } : {}),
      ...(owner ? { owner } : {}),
      itemId: queue.itemId ?? 0,
      ...(queue.targetLevel !== undefined ? { targetLevel: queue.targetLevel } : {}),
      ...(queue.quantity !== undefined ? { quantity: queue.quantity } : {}),
      readyAt: queue.readyAt ?? "0",
      ...(queue.startedAt ? { startedAt: queue.startedAt } : {}),
      cost: queue.cost,
      ...(queue.backlog?.length ? { backlog: queue.backlog } : {}),
      canonicalSnapshot: true,
      blockNumber: this.canonicalQueueSnapshotBlock ?? this.metadata("lastReconciledBlock") ?? this.metadata("latestIndexedBlock") ?? "0"
    });
  }

  private withCanonicalQueueSnapshotBlock<T>(blockNumber: string | null, write: () => T): T {
    const previous = this.canonicalQueueSnapshotBlock;
    this.canonicalQueueSnapshotBlock = blockNumber ? blockNumberToDecimal(blockNumber) : null;
    try {
      const result = write();
      const maybePromise = result as Promise<T> | undefined;
      if (maybePromise && typeof maybePromise.finally === "function") {
        return maybePromise.finally(() => {
          this.canonicalQueueSnapshotBlock = previous;
        }) as T;
      }
      this.canonicalQueueSnapshotBlock = previous;
      return result;
    } catch (error) {
      this.canonicalQueueSnapshotBlock = previous;
      throw error;
    }
  }

  private upsertPlanet(event: SettledPlanetEvent): void {
    const planetEvent = this.withExistingPlanetIdentity(this.withKnownPlanetResources(event));
    const placeholderResources = isZeroResourcePlaceholder(planetEvent);
    this.db.query(`
      INSERT INTO indexed_planets (planet_id, owner, galaxy, system, position, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        galaxy = excluded.galaxy,
        system = excluded.system,
        position = excluded.position,
        event_json = excluded.event_json
    `).run(
      planetEvent.planetId,
      planetEvent.owner.toLowerCase(),
      planetEvent.galaxy,
      planetEvent.system,
      planetEvent.position,
      JSON.stringify(planetEvent)
    );
    this.db.query(`
      INSERT INTO contract_players (wallet, home_planet_id, planet_count, event_json, updated_at)
      VALUES (lower(?), ?, 1, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        home_planet_id = COALESCE(contract_players.home_planet_id, excluded.home_planet_id),
        planet_count = (
          SELECT COUNT(*)
          FROM contract_planets
          WHERE owner = lower(?)
        ) + CASE
          WHEN EXISTS (SELECT 1 FROM contract_planets WHERE planet_id = ?) THEN 0
          ELSE 1
        END,
        event_json = excluded.event_json,
        updated_at = excluded.updated_at
    `).run(
      planetEvent.owner,
      planetEvent.planetId,
      JSON.stringify(planetEvent),
      new Date().toISOString(),
      planetEvent.owner,
      planetEvent.planetId
    );
    this.db.query(`
      INSERT INTO contract_planets (
        planet_id, owner, name, galaxy, system_number, position, fields, temperature,
        metal_multiplier_bps, crystal_multiplier_bps, deuterium_multiplier_bps,
        last_settled_at, event_json
      )
      VALUES (?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        name = excluded.name,
        galaxy = excluded.galaxy,
        system_number = excluded.system_number,
        position = excluded.position,
        fields = excluded.fields,
        temperature = excluded.temperature,
        metal_multiplier_bps = excluded.metal_multiplier_bps,
        crystal_multiplier_bps = excluded.crystal_multiplier_bps,
        deuterium_multiplier_bps = excluded.deuterium_multiplier_bps,
        last_settled_at = excluded.last_settled_at,
        event_json = excluded.event_json
    `).run(
      planetEvent.planetId,
      planetEvent.owner,
      planetEvent.name,
      planetEvent.galaxy,
      planetEvent.system,
      planetEvent.position,
      planetEvent.fields,
      planetEvent.temperature,
      planetEvent.metalMultiplierBps,
      planetEvent.crystalMultiplierBps,
      planetEvent.deuteriumMultiplierBps,
      planetEvent.lastSettledAt,
      JSON.stringify(planetEvent)
    );
    if (placeholderResources) {
      this.markStale(pendingPlanetResourcesReason(planetEvent.planetId));
      return;
    }

    this.upsertPlanetResourceSnapshot(
      planetEvent.planetId,
      planetEvent.resources,
      planetEvent.lastSettledAt,
      planetEvent.transactionHash,
      planetEvent.blockNumber
    );
    this.clearPlanetResourcePendingIfResolved();
  }

  private withExistingPlanetIdentity(event: SettledPlanetEvent): SettledPlanetEvent {
    if (isCanonicalCurrentPlanetSnapshot(event)) return event;

    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) return event;

    const existing = parseEvent<SettledPlanetEvent>(row.event_json);
    return {
      ...event,
      owner: existing.owner,
      name: event.name ?? existing.name,
      galaxy: existing.galaxy,
      system: existing.system,
      position: existing.position,
      fields: existing.fields,
      temperature: existing.temperature,
      metalMultiplierBps: existing.metalMultiplierBps,
      crystalMultiplierBps: existing.crystalMultiplierBps,
      deuteriumMultiplierBps: existing.deuteriumMultiplierBps
    };
  }

  private updatePlanetResources(event: PlanetSettledEvent): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) {
      this.upsertPlanetResourceSnapshot(event.planetId, event.resources, event.lastSettledAt, event.transactionHash, event.blockNumber, event.logIndex);
      this.markStale(`planet_identity_pending:${event.planetId}`);
      return;
    }

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      lastSettledAt: event.lastSettledAt,
      resources: event.resources
    });
    this.upsertPlanetResourceSnapshot(
      event.planetId,
      event.resources,
      event.lastSettledAt,
      event.transactionHash,
      event.blockNumber,
      event.logIndex
    );
  }

  private moonResourceSnapshot(planetId: string): PlanetResourceRow | null {
    return this.db.query(`
      SELECT metal, crystal, deuterium, last_settled_at, transaction_hash, block_number, log_index
      FROM contract_moon_resources
      WHERE planet_id = ?
    `).get(planetId) as PlanetResourceRow | null;
  }

  private upsertMoonResourceSnapshot(
    planetId: string,
    resources: ResourceColumns,
    lastSettledAt: string,
    transactionHash: string,
    blockNumber: string,
    logIndex = "0x0"
  ): void {
    const existing = this.db
      .query("SELECT block_number, log_index FROM contract_moon_resources WHERE planet_id = ?")
      .get(planetId) as Pick<PlanetResourceRow, "block_number" | "log_index"> | null;
    if (existing) {
      try {
        const incomingBlock = BigInt(blockNumber);
        const existingBlock = BigInt(existing.block_number);
        if (incomingBlock < existingBlock) return;
        if (incomingBlock === existingBlock && BigInt(logIndex) < BigInt(existing.log_index)) return;
      } catch {
        // Keep the same malformed-label tolerance as planet resource snapshots.
      }
    }

    this.db.query(`
      INSERT INTO contract_moon_resources (
        planet_id, metal, crystal, deuterium, last_settled_at, transaction_hash, block_number, log_index
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        metal = excluded.metal,
        crystal = excluded.crystal,
        deuterium = excluded.deuterium,
        last_settled_at = excluded.last_settled_at,
        transaction_hash = excluded.transaction_hash,
        block_number = excluded.block_number,
        log_index = excluded.log_index
    `).run(
      planetId,
      resources.metal,
      resources.crystal,
      resources.deuterium,
      lastSettledAt,
      transactionHash,
      blockNumber,
      logIndex
    );
  }

  private applyMoonResourcesChangedEvent(event: IndexedMoonResourcesChangedEvent): void {
    this.upsertMoonResourceSnapshot(
      event.planetId,
      event.resources,
      "0",
      event.transactionHash,
      event.blockNumber,
      event.logIndex
    );
    this.touch();
  }

  private withKnownPlanetResources(event: SettledPlanetEvent): SettledPlanetEvent {
    if (!isZeroResourcePlaceholder(event)) return event;

    const resources = this.planetResourceSnapshot(event.planetId);
    if (!resources) return event;

    return {
      ...event,
      blockNumber: resources.block_number,
      lastSettledAt: resources.last_settled_at,
      resources: {
        metal: resources.metal,
        crystal: resources.crystal,
        deuterium: resources.deuterium
      },
      transactionHash: resources.transaction_hash
    };
  }

  private withResourceSnapshot(planet: SettledPlanetEvent): SettledPlanetEvent {
    const resources = this.planetResourceSnapshot(planet.planetId);
    return this.withResourceSnapshotRow(planet, resources);
  }

  private withResourceSnapshotRow(planet: SettledPlanetEvent, resources: PlanetResourceRow | null): SettledPlanetEvent {
    return resources ? {
      ...planet,
      blockNumber: resources.block_number,
      lastSettledAt: resources.last_settled_at,
      resources: {
        metal: resources.metal,
        crystal: resources.crystal,
        deuterium: resources.deuterium
      },
      transactionHash: resources.transaction_hash
    } : planet;
  }

  private planetResourceSnapshot(planetId: string): PlanetResourceRow | null {
    return this.db.query(`
      SELECT metal, crystal, deuterium, last_settled_at, transaction_hash, block_number, log_index
      FROM contract_planet_resources
      WHERE planet_id = ?
    `).get(planetId) as PlanetResourceRow | null;
  }

  // Resource snapshots must be monotonic by block, mirroring the `latestIndexedBlock` head clamp
  // (recordLatestBlock). PlanetSettled carries the authoritative post-mutation balance, including the
  // DECREASING balance a raid or spend produces. Logs do not always reach us in block order — a gap/
  // self-heal backfill or reconcile re-applies a previously-missed OLDER range after the live head feed
  // has already advanced. An unconditional write let that stale, higher pre-mutation balance clobber the
  // newer, lower one, so the read model over-reported resources; the frontend then let the player queue
  // an upgrade they could not afford on-chain and the transaction reverted (VEY-KANEO-491). Skip any
  // event-driven write whose block is strictly older than the stored snapshot. `force` is reserved for
  // the full-reconcile canonical path (applyCanonicalState), which reads the freshest on-chain state and
  // is authoritative regardless of the block label it is stamped with.
  private upsertPlanetResourceSnapshot(
    planetId: string,
    resources: ResourceColumns,
    lastSettledAt: string,
    transactionHash: string,
    blockNumber: string,
    logIndex = "0x0",
    force = false
  ): void {
    if (!force) {
      const existing = this.db
        .query("SELECT block_number, log_index FROM contract_planet_resources WHERE planet_id = ?")
        .get(planetId) as Pick<PlanetResourceRow, "block_number" | "log_index"> | null;
      if (existing) {
        try {
          const incomingBlock = BigInt(blockNumber);
          const existingBlock = BigInt(existing.block_number);
          if (incomingBlock < existingBlock) return;
          if (incomingBlock === existingBlock && BigInt(logIndex) < BigInt(existing.log_index)) return;
        } catch {
          // If either block label isn't a parseable integer (e.g. the "0" seed marker meeting a malformed
          // value), fall through and let the latest write win rather than silently dropping it.
        }
      }
    }
    this.db.query(`
      INSERT INTO contract_planet_resources (
        planet_id, metal, crystal, deuterium, last_settled_at, transaction_hash, block_number, log_index
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        metal = excluded.metal,
        crystal = excluded.crystal,
        deuterium = excluded.deuterium,
        last_settled_at = excluded.last_settled_at,
        transaction_hash = excluded.transaction_hash,
        block_number = excluded.block_number,
        log_index = excluded.log_index
    `).run(
      planetId,
      resources.metal,
      resources.crystal,
      resources.deuterium,
      lastSettledAt,
      transactionHash,
      blockNumber,
      logIndex
    );
  }

  private clearPlanetResourcePendingIfResolved(): void {
    const pending = this.metadata("pendingReconciliationReason");
    if (!pending?.startsWith("planet_resources_pending:") && !pending?.startsWith("planet_identity_pending:")) return;
    const planetsMissingResources = this.settledPlanets().some((planet) => (
      isZeroResourcePlaceholder(planet) && !this.planetResourceSnapshot(planet.planetId)
    ));
    if (!planetsMissingResources) {
      this.db.query("DELETE FROM indexer_metadata WHERE key = 'pendingReconciliationReason'").run();
    }
  }

  private applyPlanetRenamedEvent(event: PlanetRenamedEvent): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) {
      this.markStale("planet rename for unknown planet");
      return;
    }

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      owner: event.owner,
      name: event.name.length > 0 ? event.name : null
    });
    this.touch();
  }

  private upsertDebris(event: DebrisFieldEvent): void {
    if (event.resources.metal === "0" && event.resources.crystal === "0") {
      this.db.query("DELETE FROM indexed_debris_fields WHERE planet_id = ?").run(event.planetId);
      this.db.query("DELETE FROM contract_debris_fields WHERE planet_id = ?").run(event.planetId);
      return;
    }

    this.db.query(`
      INSERT INTO indexed_debris_fields (planet_id, block_number, event_json)
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(event.planetId, event.blockNumber, JSON.stringify(event));
    this.db.query(`
      INSERT INTO contract_debris_fields (planet_id, metal, crystal, block_number, event_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        metal = excluded.metal,
        crystal = excluded.crystal,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(event.planetId, event.resources.metal, event.resources.crystal, event.blockNumber, JSON.stringify(event));
  }

  private upsertMoonChanceReport(event: MoonChanceReportEvent): void {
    this.db.query(`
      INSERT INTO indexed_moon_chance_reports (report_key, target_planet_id, battle_id, outcome_id, block_number, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_key) DO UPDATE SET
        target_planet_id = excluded.target_planet_id,
        battle_id = excluded.battle_id,
        outcome_id = excluded.outcome_id,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(
      moonChanceReportKey(event),
      event.targetPlanetId,
      event.battleId,
      event.outcomeId ?? null,
      event.blockNumber,
      JSON.stringify(event)
    );
    this.db.query(`
      INSERT INTO contract_moon_chance_reports (report_key, target_planet_id, battle_id, outcome_id, block_number, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_key) DO UPDATE SET
        target_planet_id = excluded.target_planet_id,
        battle_id = excluded.battle_id,
        outcome_id = excluded.outcome_id,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(
      moonChanceReportKey(event),
      event.targetPlanetId,
      event.battleId,
      event.outcomeId ?? null,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private applyQueueStartedEvent(
    event: IndexedQueueStartedEvent,
    options: { settleResources?: boolean; settledAt?: string } = {}
  ): void {
    // Pin the queue's start time to the same instant the spend is settled against
    // the planet. The decoded log carries it when the RPC node returns block
    // timestamps; when it does not (the live-ingestion fallback synthesises a
    // settle time) reuse that settle time so `startedAt` and the planet's
    // `lastSettledAt` agree. A snapshot at/after that time is then recognised as
    // already reflecting the cost, preventing the displayed balance from being
    // double-reduced while the build is queued (VEY-318).
    const startedAt = event.startedAt ?? options.settledAt;
    const startedEvent = startedAt ? { ...event, startedAt } : event;
    if (this.shouldIgnoreStaleCanonicalProductionQueueEvent(startedEvent)) {
      return;
    }
    this.upsertQueue(startedEvent);
    if (options.settleResources !== false) {
      if (event.planetId) {
        this.subtractPlanetResources(event.planetId, event.cost, event.transactionHash, event.blockNumber, options.settledAt);
      } else if (event.queueKind === "research" && event.owner) {
        const settlement = this.walletSettlement(event.owner);
        if (settlement.homePlanetId) {
          this.subtractPlanetResources(settlement.homePlanetId, event.cost, event.transactionHash, event.blockNumber, options.settledAt);
        }
      }
    }
    this.touch();
  }

  private applyShipCountChangedEvent(event: IndexedShipCountChangedEvent): void {
    if (event.eventName === "MoonShipCountChanged") {
      this.upsertIndexedLevel(
        "contract_moon_ship_counts",
        "ship_id",
        "count",
        event.planetId,
        event.shipId,
        event.total
      );
      this.touch();
      return;
    }
    this.upsertIndexedLevel(
      "indexed_ship_counts",
      "ship_id",
      "count",
      event.planetId,
      event.shipId,
      event.total
    );
    this.upsertIndexedLevel(
      "contract_ship_counts",
      "ship_id",
      "count",
      event.planetId,
      event.shipId,
      event.total
    );
    this.touch();
  }

  private applyMoonShipCountChangedEvent(event: IndexedMoonShipCountChangedEvent): void {
    this.upsertIndexedLevel(
      "contract_moon_ship_counts",
      "ship_id",
      "count",
      event.planetId,
      event.shipId,
      event.total
    );
    this.touch();
  }

  // The contract emits PlanetDefenseCountChanged with the planet's resulting defense total on every
  // defense mutation the production queue doesn't already cover — combat defense losses, post-combat
  // repair, and interplanetary-missile silo/interception/primary hits (VEY-KANEO-462). Indexing it keeps
  // contract_defense_counts authoritative from events alone, so defense counts no longer depend on a
  // canonical reconcile completing (VEY-KANEO-461).
  private applyDefenseCountChangedEvent(event: IndexedDefenseCountChangedEvent): void {
    this.upsertIndexedLevel(
      "indexed_defense_counts",
      "defense_id",
      "count",
      event.planetId,
      event.defenseId,
      event.total
    );
    this.upsertIndexedLevel(
      "contract_defense_counts",
      "defense_id",
      "count",
      event.planetId,
      event.defenseId,
      event.total
    );
    this.touch();
  }

  private applyMoonDefenseCountChangedEvent(event: IndexedMoonDefenseCountChangedEvent): void {
    this.upsertIndexedLevel(
      "contract_moon_defense_counts",
      "defense_id",
      "count",
      event.planetId,
      event.defenseId,
      event.total
    );
    this.touch();
  }

  private applyFleetMissionCompatibilityEvent(log: IndexedRpcLog): number {
    let mutationsApplied = 0;
    const txLogs = this.indexedLogsForTransaction(log.transactionHash);
    const missionId = fleetMissionLogMissionId(log);
    const missionLogs = missionId
      ? this.fleetMissionEventLogsForMissionIds([missionId])
      : (txLogs.length > 0 ? txLogs.filter(isFleetMissionLog) : [log]);
    const upsertedMissions = this.upsertEventDerivedFleetMissionRowsFromLogs(missionLogs);
    const missions = decodeCompleteFleetMissionLogs(txLogs);
    for (const mission of missions) {
      const mutationKey = `legacy:fleet-launch:${mission.missionId}`;
      if (!this.hasLegacyUnitMutation(mutationKey)) {
        const mutations: LegacyUnitMutation[] = [];
        for (const [shipKey, value] of Object.entries(mission.ships)) {
          const shipId = shipKeyToId(shipKey);
          const quantity = Number(value);
          if (shipId === null || !Number.isFinite(quantity) || quantity <= 0) continue;
          if (this.hasTransactionUnitCountChanged(log.transactionHash, "ship", mission.originPlanetId, shipId)) continue;
          mutations.push({ kind: "ship", planetId: mission.originPlanetId, itemId: shipId, delta: -quantity });
        }
        mutationsApplied += this.applyLegacyUnitMutationsOnce(mutationKey, mutations, log);
      }
    }
    if (isFleetMissionReturnedLog(log)) {
      mutationsApplied += this.applyReturnedFleetCompatibilityEvent(
        log,
        upsertedMissions.find((mission) => mission.missionId === fleetMissionLogMissionId(log))
      );
    }
    return mutationsApplied;
  }

  private applyReturnedFleetCompatibilityEvent(log: IndexedRpcLog, appliedMission?: FleetMissionSummary): number {
    const missionId = fleetMissionLogMissionId(log);
    if (!missionId) return 0;

    const mission = appliedMission
      ?? this.fleetMissionSummaryFromContractRow(missionId)
      ?? this.eventDerivedFleetMissionForMissionId(missionId);
    if (!mission || mission.status !== "Returned") return 0;

    const reportMissionIds = [mission.missionId, mission.attackGroupId].filter((value): value is string => Boolean(value));
    const mutations = this.returnedFleetCreditMutations(mission, this.battleReportsForMissionIds(reportMissionIds, { includeRawFallback: true }))
      .filter((mutation) => !this.hasReturnSettlementUnitCountChanged(log, "ship", mutation.planetId, mutation.itemId));
    return this.applyLegacyUnitMutationsOnce(`legacy:fleet-return:${missionId}`, mutations, log);
  }

  private hasReturnSettlementUnitCountChanged(
    log: IndexedRpcLog,
    kind: "ship" | "defense",
    planetId: string,
    itemId: number
  ): boolean {
    if (this.hasTransactionUnitCountChanged(log.transactionHash, kind, planetId, itemId)) return true;
    return this.indexedLogsForBlock(log.blockNumber).some((candidate) => (
      compareRpcLogPosition(candidate, log) <= 0
      && this.isUnitCountChangedFor(candidate, kind, planetId, itemId)
    ));
  }

  private returnedFleetCreditMutations(
    mission: FleetMissionSummary,
    battleReports: readonly BattleReport[]
  ): LegacyUnitMutation[] {
    const launched = this.launchedShipMutations(mission);
    if (launched.length === 0) return [];

    // DefenseHold combat mutates the stationed mission fleet before an owner can recall it. Survivor
    // credits are authoritative PlanetShipCountChanged totals; replaying the launch vector from the
    // recall marker would restore destroyed ships when a zero-survivor return emits no count event.
    if (mission.missionType === "DefenseHold") return [];
    if (usefulString(mission.recallCost) || legacyReturnCreditableMissionTypes.has(mission.missionType)) return launched;

    if (mission.missionType !== "Attack" && mission.missionType !== "AcsAttack" && mission.missionType !== "Intercept") {
      return [];
    }

    const report = battleReports.find((candidate) => (
      candidate.missionId === mission.missionId
      || (mission.attackGroupId !== null && candidate.missionId === mission.attackGroupId)
    ));
    if (!report) return [];
    if (isZeroResources(report.attackerLosses)) return launched;

    const candidates: BattleLossCandidate[] = launched.flatMap((mutation) => {
      const cost = shipCostForLegacyLoss(mutation.itemId);
      return cost ? [{ kind: "ship", planetId: mutation.planetId, itemId: mutation.itemId, max: mutation.delta, cost }] : [];
    });
    const losses = uniqueLossSolution(candidates, report.attackerLosses);
    if (!losses) return [];

    const destroyedByShipId = new Map<number, number>();
    for (const loss of losses) {
      destroyedByShipId.set(loss.candidate.itemId, (destroyedByShipId.get(loss.candidate.itemId) ?? 0) + loss.destroyed);
    }

    return launched.flatMap((mutation) => {
      const survivors = mutation.delta - (destroyedByShipId.get(mutation.itemId) ?? 0);
      return survivors > 0 ? [{ ...mutation, delta: survivors }] : [];
    });
  }

  private launchedShipMutations(mission: FleetMissionSummary): LegacyUnitMutation[] {
    const mutations: LegacyUnitMutation[] = [];
    for (const [shipKey, value] of Object.entries(mission.ships)) {
      const shipId = shipKeyToId(shipKey);
      const quantity = Number(value);
      if (shipId === null || !Number.isFinite(quantity) || quantity <= 0) continue;
      mutations.push({ kind: "ship", planetId: mission.originPlanetId, itemId: shipId, delta: quantity });
    }
    return mutations;
  }

  private applyInterplanetaryMissileAttackCompatibilityEvent(event: InterplanetaryMissileAttackEvent): void {
    const mutations: LegacyUnitMutation[] = [];
    if (!this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.originPlanetId, 9)) {
      mutations.push({ kind: "defense", planetId: event.originPlanetId, itemId: 9, delta: -event.launched });
    }
    if (event.intercepted > 0 && !this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.targetPlanetId, 8)) {
      mutations.push({ kind: "defense", planetId: event.targetPlanetId, itemId: 8, delta: -event.intercepted });
    }
    if (
      event.destroyedPrimary > 0
      && !this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.targetPlanetId, event.primaryTargetDefenseId)
    ) {
      mutations.push({
        kind: "defense",
        planetId: event.targetPlanetId,
        itemId: event.primaryTargetDefenseId,
        delta: -event.destroyedPrimary
      });
    }
    this.applyLegacyUnitMutationsOnce(`legacy:ipm:${event.transactionHash.toLowerCase()}`, mutations, event);
  }

  private applyGuardedInterplanetaryMissileAttackCompatibilityEvent(
    event: InterplanetaryMissileAttackEvent,
    latestAbsoluteUnitTotals: Map<string, LegacyAbsoluteUnitTotal>,
    sourceLog: IndexedRpcLog
  ): number {
    const mutationKey = `legacy:ipm:${event.transactionHash.toLowerCase()}`;
    const mutations = this.storedLegacyUnitMutations(mutationKey) ?? (() => {
      const inferred: LegacyUnitMutation[] = [];
      if (!this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.originPlanetId, 9)) {
        inferred.push({ kind: "defense", planetId: event.originPlanetId, itemId: 9, delta: -event.launched });
      }
      if (event.intercepted > 0 && !this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.targetPlanetId, 8)) {
        inferred.push({ kind: "defense", planetId: event.targetPlanetId, itemId: 8, delta: -event.intercepted });
      }
      if (
        event.destroyedPrimary > 0
        && !this.hasTransactionUnitCountChanged(event.transactionHash, "defense", event.targetPlanetId, event.primaryTargetDefenseId)
      ) {
        inferred.push({
          kind: "defense",
          planetId: event.targetPlanetId,
          itemId: event.primaryTargetDefenseId,
          delta: -event.destroyedPrimary
        });
      }
      return inferred;
    })();
    return this.applyLegacyUnitMutationsOnce(
      mutationKey,
      this.filterLegacyMutationsForStoredReplay(mutations, sourceLog, latestAbsoluteUnitTotals),
      event,
      { allowExistingMarker: true }
    );
  }

  private applyBattleCompatibilityEvent(log: IndexedRpcLog): number {
    const missionId = battleLogMissionId(log);
    if (!missionId) return 0;
    const mutationKey = `legacy:battle:${missionId}`;
    if (this.hasLegacyUnitMutation(mutationKey)) return 0;
    const battleLogs = this.indexedLogsForTransaction(log.transactionHash)
      .filter((candidate) => isBattleReportLog(candidate) && battleLogMissionId(candidate) === missionId);
    const report = decodeBattleReportLogs(battleLogs, missionId);
    if (!report || isZeroResources(report.defenderLosses)) return 0;

    const mutations = this.solvePlanetBattleLossMutations(report);
    if (!mutations) return 0;
    return this.applyLegacyUnitMutationsOnce(mutationKey, this.filterLegacyMutationsWithoutExactCountEvent(mutations, log.transactionHash), log);
  }

  private applyGuardedBattleCompatibilityEvent(
    log: IndexedRpcLog,
    latestAbsoluteUnitTotals: Map<string, LegacyAbsoluteUnitTotal>
  ): number {
    const missionId = battleLogMissionId(log);
    if (!missionId) return 0;
    const mutationKey = `legacy:battle:${missionId}`;
    const battleLogs = this.indexedLogsForTransaction(log.transactionHash)
      .filter((candidate) => isBattleReportLog(candidate) && battleLogMissionId(candidate) === missionId);
    const report = decodeBattleReportLogs(battleLogs, missionId);
    if (!report || isZeroResources(report.defenderLosses)) return 0;

    const mutations = mergeLegacyUnitMutations(
      this.storedLegacyUnitMutations(mutationKey),
      this.solvePlanetBattleLossMutations(report)
    );
    if (!mutations) return 0;
    return this.applyLegacyUnitMutationsOnce(
      mutationKey,
      this.filterLegacyMutationsForStoredReplay(mutations, log, latestAbsoluteUnitTotals),
      log,
      { allowExistingMarker: true }
    );
  }

  private solvePlanetBattleLossMutations(report: BattleReport): LegacyUnitMutation[] | null {
    const candidates = this.planetBattleLossCandidates(report.targetPlanetId);
    const roundSolved = this.solveRoundBattleLossMutations(candidates, report);
    if (roundSolved) return roundSolved;

    const solution = uniqueLossSolution(candidates, report.defenderLosses);
    if (!solution) return null;
    return battleLossPicksToMutations(solution);
  }

  private planetBattleLossCandidates(planetId: string): BattleLossCandidate[] {
    const candidates: BattleLossCandidate[] = [];
    for (const shipId of shipIds) {
      const count = this.indexedLevel("contract_ship_counts", "ship_id", planetId, shipId);
      if (count <= 0) continue;
      const cost = shipCostForLegacyLoss(shipId);
      if (!cost || isZeroResources(cost)) continue;
      candidates.push({ kind: "ship", planetId, itemId: shipId, max: count, cost });
    }
    for (const defenseId of defenseIds.filter((id) => id <= 7)) {
      const count = this.indexedLevel("contract_defense_counts", "defense_id", planetId, defenseId);
      if (count <= 0) continue;
      const cost = defenseCostForLegacyLoss(defenseId);
      if (!cost || isZeroResources(cost)) continue;
      candidates.push({ kind: "defense", planetId, itemId: defenseId, max: count, cost });
    }

    return candidates;
  }

  private solveRoundBattleLossMutations(
    initialCandidates: BattleLossCandidate[],
    report: BattleReport
  ): LegacyUnitMutation[] | null {
    if (report.roundReports.length === 0) return null;
    const remaining = initialCandidates.map((candidate) => ({ ...candidate }));
    const mutations: LegacyUnitMutation[] = [];

    for (const round of report.roundReports) {
      const losses = { ...round.defenderLosses, deuterium: "0" };
      if (isZeroResources(losses)) continue;
      const solution = uniqueLossSolution(remaining, losses);
      if (!solution) return null;
      mutations.push(...battleLossPicksToMutations(solution));
      for (const pick of solution) {
        const candidate = remaining.find((entry) => (
          entry.kind === pick.candidate.kind
          && entry.planetId === pick.candidate.planetId
          && entry.itemId === pick.candidate.itemId
        ));
        if (candidate) candidate.max = Math.max(0, candidate.max - pick.destroyed);
      }
    }

    const finalDefenderUnits = Number(report.roundReports.at(-1)?.defenderUnits ?? "0");
    if (!Number.isFinite(finalDefenderUnits)) return null;
    const remainingUnits = remaining.reduce((total, candidate) => total + candidate.max, 0);
    const staleUnits = remainingUnits - finalDefenderUnits;
    if (staleUnits > 0) {
      const residual = remaining.filter((candidate) => candidate.max > 0);
      if (residual.length !== 1 || residual[0]!.max !== staleUnits) return null;
      const candidate = residual[0]!;
      mutations.push({
        kind: candidate.kind,
        planetId: candidate.planetId,
        itemId: candidate.itemId,
        delta: -staleUnits
      });
    }

    return mutations.length > 0 ? mutations : null;
  }

  private applyQueueCompletedEvent(event: IndexedQueueCompletedEvent): void {
    // A building completion raises the planet's production rate. The contract
    // settles [lastSettledAt, readyAt] at the OLD rate, completes the building,
    // then accrues at the NEW rate from readyAt (VeydriftGame.sol:720-730). The
    // read-model projects from the stored baseline at the current rate, so the
    // baseline must absorb the pre-completion window at the old rate before the
    // level is bumped — otherwise the projection applies the new, higher rate
    // over the whole window since the last settle and over-reports resources by
    // up to ~3x (VEY-KANEO-429). Settle BEFORE deleting the queue (it carries
    // readyAt) and BEFORE applying the completed level.
    const queue = this.queueState(queueKey(event));
    const matchesActiveQueue = queueMatchesCompletion(event, queue);
    if (event.queueKind === "building" && event.planetId && matchesActiveQueue) {
      this.settlePlanetResourcesUntil(event.planetId, queue?.readyAt ?? undefined);
    }
    if (matchesActiveQueue) {
      this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(queueKey(event));
      this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(queueKey(event));
    }
    this.applyQueueCompletionEffects(event);
    this.touch();
  }

  // Advance a planet's stored resources/lastSettledAt up to `settledAt` at the
  // current production rate, mirroring the contract's `_settleResourcesUntil`.
  // Used when a building completes so the baseline reflects accrual at the
  // pre-completion rate before the new level is applied.
  private settlePlanetResourcesUntil(planetId: string, settledAt: string | undefined): void {
    if (!settledAt) return;
    const planet = this.planet(planetId);
    if (!planet) return;
    if (isZeroResourcePlaceholder(planet) && !this.planetResourceSnapshot(planetId)) return;
    const previousSettledAt = Number(planet.lastSettledAt);
    const nextSettledAt = Number(settledAt);
    if (!Number.isFinite(previousSettledAt) || !Number.isFinite(nextSettledAt) || nextSettledAt <= previousSettledAt) {
      return;
    }
    this.upsertPlanet({
      ...planet,
      lastSettledAt: settledAt,
      resources: this.settlePlanetResourcesForSpend(planet, settledAt)
    });
  }

  private applyQueueCompletionEffects(event: IndexedQueueCompletedEvent): void {
    if (event.queueKind === "building" && event.planetId && event.level !== undefined) {
      this.upsertIndexedLevelAtLeast("indexed_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
      this.upsertIndexedLevelAtLeast("contract_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
    } else if (event.queueKind === "moon-building" && event.planetId && event.level !== undefined) {
      this.db.query("DELETE FROM contract_moon_building_queues WHERE planet_id = ?").run(event.planetId);
      this.upsertIndexedLevelAtLeast("indexed_moon_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
      this.upsertIndexedLevelAtLeast("contract_moon_building_levels", "moon_building_id", "level", event.planetId, event.itemId, event.level);
    } else if (event.queueKind === "moon-defense" && event.planetId && event.total !== undefined) {
      this.upsertIndexedLevel("contract_moon_defense_counts", "defense_id", "count", event.planetId, event.itemId, event.total);
    } else if (event.queueKind === "defense" && event.planetId && event.total !== undefined) {
      this.upsertIndexedLevel("indexed_defense_counts", "defense_id", "count", event.planetId, event.itemId, event.total);
      this.upsertIndexedLevel("contract_defense_counts", "defense_id", "count", event.planetId, event.itemId, event.total);
    } else if (event.queueKind === "ship" && event.planetId && event.total !== undefined) {
      this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", event.planetId, event.itemId, event.total);
      this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", event.planetId, event.itemId, event.total);
    } else if (event.queueKind === "research" && event.owner && event.level !== undefined) {
      this.db.query(`
        INSERT INTO indexed_research_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(event.owner, event.itemId, event.level);
      this.db.query(`
        INSERT INTO contract_technology_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(event.owner, event.itemId, event.level);
    }
  }

  private upsertQueue(event: QueueUpsertEvent): void {
    if (!event.canonicalSnapshot && this.shouldIgnoreStaleCanonicalProductionQueueEvent(event)) {
      return;
    }

    if (this.appendProductionBacklogQueue(event)) {
      return;
    }

    const backlogJson = event.backlog?.length
      ? this.productionBacklogJson(event.queueKind, queueStateFromEvent(event), event.backlog)
      : this.existingBacklogJsonForSameItem(event);

    this.db.query(`
      INSERT INTO indexed_planet_queues (
        queue_key, kind, planet_id, owner, item_id, target_level, quantity, ready_at, started_at, cost_json, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(queue_key) DO UPDATE SET
        kind = excluded.kind,
        planet_id = excluded.planet_id,
        owner = excluded.owner,
        item_id = excluded.item_id,
        target_level = excluded.target_level,
        quantity = excluded.quantity,
        ready_at = excluded.ready_at,
        started_at = excluded.started_at,
        cost_json = excluded.cost_json,
        event_json = excluded.event_json
    `).run(
      queueKey(event),
      event.queueKind,
      event.planetId ?? null,
      event.owner ?? null,
      event.itemId,
      event.targetLevel ?? null,
      event.quantity ?? null,
      event.readyAt,
      event.startedAt ?? null,
      JSON.stringify(event.cost),
      JSON.stringify(event)
    );
    this.db.query(`
      INSERT INTO contract_production_queues (
        queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity,
        ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(queue_key) DO UPDATE SET
        queue_kind = excluded.queue_kind,
        planet_id = excluded.planet_id,
        owner = excluded.owner,
        item_id = excluded.item_id,
        target_level = excluded.target_level,
        quantity = excluded.quantity,
        ready_at = excluded.ready_at,
        started_at = excluded.started_at,
        metal_cost = excluded.metal_cost,
        crystal_cost = excluded.crystal_cost,
        deuterium_cost = excluded.deuterium_cost,
        backlog_json = excluded.backlog_json,
        event_json = excluded.event_json
    `).run(
      queueKey(event),
      event.queueKind,
      event.planetId ?? null,
      event.owner ?? null,
      event.itemId,
      event.targetLevel ?? null,
      event.quantity ?? null,
      event.readyAt,
      event.startedAt ?? null,
      event.cost.metal,
      event.cost.crystal,
      event.cost.deuterium,
      backlogJson,
      JSON.stringify(event)
    );

    if (event.queueKind === "moon-building" && event.planetId && event.targetLevel !== undefined) {
      this.db.query(`
        INSERT INTO contract_moon_building_queues (
          planet_id, moon_building_id, target_level, ready_at,
          metal_cost, crystal_cost, deuterium_cost, event_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(planet_id) DO UPDATE SET
          moon_building_id = excluded.moon_building_id,
          target_level = excluded.target_level,
          ready_at = excluded.ready_at,
          metal_cost = excluded.metal_cost,
          crystal_cost = excluded.crystal_cost,
          deuterium_cost = excluded.deuterium_cost,
          event_json = excluded.event_json
      `).run(
        event.planetId,
        event.itemId,
        event.targetLevel,
        event.readyAt,
        event.cost.metal,
        event.cost.crystal,
        event.cost.deuterium,
        JSON.stringify(event)
      );
    }
  }

  private appendProductionBacklogQueue(event: QueueUpsertEvent): boolean {
    if ((event.queueKind !== "defense" && event.queueKind !== "ship") || !event.planetId) {
      return false;
    }
    if (event.canonicalSnapshot || event.backlog?.length) {
      return false;
    }

    const row = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKey(event)) as QueueRow | null;
    if (
      !row
      || (row.item_id === event.itemId && (event.queueKind !== "defense" || !row.backlog_json))
    ) {
      return false;
    }

    const backlog = row.backlog_json ? parseEvent<QueueState[]>(row.backlog_json) : [];
    const activeQueue = this.productionQueueFromRow(row);
    const nextBacklog = this.sanitizedProductionBacklog(row.queue_kind, activeQueue, Array.isArray(backlog) ? backlog : []);
    if (row.item_id === event.itemId && (event.queueKind !== "defense" || nextBacklog.length === 0)) {
      return false;
    }
    const nextEntry = queueStateFromEvent(event);
    this.mergeProductionBacklogEntry(nextBacklog, nextEntry);
    const sanitizedBacklog = this.sanitizedProductionBacklog(row.queue_kind, activeQueue, nextBacklog);
    this.db.query(`
      UPDATE contract_production_queues
      SET backlog_json = ?
      WHERE queue_key = ?
    `).run(JSON.stringify(sanitizedBacklog), queueKey(event));
    return true;
  }

  private shouldIgnoreStaleCanonicalProductionQueueEvent(event: QueueUpsertEvent): boolean {
    if ((event.queueKind !== "defense" && event.queueKind !== "ship") || !event.planetId) {
      return false;
    }

    const row = this.db.query(`
      SELECT event_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKey(event)) as Pick<EventRow, "event_json"> | null;
    if (!row) return false;

    const existing = parseEvent<QueueUpsertEvent>(row.event_json);
    if (!existing.canonicalSnapshot) return false;

    try {
      const eventBlock = BigInt(blockNumberToDecimal(event.blockNumber));
      const snapshotBlock = BigInt(blockNumberToDecimal(existing.blockNumber));
      return eventBlock <= snapshotBlock;
    } catch {
      return false;
    }
  }

  private existingBacklogJsonForSameItem(event: QueueUpsertEvent): string | null {
    if ((event.queueKind !== "defense" && event.queueKind !== "ship") || !event.planetId) {
      return null;
    }

    const row = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKey(event)) as QueueRow | null;

    if (!row || row.item_id !== event.itemId || !row.backlog_json) return null;
    const backlog = parseEvent<QueueState[]>(row.backlog_json);
    return this.productionBacklogJson(row.queue_kind, this.productionQueueFromRow(row), Array.isArray(backlog) ? backlog : []);
  }

  private subtractPlanetResources(
    planetId: string,
    cost: IndexedQueueStartedEvent["cost"],
    transactionHash: string,
    blockNumber: string,
    settledAt?: string
  ): void {
    const planet = this.planet(planetId);
    if (!planet) return;

    const snapshot = this.planetResourceSnapshot(planetId);

    if (isZeroResourcePlaceholder(planet) && !snapshot) {
      this.markStale(pendingPlanetResourcesReason(planetId));
      return;
    }

    // Double-subtract guard (VEY-318 / PROBLEM B): a build/research/ship cost must be debited from the
    // planet's balance EXACTLY ONCE. The contract debits resources atomically when an item is queued and
    // emits a PlanetSettled carrying the resulting post-spend balance in the SAME transaction as the
    // PlanetQueueStarted. PlanetSettled is authoritative — `updatePlanetResources` writes the snapshot
    // with that event's transactionHash — so if the stored snapshot was written by a PlanetSettled in
    // this same tx, it already reflects the spend and subtracting again drives the displayed balance low.
    // Skip the subtraction in that case. Pre-migration spends (no same-tx PlanetSettled; the snapshot tx
    // differs, or is the seed marker "0x") fall through and still subtract.
    if (transactionHash && snapshot && snapshot.transaction_hash === transactionHash) {
      return;
    }

    this.upsertPlanet({
      ...planet,
      transactionHash,
      blockNumber,
      lastSettledAt: settledAt ?? planet.lastSettledAt,
      resources: subtractResources(this.settlePlanetResourcesForSpend(planet, settledAt), cost)
    });
  }

  private settlePlanetResourcesForSpend(planet: SettledPlanetEvent, settledAt: string | undefined): Resources {
    if (!settledAt) return planet.resources;

    const previousSettledAt = Number(planet.lastSettledAt);
    const nextSettledAt = Number(settledAt);
    if (!Number.isFinite(previousSettledAt) || !Number.isFinite(nextSettledAt) || nextSettledAt <= previousSettledAt) {
      return planet.resources;
    }

    const derived = deriveInfrastructureFields(
      planet,
      this.contractInfrastructureRows(planet.planetId),
      this.contractShipRows(planet.planetId),
      this.contractTechnologyLevels(planet.owner)
    );
    return resourcesWithClaimableAccrual(
      planet.resources,
      derived.productionPerHour,
      derived.storageCaps,
      Math.floor(nextSettledAt - previousSettledAt)
    );
  }

  private queueState(queueKeyValue: string): QueueState | null {
    const cache = this.queueStateCacheForCurrentVersion();
    if (cache.values.has(queueKeyValue)) return cloneQueueState(cache.values.get(queueKeyValue) ?? null);

    if (queueKeyValue.startsWith("moon-building:")) {
      const row = this.db.query(`
        SELECT planet_id, moon_building_id, target_level, ready_at, metal_cost, crystal_cost, deuterium_cost, event_json
        FROM contract_moon_building_queues
        WHERE planet_id = ?
      `).get(queueKeyValue.slice("moon-building:".length)) as MoonBuildingQueueRow | null;
      if (row) {
        const queue = {
          active: true,
          kind: "moon-building",
          itemId: row.moon_building_id,
          targetLevel: row.target_level,
          readyAt: row.ready_at,
          cost: {
            metal: row.metal_cost,
            crystal: row.crystal_cost,
            deuterium: row.deuterium_cost
          }
        };
        cache.values.set(queueKeyValue, queue);
        return cloneQueueState(queue);
      }
    }

    const row = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKeyValue) as QueueRow | null;
    if (!row) {
      cache.values.set(queueKeyValue, null);
      return null;
    }

    const queue = this.productionQueueFromRow(row);
    if (row.backlog_json) {
      const backlog = parseEvent<QueueState[]>(row.backlog_json);
      const sanitizedBacklog = this.sanitizedProductionBacklog(row.queue_kind, queue, Array.isArray(backlog) ? backlog : []);
      if (sanitizedBacklog.length > 0) {
        queue.backlog = sanitizedBacklog;
      }
    }
    cache.values.set(queueKeyValue, queue);
    return cloneQueueState(queue);
  }

  private productionQueueFromRow(row: QueueRow): QueueState {
    const queue: QueueState = {
      active: true,
      kind: row.queue_kind,
      itemId: row.item_id,
      readyAt: row.ready_at,
      startedAt: row.started_at,
      cost: {
        metal: row.metal_cost,
        crystal: row.crystal_cost,
        deuterium: row.deuterium_cost
      }
    };
    if (row.target_level !== null) {
      queue.targetLevel = row.target_level;
    }
    if (row.quantity !== null) {
      queue.quantity = row.quantity;
    }
    return queue;
  }

  private productionBacklogJson(kind: string | null, activeQueue: QueueState, backlog: readonly QueueState[]): string | null {
    const sanitizedBacklog = this.sanitizedProductionBacklog(kind, activeQueue, backlog);
    return sanitizedBacklog.length > 0 ? JSON.stringify(sanitizedBacklog) : null;
  }

  private sanitizedProductionBacklog(kind: string | null, activeQueue: QueueState, backlog: readonly QueueState[]): QueueState[] {
    if (kind !== "defense" && kind !== "ship") {
      return [...backlog];
    }

    const activeReadyAt = queueReadyAt(activeQueue);
    const sanitized: QueueState[] = [];
    for (const entry of backlog) {
      if (entry.kind !== kind) continue;
      const entryReadyAt = queueReadyAt(entry);
      if (activeReadyAt !== null && entryReadyAt !== null && entryReadyAt <= activeReadyAt) continue;
      this.mergeProductionBacklogEntry(sanitized, entry);
    }
    return sanitized;
  }

  private mergeProductionBacklogEntry(backlog: QueueState[], entry: QueueState): void {
    const existingIndex = backlog.findIndex((existing) => queueStatesMatchIgnoringStartedAt(existing, entry));
    if (existingIndex < 0) {
      backlog.push(entry);
      return;
    }
    const existing = backlog[existingIndex];
    if (existing && !existing.startedAt && entry.startedAt) {
      backlog[existingIndex] = entry;
    }
  }

  private indexedLogsForTransaction(transactionHash: string): IndexedRpcLog[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0 AND lower(transaction_hash) = lower(?)
    `).all(transactionHash) as EventRow[];
    return sortedEventRows(rows);
  }

  private indexedLogsForBlock(blockNumber: string): IndexedRpcLog[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0 AND block_number = ?
    `).all(blockNumberToDecimal(blockNumber)) as EventRow[];
    return sortedEventRows(rows);
  }

  private hasTransactionUnitCountChanged(
    transactionHash: string,
    kind: "ship" | "defense",
    planetId?: string,
    itemId?: number
  ): boolean {
    return this.indexedLogsForTransaction(transactionHash).some((txLog) =>
      this.isUnitCountChangedFor(txLog, kind, planetId, itemId)
    );
  }

  private isUnitCountChangedFor(
    log: IndexedRpcLog,
    kind: "ship" | "defense",
    planetId?: string,
    itemId?: number
  ): boolean {
    if (kind === "ship" && isShipCountChangedLog(log)) {
      const event = decodeShipCountChangedLog(log);
      return (planetId === undefined || event.planetId === planetId) && (itemId === undefined || event.shipId === itemId);
    }
    if (kind === "defense" && isDefenseCountChangedLog(log)) {
      const event = decodeDefenseCountChangedLog(log);
      return (planetId === undefined || event.planetId === planetId) && (itemId === undefined || event.defenseId === itemId);
    }
    return false;
  }

  private hasLegacyUnitMutation(mutationKey: string): boolean {
    return Boolean(this.db.query("SELECT 1 FROM indexed_legacy_unit_mutations WHERE mutation_key = ?").get(mutationKey));
  }

  private storedLegacyUnitMutations(mutationKey: string): LegacyUnitMutation[] | null {
    const row = this.db.query("SELECT event_json FROM indexed_legacy_unit_mutations WHERE mutation_key = ?").get(mutationKey) as
      | { event_json: string }
      | null;
    if (!row) return null;
    const payload = parseEvent<{ mutations?: unknown }>(row.event_json);
    if (!Array.isArray(payload.mutations)) return null;
    const mutations = payload.mutations.filter((mutation): mutation is LegacyUnitMutation => {
      if (!mutation || typeof mutation !== "object") return false;
      const candidate = mutation as Partial<LegacyUnitMutation>;
      return (
        (candidate.kind === "ship" || candidate.kind === "defense")
        && typeof candidate.planetId === "string"
        && typeof candidate.itemId === "number"
        && typeof candidate.delta === "number"
      );
    });
    return mutations.length > 0 ? mutations : null;
  }

  private applyLegacyUnitMutationsOnce(
    mutationKey: string,
    mutations: LegacyUnitMutation[],
    source: unknown,
    options: { allowExistingMarker?: boolean } = {}
  ): number {
    const nonZeroMutations = mutations.filter((mutation) => mutation.delta !== 0);
    if (nonZeroMutations.length === 0) return 0;
    const payload = JSON.stringify({ source, mutations: nonZeroMutations });
    if (options.allowExistingMarker) {
      this.db.query(`
        INSERT INTO indexed_legacy_unit_mutations (mutation_key, event_json)
        VALUES (?, ?)
        ON CONFLICT(mutation_key) DO UPDATE SET event_json = excluded.event_json
      `).run(mutationKey, payload);
    } else {
      const inserted = this.db.query(`
        INSERT OR IGNORE INTO indexed_legacy_unit_mutations (mutation_key, event_json)
        VALUES (?, ?)
      `).run(mutationKey, payload);
      if (inserted.changes === 0) return 0;
    }
    for (const mutation of nonZeroMutations) {
      this.adjustLegacyUnitCount(mutation);
    }
    return nonZeroMutations.length;
  }

  private filterLegacyMutationsForStoredReplay(
    mutations: LegacyUnitMutation[],
    sourceLog: IndexedRpcLog,
    latestAbsoluteUnitTotals: Map<string, LegacyAbsoluteUnitTotal>
  ): LegacyUnitMutation[] {
    return mutations.filter((mutation) => {
      if (this.hasTransactionUnitCountChanged(sourceLog.transactionHash, mutation.kind, mutation.planetId, mutation.itemId)) {
        return false;
      }
      const latestAbsolute = latestAbsoluteUnitTotals.get(legacyUnitMutationKey(mutation));
      if (!latestAbsolute) return false;
      if (compareRpcLogPosition(sourceLog, latestAbsolute) < 0) return false;
      return this.currentLegacyUnitCount(mutation) === latestAbsolute.total;
    });
  }

  private filterLegacyMutationsWithoutExactCountEvent(
    mutations: LegacyUnitMutation[],
    transactionHash: string
  ): LegacyUnitMutation[] {
    return mutations.filter((mutation) => {
      if (!this.hasTransactionUnitCountChanged(transactionHash, mutation.kind, mutation.planetId, mutation.itemId)) return true;
      return this.hasTransactionUnitCompleted(transactionHash, mutation);
    });
  }

  private hasTransactionUnitCompleted(transactionHash: string, mutation: LegacyUnitMutation): boolean {
    return this.indexedLogsForTransaction(transactionHash).some((txLog) => {
      if (!isIndexedQueueCompletedLog(txLog)) return false;
      const event = decodeIndexedQueueCompletedLog(txLog);
      if (event.planetId !== mutation.planetId || event.itemId !== mutation.itemId) return false;
      return mutation.kind === "ship" ? event.eventName === "ShipCompleted" : event.eventName === "DefenseCompleted";
    });
  }

  private currentLegacyUnitCount(mutation: LegacyUnitMutation): number {
    if (mutation.kind === "ship") {
      return this.indexedLevel("contract_ship_counts", "ship_id", mutation.planetId, mutation.itemId);
    }
    return this.indexedLevel("contract_defense_counts", "defense_id", mutation.planetId, mutation.itemId);
  }

  private adjustLegacyUnitCount(mutation: LegacyUnitMutation): void {
    if (mutation.kind === "ship") {
      this.adjustIndexedLevel("indexed_ship_counts", "ship_id", "count", mutation.planetId, mutation.itemId, mutation.delta);
      this.adjustIndexedLevel("contract_ship_counts", "ship_id", "count", mutation.planetId, mutation.itemId, mutation.delta);
    } else {
      this.adjustIndexedLevel("indexed_defense_counts", "defense_id", "count", mutation.planetId, mutation.itemId, mutation.delta);
      this.adjustIndexedLevel("contract_defense_counts", "defense_id", "count", mutation.planetId, mutation.itemId, mutation.delta);
    }
  }

  private indexedLevel(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_moon_defense_counts" | "contract_moon_ship_counts" | "contract_ship_counts" | "indexed_building_levels" | "indexed_defense_counts" | "indexed_moon_building_levels" | "indexed_ship_counts",
    idColumn: string,
    planetId: string,
    itemId: number
  ): number {
    const valueColumn = table.endsWith("building_levels") ? "level" : "count";
    const row = this.db.query(`
      SELECT ${valueColumn} AS value
      FROM ${table}
      WHERE planet_id = ? AND ${idColumn} = ?
    `).get(planetId, itemId) as { value: number } | null;
    return row?.value ?? 0;
  }

  private indexedLevelsById(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_moon_defense_counts" | "contract_moon_ship_counts" | "contract_ship_counts" | "indexed_building_levels" | "indexed_defense_counts" | "indexed_moon_building_levels" | "indexed_ship_counts",
    idColumn: string,
    valueColumn: "count" | "level",
    planetId: string
  ): Map<number, number> {
    const cacheable = !table.endsWith("_ship_counts") && !table.endsWith("_defense_counts");
    const cache = cacheable ? this.indexedLevelsByIdCacheForCurrentVersion() : null;
    const cacheKey = `${table}:${idColumn}:${valueColumn}:${planetId}`;
    const cached = cache?.values.get(cacheKey);
    if (cached) return new Map(cached);

    const rows = this.db.query(`
      SELECT ${idColumn} AS id, ${valueColumn} AS value
      FROM ${table}
      WHERE planet_id = ?
    `).all(planetId) as Array<{ id: number; value: number }>;
    const levels = new Map(rows.map((row) => [row.id, row.value]));
    cache?.values.set(cacheKey, levels);
    return new Map(levels);
  }

  private upsertIndexedLevel(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_moon_defense_counts" | "contract_moon_ship_counts" | "contract_ship_counts" | "indexed_building_levels" | "indexed_defense_counts" | "indexed_moon_building_levels" | "indexed_ship_counts",
    idColumn: string,
    valueColumn: string,
    planetId: string,
    itemId: number,
    value: number
  ): void {
    this.db.query(`
      INSERT INTO ${table} (planet_id, ${idColumn}, ${valueColumn})
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id, ${idColumn}) DO UPDATE SET ${valueColumn} = excluded.${valueColumn}
    `).run(planetId, itemId, value);
  }

  private adjustIndexedLevel(
    table: "contract_defense_counts" | "contract_ship_counts" | "indexed_defense_counts" | "indexed_ship_counts",
    idColumn: string,
    valueColumn: string,
    planetId: string,
    itemId: number,
    delta: number
  ): void {
    const current = this.indexedLevel(table, idColumn, planetId, itemId);
    this.upsertIndexedLevel(table, idColumn, valueColumn, planetId, itemId, Math.max(0, current + delta));
  }

  private upsertIndexedLevelAtLeast(
    table: "contract_building_levels" | "contract_moon_building_levels" | "indexed_building_levels" | "indexed_moon_building_levels",
    idColumn: string,
    valueColumn: string,
    planetId: string,
    itemId: number,
    value: number
  ): void {
    this.db.query(`
      INSERT INTO ${table} (planet_id, ${idColumn}, ${valueColumn})
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id, ${idColumn}) DO UPDATE SET ${valueColumn} = max(${table}.${valueColumn}, excluded.${valueColumn})
    `).run(planetId, itemId, value);
  }

  private applyMoonCreatedEvent(event: IndexedMoonCreatedEvent): void {
    this.db.query(`
      INSERT INTO indexed_moons (planet_id, owner, fields, diameter_km, event_json)
      VALUES (?, lower(?), ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        fields = excluded.fields,
        diameter_km = excluded.diameter_km,
        event_json = excluded.event_json
    `).run(
      event.planetId,
      event.owner,
      event.fields,
      event.diameterKm,
      JSON.stringify({ ...event, jumpGateReadyAt: event.jumpGateReadyAt ?? "0" })
    );
    this.touch();
  }

  private applyMoonJumpGateEvent(event: IndexedMoonJumpGateEvent): void {
    this.updateMoonJumpGateReadyAt(event.originMoonPlanetId, event.nextReadyAt);
    this.updateMoonJumpGateReadyAt(event.destinationMoonPlanetId, event.nextReadyAt);
    this.touch();
  }

  private updateMoonJumpGateReadyAt(planetId: string, jumpGateReadyAt: string): void {
    const moon = this.moon(planetId);
    if (!moon) return;
    this.db.query(`
      UPDATE indexed_moons
      SET event_json = ?
      WHERE planet_id = ?
    `).run(JSON.stringify({ ...moon, jumpGateReadyAt }), planetId);
  }

  private applyRiftResourceEvent(event: IndexedRiftResourceEvent): void {
    const owner = event.owner.toLowerCase();
    const current = this.riftBalance(owner, event.planetId, event.resourceId);
    const inGameBalance = BigInt(current?.in_game_balance ?? "0");
    const lockedBalance = BigInt(current?.locked_balance ?? "0");
    const amount = BigInt(event.amount);

    if (event.eventName === "MarketResourceDeposited") {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, inGameBalance + amount, lockedBalance);
    } else if (event.eventName === "MarketResourceWithdrawalRequested") {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, subtractNonNegative(inGameBalance, amount), lockedBalance + amount);
      this.db.query(`
        INSERT INTO indexed_rift_withdrawals (withdrawal_key, owner, planet_id, resource_id, amount, unlocks_at, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(withdrawal_key) DO UPDATE SET
          amount = excluded.amount,
          unlocks_at = excluded.unlocks_at,
          event_json = excluded.event_json
      `).run(riftWithdrawalKey(event), owner, event.planetId, event.resourceId, event.amount, event.unlocksAt ?? "0", JSON.stringify(event));
    } else {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, inGameBalance, subtractNonNegative(lockedBalance, amount));
      this.db.query(`
        DELETE FROM indexed_rift_withdrawals
        WHERE owner = ? AND planet_id = ? AND resource_id = ? AND amount = ?
      `).run(owner, event.planetId, event.resourceId, event.amount);
    }
    this.touch();
  }

  private applyAllianceEvent(event: IndexedAllianceEvent): void {
    if (event.eventName === "AllianceCreated") {
      this.db.query(`
        INSERT INTO contract_alliances (
          alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
        )
        VALUES (?, 1, ?, ?, '', lower(?), ?, 0, ?)
        ON CONFLICT(alliance_id) DO UPDATE SET
          active = 1,
          tag = excluded.tag,
          name = excluded.name,
          owner = excluded.owner,
          created_at = excluded.created_at,
          event_json = excluded.event_json
      `).run(event.allianceId, event.tag, event.name, event.owner, event.createdAt, JSON.stringify(event));
    } else if (event.eventName === "AllianceProfileUpdated") {
      this.db.query(`
        UPDATE contract_alliances
        SET tag = ?, name = ?, description = ?, event_json = ?
        WHERE alliance_id = ?
      `).run(event.tag, event.name, event.description, JSON.stringify(event), event.allianceId);
    } else if (event.eventName === "AllianceInviteCreated") {
      this.db.query(`
        INSERT INTO contract_alliance_invites (alliance_id, player, inviter, invited_at)
        VALUES (?, lower(?), lower(?), ?)
        ON CONFLICT(alliance_id, player) DO UPDATE SET
          inviter = excluded.inviter,
          invited_at = excluded.invited_at
      `).run(event.allianceId, event.player, event.inviter, event.invitedAt);
    } else if (event.eventName === "AllianceInviteCancelled") {
      this.db.query(`
        DELETE FROM contract_alliance_invites
        WHERE alliance_id = ? AND player = lower(?)
      `).run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceJoinRequested") {
      this.db.query(`
        INSERT INTO contract_alliance_join_requests (alliance_id, requester, requested_at)
        VALUES (?, lower(?), ?)
        ON CONFLICT(alliance_id, requester) DO UPDATE SET
          requested_at = excluded.requested_at
      `).run(event.allianceId, event.requester, event.requestedAt);
    } else if (event.eventName === "AllianceJoinRequestCancelled") {
      this.db.query(`
        DELETE FROM contract_alliance_join_requests
        WHERE alliance_id = ? AND requester = lower(?)
      `).run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceJoinRequestDismissed" || event.eventName === "AllianceJoinRequestApproved") {
      this.db.query(`
        DELETE FROM contract_alliance_join_requests
        WHERE alliance_id = ? AND requester = lower(?)
      `).run(event.allianceId, event.requester);
    } else if (event.eventName === "AllianceJoined") {
      this.db.query(`
        INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at)
        VALUES (?, lower(?), ?, ?)
        ON CONFLICT(alliance_id, wallet) DO UPDATE SET
          role_id = excluded.role_id,
          joined_at = excluded.joined_at
      `).run(event.allianceId, event.player, event.roleId, event.joinedAt);
      this.db.query(`
        UPDATE contract_alliances
        SET member_count = (
          SELECT COUNT(*)
          FROM contract_alliance_members
          WHERE alliance_id = ?
        )
        WHERE alliance_id = ?
      `).run(event.allianceId, event.allianceId);
      this.db.query("DELETE FROM contract_alliance_invites WHERE alliance_id = ? AND player = lower(?)").run(event.allianceId, event.player);
      this.db.query("DELETE FROM contract_alliance_join_requests WHERE alliance_id = ? AND requester = lower(?)").run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceLeft") {
      this.db.query(`
        DELETE FROM contract_alliance_members
        WHERE alliance_id = ? AND wallet = lower(?)
      `).run(event.allianceId, event.player);
      this.db.query(`
        UPDATE contract_alliances
        SET member_count = (
          SELECT COUNT(*)
          FROM contract_alliance_members
          WHERE alliance_id = ?
        )
        WHERE alliance_id = ?
      `).run(event.allianceId, event.allianceId);
    } else if (event.eventName === "AllianceRoleUpdated") {
      this.db.query(`
        UPDATE contract_alliance_members
        SET role_id = ?
        WHERE alliance_id = ? AND wallet = lower(?)
      `).run(event.roleId, event.allianceId, event.player);
    } else if (event.eventName === "AllianceOwnershipTransferred") {
      this.db.query(`
        UPDATE contract_alliances
        SET owner = lower(?)
        WHERE alliance_id = ?
      `).run(event.newOwner, event.allianceId);
    } else if (event.eventName === "AllianceDiplomacyUpdated") {
      this.db.query(`
        INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at, initiated_by_alliance_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(alliance_id, other_alliance_id) DO UPDATE SET
          status_id = excluded.status_id,
          updated_at = excluded.updated_at,
          initiated_by_alliance_id = excluded.initiated_by_alliance_id
      `).run(
        event.allianceId,
        event.otherAllianceId,
        event.statusId,
        event.blockNumber,
        diplomacyStatusName(event.statusId) === "war" ? event.allianceId : null
      );
    }

    this.touch();
  }

  private applyAllianceDirectorySnapshot(directory: readonly AllianceState["directory"][number][]): void {
    for (const alliance of directory) {
      const memberCount = alliance.members ? alliance.members.length : alliance.memberCount;
      this.db.query(`
        INSERT INTO contract_alliances (
          alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
        )
        VALUES (?, ?, ?, ?, ?, lower(?), ?, ?, ?)
        ON CONFLICT(alliance_id) DO UPDATE SET
          active = excluded.active,
          tag = excluded.tag,
          name = excluded.name,
          description = excluded.description,
          owner = excluded.owner,
          created_at = excluded.created_at,
          member_count = excluded.member_count,
          event_json = excluded.event_json
      `).run(
        alliance.allianceId,
        alliance.active ? 1 : 0,
        alliance.tag,
        alliance.name,
        alliance.description,
        alliance.owner,
        alliance.createdAt,
        memberCount,
        JSON.stringify({
          eventName: "AllianceDirectorySnapshot",
          allianceId: alliance.allianceId,
          active: alliance.active,
          tag: alliance.tag,
          name: alliance.name,
          description: alliance.description,
          owner: alliance.owner,
          createdAt: alliance.createdAt,
          memberCount
        })
      );

      if (!alliance.members) continue;
      this.db.query("DELETE FROM contract_alliance_members WHERE alliance_id = ?").run(alliance.allianceId);
      for (const member of alliance.members) {
        this.db.query(`
          INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at)
          VALUES (?, lower(?), ?, ?)
          ON CONFLICT(alliance_id, wallet) DO UPDATE SET
            role_id = excluded.role_id,
            joined_at = excluded.joined_at
        `).run(alliance.allianceId, member.address, allianceRoleId(member.role), member.joinedAt);
      }
    }

    if (directory.length > 0) this.touch();
  }

  // Canonical-mirror seed for contract_alliance_join_requests. null snapshot => reader can't read it,
  // keep event-derived rows; non-null => DELETE+replace so the table mirrors the chain exactly (an
  // empty array clears stale event rows that no longer exist on chain).
  private applyAllianceJoinRequestSnapshot(snapshot: AllianceJoinRequestSnapshot[] | null): void {
    if (snapshot === null) return;
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    for (const request of snapshot) {
      this.db.query(`
        INSERT INTO contract_alliance_join_requests (alliance_id, requester, requested_at)
        VALUES (?, lower(?), ?)
        ON CONFLICT(alliance_id, requester) DO UPDATE SET
          requested_at = excluded.requested_at
      `).run(request.allianceId, request.requester, request.requestedAt);
    }
    this.touch();
  }

  // Canonical-mirror seed for contract_alliance_invites. See applyAllianceJoinRequestSnapshot for the
  // null vs. empty-array semantics.
  private applyAllianceInviteSnapshot(snapshot: AllianceInviteSnapshot[] | null): void {
    if (snapshot === null) return;
    this.db.query("DELETE FROM contract_alliance_invites").run();
    for (const invite of snapshot) {
      this.db.query(`
        INSERT INTO contract_alliance_invites (alliance_id, player, inviter, invited_at)
        VALUES (?, lower(?), lower(?), ?)
        ON CONFLICT(alliance_id, player) DO UPDATE SET
          inviter = excluded.inviter,
          invited_at = excluded.invited_at
      `).run(invite.allianceId, invite.player, invite.inviter, invite.invitedAt);
    }
    this.touch();
  }

  // Canonical-mirror seed for contract_alliance_diplomacy. The reader returns one row per directed
  // (alliance_id, other_alliance_id) pair, matching the AllianceDiplomacyUpdated handler that writes both
  // directions; updated_at is left NULL on the chain seed (no event block backs it). See null vs.
  // empty-array semantics on applyAllianceJoinRequestSnapshot.
  private applyAllianceDiplomacySnapshot(snapshot: AllianceDiplomacySnapshot[] | null): void {
    if (snapshot === null) return;
    const existingInitiators = new Map(
      (this.db.query(`
        SELECT alliance_id, other_alliance_id, initiated_by_alliance_id
        FROM contract_alliance_diplomacy
        WHERE initiated_by_alliance_id IS NOT NULL
      `).all() as Pick<AllianceDiplomacyRow, "alliance_id" | "other_alliance_id" | "initiated_by_alliance_id">[])
        .map((row) => [`${row.alliance_id}:${row.other_alliance_id}`, row.initiated_by_alliance_id])
    );
    const snapshotWarPairs = new Set(
      snapshot
        .filter((relation) => diplomacyStatusName(relation.statusId) === "war")
        .map((relation) => `${relation.allianceId}:${relation.otherAllianceId}`)
    );
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
    for (const relation of snapshot) {
      const relationKey = `${relation.allianceId}:${relation.otherAllianceId}`;
      const reverseKey = `${relation.otherAllianceId}:${relation.allianceId}`;
      const status = diplomacyStatusName(relation.statusId);
      const existingInitiator = existingInitiators.get(relationKey) ?? existingInitiators.get(reverseKey);
      const inferredInitiator = status === "war" && !snapshotWarPairs.has(reverseKey)
        ? relation.allianceId
        : null;
      this.db.query(`
        INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at, initiated_by_alliance_id)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(alliance_id, other_alliance_id) DO UPDATE SET
          status_id = excluded.status_id,
          initiated_by_alliance_id = excluded.initiated_by_alliance_id
      `).run(
        relation.allianceId,
        relation.otherAllianceId,
        relation.statusId,
        status === "war" ? (existingInitiator ?? inferredInitiator) : null
      );
    }
    this.touch();
  }

  private touch(): void {
    this.stateGeneration += 1;
    this.snapshotCache = null;
    this.setMetadata(indexedStateVersionMetadataKey, this.stateGeneration.toString());
    this.setMetadata("lastRebuiltAt", new Date().toISOString());
  }

  private touchMissionReadModel(): void {
    this.missionGeneration += 1;
    this.missionReadModelDbVersion = this.advanceMissionReadModelDbVersion();
    this.missionReadModelCache = null;
    this.decodedMissionLogCache = null;
    this.decodedBattleReportCache = null;
    this.battleReportsByMissionIdCache = null;
    this.fulfilledRandomnessRequestIdsCache = null;
    this.missionReferenceCache = null;
    this.canonicalActiveMissionCache.clear();
    this.canonicalCompletedMissionCache = null;
    this.attackLaunchSecondsCache.clear();
  }

  private currentMissionReadModelDbVersion(): string {
    const version = this.metadata("missionReadModelVersion") ?? "0";
    if (this.missionReadModelDbVersion !== version) {
      this.missionReadModelDbVersion = version;
      this.missionGeneration += 1;
      this.missionReadModelCache = null;
      this.decodedMissionLogCache = null;
      this.decodedBattleReportCache = null;
      this.battleReportsByMissionIdCache = null;
      this.fulfilledRandomnessRequestIdsCache = null;
      this.missionReferenceCache = null;
      this.canonicalActiveMissionCache.clear();
      this.canonicalCompletedMissionCache = null;
      this.attackLaunchSecondsCache.clear();
    }
    return version;
  }

  private advanceMissionReadModelDbVersion(): string {
    this.snapshotCache = null;
    const row = this.db.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES ('missionReadModelVersion', '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(indexer_metadata.value AS INTEGER) + 1 AS TEXT)
      RETURNING value
    `).get() as MetadataRow | null;
    return row?.value ?? this.metadata("missionReadModelVersion") ?? "0";
  }

  private currentBattleReportReadModelDbVersion(): string {
    const version = this.metadata("battleReportReadModelVersion") ?? "0";
    if (this.battleReportReadModelDbVersion !== version) {
      this.battleReportReadModelDbVersion = version;
      this.battleReportGeneration += 1;
      if (this.missionReadModelCache) {
        this.missionReadModelCache = {
          ...this.missionReadModelCache,
          battleReportGeneration: this.battleReportGeneration,
          battleReports: null
        };
      }
      this.decodedBattleReportCache = null;
      this.battleReportsByMissionIdCache = null;
      this.recentBattleReportsCache.clear();
    }
    return version;
  }

  private advanceBattleReportReadModelDbVersion(): string {
    this.snapshotCache = null;
    const row = this.db.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES ('battleReportReadModelVersion', '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(indexer_metadata.value AS INTEGER) + 1 AS TEXT)
      RETURNING value
    `).get() as MetadataRow | null;
    return row?.value ?? this.metadata("battleReportReadModelVersion") ?? "0";
  }

  private touchBattleReportReadModel(): void {
    this.battleReportGeneration += 1;
    this.battleReportReadModelDbVersion = this.advanceBattleReportReadModelDbVersion();
    if (this.missionReadModelCache) {
      this.missionReadModelCache = {
        ...this.missionReadModelCache,
        battleReportGeneration: this.battleReportGeneration,
        battleReports: null
      };
    }
    this.decodedBattleReportCache = null;
    this.battleReportsByMissionIdCache = null;
    this.recentBattleReportsCache.clear();
  }

  private applyReferralClaimEvent(eventId: string, event: IndexedReferralClaimEvent): void {
    this.db.query(`
      INSERT OR REPLACE INTO indexed_referral_claims
        (event_id, owner, commitment, transaction_hash, block_number, event_json)
      VALUES (?, lower(?), lower(?), lower(?), ?, ?)
    `).run(
      eventId,
      event.inviter,
      event.commitment,
      event.transactionHash,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private seedStartPriceBootstrap(startPriceWei: string | null): void {
    if (!startPriceWei || !/^\d+$/.test(startPriceWei)) return;
    this.setMetadata(startPriceBootstrapWeiMetadataKey, startPriceWei);
    const current = this.currentStartPriceWei();
    if (current === null) {
      this.setMetadata(startPriceWeiMetadataKey, startPriceWei);
      this.setMetadata(startPriceSourceMetadataKey, "bootstrap");
      return;
    }
    this.updateStartPriceBootstrapDivergence(current);
  }

  private applyCanonicalStartPrice(
    startPriceWei: string,
    source: "event" | "rebuild",
    event?: IndexedStartPriceUpdatedEvent,
    eventId?: string,
    canonicalBlock?: string | null
  ): void {
    if (!/^\d+$/.test(startPriceWei)) {
      throw new Error(`Invalid canonical start price: ${startPriceWei}`);
    }
    this.setMetadata(startPriceWeiMetadataKey, startPriceWei);
    this.setMetadata(startPriceSourceMetadataKey, source);
    if (event) {
      this.setMetadata("lastStartPriceUpdatedBlock", event.blockNumber);
      this.setMetadata("lastStartPriceUpdatedTransactionHash", event.transactionHash);
    }
    if (eventId) this.setMetadata("lastStartPriceUpdatedEventId", eventId);
    const blockNumber = event?.blockNumber ?? canonicalBlock;
    if (blockNumber) this.setMetadata(startPriceBlockMetadataKey, blockNumber);
    if (event) this.setMetadata(startPriceLogIndexMetadataKey, event.logIndex);
    else if (canonicalBlock) this.setMetadata(startPriceLogIndexMetadataKey, "0xffffffffffffffff");
    this.updateStartPriceBootstrapDivergence(startPriceWei);
  }

  private updateStartPriceBootstrapDivergence(currentStartPriceWei: string): void {
    const bootstrap = this.metadata(startPriceBootstrapWeiMetadataKey);
    if (!bootstrap || bootstrap === currentStartPriceWei) {
      this.db.query("DELETE FROM indexer_metadata WHERE key = ?").run(startPriceBootstrapDivergenceMetadataKey);
      this.snapshotCache = null;
      return;
    }
    this.setMetadata(startPriceBootstrapDivergenceMetadataKey, JSON.stringify({
      bootstrapStartPriceWei: bootstrap,
      canonicalStartPriceWei: currentStartPriceWei
    }));
  }

  private applyStartPriceUpdatedEvent(eventId: string, event: IndexedStartPriceUpdatedEvent): boolean {
    const currentBlock = this.metadata(startPriceBlockMetadataKey);
    const currentLogIndex = this.metadata(startPriceLogIndexMetadataKey) ?? "0x0";
    if (
      currentBlock !== null
      && compareBlockAndLogPosition(event.blockNumber, event.logIndex, currentBlock, currentLogIndex) < 0
    ) {
      return false;
    }
    this.applyCanonicalStartPrice(event.startPriceWei, "event", event, eventId);
    return true;
  }

  private applyReferralRedemptionEvent(eventId: string, event: IndexedReferralRedemptionEvent): void {
    this.db.query(`
      INSERT OR REPLACE INTO indexed_referral_redemptions
        (event_id, inviter, invitee, commitment, transaction_hash, block_number, event_json)
      VALUES (?, lower(?), lower(?), lower(?), lower(?), ?, ?)
    `).run(
      eventId,
      event.inviter,
      event.invitee,
      event.commitment,
      event.transactionHash,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private applyReferralRewardClaimEvent(eventId: string, event: IndexedReferralRewardClaimEvent): void {
    this.db.query(`
      INSERT OR REPLACE INTO indexed_referral_reward_claims
        (event_id, inviter, invitee, commitment, recipient, transaction_hash, block_number, event_json)
      VALUES (?, lower(?), lower(?), lower(?), lower(?), lower(?), ?, ?)
    `).run(
      eventId,
      event.inviter,
      event.invitee,
      event.commitment,
      event.recipient,
      event.transactionHash,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private recordLog(eventId: string, log: IndexedRpcLog): boolean {
    const result = this.db.query(`
      INSERT INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(
      eventId,
      log.transactionHash,
      log.logIndex ?? "0x0",
      blockNumberToDecimal(log.blockNumber),
      log.removed ? 1 : 0,
      JSON.stringify(log),
      new Date().toISOString()
    );
    if (result.changes > 0) {
      this.recordMissionEventLog(eventId, log);
      this.recordUnitCountEventLog(eventId, log);
    }
    return result.changes > 0;
  }

  private recordMissionEventLog(eventId: string, log: IndexedRpcLog): void {
    if (log.removed) return;
    const eventKind = this.missionEventKind(log);
    if (!eventKind) return;
    this.db.query(`
      INSERT OR REPLACE INTO indexed_mission_event_logs (event_id, event_kind, block_number, event_json)
      VALUES (?, ?, ?, ?)
    `).run(eventId, eventKind, blockNumberToDecimal(log.blockNumber), JSON.stringify(log));
    if (eventKind === "battle") {
      const missionId = battleLogMissionId(log);
      if (missionId) this.markBattleReportMaterializationPending(missionId, blockNumberToDecimal(log.blockNumber));
    }
    this.touchMissionReadModel();
  }

  private recordUnitCountEventLog(eventId: string, log: IndexedRpcLog): void {
    if (log.removed || !this.isUnitCountSnapshotLog(log)) return;
    this.db.query(`
      INSERT OR REPLACE INTO indexed_unit_count_event_logs (event_id, block_number, log_index, event_json)
      VALUES (?, ?, ?, ?)
    `).run(eventId, blockNumberToDecimal(log.blockNumber), log.logIndex ?? "0x0", JSON.stringify(log));
    this.touchBattleReportReadModel();
  }

  private repairDerivedRowsForExistingLog(eventId: string, log: IndexedRpcLog): number {
    if (log.removed) return 0;

    let repairedRows = 0;
    if (this.missionEventKind(log)) {
      const existingMissionEvent = this.db
        .query("SELECT 1 FROM indexed_mission_event_logs WHERE event_id = ?")
        .get(eventId);
      if (!existingMissionEvent) {
        this.recordMissionEventLog(eventId, log);
        repairedRows += 1;
      }
    }

    if (this.isUnitCountSnapshotLog(log)) {
      const existingUnitCountEvent = this.db
        .query("SELECT 1 FROM indexed_unit_count_event_logs WHERE event_id = ?")
        .get(eventId);
      if (!existingUnitCountEvent) {
        this.recordUnitCountEventLog(eventId, log);
        repairedRows += 1;
      }
    }

    if (isReferralClaimLog(log)) {
      const existingReferralClaim = this.db
        .query("SELECT 1 FROM indexed_referral_claims WHERE event_id = ?")
        .get(eventId);
      if (!existingReferralClaim) {
        this.applyReferralClaimEvent(eventId, decodeReferralClaimLog(log));
        repairedRows += 1;
      }
    } else if (isReferralRedemptionLog(log)) {
      const existingReferralRedemption = this.db
        .query("SELECT 1 FROM indexed_referral_redemptions WHERE event_id = ?")
        .get(eventId);
      if (!existingReferralRedemption) {
        this.applyReferralRedemptionEvent(eventId, decodeReferralRedemptionLog(log));
        repairedRows += 1;
      }
    } else if (isReferralRewardClaimLog(log)) {
      const existingReferralRewardClaim = this.db
        .query("SELECT 1 FROM indexed_referral_reward_claims WHERE event_id = ?")
        .get(eventId);
      if (!existingReferralRewardClaim) {
        this.applyReferralRewardClaimEvent(eventId, decodeReferralRewardClaimLog(log));
        repairedRows += 1;
      }
    } else if (
      isStartPriceUpdatedLog(log)
      && this.metadata("lastStartPriceUpdatedEventId") !== eventId
    ) {
      if (this.applyStartPriceUpdatedEvent(eventId, decodeStartPriceUpdatedLog(log))) {
        repairedRows += 1;
      }
    }

    return repairedRows;
  }

  private recordLogIfMissing(log: IndexedRpcLog): void {
    const eventId = indexedLogKey(log);
    const existing = this.db.query("SELECT event_json FROM indexed_event_logs WHERE event_id = ?").get(eventId) as EventRow | null;
    if (existing) return;
    this.recordLog(eventId, log);
    this.recordLatestBlock(log.blockNumber);
  }

  private recordPlayerActivityFromLog(eventId: string, log: IndexedRpcLog): void {
    const lastActiveAt = blockTimestampSeconds(log);
    if (!lastActiveAt) return;

    const owner = this.playerActivityOwnerForLog(log);
    if (!owner) return;

    this.db.query(`
      INSERT INTO indexed_player_activity (wallet, last_active_at, event_id)
      VALUES (lower(?), ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        last_active_at = CASE
          WHEN CAST(excluded.last_active_at AS INTEGER) > CAST(indexed_player_activity.last_active_at AS INTEGER)
          THEN excluded.last_active_at
          ELSE indexed_player_activity.last_active_at
        END,
        event_id = CASE
          WHEN CAST(excluded.last_active_at AS INTEGER) > CAST(indexed_player_activity.last_active_at AS INTEGER)
          THEN excluded.event_id
          ELSE indexed_player_activity.event_id
        END
    `).run(owner, lastActiveAt, eventId);
  }

  private playerActivityOwnerForLog(log: IndexedRpcLog): Address | null {
    try {
      if (isSettledPlanetLog(log)) return decodeSettledPlanetLog(log).owner;
      if (isPlanetRenamedLog(log)) return decodePlanetRenamedLog(log).owner;
      if (isRiftResourceLog(log)) return decodeRiftResourceLog(log).owner;

      if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        return event.owner ?? this.ownerForPlanetActivity(event.planetId);
      }

      if (isIndexedQueueCompletedLog(log)) {
        const event = decodeIndexedQueueCompletedLog(log);
        return event.owner ?? this.ownerForPlanetActivity(event.planetId);
      }

      if (isPlanetSettledLog(log)) return this.ownerForPlanetActivity(decodePlanetSettledLog(log).planetId);
      if (isMoonResourcesSettledLog(log)) return this.ownerForPlanetActivity(decodeMoonResourcesSettledLog(log).planetId);
      if (isShipCountChangedLog(log)) return this.ownerForPlanetActivity(decodeShipCountChangedLog(log).planetId);
      if (isDefenseCountChangedLog(log)) return this.ownerForPlanetActivity(decodeDefenseCountChangedLog(log).planetId);
      if (isMoonShipCountChangedLog(log)) return this.ownerForPlanetActivity(decodeMoonShipCountChangedLog(log).planetId);
      if (isMoonDefenseCountChangedLog(log)) return this.ownerForPlanetActivity(decodeMoonDefenseCountChangedLog(log).planetId);
      if (isMoonCreatedLog(log)) return decodeMoonCreatedLog(log).owner;
      if (isMoonJumpGateLog(log)) return decodeMoonJumpGateLog(log).player;

      if (isFleetMissionLog(log)) {
        const mission = [...decodeFleetMissionLogs([log]).values()][0];
        return mission?.owner ?? null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private ownerForPlanetActivity(planetId: string | undefined): Address | null {
    if (!planetId) return null;
    return this.planet(planetId)?.owner ?? null;
  }

  private recordRemovedLog(eventId: string, log: IndexedRpcLog): void {
    this.db.query(`
      INSERT OR IGNORE INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(
      eventId,
      log.transactionHash,
      `${log.logIndex ?? "0x0"}:removed`,
      blockNumberToDecimal(log.blockNumber),
      JSON.stringify(log),
      new Date().toISOString()
    );
  }

  private markReorgDetected(): void {
    this.setMetadata("reorgDetectedAt", new Date().toISOString());
  }

  // `latestIndexedBlock` is the high-water mark of indexed blocks and the snapshot the departed-ships
  // reconcile baseline is pinned to (refreshCanonicalStateUncached). It MUST only ever move forward.
  // Logs do not always reach us in block order — a gap/reorg recovery or self-heal backfill can re-apply
  // an older range after the live head feed has already advanced — and a non-monotonic write would drag
  // the head backwards. A regressed head freezes the reconcile baseline below missions that have already
  // launched AND returned, so the debit-only projection keeps subtracting them and their ships vanish
  // from the shipyard (at-planet shows 0). Clamp to the max so a stale write can never lower it.
  private recordLatestBlock(blockNumber: string): void {
    const next = blockNumberToDecimal(blockNumber);
    const current = this.metadata("latestIndexedBlock");
    if (current !== null) {
      try {
        if (BigInt(next) <= BigInt(current)) return;
      } catch {
        // If either value isn't a parseable integer, fall through and overwrite with the latest write.
      }
    }
    this.setMetadata("latestIndexedBlock", next);
  }

  private recordSuccessfulReconciliation(latestBlock: string | null): void {
    const now = new Date().toISOString();
    this.setMetadata("lastReconciledAt", now);
    this.setMetadata("lastReconciledBlock", latestBlock ?? this.fromBlock.toString());
    this.db.query("DELETE FROM indexer_metadata WHERE key = 'lastReconciliationError'").run();
    this.db.query("DELETE FROM indexer_metadata WHERE key = 'pendingReconciliationReason'").run();
    this.snapshotCache = null;
    if (latestBlock) {
      this.recordLatestBlock(latestBlock);
    }
  }

  private recordSuccessfulAllianceReconciliation(): void {
    this.setMetadata("allianceReconciledAt", new Date().toISOString());
  }

  private recordReconciliationError(error: unknown): void {
    this.setMetadata("lastReconciliationError", error instanceof Error ? error.message : String(error));
  }

  private setMetadata(key: string, value: string, options: { invalidateSnapshot?: boolean } = {}): void {
    if (options.invalidateSnapshot !== false) {
      this.snapshotCache = null;
    }
    this.db.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private moon(planetId: string): IndexedMoonCreatedEvent | null {
    const row = this.db.query("SELECT event_json FROM indexed_moons WHERE planet_id = ?").get(planetId) as MoonRow | null;
    return row ? parseEvent<IndexedMoonCreatedEvent>(row.event_json) : null;
  }

  private riftBalances(wallet: `0x${string}`, planetId: string | null): RiftBalanceRow[] {
    if (!planetId) return [];
    return this.db.query(`
      SELECT resource_id, in_game_balance, locked_balance
      FROM indexed_rift_balances
      WHERE owner = lower(?) AND planet_id = ?
      ORDER BY resource_id ASC
    `).all(wallet, planetId) as RiftBalanceRow[];
  }

  private riftBalance(owner: string, planetId: string, resourceId: number): RiftBalanceRow | null {
    return this.db.query(`
      SELECT resource_id, in_game_balance, locked_balance
      FROM indexed_rift_balances
      WHERE owner = lower(?) AND planet_id = ? AND resource_id = ?
    `).get(owner, planetId, resourceId) as RiftBalanceRow | null;
  }

  private upsertRiftBalance(owner: string, planetId: string, resourceId: number, inGameBalance: bigint, lockedBalance: bigint): void {
    this.db.query(`
      INSERT INTO indexed_rift_balances (owner, planet_id, resource_id, in_game_balance, locked_balance)
      VALUES (lower(?), ?, ?, ?, ?)
      ON CONFLICT(owner, planet_id, resource_id) DO UPDATE SET
        in_game_balance = excluded.in_game_balance,
        locked_balance = excluded.locked_balance
    `).run(owner, planetId, resourceId, inGameBalance.toString(), lockedBalance.toString());
  }

  private pendingWithdrawals(wallet: `0x${string}`, planetId: string | null): PendingWithdrawalRow[] {
    if (!planetId) return [];
    return this.db.query(`
      SELECT withdrawal_key, resource_id, amount, unlocks_at
      FROM indexed_rift_withdrawals
      WHERE owner = lower(?) AND planet_id = ?
      ORDER BY CAST(unlocks_at AS INTEGER) ASC
    `).all(wallet, planetId) as PendingWithdrawalRow[];
  }

  private indexedFleetMissionSummaries(): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    // Fleet mission summaries are derived by decoding historical mission logs. Cache them in a short
    // bucket instead of the exact current second so hot read paths don't rescan the full event log table
    // every second on every API worker. Route-level response caches use similar TTLs; the UI already
    // refreshes live countdowns client-side between backend snapshots.
    const asOfSeconds = Math.floor(Date.now() / 10_000) * 10;
    if (
      this.missionReadModelCache
      && this.missionReadModelCache.missionGeneration === this.missionGeneration
      && this.missionReadModelCache.asOfSeconds === asOfSeconds
    ) {
      return this.missionReadModelCache.summaries;
    }

    const decoded = this.decodedMissionLogs();
    // VEY-KANEO-479: decode leaves `needsResolution` at its default; compute it here so an arrived
    // Attack only reads "Ready to resolve" once its battle randomness is fulfilled (gated on the
    // ingested RandomnessFulfilled logs). Harvest and the other types stay on the plain arrival check.
    const missions = this.mergeCanonicalFleetMissions(decoded.eventMissions);
    // Only an arrived Attack awaiting its randomness needs the fulfillment scan; skip it (and the
    // extra full-table read it does) whenever nothing is actually gated, which is the common case.
    const needsGate = this.randomnessEngineConfigured && missions.some(
      (mission) =>
        missionBattleRandomnessRequestId(mission) !== null
        && mission.status === "Outbound"
        && Number(mission.arrivalAt) <= asOfSeconds
    );
    const fulfilledRandomnessRequestIds = needsGate ? decoded.fulfilledRandomnessRequestIds : null;
    const summaries = missions.map((mission) => {
      const status = (
        (mission.status === "Returning" || mission.status === "Recalled")
        && Number(mission.returnAt) <= asOfSeconds
      )
        ? "Returned"
        : mission.status;
      const needsResolution = fleetMissionNeedsResolution({ ...mission, status }, asOfSeconds, fulfilledRandomnessRequestIds);
      return withFleetMissionResolutionBlocker({
        ...mission,
        status,
        needsResolution
      }, asOfSeconds, fulfilledRandomnessRequestIds);
    });
    this.missionReadModelCache = {
      missionGeneration: this.missionGeneration,
      battleReportGeneration: this.battleReportGeneration,
      asOfSeconds,
      summaries,
      battleReports: null
    };
    return summaries;
  }

  private indexedFleetMissionSummariesWithPlanetReferences(): FleetMissionSummary[] {
    return this.indexedFleetMissionReferenceIndex().summaries;
  }

  private indexedFleetMissionReferenceIndex(): {
    source: FleetMissionSummary[];
    summaries: FleetMissionSummary[];
    byId: Map<string, FleetMissionSummary>;
    active: FleetMissionSummary[];
    completed: FleetMissionSummary[];
    activeByTarget: Map<string, FleetMissionSummary[]>;
  } {
    const source = this.indexedFleetMissionSummaries();
    const cached = this.missionReferenceCache;
    if (cached && cached.source === source) {
      return cached;
    }

    const stateVersion = this.indexedStateCacheVersion();
    const summaries = source.map((mission) => this.withFleetMissionPlanetReferences(mission, stateVersion));
    const byId = new Map(summaries.map((mission) => [mission.missionId, mission]));
    const active = summaries
      .filter(isVisibleActiveFleetMission)
      .sort(compareFleetMissionsActiveSoonestFirst);
    const completed = summaries
      .filter((mission) => mission.status === "Resolved" || mission.status === "Returned")
      .sort(compareFleetMissionsNewestFirst);
    const activeByTarget = new Map<string, FleetMissionSummary[]>();
    for (const mission of active) {
      const targetMissions = activeByTarget.get(mission.targetPlanetId);
      if (targetMissions) targetMissions.push(mission);
      else activeByTarget.set(mission.targetPlanetId, [mission]);
    }

    const next = { source, summaries, byId, active, completed, activeByTarget };
    this.missionReferenceCache = next;
    return next;
  }

  private activeFleetMissionsFromCanonicalRows(options: { includeOverduePendingRandomness?: boolean } = {}): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    const stateVersion = this.indexedStateCacheVersion();
    const asOfSeconds = nowSeconds();
    const includeOverduePendingRandomness = options.includeOverduePendingRandomness === true;
    const cacheKey = includeOverduePendingRandomness ? "with-overdue-pending-randomness" : "visible";
    const cached = this.canonicalActiveMissionCache.get(cacheKey);
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.stateVersion === stateVersion
      && cached.includeOverduePendingRandomness === includeOverduePendingRandomness
    ) {
      return this.activeFleetMissionsAsOf(cached.baseMissions, asOfSeconds, includeOverduePendingRandomness, cached.fulfilledRandomnessRequestIds);
    }

    const rows = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE status_id IN (1, 2, 5)
      ORDER BY CAST(arrival_at AS INTEGER) ASC
    `).all() as ContractFleetMissionRow[];
    const baseMissions = rows.map((row) => this.withFleetMissionPlanetReferences(this.canonicalFleetMissionSummary(row), stateVersion));
    const needsGate = this.randomnessEngineConfigured && baseMissions.some(
      (mission) =>
        missionBattleRandomnessRequestId(mission) !== null
        && mission.status === "Outbound"
        && Number(mission.arrivalAt) <= asOfSeconds
    );
    const fulfilledRandomnessRequestIds = needsGate ? this.fulfilledRandomnessRequestIds() : null;
    const next = {
      missionGeneration: this.missionGeneration,
      stateVersion,
      includeOverduePendingRandomness,
      fulfilledRandomnessRequestIds,
      baseMissions
    };
    this.canonicalActiveMissionCache.set(cacheKey, next);
    return this.activeFleetMissionsAsOf(baseMissions, asOfSeconds, includeOverduePendingRandomness, fulfilledRandomnessRequestIds);
  }

  private activeFleetMissionsFromCanonicalRowsForOwner(
    wallet: `0x${string}`,
    options: { includeOverduePendingRandomness?: boolean } = {}
  ): FleetMissionSummary[] {
    const walletLower = wallet.toLowerCase();
    return this.activeFleetMissionsFromCanonicalRowsWhere(
      `owner:${walletLower}`,
      "owner = ?",
      [walletLower],
      options
    );
  }

  private activeFleetMissionsFromCanonicalRowsForTarget(
    planetId: string,
    options: { includeOverduePendingRandomness?: boolean } = {}
  ): FleetMissionSummary[] {
    return this.activeFleetMissionsFromCanonicalRowsWhere(
      `target:${planetId}`,
      "target_planet_id = ?",
      [planetId],
      options
    );
  }

  private activeFleetMissionsFromCanonicalRowsForPlanetTouching(
    planetId: string,
    options: { includeOverduePendingRandomness?: boolean } = {}
  ): FleetMissionSummary[] {
    return this.activeFleetMissionsFromCanonicalRowsWhere(
      `touching:${planetId}`,
      "(origin_planet_id = ? OR target_planet_id = ?)",
      [planetId, planetId],
      options
    );
  }

  private activeFleetMissionsForWalletVisibility(wallet: `0x${string}`, ownedPlanetIds: readonly string[]): FleetMissionSummary[] {
    const walletLower = wallet.toLowerCase();
    const uniqueTargetIds = [...new Set(ownedPlanetIds.filter((planetId) => planetId.length > 0))]
      .sort((left, right) => Number(left) - Number(right));
    const ownedOrOutgoing = uniqueTargetIds.length === 0
      ? this.activeFleetMissionsFromCanonicalRowsForOwner(wallet)
      : this.activeFleetMissionsFromCanonicalRowsWhere(
        `visibility:${walletLower}:${uniqueTargetIds.join(",")}`,
        `(owner = ? OR target_planet_id IN (${uniqueTargetIds.map(() => "?").join(",")}))`,
        [walletLower, ...uniqueTargetIds]
      );
    const activeJoinableAttacks = this.activeOutboundAttackFleetMissionsFromCanonicalRows();
    const byMissionId = new Map<string, FleetMissionSummary>();
    for (const mission of ownedOrOutgoing) byMissionId.set(mission.missionId, mission);
    for (const mission of activeJoinableAttacks) byMissionId.set(mission.missionId, mission);
    return [...byMissionId.values()].sort(compareFleetMissionsActiveSoonestFirst);
  }

  private activeOutboundAttackFleetMissionsFromCanonicalRows(): FleetMissionSummary[] {
    return this.activeFleetMissionsFromCanonicalRowsWhere(
      "outbound-attacks",
      "status_id = ? AND mission_type_id = ?",
      [1, 3]
    );
  }

  private activeFleetMissionsFromCanonicalRowsWhere(
    cacheKeyPrefix: string,
    whereSql: string,
    params: readonly SQLQueryBindings[],
    options: { includeOverduePendingRandomness?: boolean } = {}
  ): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    const stateVersion = this.indexedStateCacheVersion();
    const asOfSeconds = nowSeconds();
    const includeOverduePendingRandomness = options.includeOverduePendingRandomness === true;
    const cacheKey = `${cacheKeyPrefix}:${includeOverduePendingRandomness ? "with-overdue-pending-randomness" : "visible"}`;
    const cached = this.canonicalActiveMissionCache.get(cacheKey);
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.stateVersion === stateVersion
      && cached.includeOverduePendingRandomness === includeOverduePendingRandomness
    ) {
      return this.activeFleetMissionsAsOf(cached.baseMissions, asOfSeconds, includeOverduePendingRandomness, cached.fulfilledRandomnessRequestIds);
    }

    const rows = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE status_id IN (1, 2, 5)
        AND (${whereSql})
      ORDER BY CAST(arrival_at AS INTEGER) ASC
    `).all(...params) as ContractFleetMissionRow[];
    const baseMissions = rows.map((row) => this.withFleetMissionPlanetReferences(this.canonicalFleetMissionSummary(row), stateVersion));
    const needsGate = this.randomnessEngineConfigured && baseMissions.some(
      (mission) =>
        missionBattleRandomnessRequestId(mission) !== null
        && mission.status === "Outbound"
        && Number(mission.arrivalAt) <= asOfSeconds
    );
    const fulfilledRandomnessRequestIds = needsGate ? this.fulfilledRandomnessRequestIds() : null;
    const next = {
      missionGeneration: this.missionGeneration,
      stateVersion,
      includeOverduePendingRandomness,
      fulfilledRandomnessRequestIds,
      baseMissions
    };
    this.canonicalActiveMissionCache.set(cacheKey, next);
    return this.activeFleetMissionsAsOf(baseMissions, asOfSeconds, includeOverduePendingRandomness, fulfilledRandomnessRequestIds);
  }

  private activeFleetMissionsAsOf(
    baseMissions: readonly FleetMissionSummary[],
    asOfSeconds: number,
    includeOverduePendingRandomness: boolean,
    fulfilledRandomnessRequestIds: ReadonlySet<string> | null
  ): FleetMissionSummary[] {
    return baseMissions
      .map((mission) => {
        const status = (
          (mission.status === "Returning" || mission.status === "Recalled")
          && Number(mission.returnAt) <= asOfSeconds
        )
          ? "Returned"
          : mission.status;
        const resolvedMission = {
          ...mission,
          status,
          needsResolution: fleetMissionNeedsResolution({ ...mission, status }, asOfSeconds, fulfilledRandomnessRequestIds)
        };
        return withMissionAsOfNow(
          withFleetMissionResolutionBlocker(resolvedMission, asOfSeconds, fulfilledRandomnessRequestIds),
          asOfSeconds
        );
      })
      .filter(includeOverduePendingRandomness ? isActiveFleetMissionStatusForSummary : isVisibleActiveFleetMission)
      .sort(compareFleetMissionsActiveSoonestFirst);
  }

  completedFleetMissionsFromCanonicalRows(): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.canonicalCompletedMissionCache;
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.stateVersion === stateVersion
    ) {
      return cached.missions;
    }

    const rows = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE status_id IN (3, 4)
      ORDER BY CAST(return_at AS INTEGER) DESC, CAST(arrival_at AS INTEGER) DESC, CAST(mission_id AS INTEGER) DESC
    `).all() as ContractFleetMissionRow[];

    const missions = rows
      .map((row) => this.withFleetMissionPlanetReferences(this.canonicalFleetMissionSummary(row), stateVersion))
      .map((mission) => this.withDefenseHoldCombatOutcome(mission))
      .sort(compareFleetMissionsNewestFirst);
    this.canonicalCompletedMissionCache = {
      missionGeneration: this.missionGeneration,
      stateVersion,
      missions
    };
    return missions;
  }

  private completedFleetMissionsForWalletFromCanonicalRows(
    wallet: `0x${string}`,
    ownedPlanetIds: ReadonlySet<string>
  ): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    const stateVersion = this.indexedStateCacheVersion();
    const walletLower = wallet.toLowerCase();
    const asOfSeconds = nowSeconds();
    const targetIds = [...ownedPlanetIds].filter((planetId) => planetId.length > 0);
    const params: SQLQueryBindings[] = [asOfSeconds.toString(), walletLower, ...targetIds];
    const targetSql = targetIds.length > 0
      ? ` OR target_planet_id IN (${targetIds.map(() => "?").join(",")})`
      : "";
    const rows = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE (
          status_id IN (3, 4)
          OR (status_id IN (2, 5) AND CAST(return_at AS INTEGER) <= CAST(? AS INTEGER))
        )
        AND (owner = ?${targetSql})
      ORDER BY CAST(return_at AS INTEGER) DESC, CAST(arrival_at AS INTEGER) DESC, CAST(mission_id AS INTEGER) DESC
    `).all(...params) as ContractFleetMissionRow[];

    return rows
      .map((row) => this.withFleetMissionPlanetReferences(this.canonicalFleetMissionSummary(row), stateVersion))
      .map((mission) => (
        (mission.status === "Returning" || mission.status === "Recalled")
          && Number(mission.returnAt) <= asOfSeconds
      )
        ? { ...mission, status: "Returned" }
        : mission)
      .map((mission) => this.withDefenseHoldCombatOutcome(mission))
      .sort(compareFleetMissionsNewestFirst);
  }

  private decodedMissionLogs(): {
    eventMissions: FleetMissionSummary[];
    fulfilledRandomnessRequestIds: ReadonlySet<string>;
    battleReports: BattleReport[];
  } {
    this.currentMissionReadModelDbVersion();
    const cached = this.decodedMissionLogCache;
    if (cached && cached.missionGeneration === this.missionGeneration) {
      return cached;
    }

    const fleetRows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'fleet'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];
    const randomnessRows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'randomness'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];
    const battleRows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];

    const fulfilledRandomnessRequestIds = new Set<string>();
    for (const log of sortedEventRows(randomnessRows)) {
      fulfilledRandomnessRequestIds.add(decodeRandomnessFulfilledRequestId(log));
    }

    const next = {
      missionGeneration: this.missionGeneration,
      eventMissions: decodeCompleteFleetMissionLogs(sortedEventRows(fleetRows)),
      fulfilledRandomnessRequestIds,
      battleReports: decodeBattleReports(sortedEventRows(battleRows))
    };
    this.decodedMissionLogCache = next;
    return next;
  }

  private decodedBattleReportsOnly(): BattleReport[] {
    this.currentMissionReadModelDbVersion();
    this.currentBattleReportReadModelDbVersion();
    const cached = this.decodedBattleReportCache;
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.battleReportGeneration === this.battleReportGeneration
    ) {
      return cached.battleReports;
    }

    const battleRows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];
    const battleReports = decodeBattleReports(sortedEventRows(battleRows));
    this.decodedBattleReportCache = {
      missionGeneration: this.missionGeneration,
      battleReportGeneration: this.battleReportGeneration,
      battleReports
    };
    return battleReports;
  }

  private mergeCanonicalFleetMissions(eventMissions: FleetMissionSummary[]): FleetMissionSummary[] {
    const baselineBlock = safeBigInt(this.metadata("lastReconciledBlock"), 0n);
    const hasCanonicalFleetMissionBaseline = this.metadata("lastFleetMissionsReconciledAt") !== null;
    const eventById = new Map(eventMissions.map((mission) => [mission.missionId, mission]));
    const byId = new Map<string, FleetMissionSummary>();
    for (const mission of eventMissions) {
      const isStaleActiveMission =
        hasCanonicalFleetMissionBaseline
        &&
        isActiveFleetMissionStatus(mission.status)
        && safeBigInt(mission.blockNumber, 0n) <= baselineBlock;
      if (!isStaleActiveMission) {
        byId.set(mission.missionId, mission);
      }
    }
    const canonicalRows = this.db.query(`
      SELECT *
      FROM contract_fleet_missions
      WHERE status_id != 0
      ORDER BY CAST(mission_id AS INTEGER) ASC
    `).all() as ContractFleetMissionRow[];

    for (const row of canonicalRows) {
      const eventMission = eventById.get(row.mission_id);
      const canonicalStatus = fleetMissionStatusLabel(row.status_id);
      if (
        eventMission
        && safeBigInt(eventMission.blockNumber, 0n) > baselineBlock
        && isActiveFleetMissionStatus(canonicalStatus)
      ) {
        byId.set(row.mission_id, eventMission);
        continue;
      }
      byId.set(row.mission_id, this.canonicalFleetMissionSummary(row, eventMission));
    }

    return [...byId.values()];
  }

  private canonicalFleetMissionSummary(row: ContractFleetMissionRow, eventMission?: FleetMissionSummary): FleetMissionSummary {
    const cargo = {
      metal: row.metal_cargo,
      crystal: row.crystal_cargo,
      deuterium: row.deuterium_cargo
    };
    const canonicalEventMission = parseCanonicalFleetMissionEvent(row.event_json);
    const base = eventMission ?? {
      missionId: row.mission_id,
      recallCost: null,
      attackGroupId: null,
      joinedAttackMissionIds: [],
      defendsMissionId: null,
      counterplayDefenderMissionIds: [],
      returnCargo: null,
      ships: parseJson<Record<string, string>>(row.ships_json, {}),
      transactionHash: "0x",
      blockNumber: this.metadata("lastReconciledBlock") ?? "0",
      launchBlockNumber: this.metadata("lastReconciledBlock") ?? "0",
      needsResolution: false
    };
    const mergedBase = canonicalEventMission
      ? {
        ...base,
        recallCost: canonicalEventMission.recallCost ?? base.recallCost,
        attackGroupId: canonicalEventMission.attackGroupId,
        joinedAttackMissionIds: canonicalEventMission.joinedAttackMissionIds,
        defendsMissionId: canonicalEventMission.defendsMissionId,
        counterplayDefenderMissionIds: canonicalEventMission.counterplayDefenderMissionIds,
        returnCargo: canonicalEventMission.returnCargo,
        ships: canonicalEventMission.ships,
        transactionHash: canonicalEventMission.transactionHash,
        blockNumber: canonicalEventMission.blockNumber,
        launchBlockNumber: canonicalEventMission.launchBlockNumber,
        needsResolution: canonicalEventMission.needsResolution,
        ...(canonicalEventMission.originIsMoon !== undefined ? { originIsMoon: canonicalEventMission.originIsMoon } : {}),
        ...(canonicalEventMission.targetIsMoon !== undefined ? { targetIsMoon: canonicalEventMission.targetIsMoon } : {}),
        ...(canonicalEventMission.defenseHoldUntil ? { defenseHoldUntil: canonicalEventMission.defenseHoldUntil } : {}),
        ...(canonicalEventMission.defenseHoldOutcome ? { defenseHoldOutcome: canonicalEventMission.defenseHoldOutcome } : {}),
        ...(canonicalEventMission.randomnessRequestId ? { randomnessRequestId: canonicalEventMission.randomnessRequestId } : {})
      }
      : base;
    const fuelCost = eventDerivedFuelCost(row, canonicalEventMission ?? eventMission);
    return {
      ...mergedBase,
      missionId: row.mission_id,
      status: fleetMissionStatusLabel(row.status_id),
      missionType: fleetMissionTypeLabel(row.mission_type_id),
      owner: row.owner as `0x${string}`,
      originPlanetId: row.origin_planet_id,
      targetPlanetId: row.target_planet_id,
      arrivalAt: row.arrival_at,
      returnAt: row.return_at,
      fuelCost,
      cargo,
      recallCost: row.status_id === 1 && mergedBase.recallCost === null ? projectedFleetRecallCost(fuelCost) : mergedBase.recallCost,
      ...(row.randomness_request_id ? { randomnessRequestId: row.randomness_request_id } : {})
    };
  }

  // VEY-KANEO-479: request ids the RandomnessEngine has fulfilled, read from the ingested
  // RandomnessFulfilled logs.
  private fulfilledRandomnessRequestIds(): ReadonlySet<string> {
    this.currentMissionReadModelDbVersion();
    const cached = this.fulfilledRandomnessRequestIdsCache;
    if (cached && cached.missionGeneration === this.missionGeneration) {
      return cached.requestIds;
    }

    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'randomness'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];
    const requestIds = new Set<string>();
    for (const log of sortedEventRows(rows)) {
      requestIds.add(decodeRandomnessFulfilledRequestId(log));
    }
    this.fulfilledRandomnessRequestIdsCache = {
      missionGeneration: this.missionGeneration,
      requestIds
    };
    return requestIds;
  }

  // VEY-KANEO-489: replay every Attack `attacker` has launched, grouped by target planet, as ascending
  // launch timestamps. The contract anchors each per-(attacker, defender, planet) bashing window at
  // block.timestamp of the launch (VeydriftGameStorage._recordAttack runs in the FleetMissionLaunched
  // transaction), so the server can derive the live window count from these and apply the same
  // MAX_ATTACKS_PER_BASHING_WINDOW / 24h reset the contract enforces — letting the indexed
  // attack-protection preview report bashing_limit instead of silently allowing a blocked attack.
  // We key only by (attacker, planet), dropping the contract's defender dimension: planet ids are
  // minted monotonically (nextPlanetId++) and never reassigned to a different non-zero owner (attacks
  // loot but never capture; abandonment cannot re-mint an id), so a given planet id maps to exactly one
  // defender over its lifetime — making (attacker, planet) equivalent to (attacker, defender, planet).
  // Launches whose block lacks an ingested timestamp are skipped (they cannot be placed in the 24h
  // window), which biases toward not-blocking rather than fabricating a window position.
  attackLaunchSecondsByTarget(attacker: `0x${string}`): Map<string, number[]> {
    this.currentMissionReadModelDbVersion();
    const normalizedAttacker = attacker.toLowerCase();
    const cached = this.attackLaunchSecondsCache.get(normalizedAttacker);
    if (cached && cached.missionGeneration === this.missionGeneration) {
      return cached.launchesByTarget;
    }

    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'fleet'
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all() as EventRow[];
    const byTarget = new Map<string, number[]>();
    for (const log of sortedEventRows(rows)) {
      const launch = decodeAttackMissionLaunch(log);
      if (!launch || launch.attacker.toLowerCase() !== normalizedAttacker) continue;
      const launchedAt = blockTimestampSeconds(log);
      if (launchedAt === undefined) continue;
      const seconds = Number(launchedAt);
      if (!Number.isFinite(seconds)) continue;
      const existing = byTarget.get(launch.targetPlanetId);
      if (existing) existing.push(seconds);
      else byTarget.set(launch.targetPlanetId, [seconds]);
    }
    this.attackLaunchSecondsCache.set(normalizedAttacker, {
      missionGeneration: this.missionGeneration,
      launchesByTarget: byTarget
    });
    return byTarget;
  }

  private indexedBattleReports(): BattleReport[] {
    const summaries = this.indexedFleetMissionSummaries();
    this.currentBattleReportReadModelDbVersion();
    const cached = this.missionReadModelCache;
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.battleReportGeneration === this.battleReportGeneration
      && cached.summaries === summaries
      && cached.battleReports
    ) {
      return cached.battleReports;
    }

    // Enrich each report with ACS participants, but keep the broad list cheap: reconstructing historical
    // defender snapshots for every archived report requires broad unit-log scans and makes public reads
    // contend with ingestion. Targeted mission/detail reads attach snapshots through
    // indexedBattleReportsForMissions().
    const reportsWithParticipants = attachAttackGroupParticipants(this.decodedBattleReportsOnly(), summaries);
    const reports = reportsWithParticipants.map((report) => ({
      ...report,
      defenderSnapshot: null
    }));
    if (cached && cached.missionGeneration === this.missionGeneration && cached.summaries === summaries) {
      cached.battleReportGeneration = this.battleReportGeneration;
      cached.battleReports = reports;
    }
    return reports;
  }

  private recentBattleReports(limit: number): BattleReport[] {
    this.currentBattleReportReadModelDbVersion();
    this.currentMissionReadModelDbVersion();
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
    const cached = this.recentBattleReportsCache.get(boundedLimit);
    if (
      cached
      && cached.battleReportGeneration === this.battleReportGeneration
      && cached.missionGeneration === this.missionGeneration
    ) {
      return cached.reports;
    }

    const rows = this.db.query(`
      SELECT json_extract(event_json, '$.topics[1]') AS mission_topic,
        MAX(CAST(block_number AS INTEGER)) AS latest_block
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
        AND json_extract(event_json, '$.topics[1]') IS NOT NULL
      GROUP BY mission_topic
      ORDER BY latest_block DESC
      LIMIT ?
    `).all(boundedLimit) as Array<{ mission_topic: string | null }>;
    const missionIds = rows
      .map((row) => missionIdFromTopic(row.mission_topic))
      .filter((missionId): missionId is string => missionId !== null);
    const reports = this.attachBattleReportParticipantsWithoutSnapshots(this.battleReportsForMissionIds(missionIds, { includeRawFallback: false }))
      .sort(compareBattleReportsNewestFirst)
      .slice(0, boundedLimit);
    this.recentBattleReportsCache.set(boundedLimit, {
      battleReportGeneration: this.battleReportGeneration,
      missionGeneration: this.missionGeneration,
      reports
    });
    return reports;
  }

  private indexedBattleReportsForMissions(
    missions: readonly FleetMissionSummary[],
    options: { includeRawFallback?: boolean } = { includeRawFallback: false }
  ): BattleReport[] {
    if (missions.length === 0) return [];

    const missionIds = new Set<string>();
    for (const mission of missions) {
      missionIds.add(mission.missionId);
      if (mission.attackGroupId) missionIds.add(mission.attackGroupId);
      for (const joinedMissionId of mission.joinedAttackMissionIds ?? []) {
        missionIds.add(joinedMissionId);
      }
    }

    const matchingReportsById = new Map<string, BattleReport>();
    for (const report of this.battleReportsForMissionIds(missionIds, options)) {
      matchingReportsById.set(report.missionId, report);
      for (const participant of report.participants) {
        if (missionIds.has(participant.missionId)) {
          matchingReportsById.set(report.missionId, report);
        }
      }
    }
    const matchingReports = [...matchingReportsById.values()];
    if (matchingReports.length === 0) return [];

    const reportMissionIds = new Set<string>(missionIds);
    for (const report of matchingReports) {
      reportMissionIds.add(report.missionId);
      if (report.attackGroupId) reportMissionIds.add(report.attackGroupId);
      for (const participant of report.participants) {
        reportMissionIds.add(participant.missionId);
      }
    }
    const summaries = this.fleetMissionSummariesFromCanonicalRowsByIds(reportMissionIds);
    const reportsWithParticipants = attachAttackGroupParticipants(matchingReports, summaries);
    if (options.includeRawFallback !== true) {
      return reportsWithParticipants.map((report) => ({
        ...report,
        defenderSnapshot: report.defenderSnapshot ?? null
      }));
    }

    const reportsNeedingSnapshots = reportsWithParticipants.filter((report) => report.defenderSnapshot === null);
    const defenderSnapshots = this.battleTimeDefenderSnapshots(reportsNeedingSnapshots);
    return reportsWithParticipants.map((report) => ({
      ...report,
      defenderSnapshot: report.defenderSnapshot ?? defenderSnapshots.get(report.missionId) ?? null
    }));
  }

  private materializedBattleReportFromLogs(missionId: string): BattleReport | null {
    const rawReports = this.rawBattleReportsForMissionIds([missionId]);
    const report = rawReports.find((candidate) => candidate.missionId === missionId) ?? null;
    if (!report) return null;

    const reportMissionIds = new Set<string>([missionId, report.missionId]);
    if (report.attackGroupId) reportMissionIds.add(report.attackGroupId);
    for (const participant of report.participants) {
      reportMissionIds.add(participant.missionId);
    }
    const seedSummaries = this.fleetMissionSummariesFromCanonicalRowsByIds(reportMissionIds);
    for (const summary of seedSummaries) {
      if (summary.attackGroupId) reportMissionIds.add(summary.attackGroupId);
      for (const joinedMissionId of summary.joinedAttackMissionIds ?? []) {
        reportMissionIds.add(joinedMissionId);
      }
    }
    const summaries = this.fleetMissionSummariesFromCanonicalRowsByIds(reportMissionIds);
    const withParticipants = attachAttackGroupParticipants([report], summaries);
    const defenderSnapshots = this.battleTimeDefenderSnapshots(withParticipants);
    const materialized = {
      ...withParticipants[0]!,
      defenderSnapshot: defenderSnapshots.get(report.missionId) ?? null
    };
    const attack = summaries.find((summary) => summary.missionId === report.missionId)
      ?? this.eventDerivedFleetMissionForMissionId(report.missionId);
    return {
      ...materialized,
      stationedDefenders: this.stationedDefendersForBattle(attack, materialized)
    };
  }

  private attachBattleReportParticipantsWithoutSnapshots(reports: readonly BattleReport[]): BattleReport[] {
    if (reports.length === 0) return [];
    const missionIds = new Set<string>();
    for (const report of reports) {
      missionIds.add(report.missionId);
      if (report.attackGroupId) missionIds.add(report.attackGroupId);
      for (const participant of report.participants) {
        missionIds.add(participant.missionId);
      }
    }
    const summaries = this.fleetMissionSummariesFromCanonicalRowsByIds(missionIds);
    return attachAttackGroupParticipants([...reports], summaries).map((report) => ({
      ...report,
      defenderSnapshot: null
    }));
  }

  private fleetMissionSummariesFromCanonicalRowsByIds(missionIds: Iterable<string>): FleetMissionSummary[] {
    this.currentMissionReadModelDbVersion();
    const uniqueMissionIds = [...new Set([...missionIds].filter((missionId) => missionId.length > 0))].sort((left, right) => Number(left) - Number(right));
    if (uniqueMissionIds.length === 0) return [];

    const stateVersion = this.indexedStateCacheVersion();
    const summaries: FleetMissionSummary[] = [];
    for (let offset = 0; offset < uniqueMissionIds.length; offset += 250) {
      const chunk = uniqueMissionIds.slice(offset, offset + 250);
      const rows = this.db.query(`
        SELECT *
        FROM contract_fleet_missions
        WHERE mission_id IN (${chunk.map(() => "?").join(",")})
        ORDER BY CAST(mission_id AS INTEGER) ASC
      `).all(...chunk) as ContractFleetMissionRow[];
      for (const row of rows) {
        summaries.push(this.withFleetMissionPlanetReferences(this.canonicalFleetMissionSummary(row), stateVersion));
      }
    }
    return summaries;
  }

  private fleetMissionSummaryAsOfNow(mission: FleetMissionSummary): FleetMissionSummary {
    const asOfSeconds = nowSeconds();
    const withPlanetReferences = this.withFleetMissionPlanetReferences(mission);
    const status = (
      (withPlanetReferences.status === "Returning" || withPlanetReferences.status === "Recalled")
      && Number(withPlanetReferences.returnAt) <= asOfSeconds
    )
      ? "Returned"
      : withPlanetReferences.status;
    const needsGate = this.randomnessEngineConfigured
      && missionBattleRandomnessRequestId(withPlanetReferences) !== null
      && status === "Outbound"
      && Number(withPlanetReferences.arrivalAt) <= asOfSeconds;
    const fulfilledRandomnessRequestIds = needsGate ? this.fulfilledRandomnessRequestIds() : null;
    const resolvedMission = {
      ...withPlanetReferences,
      status,
      needsResolution: fleetMissionNeedsResolution(
        { ...withPlanetReferences, status },
        asOfSeconds,
        fulfilledRandomnessRequestIds
      )
    };
    return withMissionAsOfNow(
      withFleetMissionResolutionBlocker(resolvedMission, asOfSeconds, fulfilledRandomnessRequestIds),
      asOfSeconds
    );
  }

  private battleReportsForMissionIds(
    missionIds: Iterable<string>,
    options: { includeRawFallback?: boolean } = { includeRawFallback: false }
  ): BattleReport[] {
    this.currentMissionReadModelDbVersion();
    this.currentBattleReportReadModelDbVersion();
    const uniqueMissionIds = [...new Set([...missionIds].filter((missionId) => missionId.length > 0))].sort((left, right) => Number(left) - Number(right));
    if (uniqueMissionIds.length === 0) return [];

    const reportsByMissionId = new Map<string, BattleReport>();
    const missingMissionIds: string[] = [];
    for (const missionId of uniqueMissionIds) {
      const row = this.db.query(`
        SELECT report_json
        FROM indexed_battle_report_read_models
        WHERE mission_id = ? AND status = 'ready' AND report_json IS NOT NULL
      `).get(missionId) as Pick<BattleReportReadModelRow, "report_json"> | null;
      if (!row?.report_json) {
        missingMissionIds.push(missionId);
        continue;
      }
      try {
        reportsByMissionId.set(missionId, parseEvent<BattleReport>(row.report_json));
      } catch {
        missingMissionIds.push(missionId);
      }
    }

    if (options.includeRawFallback === true) {
      for (const report of this.rawBattleReportsForMissionIds(missingMissionIds)) {
        reportsByMissionId.set(report.missionId, report);
      }
    }

    return [...reportsByMissionId.values()].sort((left, right) => {
      const leftBlock = BigInt(left.blockNumber);
      const rightBlock = BigInt(right.blockNumber);
      if (leftBlock === rightBlock) return 0;
      return leftBlock < rightBlock ? 1 : -1;
    });
  }

  private rawBattleReportsForMissionIds(missionIds: Iterable<string>): BattleReport[] {
    const uniqueMissionIds = [...new Set([...missionIds].filter((missionId) => missionId.length > 0))].sort((left, right) => Number(left) - Number(right));
    if (uniqueMissionIds.length === 0) return [];

    const missionTopics = uniqueMissionIds.map(fleetMissionIdTopic);
    const battleRows = this.db.query(`
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'battle'
        AND json_extract(event_json, '$.topics[1]') IN (${missionTopics.map(() => "?").join(",")})
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all(...missionTopics) as EventRow[];
    const logs = sortedEventRows(battleRows);
    return uniqueMissionIds
      .map((missionId) => decodeBattleReportLogs(logs, missionId))
      .filter((report): report is BattleReport => report !== null)
      .sort((left, right) => {
        const leftBlock = BigInt(left.blockNumber);
        const rightBlock = BigInt(right.blockNumber);
        if (leftBlock === rightBlock) return 0;
        return leftBlock < rightBlock ? 1 : -1;
      });
  }

  private battleReportsByMissionId(): Map<string, BattleReport[]> {
    this.currentBattleReportReadModelDbVersion();
    const cached = this.battleReportsByMissionIdCache;
    if (
      cached
      && cached.missionGeneration === this.missionGeneration
      && cached.battleReportGeneration === this.battleReportGeneration
    ) {
      return cached.reportsByMissionId;
    }

    const reportsByMissionId = new Map<string, BattleReport[]>();
    const add = (missionId: string | null | undefined, report: BattleReport) => {
      if (!missionId) return;
      const reports = reportsByMissionId.get(missionId);
      if (reports) reports.push(report);
      else reportsByMissionId.set(missionId, [report]);
    };
    for (const report of this.decodedBattleReportsOnly()) {
      add(report.missionId, report);
      add(report.attackGroupId, report);
      for (const participant of report.participants) {
        add(participant.missionId, report);
      }
    }
    this.battleReportsByMissionIdCache = {
      missionGeneration: this.missionGeneration,
      battleReportGeneration: this.battleReportGeneration,
      reportsByMissionId
    };
    return reportsByMissionId;
  }

  private battleTimeDefenderSnapshots(reports: BattleReport[]): Map<string, BattleReportDefenderSnapshot> {
    if (reports.length === 0) return new Map();

    const reportsByPosition = [...reports].sort(compareRpcLogPosition);
    const maxBlockNumber = maxReportBlockNumber(reportsByPosition).toString();
    const targetPlanetTopics = [...new Set(
      reportsByPosition
        .map((report) => report.targetPlanetId)
        .filter((planetId): planetId is string => Boolean(planetId))
        .map(fleetMissionIdTopic)
    )];
    if (targetPlanetTopics.length === 0) return new Map();

    const rows: EventRow[] = [];
    for (let offset = 0; offset < targetPlanetTopics.length; offset += 250) {
      const chunk = targetPlanetTopics.slice(offset, offset + 250);
      rows.push(...this.db.query(`
        SELECT event_json
        FROM indexed_unit_count_event_logs
        WHERE json_extract(event_json, '$.topics[1]') IN (${chunk.map(() => "?").join(",")})
          AND CAST(block_number AS INTEGER) <= ?
        ORDER BY CAST(block_number AS INTEGER) ASC, CAST(log_index AS INTEGER) ASC
      `).all(...chunk, maxBlockNumber) as EventRow[]);
    }
    const logs = sortedEventRows(rows);
    const snapshots = new Map<string, BattleReportDefenderSnapshot>();
    const currentByPlanet = new Map<string, UnitCountSnapshot>();
    let logIndex = 0;

    for (const report of reportsByPosition) {
      while (logIndex < logs.length) {
        const log = logs[logIndex]!;
        if (compareRpcLogPosition(log, report) >= 0 || sameRpcTransaction(log, report)) break;
        this.applyUnitCountSnapshotLog(currentByPlanet, log);
        logIndex += 1;
      }

      const snapshot = currentByPlanet.get(report.targetPlanetId);
      const materialized = materializeBattleReportDefenderSnapshot(snapshot);
      if (materialized) snapshots.set(report.missionId, materialized);
    }

    return snapshots;
  }

  private applyUnitCountSnapshotLog(snapshots: Map<string, UnitCountSnapshot>, log: IndexedRpcLog): void {
    if (isShipCountChangedLog(log)) {
      const event = decodeShipCountChangedLog(log);
      const snapshot = unitCountSnapshotForPlanet(snapshots, event.planetId);
      if (event.total > 0) snapshot.fleet.set(event.shipId, event.total);
      else snapshot.fleet.delete(event.shipId);
      return;
    }
    if (isDefenseCountChangedLog(log)) {
      const event = decodeDefenseCountChangedLog(log);
      const snapshot = unitCountSnapshotForPlanet(snapshots, event.planetId);
      if (event.total > 0) snapshot.defenses.set(event.defenseId, event.total);
      else snapshot.defenses.delete(event.defenseId);
      return;
    }
    if (!isIndexedQueueCompletedLog(log)) return;
    const event = decodeIndexedQueueCompletedLog(log);
    if (event.total === undefined || !event.planetId) return;
    const snapshot = unitCountSnapshotForPlanet(snapshots, event.planetId);
    if (event.eventName === "ShipCompleted") {
      if (event.total > 0) snapshot.fleet.set(event.itemId, event.total);
      else snapshot.fleet.delete(event.itemId);
    } else if (event.eventName === "DefenseCompleted") {
      if (event.total > 0) snapshot.defenses.set(event.itemId, event.total);
      else snapshot.defenses.delete(event.itemId);
    }
  }

  // VEY-KANEO-456: resolve an incoming attack's stationed allied defenders into the per-defender detail
  // the Stationed defenses panel renders — defender identity, full ship composition, hold-until, and the
  // defended planet's Alliance Depot level (which funds the deuterium upkeep). Applies the lazy
  // reconciliation the ticket requires: a defender is only stationed while its AcsDefend mission is still
  // Outbound and its hold (arrivalAt) has not elapsed as-of-now, so expired/withdrawn holds drop out on
  // read without waiting for a settlement event. Sorted soonest-expiring first.
  private stationedDefendersForAttack(
    attack: FleetMissionSummary,
    summariesById: Map<string, FleetMissionSummary>,
    nowSeconds: number
  ): StationedDefenderSummary[] {
    const allianceDepotLevel = attack.targetPlanet?.allianceDepotLevel ?? 0;
    return (attack.counterplayDefenderMissionIds ?? [])
      .map((missionId) => summariesById.get(missionId))
      .filter((defender): defender is FleetMissionSummary =>
        defender !== undefined
          && defender.missionType === "AcsDefend"
          && defender.status === "Outbound"
          && Number(defender.arrivalAt) > nowSeconds)
      .map((defender) => ({
        missionId: defender.missionId,
        defender: defender.owner,
        defenderDisplayName: this.playerProfile(defender.owner).displayName,
        ships: defender.ships,
        holdUntil: defender.arrivalAt,
        allianceDepotLevel
      }))
      .sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  private stationedDefenderSummary(
    defender: FleetMissionSummary,
    holdUntil: string,
    composition?: { destroyedShips: Record<string, string> | null; survivingShips: Record<string, string> | null }
  ): StationedDefenderSummary {
    const targetPlanet = defender.targetPlanet ?? this.fleetMissionPlanetReference(defender.targetPlanetId);
    const lifecycleOutcome = defender.defenseHoldOutcome
      ?? (defender.status === "Recalled" || (defender.status === "Returned" && defender.recallCost !== null) ? "Recalled" : undefined)
      ?? (defender.status === "Outbound" ? "Active" : "Expired");
    return {
      missionId: defender.missionId,
      defender: defender.owner,
      defenderDisplayName: this.playerProfile(defender.owner).displayName,
      ships: defender.ships,
      destroyedShips: composition?.destroyedShips ?? (lifecycleOutcome === "Active" ? {} : null),
      survivingShips: composition?.survivingShips ?? (lifecycleOutcome === "Active" ? positiveShipCounts(defender.ships) : null),
      lifecycleOutcome,
      holdUntil,
      allianceDepotLevel: targetPlanet?.allianceDepotLevel ?? 0
    };
  }

  private stationedDefenderBattleCompositions(
    defenders: readonly FleetMissionSummary[],
    report: BattleReport | null | undefined
  ): Map<string, { destroyedShips: Record<string, string> | null; survivingShips: Record<string, string> | null }> {
    const unknown = () => new Map(defenders.map((defender) => [
      defender.missionId,
      { destroyedShips: null, survivingShips: null }
    ]));
    if (!report?.defenderSnapshot) return unknown();

    const candidates: BattleLossCandidate[] = [];
    for (const unit of report.defenderSnapshot.fleet) {
      const cost = shipCostForLegacyLoss(unit.id);
      if (cost && unit.count > 0) candidates.push({ kind: "ship", planetId: "planet", itemId: unit.id, max: unit.count, cost });
    }
    for (const defender of defenders) {
      for (const [key, value] of Object.entries(defender.ships)) {
        const itemId = shipKeyToId(key);
        const max = Number(value);
        const cost = itemId === null ? null : shipCostForLegacyLoss(itemId);
        if (itemId !== null && cost && Number.isSafeInteger(max) && max > 0) {
          candidates.push({ kind: "ship", planetId: `mission:${defender.missionId}`, itemId, max, cost });
        }
      }
    }

    const totalLossValue = candidates.reduce((total, candidate) => ({
      metal: total.metal + BigInt(candidate.cost.metal) * BigInt(candidate.max),
      crystal: total.crystal + BigInt(candidate.cost.crystal) * BigInt(candidate.max),
      deuterium: total.deuterium + BigInt(candidate.cost.deuterium) * BigInt(candidate.max)
    }), { metal: 0n, crystal: 0n, deuterium: 0n });
    const reportedLossValue = {
      metal: BigInt(report.defenderLosses.metal),
      crystal: BigInt(report.defenderLosses.crystal),
      deuterium: BigInt(report.defenderLosses.deuterium)
    };
    let solution: BattleLossPick[] | null;
    if (
      reportedLossValue.metal === totalLossValue.metal
      && reportedLossValue.crystal === totalLossValue.crystal
      && reportedLossValue.deuterium === totalLossValue.deuterium
    ) {
      solution = candidates.map((candidate) => ({ candidate, destroyed: candidate.max }));
    } else if (isZeroResources(report.defenderLosses)) {
      solution = [];
    } else {
      // Exact per-fleet counts are not emitted. For bounded battles, expose a composition only when
      // the aggregate on-chain loss value has one unique allocation; otherwise leave it unknown.
      const candidateUnits = candidates.reduce((sum, candidate) => sum + candidate.max, 0);
      solution = candidateUnits <= 500 ? uniqueLossSolution(candidates, report.defenderLosses) : null;
    }
    if (!solution) return unknown();

    const destroyedByMission = new Map<string, Record<string, string>>();
    for (const { candidate, destroyed } of solution) {
      if (!candidate.planetId.startsWith("mission:")) continue;
      const missionId = candidate.planetId.slice("mission:".length);
      const key = shipIdToKey(candidate.itemId);
      if (!key) continue;
      const destroyedShips = destroyedByMission.get(missionId) ?? {};
      destroyedShips[key] = destroyed.toString();
      destroyedByMission.set(missionId, destroyedShips);
    }
    return new Map(defenders.map((defender) => {
      const original = positiveShipCounts(defender.ships);
      const destroyedShips = destroyedByMission.get(defender.missionId) ?? {};
      const survivingShips = Object.fromEntries(Object.entries(original).flatMap(([key, value]) => {
        const count = BigInt(value) - BigInt(destroyedShips[key] ?? "0");
        return count > 0n ? [[key, count.toString()]] : [];
      }));
      return [defender.missionId, { destroyedShips, survivingShips }];
    }));
  }

  private isActiveDefenseHoldForPlanet(
    mission: FleetMissionSummary,
    planetId: string,
    asOfSeconds: number
  ): boolean {
    const holdUntil = Number(this.defenseHoldWindowEnd(mission));
    return mission.missionType === "DefenseHold"
      && mission.status === "Outbound"
      && mission.targetPlanetId === planetId
      && Number(mission.arrivalAt) <= asOfSeconds
      && Number.isFinite(holdUntil)
      && holdUntil > asOfSeconds
      && hasAnyShips(mission.ships);
  }

  private isBattleTimeCounterplay(
    defender: FleetMissionSummary,
    attack: FleetMissionSummary,
    attackArrival: number
  ): boolean {
    return ["AcsDefend", "Intercept", "DefenseHold"].includes(defender.missionType)
      && defender.targetPlanetId === attack.targetPlanetId
      && Number(defender.arrivalAt) <= attackArrival
      && Number(this.counterplayHoldUntil(defender)) >= attackArrival
      && hasAnyShips(defender.ships);
  }

  private isBattleTimeDefenseHoldForPlanet(
    defender: FleetMissionSummary,
    planetId: string,
    attackArrival: number
  ): boolean {
    return defender.missionType === "DefenseHold"
      && defender.targetPlanetId === planetId
      && Number(defender.arrivalAt) <= attackArrival
      && Number(this.defenseHoldWindowEnd(defender)) >= attackArrival
      && hasAnyShips(defender.ships);
  }

  private counterplayHoldUntil(defender: FleetMissionSummary): string {
    return defender.defenseHoldUntil ?? defender.arrivalAt;
  }

  private defenseHoldWindowEnd(defender: FleetMissionSummary): string {
    // New deployments emit DefenseHoldStationed with the exact hold expiry. Older live missions only
    // have FleetMissionLaunched, where returnAt is hold expiry plus flight-home time; use it as a
    // conservative public-intel fallback so legacy held defenders are not invisible.
    return defender.defenseHoldUntil ?? defender.returnAt;
  }

  // VEY-KANEO-471: build one fully-populated synthetic incoming attack (with two stationed defenders)
  // so QA can verify the Stationed defenses panel — defender identity, per-unit assets + counts, live
  // hold countdown, and Alliance Depot upkeep/sustain — without staging a real multi-wallet ACS Defend
  // scenario on-chain. Only ever reachable when the (non-production-gated) flag is set. Returns null if
  // the wallet owns no planet, so it never fabricates planet ownership. The synthetic mission ids are
  // prefixed `qa-synthetic-*` so they are visually unmistakable and cannot collide with on-chain ids.
  private syntheticStationedDefenseAttack(
    wallet: `0x${string}`,
    ownedPlanetIds: Set<string>,
    nowSeconds: number
  ): FleetMissionSummary | null {
    const targetPlanetId = [...ownedPlanetIds].sort((left, right) => Number(left) - Number(right))[0];
    if (targetPlanetId === undefined) return null;
    const targetPlanet = this.fleetMissionPlanetReference(targetPlanetId);
    const allianceDepotLevel = targetPlanet?.allianceDepotLevel ?? 5;
    const arrivalAt = String(nowSeconds + 3_600);

    const stationedDefenders: StationedDefenderSummary[] = [
      {
        missionId: "qa-synthetic-defender-1",
        defender: "0x00000000000000000000000000000000000DEF01",
        defenderDisplayName: "QA Ally Alpha",
        ships: { lightFighter: "12", cruiser: "3", battleship: "1" },
        holdUntil: String(nowSeconds + 6 * 3_600),
        allianceDepotLevel
      },
      {
        missionId: "qa-synthetic-defender-2",
        defender: "0x00000000000000000000000000000000000DEF02",
        defenderDisplayName: "QA Ally Beta",
        ships: { smallCargo: "20", heavyFighter: "8", destroyer: "2" },
        holdUntil: String(nowSeconds + 18 * 3_600),
        allianceDepotLevel
      }
    ];

    return withMissionAsOfNow(
      {
        missionId: "qa-synthetic-attack",
        status: "Outbound",
        missionType: "Attack",
        owner: "0x00000000000000000000000000000000000A77AC",
        originPlanetId: "0",
        targetPlanetId,
        originPlanet: null,
        targetPlanet,
        arrivalAt,
        returnAt: "0",
        fuelCost: "0",
        recallCost: null,
        attackGroupId: null,
        joinedAttackMissionIds: [],
        defendsMissionId: null,
        counterplayDefenderMissionIds: stationedDefenders.map((defender) => defender.missionId),
        stationedDefenders,
        cargo: zeroResources(),
        returnCargo: null,
        ships: { lightFighter: "40", cruiser: "6" },
        transactionHash: "0xqa-synthetic-stationed-defense",
        blockNumber: "0",
        launchBlockNumber: "0",
        needsResolution: false
      },
      nowSeconds
    );
  }

  private withFleetMissionPlanetReferences(mission: FleetMissionSummary, stateVersion = this.indexedStateCacheVersion()): FleetMissionSummary {
    return withMissionAsOfNow(
      {
        ...mission,
        originPlanet: this.fleetMissionPlanetReference(mission.originPlanetId, stateVersion),
        targetPlanet: this.fleetMissionPlanetReference(mission.targetPlanetId, stateVersion)
      },
      nowSeconds()
    );
  }

  private fleetMissionPlanetReference(planetId: string, stateVersion = this.indexedStateCacheVersion()): FleetMissionPlanetReference | null {
    if (!this.fleetMissionPlanetReferenceCache || this.fleetMissionPlanetReferenceCache.stateVersion !== stateVersion) {
      this.fleetMissionPlanetReferenceCache = {
        stateVersion,
        refs: new Map()
      };
    }
    if (this.fleetMissionPlanetReferenceCache.refs.has(planetId)) {
      return this.fleetMissionPlanetReferenceCache.refs.get(planetId) ?? null;
    }
    const ref = this.fleetMissionPlanetReferenceUncached(planetId);
    this.fleetMissionPlanetReferenceCache.refs.set(planetId, ref);
    return ref;
  }

  private fleetMissionPlanetReferenceUncached(planetId: string): FleetMissionPlanetReference | null {
    const planet = this.planet(planetId);
    if (!planet) return null;
    return {
      planetId: planet.planetId,
      owner: planet.owner,
      ownerDisplayName: this.playerProfile(planet.owner).displayName,
      name: planet.name,
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.position,
      coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
      hasMoon: this.hasMoon(planet.planetId),
      archetype: planetArchetypeForTemperature(planet.temperature),
      // VEY-KANEO-440: surface the Alliance Depot level (building id 13) so the ACS Defend compose UX
      // can preview how much holding fuel the defended planet's depot subsidizes.
      allianceDepotLevel: this.projectedBuildingLevel(planet.planetId, 13)
    };
  }

  private projectedBuildingLevel(planetId: string, buildingId: number): number {
    let level = this.indexedLevel("contract_building_levels", "building_id", planetId, buildingId);
    for (const queue of this.queueSettlement(`building:${planetId}`).completed) {
      if (queue.itemId === buildingId && typeof queue.targetLevel === "number") {
        level = Math.max(level, queue.targetLevel);
      }
    }
    return level;
  }

  private count(table:
    | "indexed_debris_fields"
    | "indexed_event_logs"
    | "indexed_mission_event_logs"
    | "indexed_unit_count_event_logs"
    | "indexed_moon_chance_reports"
    | "indexed_moons"
    | "indexed_planets"
    | "indexed_rift_balances"
  ): number {
    const row = this.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
    return row.count;
  }

  private metadata(key: string): string | null {
    const row = this.db.query("SELECT value FROM indexer_metadata WHERE key = ?").get(key) as MetadataRow | null;
    return row?.value ?? null;
  }

  private universeSystemFingerprint(galaxy: number, system: number, label: string, sql: string): string {
    const rows = this.db.query(sql).all(galaxy, system) as Array<{ value: string }>;
    return `${label}:${rows.map((row) => row.value).join("\u001f")}`;
  }

  private rows<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    return (this.db.query(sql).all(...params) as EventRow[]).map((row) => parseEvent<T>(row.event_json));
  }

  private currentSettledPlanetIndexCache(): SettledPlanetIndexCache | null {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.settledPlanetIndexCache;
    return cached && cached.stateVersion === stateVersion ? cached : null;
  }

  private settledPlanetIndex(): SettledPlanetIndexCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.settledPlanetIndexCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const planetRows = this.db.query(`
      SELECT planet_id, event_json
      FROM contract_planets
      ORDER BY CAST(planet_id AS INTEGER) ASC
    `).all() as Array<EventRow & { planet_id: string }>;
    const resourceRows = this.db.query(`
      SELECT planet_id, metal, crystal, deuterium, last_settled_at, transaction_hash, block_number, log_index
      FROM contract_planet_resources
    `).all() as Array<PlanetResourceRow & { planet_id: string }>;
    const resourcesByPlanet = new Map(resourceRows.map((row) => [row.planet_id, row]));
    const planets = planetRows.map((row) => this.withResourceSnapshotRow(
      parseEvent<SettledPlanetEvent>(row.event_json),
      resourcesByPlanet.get(row.planet_id) ?? null
    ));
    const byId = new Map<string, SettledPlanetEvent>();
    const byOwner = new Map<string, SettledPlanetEvent[]>();
    const bySystem = new Map<string, SettledPlanetEvent[]>();
    for (const planet of planets) {
      byId.set(planet.planetId, planet);
      const owner = planet.owner.toLowerCase();
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), planet]);
      const systemKey = systemCacheKey(planet.galaxy, planet.system);
      bySystem.set(systemKey, [...(bySystem.get(systemKey) ?? []), planet]);
    }
    const next = { stateVersion, planets, byId, byOwner, bySystem };
    this.settledPlanetIndexCache = next;
    return next;
  }

  private planetsFromRows(sql: string, ...params: SQLQueryBindings[]): SettledPlanetEvent[] {
    return this.rows<SettledPlanetEvent>(sql, ...params).map((planet) => this.withResourceSnapshot(planet));
  }

  private settledPlanetsForOwner(wallet: `0x${string}`): SettledPlanetEvent[] {
    const normalizedWallet = wallet.toLowerCase();
    const cachedIndex = this.currentSettledPlanetIndexCache();
    if (cachedIndex) return [...(cachedIndex.byOwner.get(normalizedWallet) ?? [])];

    const targeted = this.targetedSettledPlanetCacheForCurrentVersion();
    const cached = targeted.byOwner.get(normalizedWallet);
    if (cached) return [...cached];

    const planets = this.planetRowsWithResources(`
      SELECT
        planet.event_json,
        resources.metal,
        resources.crystal,
        resources.deuterium,
        resources.last_settled_at,
        resources.transaction_hash,
        resources.block_number,
        resources.log_index
      FROM contract_planets planet
      LEFT JOIN contract_planet_resources resources ON resources.planet_id = planet.planet_id
      WHERE planet.owner = lower(?)
      ORDER BY CAST(planet.planet_id AS INTEGER) ASC
    `, normalizedWallet);
    targeted.byOwner.set(normalizedWallet, planets);
    for (const planet of planets) targeted.byId.set(planet.planetId, planet);
    return [...planets];
  }

  private targetedSettledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    const key = systemCacheKey(galaxy, system);
    const targeted = this.targetedSettledPlanetCacheForCurrentVersion();
    const cached = targeted.bySystem.get(key);
    if (cached) return [...cached];

    const planets = this.planetRowsWithResources(`
      SELECT
        planet.event_json,
        resources.metal,
        resources.crystal,
        resources.deuterium,
        resources.last_settled_at,
        resources.transaction_hash,
        resources.block_number,
        resources.log_index
      FROM contract_planets planet
      LEFT JOIN contract_planet_resources resources ON resources.planet_id = planet.planet_id
      WHERE planet.galaxy = ? AND planet.system_number = ?
      ORDER BY planet.position ASC
    `, galaxy, system);
    targeted.bySystem.set(key, planets);
    for (const planet of planets) targeted.byId.set(planet.planetId, planet);
    return [...planets];
  }

  private targetedSettledPlanetById(planetId: string): SettledPlanetEvent | null {
    const targeted = this.targetedSettledPlanetCacheForCurrentVersion();
    if (targeted.byId.has(planetId)) return targeted.byId.get(planetId) ?? null;

    const [planet = null] = this.planetRowsWithResources(`
      SELECT
        planet.event_json,
        resources.metal,
        resources.crystal,
        resources.deuterium,
        resources.last_settled_at,
        resources.transaction_hash,
        resources.block_number,
        resources.log_index
      FROM contract_planets planet
      LEFT JOIN contract_planet_resources resources ON resources.planet_id = planet.planet_id
      WHERE planet.planet_id = ?
      LIMIT 1
    `, planetId);
    targeted.byId.set(planetId, planet);
    return planet;
  }

  private targetedSettledPlanetCacheForCurrentVersion(): TargetedSettledPlanetCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.targetedSettledPlanetCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const next: TargetedSettledPlanetCache = {
      stateVersion,
      byId: new Map(),
      byOwner: new Map(),
      bySystem: new Map()
    };
    this.targetedSettledPlanetCache = next;
    return next;
  }

  private indexedLevelsByIdCacheForCurrentVersion(): IndexedLevelsByIdCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.indexedLevelsByIdCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const next: IndexedLevelsByIdCache = {
      stateVersion,
      values: new Map()
    };
    this.indexedLevelsByIdCache = next;
    return next;
  }

  private queueStateCacheForCurrentVersion(): QueueStateCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.queueStateCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const next: QueueStateCache = {
      stateVersion,
      values: new Map()
    };
    this.queueStateCache = next;
    return next;
  }

  private technologyLevelsCacheForCurrentVersion(): TechnologyLevelsCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.technologyLevelsCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const next: TechnologyLevelsCache = {
      stateVersion,
      values: new Map()
    };
    this.technologyLevelsCache = next;
    return next;
  }

  private allianceIntelCacheForCurrentVersion(): AllianceIntelCache {
    const stateVersion = this.indexedStateCacheVersion();
    const cached = this.allianceIntelCache;
    if (cached && cached.stateVersion === stateVersion) return cached;

    const next: AllianceIntelCache = {
      stateVersion,
      values: new Map()
    };
    this.allianceIntelCache = next;
    return next;
  }

  private planetRowsWithResources(sql: string, ...params: SQLQueryBindings[]): SettledPlanetEvent[] {
    const rows = this.db.query(sql).all(...params) as PlanetEventResourceRow[];
    return rows.map((row) => this.withResourceSnapshotRow(
      parseEvent<SettledPlanetEvent>(row.event_json),
      row.metal === null || row.crystal === null || row.deuterium === null || row.last_settled_at === null
        || row.transaction_hash === null || row.block_number === null || row.log_index === null
        ? null
        : {
          metal: row.metal,
          crystal: row.crystal,
          deuterium: row.deuterium,
          last_settled_at: row.last_settled_at,
          transaction_hash: row.transaction_hash,
          block_number: row.block_number,
          log_index: row.log_index
        }
    ));
  }

  private blockingStaleReason({
    lastReconciledAt,
    lastReconciliationError,
    pendingReconciliationReason
  }: {
    lastReconciledAt: string | null;
    lastReconciliationError: string | null;
    pendingReconciliationReason: string | null;
  }): string | null {
    if (lastReconciliationError) {
      // A reconcile *error* must NOT take the service down once a full reconciliation has succeeded
      // at least once: the websocket-synced indexed read model is authoritative between events, so
      // serve the last good state and let the reconcile retry in the background. The error stays
      // visible via the `lastReconciliationError` snapshot field. The pending reason that this
      // failed reconcile was attempting to clear is moot for gating, so ignore it too — otherwise a
      // transient truncated/empty RPC body ("Unexpected end of JSON input") would flip serving off.
      // Only a cold start that has never reconciled is genuinely unserveable (VEY-KANEO-461 rework).
      if (!lastReconciledAt) return `reconciliation_failed: ${lastReconciliationError}`;
      return null;
    }
    if (pendingReconciliationReason && (!lastReconciledAt || !isNonBlockingPendingReason(pendingReconciliationReason))) {
      return pendingReconciliationReason;
    }
    if (!lastReconciledAt) return "never_reconciled";
    return null;
  }

  private allianceStaleReason({
    allianceReconciledAt,
    lastReconciliationError,
    reconciliationInProgress
  }: {
    allianceReconciledAt: string | null;
    lastReconciliationError: string | null;
    reconciliationInProgress: boolean;
  }): string | null {
    // Mirror blockingStaleReason: once an alliance reconciliation has succeeded, a later reconcile
    // error must not gate alliance serving — keep serving the indexed alliance state and retry in
    // the background (VEY-KANEO-461 rework).
    if (allianceReconciledAt) return null;
    if (lastReconciliationError) return `reconciliation_failed: ${lastReconciliationError}`;
    if (reconciliationInProgress) return "reconciliation_in_progress";
    return "alliance_never_reconciled";
  }
}

type CanonicalReconciliationState = {
  resources: Map<string, Resources>;
  planetQueues: Map<string, QueueState>;
  buildings: Map<string, InfrastructureState["buildings"]>;
  defenses: Map<string, DefenseState["defenses"]>;
  ships: Map<string, ShipyardState["ships"]>;
  research: Map<`0x${string}`, ResearchState["technologies"]>;
  researchQueues: Map<`0x${string}`, QueueState>;
  fleetMissions: Map<string, CanonicalFleetMissionSnapshot>;
  // Canonical moon building levels by moon home-planet id, and the planet's active moon-building queue.
  // Seeded from getMoonState (wallet -> home-planet moon). null entries are intentionally absent.
  moonBuildings: Map<string, MoonState["buildings"]>;
  moonQueues: Map<string, QueueState>;
  verifiedEmptyQueues: Set<string>;
};

type ContractFleetMissionRow = {
  mission_id: string;
  status_id: number;
  mission_type_id: number;
  owner: string;
  origin_planet_id: string;
  target_planet_id: string;
  departure_at: string;
  arrival_at: string;
  return_at: string;
  fuel_cost: string;
  metal_cargo: string;
  crystal_cargo: string;
  deuterium_cargo: string;
  ships_json: string;
  randomness_request_id: string | null;
  event_json: string | null;
};

type CanonicalFleetMissionPayload = {
  mission?: FleetMissionSummary;
};

function moonChanceReportKey(event: MoonChanceReportEvent): string {
  return event.outcomeId ? `outcome:${event.outcomeId}` : `battle:${event.battleId}:${event.targetPlanetId}`;
}

function queueKey(event: Pick<IndexedQueueStartedEvent | IndexedQueueCompletedEvent, "queueKind" | "planetId" | "owner">): string {
  if (event.queueKind === "research") {
    return `research:${event.owner?.toLowerCase() ?? ""}`;
  }

  return `${event.queueKind}:${event.planetId ?? ""}`;
}

function queueMatchesCompletion(event: IndexedQueueCompletedEvent, queue: QueueState | null): boolean {
  if (!queue?.active || queue.kind !== event.queueKind || queue.itemId !== event.itemId) return false;
  if ((event.queueKind === "building" || event.queueKind === "moon-building" || event.queueKind === "research") && event.level !== undefined) {
    return queue.targetLevel === event.level;
  }
  if ((event.queueKind === "defense" || event.queueKind === "ship" || event.queueKind === "moon-defense") && event.quantity !== undefined) {
    return queue.quantity === event.quantity;
  }
  return true;
}

function isPlanetQueueKind(value: string): value is "building" | "defense" | "ship" {
  return value === "building" || value === "defense" || value === "ship";
}

function safeBigInt(value: string | null | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

const FLEET_MISSION_TYPE_LABELS = [
  "Transport",
  "Deploy",
  "Colonize",
  "Attack",
  "Harvest",
  "AcsDefend",
  "Intercept",
  "MissileAttack",
  "AcsAttack",
  "DefenseHold"
] as const;

const FLEET_MISSION_STATUS_LABELS = [
  "None",
  "Outbound",
  "Returning",
  "Resolved",
  "Returned",
  "Recalled"
] as const;

function fleetMissionTypeLabel(id: number): string {
  return FLEET_MISSION_TYPE_LABELS[id] ?? `Unknown:${id}`;
}

function fleetMissionStatusLabel(id: number): string {
  return FLEET_MISSION_STATUS_LABELS[id] ?? `Unknown:${id}`;
}

function fleetMissionTypeId(label: string): number | null {
  const index = FLEET_MISSION_TYPE_LABELS.indexOf(label as typeof FLEET_MISSION_TYPE_LABELS[number]);
  return index >= 0 ? index : null;
}

function fleetMissionStatusId(label: string): number | null {
  const index = FLEET_MISSION_STATUS_LABELS.indexOf(label as typeof FLEET_MISSION_STATUS_LABELS[number]);
  return index >= 0 ? index : null;
}

function fleetMissionStatusProgressRank(status: string): number {
  if (status === "Outbound") return 1;
  if (status === "Resolved") return 2;
  if (status === "Returning" || status === "Recalled") return 3;
  if (status === "Returned") return 4;
  return 0;
}

function isActiveFleetMissionStatus(status: string): boolean {
  return status === "Outbound" || status === "Returning" || status === "Recalled";
}

function isActiveFleetMissionStatusForSummary(mission: FleetMissionSummary): boolean {
  return isActiveFleetMissionStatus(mission.status);
}

function isVisibleActiveFleetMission(mission: FleetMissionSummary): boolean {
  return isActiveFleetMissionStatus(mission.status) && !isOverduePendingRandomnessMission(mission);
}

function isOverduePendingRandomnessMission(mission: FleetMissionSummary): boolean {
  return mission.resolutionBlocker === "randomness_pending";
}

function withFleetMissionResolutionBlocker(
  mission: FleetMissionSummary,
  asOfSeconds: number,
  fulfilledRandomnessRequestIds: ReadonlySet<string> | null
): FleetMissionSummary {
  const requestId = missionBattleRandomnessRequestId(mission);
  const isOverduePendingRandomness =
    mission.status === "Outbound"
    && mission.missionType === "Attack"
    && requestId !== null
    && fulfilledRandomnessRequestIds !== null
    && !fulfilledRandomnessRequestIds.has(requestId)
    && Number(mission.arrivalAt) <= asOfSeconds
    && Number(mission.returnAt) <= asOfSeconds;

  if (!isOverduePendingRandomness) {
    return mission;
  }

  return {
    ...mission,
    resolutionBlocker: "randomness_pending",
    resolutionBlockerDetail: `Battle randomness request ${requestId} is still pending; this attack cannot resolve until randomness is fulfilled.`
  };
}

function fleetSlotSettlementDue(mission: FleetMissionSummary, asOfSeconds: number): boolean {
  return fleetSlotSettlementDueAt(mission) <= asOfSeconds;
}

function fleetSlotSettlementBlocksLaunch(mission: FleetMissionSummary, asOfSeconds: number): boolean {
  if (!isActiveFleetMissionStatus(mission.status) || !fleetSlotSettlementDue(mission, asOfSeconds)) return false;
  return !fleetSlotFreedByLazyLaunchSettlement(mission, asOfSeconds);
}

function fleetSlotFreedByLazyLaunchSettlement(mission: FleetMissionSummary, asOfSeconds: number): boolean {
  if (!fleetSlotSettlementDue(mission, asOfSeconds)) return false;
  if (mission.status === "Returning" || mission.status === "Recalled") return true;
  return (
    mission.status === "Outbound"
    && mission.needsResolution === true
    && lazyLaunchSettleableOutboundMissionTypes.has(mission.missionType)
  );
}

function fleetSlotSettlementDueAt(mission: FleetMissionSummary): number {
  if (mission.status === "Returning" || mission.status === "Recalled") return Number(mission.returnAt);
  if (mission.status === "Outbound") {
    if (mission.missionType === "DefenseHold") return Number(mission.returnAt);
    return Number(mission.arrivalAt);
  }
  return Number.POSITIVE_INFINITY;
}

const lazyLaunchSettleableOutboundMissionTypes = new Set(["Transport", "Deploy", "Attack", "Harvest"]);

function projectedFleetRecallCost(fuelCost: string): string {
  const fuel = BigInt(fuelCost);
  if (fuel <= 0n) return "0";
  const cost = (fuel * 2_500n) / 10_000n;
  return (cost === 0n ? 1n : cost).toString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseCanonicalFleetMissionEvent(value: string | null): FleetMissionSummary | null {
  if (!value) return null;
  const payload = parseJson<CanonicalFleetMissionPayload | FleetMissionSummary | null>(value, null);
  if (!payload || typeof payload !== "object") return null;
  const mission = "mission" in payload ? payload.mission : payload;
  return isStoredFleetMissionSummary(mission) ? mission : null;
}

function mergeFleetMissionSummary(
  existing: FleetMissionSummary | null,
  partial: Partial<FleetMissionSummary> & { missionId: string }
): FleetMissionSummary | null {
  const merged = {
    ...(existing ?? {}),
    ...definedFleetMissionFields(partial),
    missionId: partial.missionId,
    cargo: mergeResources(existing?.cargo, partial.cargo),
    returnCargo: partial.returnCargo ?? existing?.returnCargo ?? null,
    ships: mergeShips(existing?.ships, partial.ships),
    recallCost: partial.recallCost ?? existing?.recallCost ?? null,
    attackGroupId: partial.attackGroupId ?? existing?.attackGroupId ?? null,
    joinedAttackMissionIds: mergeStringSets(existing?.joinedAttackMissionIds, partial.joinedAttackMissionIds),
    defendsMissionId: partial.defendsMissionId ?? existing?.defendsMissionId ?? null,
    counterplayDefenderMissionIds: mergeStringSets(existing?.counterplayDefenderMissionIds, partial.counterplayDefenderMissionIds),
    defenseHoldUntil: partial.defenseHoldUntil ?? existing?.defenseHoldUntil,
    needsResolution: partial.needsResolution ?? existing?.needsResolution ?? false,
    fuelCost: mergeDefaultedString(existing?.fuelCost, partial.fuelCost),
    launchBlockNumber: mergeDefaultedString(existing?.launchBlockNumber, partial.launchBlockNumber),
    randomnessRequestId: usefulString(partial.randomnessRequestId) ? partial.randomnessRequestId : existing?.randomnessRequestId
  };
  return isStoredFleetMissionSummary(merged) ? merged : null;
}

function isEventDerivedFleetMissionRowReady(existing: FleetMissionSummary | null, mission: FleetMissionSummary | null): mission is FleetMissionSummary {
  return Boolean(
    mission
    && isStoredFleetMissionSummary(mission)
    && typeof mission.fuelCost === "string"
    && mission.fuelCost.length > 0
    && (
      existing
      || mission.launchBlockNumber !== "0"
    )
  );
}

function definedFleetMissionFields(
  mission: Partial<FleetMissionSummary>
): Partial<FleetMissionSummary> {
  return Object.fromEntries(
    Object.entries(mission).filter(([, value]) => value !== undefined)
  ) as Partial<FleetMissionSummary>;
}

function mergeResources(existing: Resources | undefined, partial: Resources | undefined): Resources {
  if (!existing) return partial ?? zeroResources();
  if (!partial) return existing;
  if (partial.metal === "0" && partial.crystal === "0" && partial.deuterium === "0") return existing;
  return partial;
}

function mergeShips(existing: Record<string, string> | undefined, partial: Record<string, string> | undefined): Record<string, string> {
  if (!existing) return partial ?? {};
  if (!partial || Object.keys(partial).length === 0) return existing;
  return partial;
}

function mergeStringSets(left: readonly string[] | undefined, right: readonly string[] | undefined): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function mergeDefaultedString(existing: string | undefined, partial: string | undefined): string | undefined {
  if (partial === undefined) return existing;
  if (existing !== undefined && partial === "0") return existing;
  return partial;
}

function usefulString(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "" && value !== "0";
}

function eventDerivedFuelCost(row: ContractFleetMissionRow, mission: FleetMissionSummary | null | undefined): string {
  const marker = parseJson<{ source?: string }>(row.event_json ?? "", {});
  if (marker.source !== "indexed_mission_event_logs") return row.fuel_cost;
  if (row.fuel_cost !== "0") return row.fuel_cost;
  if (!mission?.fuelCost || mission.fuelCost === "0") return row.fuel_cost;
  return mission.fuelCost;
}

function isStoredFleetMissionSummary(value: unknown): value is FleetMissionSummary {
  if (!value || typeof value !== "object") return false;
  const mission = value as Partial<FleetMissionSummary>;
  return typeof mission.missionId === "string"
    && typeof mission.transactionHash === "string"
    && typeof mission.blockNumber === "string"
    && typeof mission.launchBlockNumber === "string"
    && mission.returnCargo !== undefined
    && typeof mission.ships === "object"
    && mission.ships !== null
    && mission.attackGroupId !== undefined
    && Array.isArray(mission.joinedAttackMissionIds)
    && Array.isArray(mission.counterplayDefenderMissionIds)
    && mission.defendsMissionId !== undefined
    && mission.needsResolution !== undefined;
}

function openIndexerDatabase(databasePath: string, readOnly = false): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath, readOnly ? { readonly: true } : undefined);
  database.exec(`PRAGMA busy_timeout = ${readOnly ? 25 : 10000};`);
  if (readOnly) {
    database.exec("PRAGMA query_only = ON;");
    return database;
  }
  if (databasePath !== ":memory:") {
    // Read-concurrency tuning for the API's read-heavy traffic (VEY-KANEO-467):
    // - WAL lets readers run without blocking the background event-integration writer.
    // - synchronous = NORMAL is the WAL-safe default (durable across app crashes; only a power
    //   loss can lose the last commit, which the chain re-supplies on the next sync).
    // - mmap_size / cache_size keep the hot read-model tables resident so warm reads avoid disk.
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec("PRAGMA mmap_size = 268435456;");
    database.exec("PRAGMA cache_size = -16384;");
    database.exec("PRAGMA wal_autocheckpoint = 1000;");
    database.exec("PRAGMA journal_size_limit = 67108864;");
  }
  return database;
}

function parseEvent<T>(value: string): T {
  return JSON.parse(value) as T;
}

function sortedEventRows(rows: readonly EventRow[]): IndexedRpcLog[] {
  return sortRpcLogs(rows.map((row) => parseEvent<IndexedRpcLog>(row.event_json))) as IndexedRpcLog[];
}

function unitCountSnapshotForPlanet(snapshots: Map<string, UnitCountSnapshot>, planetId: string): UnitCountSnapshot {
  let snapshot = snapshots.get(planetId);
  if (!snapshot) {
    snapshot = { fleet: new Map(), defenses: new Map() };
    snapshots.set(planetId, snapshot);
  }
  return snapshot;
}

function materializeBattleReportDefenderSnapshot(snapshot: UnitCountSnapshot | undefined): BattleReportDefenderSnapshot | null {
  if (!snapshot) return null;
  return {
    fleet: unitCountRows(snapshot.fleet),
    defenses: unitCountRows(snapshot.defenses)
  };
}

function unitCountRows(counts: Map<number, number>): Array<{ id: number; count: number }> {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => left.id - right.id);
}

function maxReportBlockNumber(reports: readonly BattleReport[]): bigint {
  return reports.reduce((max, report) => {
    const block = BigInt(report.blockNumber);
    return block > max ? block : max;
  }, 0n);
}

function sameRpcTransaction(left: Pick<IndexedRpcLog, "transactionHash">, right: Pick<IndexedRpcLog, "transactionHash">): boolean {
  return left.transactionHash.toLowerCase() === right.transactionHash.toLowerCase();
}

function sortRpcLogs(logs: readonly RpcLog[]): RpcLog[] {
  return [...logs].sort((left, right) => {
    return compareRpcLogPosition(left, right);
  });
}

function compareRpcLogPosition(
  left: Pick<RpcLog, "blockNumber"> & { logIndex?: string },
  right: Pick<RpcLog, "blockNumber"> & { logIndex?: string }
): number {
  const blockDelta = compareBigIntish(left.blockNumber, right.blockNumber);
  if (blockDelta !== 0) return blockDelta;
  return compareBigIntish(left.logIndex ?? "0x0", right.logIndex ?? "0x0");
}

function compareBigIntish(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function mergeCurrentPlanetSnapshots(
  settledPlanetEvents: SettledPlanetEvent[],
  currentPlanets: SettledPlanetEvent[]
): SettledPlanetEvent[] {
  const settledByPlanetId = new Map(settledPlanetEvents.map((event) => [event.planetId, event]));
  return currentPlanets.map((planet) => {
    const settled = settledByPlanetId.get(planet.planetId);
    if (!settled) return planet;

    return {
      ...planet,
      blockNumber: settled.blockNumber,
      eventName: settled.eventName,
      transactionHash: settled.transactionHash
    };
  });
}

function indexedManagedPlanet(
  planet: SettledPlanetEvent,
  homePlanetId: string | null,
  buildings: InfrastructureState["buildings"] = [],
  queues: Pick<ManagedPlanet["queues"], "building" | "defense" | "ship"> = {
    building: null,
    defense: null,
    ship: null
  },
  moon: ManagedPlanet["moon"] = null
): ManagedPlanet {
  const level = (id: number) => buildings.find((building) => building.id === id)?.level ?? 0;

  return {
    ...planet,
    bodyKind: "planet",
    coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
    isHomePlanet: planet.planetId === homePlanetId,
    fieldsUsed: usedFieldsFromBuildingRows(buildings),
    fieldsCapacity: planet.fields,
    keyLevels: {
      metalMine: level(0),
      crystalMine: level(1),
      deuteriumSynthesizer: level(2),
      solarPlant: level(3),
      roboticsFactory: level(4),
      shipyard: level(5),
      researchLab: level(6),
      terraformer: level(12)
    },
    queues,
    moon
  };
}

function isZeroResourcePlaceholder(event: SettledPlanetEvent): boolean {
  return event.lastSettledAt === "0"
    && event.resources.metal === "0"
    && event.resources.crystal === "0"
    && event.resources.deuterium === "0";
}

function isCanonicalCurrentPlanetSnapshot(event: SettledPlanetEvent): boolean {
  return event.transactionHash === "0x" && event.blockNumber === "0";
}

function pendingPlanetResourcesReason(planetId: string): string {
  return `planet_resources_pending:${planetId}`;
}

function isPlanetHydrationPendingReason(reason: string | null): boolean {
  return Boolean(
    reason?.startsWith("planet_resources_pending:")
    || reason?.startsWith("planet_identity_pending:")
  );
}

// Transient websocket-triggered reconcile reasons. These are background refreshes
// (the websocket keeps the indexed state live), not signals that we know data is
// missing — so once a full reconciliation already exists they must not gate serving.
function isTransientWebsocketReason(reason: string | null): boolean {
  return Boolean(
    reason?.startsWith("websocket reconnected")
    || reason?.startsWith("websocket head gap")
    || reason?.startsWith("websocket log decode/apply failure")
  );
}

function isNonBlockingPendingReason(reason: string | null): boolean {
  return isPlanetHydrationPendingReason(reason) || isTransientWebsocketReason(reason);
}

function subtractResources(left: QueueState["cost"], right: QueueState["cost"]): QueueState["cost"] {
  return {
    metal: subtractResource(left.metal, right.metal),
    crystal: subtractResource(left.crystal, right.crystal),
    deuterium: subtractResource(left.deuterium, right.deuterium)
  };
}

function resourcesWithClaimableAccrual(
  current: Resources,
  productionPerHour: Resources | null,
  storageCaps: Resources | null,
  elapsedSeconds: number
): Resources {
  if (!productionPerHour || !storageCaps || elapsedSeconds <= 0) return current;

  return {
    metal: resourceWithClaimableAccrual(current.metal, productionPerHour.metal, storageCaps.metal, elapsedSeconds),
    crystal: resourceWithClaimableAccrual(current.crystal, productionPerHour.crystal, storageCaps.crystal, elapsedSeconds),
    deuterium: resourceWithClaimableAccrual(current.deuterium, productionPerHour.deuterium, storageCaps.deuterium, elapsedSeconds)
  };
}

function resourceWithClaimableAccrual(
  current: string,
  productionPerHour: string,
  storageCap: string,
  elapsedSeconds: number
): string {
  const currentValue = Number(current);
  const rate = Math.max(0, Number(productionPerHour));
  const cap = Number(storageCap);
  if (!Number.isFinite(currentValue) || !Number.isFinite(rate) || !Number.isFinite(cap)) return current;

  const produced = Math.floor((rate * elapsedSeconds) / 3_600);
  const remainingCapacity = Math.max(0, cap - currentValue);
  return Math.floor(currentValue + Math.min(produced, remainingCapacity)).toString();
}

function queueStateFromEvent(event: QueueUpsertEvent): QueueState {
  const queue: QueueState = {
    active: true,
    kind: event.queueKind,
    itemId: event.itemId,
    readyAt: event.readyAt,
    cost: event.cost
  };
  if (event.targetLevel !== undefined) queue.targetLevel = event.targetLevel;
  if (event.quantity !== undefined) queue.quantity = event.quantity;
  if (event.startedAt !== undefined) queue.startedAt = event.startedAt;
  if (event.backlog?.length) queue.backlog = event.backlog;
  return queue;
}

function queueStatesMatch(left: QueueState, right: QueueState): boolean {
  return left.kind === right.kind
    && left.itemId === right.itemId
    && left.targetLevel === right.targetLevel
    && left.quantity === right.quantity
    && left.readyAt === right.readyAt
    && (left.startedAt ?? null) === (right.startedAt ?? null)
    && left.cost.metal === right.cost.metal
    && left.cost.crystal === right.cost.crystal
    && left.cost.deuterium === right.cost.deuterium;
}

function queueStatesMatchIgnoringStartedAt(left: QueueState, right: QueueState): boolean {
  return left.kind === right.kind
    && left.itemId === right.itemId
    && left.targetLevel === right.targetLevel
    && left.quantity === right.quantity
    && left.readyAt === right.readyAt
    && left.cost.metal === right.cost.metal
    && left.cost.crystal === right.cost.crystal
    && left.cost.deuterium === right.cost.deuterium;
}

function queueReadyAt(queue: QueueState): bigint | null {
  if (queue.readyAt === null || queue.readyAt === undefined) return null;
  try {
    return BigInt(queue.readyAt);
  } catch {
    return null;
  }
}

function subtractResource(left: string, right: string): string {
  const result = BigInt(left) - BigInt(right);
  return result > 0n ? result.toString() : "0";
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function levelRows(rows: readonly LevelRow[] | undefined): Array<{ id: number; level: number }> {
  return (rows ?? []).map((row) => ({ id: row.id, level: row.value }));
}

function countRows(rows: readonly LevelRow[] | undefined): Array<{ id: number; count: number }> {
  return (rows ?? []).map((row) => ({ id: row.id, count: row.value }));
}

function canonicalFleetMissionEventJson(mission: CanonicalFleetMissionSnapshot): string {
  return JSON.stringify(mission);
}

function compareFleetMissionsNewestFirst(left: FleetMissionSummary, right: FleetMissionSummary): number {
  const leftTime = Number(left.status === "Returned" ? left.returnAt : left.arrivalAt);
  const rightTime = Number(right.status === "Returned" ? right.returnAt : right.arrivalAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  const leftBlock = BigInt(left.blockNumber);
  const rightBlock = BigInt(right.blockNumber);
  if (leftBlock !== rightBlock) return rightBlock > leftBlock ? 1 : -1;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return rightMission > leftMission ? 1 : -1;
}

function compareBlockAndLogPosition(
  leftBlock: string,
  leftLogIndex: string,
  rightBlock: string,
  rightLogIndex: string
): number {
  const leftBlockNumber = BigInt(leftBlock);
  const rightBlockNumber = BigInt(rightBlock);
  if (leftBlockNumber !== rightBlockNumber) return leftBlockNumber > rightBlockNumber ? 1 : -1;
  const leftLogNumber = BigInt(leftLogIndex);
  const rightLogNumber = BigInt(rightLogIndex);
  if (leftLogNumber === rightLogNumber) return 0;
  return leftLogNumber > rightLogNumber ? 1 : -1;
}

function compareBattleReportsNewestFirst(left: BattleReport, right: BattleReport): number {
  const leftBlock = BigInt(left.blockNumber);
  const rightBlock = BigInt(right.blockNumber);
  if (leftBlock !== rightBlock) return rightBlock > leftBlock ? 1 : -1;
  const leftLogIndex = BigInt(left.logIndex);
  const rightLogIndex = BigInt(right.logIndex);
  if (leftLogIndex !== rightLogIndex) return rightLogIndex > leftLogIndex ? 1 : -1;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return rightMission > leftMission ? 1 : -1;
}

function missionIdFromTopic(topic: string | null | undefined): string | null {
  if (!topic) return null;
  try {
    return BigInt(topic).toString();
  } catch {
    return null;
  }
}

// Soonest-event-first ordering for active missions: returning/recalled fleets sort by their
// return time, in-flight fleets by arrival. Keeps the universe-wide "All" feed deterministic
// (the frontend re-sorts its rows, but a stable backend order keeps pagination/tests predictable).
function compareFleetMissionsActiveSoonestFirst(left: FleetMissionSummary, right: FleetMissionSummary): number {
  const nextEvent = (mission: FleetMissionSummary): number =>
    Number(mission.status === "Returning" || mission.status === "Recalled" ? mission.returnAt : mission.arrivalAt);
  const leftTime = nextEvent(left);
  const rightTime = nextEvent(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return leftMission > rightMission ? 1 : -1;
}

const moonBuildingRows = [
  { id: 0, key: "lunarBase", label: "Lunar Base" },
  { id: 1, key: "roboticsFactory", label: "Robotics Factory" },
  { id: 2, key: "jumpGate", label: "Jump Gate" },
  { id: 3, key: "shipyard", label: "Shipyard" }
];
const moonDefenseRows = Array.from({ length: 8 }, (_, id) => ({ id }));
const riftResourceRows = [
  { key: "metal" as const, label: "Metal", resourceId: 0 },
  { key: "crystal" as const, label: "Crystal", resourceId: 1 },
  { key: "deuterium" as const, label: "Deuterium", resourceId: 2 }
];

function indexedLogKey(log: IndexedRpcLog): string {
  return `${log.transactionHash.toLowerCase()}:${log.logIndex ?? fallbackLogIndex(log)}`;
}

function fallbackLogIndex(log: RpcLog): string {
  return `${log.blockNumber}:${log.topics.join(",")}:${log.data}`;
}

function blockTimestampSeconds(log: IndexedRpcLog): string | undefined {
  if (!log.blockTimestamp) return undefined;

  try {
    return decodeIntegerString(log.blockTimestamp).toString();
  } catch {
    return undefined;
  }
}

function blockNumberToDecimal(blockNumber: string): string {
  try {
    return decodeIntegerString(blockNumber).toString();
  } catch {
    return blockNumber;
  }
}

function maxBlockLabel(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  try {
    return BigInt(blockNumberToDecimal(left)) >= BigInt(blockNumberToDecimal(right))
      ? blockNumberToDecimal(left)
      : blockNumberToDecimal(right);
  } catch {
    return right;
  }
}

function allianceRoleName(roleId: number): AllianceState["membership"]["role"] {
  if (!allianceRoleIds.includes(roleId)) return "none";
  if (roleId === 1) return "member";
  if (roleId === 2) return "officer";
  if (roleId === 3) return "owner";
  return "none";
}

function allianceRoleId(role: AllianceState["membership"]["role"]): number {
  if (role === "member") return 1;
  if (role === "officer") return 2;
  if (role === "owner") return 3;
  return 0;
}

function decodeIntegerString(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return BigInt(Number(value));
  }
}

function subtractNonNegative(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n;
}

type BattleLossCandidate = {
  kind: "ship" | "defense";
  planetId: string;
  itemId: number;
  max: number;
  cost: Resources;
};

type LegacyAbsoluteUnitTotal = {
  blockNumber: string;
  logIndex: string;
  total: number;
};

type BattleLossPick = {
  candidate: BattleLossCandidate;
  destroyed: number;
};

const shipKeyIds = new Map<string, number>([
  ["smallCargo", 0],
  ["lightFighter", 1],
  ["recycler", 2],
  ["colonyShip", 3],
  ["largeCargo", 4],
  ["heavyFighter", 5],
  ["cruiser", 6],
  ["battleship", 7],
  ["bomber", 8],
  ["solarSatellite", 9],
  ["destroyer", 10],
  ["deathstar", 11],
  ["battlecruiser", 12],
  ["reaper", 13],
  ["pathfinder", 14],
  ["crawler", 15]
]);
const shipIdKeys = new Map([...shipKeyIds].map(([key, id]) => [id, key]));

const legacyShipCosts: readonly Resources[] = [
  { metal: "2000", crystal: "2000", deuterium: "0" },
  { metal: "3000", crystal: "1000", deuterium: "0" },
  { metal: "10000", crystal: "6000", deuterium: "2000" },
  { metal: "10000", crystal: "20000", deuterium: "10000" },
  { metal: "6000", crystal: "6000", deuterium: "0" },
  { metal: "6000", crystal: "4000", deuterium: "0" },
  { metal: "20000", crystal: "7000", deuterium: "2000" },
  { metal: "45000", crystal: "15000", deuterium: "0" },
  { metal: "50000", crystal: "25000", deuterium: "15000" },
  { metal: "0", crystal: "2000", deuterium: "500" },
  { metal: "60000", crystal: "50000", deuterium: "15000" },
  { metal: "5000000", crystal: "4000000", deuterium: "1000000" },
  { metal: "30000", crystal: "40000", deuterium: "15000" },
  { metal: "85000", crystal: "55000", deuterium: "20000" },
  { metal: "8000", crystal: "15000", deuterium: "8000" },
  { metal: "2000", crystal: "2000", deuterium: "1000" }
];

const legacyDefenseCosts: readonly Resources[] = [
  { metal: "2000", crystal: "0", deuterium: "0" },
  { metal: "1500", crystal: "500", deuterium: "0" },
  { metal: "6000", crystal: "2000", deuterium: "0" },
  { metal: "10000", crystal: "10000", deuterium: "0" },
  { metal: "20000", crystal: "15000", deuterium: "2000" },
  { metal: "2000", crystal: "6000", deuterium: "0" },
  { metal: "50000", crystal: "50000", deuterium: "30000" },
  { metal: "50000", crystal: "50000", deuterium: "0" },
  { metal: "8000", crystal: "0", deuterium: "2000" },
  { metal: "12500", crystal: "2500", deuterium: "10000" }
];

function shipKeyToId(key: string): number | null {
  return shipKeyIds.get(key) ?? null;
}

function shipIdToKey(id: number): string | null {
  return shipIdKeys.get(id) ?? null;
}

function positiveShipCounts(ships: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(ships).filter(([, count]) => {
    try {
      return BigInt(count) > 0n;
    } catch {
      return false;
    }
  }));
}

function shipCostForLegacyLoss(shipId: number): Resources | null {
  return legacyShipCosts[shipId] ?? null;
}

function defenseCostForLegacyLoss(defenseId: number): Resources | null {
  return legacyDefenseCosts[defenseId] ?? null;
}

function battleLogMissionId(log: RpcLog): string | null {
  try {
    return BigInt(log.topics[1] ?? "0x0").toString();
  } catch {
    return null;
  }
}

function associatedBattleReportMissionIds(report: BattleReport): string[] {
  return [...new Set([
    report.missionId,
    report.attackGroupId,
    ...report.participants.map((participant) => participant.missionId)
  ].filter((missionId): missionId is string => Boolean(missionId)))];
}

function isFleetMissionReturnedLog(log: RpcLog): boolean {
  return log.topics[0] === fleetMissionReturnedTopic;
}

function fleetMissionLogMissionId(log: RpcLog): string | null {
  try {
    return BigInt(log.topics[1] ?? "0x0").toString();
  } catch {
    return null;
  }
}

function fleetMissionIdTopic(missionId: string): string {
  try {
    return `0x${BigInt(missionId).toString(16).padStart(64, "0")}`;
  } catch {
    return missionId;
  }
}

function uniqueLossSolution(candidates: BattleLossCandidate[], losses: Resources): BattleLossPick[] | null {
  const target = numericResources(losses);
  const solutions: BattleLossPick[][] = [];

  const search = (index: number, remaining: { metal: number; crystal: number; deuterium: number }, picks: BattleLossPick[]) => {
    if (solutions.length > 1) return;
    if (remaining.metal === 0 && remaining.crystal === 0 && remaining.deuterium === 0) {
      solutions.push([...picks]);
      return;
    }
    if (index >= candidates.length) return;
    const candidate = candidates[index]!;
    const cost = numericResources(candidate.cost);
    let maxDestroyed = candidate.max;
    if (cost.metal > 0) maxDestroyed = Math.min(maxDestroyed, Math.floor(remaining.metal / cost.metal));
    else if (remaining.metal !== 0) maxDestroyed = 0;
    if (cost.crystal > 0) maxDestroyed = Math.min(maxDestroyed, Math.floor(remaining.crystal / cost.crystal));
    else if (remaining.crystal !== 0 && cost.metal === 0 && cost.deuterium === 0) maxDestroyed = 0;
    if (cost.deuterium > 0) maxDestroyed = Math.min(maxDestroyed, Math.floor(remaining.deuterium / cost.deuterium));
    else if (remaining.deuterium !== 0 && cost.metal === 0 && cost.crystal === 0) maxDestroyed = 0;

    for (let destroyed = maxDestroyed; destroyed >= 0; destroyed -= 1) {
      const next = {
        metal: remaining.metal - cost.metal * destroyed,
        crystal: remaining.crystal - cost.crystal * destroyed,
        deuterium: remaining.deuterium - cost.deuterium * destroyed
      };
      if (next.metal < 0 || next.crystal < 0 || next.deuterium < 0) continue;
      if (destroyed > 0) picks.push({ candidate, destroyed });
      search(index + 1, next, picks);
      if (destroyed > 0) picks.pop();
      if (solutions.length > 1) return;
    }
  };

  search(0, target, []);
  return solutions.length === 1 ? solutions[0]! : null;
}

function battleLossPicksToMutations(solution: BattleLossPick[]): LegacyUnitMutation[] {
  return solution.map(({ candidate, destroyed }) => ({
    kind: candidate.kind,
    planetId: candidate.planetId,
    itemId: candidate.itemId,
    delta: candidate.kind === "defense" ? -(destroyed - Math.floor((destroyed * 7) / 10)) : -destroyed
  })).filter((mutation) => mutation.delta !== 0);
}

function mergeLegacyUnitMutations(
  left: LegacyUnitMutation[] | null,
  right: LegacyUnitMutation[] | null
): LegacyUnitMutation[] | null {
  const merged = new Map<string, LegacyUnitMutation>();
  for (const mutation of [...(left ?? []), ...(right ?? [])]) {
    const key = legacyUnitMutationKey(mutation);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, delta: Math.min(existing.delta, mutation.delta) });
    } else {
      merged.set(key, mutation);
    }
  }
  const mutations = [...merged.values()].filter((mutation) => mutation.delta !== 0);
  return mutations.length > 0 ? mutations : null;
}

function numericResources(resources: Resources): { metal: number; crystal: number; deuterium: number } {
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium)
  };
}

function isZeroResources(resources: Resources): boolean {
  return Number(resources.metal) === 0 && Number(resources.crystal) === 0 && Number(resources.deuterium) === 0;
}

function latestAbsoluteUnitTotalsFromLogs(logs: IndexedRpcLog[]): Map<string, LegacyAbsoluteUnitTotal> {
  const totals = new Map<string, LegacyAbsoluteUnitTotal>();
  for (const log of logs) {
    if (isIndexedQueueCompletedLog(log)) {
      const event = decodeIndexedQueueCompletedLog(log);
      if (event.total === undefined) continue;
      if (event.eventName === "ShipCompleted") {
        totals.set(`ship:${event.planetId}:${event.itemId}`, {
          blockNumber: log.blockNumber,
          logIndex: log.logIndex ?? "0x0",
          total: event.total
        });
      } else if (event.eventName === "DefenseCompleted") {
        totals.set(`defense:${event.planetId}:${event.itemId}`, {
          blockNumber: log.blockNumber,
          logIndex: log.logIndex ?? "0x0",
          total: event.total
        });
      }
    } else if (isShipCountChangedLog(log)) {
      const event = decodeShipCountChangedLog(log);
      totals.set(`ship:${event.planetId}:${event.shipId}`, {
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? "0x0",
        total: event.total
      });
    } else if (isDefenseCountChangedLog(log)) {
      const event = decodeDefenseCountChangedLog(log);
      totals.set(`defense:${event.planetId}:${event.defenseId}`, {
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? "0x0",
        total: event.total
      });
    }
  }
  return totals;
}

function legacyUnitMutationKey(mutation: LegacyUnitMutation): string {
  return `${mutation.kind}:${mutation.planetId}:${mutation.itemId}`;
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("database is locked") || message.includes("sqlite_busy") || message.includes("sqlite_locked");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function riftWithdrawalKey(event: IndexedRiftResourceEvent): string {
  return `${event.transactionHash.toLowerCase()}:${event.planetId}:${event.resourceId}:${event.amount}`;
}

function hasAnyShips(ships: Record<string, string>): boolean {
  return Object.values(ships).some((count) => {
    try {
      return BigInt(count) > 0n;
    } catch {
      return Number(count) > 0;
    }
  });
}

// Parse a stored block-height string to bigint, treating null/garbage as block 0 so callers can
// compare reconcile baselines without each guarding the try/catch (VEY-KANEO-461).
function safeBlockNumber(value: string | null): bigint {
  if (value === null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function metadataNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nextBlockOrBase(value: string | null, base: bigint): bigint {
  try {
    return value ? BigInt(value) + 1n : base;
  } catch {
    return base;
  }
}

function latestEventBlock(events: Array<{ blockNumber: string }>): string | null {
  let latest: bigint | null = null;
  for (const event of events) {
    try {
      const block = BigInt(event.blockNumber);
      latest = latest === null || block > latest ? block : latest;
    } catch {
      continue;
    }
  }

  return latest?.toString() ?? null;
}

function reasonText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
