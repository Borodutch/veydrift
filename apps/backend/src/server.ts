import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { generateSystem } from "@veydrift/universe";
import { createPublicClient, encodeFunctionData, webSocket, type Address as ViemAddress, type Log as ViemLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CachedChainReader } from "./cachedReader";
import { ChainSyncService } from "./chainSync";
import type { ChainSyncSnapshot, LiveLogSubscriber } from "./chainSync";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import {
  assertAddress,
  attackBlockReasonLabel,
  transportBlockReasonLabel,
  type Address,
  type AllianceIdentity,
  type AllianceState,
  type AttackBlockReason,
  type AttackProtectionStatus,
  type ChainReader,
  type DefenseState,
  type FleetMissionArchiveEntry,
  type FleetMissionArchiveResponse,
  type MissileAttackArchiveResponse,
  type FleetMissionSummary,
  type FleetMissionVisibility,
  type GlobalActiveMissionsResponse,
  type GlobalMissionArchiveResponse,
  type InfrastructureState,
  type MoonChanceReportEvent,
  type MoonState,
  type ManagedPlanet,
  type PlanetState,
  type PlayerQueues,
  type QueueState,
  type ResearchState,
  type ResourceSnapshotMetadata,
  type Resources,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  type StationedDefenderSummary,
  HttpJsonRpcTransport,
  VeydriftGameReader
} from "./evm";
import { highscoreCategories, highscoreFormula, type HighscoreEntry, type ScoreBreakdown } from "./highscores";
import {
  indexedManagedPlanet,
  SettlementIndexer,
  type IndexedDebrisFieldEvent,
  type IndexedDebrisTarget,
  type IndexedMoonChanceReportEvent,
  type IndexerSnapshot
} from "./indexer";
import { RandomnessCommitterService } from "./randomnessCommitter";
import { loadRandomnessReadinessSnapshot, type RandomnessReadinessSnapshot } from "./randomness";
import { MissionResolutionService } from "./missionResolution";
import { logApiRequestEvent } from "./observability";
import {
  validatePlayerDescription,
  validatePlayerDisplayName,
  verifyPlayerDisplayNameSignature,
  verifyPlayerProfileSignature,
  verifyWatchedPlanetSignature,
  type PlayerProfile
} from "./playerProfiles";
import {
  buildReferralRedemption,
  createReferralStore,
  normalizeReferralCode,
  referralCodeHash,
  referralCommitment,
  referralInviteRecord,
  ReferralInviteStore,
  resolveReferralCode,
  verifyReferralWalletSignature,
  type ReferralHistoryResponse,
  type ReferralResolveResult
} from "./referrals";
import { deriveInfrastructureFields, isCombatShipId, zeroResources } from "./readModels";
import {
  buildPaidAllianceInviteAuthorization,
  createPaidAllianceInviteReader,
  createPaidAllianceInviteSecretStore,
  paidAllianceInviteCommitment,
  PaidAllianceInviteRateLimiter,
  type PaidAllianceInviteSecretStore,
  resolvePaidAllianceInvite,
  type PaidAllianceInviteReader,
} from "./allianceInvites";
import { planetArchetypeForTemperature, planetMetadata, planetMultipliers, systemSnapshot, type PlanetMetadata, type SystemSnapshot } from "./universe";
import { responseCachePath, SharedResponseCache } from "./sharedResponseCache";
import { normalizeStatsUtcOffsetMinutes } from "./stats";
import {
  DEFAULT_MAX_WORKER_COUNT,
  resolveWorkerCount,
  WORKER_COUNT_ENV,
  WORKER_INDEX_ENV,
  WORKER_ROLE_ENV,
  type WorkerRole
} from "./workerPool";
import {
  isEntityMediaKind,
  normalizeEntityMediaId,
  validateYouTubeMediaUrl,
  verifyEntityMediaSignature,
  type EntityMediaKind
} from "./entityMedia";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

const defaultCorsOrigin = "https://test.veydrift.com";
const canonicalCorsOrigins = [
  defaultCorsOrigin,
  "https://veydrift.com",
  "https://stats.veydrift.com"
] as const;

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-origin": defaultCorsOrigin,
  "vary": "Origin",
  ...jsonHeaders
} as const;

const jsonBodyLimitBytes = 32 * 1024;
const graphqlBodyLimitBytes = 128 * 1024;
const acceptedCacheQueryParams = new Map<string, ReadonlySet<string>>([
  ["/cca", new Set(["owner"])],
  ["/highscores", new Set(["category", "currentWallet", "includeAttackProtection", "limit", "live", "page", "pageSize"])],
  ["/missions", new Set(["live", "missionNumber", "missionType", "owner", "page", "pageSize", "planetId", "status"])],
  ["/stats", new Set(["utcOffsetMinutes"])],
  ["/raid-finder/debris", new Set(["limit", "minMetal", "minCrystal"])],
  ["/raid-finder/rifters", new Set(["limit"])],
  ["/universe/systems", new Set(["center", "detail", "galaxy", "limit", "page", "radius"])],
  // The endpoint is wallet-scoped; `planetId` is currently ignored by its handler and must not
  // fragment the shared cache for every planet picker selection.
  ["/wallet/*/fleet-visibility", new Set(["archive"])],
  ["/wallet/*/activity", new Set(["includeProjected", "page", "pageSize", "since"])],
  ["/wallet/*/missions", new Set(["filter", "missionNumber", "missionType", "page", "pageSize", "planetId", "status"])],
  ["/wallet/*/missile-attacks", new Set(["page", "pageSize", "planetId"])],
  ["/wallet/*/referrals/history", new Set(["page", "pageSize"])],
  ["/wallet/*/overview", new Set(["planetId"])],
  ["/wallet/*/queues", new Set(["planetId"])],
  ["/wallet/*/infrastructure", new Set(["planetId"])],
  ["/wallet/*/moon", new Set(["planetId"])],
  ["/wallet/*/shipyard", new Set(["planetId"])],
  ["/wallet/*/defenses", new Set(["planetId"])],
  ["/wallet/*/research", new Set(["planetId"])]
]);

const indexedSource = "contract-state-indexer" as const;
const burningChickenCoordinateBurnSelector = "0x6364233d";
const ccaAuctionAddress = "0x7Ce8e4cC7563a9711A3D52d48439F6dfA4C1B67F" as ViemAddress;
const ccaWethAddress = "0x4200000000000000000000000000000000000006" as ViemAddress;
const ccaEthUsdFallback = 1_917.467;
const ccaBidSubmittedTopic = "0x650baad5cd8ca09b8f580be220fa04ce2ba905a041f764b6a3fe2c848eb70540";
const ccaRecentBidLimit = 12;

const ccaAuctionReadAbi = [
  { type: "function", name: "clearingPrice", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "floorPrice", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "startBlock", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "endBlock", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "isGraduated", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function", name: "checkpoints", stateMutability: "view", inputs: [{ name: "blockNumber", type: "uint64" }], outputs: [{
      name: "", type: "tuple", components: [
        { name: "clearingPrice", type: "uint256" },
        { name: "currencyRaisedAtClearingPriceQ96X7", type: "uint256" },
        { name: "cumulativeMpsPerPrice", type: "uint256" },
        { name: "cumulativeMps", type: "uint24" },
        { name: "prev", type: "uint64" },
        { name: "next", type: "uint64" }
      ]
    }]
  }
] as const;

const erc20BalanceReadAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

let ccaEthUsdCache: { expiresAt: number; value: number } | null = null;

export type CcaSubmittedBid = {
  amountWei: string;
  bidId: string;
  blockNumber: string;
  maxPriceQ96: string;
  owner: string;
  transactionHash: string;
};

/** Decode Uniswap's BidSubmitted(uint256,address,uint256,uint128) event. */
export function decodeCcaSubmittedBid(log: RpcLog): CcaSubmittedBid | null {
  const [topic, bidIdTopic, ownerTopic] = log.topics;
  const data = log.data.startsWith("0x") ? log.data.slice(2) : "";
  if (
    topic?.toLowerCase() !== ccaBidSubmittedTopic
    || !bidIdTopic?.startsWith("0x")
    || !ownerTopic?.startsWith("0x")
    || ownerTopic.length !== 66
    || data.length !== 128
    || !/^[0-9a-fA-F]+$/.test(data)
  ) return null;

  try {
    return {
      amountWei: BigInt(`0x${data.slice(64, 128)}`).toString(),
      bidId: BigInt(bidIdTopic).toString(),
      blockNumber: BigInt(log.blockNumber).toString(),
      maxPriceQ96: BigInt(`0x${data.slice(0, 64)}`).toString(),
      owner: `0x${ownerTopic.slice(-40)}`.toLowerCase(),
      transactionHash: log.transactionHash
    };
  } catch {
    return null;
  }
}

/** Encode the indexed owner topic for BidSubmitted event lookups. */
export function ccaBidOwnerTopic(owner: ViemAddress): `0x${string}` {
  return `0x${owner.slice(2).toLowerCase().padStart(64, "0")}`;
}

function ccaBidOwnerFromQuery(value: string | null): ViemAddress | null {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as ViemAddress : null;
}

type GraphQLPayload = {
  query?: string;
};

type HealthPayload = {
  ok: boolean;
  service: "veydrift-backend";
  configured: boolean;
};

type RuntimeConfig = {
  allianceContractAddress: string | null;
  apiUrl: string;
  backend: BackendDeploymentMetadata;
  burningChicken: {
    burnContractAddress: string | null;
    burnSelector: string | null;
    nftContractAddress: string | null;
    rpcUrl: string | null;
  };
  chainId: number;
  contractAddress: string | null;
  featureSupport: {
    allianceConfigured: boolean;
    chickenBurnConfigured: boolean;
    gameConfigured: boolean;
    highscoresEndpoint: boolean;
    migrationConfigured: boolean;
    moonConfigured: boolean;
    randomnessConfigured: boolean;
    referralsConfigured: boolean;
    researchEndpoint: boolean;
    resourceTokensConfigured: boolean;
    settlementConfigured: boolean;
  };
  gameContractAddress: string | null;
  graphqlUrl: string;
  migrationContractAddress: string | null;
  moonContractAddress: string | null;
  network: string;
  randomnessEngineAddress: string | null;
  referralSignerAddress: string | null;
  referralStartPriceWei: string | null;
  referralSystemAddress: string | null;
  paidAllianceInviteAddress: string | null;
  paidAllianceInviteSignerAddress: string | null;
  resourceTokenAddresses: {
    crystal: string | null;
    deuterium: string | null;
    metal: string | null;
  };
  rpcProvider: "alchemy" | "unknown";
};

type MigrationClaimPayload = {
  signature: `0x${string}`;
  statePayload: `0x${string}`;
};

type MigrationReservedPlanet = {
  planetId?: string;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  temperature: number;
  wallet?: `0x${string}`;
};

type BackendDeploymentMetadata = {
  build: {
    deploymentAbiHash: string | null;
    deploymentCommit: string | null;
    deploymentTimestamp: string | null;
    gitSha: string | null;
    gitShaSource: string | null;
  };
  worker: {
    count: number;
    defaultMaxWorkerCount: number;
    index: number | null;
    role: WorkerRole;
  };
};

export type ServerDependencies = {
  chainSync?: ChainSyncService;
  config?: BackendConfig;
  configProblems?: ConfigProblem[];
  chainReader?: ChainReader;
  missionResolution?: MissionResolutionService;
  randomnessCommitter?: RandomnessCommitterService;
  indexer?: SettlementIndexer;
  // Worker role in the multi-process pool (VEY-KANEO-466). "writer" (the default) owns chain-sync
  // ingestion, the cold-start rebuild, bounded reconciles, and the on-chain committers — those must
  // run on exactly one worker. "reader" workers skip every background loop and serve reads from the
  // shared WAL database. Explicitly injected services (tests) always take precedence over the role.
  role?: WorkerRole;
  // Test/operator seam for an explicit canonical rebuild. Production defaults to false: the normal
  // backend no longer self-heals from eth_call at boot. Chain-sync event replay is the automatic path.
  runStartupReconcile?: boolean;
  // Test seam for the production route-level response cache. Production enables it only for the
  // dependency-free server construction path.
  enableResponseCache?: boolean;
  // Test seam for disabling asynchronous production cache prewarming while exercising the response cache.
  prewarmResponseCache?: boolean;
  // Test seam for request access logging. Production construction enables it by default.
  logRequests?: boolean;
  sharedResponseCache?: SharedResponseCache | null;
  referralStore?: ReferralInviteStore;
  paidAllianceInviteReader?: PaidAllianceInviteReader;
  paidAllianceInviteSecretStore?: PaidAllianceInviteSecretStore;
  // Test seam for the narrowly scoped WalletConnect read-only RPC proxy.
  walletConnectRpc?: Pick<HttpJsonRpcTransport, "request">;
};

const defaultUniverseSeed = "veydrift-mainnet-preview";

export function createRequestHandler(dependencies: ServerDependencies = {}): (request: Request) => Promise<Response> {
  // Only the writer worker runs the chain indexer ingestion + the on-chain committers; reader workers
  // serve from the shared WAL database and must not start any background loop (VEY-KANEO-466). Tests
  // that inject services bypass this entirely. Default is "writer" so single-process and test setups
  // keep their current behavior.
  const workerRole = dependencies.role ?? envWorkerRole();
  const isWriter = workerRole !== "reader";
  const loaded = dependencies.config ? { config: dependencies.config, problems: dependencies.configProblems ?? [] } : loadBackendConfig();
  const rawChainReader =
    dependencies.chainReader ??
    (loaded.problems.length === 0 ? new VeydriftGameReader(loaded.config, undefined, {
      // Queue progress is user-visible.  Keep the production timing slots on the
      // narrow live reader so Overview can render a determinate whole-queue bar.
      hydrateQueueStartedAt: true,
      rpcCallSource: "api-explicit-live-read"
    }) : undefined);
  const cacheReader = rawChainReader && !dependencies.chainReader ? new CachedChainReader(rawChainReader) : undefined;
  const chainReader = cacheReader ?? rawChainReader;
  // Public CCA state is intentionally served from the backend's configured Base
  // RPC. Browsers should not need a public RPC endpoint merely to render the
  // auction, and the transport already retries/fails over between configured
  // nodes.
  const ccaRpc = loaded.problems.length === 0 && rpcUrlsForConfig(loaded.config).length > 0
    ? new HttpJsonRpcTransport(rpcUrlsForConfig(loaded.config), {
      cacheTtlMs: 4_000,
      minRequestIntervalMs: 0,
      source: "cca-public-read"
    })
    : undefined;
  // WalletConnect needs an HTTPS JSON-RPC URL for its wallet modal's Base
  // reads. Keep the node private: this is a small, read-only facade over the
  // backend's configured own RPC, never a general-purpose public RPC service.
  const walletConnectRpc = dependencies.walletConnectRpc
    ?? (loaded.problems.length === 0 && rpcUrlsForConfig(loaded.config).length > 0
      ? new HttpJsonRpcTransport(rpcUrlsForConfig(loaded.config), {
        cacheTtlMs: 1_000,
        minRequestIntervalMs: 0,
        source: "walletconnect-public-read"
      })
      : undefined);
  const indexerChainReader =
    dependencies.chainReader
      ? chainReader
      : loaded.problems.length === 0
        ? new VeydriftGameReader(loaded.config, undefined, {
          // Canonical queue repairs must retain the timing data used to derive
          // partial completion and whole-queue progress.
          hydrateQueueStartedAt: true,
          rpcCallSource: "indexer-explicit-rebuild"
        })
        : undefined;
  const logBackfillChainReader =
    dependencies.chainReader
      ? chainReader
      : loaded.problems.length === 0
        ? new VeydriftGameReader(
          loaded.config,
          new HttpJsonRpcTransport(rpcUrlsForConfig(loaded.config), {
            cacheTtlMs: 0,
            minRequestIntervalMs: 0,
            source: "chain-sync"
          }),
          { hydrateQueueStartedAt: false }
        )
        : undefined;
  const indexer =
    dependencies.indexer ??
    (isIndexableChainReader(indexerChainReader) ? new SettlementIndexer(indexerChainReader, loaded.config.indexFromBlock, {
      databasePath: loaded.config.indexDbPath,
      // VEY-KANEO-471: config already hard-gates this to non-production; pass it through so the
      // fleet-visibility read model can serve the synthetic stationed-defense payload for QA.
      qaSyntheticStationedDefenders: loaded.config.qaSyntheticStationedDefenders,
      // VEY-KANEO-479: when the randomness engine is configured, gate an arrived Attack's readiness on
      // its battle randomness being fulfilled (derived from ingested RandomnessFulfilled logs).
      randomnessEngineConfigured: Boolean(loaded.config.randomnessEngineAddress),
      ...(loaded.config.settlementStartPriceWei
        ? { settlementStartPriceWei: loaded.config.settlementStartPriceWei }
        : {}),
      // VEY-KANEO-485: bound the cold wipe->reindex chain reads so a stall surfaces a real error and the
      // boot-time recovery retries, instead of an indefinite silent reconciliation_in_progress.
      ...(loaded.config.rebuildDeadlineMs ? { rebuildDeadlineMs: loaded.config.rebuildDeadlineMs } : {}),
      readOnly: !isWriter,
      // Startup should only create/upgrade schema. Historical materialized-state repair can scan large
      // persisted event tables, so keep it on explicit operator replay/sync commands instead of blocking
      // backend boot and starving trivial endpoints such as /runtime-config.
      runStartupBackfill: false
    }) : undefined);
  const logBackfiller = deriveLogBackfiller(logBackfillChainReader);
  const usesProductionDependencies = (
    !dependencies.chainReader
    && !dependencies.chainSync
    && !dependencies.config
    && !dependencies.indexer
    && !dependencies.randomnessCommitter
  );
  const liveLogSubscriber =
    !usesProductionDependencies || !isWriter || loaded.problems.length > 0
      ? undefined
      : createViemLiveLogSubscriber(loaded.config);
  const publishWriterChainSyncDiagnostics = (snapshot: ChainSyncSnapshot) => {
    indexer?.recordWriterChainSyncDiagnostics?.({
      chainSync: snapshot,
      chainSyncRpc: logBackfiller?.rpcMetrics?.() ?? null
    });
  };
  const chainSync =
    dependencies.chainSync ??
    (isWriter && loaded.problems.length === 0
      ? new ChainSyncService(loaded.config, indexer, {
        ...(logBackfiller ? { logBackfiller } : {}),
        ...(liveLogSubscriber ? { liveLogSubscriber } : {}),
        diagnosticsPublisher: publishWriterChainSyncDiagnostics
      })
      : undefined);
  const randomnessCommitter =
    dependencies.randomnessCommitter ??
    (isWriter && loaded.problems.length === 0 ? new RandomnessCommitterService(loaded.config) : undefined);
  const missionResolution =
    dependencies.missionResolution ??
    (isWriter && loaded.problems.length === 0 && loaded.config.missionResolutionEnabled
      ? new MissionResolutionService(loaded.config, {
        ...(indexer ? { candidateSource: indexer } : {})
      })
      : undefined);

  chainSync?.start();
  missionResolution?.start();
  randomnessCommitter?.start();
  const runStartupReconcile = dependencies.runStartupReconcile ?? false;
  if (isWriter && runStartupReconcile && indexer && loaded.problems.length === 0) {
    // Explicit operator/test rebuild only. This path performs canonical eth_call reads and therefore must
    // never run automatically for frontend/API serving; normal mutation comes from event replay/listeners.
    void indexer.rebuild().catch((error) => {
      console.error("Veydrift explicit index reconciliation failed", error);
    });
  }
  if (
    isWriter
    && loaded.config.currentStateHealRunId
    && !loaded.config.fullCanonicalStateHealRunId
    && indexer
    && loaded.problems.length === 0
  ) {
    // Explicit operator heal only. Startup uses the narrow fleet-mission snapshot heal: it repairs the
    // known live divergence once, then normal backend mutation remains event-listener-only.
    void indexer
      .startFleetMissionStateHealOnce(loaded.config.currentStateHealRunId)
      .catch((error) => {
        console.error("Veydrift current-state heal failed", error);
      });
  }
  if (isWriter && loaded.config.fullCanonicalStateHealRunId && indexer && loaded.problems.length === 0) {
    // Explicit operator-only full snapshot: production queues can have a FIFO
    // backlog that cannot be reconstructed safely from a single latest queue
    // event after lazy settlement.  This reads the contract's active queue and
    // backlog, repairs the mirror atomically, and is idempotent by run ID.
    void indexer
      .startCurrentStateHealOnce(loaded.config.fullCanonicalStateHealRunId, {
        ...(loaded.config.currentStateHealConcurrency
          ? { planetConcurrency: loaded.config.currentStateHealConcurrency }
          : {})
      })
      .catch((error) => {
        console.error("Veydrift full canonical state heal failed", error);
      });
  }
  if (isWriter && loaded.config.researchQueueStartedAtRepairRunId && indexer && loaded.problems.length === 0) {
    // Narrow, idempotent projection repair: exact retained ResearchQueued identities supply only
    // missing startedAt values. It cannot change on-chain readiness, research duration, or levels.
    void indexer
      .startResearchQueueStartedAtRepairOnce(loaded.config.researchQueueStartedAtRepairRunId)
      .catch((error) => {
        console.error("Veydrift research queue started-at repair failed", error);
      });
  }
  if (isWriter && loaded.config.missionArchiveRestoreRunId && indexer && loaded.problems.length === 0) {
    // Explicit, idempotent operator repair for the mission archive. It enumerates the complete
    // canonical mission range and only upserts rows, so a partial/candidate repair can never prune
    // unrelated history again.
    void indexer
      .startFleetMissionArchiveRestoreOnce(loaded.config.missionArchiveRestoreRunId)
      .catch((error) => {
        console.error("Veydrift fleet mission archive restore failed", error);
      });
  }
  if (isWriter && loaded.config.resourceStateHealRunId && indexer && loaded.problems.length === 0) {
    // Explicit, idempotent operator repair for indexed planet resources. It executes
    // inside the active writer so an external SQLite process cannot be overwritten by
    // the writer's in-memory/event state.
    void indexer
      .startCanonicalResourceHealOnce(loaded.config.resourceStateHealRunId)
      .catch((error) => {
        console.error("Veydrift canonical resource-state heal failed", error);
      });
  }
  if (isWriter && loaded.config.allianceStateHealRunId && indexer && loaded.problems.length === 0) {
    // Explicit, idempotent operator repair for the indexed alliance directory. This reads the
    // canonical profiles inside the active writer so historical descriptions omitted from the
    // legacy AllianceCreated event are repaired without an external SQLite writer.
    void indexer
      .startAllianceStateHealOnce(loaded.config.allianceStateHealRunId)
      .catch((error) => {
        console.error("Veydrift alliance-state heal failed", error);
      });
  }
  if (isWriter && indexer && typeof indexer.checkpointWal === "function" && loaded.problems.length === 0) {
    const checkpointWal = () => {
      try {
        const result = indexer.checkpointWal("PASSIVE");
        const sample = result[0];
        if (sample && sample.log > 16_384 && sample.busy === 0) {
          indexer.checkpointWal("TRUNCATE");
        }
      } catch (error) {
        console.warn("Veydrift SQLite WAL checkpoint failed", reasonText(error));
      }
    };
    checkpointWal();
    const walMaintenance = setInterval(checkpointWal, 60_000);
    walMaintenance.unref?.();
  }

  const responseCache = new Map<string, CachedJsonResponse>();
  const inflightResponseCache = new Map<string, Promise<CachedJsonResponse | null>>();
  const readRateLimits = new Map<string, { count: number; resetAt: number }>();
  const walletConnectRpcRateLimits = new Map<string, { count: number; resetAt: number }>();
  const galaxySystemCache = new Map<string, GalaxySystemCacheEntry>();
  const enableResponseCache = dependencies.enableResponseCache ?? usesProductionDependencies;
  const logRequests = dependencies.logRequests ?? (
    usesProductionDependencies
  );
  const sharedResponseCache = dependencies.sharedResponseCache !== undefined
    ? dependencies.sharedResponseCache
    : enableResponseCache && loaded.problems.length === 0
      ? sharedResponseCacheForIndex(loaded.config.indexDbPath)
      : null;
  const referralStore = dependencies.referralStore ?? createReferralStore(loaded.config);
  const paidAllianceInviteReader = dependencies.paidAllianceInviteReader
    ?? createPaidAllianceInviteReader(loaded.config);
  const paidAllianceInviteSecretStore = dependencies.paidAllianceInviteSecretStore
    ?? createPaidAllianceInviteSecretStore(loaded.config);
  const paidAllianceInviteRateLimiter = new PaidAllianceInviteRateLimiter();
  // A whole-universe prewarm performs every wallet/planet projection back-to-back. On a busy live
  // index that competes with public reads for SQLite and creates the very latency it is intended to
  // avoid. Keep it opt-in for controlled maintenance windows; active routes warm their shared cache
  // on demand and can serve a prior fleet payload while they refresh.
  const prewarmResponseCache = dependencies.prewarmResponseCache ?? (
    process.env.VEYDRIFT_PREWARM_RESPONSE_CACHE === "true" && isWriter && enableResponseCache
  );

  const routeRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const chainSyncSnapshot = chainSync?.snapshot() ?? null;
      const indexerSnapshot = isWriter ? (indexer?.snapshot() ?? null) : null;
      const missionResolutionSnapshot = missionResolution?.snapshot() ?? null;
      const readiness = backendReadiness(
        loaded.problems,
        chainSyncSnapshot,
        indexerSnapshot,
        missionResolutionSnapshot,
        [
          chainReader?.rpcMetrics?.(),
          logBackfiller?.rpcMetrics?.(),
          paidAllianceInviteReader?.rpcMetrics?.()
        ]
      );
      const randomnessReadiness = currentRandomnessReadiness(
        loaded.config.randomnessCommitmentStorePath,
        Boolean(loaded.config.randomnessEngineAddress && loaded.config.randomnessFulfillerPrivateKey)
      );
      const healthy = readiness.ready && randomnessReadiness.ready;
      return Response.json(
        {
          ok: healthy,
          service: "veydrift-backend",
          configured: loaded.problems.length === 0,
          backend: backendDeploymentMetadata(workerRole),
          chain: safeConfigSummary(loaded.config),
          readiness,
          chainSync: chainSyncSnapshot,
          missionResolution: missionResolutionSnapshot,
          randomnessCommitter: randomnessCommitter?.snapshot() ?? null,
          indexer: indexerSnapshot,
          rpc: chainReader?.rpcMetrics?.() ?? null,
          chainSyncRpc: logBackfiller?.rpcMetrics?.() ?? null,
          paidAllianceRpc: paidAllianceInviteReader?.rpcMetrics?.() ?? null,
          randomnessReadiness
        } satisfies HealthPayload & Record<string, unknown>,
        {
          headers: corsHeaders,
          status: healthy ? 200 : 503
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/randomness-readiness") {
      const readiness = currentRandomnessReadiness(
        loaded.config.randomnessCommitmentStorePath,
        Boolean(loaded.config.randomnessEngineAddress && loaded.config.randomnessFulfillerPrivateKey)
      );
      return Response.json(readiness, {
        headers: {
          ...corsHeaders,
          "cache-control": "no-store"
        },
        status: readiness.ready ? 200 : 503
      });
    }

    if (request.method === "GET" && url.pathname === "/runtime-config") {
      return runtimeConfigResponse(workerRole);
    }

    if (request.method === "POST" && url.pathname === "/walletconnect-rpc") {
      if (!walletConnectRpc) return unavailableResponse(loaded.problems);
      const rateLimited = walletConnectRpcRateLimitResponse(request, walletConnectRpcRateLimits);
      if (rateLimited) return rateLimited;
      return walletConnectRpcResponse(request, walletConnectRpc);
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      // Stats used synchronous whole-index SQLite aggregations here. Even with a
      // response cache, a cold request blocked this single Bun process for
      // seconds and delayed gameplay/wallet/CCA reads. It now runs in the
      // isolated stats service, which precomputes its own snapshot.
      return Response.json({
        error: "Stats moved to https://stats.veydrift.com/api/stats"
      }, {
        headers: {
          ...corsHeaders,
          "cache-control": "no-store"
        },
        status: 410
      });
    }

    if (request.method === "GET" && url.pathname === "/cca") {
      if (!ccaRpc) return unavailableResponse(loaded.problems);
      return ccaStateResponse(ccaRpc, ccaBidOwnerFromQuery(url.searchParams.get("owner")));
    }

    if (request.method === "GET" && url.pathname === "/raid-finder/debris") {
      return indexedDebrisTargetsResponse(indexer, url);
    }
    if (request.method === "GET" && url.pathname === "/raid-finder/rifters") {
      return indexedRiftTargetsResponse(indexer, url);
    }

    if (request.method === "GET" && url.pathname === "/chain/events") {
      if (!chainSync) {
        return unavailableResponse(loaded.problems);
      }

      return new Response(chainSync.eventStream(request.signal), {
        headers: {
          ...corsHeaders,
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }

    if (
      request.method === "GET"
      && url.pathname.match(/^\/entity-media\/(planet|moon|player|alliance)\/[^/]+\/challenge$/)
    ) {
      const parts = url.pathname.split("/");
      const entityKindValue = parts[2] ?? "";
      const rawEntityId = parts[3] ?? "";
      try {
        if (!isEntityMediaKind(entityKindValue)) throw new Error("Unsupported entity media kind.");
        const entityId = normalizeEntityMediaId(entityKindValue, rawEntityId);
        const wallet = url.searchParams.get("wallet");
        if (!wallet) throw new Error("Wallet address is required.");
        assertAddress(wallet);
        if (!indexer) return entityMediaUnavailableResponse();
        return Response.json({
          entityKind: entityKindValue,
          entityId,
          version: indexer.entityMediaVersion(entityKindValue, entityId),
          wallet: wallet.toLowerCase()
        }, {
          headers: {
            ...corsHeaders,
            "cache-control": "no-store"
          }
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (
      (request.method === "GET" || request.method === "POST")
      && url.pathname.match(/^\/entity-media\/(planet|moon|player|alliance)\/[^/]+$/)
    ) {
      const parts = url.pathname.split("/");
      const entityKindValue = parts[2] ?? "";
      const rawEntityId = parts[3] ?? "";
      try {
        if (!isEntityMediaKind(entityKindValue)) throw new Error("Unsupported entity media kind.");
        const entityId = normalizeEntityMediaId(entityKindValue, rawEntityId);
        if (!indexer) return entityMediaUnavailableResponse();

        if (request.method === "GET") {
          return Response.json({
            entityKind: entityKindValue,
            entityId,
            media: indexer.entityMedia(entityKindValue, entityId)
          }, { headers: corsHeaders });
        }

        const body = await readJsonBody(request);
        const wallet = body?.wallet;
        if (typeof wallet !== "string") throw new Error("Wallet address is required.");
        assertAddress(wallet);
        const validation = validateYouTubeMediaUrl(body?.mediaUrl);
        if (!validation.ok) {
          return Response.json({ error: "invalid_youtube_url", message: validation.error }, {
            headers: corsHeaders,
            status: 400
          });
        }
        const requestedVersion = body?.version;
        if (
          typeof requestedVersion !== "number"
          || !Number.isSafeInteger(requestedVersion)
          || requestedVersion < 0
        ) {
          return Response.json({
            error: "invalid_entity_media_version",
            message: "Request a fresh entity-media authorization before saving."
          }, {
            headers: corsHeaders,
            status: 400
          });
        }
        const version = requestedVersion;
        const verified = await verifyEntityMediaSignature({
          entityId,
          entityKind: entityKindValue,
          media: validation.media,
          signature: body?.signature,
          version,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift entity-media message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }
        if (!canManageEntityMedia(indexer, entityKindValue, entityId, wallet)) {
          return Response.json({
            error: "entity_media_forbidden",
            message: "This wallet is not authorized to manage media for that entity."
          }, {
            headers: corsHeaders,
            status: 403
          });
        }

        const update = indexer.setEntityMediaIfCurrent(
          entityKindValue,
          entityId,
          version,
          validation.media
        );
        if (update.status === "stale") {
          return Response.json({
            error: "entity_media_stale_authorization",
            message: "This media authorization has expired or was already used. Try saving again.",
            version: update.version
          }, {
            headers: corsHeaders,
            status: 409
          });
        }

        return Response.json({
          entityKind: entityKindValue,
          entityId,
          media: update.media,
          version: update.version
        }, { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/profile$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return playerProfilesUnavailableResponse();
        return Response.json(indexer.playerProfile(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/profile$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return playerProfilesUnavailableResponse();
        const body = await readJsonBody(request);
        const displayNameValidation = validatePlayerDisplayName(body?.displayName);
        if (!displayNameValidation.ok) {
          return Response.json({ error: "invalid_display_name", message: displayNameValidation.error }, {
            headers: corsHeaders,
            status: 400
          });
        }
        const descriptionValidation = validatePlayerDescription(body?.description);
        if (!descriptionValidation.ok) {
          return Response.json({ error: "invalid_description", message: descriptionValidation.error }, {
            headers: corsHeaders,
            status: 400
          });
        }

        const verified = await verifyPlayerProfileSignature({
          description: descriptionValidation.description,
          displayName: displayNameValidation.displayName,
          signature: body?.signature,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift profile message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }

        return Response.json(indexer.upsertPlayerProfile(wallet, displayNameValidation.displayName, descriptionValidation.description), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/profile\/display-name$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return playerProfilesUnavailableResponse();
        const body = await readJsonBody(request);
        const validation = validatePlayerDisplayName(body?.displayName);
        if (!validation.ok) {
          return Response.json({ error: "invalid_display_name", message: validation.error }, {
            headers: corsHeaders,
            status: 400
          });
        }

        const verified = await verifyPlayerDisplayNameSignature({
          displayName: validation.displayName,
          signature: body?.signature,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift display-name message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }

        return Response.json(indexer.upsertPlayerDisplayName(wallet, validation.displayName), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/overview$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = await indexedWalletOverviewWarmResponse(
          indexer,
          wallet,
          selectedPlanetId(url),
          chainReader
        );
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("overview snapshot", indexer, indexedReadLookup(url, wallet));
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = indexedWalletSettlementWarmResponse(indexer, wallet);
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("wallet settlement", indexer, indexedReadLookup(url, wallet));
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement-funding$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        return indexedSettlementFundingResponse(indexer, loaded.config, wallet);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/referrals$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return indexedReadNotReadyResponse("referral dashboard", indexer, { wallet });
        const startPriceWei = indexer.currentStartPriceWei();
        return Response.json(referralStore.dashboard(
          wallet,
          indexer,
          startPriceWei,
          referralConfigurationReady(loaded.config, startPriceWei)
        ), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/referrals\/history$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return indexedReadNotReadyResponse("referral history", indexer, { wallet });
        const history = referralStore.history(
          wallet,
          indexer,
          positiveIntegerQuery(url, "page", 1, 1_000_000),
          positiveIntegerQuery(url, "pageSize", 25, 100)
        );
        return Response.json(rankedReferralHistory(history, indexer), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/referrals\/claim-intent$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const body = await readJsonBody(request);
        const commitment = String(body?.commitment ?? "");
        if (!await verifyReferralWalletSignature({
          action: "claim-transaction",
          commitment,
          signature: body?.signature,
          wallet
        })) {
          return invalidReferralSignatureResponse();
        }
        if (!indexer) return indexedReadNotReadyResponse("referral code availability", indexer, { wallet });
        const code = normalizeReferralCode(body?.code);
        const expectedCommitment = referralCommitment(code, wallet);
        if (expectedCommitment.toLowerCase() !== commitment.toLowerCase()) {
          throw new Error("Referral code does not match the inviter-bound commitment.");
        }
        const resolution = resolveReferralCode({
          code,
          index: indexer,
          wallet,
          startPriceWei: indexer.currentStartPriceWei()
        });
        if (resolution.ownership === "reserved") {
          return referralResolveErrorResponse({ ...resolution, valid: false });
        }
        return Response.json({
          code,
          commitment: expectedCommitment,
          persisted: false,
          source: "chain"
        }, {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/referrals\/claim-transaction$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const body = await readJsonBody(request);
        const commitment = String(body?.commitment ?? "");
        const txHash = String(body?.txHash ?? "");
        if (!/^0x[a-fA-F0-9]{64}$/.test(commitment)) {
          throw new Error("commitment must be a 0x-prefixed 32-byte hex value.");
        }
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          throw new Error("txHash must be a 0x-prefixed 32-byte transaction hash.");
        }
        if (!await verifyReferralWalletSignature({
          action: "claim-transaction",
          commitment,
          signature: body?.signature,
          wallet
        })) {
          return invalidReferralSignatureResponse();
        }
        if (!indexer) return indexedReadNotReadyResponse("referral claim", indexer, { wallet });
        const claim = indexer.referralClaim(wallet, commitment as `0x${string}`, txHash as `0x${string}`);
        if (!claim) {
          return Response.json({
            error: "referral_claim_unconfirmed",
            message: "Referral claim transaction is not indexed for this wallet and commitment yet."
          }, {
            headers: corsHeaders,
            status: 409
          });
        }
        const startPriceWei = indexer.currentStartPriceWei();
        return Response.json(referralStore.dashboard(
          wallet,
          indexer,
          startPriceWei,
          referralConfigurationReady(loaded.config, startPriceWei)
        ), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/referrals/resolve") {
      try {
        if (!indexer) return indexedReadNotReadyResponse("referral validation", indexer, {});
        const invitee = url.searchParams.get("invitee") ?? undefined;
        const wallet = url.searchParams.get("wallet") ?? undefined;
        if (invitee) assertAddress(invitee);
        if (wallet) assertAddress(wallet);
        return Response.json(resolveReferralCode({
          code: url.searchParams.get("code"),
          index: indexer,
          ...(invitee ? { invitee } : {}),
          ...(wallet ? { wallet } : {}),
          startPriceWei: indexer.currentStartPriceWei()
        }), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/alliance-invites/resolve") {
      try {
        if (!paidAllianceInviteReader) {
          return Response.json({ error: "paid_alliance_invites_unavailable" }, { headers: corsHeaders, status: 503 });
        }
        const body = await readJsonBody(request);
        const secret = body?.secret;
        const commitment = paidAllianceInviteCommitment(secret);
        const state = await paidAllianceInviteReader.invite(commitment);
        return Response.json(resolvePaidAllianceInvite(secret, state), { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/alliance-invites/redeem") {
      try {
        const remote = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        if (!paidAllianceInviteRateLimiter.consume(remote)) {
          return Response.json({ error: "paid_alliance_invite_rate_limited" }, { headers: corsHeaders, status: 429 });
        }
        if (!paidAllianceInviteReader) {
          return Response.json({ error: "paid_alliance_invites_unavailable" }, { headers: corsHeaders, status: 503 });
        }
        const body = await readJsonBody(request);
        const invitee = String(body?.invitee ?? "");
        assertAddress(invitee);
        const commitment = paidAllianceInviteCommitment(body?.secret);
        const state = await paidAllianceInviteReader.invite(commitment);
        return Response.json(
          await buildPaidAllianceInviteAuthorization(
            loaded.config,
            body?.secret,
            invitee as ViemAddress,
            state,
          ),
          { headers: corsHeaders },
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/alliance-invites/store") {
      try {
        if (!paidAllianceInviteReader || !paidAllianceInviteSecretStore) {
          return Response.json({ error: "paid_alliance_invite_recovery_unavailable" }, { headers: corsHeaders, status: 503 });
        }
        const body = await readJsonBody(request);
        const purchaser = String(body?.purchaser ?? "");
        assertAddress(purchaser);
        const commitment = paidAllianceInviteCommitment(body?.secret);
        const state = await paidAllianceInviteReader.invite(commitment);
        const resolution = resolvePaidAllianceInvite(body?.secret, state);
        if (!resolution.valid) throw new Error(`Alliance invite is ${resolution.status}.`);
        await paidAllianceInviteSecretStore.store(body?.secret, purchaser, body?.signature, state);
        return Response.json({ commitment, stored: true }, { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/alliance-invites/recover") {
      try {
        if (!paidAllianceInviteReader || !paidAllianceInviteSecretStore) {
          return Response.json({ error: "paid_alliance_invite_recovery_unavailable" }, { headers: corsHeaders, status: 503 });
        }
        const body = await readJsonBody(request);
        const viewer = String(body?.viewer ?? "");
        assertAddress(viewer);
        const recovered = await paidAllianceInviteSecretStore.recoverForViewer(
          viewer,
          body?.signature,
          async (commitment) => {
            const state = await paidAllianceInviteReader.invite(commitment);
            return paidAllianceInviteReader.canRecoverAllianceInvites(
              viewer as ViemAddress,
              state.allianceId,
            );
          },
        );
        const invites = [];
        for (const record of recovered) {
          const state = await paidAllianceInviteReader.invite(record.commitment);
          const resolution = resolvePaidAllianceInvite(record.secret, state);
          if (resolution.valid) invites.push({ ...resolution, secret: record.secret });
        }
        return Response.json({ invites }, { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/referrals/redeem") {
      try {
        const body = await readJsonBody(request);
        const invitee = String(body?.invitee ?? "");
        assertAddress(invitee);
        const startPriceWei = indexer?.currentStartPriceWei() ?? null;
        if (!referralConfigurationReady(loaded.config, startPriceWei)) {
          return Response.json({
            error: "referral_configuration_incomplete",
            message: "Referral signer, game, referral contract, and indexed current settlement price must be available together."
          }, {
            headers: corsHeaders,
            status: 503
          });
        }
        if (!indexer) return indexedReadNotReadyResponse("referral redemption", indexer, { invitee });
        const resolution = resolveReferralCode({
          code: body?.code,
          index: indexer,
          invitee,
          startPriceWei
        });
        if (!resolution.valid || !resolution.commitment || !resolution.codeHash) {
          return referralResolveErrorResponse(resolution);
        }
        const claim = indexer.referralClaimsByCodeHash(resolution.codeHash)
          .filter((candidate) => candidate.commitment.toLowerCase() === resolution.commitment?.toLowerCase())
          .at(-1);
        if (!claim) return referralResolveErrorResponse({ ...resolution, valid: false, status: "invalid" });
        return Response.json(await buildReferralRedemption(loaded.config, referralInviteRecord(claim), invitee), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/referrals/redeem-transaction") {
      try {
        const body = await readJsonBody(request);
        const invitee = String(body?.invitee ?? "");
        const txHash = String(body?.txHash ?? "");
        assertAddress(invitee);
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          throw new Error("txHash must be a 0x-prefixed 32-byte transaction hash.");
        }
        if (!indexer) return indexedReadNotReadyResponse("referral redemption", indexer, { invitee });
        const code = normalizeReferralCode(body?.code);
        const claims = indexer.referralClaimsByCodeHash(referralCodeHash(code));
        const claim = claims.at(-1);
        if (!claim) {
          return Response.json({
            error: "referral_code_not_found",
            message: "Referral code was not found."
          }, {
            headers: corsHeaders,
            status: 404
          });
        }
        const redemption = indexer.referralRedemption(
          claim.inviter,
          invitee,
          claim.commitment,
          txHash as `0x${string}`
        );
        if (!redemption) {
          return Response.json({
            error: "referral_redemption_unconfirmed",
            message: "Referral redemption transaction is not indexed for this invitee and commitment yet."
          }, {
            headers: corsHeaders,
            status: 409
          });
        }
        return Response.json({ redemption }, {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/planets$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = indexedWalletPlanetsWarmResponse(indexer, wallet);
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("wallet planets", indexer, indexedReadLookup(url, wallet));
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/watched-planets$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer || !hasWarmPlanetIndex(indexer)) return indexedReadNotReadyResponse("watched planets", indexer, indexedReadLookup(url, wallet));
        return indexedJsonResponse(
          watchedPlanetsResponse(indexer, wallet, url, loaded.config),
          indexer.snapshot()
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/watched-planets$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer || !hasWarmPlanetIndex(indexer)) return indexedReadNotReadyResponse("watched planets", indexer, indexedReadLookup(url, wallet));
        const body = await readJsonBody(request);
        const planetId = validBodyPlanetId(body?.planetId);
        const verified = await verifyWatchedPlanetSignature({
          action: "watch",
          planetId,
          signature: body?.signature,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift watched-planet message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }
        const planet = indexer.planet(planetId);
        if (!planet) return errorResponse(new Error("Watched planet does not exist in indexed state."), 404);
        if (planet.owner.toLowerCase() === wallet.toLowerCase()) {
          return errorResponse(new Error("Own planets cannot be added to the watchlist."), 400);
        }
        const result = indexer.watchPlanet(wallet, planetId);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "DELETE" && url.pathname.match(/^\/wallet\/[^/]+\/watched-planets\/[0-9]+$/)) {
      const parts = url.pathname.split("/");
      const wallet = decodeURIComponent(parts[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer || !hasWarmPlanetIndex(indexer)) return indexedReadNotReadyResponse("watched planets", indexer, indexedReadLookup(url, wallet));
        const planetId = validBodyPlanetId(parts[4]);
        const body = await readJsonBody(request);
        const verified = await verifyWatchedPlanetSignature({
          action: "unwatch",
          planetId,
          signature: body?.signature,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift watched-planet message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }
        const result = indexer.unwatchPlanet(wallet, planetId);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/activity$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return indexedReadNotReadyResponse("player activity", indexer, { wallet });
        const page = positiveIntegerQuery(url, "page", 1, 1_000_000);
        const pageSize = positiveIntegerQuery(url, "pageSize", 25, 100);
        const sinceValue = url.searchParams.get("since");
        if (sinceValue !== null && !/^\d+$/.test(sinceValue)) {
          throw new Error("since must be a Unix timestamp in whole seconds.");
        }
        const activity = indexer.playerActivity(wallet, {
          page,
          pageSize,
          ...(sinceValue === null ? {} : { since: Number(sinceValue) }),
          includeProjected: url.searchParams.get("includeProjected") === "true"
        });
        const totalPages = Math.max(1, Math.ceil(activity.totalEntries / pageSize));
        return indexedJsonResponse({
          wallet,
          items: activity.items,
          summary: activity.summary,
          through: activity.through,
          pagination: {
            page,
            pageSize,
            totalEntries: activity.totalEntries,
            totalPages,
            hasPreviousPage: page > 1,
            hasNextPage: page < totalPages
          }
        }, indexer.snapshot());
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/activity\/presence$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return indexedReadNotReadyResponse("player activity", indexer, { wallet });
        return Response.json({
          wallet,
          ...indexer.recordPlayerActivityPresence(wallet)
        }, {
          headers: {
            ...corsHeaders,
            "cache-control": "no-store"
          }
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/queues$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "player queues", indexedPlayerQueues);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) {
      try {
        const includeArchive = url.searchParams.get("archive") === "full" || url.searchParams.get("archive") === "true";
        return indexedWalletStateResponse(url, indexer, "fleet visibility", (wallet, settlement, planet, detail, indexer) =>
          indexedFleetVisibility(wallet, settlement, planet, detail, indexer, { includeArchive }), {
          includeSelectedPlanet: false
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/missions$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "mission archive", (wallet, _settlement, _planet, _detail, indexer) =>
          indexedMissionArchive(wallet, url, indexer), {
          includeSelectedPlanet: false
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/missile-attacks$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "missile strike archive", (wallet, _settlement, _planet, _detail, indexer) =>
          indexedMissileAttackArchive(wallet, url, indexer), {
          includeSelectedPlanet: false
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/missions") {
      try {
        if (!indexer) return indexedReadNotReadyResponse("missions", indexer, { status: url.searchParams.get("status") ?? "active" });
        const snapshot = indexer.snapshot();
        const status = url.searchParams.get("status") ?? "active";
        if (status === "active") {
          return Response.json(
            { missions: indexer.allActiveFleetMissions() } satisfies GlobalActiveMissionsResponse,
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
          );
        }
        if (status === "completed") {
          return Response.json(
            globalMissionArchive(url, indexer),
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
          );
        }
        return errorResponse(new Error(`Unsupported missions status: ${status}`), 400);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/mission\/[^/]+$/)) {
      const missionId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        parseMissionId(missionId);
        if (!indexer) return indexedReadNotReadyResponse("mission", indexer, { missionId });
        const snapshot = indexer.snapshot();
        const mission = indexer.fleetMission(missionId);
        if (!mission) {
          return Response.json(
            {
              error: "mission_not_found",
              detail: "That mission is not available in the indexed mission read model.",
              source: indexedSource
            },
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
          );
        }
        const expectsReport = expectsBattleReport(mission);
        // A joined ACS fleet never emits its own battle report — the resolved combat is keyed to the
        // main attack mission. When this mission has no report of its own but belongs to an attack
        // group, fall back to the group's report so a joiner's mission detail still shows the shared
        // outcome and the per-participant loot split (VEY-KANEO-432). Non-report missions skip this
        // entirely so a cold Transport/DefenseHold detail cannot warm the battle-report read model.
        const battleReportMaterialization = expectsReport
          ? battleReportMaterializationStatusForMission(indexer, mission)
          : { status: "missing" as const };
        const battleReport = expectsReport
          ? (
            indexer.battleReport(missionId, { includeRawFallback: false })
            ?? (mission.attackGroupId ? indexer.battleReport(mission.attackGroupId, { includeRawFallback: false }) : null)
          )
          : null;
        const reportedBattleReportMaterialization = battleReport
          ? { status: "ready" as const }
          : battleReportMaterialization.status === "ready"
            ? {
                status: "failed" as const,
                attempts: battleReportMaterialization.attempts,
                durationMs: battleReportMaterialization.durationMs,
                error: battleReportMaterialization.error ?? "Persisted battle report read model did not match this mission.",
                updatedAt: battleReportMaterialization.updatedAt
              }
            : battleReportMaterialization;
        return Response.json(
          {
            mission,
            battleReport,
            battleReportMaterialization: reportedBattleReportMaterialization,
            targetCombatIntel: targetCombatIntelForMission(indexer, mission),
            // Current target state remains useful alongside the persisted battle-time snapshot and
            // loss breakdown. Historical loss rendering never infers destroyed/restored counts from
            // this mutable projection.
            defenderPlanetState: defenderPlanetStateForReport(
              indexer,
              battleReport,
              battleReport ? indexer.fleetMission(battleReport.missionId) : mission
            ),
            source: indexedSource
          },
          { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/battle-report\/[^/]+$/)) {
      const missionId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        parseMissionId(missionId);
        if (!indexer) return indexedReadNotReadyResponse("battle report", indexer, { missionId });
        const snapshot = indexer.snapshot();
        const mission = indexer.fleetMission(missionId);
        const materialization = mission ? battleReportMaterializationStatusForMission(indexer, mission) : indexer.battleReportMaterializationStatus(missionId);
        if (materialization.status === "pending" || materialization.status === "failed") {
          return Response.json(
            {
              error: materialization.status === "pending" ? "battle_report_processing" : "battle_report_materialization_failed",
              detail: materialization.status === "pending"
                ? "Battle report materialization is still processing. Retry shortly; this endpoint will not block on report construction."
                : "Battle report materialization failed and will be retried when report logs are indexed or replayed.",
              materialization,
              source: indexedSource
            },
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: materialization.status === "pending" ? 202 : 503 }
          );
        }
        const report = indexer.battleReport(missionId, { includeRawFallback: false });
        if (report) {
          return Response.json(report, {
            headers: indexedStateHeaders(indexedStateLabel(snapshot))
          });
        }
        if (mission && !expectsBattleReport(mission)) {
          return Response.json(
            {
              error: "battle_report_not_expected",
              detail: "No battle report exists because this combat mission did not reach battle resolution.",
              mission,
              source: indexedSource
            },
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
          );
        }
        return Response.json(
          {
            error: "battle_report_not_indexed",
            detail: "Battle reports are not available until the indexed battle report read model catches up.",
            source: indexedSource
          },
          { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/battle-reports") {
      try {
        if (!indexer) return indexedReadNotReadyResponse("battle reports", indexer);
        const snapshot = indexer.snapshot();
        const requested = missionArchivePagination(url);
        const offset = (requested.page - 1) * requested.pageSize;
        const reports = indexer.battleReports(offset + requested.pageSize).slice(offset, offset + requested.pageSize);
        return Response.json(reports, {
          headers: indexedStateHeaders(indexedStateLabel(snapshot))
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/infrastructure$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "infrastructure", indexedInfrastructureState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/moon$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const readStartedAt = Date.now();
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        const indexed = indexedWarmResponse(indexer, wallet, planetId, "moon", indexedMoonState);
        if (indexed) {
          return moonTimedResponse(indexed, readStartedAt);
        }
        return moonTimedResponse(indexedMoonNotReadyResponse(indexer, wallet, planetId), readStartedAt);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/shipyard$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "shipyard", indexedShipyardState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/defenses$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "defenses", indexedDefenseState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/research$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "research", indexedResearchState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/alliance$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        return indexedAllianceResponse(
          wallet,
          indexer,
          loaded.config.paidAllianceInviteAddress,
          loaded.config.paidAllianceInviteIndexFromBlock
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/alliance\/[0-9]+$/)) {
      const allianceId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        if (!indexer) return indexedReadNotReadyResponse("alliance", indexer, { allianceId });
        if (
          loaded.config.paidAllianceInviteAddress
          && loaded.config.paidAllianceInviteIndexFromBlock !== undefined
          && indexer.paidAllianceInviteHistoryBackfillStatus(
            loaded.config.paidAllianceInviteAddress,
            loaded.config.paidAllianceInviteIndexFromBlock
          ).required
        ) {
          return indexedReadNotReadyResponse("paid alliance history", indexer, { allianceId });
        }
        const snapshot = indexer.snapshot();
        const alliance = indexer.allianceProfile(allianceId);
        if (!alliance) {
          return Response.json(
            {
              error: "alliance_not_found",
              detail: "That alliance is not available in the indexed alliance directory.",
              source: indexedSource
            },
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
          );
        }
        const paidInviteSummary = loaded.config.paidAllianceInviteAddress
          ? indexer.paidAllianceInviteSummaries().get(allianceId) ?? emptyPaidAllianceInviteSummary()
          : null;
        return Response.json(
          {
            alliance: {
              ...alliance,
              bonusBalance: paidInviteSummary?.bonusBalance ?? null,
              privateInviteStats: paidInviteSummary?.privateInviteStats ?? null,
            },
            source: indexedSource
          },
          { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/rift$/)) {
      try {
        return indexedWalletStateResponse(url, indexer, "rift", (
          wallet, settlement, planet, unavailableReason, currentIndexer
        ) => indexedRiftState(
          wallet,
          settlement,
          planet,
          unavailableReason,
          currentIndexer,
          loaded.config.resourceTokenAddresses
        ));
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/attack-protection$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const targetPlanetId = positiveBigIntQuery(url, "targetPlanetId");
        return indexedAttackProtectionResponse(indexer, wallet, targetPlanetId);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/highscore$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");

      try {
        assertAddress(wallet);
        if (hasWarmPlanetIndex(indexer)) {
          const indexedPlanets = indexer.settledPlanetsByOwner().get(wallet.toLowerCase()) ?? [];
          return Response.json(
            {
              formula: highscoreFormula,
              entry: indexer.highscoreForWallet(wallet, indexedPlanets.map((planet) => planet.planetId)),
              source: indexedSource
            },
            {
              headers: corsHeaders
            }
          );
        }
        return indexedReadNotReadyResponse("wallet highscore", indexer, { wallet });
      } catch (error) {
        return highscoreFailureResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/highscores") {
      const startedAt = Date.now();
      try {
        const pagination = highscorePagination(url);
        let planetsByOwner: Map<string, SettledPlanetEvent[]>;
        let entries: HighscoreEntry[];
        const source = "contract-state-indexer";

        if (indexer) {
          const indexNotReady = highscoreIndexNotReadyResponse(indexer, startedAt);
          if (indexNotReady) return indexNotReady;
          // Memoized against the indexer state version: the full leaderboard is recomputed only
          // when integrated events change state, not on every request (VEY-KANEO-467).
          const leaderboard = indexer.highscoreLeaderboard();
          planetsByOwner = leaderboard.planetsByOwner;
          entries = leaderboard.entries;
        } else {
          return indexedReadNotReadyResponse("highscores", indexer, {
            page: url.searchParams.get("page"),
            pageSize: url.searchParams.get("pageSize")
          });
        }

        const totalEntries = entries.length;
        const totalPages = Math.max(1, Math.ceil(totalEntries / pagination.pageSize));
        const page = Math.min(pagination.page, totalPages);
        const offset = (page - 1) * pagination.pageSize;
        const requestedCategories = highscoreRequestedCategories(url);
        const sortedRankings = sortedHighscoreRankings(entries, requestedCategories);
        const visibleEntries = highscoreVisibleEntries(sortedRankings, requestedCategories, pagination.pageSize, offset);
        const rankingWallets = highscoreRankingWallets(visibleEntries, url.searchParams.get("currentWallet"));
        const profiles = indexer?.playerProfiles(rankingWallets) ?? new Map<string, PlayerProfile>();
        const allianceIntel = allianceIntelForPlayers(rankingWallets, indexer);
        const rankedRows = highscoreRows(
          visibleEntries,
          planetsByOwner,
          profiles,
          allianceIntel,
          indexer
        );
        const rankings = highscoreRankings(
          sortedRankings,
          requestedCategories,
          pagination.pageSize,
          offset,
          rankedRows
        );
        const protection = rankedHighscoreIndexedProtectionLookup(
          highscoreRankingRows(rankings),
          entries,
          allianceIntel,
          url.searchParams.get("currentWallet"),
          highscoreAttackProtectionRequested(url),
          indexer
        );
        const protectedRankings = highscoreRankingsWithProtection(rankings, protection);
        const currentPlayer = highscoreCurrentPlayerPages(sortedRankings, requestedCategories, pagination.pageSize, url.searchParams.get("currentWallet"));

        return Response.json(
          {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            formula: highscoreFormula,
            pagination: {
              page,
              pageSize: pagination.pageSize,
              totalEntries,
              totalPages,
              hasPreviousPage: page > 1,
              hasNextPage: page < totalPages
            },
            currentPlayer,
            rankings: protectedRankings,
            source
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return highscoreFailureResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/planets\/[0-9]+$/)) {
      const planetId = BigInt(url.pathname.split("/")[2] ?? "0");
        if (indexer && hasWarmPlanetIndex(indexer)) {
        const planet = indexedCurrentPlanetState(indexer, indexer.planet(planetId.toString()), { allowPendingResources: true });
        return Response.json(planet, {
          headers: corsHeaders
        });
      }
      return indexedReadNotReadyResponse("planet detail", indexer, { planetId: planetId.toString() });
    }

    if (request.method === "GET" && url.pathname.match(/^\/universe\/galaxies\/[0-9]+\/systems\/[0-9]+$/)) {
      const parts = url.pathname.split("/");
      const galaxy = Number.parseInt(parts[3] ?? "", 10);
      const system = Number.parseInt(parts[5] ?? "", 10);
      const detail = galaxySystemDetail(url);
      let payload;
      try {
        payload = cachedGalaxySystemPayload(
          galaxySystemCache,
          {
            chainId: loaded.config.chainId,
            settlementContractAddress: universeContractAddress(loaded.config),
            detail,
            galaxy,
            system,
            indexer
          }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }

      return Response.json(payload, {
        headers: corsHeaders
      });
    }

    if (request.method === "GET" && url.pathname === "/universe/systems") {
      const galaxy = Number.parseInt(url.searchParams.get("galaxy") ?? "1", 10);
      const center = Number.parseInt(url.searchParams.get("center") ?? "1", 10);
      const radius = Math.min(Number.parseInt(url.searchParams.get("radius") ?? "1", 10), 10);
      const from = Math.max(center - radius, 1);
      const to = Math.min(center + radius, 499);

      try {
        return Response.json(
          {
            galaxy,
            center,
            radius,
            systems: Array.from({ length: to - from + 1 }, (_, index) => {
              const system = from + index;
              return cachedGalaxySystemPayload(
                galaxySystemCache,
                {
                  chainId: loaded.config.chainId,
                  settlementContractAddress: universeContractAddress(loaded.config),
                  detail: galaxySystemDetail(url),
                  galaxy,
                  system,
                  indexer
                }
              );
            })
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/universe/system") {
      return handleUniverseSystemRequest(url);
    }

    // The POST /index/rebuild and POST /index/verify/:planetId?heal=true routes have been REMOVED.
    // Both issued on-demand RPC reads from an HTTP request (rebuild re-read the whole universe; verify
    // re-read + healed a single planet). Under the canonical-mirror contract NO request handler may
    // trigger an RPC call: the indexed DB is reconciled from the contracts exactly once at startup and
    // mutated thereafter only by the websocket event listener. The HTTP API serves purely from the DB.

    if (request.method === "POST" && url.pathname === "/graphql") {
      return handleGraphQLRequest(request, workerRole);
    }

    if (request.method === "GET" && url.pathname === "/graphql") {
      return Response.json(
        {
          data: {
            service: {
              name: "Veydrift",
              status: loaded.problems.length === 0 ? "ready" : "configuration-required",
              runtime: getRuntimeConfig(workerRole)
            }
          }
        },
        {
          headers: corsHeaders
        }
      );
    }

    return Response.json(
      {
        error: "not_found"
      },
      {
        headers: corsHeaders,
        status: 404
      }
    );
  };

  const serveWithResponseCache = async (request: Request): Promise<Response> => {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, statusText: "Client Closed Request" });
    }

    let removeAbortListener: (() => void) | undefined;
    const aborted = new Promise<Response>((resolve) => {
      const onAbort = () => {
        resolve(new Response(null, { status: 499, statusText: "Client Closed Request" }));
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => request.signal.removeEventListener("abort", onAbort);
    });
    const serve = async (): Promise<Response> => {
      const url = new URL(request.url);
      if (isBootstrapReadPath(url.pathname)) {
        return withRequestCors(request, await routeRequest(request));
      }

      const cacheTtlMs = enableResponseCache ? cacheableJsonRequestTtlMs(request, url) : 0;
      if (cacheTtlMs > 0) {
        const cacheKey = cacheableJsonRequestKey(request, url, indexer, loaded.config);
        const staleCacheKey = cacheableJsonRequestStaleKey(request, url, cacheKey);
        const cached = responseCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          return withRequestCors(request, cachedJsonResponse(request, cached));
        }
        const sharedCached = sharedResponseCache?.get(cacheKey, now);
        if (sharedCached) {
          responseCache.set(cacheKey, sharedCached);
          return withRequestCors(request, cachedJsonResponse(request, sharedCached));
        }
        if (cached && cached.expiresAt + staleCachedJsonWindowMs > now) {
          if (!inflightResponseCache.has(cacheKey)) {
            let resolveRefresh: (cached: CachedJsonResponse | null) => void;
            const refresh = new Promise<CachedJsonResponse | null>((resolve) => {
              resolveRefresh = resolve;
            });
            inflightResponseCache.set(cacheKey, refresh);
            void refreshCachedJsonResponse(request, url, routeRequest, responseCache, sharedResponseCache, cacheKey, cacheTtlMs, staleCacheKey)
              .then((refreshed) => resolveRefresh!(refreshed.cached))
              .catch(() => resolveRefresh!(null))
              .finally(() => {
                inflightResponseCache.delete(cacheKey);
              });
          }
          return withRequestCors(request, cachedJsonResponse(request, cached));
        }
        const sharedCache = sharedResponseCache;
        const sharedStale = sharedCache?.get(cacheKey, now, true);
        if (sharedCache && sharedStale) {
          responseCache.set(cacheKey, sharedStale);
          if (sharedCache.tryAcquireRefresh(cacheKey)) {
            void refreshCachedJsonResponse(request, url, routeRequest, responseCache, sharedCache, cacheKey, cacheTtlMs, staleCacheKey)
              .catch(() => null)
              .finally(() => sharedCache.releaseRefresh(cacheKey));
          }
          return withRequestCors(request, cachedJsonResponse(request, sharedStale));
        }
        const sharedVersionlessStale = staleCacheKey !== cacheKey
          ? sharedCache?.get(staleCacheKey, now, true)
          : null;
        if (sharedCache && sharedVersionlessStale) {
          responseCache.set(cacheKey, sharedVersionlessStale);
          if (sharedCache.tryAcquireRefresh(cacheKey)) {
            void refreshCachedJsonResponse(request, url, routeRequest, responseCache, sharedCache, cacheKey, cacheTtlMs, staleCacheKey)
              .catch(() => null)
              .finally(() => sharedCache.releaseRefresh(cacheKey));
          }
          return withRequestCors(request, cachedJsonResponse(request, sharedVersionlessStale));
        }

        const inflight = inflightResponseCache.get(cacheKey);
        if (inflight) {
          const refreshed = await inflight;
          if (refreshed) {
            return withRequestCors(request, cachedJsonResponse(request, refreshed));
          }
        }

        const rateLimited = readRateLimitResponse(request, url, readRateLimits);
        if (rateLimited) return withRequestCors(request, rateLimited);

        const ownsSharedRefresh = sharedResponseCache?.tryAcquireRefresh(cacheKey) ?? false;
        if (sharedResponseCache && !ownsSharedRefresh) {
          const refreshed = sharedResponseCache.get(cacheKey);
          if (refreshed) {
            responseCache.set(cacheKey, refreshed);
            return withRequestCors(request, cachedJsonResponse(request, refreshed));
          }

          // A different reader is already building this exact cache key. Previously every
          // concurrent cold read carried on and rebuilt the same indexed response, which
          // turned a single ~600ms wallet/mission read into a multi-worker CPU stampede.
          // Wait briefly for that owner before falling back; the bounded timeout still lets
          // this request recover if the other worker dies while holding its SQLite lock. The hot
          // projections are bounded below this window; a one-second wait made a stale abandoned
          // lock itself a visible backend timeout on mobile navigation.
          const refreshedByPeer = await sharedResponseCache.waitForFresh(
            cacheKey,
            sharedColdReadWaitMsFor(url)
          );
          if (refreshedByPeer) {
            responseCache.set(cacheKey, refreshedByPeer);
            return withRequestCors(request, cachedJsonResponse(request, refreshedByPeer));
          }
        }

        let resolveInflight: (cached: CachedJsonResponse | null) => void;
        inflightResponseCache.set(cacheKey, new Promise((resolve) => {
          resolveInflight = resolve;
        }));

        try {
          const refreshed = await refreshCachedJsonResponse(request, url, routeRequest, responseCache, sharedResponseCache, cacheKey, cacheTtlMs, staleCacheKey);
          if (refreshed.cached) {
            resolveInflight!(refreshed.cached);
            inflightResponseCache.delete(cacheKey);
            return withRequestCors(request, cachedJsonResponse(request, refreshed.cached));
          }
          resolveInflight!(null);
          inflightResponseCache.delete(cacheKey);
          return withRequestCors(request, refreshed.response);
        } finally {
          if (ownsSharedRefresh) sharedResponseCache?.releaseRefresh(cacheKey);
        }
      }

      const rateLimited = readRateLimitResponse(request, url, readRateLimits);
      if (rateLimited) return withRequestCors(request, rateLimited);
      const response = await routeRequest(request);
      if (request.method === "GET" && jsonContentType(response.headers.get("content-type"))) {
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        return withRequestCors(request, new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText
        }));
      }
      return withRequestCors(request, response);
    };

    try {
      return await Promise.race([serve(), aborted]);
    } catch (error) {
      return withRequestCors(request, errorResponse(error, isSqliteBusyError(error) ? 503 : 500));
    } finally {
      removeAbortListener?.();
    }
  };

  prewarmHotResponseCache(serveWithResponseCache, indexer, prewarmResponseCache, prewarmStartDelayMs());
  return logRequests ? requestLoggingHandler(serveWithResponseCache, workerRole) : serveWithResponseCache;
}

/**
 * Build the HTTP-poll log source the chain-sync ingester depends on. Returns undefined unless the
 * reader can both resolve the chain head (eth_blockNumber) and list raw contract logs; the production
 * reader (VeydriftGameReader) exposes both, so polling is wired by default. Exported so a test can
 * assert production construction enables ingestion and the wiring can't silently regress to a no-op.
 */
export function deriveLogBackfiller(
  reader: ChainReader | undefined
):
  | {
      failoverRpc?: (reason: string) => boolean;
      getHeadBlock: () => Promise<bigint>;
      listContractLogs: (fromBlock: bigint, toBlock?: bigint | "latest") => Promise<RpcLog[]>;
      listReferralLogs?: (fromBlock: bigint, toBlock?: bigint | "latest") => Promise<RpcLog[]>;
      listPaidAllianceInviteLogs?: (fromBlock: bigint, toBlock?: bigint | "latest") => Promise<RpcLog[]>;
      rpcMetrics?: () => unknown;
    }
  | undefined {
  if (
    reader &&
    typeof reader.listContractLogs === "function" &&
    typeof reader.getBlockNumber === "function"
  ) {
    return {
      ...(typeof reader.failoverRpc === "function" ? { failoverRpc: reader.failoverRpc.bind(reader) } : {}),
      getHeadBlock: reader.getBlockNumber.bind(reader),
      listContractLogs: reader.listContractLogs.bind(reader),
      ...(typeof reader.listReferralLogs === "function"
        ? { listReferralLogs: reader.listReferralLogs.bind(reader) }
        : {}),
      ...(typeof reader.listPaidAllianceInviteLogs === "function"
        ? { listPaidAllianceInviteLogs: reader.listPaidAllianceInviteLogs.bind(reader) }
        : {}),
      ...(typeof reader.rpcMetrics === "function" ? { rpcMetrics: reader.rpcMetrics.bind(reader) } : {})
    };
  }
  return undefined;
}

export function createViemLiveLogSubscriber(config: BackendConfig): LiveLogSubscriber | undefined {
  if (!config.wsRpcUrl) return undefined;

  const client = createPublicClient({
    transport: webSocket(config.wsRpcUrl, {
      keepAlive: true,
      reconnect: true,
      retryCount: 10,
      timeout: 10_000
    })
  });
  const blockTimestampCache = new Map<string, Promise<string | undefined>>();

  const timestampForBlock = (blockNumber: bigint): Promise<string | undefined> => {
    const key = blockNumber.toString();
    let cached = blockTimestampCache.get(key);
    if (!cached) {
      cached = client
        .getBlock({ blockNumber })
        .then((block) => block.timestamp.toString())
        .catch((error) => {
          console.warn("Veydrift viem websocket block timestamp lookup failed", error);
          return undefined;
        });
      blockTimestampCache.set(key, cached);
      if (blockTimestampCache.size > 256) {
        const oldest = blockTimestampCache.keys().next().value;
        if (oldest) blockTimestampCache.delete(oldest);
      }
    }
    return cached;
  };

  return {
    subscribe({ addresses, onError, onLogs }) {
      return client.watchEvent({
        address: addresses,
        batch: false,
        onError,
        onLogs(logs) {
          void Promise.all(logs.map((log) => normalizeViemLog(log, timestampForBlock)))
            .then((normalizedLogs) => {
              const usableLogs = normalizedLogs.filter((log): log is RpcLog => log !== null);
              if (usableLogs.length > 0) onLogs(usableLogs);
            })
            .catch(onError);
        }
      });
    }
  };
}

async function normalizeViemLog(
  log: ViemLog,
  timestampForBlock: (blockNumber: bigint) => Promise<string | undefined>
): Promise<RpcLog | null> {
  if (log.blockNumber === null || log.transactionHash === null) return null;
  const blockTimestamp = await timestampForBlock(log.blockNumber);
  return {
    blockNumber: toQuantity(log.blockNumber),
    transactionHash: log.transactionHash,
    topics: log.topics.filter((topic): topic is `0x${string}` => typeof topic === "string"),
    data: log.data,
    ...(log.address ? { address: log.address } : {}),
    ...(typeof log.logIndex === "number" ? { logIndex: toQuantity(BigInt(log.logIndex)) } : {}),
    ...(blockTimestamp ? { blockTimestamp } : {}),
    ...(log.removed ? { removed: true } : {})
  };
}

function toQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function rpcUrlsForConfig(config: BackendConfig): string[] {
  return [
    config.rpcUrl,
    ...(config.rpcFallbackUrls ?? [])
  ].filter((url): url is string => Boolean(url && url.trim().length > 0));
}

async function ccaStateResponse(rpc: HttpJsonRpcTransport, owner: ViemAddress | null = null): Promise<Response> {
  const call = (to: ViemAddress, data: `0x${string}`) => ({
    method: "eth_call",
    params: [{ to, data }, "latest"]
  });
  const [clearingPrice, floorPrice, startBlock, endBlock, graduated, bidVolume, currentBlock] = await rpc.requestBatch<string>([
    call(ccaAuctionAddress, encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "clearingPrice" })),
    call(ccaAuctionAddress, encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "floorPrice" })),
    call(ccaAuctionAddress, encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "startBlock" })),
    call(ccaAuctionAddress, encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "endBlock" })),
    call(ccaAuctionAddress, encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "isGraduated" })),
    call(ccaWethAddress, encodeFunctionData({ abi: erc20BalanceReadAbi, functionName: "balanceOf", args: [ccaAuctionAddress] })),
    { method: "eth_blockNumber", params: [] }
  ]);
  if ([clearingPrice, floorPrice, startBlock, endBlock, graduated, bidVolume, currentBlock].some((value) => value === undefined)) {
    throw new Error("CCA RPC response was incomplete.");
  }
  const finalized = BigInt(currentBlock!) >= BigInt(endBlock!)
    ? await rpc.request<string>("eth_call", [
      { to: ccaAuctionAddress, data: encodeFunctionData({ abi: ccaAuctionReadAbi, functionName: "checkpoints", args: [BigInt(endBlock!)] }) },
      "latest"
    ]).then((result) => BigInt(result.slice(0, 66)) !== 0n, () => false)
    : false;

  const confirmedBids = await rpc.request<RpcLog[]>("eth_getLogs", [{
    address: ccaAuctionAddress,
    fromBlock: toQuantity(BigInt(startBlock!)),
    toBlock: currentBlock!,
    topics: [ccaBidSubmittedTopic]
  }]).then((logs) => logs
    .map(decodeCcaSubmittedBid)
    .filter((bid): bid is CcaSubmittedBid => bid !== null)
    .sort((left, right) => {
      const blockOrder = BigInt(right.blockNumber) - BigInt(left.blockNumber);
      if (blockOrder !== 0n) return blockOrder > 0n ? 1 : -1;
      return right.bidId.localeCompare(left.bidId, undefined, { numeric: true });
    }), () => []);
  const recentBids = confirmedBids.slice(0, ccaRecentBidLimit);
  const walletBids = owner ? await rpc.request<RpcLog[]>("eth_getLogs", [{
    address: ccaAuctionAddress,
    fromBlock: toQuantity(BigInt(startBlock!)),
    toBlock: currentBlock!,
    topics: [ccaBidSubmittedTopic, null, ccaBidOwnerTopic(owner)]
  }]).then((logs) => logs
    .map(decodeCcaSubmittedBid)
    .filter((bid): bid is CcaSubmittedBid => bid !== null)
    .sort((left, right) => {
      const blockOrder = BigInt(right.blockNumber) - BigInt(left.blockNumber);
      if (blockOrder !== 0n) return blockOrder > 0n ? 1 : -1;
      return right.bidId.localeCompare(left.bidId, undefined, { numeric: true });
    }), () => []) : [];

  return Response.json({
    auction: ccaAuctionAddress,
    bidVolumeWei: BigInt(bidVolume!).toString(),
    clearingPriceQ96: BigInt(clearingPrice!).toString(),
    currentBlock: BigInt(currentBlock!).toString(),
    endBlock: BigInt(endBlock!).toString(),
    ethUsdReference: await ccaEthUsdReference(),
    finalized,
    floorPriceQ96: BigInt(floorPrice!).toString(),
    graduated: BigInt(graduated!) !== 0n,
    recentBids,
    startBlock: BigInt(startBlock!).toString(),
    totalBids: confirmedBids.length,
    walletBids,
    weth: ccaWethAddress,
    updatedAt: new Date().toISOString()
  }, {
    headers: {
      ...corsHeaders,
      "cache-control": "public, max-age=4, stale-while-revalidate=20"
    }
  });
}

const walletConnectRpcBodyLimitBytes = 16 * 1024;
const walletConnectRpcRateLimitWindowMs = 60_000;
const walletConnectRpcRateLimitMaxRequests = 120;
const walletConnectRpcMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas"
]);

type WalletConnectRpcPayload = {
  id?: string | number | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown[];
};

type WalletConnectRpcResponse = {
  error?: { code: number; message: string };
  id: string | number | null;
  jsonrpc: "2.0";
  result?: unknown;
};

/**
 * Serve only the Base read calls AppKit can use for wallet display and gas
 * simulation. Wallet signing and submission still happen through the selected
 * external wallet; accepting eth_sendTransaction here would expose the node as
 * a public write relay.
 */
export async function walletConnectRpcResponse(
  request: Request,
  rpc: Pick<HttpJsonRpcTransport, "request">
): Promise<Response> {
  let body: unknown;
  try {
    body = await readLimitedJson(request, walletConnectRpcBodyLimitBytes);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return Response.json(walletConnectRpcError(null, -32600, "Request body must be valid JSON-RPC."), {
      headers: { ...corsHeaders, "cache-control": "no-store" },
      status
    });
  }

  const isBatch = Array.isArray(body);
  const payloads: unknown[] = Array.isArray(body) ? body : [body];
  if (payloads.length === 0 || payloads.length > 10) {
    return Response.json(walletConnectRpcError(null, -32600, "JSON-RPC batches must contain 1 to 10 requests."), {
      headers: { ...corsHeaders, "cache-control": "no-store" },
      status: 400
    });
  }

  const responses = await Promise.all(payloads.map((payload) => walletConnectRpcEntryResponse(payload, rpc)));
  return Response.json(isBatch ? responses : responses[0], {
    headers: { ...corsHeaders, "cache-control": "no-store" }
  });
}

async function walletConnectRpcEntryResponse(
  value: unknown,
  rpc: Pick<HttpJsonRpcTransport, "request">
): Promise<WalletConnectRpcResponse> {
  const payload = walletConnectRpcPayload(value);
  if (!payload) return walletConnectRpcError(null, -32600, "Invalid JSON-RPC request.");
  if (!walletConnectRpcMethods.has(payload.method)) {
    return walletConnectRpcError(payload.id, -32601, "JSON-RPC method is not available.");
  }

  try {
    const result = await rpc.request<unknown>(payload.method, payload.params);
    return { id: payload.id, jsonrpc: "2.0", result };
  } catch {
    return walletConnectRpcError(payload.id, -32000, "Veydrift Base RPC is temporarily unavailable.");
  }
}

function walletConnectRpcPayload(value: unknown): Required<Pick<WalletConnectRpcPayload, "id" | "method" | "params">> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as WalletConnectRpcPayload;
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string" || !Array.isArray(payload.params)) return null;
  const id = payload.id;
  if (!(typeof id === "string" || typeof id === "number" || id === null)) return null;
  return { id, method: payload.method, params: payload.params };
}

function walletConnectRpcError(
  id: string | number | null,
  code: number,
  message: string
): WalletConnectRpcResponse {
  return { error: { code, message }, id, jsonrpc: "2.0" };
}

function walletConnectRpcRateLimitResponse(
  request: Request,
  limits: Map<string, { count: number; resetAt: number }>
): Response | null {
  const now = Date.now();
  if (limits.size > 2_048) {
    for (const [key, value] of limits) {
      if (value.resetAt <= now) limits.delete(key);
      if (limits.size <= 2_048) break;
    }
  }

  const clientKey = requestClientKey(request);
  if (!clientKey) return null;
  const current = limits.get(clientKey);
  if (!current || current.resetAt <= now) {
    limits.set(clientKey, { count: 1, resetAt: now + walletConnectRpcRateLimitWindowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= walletConnectRpcRateLimitMaxRequests) return null;

  return Response.json(walletConnectRpcError(null, -32005, "Too many WalletConnect RPC requests."), {
    headers: {
      ...corsHeaders,
      "cache-control": "no-store",
      "retry-after": String(Math.ceil((current.resetAt - now) / 1_000))
    },
    status: 429
  });
}

async function ccaEthUsdReference(): Promise<number> {
  const now = Date.now();
  if (ccaEthUsdCache && ccaEthUsdCache.expiresAt > now) return ccaEthUsdCache.value;

  let value = ccaEthUsdFallback;
  try {
    const response = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=ETH", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2_000)
    });
    const body = response.ok ? await response.json() as { data?: { rates?: { USD?: string } } } : null;
    const parsed = Number(body?.data?.rates?.USD);
    if (Number.isFinite(parsed) && parsed > 0) value = parsed;
  } catch {
    // The USD figure is informational only. The auction always uses exact WETH
    // amounts and Q96 prices, so a market-data outage must never block bidding.
  }
  ccaEthUsdCache = { expiresAt: now + 30_000, value };
  return value;
}

export function withRequestCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedCorsOrigin(request));
  appendVaryHeader(headers, "Origin");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

function requestLoggingHandler(
  serve: (request: Request) => Promise<Response>,
  workerRole: WorkerRole
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const url = new URL(request.url);
    try {
      const response = await serve(request);
      logApiRequest(request, url, workerRole, response.status, performance.now() - startedAt);
      return response;
    } catch (error) {
      logApiRequest(request, url, workerRole, 500, performance.now() - startedAt, error);
      throw error;
    }
  };
}

function logApiRequest(
  request: Request,
  url: URL,
  workerRole: WorkerRole,
  status: number,
  durationMs: number,
  error?: unknown
): void {
  logApiRequestEvent(request, url, workerRole, status, durationMs, error ? reasonText(error) : undefined);
}

function allowedCorsOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin && allowedCorsOrigins().has(origin)) return origin;
  return defaultCorsOrigin;
}

function allowedCorsOrigins(): Set<string> {
  return new Set([
    ...canonicalCorsOrigins,
    ...parseCorsOrigins(process.env.VEYDRIFT_ALLOWED_ORIGIN)
  ]);
}

function statsContractDescriptors(config: BackendConfig): Array<{ address: string; label: string }> {
  const candidates: Array<[string | undefined, string]> = [
    [config.gameContractAddress, "Game"],
    [config.settlementContractAddress, "Settlement"],
    [config.randomnessEngineAddress, "Randomness"],
    [config.allianceContractAddress, "Alliances"],
    [config.moonContractAddress, "Moons"],
    [config.migrationContractAddress, "Migration"],
    [config.referralSystemAddress, "Referrals"],
    [config.paidAllianceInviteAddress, "Paid Alliance Invites"],
    [config.resourceTokenAddresses.metal, "vMETAL"],
    [config.resourceTokenAddresses.crystal, "vCRYSTAL"],
    [config.resourceTokenAddresses.deuterium, "vDEUTERIUM"]
  ];
  const labels = new Map<string, string>();
  for (const [address, label] of candidates) {
    if (!address) continue;
    const normalized = address.toLowerCase();
    const previous = labels.get(normalized);
    labels.set(normalized, previous ? `${previous} / ${label}` : label);
  }
  return [...labels].map(([address, label]) => ({ address, label }));
}

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function appendVaryHeader(headers: Headers, value: string): void {
  const current = headers.get("vary");
  if (!current) {
    headers.set("vary", value);
    return;
  }
  if (current.split(",").some((item) => item.trim().toLowerCase() === value.toLowerCase())) return;
  headers.set("vary", `${current}, ${value}`);
}

function isIndexableChainReader(
  chainReader: ChainReader | undefined
): chainReader is ChainReader {
  return Boolean(
    chainReader
      && typeof chainReader.listDebrisFieldEvents === "function"
      && typeof chainReader.listMoonChanceReportEvents === "function"
      && typeof chainReader.listSettledPlanetEvents === "function"
  );
}

const readRateLimitWindowMs = 10_000;
const readRateLimitMaxRequests = 40;
const staleCachedJsonWindowMs = 300_000;
const sharedColdReadWaitMs = 200;

function readRateLimitResponse(
  request: Request,
  url: URL,
  limits: Map<string, { count: number; resetAt: number }>
): Response | null {
  return limitedReadResponse(request, url, limits, readRateLimitMaxRequests, "route");
}

function limitedReadResponse(
  request: Request,
  url: URL,
  limits: Map<string, { count: number; resetAt: number }>,
  maxRequests: number,
  scope: "client" | "route" = "client"
): Response | null {
  if (request.method !== "GET") return null;
  if (url.pathname === "/health") return null;
  if (!isRateLimitedReadPath(url.pathname)) return null;

  const now = Date.now();
  if (limits.size > 2_048) {
    for (const [key, value] of limits) {
      if (value.resetAt <= now) limits.delete(key);
      if (limits.size <= 2_048) break;
    }
  }

  const clientKey = requestClientKey(request);
  if (!clientKey) return null;
  const key = scope === "route" ? `${clientKey} ${url.pathname}${normalizedCacheSearch(url)}` : clientKey;
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + readRateLimitWindowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= maxRequests) return null;

  return Response.json(
    {
      error: "rate_limited",
      message: "Too many refresh requests. Please wait a moment and retry."
    },
    {
      headers: {
        ...corsHeaders,
        "retry-after": String(Math.ceil((current.resetAt - now) / 1_000))
      },
      status: 429
    }
  );
}

function isRateLimitedReadPath(pathname: string): boolean {
  return pathname === "/cca"
    || pathname === "/chain/events"
    || pathname === "/missions"
    || pathname === "/highscores"
    || pathname.startsWith("/wallet/")
    || pathname.startsWith("/universe/")
    || pathname.startsWith("/raid-finder/");
}

function isBootstrapReadPath(pathname: string): boolean {
  return pathname === "/runtime-config" || pathname === "/health";
}

function requestClientKey(request: Request): string | null {
  if (process.env.VEYDRIFT_TRUST_PROXY_HEADERS !== "true") return "direct";
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return forwarded?.[forwarded.length - 1] ?? null;
}

function normalizedCacheSearch(url: URL): string {
  const accepted = acceptedCacheParams(url.pathname);
  if (!accepted || accepted.size === 0) return "";
  const normalized = new URLSearchParams();
  for (const name of [...accepted].sort()) {
    const values = url.searchParams.getAll(name).filter((value) => value.trim() !== "");
    for (const value of values.sort()) {
      normalized.append(name, value);
    }
  }
  const search = normalized.toString();
  return search ? `?${search}` : "";
}

function statsUtcOffsetMinutesFromQuery(value: string | null): number {
  if (!value || !/^-?\d+$/.test(value)) return 0;
  return normalizeStatsUtcOffsetMinutes(Number(value));
}

function acceptedCacheParams(pathname: string): ReadonlySet<string> | undefined {
  const direct = acceptedCacheQueryParams.get(pathname);
  if (direct) return direct;
  if (pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) return acceptedCacheQueryParams.get("/wallet/*/fleet-visibility");
  if (pathname.match(/^\/wallet\/[^/]+\/activity$/)) return acceptedCacheQueryParams.get("/wallet/*/activity");
  if (pathname.match(/^\/wallet\/[^/]+\/missions$/)) return acceptedCacheQueryParams.get("/wallet/*/missions");
  if (pathname.match(/^\/wallet\/[^/]+\/referrals\/history$/)) return acceptedCacheQueryParams.get("/wallet/*/referrals/history");
  if (pathname.match(/^\/wallet\/[^/]+\/overview$/)) return acceptedCacheQueryParams.get("/wallet/*/overview");
  if (pathname.match(/^\/wallet\/[^/]+\/queues$/)) return acceptedCacheQueryParams.get("/wallet/*/queues");
  if (pathname.match(/^\/wallet\/[^/]+\/infrastructure$/)) return acceptedCacheQueryParams.get("/wallet/*/infrastructure");
  if (pathname.match(/^\/wallet\/[^/]+\/moon$/)) return acceptedCacheQueryParams.get("/wallet/*/moon");
  if (pathname.match(/^\/wallet\/[^/]+\/shipyard$/)) return acceptedCacheQueryParams.get("/wallet/*/shipyard");
  if (pathname.match(/^\/wallet\/[^/]+\/defenses$/)) return acceptedCacheQueryParams.get("/wallet/*/defenses");
  if (pathname.match(/^\/wallet\/[^/]+\/research$/)) return acceptedCacheQueryParams.get("/wallet/*/research");
  if (pathname.match(/^\/universe\/galaxies\/[0-9]+\/systems\/[0-9]+$/)) return new Set(["detail"]);
  return undefined;
}

function sharedResponseCacheForIndex(indexDbPath: string): SharedResponseCache | null {
  const path = responseCachePath(indexDbPath);
  if (!path) return null;
  try {
    return new SharedResponseCache(path);
  } catch (error) {
    console.warn("Veydrift shared response cache unavailable", reasonText(error));
    return null;
  }
}

// Predicate kept for diagnostics/tests: true when a warm DB inherited a recorded reconcile failure
// (lastReconciliationError set, not currently reconciling). The backend no longer auto-runs canonical
// reconcile at startup; recovery is an explicit operator action or event-log replay.
export function shouldRecoverFailedReconciliation(
  snapshot: Pick<IndexerSnapshot, "lastReconciledAt" | "lastReconciliationError" | "reconciliationInProgress">
): boolean {
  return Boolean(snapshot.lastReconciledAt)
    && Boolean(snapshot.lastReconciliationError)
    && !snapshot.reconciliationInProgress;
}

type CachedJsonResponse = {
  body: ArrayBuffer;
  expiresAt: number;
  gzipBody?: ArrayBuffer;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
};

type CachedJsonRefreshResult =
  | { cached: CachedJsonResponse; response?: never }
  | { cached: null; response: Response };

async function refreshCachedJsonResponse(
  request: Request,
  url: URL,
  routeRequest: (request: Request) => Promise<Response>,
  responseCache: Map<string, CachedJsonResponse>,
  sharedResponseCache: SharedResponseCache | null | undefined,
  cacheKey: string,
  cacheTtlMs: number,
  staleCacheKey = cacheKey
): Promise<CachedJsonRefreshResult> {
  const response = await routeRequest(request);
  if (response.status !== 200 || !jsonContentType(response.headers.get("content-type"))) {
    return { cached: null, response };
  }

  const body = await response.clone().arrayBuffer();
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("cache-control", clientCacheControlHeader(url, cacheTtlMs));
  const headers: Array<[string, string]> = [];
  responseHeaders.forEach((value, key) => headers.push([key, value]));
  const cached = {
    body,
    expiresAt: Date.now() + cacheTtlMs,
    headers,
    status: response.status,
    statusText: response.statusText
  };
  responseCache.set(cacheKey, cached);
  sharedResponseCache?.set(cacheKey, cached, cached.expiresAt + staleCachedJsonWindowMs);
  if (staleCacheKey !== cacheKey) {
    sharedResponseCache?.set(staleCacheKey, cached, cached.expiresAt + staleCachedJsonWindowMs);
  }
  pruneResponseCache(responseCache);
  return { cached };
}

function cacheableJsonRequestTtlMs(request: Request, url: URL): number {
  if (request.method !== "GET") return 0;
  if (url.searchParams.get("fresh") === "1") return 0;
  if (url.pathname === "/chain/events") return 0;
  if (url.pathname === "/cca") return 4_000;
  if (url.pathname === "/health") return 10_000;
  if (url.pathname === "/stats") return 30_000;
  // Public landing pages request the live board independently. Keep its browser response no-store,
  // but serve a short shared snapshot across every reader instead of synchronously rebuilding the
  // entire ranking after unrelated indexed events.
  if (url.pathname === "/highscores") {
    return landingLeaderboardRequest(url) ? 60_000 : livePublicDataRequest(url) ? 1_000 : 300_000;
  }
  if (url.pathname === "/raid-finder/debris") return 30_000;
  if (url.pathname === "/raid-finder/rifters") return 30_000;
  // Mission Control is an authoritative indexed-state surface. The chain-event stream fires only
  // after the writer commits a log, so returning a process-local stale snapshot here defeats the
  // live refresh and can leave a resolved mission shown as Outbound/Resolving. These targeted SQL
  // projections are already bounded/indexed; never put stale-while-revalidate in front of them.
  if (url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) return 0;
  if (url.pathname.match(/^\/wallet\/[^/]+\/missions$/)) return 0;
  if (url.pathname.match(/^\/wallet\/[^/]+\/missile-attacks$/)) return 0;
  if (url.pathname === "/missions") return livePublicDataRequest(url) ? 0 : 300_000;
  if (url.pathname.match(/^\/mission\/[^/]+$/)) return 0;
  // Moon/Shipyard/Infrastructure payloads include as-of-now projections that can change when time
  // crosses a mission or per-unit production boundary without a new indexed log. A TTL cache can
  // otherwise preserve mismatched queue, inventory, and Solar Satellite energy values after refresh.
  if (url.pathname.match(/^\/wallet\/[^/]+\/(?:infrastructure|moon|shipyard|defenses)$/)) return 0;
  // Overview is the canonical combined wallet snapshot used by live chain-event refreshes. It must
  // advance resources and fleet visibility from the same committed DB state, never a cached copy.
  if (url.pathname.match(/^\/wallet\/[^/]+\/overview$/)) return 0;
  // Alliance writes are confirmed against this indexed projection. Do not let an owner see a
  // cached empty description after the profile event has already committed.
  if (url.pathname.match(/^\/wallet\/[^/]+\/alliance$/)) return 0;
  if (url.pathname.match(/^\/alliance\/[0-9]+$/)) return 0;
  if (cacheableWalletSnapshotPath(url.pathname)) return 15_000;
  if (url.pathname.startsWith("/wallet/")) return 5_000;
  if (url.pathname.match(/^\/universe\/galaxies\/[0-9]+\/systems\/[0-9]+$/)) return 30_000;
  if (url.pathname === "/universe/systems") return 30_000;
  return 0;
}

function cacheableWalletSnapshotPath(pathname: string): boolean {
  if (!pathname.startsWith("/wallet/")) return false;
  if (pathname.match(/^\/wallet\/[^/]+\/(?:infrastructure|shipyard|defenses)(?:$|\?)/)) return false;
  return Boolean(pathname.match(
    /^\/wallet\/[^/]+\/(?:overview|infrastructure|moon|planets|settlement|queues|research|rift|alliance|profile|highscore|fleet-visibility|attack-protection)$/
  ));
}

function cacheableJsonRequestKey(
  request: Request,
  url: URL,
  indexer: SettlementIndexer | undefined,
  config?: BackendConfig
): string {
  const indexerVersion = indexer ? cacheableJsonRequestVersion(url, indexer) : "none";
  const paidAllianceHistoryIdentity = allianceHistoryCacheIdentity(url, indexer, config);
  return `${request.method} ${url.pathname}${normalizedCacheSearch(url)} indexer=${indexerVersion}${paidAllianceHistoryIdentity}`;
}

function allianceHistoryCacheIdentity(
  url: URL,
  indexer: SettlementIndexer | undefined,
  config?: BackendConfig
): string {
  if (!url.pathname.match(/^(?:\/wallet\/[^/]+\/alliance|\/alliance\/[0-9]+)$/)) return "";
  const contractAddress = config?.paidAllianceInviteAddress;
  const fromBlock = config?.paidAllianceInviteIndexFromBlock;
  if (!contractAddress || fromBlock === undefined) return " paid-alliance=disabled";
  const status = indexer?.paidAllianceInviteHistoryBackfillStatus(contractAddress, fromBlock);
  const marker = status?.marker;
  const readiness = status?.required || !marker ? "pending" : marker.throughBlock;
  return ` paid-alliance=${contractAddress.toLowerCase()}:${fromBlock}:${readiness}`;
}

function cacheableJsonRequestStaleKey(request: Request, url: URL, cacheKey: string): string {
  // Leaderboard data is informational, not a transaction precondition. Its global state token changes
  // on every indexed event, which used to make all readers miss together and each rebuild the full
  // live board. Reuse the last completed board while exactly one reader refreshes it.
  if (landingLeaderboardRequest(url)) {
    return `${request.method} ${url.pathname}${normalizedCacheSearch(url)} indexer=stale`;
  }
  // Mission Control transitions must not cross read-model versions through the versionless stale
  // cache. In particular, an Outbound payload cannot mask a newly materialized Returning attack and
  // battle report for up to 60 seconds. Same-version stale-while-revalidate remains available.
  if (
    url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)
    || url.pathname.match(/^\/wallet\/[^/]+\/missions$/)
    || url.pathname.match(/^\/wallet\/[^/]+\/missile-attacks$/)
  ) {
    return cacheKey;
  }
  if (cacheableWalletSnapshotPath(url.pathname) || livePublicDataRequest(url)) return cacheKey;
  return `${request.method} ${url.pathname}${normalizedCacheSearch(url)} indexer=stale`;
}

function cacheableJsonRequestVersion(url: URL, indexer: SettlementIndexer): string {
  if (url.pathname === "/health") return "ttl";
  if (url.pathname === "/stats") return "ttl";
  if (url.pathname === "/highscores") {
    // The public landing board is informational. A stable one-minute snapshot means a reader that
    // did not receive the last browser request can reuse the same completed ranking immediately,
    // rather than becoming a fresh multi-second SQLite rebuild after every unrelated chain event.
    return landingLeaderboardRequest(url)
      ? "landing-leaderboard"
      : livePublicDataRequest(url)
        ? indexer.indexedStateCacheVersion()
        : "ttl";
  }
  if (url.pathname === "/raid-finder/debris") return "ttl";
  if (url.pathname === "/raid-finder/rifters") return "ttl";
  // Do not use the global mission/battle-report generation for hot per-wallet views. It advances
  // for every player's event, including completed missions that cannot affect another wallet's
  // active view. Keep one stable key and let the five-second TTL/stale-while-revalidate path own
  // refreshes. Time-bucketed keys synchronized every wallet's cold rebuild at once.
  if (
    url.pathname.match(/^\/wallet\/[^/]+\/(?:fleet-visibility|missions|overview)$/)
  ) {
    return "mission-poll";
  }
  if (url.pathname.match(/^\/wallet\/[^/]+\/missile-attacks$/)) return indexer.responseCacheVersion();
  if (url.pathname === "/missions") return livePublicDataRequest(url) ? indexer.missionResponseCacheVersion() : "ttl";
  if (url.pathname.match(/^\/mission\/[^/]+$/)) return indexer.missionResponseCacheVersion();
  if (cacheableWalletSnapshotPath(url.pathname)) return indexer.walletResponseCacheVersion(walletAddressFromPath(url));
  if (url.pathname.match(/^\/universe\/galaxies\/[0-9]+\/systems\/[0-9]+$/)) {
    const parts = url.pathname.split("/");
    const galaxy = Number.parseInt(parts[3] ?? "", 10);
    const system = Number.parseInt(parts[5] ?? "", 10);
    if (Number.isFinite(galaxy) && Number.isFinite(system)) {
      return galaxySystemCacheVersion(indexer, galaxySystemDetail(url), galaxy, system);
    }
    return "ttl";
  }
  if (url.pathname === "/universe/systems") return "ttl";
  return indexer.responseCacheVersion();
}

function clientCacheControlHeader(url: URL, ttlMs: number): string {
  if (personalizedHighscoreRequest(url)) {
    return "private, no-store";
  }
  if (livePublicDataRequest(url)) return "public, no-store";
  const seconds = Math.max(1, Math.floor(ttlMs / 1_000));
  const scope = url.pathname.startsWith("/wallet/") ? "private" : "public";
  return `${scope}, max-age=${seconds}, stale-while-revalidate=${seconds}`;
}

function livePublicDataRequest(url: URL): boolean {
  return (url.pathname === "/highscores" || url.pathname === "/missions")
    && url.searchParams.get("live") === "1";
}

function personalizedHighscoreRequest(url: URL): boolean {
  return url.pathname === "/highscores"
    && (url.searchParams.has("currentWallet") || url.searchParams.has("includeAttackProtection"));
}

function cachedJsonResponse(request: Request, cached: CachedJsonResponse): Response {
  const headers = new Headers(cached.headers);
  const shouldGzip = cached.body.byteLength > 2_048 && requestAcceptsGzip(request) && !headers.has("content-encoding");
  const body = shouldGzip ? cachedGzipBody(cached) : cached.body.slice(0);

  if (shouldGzip) {
    headers.set("content-encoding", "gzip");
    headers.set("content-length", String(body.byteLength));
    appendVaryHeader(headers, "Accept-Encoding");
  }

  return new Response(body, {
    headers,
    status: cached.status,
    statusText: cached.statusText
  });
}

function requestAcceptsGzip(request: Request): boolean {
  return /\bgzip\b/i.test(request.headers.get("accept-encoding") ?? "");
}

function cachedGzipBody(cached: CachedJsonResponse): ArrayBuffer {
  if (cached.gzipBody) return cached.gzipBody.slice(0);
  const compressed = gzipSync(new Uint8Array(cached.body));
  cached.gzipBody = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  return cached.gzipBody.slice(0);
}

function jsonContentType(value: string | null): boolean {
  return Boolean(value && value.toLowerCase().includes("application/json"));
}

function pruneResponseCache(cache: Map<string, CachedJsonResponse>): void {
  if (cache.size <= 4_096) return;
  const now = Date.now();
  for (const [key, value] of cache) {
    if (value.expiresAt <= now || cache.size > 4_096) {
      cache.delete(key);
    }
  }
}

function prewarmHotResponseCache(
  serve: (request: Request) => Promise<Response>,
  indexer: SettlementIndexer | undefined,
  enabled: boolean,
  startDelayMs = 0
): void {
  if (!enabled || !indexer) return;

  const timer = setTimeout(() => {
    void (async () => {
      let paths: string[] = [];
      try {
        indexer.allActiveFleetMissions();
        paths = hotResponseCachePaths(indexer);
      } catch {
        // Best-effort only. A cold/stale index should not make worker startup fail.
      }
      for (const path of paths) {
        try {
          const response = await serve(new Request(`http://localhost${path}`));
          await response.arrayBuffer();
        } catch {
          // Best-effort only. A cold/stale index should not make worker startup fail.
        }
        await delay(0);
      }
    })();
  }, startDelayMs);
  timer.unref?.();
}

function prewarmStartDelayMs(): number {
  const parsedIndex = Number.parseInt(process.env[WORKER_INDEX_ENV] ?? "0", 10);
  const index = Number.isFinite(parsedIndex) ? Math.max(0, parsedIndex) : 0;
  return 500 + index * 250;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hotResponseCachePaths(indexer: SettlementIndexer): string[] {
  const paths = new Set<string>([
    "/highscores?page=1&pageSize=250",
    "/missions?status=active",
    "/missions?status=completed&page=1&pageSize=25"
  ]);
  const galaxySystemPaths = new Set<string>();

  for (const mission of [
    ...indexer.allActiveFleetMissions().slice(0, 50),
    ...indexer.allCompletedFleetMissions().slice(0, 50)
  ]) {
    paths.add(`/mission/${encodeURIComponent(mission.missionId)}`);
    if (mission.targetPlanet) {
      galaxySystemPaths.add(`/universe/galaxies/${mission.targetPlanet.galaxy}/systems/${mission.targetPlanet.system}`);
    }
  }

  for (const [wallet, planets] of indexer.settledPlanetsByOwner()) {
    const encodedWallet = encodeURIComponent(wallet);
    paths.add(`/wallet/${encodedWallet}/fleet-visibility`);
    paths.add(`/wallet/${encodedWallet}/fleet-visibility?archive=none`);
    paths.add(`/wallet/${encodedWallet}/missions?status=completed&page=1&pageSize=25`);
    paths.add(`/wallet/${encodedWallet}/settlement`);
    paths.add(`/wallet/${encodedWallet}/planets`);
    paths.add(`/wallet/${encodedWallet}/highscore`);

    for (const planet of planets) {
      galaxySystemPaths.add(`/universe/galaxies/${planet.galaxy}/systems/${planet.system}`);
      const planetId = encodeURIComponent(planet.planetId);
      paths.add(`/wallet/${encodedWallet}/overview?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/queues?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/infrastructure?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/moon?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/shipyard?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/defenses?planetId=${planetId}`);
      paths.add(`/wallet/${encodedWallet}/research?planetId=${planetId}`);
    }
  }

  for (const path of [...galaxySystemPaths].slice(0, 500)) {
    paths.add(path);
  }

  return [...paths];
}

const indexedRequestSnapshotCache = new WeakMap<SettlementIndexer, {
  expiresAtMs: number;
  snapshot: IndexerSnapshot;
}>();

// Indexer event processing requires an immediately fresh snapshot for its own state transition
// result. HTTP readers only need the snapshot for readiness headers/status, while their payloads
// are fetched directly from the indexed tables. Coalesce that broad metadata view briefly so an
// active writer cannot make every concurrent page request re-run it under SQLite contention.
function indexedReadSnapshot(indexer: SettlementIndexer): IndexerSnapshot {
  const nowMs = Date.now();
  const cached = indexedRequestSnapshotCache.get(indexer);
  if (cached && cached.expiresAtMs > nowMs) return cached.snapshot;
  const snapshot = indexer.snapshot();
  indexedRequestSnapshotCache.set(indexer, { expiresAtMs: nowMs + 250, snapshot });
  return snapshot;
}

function hasWarmPlanetIndex(indexer: SettlementIndexer | undefined): indexer is SettlementIndexer {
  if (!indexer) return false;
  return indexedReadSnapshot(indexer).indexedPlanets > 0;
}

function hasWarmAllianceIndex(indexer: SettlementIndexer | undefined): indexer is SettlementIndexer {
  if (!indexer) return false;
  return indexedReadSnapshot(indexer).safeToServeAllianceState;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await readLimitedJson(request, jsonBodyLimitBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return null;
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

class RequestBodyTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

async function readLimitedJson(request: Request, limitBytes: number): Promise<unknown> {
  const text = await readLimitedText(request, limitBytes);
  return JSON.parse(text);
}

async function readLimitedText(request: Request, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > limitBytes) {
      throw new RequestBodyTooLargeError(limitBytes);
    }
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }
  return new TextDecoder().decode(body);
}

function playerProfilesUnavailableResponse(): Response {
  return Response.json(
    {
      error: "player_profiles_unavailable",
      message: "Player profiles are unavailable until the indexed backend database is configured."
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function entityMediaUnavailableResponse(): Response {
  return Response.json({
    error: "entity_media_unavailable",
    message: "Entity media is unavailable until the indexed backend database is configured."
  }, {
    headers: corsHeaders,
    status: 503
  });
}

function canManageEntityMedia(
  indexer: SettlementIndexer,
  entityKind: EntityMediaKind,
  entityId: string,
  wallet: Address
): boolean {
  const normalizedWallet = wallet.toLowerCase();
  if (entityKind === "player") return entityId === normalizedWallet;
  if (entityKind === "planet") return indexer.planet(entityId)?.owner.toLowerCase() === normalizedWallet;
  if (entityKind === "moon") {
    return indexer.hasMoon(entityId) && indexer.planet(entityId)?.owner.toLowerCase() === normalizedWallet;
  }

  const alliance = indexer.allianceState(wallet);
  return alliance.membership.allianceId === entityId
    && (alliance.membership.role === "owner" || alliance.membership.role === "officer");
}

function invalidReferralSignatureResponse(): Response {
  return Response.json(
    {
      error: "invalid_signature",
      message: "Sign the Veydrift referral invite message with the connected wallet."
    },
    {
      headers: corsHeaders,
      status: 401
    }
  );
}

function referralConfigurationReady(config: BackendConfig, startPriceWei: string | null): boolean {
  return Boolean(
    config.referralSignerPrivateKey
      && config.referralSystemAddress
      && config.gameContractAddress
      && startPriceWei
  );
}

function referralResolveErrorResponse(resolution: ReferralResolveResult): Response {
  const status = resolution.status === "invalid"
    ? 404
    : resolution.status === "inactive"
      ? 410
      : resolution.status === "exhausted"
        ? 429
        : resolution.status === "unavailable"
          ? 503
          : 409;
  return Response.json({
    error: `referral_${resolution.status}`,
    ...resolution
  }, {
    headers: corsHeaders,
    status
  });
}

function withPlayerProfile<T extends { wallet: `0x${string}` }>(
  body: T,
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}` = body.wallet
): T & { player: PlayerProfile } {
  return {
    ...body,
    player: indexer?.playerProfile(wallet) ?? fallbackPlayerProfile(wallet)
  };
}

function withMigrationSnapshotFields<T extends object>(
  body: T,
  wallet: `0x${string}`
): T & {
  migrationClaim?: MigrationClaimPayload;
  migrationReservation?: MigrationReservedPlanet & { exists: true; claimed: boolean };
} {
  const reservedPlanet = migrationReservedPlanetsForWallet(wallet)[0];
  const reservation = reservedPlanet
    ? {
        ...reservedPlanet,
        exists: true as const,
        claimed: migrationReservationClaimedByBody(body, reservedPlanet)
      }
    : null;
  return {
    ...body,
    ...(reservation?.claimed ? {} : migrationClaimPayloadFields(wallet)),
    ...(reservation ? { migrationReservation: reservation } : {})
  };
}

function migrationReservationClaimedByBody(body: object, reservation: MigrationReservedPlanet): boolean {
  const homePlanetId = (body as { homePlanetId?: unknown }).homePlanetId;
  return typeof homePlanetId === "string" && reservation.planetId === homePlanetId;
}

function fallbackPlayerProfile(wallet: `0x${string}`): PlayerProfile {
  const normalizedWallet = wallet.toLowerCase() as `0x${string}`;
  return {
    wallet: normalizedWallet,
    displayName: null,
    description: null,
    fallbackName: `${normalizedWallet.slice(0, 6)}...${normalizedWallet.slice(-4)}`,
    updatedAt: null
  };
}

function indexedWalletSettlementWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`
): Response | null {
  if (!indexer) return null;
  const snapshot = indexedReadSnapshot(indexer);

  if (snapshot.indexedPlanets <= 0) {
    if (!migrationClaimPayloadForWallet(wallet)) return null;
    return indexedJsonResponse(
      withMigrationSnapshotFields(withPlayerProfile(indexer.walletSettlement(wallet), indexer, wallet), wallet),
      snapshot
    );
  }

  const settlement = indexedWalletSettlement(indexer, wallet, undefined)?.settlement ?? indexer.walletSettlement(wallet);
  return indexedWarmJsonResponse(
    withMigrationSnapshotFields(withPlayerProfile(settlement, indexer, wallet), wallet),
    "wallet settlement",
    snapshot
  );
}

function indexedWalletPlanetsWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`
): Response | null {
  if (!indexer || !hasWarmPlanetIndex(indexer)) return null;

  const snapshot = indexedReadSnapshot(indexer);
  return indexedWarmJsonResponse(withPlayerProfile(indexedWalletPlanets(indexer, wallet), indexer, wallet), "wallet planets", snapshot);
}

async function indexedWalletOverviewWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined,
  _chainReader: ChainReader | undefined
): Promise<Response | null> {
  const startedAt = performance.now();
  if (!indexer || !hasWarmPlanetIndex(indexer)) return null;
  const warmAt = performance.now();

  return indexer.readSnapshot(() => {
    const snapshot = indexedReadSnapshot(indexer);
    const snapshotAt = performance.now();
    const selectedSettlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
    const homeSettlement = selectedSettlement ?? indexedWalletSettlement(indexer, wallet, undefined);
    const settlement = homeSettlement?.settlement ?? indexer.walletSettlement(wallet);
    const queuePlanetId = homeSettlement?.planet?.planetId ?? settlement.homePlanetId;
    const settlementAt = performance.now();
    const planetsResponse = indexedWalletPlanets(indexer, wallet);
    const planetsAt = performance.now();
    const indexedQueues = indexer.playerQueues(wallet, queuePlanetId);
    // Queue timing is committed by the writer from queue timing events/canonical reconciliation. Never
    // turn a wallet overview render into an eth_call: with many readers, a browser refresh fan-out made
    // each request perform the same live queue read and starved normal API work.
    const queues = indexedQueues;
    const queuesAt = performance.now();
    const fleetVisibility = indexedFleetVisibility(
      wallet,
      settlement,
      homeSettlement?.planet ?? null,
      indexedWarmDetail("fleet visibility"),
      indexer,
      { includeArchive: false, includeJoinableAttacks: false }
    );
    const fleetAt = performance.now();

    const response = indexedWarmJsonResponse({
      settlement: withMigrationSnapshotFields(withPlayerProfile(settlement, indexer, wallet), wallet),
      planetsResponse: withPlayerProfile(planetsResponse, indexer, wallet),
      queues,
      fleetVisibility
    }, "overview snapshot", snapshot);
    const completedAt = performance.now();
    if (completedAt - startedAt >= 100) {
      console.warn("Slow overview projection", {
        durationMs: Math.round(completedAt - startedAt),
        warmMs: Math.round(warmAt - startedAt),
        snapshotMs: Math.round(snapshotAt - warmAt),
        settlementMs: Math.round(settlementAt - snapshotAt),
        planetsMs: Math.round(planetsAt - settlementAt),
        queuesMs: Math.round(queuesAt - planetsAt),
        fleetMs: Math.round(fleetAt - queuesAt),
        responseMs: Math.round(completedAt - fleetAt),
        wallet,
        planetId: queuePlanetId
      });
    }
    return response;
  });
}

function sharedColdReadWaitMsFor(url: URL): number {
  // Cold live leaderboards legitimately take longer than a wallet projection. Waiting for their
  // shared builder is vastly cheaper than launching nine identical SQLite-heavy rebuilds.
  return landingLeaderboardRequest(url) ? 10_000 : sharedColdReadWaitMs;
}

function landingLeaderboardRequest(url: URL): boolean {
  return url.pathname === "/highscores"
    && url.searchParams.get("live") === "1"
    && (url.searchParams.get("category") ?? "total") === "total"
    && (url.searchParams.get("page") ?? "1") === "1"
    && url.searchParams.get("pageSize") === "250"
    && !url.searchParams.has("currentWallet")
    && !url.searchParams.has("includeAttackProtection");
}

type IndexedMoonNotReadyBody = MoonState & {
  detail: string;
  indexedNotReady: true;
  indexedNotReadyAt: string;
  indexer: ReturnType<SettlementIndexer["snapshot"]> | null;
  source: typeof indexedSource;
  stale: true;
};

type IndexedWarmBuilder<T extends object> = (
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  detail: string,
  indexer: SettlementIndexer
) => T;

function indexedWalletStateResponse<T extends object>(
  url: URL,
  indexer: SettlementIndexer | undefined,
  surface: string,
  build: IndexedWarmBuilder<T>,
  options: { includeSelectedPlanet?: boolean } = {}
): Response {
  const wallet = walletAddressFromPath(url);
  const planetId = options.includeSelectedPlanet === false ? undefined : selectedPlanetId(url);
  const indexed = indexedWarmResponse(indexer, wallet, planetId, surface, build);
  return indexed ?? indexedReadNotReadyResponse(surface, indexer, indexedReadLookup(url, wallet));
}

function walletAddressFromPath(url: URL): `0x${string}` {
  const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
  assertAddress(wallet);
  return wallet;
}

function indexedReadLookup(url: URL, wallet: `0x${string}`): IndexedReadLookupContext {
  const planetId = selectedPlanetId(url);
  return {
    wallet,
    ...(planetId !== undefined ? { selectedPlanetId: planetId.toString() } : {})
  };
}

function indexedWarmResponse<T extends object>(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined,
  surface: string,
  build: IndexedWarmBuilder<T>
): Response | null {
  if (!indexer) return null;

  if (!hasWarmPlanetIndex(indexer)) return null;
  const settlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
  if (!settlement?.planet) return null;

  const detail = indexedWarmDetail(surface);
  return indexedWarmJsonResponse(
    build(wallet, settlement.settlement, settlement.planet, detail, indexer),
    surface,
    indexedReadSnapshot(indexer),
    detail
  );
}

function indexedWarmJsonResponse<T extends object>(
  body: T,
  surface: string,
  snapshot: ReturnType<SettlementIndexer["snapshot"]>,
  detail = indexedWarmDetail(surface)
): Response {
  const bodyStale = (body as { stale?: unknown }).stale === true;
  return indexedJsonResponse({
    ...body,
    detail,
    stale: bodyStale || !snapshot.safeToServeIndexedState
  }, snapshot, bodyStale ? "stale" : indexedStateLabel(snapshot));
}

function indexedWarmDetail(surface: string): string {
  return `${surface} loaded from DB-indexed contract state.`;
}

function indexedJsonResponse<T extends object>(
  body: T,
  snapshot: ReturnType<SettlementIndexer["snapshot"]>,
  indexState: string = indexedStateLabel(snapshot)
): Response {
  return Response.json({
    ...body,
    indexer: snapshot,
    source: indexedSource
  }, {
    headers: indexedStateHeaders(indexState)
  });
}

function indexedStateLabel(snapshot: ReturnType<SettlementIndexer["snapshot"]>): "healthy" | "stale" {
  return snapshot.safeToServeIndexedState ? "healthy" : "stale";
}

function indexedStateHeaders(indexState: string): HeadersInit {
  return {
    ...corsHeaders,
    "x-veydrift-index-state": indexState
  };
}

function indexedMoonNotReadyResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): Response {
  const homePlanetId = selectedPlanetId?.toString() ?? indexer?.walletSettlement(wallet).homePlanetId ?? null;
  const indexedState = indexer?.moonState(wallet, homePlanetId);
  const detail = indexer
    ? "Moon indexed state is still warming. Refresh shortly."
    : "Moon indexed state is not available from this backend yet. Refresh shortly.";
  const body: IndexedMoonNotReadyBody = {
    wallet,
    bodyKind: "moon",
    homePlanetId,
    parentPlanetId: homePlanetId,
    moonAvailable: false,
    unavailableReason: detail,
    resources: indexedState?.resources ?? { metal: "0", crystal: "0", deuterium: "0" },
    resourcesAsOfNow: indexedState?.resourcesAsOfNow ?? indexedState?.resources ?? { metal: "0", crystal: "0", deuterium: "0" },
    ships: indexedState?.ships ?? [],
    moon: null,
    fleet: indexedState?.fleet ?? [],
    buildings: indexedState?.buildings ?? [],
    queue: null,
    technologyLevels: indexedState?.technologyLevels ?? {},
    defenses: indexedState?.defenses ?? [],
    defenseQueue: null,
    detail,
    indexedNotReady: true,
    indexedNotReadyAt: new Date().toISOString(),
    indexer: indexer?.snapshot() ?? null,
    source: indexedSource,
    stale: true
  };

  return Response.json(body, {
    headers: indexedStateHeaders("not-ready")
  });
}

function moonTimedResponse(response: Response, readStartedAt: number): Response {
  const elapsedMs = Date.now() - readStartedAt;
  response.headers.set("x-veydrift-moon-read-ms", String(elapsedMs));
  if (elapsedMs > 500) {
    console.warn("Slow Moon backend read", { elapsedMs });
  }
  return response;
}

function indexedWalletSettlement(
  indexer: SettlementIndexer,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): { settlement: ReturnType<SettlementIndexer["walletSettlement"]>; planet: SettledPlanetEvent | null } | null {
  const settlement = indexer.walletSettlement(wallet);
  if (!selectedPlanetId) {
    const planet = settlement.planet;
    return {
      settlement: {
        ...settlement,
        planet: indexedWalletSettlementPlanetState(indexer, planet)
      },
      planet
    };
  }

  const planet = indexer.planet(selectedPlanetId.toString());
  if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) {
    return null;
  }

  return {
    settlement: {
      ...settlement,
      homePlanetId: planet.planetId,
      planet: indexedWalletSettlementPlanetState(indexer, planet)
    },
    planet
  };
}

function indexedWalletSettlementPlanetState(
  indexer: SettlementIndexer,
  planet: SettledPlanetEvent | null
): SettledPlanetEvent | null {
  if (!planet) return null;
  const currentPlanet = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;
  return {
    ...planet,
    resourcesAsOfNow: currentPlanet.resources,
    resourceSnapshot: resourceSnapshotMetadataForPlanet(planet)
  };
}

function indexedWalletPlanets(
  indexer: SettlementIndexer,
  wallet: `0x${string}`
): ReturnType<SettlementIndexer["walletPlanets"]> {
  const settlement = indexer.walletSettlement(wallet);
  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    queues: {
      research: indexer.researchQueue(wallet)
    },
    // `walletPlanets()` is a complete standalone indexer view, including a moon summary for each
    // planet. This response immediately enriches every planet with the same moon/tactical state,
    // so using that full view here performed two all-planet passes on each cold overview/roster
    // read. Build the managed planet shell once and let indexedWalletPlanetState hydrate details.
    planets: indexer.settledPlanetsForOwner(wallet).map((planet) => {
      const buildings = indexer.infrastructureRows(planet.planetId);
      const managed = indexedManagedPlanet(
        planet,
        settlement.homePlanetId,
        buildings,
        {
          building: indexer.planetQueue(planet.planetId, "building"),
          defense: indexer.planetQueue(planet.planetId, "defense"),
          ship: indexer.planetQueue(planet.planetId, "ship")
        }
      );
      return indexedWalletPlanetState(indexer, managed, buildings);
    })
  };
}

function watchedPlanetsResponse(
  indexer: SettlementIndexer,
  wallet: `0x${string}`,
  url: URL,
  config: BackendConfig
): {
  wallet: `0x${string}`;
  watchedPlanetIds: string[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  planets: GalaxySystemPayload["planets"];
  detail: string;
  stale: boolean;
} {
  const page = positiveIntegerQuery(url, "page", 1, 1_000_000);
  const pageSize = positiveIntegerQuery(url, "pageSize", 25, 100);
  const watched = indexer.watchedPlanets(wallet, page, pageSize);
  const watchedPlanetIds = indexer.watchedPlanetIds(wallet);
  const allianceIntel = allianceIntelForPlayers(watched.planets.map((planet) => planet.owner), indexer);
  const snapshot = indexedReadSnapshot(indexer);

  return {
    wallet,
    watchedPlanetIds,
    pagination: {
      page,
      pageSize,
      total: watched.total,
      totalPages: Math.max(1, Math.ceil(watched.total / pageSize))
    },
    planets: watched.planets.map((planet) =>
      watchedPlanetPayload(planet, indexer, allianceIntel, config)
    ),
    detail: indexedWarmDetail("watched planets"),
    stale: !snapshot.safeToServeIndexedState
  };
}

function watchedPlanetPayload(
  planet: SettledPlanetEvent,
  indexer: SettlementIndexer,
  allianceIntel: ReadonlyMap<string, AllianceIdentity>,
  config: BackendConfig
): GalaxySystemPayload["planets"][number] {
  return {
    ...planetMetadata(config.chainId, config.settlementContractAddress ?? config.gameContractAddress ?? "0x0000000000000000000000000000000000000000", {
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.position
    }),
    fields: planet.fields,
    temperature: planet.temperature,
    metalMultiplierBps: planet.metalMultiplierBps,
    crystalMultiplierBps: planet.crystalMultiplierBps,
    deuteriumMultiplierBps: planet.deuteriumMultiplierBps,
    archetype: planetArchetypeForTemperature(planet.temperature),
    occupiedBy: occupiedPlanetRef(planet, indexer, allianceIntel),
    publicState: publicPlanetStateRef(planet, indexer),
    publicMoonState: publicMoonStateRef(planet, indexer),
    debrisField: debrisFieldRef(indexer.debrisFieldsInSystem(planet.galaxy, planet.system).find((field) => field.position === planet.position)),
    hasMoon: indexer.hasMoon(planet.planetId),
    moonChance: moonChanceReportRef(indexer.moonChanceReportsInSystem(planet.galaxy, planet.system).find((report) => report.position === planet.position))
  };
}

function indexedWalletPlanetState(
  indexer: SettlementIndexer,
  planet: ManagedPlanet,
  buildings: InfrastructureState["buildings"] = indexer.infrastructureRows(planet.planetId)
): ManagedPlanet {
  const ships = indexer.shipRows(planet.planetId);
  const defenses = indexer.defenseRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const currentPlanet = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;
  const moonState = indexer.moonState(planet.owner, planet.planetId);

  // The planet roster is a settled-snapshot surface: the external contract<->DB watchdog
  // (and any consumer keyed on lastSettledAt) treats `resources` as the value settled at
  // `lastSettledAt`, so it must equal the chain's stored `planet().resources` at a matched
  // settle time. Keep `resources` canonical and expose the production-accrued "as of now"
  // balance separately as `resourcesAsOfNow` — the same split the infrastructure/shipyard/
  // research endpoints already use (VEY-KANEO-464/488). Tactical/raidable still derive from
  // the accrued state because plunderable loot reflects the live balance, not the snapshot.
  const moonSummary = moonState.moon
    ? {
        bodyKind: "moon" as const,
        exists: true,
        parentPlanetId: planet.planetId,
        planetId: planet.planetId,
        coordinates: planet.coordinates,
        resources: moonState.resources,
        ...(moonState.resourcesAsOfNow ? { resourcesAsOfNow: moonState.resourcesAsOfNow } : {}),
        ships: moonState.ships,
        defenses: moonState.defenses
      }
    : null;

  return {
    ...planet,
    bodyKind: "planet",
    resourcesAsOfNow: currentPlanet.resources,
    resourceSnapshot: resourceSnapshotMetadataForPlanet(planet),
    moon: moonSummary,
    tactical: indexedPlanetTacticalSummary(currentPlanet, buildings, ships, defenses, technologyLevels, indexer)
  };
}

function resourceSnapshotMetadataForPlanet(planet: PlanetState | null): ResourceSnapshotMetadata | null {
  if (!planet) return null;
  const resourceEvent = planet as PlanetState & Partial<Pick<SettledPlanetEvent, "blockNumber" | "logIndex" | "transactionHash">>;
  return {
    planetId: planet.planetId,
    transactionHash: resourceEvent.transactionHash ?? null,
    blockNumber: resourceEvent.blockNumber ?? null,
    logIndex: resourceEvent.logIndex ?? null,
    lastSettledAt: planet.lastSettledAt ?? null,
    resources: planet.resources ?? null
  };
}

function accruedPlanetState<T extends PlanetState | null>(
  indexer: SettlementIndexer,
  planet: T
): T {
  if (!planet) return planet;

  return {
    ...planet,
    resources: accruedResourcesWithBuildingQueue(indexer, planet)
  };
}

// Single current-resource source of truth for wallet, public, and intel resource surfaces (VEY-KANEO-517):
// canonical settled `resources` projected forward to now at the planet's production rate,
// capped at storage. Every endpoint serving "current resources" should call this helper
// instead of re-running `resourcesWithClaimableAccrual` locally, so endpoint values cannot
// diverge or accidentally project an already-current balance a second time.
function indexedCurrentResourcesForPlanet(
  indexer: SettlementIndexer,
  planet: SettledPlanetEvent | null,
  options: { allowPendingResources?: boolean } = {}
): Resources | null {
  return indexedCurrentPlanetState(indexer, planet, options)?.resources ?? null;
}

function indexedCurrentPlanetState<T extends PlanetState>(
  indexer: SettlementIndexer,
  planet: T | null,
  options: { allowPendingResources?: boolean } = {}
): T | null {
  if (!planet) return null;
  if (!options.allowPendingResources && indexer.hasPendingPlanetResources(planet.planetId)) return null;
  return accruedPlanetState(indexer, planet);
}

function indexedPlayerQueues(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): PlayerQueues {
  return indexer.playerQueues(wallet, planet?.planetId ?? settlement.homePlanetId);
}

function indexedFleetVisibility(
  wallet: `0x${string}`,
  _settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  _planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer,
  options: { includeArchive?: boolean; includeJoinableAttacks?: boolean } = {}
): FleetMissionVisibility {
  const visibility = indexer.fleetMissionVisibility(
    wallet,
    {
      ...(options.includeArchive === undefined ? {} : { includeArchive: options.includeArchive }),
      ...(options.includeJoinableAttacks === undefined ? {} : { includeJoinableAttacks: options.includeJoinableAttacks })
    }
  );
  const snapshot = indexedReadSnapshot(indexer);
  return {
    ...visibility,
    indexedRevision: indexer.missionResponseCacheVersion(),
    indexedBlock: snapshot.latestIndexedBlock,
    generatedAt: new Date().toISOString()
  };
}

function expectsBattleReport(mission: FleetMissionSummary): boolean {
  if (!["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(mission.missionType)) return false;
  if (mission.status === "Recalled" || mission.recallProvenance === "FleetMissionRecalled") return false;
  if (mission.status === "Outbound" && Number(mission.arrivalAt) > Math.floor(Date.now() / 1_000)) return false;
  return true;
}

function battleReportMaterializationStatusForMission(indexer: SettlementIndexer, mission: FleetMissionSummary): ReturnType<SettlementIndexer["battleReportMaterializationStatus"]> {
  const direct = indexer.battleReportMaterializationStatus(mission.missionId);
  if (direct.status !== "missing" || !mission.attackGroupId) return direct;
  return indexer.battleReportMaterializationStatus(mission.attackGroupId);
}

function indexedMissionArchive(
  wallet: `0x${string}`,
  url: URL,
  indexer: SettlementIndexer
): FleetMissionArchiveResponse {
  const requested = missionArchivePagination(url);
  // Pagination and filtering happen in SQLite before mission summaries and reports are hydrated.
  // The previous implementation decoded/enriched the wallet's entire completed history and sliced
  // only at the end; production archives with thousands of missions blocked the reader event loop
  // for ~5 seconds and stalled unrelated mission-detail requests on the same worker (VEY-KANEO-737).
  const archive = indexer.fleetMissionArchivePage(wallet, {
    filter: url.searchParams.get("filter"),
    missionNumber: url.searchParams.get("missionNumber"),
    missionType: url.searchParams.get("missionType"),
    page: requested.page,
    pageSize: requested.pageSize,
    planetId: url.searchParams.get("planetId")
  });
  const rows = chronologicalMissionArchiveRows(archive.completedMissions, []);
  const totalEntries = archive.totalEntries;
  const totalPages = Math.max(1, Math.ceil(totalEntries / requested.pageSize));
  const page = archive.page;

  return {
    wallet,
    homePlanetId: archive.homePlanetId,
    rows: attachMissionArchiveReports(rows, indexer.battleReportsForMissions(missionsFromArchiveRows(rows))),
    pagination: {
      page,
      pageSize: requested.pageSize,
      totalEntries,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
}

function indexedMissileAttackArchive(
  wallet: `0x${string}`,
  url: URL,
  indexer: SettlementIndexer
): MissileAttackArchiveResponse {
  const requested = missionArchivePagination(url);
  const archive = indexer.missileAttackArchivePage(wallet, {
    page: requested.page,
    pageSize: requested.pageSize,
    planetId: url.searchParams.get("planetId")
  });
  const totalPages = Math.max(1, Math.ceil(archive.totalEntries / requested.pageSize));
  return {
    wallet,
    homePlanetId: archive.homePlanetId,
    rows: archive.rows,
    pagination: {
      page: archive.page,
      pageSize: requested.pageSize,
      totalEntries: archive.totalEntries,
      totalPages,
      hasPreviousPage: archive.page > 1,
      hasNextPage: archive.page < totalPages
    }
  };
}

function globalMissionArchive(url: URL, indexer: SettlementIndexer): GlobalMissionArchiveResponse {
  const requested = missionArchivePagination(url);
  // Keep the universe-wide archive bounded just like the wallet archive: count/filter/page in
  // SQLite, then hydrate only the visible missions and their materialized report summaries.
  const archive = indexer.globalFleetMissionArchivePage({
    missionNumber: url.searchParams.get("missionNumber"),
    missionType: url.searchParams.get("missionType"),
    page: requested.page,
    pageSize: requested.pageSize,
    planetId: url.searchParams.get("planetId"),
    summaryOnly: url.searchParams.get("summaryOnly") === "true"
  });
  const rows = chronologicalMissionArchiveRows(archive.completedMissions, []);
  const totalEntries = archive.totalEntries;
  const totalPages = Math.max(1, Math.ceil(totalEntries / requested.pageSize));
  const page = archive.page;

  return {
    rows: attachMissionArchiveReports(rows, indexer.battleReportsForMissions(missionsFromArchiveRows(rows))),
    pagination: {
      page,
      pageSize: requested.pageSize,
      totalEntries,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
}

function attachMissionArchiveReports(
  rows: FleetMissionArchiveEntry[],
  battleReports: FleetMissionVisibility["battleReports"]
): FleetMissionArchiveEntry[] {
  if (battleReports.length === 0) return rows;
  const reportsByMissionId = battleReportsByAssociatedMissionId(battleReports);
  return rows.map((row) => {
    if (row.kind !== "mission" || row.report) return row;
    return {
      ...row,
      report: reportsByMissionId.get(row.mission.missionId)
    };
  });
}

function missionsFromArchiveRows(rows: readonly FleetMissionArchiveEntry[]): FleetMissionSummary[] {
  return rows.flatMap((row) => row.kind === "mission" ? [row.mission] : []);
}

function missionArchivePagination(url: URL): { page: number; pageSize: number } {
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25;
  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), 100)
  };
}

function chronologicalMissionArchiveRows(
  completedMissions: FleetMissionSummary[],
  battleReports: FleetMissionVisibility["battleReports"]
): FleetMissionArchiveEntry[] {
  const reportsByMissionId = battleReportsByAssociatedMissionId(battleReports);
  const completedMissionIds = new Set(completedMissions.map((mission) => mission.missionId));
  return [
    ...completedMissions.map((mission): FleetMissionArchiveEntry => ({
      kind: "mission",
      mission,
      report: reportsByMissionId.get(mission.missionId)
    })),
    ...battleReports
      .filter((report) => !associatedBattleReportMissionIds(report).some((missionId) => completedMissionIds.has(missionId)))
      .map((report): FleetMissionArchiveEntry => ({ kind: "battleReport", report })),
  ].sort((left, right) => missionArchiveTimestamp(right) - missionArchiveTimestamp(left));
}

function battleReportsByAssociatedMissionId(
  battleReports: FleetMissionVisibility["battleReports"]
): Map<string, FleetMissionVisibility["battleReports"][number]> {
  const lookup = new Map<string, FleetMissionVisibility["battleReports"][number]>();
  for (const report of battleReports) {
    for (const missionId of associatedBattleReportMissionIds(report)) {
      lookup.set(missionId, report);
    }
  }
  return lookup;
}

function associatedBattleReportMissionIds(report: FleetMissionVisibility["battleReports"][number]): string[] {
  return [report.missionId, ...report.participants.map((participant) => participant.missionId)];
}

function missionArchiveTimestamp(row: FleetMissionArchiveEntry): number {
  if (row.kind === "battleReport") return Number(row.report.blockNumber || "0");
  const mission = row.mission;
  const rawTimestamp = mission.status === "Returned" ? mission.returnAt : mission.arrivalAt;
  const numericTimestamp = Number(rawTimestamp);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return numericTimestamp > 10_000_000_000 ? numericTimestamp : numericTimestamp * 1_000;
  }
  return Number(mission.blockNumber || "0");
}

function indexedInfrastructureState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): InfrastructureState {
  const planetResourcesPending = planet ? indexer.hasPendingPlanetResources(planet.planetId) : false;
  const missionBlockers = planet ? indexer.dueUnresolvedFleetMissionsForPlanet(planet.planetId) : [];
  const missionBlocker = missionBlockers[0];
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];
  const ships = planet ? indexer.shipRows(planet.planetId) : [];
  const queue = planet ? indexer.planetQueue(planet.planetId, "building") : null;
  const technologyLevels = indexer.technologyLevels(wallet);
  const currentPlanet = indexedCurrentPlanetState(indexer, planet);
  const baseDerived = currentPlanet
    ? deriveInfrastructureFields(currentPlanet, buildings, ships, technologyLevels)
    : {
      productionPerHour: null,
      energyBalance: null,
      storageCaps: null,
      protectedResources: null,
      raidableResources: null
    };
  const boostExpiresAt = indexer.inviteeProductionBoostExpiresAt(wallet);
  const boostActive = isInviteeProductionBoostActive(boostExpiresAt);
  const derived = {
    ...baseDerived,
    productionPerHour: effectiveProductionPerHour(indexer, wallet, baseDerived.productionPerHour)
  };

  const missionBlockerDetail = missionBlocker
    ? `Mission resolution is pending for this planet (mission ${missionBlocker.missionId}). The indexer or keeper must settle the due mission before infrastructure upgrades can be started.`
    : undefined;

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    planetId: planet?.planetId ?? settlement.homePlanetId,
    planetLastSettledAt: planetResourcesPending ? null : planet?.lastSettledAt ?? null,
    infrastructureAvailable: !planetResourcesPending && missionBlockers.length === 0,
    unavailableReason: planetResourcesPending
      ? "Infrastructure indexed resources for this planet are still warming. Refresh shortly."
      : missionBlockerDetail
      ? missionBlockerDetail
      : unavailableReason,
    ...(missionBlocker && missionBlockerDetail
      ? {
        actionBlocker: {
          kind: "mission_resolution_pending" as const,
          detail: missionBlockerDetail,
          missionIds: missionBlockers.map((mission) => mission.missionId),
          earliestArrivalAt: missionBlocker.arrivalAt
        },
        stale: true
      }
      : {}),
    resources: planet && !planetResourcesPending ? planet.resources : null,
    resourcesAsOfNow: currentPlanet?.resources ?? null,
    resourceSnapshot: planetResourcesPending ? null : resourceSnapshotMetadataForPlanet(planet),
    ...derived,
    inviteeProductionBoost: boostExpiresAt
      ? { multiplierBps: "20000", expiresAt: boostExpiresAt, active: boostActive }
      : null,
    technologyLevels,
    buildings,
    queue
  };
}

function multiplyResources(resources: Resources | null, multiplier: number): Resources | null {
  if (!resources) return null;
  return {
    metal: (BigInt(resources.metal) * BigInt(multiplier)).toString(),
    crystal: (BigInt(resources.crystal) * BigInt(multiplier)).toString(),
    deuterium: (BigInt(resources.deuterium) * BigInt(multiplier)).toString()
  };
}

function isInviteeProductionBoostActive(expiresAt: string | null | undefined, now = Date.now()): boolean {
  return Number(expiresAt ?? "0") > Math.floor(now / 1_000);
}

function effectiveProductionPerHour(
  indexer: SettlementIndexer,
  owner: `0x${string}`,
  productionPerHour: Resources | null
): Resources | null {
  return isInviteeProductionBoostActive(indexer.inviteeProductionBoostExpiresAt(owner))
    ? multiplyResources(productionPerHour, 2)
    : productionPerHour;
}

function indexedMoonState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): MoonState {
  return indexer.moonState(wallet, planet?.planetId ?? settlement.homePlanetId);
}

function indexedShipyardState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): ShipyardState {
  const shipyardLevel = planet ? indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)?.level ?? 0 : 0;
  const naniteLevel = planet ? indexer.infrastructureRows(planet.planetId).find((building) => building.id === 11)?.level ?? 0 : 0;
  const pendingSlotSettlements = indexer.pendingFleetSlotSettlementMissionsForWallet(wallet);
  const slotSettlementBlocker = pendingSlotSettlements[0];
  const fleetLaunchUnavailableReason = slotSettlementBlocker
    ? `Fleet slot state is waiting for mission settlement (mission ${slotSettlementBlocker.missionId}). Refresh after the backend or keeper settles due fleet missions before launching another fleet.`
    : undefined;

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    planetId: planet?.planetId ?? settlement.homePlanetId,
    productionAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    resourceSnapshot: resourceSnapshotMetadataForPlanet(planet),
    fleetSlots: indexer.fleetSlots(wallet),
    ...(fleetLaunchUnavailableReason
      ? {
        fleetLaunchAvailable: false,
        fleetLaunchUnavailableReason,
        stale: true
      }
      : { fleetLaunchAvailable: true }),
    shipyardLevel,
    naniteLevel,
    technologyLevels: indexer.technologyLevels(wallet),
    // `ships` is the deterministic settled-to-now inventory: canonical evented
    // counts plus per-unit production completions. It is shared with energy and
    // public inventory surfaces so a completed Solar Satellite cannot disappear
    // between queue progress and the next lazy on-chain settlement transaction.
    ships: planet ? indexer.shipRows(planet.planetId, { shipyardLevel, naniteLevel }) : [],
    launchableShips: planet ? indexer.availableShipRows(planet.planetId, { shipyardLevel, naniteLevel }) : [],
    queue: planet ? indexer.planetQueue(planet.planetId, "ship") : null
  };
}

function indexedDefenseState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): DefenseState {
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    productionAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    resourceSnapshot: resourceSnapshotMetadataForPlanet(planet),
    shipyardLevel: buildings.find((building) => building.id === 5)?.level ?? 0,
    naniteLevel: buildings.find((building) => building.id === 11)?.level ?? 0,
    missileSiloLevel: buildings.find((building) => building.id === 14)?.level ?? 0,
    technologyLevels: indexer.technologyLevels(wallet),
    defenses: planet
      ? indexer.defenseRows(planet.planetId, {
          shipyardLevel: buildings.find((building) => building.id === 5)?.level ?? 0,
          naniteLevel: buildings.find((building) => building.id === 11)?.level ?? 0
        })
      : [],
    queue: planet ? indexer.planetQueue(planet.planetId, "defense") : null
  };
}

function indexedResearchState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): ResearchState {
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    planetId: planet?.planetId ?? settlement.homePlanetId,
    researchAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    resourceSnapshot: resourceSnapshotMetadataForPlanet(planet),
    researchLabLevel: buildings.find((building) => building.id === 6)?.level ?? 0,
    researchNetworkLabLevels: [],
    technologyLevels: indexer.technologyLevels(wallet),
    technologies: indexer.technologyRows(wallet, buildings.find((building) => building.id === 6)?.level ?? 0),
    queue: indexer.researchQueue(wallet)
  };
}

function indexedRiftState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer,
  resourceTokenAddresses: {
    metal?: `0x${string}`;
    crystal?: `0x${string}`;
    deuterium?: `0x${string}`;
  }
): RiftState {
  const state = indexer.riftState(wallet, planet?.planetId ?? settlement.homePlanetId);
  return {
    ...state,
    resources: state.resources.map((resource) => ({
      ...resource,
      tokenAddress: resourceTokenAddresses[resource.key] ?? null,
      // Planet resources are the spendable in-game balance. Rift bridge event deltas were only a
      // historical ledger and must not be shown as a player's current mine balance.
      inGameBalance: planet?.resources?.[resource.key] ?? "0"
    }))
  };
}

type GalaxySystemDetail = "summary" | "full";

type GalaxySystemSummaryPlanet = PlanetMetadata & {
  name?: string;
  occupiedBy: ReturnType<typeof occupiedPlanetRef>;
  migrationReservation?: ReturnType<typeof migrationReservationRef>;
  debrisField: ReturnType<typeof debrisFieldRef>;
  hasMoon: boolean;
  moonChance: ReturnType<typeof moonChanceReportRef>;
};

type GalaxySystemFullPlanet = GalaxySystemSummaryPlanet & {
  publicState: ReturnType<typeof publicPlanetStateRef>;
  publicMoonState: ReturnType<typeof publicMoonStateRef>;
};

type GalaxySystemPayload = Omit<SystemSnapshot, "planets"> & {
  planets: Array<GalaxySystemSummaryPlanet | GalaxySystemFullPlanet>;
};

type GalaxySystemCacheEntry = {
  indexerVersion: string;
  payload: GalaxySystemPayload;
};

let materializedUniverseSnapshotStoreWarningEmitted = false;

function cachedGalaxySystemPayload(
  cache: Map<string, GalaxySystemCacheEntry>,
  input: {
    chainId: number;
    settlementContractAddress: string;
    detail: GalaxySystemDetail;
    galaxy: number;
    system: number;
    indexer: SettlementIndexer | undefined;
  }
): GalaxySystemPayload {
  const indexerVersion = galaxySystemCacheVersion(input.indexer, input.detail, input.galaxy, input.system);
  const cacheKey = [
    input.chainId,
    input.settlementContractAddress.toLowerCase(),
    input.detail,
    input.galaxy,
    input.system
  ].join(":");
  const cached = cache.get(cacheKey);
  if (
    cached
    && cached.indexerVersion === indexerVersion
  ) {
    return cached.payload;
  }

  if (input.detail === "summary" && input.indexer) {
    const materialized = input.indexer.materializedUniverseSystemSnapshot(cacheKey, indexerVersion);
    if (materialized) {
      const payload = materialized as GalaxySystemPayload;
      cache.set(cacheKey, {
        indexerVersion,
        payload
      });
      pruneGalaxySystemCache(cache);
      return payload;
    }
  }

  const payload = galaxySystemPayload(input);
  cache.set(cacheKey, {
    indexerVersion,
    payload
  });
  if (input.detail === "summary" && input.indexer) {
    tryStoreMaterializedUniverseSystemSnapshot(input.indexer, cacheKey, indexerVersion, payload);
  }
  pruneGalaxySystemCache(cache);
  return payload;
}

function tryStoreMaterializedUniverseSystemSnapshot(
  indexer: SettlementIndexer,
  cacheKey: string,
  version: string,
  payload: GalaxySystemPayload
): void {
  try {
    indexer.storeMaterializedUniverseSystemSnapshot(cacheKey, version, payload);
  } catch (error) {
    if (!materializedUniverseSnapshotStoreWarningEmitted) {
      console.warn("Veydrift universe system snapshot cache write unavailable", reasonText(error));
      materializedUniverseSnapshotStoreWarningEmitted = true;
    }
  }
}

function galaxySystemCacheVersion(
  indexer: SettlementIndexer | undefined,
  detail: GalaxySystemDetail,
  galaxy: number,
  system: number
): string {
  if (!indexer) return "none";
  return detail === "summary"
    ? indexer.universeSystemSummaryVersion(galaxy, system)
    : indexer.responseCacheVersion();
}

function galaxySystemDetail(url: URL): GalaxySystemDetail {
  return url.searchParams.get("detail") === "full" ? "full" : "summary";
}

function galaxySystemPayload({
  chainId,
  settlementContractAddress,
  detail,
  galaxy,
  system,
  indexer
}: {
  chainId: number;
  settlementContractAddress: string;
  detail: GalaxySystemDetail;
  galaxy: number;
  system: number;
  indexer: SettlementIndexer | undefined;
}): GalaxySystemPayload {
  const baseSnapshot = systemSnapshot(
    chainId,
    settlementContractAddress,
    galaxy,
    system
  );
  const occupied = new Map(
    (indexer?.settledPlanetsInSystem(galaxy, system) ?? []).map((planet) => [
      planet.position,
      planet
    ])
  );
  const reserved = new Map(
    migrationReservedPlanetsInSystem(galaxy, system).map((planet) => [
      planet.position,
      planet
    ])
  );
  const debris = new Map(
    (indexer?.debrisFieldsInSystem(galaxy, system) ?? []).map((field) => [
      field.position,
      field
    ])
  );
  const moonChance = new Map(
    (indexer?.moonChanceReportsInSystem(galaxy, system) ?? []).map((report) => [
      report.position,
      report
    ])
  );
  const allianceIntel = allianceIntelForOccupiedPlanets(
    Array.from(occupied.values()),
    indexer
  );

  return {
    ...baseSnapshot,
    planets: includeOccupiedPlanets(
      baseSnapshot.planets,
      occupied,
      reserved,
      chainId,
      settlementContractAddress,
      galaxy,
      system
    ).map((planet) => {
      const occupiedPlanet = occupied.get(planet.position);
      const occupiedPlanetName = occupiedPlanet?.name?.trim();
      const reservedPlanet = occupiedPlanet ? undefined : reserved.get(planet.position);
      const summary: GalaxySystemSummaryPlanet = {
        ...planet,
        ...(occupiedPlanetName ? { name: occupiedPlanetName } : {}),
        occupiedBy: occupiedPlanetRef(occupiedPlanet, indexer, allianceIntel),
        migrationReservation: migrationReservationRef(reservedPlanet),
        debrisField: debrisFieldRef(debris.get(planet.position)),
        hasMoon: occupiedPlanet ? indexer?.hasMoon(occupiedPlanet.planetId) ?? false : false,
        moonChance: moonChanceReportRef(moonChance.get(planet.position))
      };
      if (detail === "summary") return summary;
      return {
        ...summary,
        publicState: publicPlanetStateRef(occupiedPlanet, indexer),
        publicMoonState: publicMoonStateRef(occupiedPlanet, indexer)
      };
    })
  };
}

function pruneGalaxySystemCache(cache: Map<string, GalaxySystemCacheEntry>): void {
  while (cache.size > 2_048) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function includeOccupiedPlanets(
  planets: readonly PlanetMetadata[],
  occupied: ReadonlyMap<number, SettledPlanetEvent>,
  reserved: ReadonlyMap<number, MigrationReservedPlanet>,
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): PlanetMetadata[] {
  const byPosition = new Map(planets.map((planet) => [planet.position, planet]));

  for (const planet of occupied.values()) {
    byPosition.set(planet.position, {
      ...planetMetadata(chainId, settlementContractAddress, {
        galaxy,
        system,
        position: planet.position
      }),
      fields: planet.fields,
      temperature: planet.temperature,
      metalMultiplierBps: planet.metalMultiplierBps,
      crystalMultiplierBps: planet.crystalMultiplierBps,
      deuteriumMultiplierBps: planet.deuteriumMultiplierBps,
      archetype: planetArchetypeForTemperature(planet.temperature)
    });
  }
  for (const planet of reserved.values()) {
    if (byPosition.has(planet.position)) continue;
    byPosition.set(planet.position, {
      ...planetMetadata(chainId, settlementContractAddress, {
        galaxy,
        system,
        position: planet.position
      }),
      fields: planet.fields,
      temperature: planet.temperature,
      ...planetMultipliers(planet.temperature, planet.fields),
      archetype: planetArchetypeForTemperature(planet.temperature)
    });
  }

  return Array.from(byPosition.values()).sort((left, right) => left.position - right.position);
}

function occupiedPlanetRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined,
  allianceIntel: ReadonlyMap<string, AllianceIdentity> = new Map()
): { planetId: string; owner: string; ownerDisplayName: string | null; alliance: AllianceIdentity | null } | null {
  return planet
    ? {
        planetId: planet.planetId,
        owner: planet.owner,
        ownerDisplayName: indexer?.playerProfile(planet.owner).displayName ?? null,
        alliance: allianceIntel.get(planet.owner.toLowerCase()) ?? null
      }
    : null;
}

function migrationReservationRef(planet: MigrationReservedPlanet | undefined):
  | {
      status: "quantum-unstable";
      label: "Quantum-unstable planet";
      wallet: `0x${string}` | null;
      planetId: string | null;
    }
  | null {
  return planet
    ? {
        status: "quantum-unstable",
        label: "Quantum-unstable planet",
        wallet: planet.wallet ?? null,
        planetId: planet.planetId ?? null
      }
    : null;
}

// The defender side of a battle report: the target planet's current indexed ship/defense
// composition (the surviving force right after a freshly-resolved battle). Only zero-count rows
// are dropped so the frontend can show "None" when the planet had no fleet/defenses. Returns null
// when the target planet is not charted in the indexed read model, in which case the composition
// genuinely cannot be derived and the frontend keeps a precise caveat instead of fabricating data.
function defenderPlanetStateForReport(
  indexer: SettlementIndexer,
  report: ReturnType<SettlementIndexer["battleReport"]>,
  mission: FleetMissionSummary | null
): {
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  stationedDefenders: StationedDefenderSummary[];
} | null {
  if (!report) return null;
  const planet = indexer.planet(report.targetPlanetId);
  if (!planet) return null;
  return {
    fleet: indexer.shipRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0),
    stationedDefenders: report.stationedDefenders ?? indexer.stationedDefendersForBattle(mission, report)
  };
}

function targetCombatIntelForMission(
  indexer: SettlementIndexer,
  mission: FleetMissionSummary
): Pick<RankedHighscorePlanet["tactical"], "combatPower" | "combatShips" | "defenses"> & {
  planetId: string;
  activeMissions: FleetMissionSummary[];
  queues: {
    defense: PlayerQueues["defense"];
    ship: PlayerQueues["ship"];
  };
} | null {
  const planet = indexer.planet(mission.targetPlanetId);
  if (!planet) return null;

  const accrued = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;
  const tactical = indexedPlanetTacticalSummary(
    accrued,
    indexer.infrastructureRows(planet.planetId),
    indexer.shipRows(planet.planetId),
    indexer.defenseRows(planet.planetId),
    indexer.technologyLevels(planet.owner),
    indexer
  );

  return {
    planetId: planet.planetId,
    activeMissions: indexer.activeFleetMissionsForTarget(planet.planetId),
    combatPower: tactical.combatPower,
    combatShips: tactical.combatShips,
    defenses: tactical.defenses,
    queues: {
      defense: indexer.planetQueue(planet.planetId, "defense"),
      ship: indexer.planetQueue(planet.planetId, "ship")
    }
  };
}

function publicPlanetStateRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined
): {
  resources: SettledPlanetEvent["resources"];
  buildings: Array<{ id: number; level: number }>;
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  stationedDefenders: StationedDefenderSummary[];
  stationedDefenderForecastTimeline: StationedDefenderSummary[];
  stationedDefenderTimelineComplete: true;
  research: Array<{ id: number; level: number }>;
  productionPerHour: Resources | null;
  storageCaps: Resources | null;
  queues: {
    building: PlayerQueues["building"];
    defense: PlayerQueues["defense"];
    ship: PlayerQueues["ship"];
    research: PlayerQueues["research"];
  };
} | null {
  if (!planet || !indexer) return null;
  const buildings = indexer.infrastructureRows(planet.planetId);
  const ships = indexer.shipRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const currentPlanet = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;
  const derived = buildings.length > 0
    ? deriveInfrastructureFields(currentPlanet, buildings, ships, technologyLevels)
    : null;

  return {
    resources: currentPlanet.resources,
    buildings: buildings.map(({ id, level }) => ({ id, level })),
    fleet: ships.map(({ id, count }) => ({ id, count })),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })),
    stationedDefenders: indexer.stationedDefendersForPlanet(planet.planetId),
    stationedDefenderForecastTimeline: indexer.stationedDefenderForecastTimelineForPlanet(planet.planetId),
    stationedDefenderTimelineComplete: true,
    research: indexer.technologyRows(planet.owner).map(({ id, level }) => ({ id, level })),
    productionPerHour: effectiveProductionPerHour(
      indexer,
      planet.owner,
      derived?.productionPerHour ?? null
    ),
    storageCaps: derived?.storageCaps ?? null,
    queues: {
      building: indexer.planetQueue(planet.planetId, "building"),
      defense: indexer.planetQueue(planet.planetId, "defense"),
      ship: indexer.planetQueue(planet.planetId, "ship"),
      research: indexer.researchQueue(planet.owner)
    }
  };
}

function publicMoonStateRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined
): {
  fields: number;
  diameterKm: number;
  createdAt: string;
  resources: Resources;
  buildings: Array<{ id: number; level: number }>;
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  queues: {
    building: PlayerQueues["building"];
    defense: PlayerQueues["defense"];
  };
} | null {
  if (!planet || !indexer || !indexer.hasMoon(planet.planetId)) return null;
  const moonState = indexer.moonState(planet.owner, planet.planetId);
  if (!moonState.moon?.exists) return null;

  return {
    fields: moonState.moon.fields,
    diameterKm: moonState.moon.diameterKm,
    createdAt: moonState.moon.createdAt,
    resources: moonState.resources ?? { metal: "0", crystal: "0", deuterium: "0" },
    buildings: moonState.buildings.map(({ id, level }) => ({ id, level })),
    fleet: (moonState.fleet ?? []).map(({ id, count }) => ({ id, count })),
    defenses: moonState.defenses.map(({ id, count }) => ({ id, count })),
    queues: {
      building: moonState.queue,
      defense: moonState.defenseQueue ?? null
    }
  };
}

function resourcesWithClaimableAccrual(
  current: Resources,
  productionPerHour: Resources | null,
  storageCaps: Resources | null,
  lastSettledAt: string,
  now = Date.now(),
  inviteeProductionBoostExpiresAt?: string | null
): Resources {
  if (!productionPerHour || !storageCaps) return current;

  const lastSettledAtSeconds = Number(lastSettledAt);
  if (!Number.isFinite(lastSettledAtSeconds) || lastSettledAtSeconds <= 0) return current;

  const elapsedSeconds = Math.max(0, Math.floor(now / 1_000) - lastSettledAtSeconds);
  const boostedElapsedSeconds = boostedProductionSeconds(
    lastSettledAtSeconds,
    Math.floor(now / 1_000),
    inviteeProductionBoostExpiresAt
  );
  return {
    metal: resourceWithClaimableAccrual(current.metal, productionPerHour.metal, storageCaps.metal, elapsedSeconds, boostedElapsedSeconds),
    crystal: resourceWithClaimableAccrual(current.crystal, productionPerHour.crystal, storageCaps.crystal, elapsedSeconds, boostedElapsedSeconds),
    deuterium: resourceWithClaimableAccrual(current.deuterium, productionPerHour.deuterium, storageCaps.deuterium, elapsedSeconds, boostedElapsedSeconds)
  };
}

function resourceWithClaimableAccrual(
  current: string,
  productionPerHour: string,
  storageCap: string,
  elapsedSeconds: number,
  boostedElapsedSeconds = 0
): string {
  const currentValue = Number(current);
  const rate = Math.max(0, Number(productionPerHour));
  const cap = Number(storageCap);
  if (!Number.isFinite(currentValue) || !Number.isFinite(rate) || !Number.isFinite(cap)) return current;

  const produced = Math.floor((rate * (elapsedSeconds + boostedElapsedSeconds)) / 3_600);
  const remainingCapacity = Math.max(0, cap - currentValue);
  return Math.floor(currentValue + Math.min(produced, remainingCapacity)).toString();
}

function boostedProductionSeconds(
  fromAt: number,
  toAt: number,
  inviteeProductionBoostExpiresAt?: string | null
): number {
  const expiresAt = Number(inviteeProductionBoostExpiresAt ?? "0");
  // The activation event stores its exact end. Production boosts are contractually fixed at
  // seven days, so derive the matching start boundary here as well as on-chain. This matters
  // for migration snapshots whose lastSettledAt predates the claim transaction.
  const startsAt = expiresAt - 7 * 24 * 60 * 60;
  if (!Number.isFinite(expiresAt) || startsAt >= toAt || expiresAt <= fromAt) return 0;
  return Math.max(0, Math.min(toAt, expiresAt) - Math.max(fromAt, startsAt));
}

function accruedResourcesWithBuildingQueue(
  indexer: SettlementIndexer,
  planet: SettledPlanetEvent | PlanetState,
  now = Date.now()
): Resources {
  const lastSettledAtSeconds = Number(planet.lastSettledAt);
  if (!Number.isFinite(lastSettledAtSeconds) || lastSettledAtSeconds <= 0) return planet.resources;

  const nowSeconds = Math.floor(now / 1_000);
  const inviteeProductionBoostExpiresAt = indexer.inviteeProductionBoostExpiresAt(
    planet.owner as `0x${string}`
  );
  if (nowSeconds <= lastSettledAtSeconds) return planet.resources;

  const completed = indexer.completedBuildingQueues(planet.planetId)
    .filter((queue) => typeof queue.itemId === "number" && typeof queue.targetLevel === "number")
    .filter((queue, index, queues) => (
      queues.findIndex((candidate) => (
        candidate.itemId === queue.itemId
          && candidate.targetLevel === queue.targetLevel
          && candidate.readyAt === queue.readyAt
      )) === index
    ))
    .sort(compareQueueReadyAt);

  if (completed.length === 0) {
    const { buildings, ships, technologyLevels } = indexer.resourceProjectionRows(planet.planetId, planet.owner);
    const derived = deriveInfrastructureFields(planet, buildings, ships, technologyLevels);
    return resourcesWithClaimableAccrual(
      planet.resources,
      derived.productionPerHour,
      derived.storageCaps,
      planet.lastSettledAt,
      now,
      inviteeProductionBoostExpiresAt
    );
  }

  const projectionRows = indexer.resourceProjectionRows(planet.planetId, planet.owner);
  let buildings = projectionRows.buildings;
  let resources = planet.resources;
  let cursor = lastSettledAtSeconds;

  for (const queue of completed) {
    const readyAt = Number(queue.readyAt);
    if (!Number.isFinite(readyAt) || readyAt > nowSeconds) continue;

    if (readyAt > cursor) {
      const derived = deriveInfrastructureFields(planet, buildings, projectionRows.ships, projectionRows.technologyLevels);
      resources = resourcesWithClaimableAccrualByElapsed(
        resources,
        derived.productionPerHour,
        derived.storageCaps,
        Math.floor(readyAt - cursor),
        boostedProductionSeconds(cursor, readyAt, inviteeProductionBoostExpiresAt)
      );
      cursor = readyAt;
    }

    buildings = buildings.map((building) => (
      building.id === queue.itemId && typeof queue.targetLevel === "number"
        ? { ...building, level: Math.max(building.level, queue.targetLevel) }
        : building
    ));
  }

  if (nowSeconds > cursor) {
    const derived = deriveInfrastructureFields(planet, buildings, projectionRows.ships, projectionRows.technologyLevels);
    resources = resourcesWithClaimableAccrualByElapsed(
      resources,
      derived.productionPerHour,
      derived.storageCaps,
      Math.floor(nowSeconds - cursor),
      boostedProductionSeconds(cursor, nowSeconds, inviteeProductionBoostExpiresAt)
    );
  }

  return resources;
}

function resourcesWithClaimableAccrualByElapsed(
  current: Resources,
  productionPerHour: Resources | null,
  storageCaps: Resources | null,
  elapsedSeconds: number,
  boostedElapsedSeconds = 0
): Resources {
  if (!productionPerHour || !storageCaps || elapsedSeconds <= 0) return current;
  return {
    metal: resourceWithClaimableAccrual(current.metal, productionPerHour.metal, storageCaps.metal, elapsedSeconds, boostedElapsedSeconds),
    crystal: resourceWithClaimableAccrual(current.crystal, productionPerHour.crystal, storageCaps.crystal, elapsedSeconds, boostedElapsedSeconds),
    deuterium: resourceWithClaimableAccrual(current.deuterium, productionPerHour.deuterium, storageCaps.deuterium, elapsedSeconds, boostedElapsedSeconds)
  };
}

function compareQueueReadyAt(left: QueueState, right: QueueState): number {
  return Number(left.readyAt ?? "0") - Number(right.readyAt ?? "0");
}

function allianceIntelForOccupiedPlanets(
  planets: readonly SettledPlanetEvent[],
  indexer: SettlementIndexer | undefined
): Map<string, AllianceIdentity> {
  return allianceIntelForPlayers(planets.map((planet) => planet.owner), indexer);
}

function allianceIntelForPlayers(
  wallets: readonly string[],
  indexer: SettlementIndexer | undefined
): Map<string, AllianceIdentity> {
  if (!indexer || wallets.length === 0) return new Map();
  return indexer.allianceIntelForPlayers(wallets);
}

function debrisFieldRef(field: IndexedDebrisFieldEvent | undefined): { metal: string; crystal: string } | null {
  return field ? field.resources : null;
}

function indexedDebrisTargetRef(target: IndexedDebrisTarget, indexer: SettlementIndexer) {
  return {
    planetId: target.planet.planetId,
    name: target.planet.name,
    owner: target.planet.owner,
    coordinates: {
      galaxy: target.galaxy,
      system: target.system,
      position: target.position
    },
    archetype: planetArchetypeForTemperature(target.planet.temperature),
    hasMoon: indexer.hasMoon(target.planet.planetId),
    debris: target.resources,
    updatedAtBlock: target.blockNumber,
    transactionHash: target.transactionHash
  };
}

function moonChanceReportRef(report: IndexedMoonChanceReportEvent | undefined): (MoonChanceReportEvent & { status: string }) | null {
  if (!report) return null;
  return {
    ...report,
    status: moonChanceStatus(report)
  };
}

function moonChanceStatus(report: MoonChanceReportEvent): string {
  if (report.eventName === "MoonChanceRequested") return "pending";
  if (report.eventName === "MoonDestructionRequested") return "moon_destruction_pending";
  if (report.eventName === "MoonDestructionFinalized") return report.moonDestroyed ? "moon_destroyed" : "moon_survived";
  if (report.eventName === "MoonChanceSkippedExistingMoon") return "existing_moon_skipped";
  return report.moonCreated ? "created" : "not_created";
}

const maxRandomnessReadinessAgeMs = 30_000;

function currentRandomnessReadiness(
  commitmentStorePath: string,
  required: boolean
): RandomnessReadinessSnapshot {
  if (!required) {
    return { ready: true, reasons: [], updatedAt: new Date(0).toISOString() };
  }
  const snapshot = loadRandomnessReadinessSnapshot(commitmentStorePath);
  const updatedAtMs = snapshot ? Date.parse(snapshot.updatedAt) : Number.NaN;
  if (!snapshot || !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxRandomnessReadinessAgeMs) {
    return {
      ready: false,
      reasons: ["The randomness safety check is unavailable. New attacks are temporarily paused."],
      updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString()
    };
  }
  return snapshot;
}

export function runtimeConfigResponse(workerRole: WorkerRole = envWorkerRole()): Response {
  return Response.json(getRuntimeConfig(workerRole), {
    headers: corsHeaders
  });
}

export function readerBootstrapHealthResponse(workerRole: WorkerRole = envWorkerRole()): Response {
  const loaded = loadBackendConfig();
  const readiness = backendReadiness(loaded.problems, null, null, null);
  const randomnessReadiness = currentRandomnessReadiness(
    loaded.config.randomnessCommitmentStorePath,
    Boolean(loaded.config.randomnessEngineAddress && loaded.config.randomnessFulfillerPrivateKey)
  );
  const healthy = readiness.ready && randomnessReadiness.ready;
  return Response.json(
    {
      ok: healthy,
      service: "veydrift-backend",
      configured: loaded.problems.length === 0,
      backend: backendDeploymentMetadata(workerRole),
      chain: safeConfigSummary(loaded.config),
      readiness,
      chainSync: null,
      missionResolution: null,
      randomnessCommitter: null,
      indexer: null,
      rpc: null,
      randomnessReadiness
    } satisfies HealthPayload & Record<string, unknown>,
    {
      headers: corsHeaders,
      status: healthy ? 200 : 503
    }
  );
}

function getRuntimeConfig(workerRole: WorkerRole = envWorkerRole()): RuntimeConfig {
  const apiUrl = process.env.VEYDRIFT_PUBLIC_API_URL ?? "https://api-test.veydrift.com";
  const graphqlUrl = process.env.VEYDRIFT_PUBLIC_GRAPHQL_URL ?? `${apiUrl}/graphql`;
  const rpcUrl = process.env.VEYDRIFT_RPC_URL ?? "";
  const contractAddress =
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS ??
    process.env.VEYDRIFT_CONTRACT_ADDRESS ??
    null;
  const gameContractAddress =
    process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS ??
    process.env.VEYDRIFT_CONTRACT_ADDRESS ??
    null;
  const migrationContractAddress = process.env.VEYDRIFT_MIGRATION_CONTRACT_ADDRESS ?? null;
  const moonContractAddress = process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS ?? null;
  const randomnessEngineAddress = process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS ?? null;
  const referralSystemAddress = process.env.VEYDRIFT_REFERRAL_SYSTEM_ADDRESS ?? null;
  const referralSignerPrivateKey = process.env.VEYDRIFT_REFERRAL_SIGNER_PRIVATE_KEY;
  const referralSignerAddress = referralSignerPrivateKey && /^0x[a-fA-F0-9]{64}$/.test(referralSignerPrivateKey)
    ? privateKeyToAccount(referralSignerPrivateKey as `0x${string}`).address
    : null;
  const paidAllianceInviteAddress = process.env.VEYDRIFT_PAID_ALLIANCE_INVITE_ADDRESS ?? null;
  const paidAllianceInviteSignerPrivateKey = process.env.VEYDRIFT_PAID_ALLIANCE_INVITE_SIGNER_PRIVATE_KEY;
  const paidAllianceInviteSignerAddress = paidAllianceInviteSignerPrivateKey
    && /^0x[a-fA-F0-9]{64}$/.test(paidAllianceInviteSignerPrivateKey)
      ? privateKeyToAccount(paidAllianceInviteSignerPrivateKey as `0x${string}`).address
      : null;
  const referralStartPriceWei = /^\d+$/.test(process.env.VEYDRIFT_SETTLEMENT_START_PRICE_WEI ?? "")
    ? process.env.VEYDRIFT_SETTLEMENT_START_PRICE_WEI ?? null
    : null;
  const allianceContractAddress = process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS ?? null;
  const burningChickenNftContractAddress = process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS ?? null;
  const burningChickenBurnContractAddress = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS ?? null;
  const burningChickenBurnSelector = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR ?? burningChickenCoordinateBurnSelector;
  const configuredChickenBurnSelector =
    burningChickenBurnSelector.toLowerCase() === burningChickenCoordinateBurnSelector;
  const burningChickenRpcUrl = process.env.VEYDRIFT_BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";
  const resourceTokenAddresses = {
    crystal: process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS ?? null,
    deuterium: process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS ?? null,
    metal: process.env.VEYDRIFT_METAL_TOKEN_ADDRESS ?? null
  };

  return {
    allianceContractAddress,
    apiUrl,
    backend: backendDeploymentMetadata(workerRole),
    burningChicken: {
      burnContractAddress: burningChickenBurnContractAddress,
      burnSelector: burningChickenBurnSelector,
      nftContractAddress: burningChickenNftContractAddress,
      rpcUrl: burningChickenRpcUrl
    },
    chainId: Number.parseInt(process.env.VEYDRIFT_CHAIN_ID ?? "84532", 10),
    contractAddress,
    featureSupport: {
      allianceConfigured: Boolean(allianceContractAddress),
      chickenBurnConfigured: Boolean(
        burningChickenNftContractAddress
          && burningChickenBurnContractAddress
          && configuredChickenBurnSelector
      ),
      gameConfigured: Boolean(gameContractAddress),
      highscoresEndpoint: true,
      migrationConfigured: Boolean(migrationContractAddress),
      moonConfigured: Boolean(moonContractAddress),
      randomnessConfigured: Boolean(randomnessEngineAddress),
      referralsConfigured: Boolean(
        referralSignerAddress
          && referralSystemAddress
          && gameContractAddress
          && referralStartPriceWei
      ),
      researchEndpoint: true,
      resourceTokensConfigured: Boolean(
        resourceTokenAddresses.metal
          && resourceTokenAddresses.crystal
          && resourceTokenAddresses.deuterium
      ),
      settlementConfigured: Boolean(contractAddress)
    },
    gameContractAddress,
    graphqlUrl,
    migrationContractAddress,
    moonContractAddress,
    network: process.env.VEYDRIFT_NETWORK_NAME ?? "Base Sepolia",
    randomnessEngineAddress,
    referralSignerAddress,
    referralStartPriceWei,
    referralSystemAddress,
    paidAllianceInviteAddress,
    paidAllianceInviteSignerAddress,
    resourceTokenAddresses,
    rpcProvider: rpcUrl.includes("alchemy") ? "alchemy" : "unknown"
  };
}

function envWorkerRole(): WorkerRole {
  return process.env[WORKER_ROLE_ENV] === "reader" ? "reader" : "writer";
}

function backendDeploymentMetadata(role: WorkerRole): BackendDeploymentMetadata {
  const parsedIndex = Number.parseInt(process.env[WORKER_INDEX_ENV] ?? (role === "writer" ? "0" : ""), 10);
  const build = backendBuildMetadata(process.env);
  return {
    build,
    worker: {
      count: resolveWorkerCount(process.env, navigator.hardwareConcurrency),
      defaultMaxWorkerCount: DEFAULT_MAX_WORKER_COUNT,
      index: Number.isFinite(parsedIndex) ? parsedIndex : null,
      role
    }
  };
}

export function backendBuildMetadata(
  env: NodeJS.ProcessEnv,
  buildArtifactSha = backendBuildArtifactSha()
): BackendDeploymentMetadata["build"] {
  for (const [source, value] of [
    // The artifact is generated from the checked-out source during the image build. Keep it ahead of
    // service-level environment variables, which Easypanel preserves across deploys and can therefore
    // describe an older image even after the running source has changed.
    ["VEYDRIFT_BUILD_ARTIFACT", buildArtifactSha],
    ["SOURCE_VERSION", env.SOURCE_VERSION],
    ["EASYPANEL_GIT_SHA", env.EASYPANEL_GIT_SHA],
    ["RAILWAY_GIT_COMMIT_SHA", env.RAILWAY_GIT_COMMIT_SHA],
    ["GITHUB_SHA", env.GITHUB_SHA],
    ["COMMIT_SHA", env.COMMIT_SHA],
    ["VEYDRIFT_BUILD_GIT_SHA", env.VEYDRIFT_BUILD_GIT_SHA]
  ] as const) {
    const trimmed = value?.trim();
    if (trimmed) {
      return deploymentBuildMetadata(trimmed, source, env);
    }
  }
  return deploymentBuildMetadata(null, null, env);
}

function deploymentBuildMetadata(
  gitSha: string | null,
  gitShaSource: string | null,
  env: NodeJS.ProcessEnv
): BackendDeploymentMetadata["build"] {
  return {
    deploymentAbiHash: env.VEYDRIFT_DEPLOYMENT_ABI_HASH?.trim() || null,
    deploymentCommit: env.VEYDRIFT_DEPLOYMENT_COMMIT?.trim() || null,
    deploymentTimestamp: env.VEYDRIFT_DEPLOYMENT_TIMESTAMP?.trim() || null,
    gitSha,
    gitShaSource
  };
}

function backendBuildArtifactSha(): string | null {
  for (const path of [
    "../../.veydrift-backend-build-sha",
    ".veydrift-backend-build-sha"
  ]) {
    try {
      const trimmed = readFileSync(path, "utf8").trim();
      if (trimmed) return trimmed;
    } catch {
      // The artifact exists only in deploy images that generate it during build.
    }
  }
  return null;
}

function universeContractAddress(config: BackendConfig): `0x${string}` {
  return (
    config.settlementContractAddress ?? config.gameContractAddress ?? "0x0000000000000000000000000000000000000000"
  );
}

function highscoreFailureResponse(error: unknown): Response {
  if (isRpcTransportError(error)) {
    return Response.json(
      {
        error: "highscores_unavailable",
        detail: error instanceof Error ? error.message : "RPC request failed."
      },
      {
        headers: corsHeaders,
        status: 503
      }
    );
  }

  return errorResponse(error, 400);
}

function highscoreIndexNotReadyResponse(indexer: SettlementIndexer, startedAt: number): Response | null {
  const snapshot = indexedReadSnapshot(indexer);
  if (highscoreIndexCanServe(snapshot)) return null;

  return Response.json(
    {
      error: "highscores_index_not_ready",
      detail: "Rankings are warming from indexed game state.",
      durationMs: Date.now() - startedAt,
      indexer: snapshot,
      retryable: true,
      source: indexedSource
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function highscoreIndexCanServe(snapshot: IndexerSnapshot): boolean {
  if (snapshot.indexedState === "healthy" && snapshot.lastRebuiltAt) return true;

  return Boolean(snapshot.lastRebuiltAt && snapshot.lastReconciledAt && snapshot.indexedPlanets > 0);
}

function isRpcTransportError(error: unknown): boolean {
  return error instanceof Error && (/^RPC(?: HTTP)?\b/.test(error.message) || isLiveWalletReadTimeout(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type RankedHighscoreEntry = HighscoreEntry & {
  alliance: AllianceIdentity | null;
  attackProtection: RankedHighscoreAttackProtection | null;
  displayName: string | null;
  homePlanet: RankedHighscorePlanet | null;
  planets: RankedHighscorePlanet[];
  rank: number;
};

type RankedReferralHistoryResponse = Omit<ReferralHistoryResponse, "entries"> & {
  entries: Array<ReferralHistoryResponse["entries"][number] & {
    ranking: RankedHighscoreEntry | null;
  }>;
};

type RankedHighscoreAttackProtection = Pick<AttackProtectionStatus, "allowed" | "atWar" | "blockedReason" | "blockedReasonLabel" | "defenderInactive" | "scoreComparison" | "targetAlliance">;

type RankedHighscorePlanet = {
  planetId: string;
  name: string | null;
  coordinates: {
    galaxy: number;
    system: number;
    position: number;
  };
  archetype: ReturnType<typeof planetArchetypeForTemperature>;
  hasMoon: boolean;
  moon: {
    exists: boolean;
    resources: Resources | null;
    resourcesAsOfNow?: Resources | null;
  } | null;
  stationedDefenderForecastTimeline: StationedDefenderSummary[];
  // Highscore discovery rows intentionally omit this expensive per-target forecast; selected
  // targets are hydrated from the public system endpoint before an attack preview.
  stationedDefenderTimelineComplete: boolean;
  tactical: {
    currentResources: Resources;
    raidableResources: Resources;
    raidableResourceTotal: string;
    // Full production-accrued public resources (metal + crystal + deuterium) the planet
    // currently holds — the same figure the public universe/planet surface exposes. LOOT
    // (`raidableResourceTotal`) is the ~50% on-chain plunder of this base, so surfacing the
    // gross total lets the UI show why LOOT reads lower than the planet's full stockpile and
    // stops it from being misread as missing accrual. (VEY-KANEO-454)
    grossResourceTotal: string;
    productionPerHour: Resources | null;
    storageCaps: Resources | null;
    ships: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    defenses: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    combatShips: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    combatTechLevels: {
      weapons: number;
      shielding: number;
      armor: number;
    };
    combatPower: string;
  };
};

type RankedTacticalUnitBreakdown = {
  id: number;
  count: number;
  power: string;
};

type HighscoreCategory = keyof ScoreBreakdown;

function rankedReferralHistory(
  history: ReferralHistoryResponse,
  indexer: SettlementIndexer
): RankedReferralHistoryResponse {
  const wallets = [...new Set(history.entries.map(({ commander }) => commander.wallet.toLowerCase()))];
  if (wallets.length === 0) return { ...history, entries: [] };

  const leaderboard = indexer.highscoreLeaderboard();
  const highscoreByWallet = new Map(
    leaderboard.entries.map((entry) => [entry.wallet.toLowerCase(), entry])
  );
  const rankByWallet = new Map(
    sortedHighscores(leaderboard.entries, "total")
      .map((entry, index) => [entry.wallet.toLowerCase(), index + 1])
  );
  const invitedEntries = wallets
    .map((wallet) => highscoreByWallet.get(wallet))
    .filter((entry): entry is HighscoreEntry => Boolean(entry));
  const rows = highscoreRows(
    invitedEntries,
    leaderboard.planetsByOwner,
    indexer.playerProfiles(wallets),
    allianceIntelForPlayers(wallets, indexer),
    indexer
  );

  return {
    ...history,
    entries: history.entries.map((entry) => {
      const wallet = entry.commander.wallet.toLowerCase();
      const row = rows.get(wallet);
      return {
        ...entry,
        ranking: row
          ? {
              ...row,
              rank: rankByWallet.get(wallet) ?? 0
            }
          : null
      };
    })
  };
}

type HighscoreCurrentPlayerPage = {
  rank: number;
  page: number;
};

type HighscoreRankingsByCategory = Record<HighscoreCategory, HighscoreEntry[]>;

function highscorePagination(url: URL): { page: number; pageSize: number } {
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? String(limit), 10) || limit;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const maxPageSize = url.searchParams.has("category") ? 250 : 50;

  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), maxPageSize)
  };
}

function highscoreRequestedCategories(url: URL): readonly HighscoreCategory[] {
  const requested = url.searchParams.get("category");
  if (!requested) return highscoreCategories;
  return highscoreCategories.includes(requested as HighscoreCategory) ? [requested as HighscoreCategory] : highscoreCategories;
}

function sortedHighscoreRankings(
  entries: HighscoreEntry[],
  categories: readonly HighscoreCategory[] = highscoreCategories
): HighscoreRankingsByCategory {
  const requested = new Set(categories);
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      requested.has(category) ? sortedHighscores(entries, category) : []
    ])
  ) as HighscoreRankingsByCategory;
}

function highscoreVisibleEntries(
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  limit: number,
  offset: number
): HighscoreEntry[] {
  const rows = new Map<string, HighscoreEntry>();
  for (const category of categories) {
    for (const entry of sortedRankings[category].slice(offset, offset + limit)) {
      rows.set(entry.wallet.toLowerCase(), entry);
    }
  }
  return [...rows.values()];
}

function highscoreRankingWallets(entries: readonly HighscoreEntry[], currentWallet: string | null): string[] {
  const wallets = new Set(entries.map((entry) => entry.wallet.toLowerCase()));
  if (currentWallet && /^0x[a-fA-F0-9]{40}$/.test(currentWallet)) {
    wallets.add(currentWallet.toLowerCase());
  }
  return [...wallets];
}

function highscoreCurrentPlayerPages(
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  pageSize: number,
  wallet: string | null
): { wallet: string; rankings: Record<HighscoreCategory, HighscoreCurrentPlayerPage | null> } | undefined {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return undefined;

  const normalizedWallet = wallet.toLowerCase();
  const requested = new Set(categories);
  const rankings = Object.fromEntries(
    highscoreCategories.map((category) => {
      if (!requested.has(category)) return [category, null];
      const index = sortedRankings[category].findIndex((entry) => entry.wallet.toLowerCase() === normalizedWallet);
      const rank = index === -1 ? null : index + 1;
      return [
        category,
        rank === null
          ? null
          : {
              rank,
              page: Math.max(1, Math.ceil(rank / pageSize))
            }
      ];
    })
  ) as Record<HighscoreCategory, HighscoreCurrentPlayerPage | null>;

  return {
    wallet: normalizedWallet,
    rankings
  };
}

function highscoreAttackProtectionRequested(url: URL): boolean {
  const value = url.searchParams.get("includeAttackProtection") ?? "";
  return /^(1|true|yes)$/i.test(value);
}

function highscoreRankings(
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  limit: number,
  offset: number,
  rows: Map<string, RankedHighscoreEntry>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  const requested = new Set(categories);
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      requested.has(category) ? rankHighscores(sortedRankings[category], limit, offset, rows) : []
    ])
  ) as Record<HighscoreCategory, RankedHighscoreEntry[]>;
}

function highscoreRankingRows(rankings: Record<HighscoreCategory, RankedHighscoreEntry[]>): RankedHighscoreEntry[] {
  return Object.values(rankings).flat();
}

function highscoreRankingsWithProtection(
  rankings: Record<HighscoreCategory, RankedHighscoreEntry[]>,
  protection: ReadonlyMap<string, RankedHighscoreAttackProtection | null>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      rankings[category].map((row) => ({
        ...row,
        attackProtection: rankedHighscoreRowProtection(row, protection)
      }))
    ])
  ) as Record<HighscoreCategory, RankedHighscoreEntry[]>;
}

function rankedHighscoreRowProtection(
  row: RankedHighscoreEntry,
  protection: ReadonlyMap<string, RankedHighscoreAttackProtection | null>
): RankedHighscoreAttackProtection | null {
  const statuses = row.planets
    .map((planet) => protection.get(planet.planetId) ?? null)
    .filter((status): status is RankedHighscoreAttackProtection => Boolean(status));

  return statuses.find((status) => status.blockedReason === "score_protection")
    ?? statuses.find((status) => !status.allowed)
    ?? statuses[0]
    ?? null;
}

function highscoreRows(
  entries: HighscoreEntry[],
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>,
  profiles: ReadonlyMap<string, PlayerProfile> = new Map(),
  allianceIntel: ReadonlyMap<string, AllianceIdentity> = new Map(),
  indexer?: SettlementIndexer | undefined
): Map<string, RankedHighscoreEntry> {
  return new Map(
    entries.map((entry) => {
      const planets = rankedHighscorePlanets(entry, planetsByOwner, indexer);
      const homePlanet = rankedHighscoreHomePlanet(entry, planets);
      return [
        entry.wallet.toLowerCase(),
        {
          ...entry,
          alliance: allianceIntel.get(entry.wallet.toLowerCase()) ?? null,
          attackProtection: null,
          displayName: profiles.get(entry.wallet.toLowerCase())?.displayName ?? null,
          homePlanet,
          planets,
          rank: 0
        }
      ];
    })
  );
}

function rankHighscores(
  sortedEntries: HighscoreEntry[],
  limit: number,
  offset: number,
  rows: ReadonlyMap<string, RankedHighscoreEntry>
): RankedHighscoreEntry[] {
  return sortedEntries.slice(offset, offset + limit)
    .map((entry, index) => {
      const row = rows.get(entry.wallet.toLowerCase())!;
      return {
        ...row,
        rank: offset + index + 1
      };
    });
}

function rankedHighscoreIndexedProtectionLookup(
  rows: Iterable<RankedHighscoreEntry>,
  entries: readonly HighscoreEntry[],
  allianceIntel: ReadonlyMap<string, AllianceIdentity>,
  currentWallet: string | null | undefined,
  includeAttackProtection: boolean,
  indexer?: SettlementIndexer | undefined
): Map<string, RankedHighscoreAttackProtection | null> {
  if (!includeAttackProtection || !currentWallet || !/^0x[a-fA-F0-9]{40}$/.test(currentWallet)) return new Map();

  const normalizedCurrentWallet = currentWallet.toLowerCase();
  const attacker = entries.find((entry) => entry.wallet.toLowerCase() === normalizedCurrentWallet);
  if (!attacker) return new Map();

  const rankedRows = [...rows];
  const statuses = new Map<string, RankedHighscoreAttackProtection | null>();
  // VEY-KANEO-489 follow-up: score-protection must use the contract's _totalUserScore (cached on the
  // leaderboard entry), not the resource-based category total (which made everyone read as a newbie).
  const attackerScore = BigInt(attacker.totalUserScore);
  const attackerAlliance = allianceIntel.get(normalizedCurrentWallet) ?? null;
  // VEY-KANEO-489: the bashing window is per-(attacker, defender, planet), so it is evaluated per planet
  // rather than once per defender row. Alliance/score gates above are defender-level and short-circuit
  // first, matching the contract's precedence (same_alliance -> score_protection -> bashing_limit).
  const launchSecondsByTarget = indexer?.attackLaunchSecondsByTarget(normalizedCurrentWallet as `0x${string}`)
    ?? new Map<string, number[]>();
  const playerActivity = indexer?.playerLastActiveSeconds([...new Set(rankedRows.map((row) => row.wallet))])
    ?? new Map<string, number>();
  const nowSeconds = Math.floor(Date.now() / 1_000);
  for (const row of rankedRows) {
    const defenderInactive = indexedDefenderInactive(playerActivity.get(row.wallet.toLowerCase()), nowSeconds);
    const rowAlliance = row.alliance ?? null;
    const atWar = indexer?.allianceRelationship(attackerAlliance?.allianceId, rowAlliance?.allianceId) === "war";
    const scoreProtected = !defenderInactive
      && !atWar
      && isIndexedScoreProtected(attackerScore, BigInt(row.totalUserScore));
    const scoreComparison = attackProtectionScoreComparison(attacker, row, scoreProtected);
    const status = indexedScoreProtectionStatus(
      attackerScore,
      BigInt(row.totalUserScore),
      scoreComparison,
      attackerAlliance,
      indexer,
      normalizedCurrentWallet,
      row,
      defenderInactive
    );
    for (const planet of row.planets) {
      const bashingLimited = status?.allowed
        && status.atWar !== true
        && !defenderInactive
        && indexedBashingLimitReached(launchSecondsByTarget.get(planet.planetId) ?? [], nowSeconds);
      statuses.set(planet.planetId, bashingLimited
        ? {
            allowed: false,
            blockedReason: "bashing_limit",
            blockedReasonLabel: attackBlockReasonLabel("bashing_limit"),
            defenderInactive,
            scoreComparison,
            ...(row.alliance ? { targetAlliance: row.alliance } : {})
          }
        : status);
    }
  }

  return statuses;
}

function indexedScoreProtectionStatus(
  attackerScore: bigint,
  defenderScore: bigint,
  scoreComparison: NonNullable<AttackProtectionStatus["scoreComparison"]>,
  attackerAlliance: AllianceIdentity | null,
  indexer: SettlementIndexer | undefined,
  currentWallet: string,
  row: RankedHighscoreEntry,
  defenderInactive: boolean
): RankedHighscoreAttackProtection | null {
  const defenderAlliance = row.alliance ?? null;
  if (row.wallet.toLowerCase() === currentWallet) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive,
      scoreComparison,
      ...(defenderAlliance ? { targetAlliance: defenderAlliance } : {})
    };
  }

  if (
    attackerAlliance
    && defenderAlliance
    && attackerAlliance.allianceId !== "0"
    && attackerAlliance.allianceId === defenderAlliance.allianceId
  ) {
    return {
      allowed: false,
      blockedReason: "same_alliance",
      blockedReasonLabel: attackBlockReasonLabel("same_alliance"),
      defenderInactive,
      scoreComparison,
      targetAlliance: defenderAlliance
    };
  }

  const atWar = indexer?.allianceRelationship(attackerAlliance?.allianceId, defenderAlliance?.allianceId) === "war";
  if (defenderInactive || atWar || !isIndexedScoreProtected(attackerScore, defenderScore)) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive,
      scoreComparison,
      ...(atWar ? { atWar: true } : {}),
      ...(defenderAlliance ? { targetAlliance: defenderAlliance } : {})
    };
  }

  return {
    allowed: false,
    blockedReason: "score_protection",
    blockedReasonLabel: attackBlockReasonLabel("score_protection"),
    defenderInactive,
    scoreComparison,
    ...(defenderAlliance ? { targetAlliance: defenderAlliance } : {})
  };
}

function attackProtectionScoreComparison(
  attacker: Pick<HighscoreEntry, "score" | "totalUserScore">,
  defender: Pick<HighscoreEntry, "score" | "totalUserScore">,
  protectedByScore: boolean
): NonNullable<AttackProtectionStatus["scoreComparison"]> {
  return {
    scoreType: "contract_total_user_score",
    attackerScore: attacker.totalUserScore,
    defenderScore: defender.totalUserScore,
    attackerVisibleScore: attacker.score.total,
    defenderVisibleScore: defender.score.total,
    protected: protectedByScore
  };
}

function isIndexedScoreProtected(attackerScore: bigint, defenderScore: bigint): boolean {
  const attackerRatio = indexedNewbieProtectionRatioBps(attackerScore);
  const defenderRatio = indexedNewbieProtectionRatioBps(defenderScore);
  if (attackerRatio === 0n && defenderRatio === 0n) return false;
  if (defenderRatio !== 0n && attackerScore * 10_000n > defenderScore * defenderRatio) return true;
  if (attackerRatio !== 0n && defenderScore * 10_000n > attackerScore * attackerRatio) return true;
  return false;
}

function indexedNewbieProtectionRatioBps(score: bigint): bigint {
  if (score < 50_000n) return 15_000n;
  if (score < 500_000n) return 100_000n;
  return 0n;
}

// VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS (24h) / MAX_ATTACKS_PER_BASHING_WINDOW. Mirrored
// here so the indexed attack-protection preview reports bashing_limit the same way the contract gates
// it, without a live attackProtectionStatus read (VEY-KANEO-489).
const BASHING_WINDOW_SECONDS = 86_400;
const MAX_ATTACKS_PER_BASHING_WINDOW = 6;
const PLAYER_INACTIVE_SECONDS = 7 * 24 * 60 * 60;

// Mirror of VeydriftGameStorage._recordAttack + _currentAttackCount + isBashingLimitReached: replay the
// attacker's prior Attack launches against one (defender, planet) in block order to derive the live
// window count, then compare against the cap. The window is anchored at the first launch and re-anchors
// whenever a launch lands >= 24h after the current anchor (matching the contract's reset), and the count
// only stands while now is still inside that 24h window. `launchSeconds` must be ascending.
// Alliance-war and inactivity bypasses are applied by the callers before this helper runs.
function indexedBashingLimitReached(launchSeconds: readonly number[], nowSeconds: number): boolean {
  let windowStartedAt = 0;
  let count = 0;
  for (const launchedAt of launchSeconds) {
    if (windowStartedAt === 0 || launchedAt >= windowStartedAt + BASHING_WINDOW_SECONDS) {
      windowStartedAt = launchedAt;
      count = 1;
    } else {
      count += 1;
    }
  }
  const windowActive = windowStartedAt !== 0 && nowSeconds < windowStartedAt + BASHING_WINDOW_SECONDS;
  const currentCount = windowActive ? count : 0;
  return currentCount >= MAX_ATTACKS_PER_BASHING_WINDOW;
}

function indexedDefenderInactive(lastActiveAt: number | undefined, nowSeconds: number): boolean {
  return lastActiveAt !== undefined
    && lastActiveAt > 0
    && nowSeconds >= lastActiveAt + PLAYER_INACTIVE_SECONDS;
}

function sortedHighscores(entries: HighscoreEntry[], category: HighscoreCategory): HighscoreEntry[] {
  return [...entries].sort((left, right) => {
    const delta = BigInt(highscoreSortValue(right, category)) - BigInt(highscoreSortValue(left, category));
    if (delta !== 0n) return delta > 0n ? 1 : -1;
    return left.wallet.localeCompare(right.wallet);
  });
}

function highscoreSortValue(entry: HighscoreEntry, category: HighscoreCategory): string {
  return category === "total" ? entry.totalUserScore : entry.score[category];
}

function rankedHighscorePlanets(
  entry: HighscoreEntry,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>,
  indexer?: SettlementIndexer | undefined
): RankedHighscorePlanet[] {
  const technologyLevels = indexer ? indexer.technologyLevels(entry.wallet) : {};
  return (planetsByOwner.get(entry.wallet.toLowerCase()) ?? []).map((planet) => {
    const ships = indexer?.shipRows(planet.planetId) ?? [];
    const defenses = indexer?.defenseRows(planet.planetId) ?? [];
    const buildings = indexer?.infrastructureRows(planet.planetId) ?? [];
    // Accrue production before computing raidable loot so the Raid Target Finder / Rankings
    // tactical intel matches the resources the public planet read (`GET /planets/{id}`) shows.
    // Without this the snapshot's stored resources under-report LOOT versus the planet's live,
    // accrued public resources. (VEY-KANEO-454)
    const accrued = indexer
      ? indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet
      : planet;
    const tactical = indexedPlanetTacticalSummary(
      accrued,
      buildings,
      ships,
      defenses,
      technologyLevels,
      indexer
    );
    // Most ranked planets do not have moons. moonState() hydrates resources, buildings, defenses,
    // fleets, and queues, so calling it unconditionally turned one rankings page into hundreds of
    // unnecessary SQLite queries. The indexed primary-key existence lookup lets the common no-moon
    // path stay O(1) per planet (VEY-KANEO-737).
    const hasMoon = indexer?.hasMoon(planet.planetId) ?? false;
    const moonState = hasMoon ? indexer?.moonState(planet.owner, planet.planetId) : undefined;
    const moon = moonState?.moon
      ? {
          exists: true,
          resources: moonState.resources ?? null,
          ...(moonState.resourcesAsOfNow ? { resourcesAsOfNow: moonState.resourcesAsOfNow } : {})
        }
      : null;

    return {
      planetId: planet.planetId,
      name: planet.name,
      coordinates: {
        galaxy: planet.galaxy,
        system: planet.system,
        position: planet.position
      },
      archetype: planetArchetypeForTemperature(planet.temperature),
      hasMoon,
      moon,
      // Highscore rows are a discovery surface, not an authoritative combat read. Building a
      // future stationed-defender timeline for every visible planet repeatedly walks active
      // DefenseHold state and made cold Rankings/Raid Finder requests take tens of seconds in
      // production. The client already hydrates the selected target from its public system
      // payload before showing an attack preview, so advertise this list as compact and defer
      // that exact, per-target work until the player selects an attack. (VEydrift perf)
      stationedDefenderForecastTimeline: [],
      stationedDefenderTimelineComplete: false,
      tactical
    };
  });
}

export function indexedPlanetTacticalSummary(
  planet: PlanetState,
  buildings: InfrastructureState["buildings"],
  ships: ShipyardState["ships"],
  defenses: DefenseState["defenses"],
  technologyLevels: Record<string, number>,
  indexer?: SettlementIndexer
): RankedHighscorePlanet["tactical"] {
  const fallbackResources = planet.resources ?? { metal: "0", crystal: "0", deuterium: "0" };
  const derived = buildings.length > 0
    ? deriveInfrastructureFields(planet, buildings, ships, technologyLevels)
    : null;
  const raidableResources = derived?.raidableResources ?? fallbackResources;
  const shipSummary = tacticalUnitSummary(ships);
  const defenseSummary = tacticalUnitSummary(defenses);
  // COMBAT is a fighting-strength figure, not a raw inventory value: stationary
  // support ships are excluded even though they remain in the ship totals above.
  // Mobile cargo/support hulls still count because they can be committed to
  // Attack/Raid combat and should not read as harmless. (VEY-KANEO-450)
  const combatShipSummary = tacticalUnitSummary(ships.filter((ship) => isCombatShipId(ship.id)));

  return {
    currentResources: fallbackResources,
    raidableResources,
    raidableResourceTotal: resourceTotal(raidableResources).toString(),
    // `planet` here is already production-accrued (see `accruedPlanetState` at the Finder/
    // Rankings call sites), so its resources match the public universe surface. This is the
    // full stockpile LOOT is plundered from at the ~50% on-chain rate. (VEY-KANEO-454)
    grossResourceTotal: resourceTotal(fallbackResources).toString(),
    productionPerHour: indexer
      ? effectiveProductionPerHour(indexer, planet.owner, derived?.productionPerHour ?? null)
      : derived?.productionPerHour ?? null,
    storageCaps: derived?.storageCaps ?? null,
    ships: {
      ...shipSummary,
      units: tacticalUnitBreakdown(ships),
    },
    defenses: {
      ...defenseSummary,
      units: tacticalUnitBreakdown(defenses),
    },
    combatShips: {
      ...combatShipSummary,
      units: tacticalUnitBreakdown(ships.filter((ship) => isCombatShipId(ship.id))),
    },
    combatTechLevels: {
      weapons: Math.max(0, Math.trunc(technologyLevels["5"] ?? 0)),
      shielding: Math.max(0, Math.trunc(technologyLevels["6"] ?? 0)),
      armor: Math.max(0, Math.trunc(technologyLevels["7"] ?? 0))
    },
    combatPower: (BigInt(combatShipSummary.power) + BigInt(defenseSummary.power)).toString()
  };
}

function tacticalUnitSummary(units: Array<{ count: number; cost?: Resources | null | undefined }>): { count: number; power: string } {
  return units.reduce((summary, unit) => {
    const count = Math.max(0, unit.count);
    return {
      count: summary.count + count,
      power: (BigInt(summary.power) + resourceTotal(unit.cost ?? null) * BigInt(count)).toString()
    };
  }, { count: 0, power: "0" } as { count: number; power: string });
}

function tacticalUnitBreakdown(units: Array<{ id: number; count: number; cost?: Resources | null | undefined }>): RankedTacticalUnitBreakdown[] {
  return units
    .map((unit) => {
      const count = Math.max(0, unit.count);
      return {
        id: unit.id,
        count,
        power: (resourceTotal(unit.cost ?? null) * BigInt(count)).toString()
      };
    })
    .filter((unit) => unit.count > 0);
}

function resourceTotal(resources: Resources | null | undefined): bigint {
  if (!resources) return 0n;
  return safeBigInt(resources.metal) + safeBigInt(resources.crystal) + safeBigInt(resources.deuterium);
}

function safeBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function rankedHighscoreHomePlanet(
  entry: HighscoreEntry,
  planets: readonly RankedHighscorePlanet[]
): RankedHighscorePlanet | null {
  if (!entry.homePlanetId) return null;
  return planets.find((candidate) => candidate.planetId === entry.homePlanetId) ?? null;
}

type IndexedReadLookupContext = Record<string, string | number | boolean | null | undefined>;

function indexedReadNotReadyResponse(
  surface: string,
  indexer: SettlementIndexer | undefined,
  lookup: IndexedReadLookupContext = {}
): Response {
  const snapshot = indexer?.snapshot() ?? null;
  const reason = snapshot?.safeToServeIndexedState === true
    && (surface !== "alliance" || snapshot.safeToServeAllianceState === true)
    ? "missing_indexed_row"
    : "index_not_ready";
  console.warn(
    reason === "missing_indexed_row"
      ? "Frontend indexed read missing indexed row"
      : "Frontend indexed read is not ready",
    {
      surface,
      reason,
      lookup,
      indexer: snapshot,
      source: indexedSource
    }
  );

  return Response.json(
    {
      error: "indexed_read_not_ready",
      detail: `${surface} is not available from indexed contract state yet. Refresh shortly.`,
      indexer: snapshot,
      reason,
      lookup,
      retryable: true,
      source: indexedSource
    },
    {
      headers: indexedStateHeaders(snapshot ? "not-ready" : "unavailable"),
      status: 503
    }
  );
}

function indexedSettlementFundingResponse(
  indexer: SettlementIndexer | undefined,
  config: BackendConfig,
  wallet?: `0x${string}`
): Response {
  // Frontend API reads never trigger backend RPC. The wallet-specific native ETH
  // balance is checked by the wallet at submission time; the mutable start price
  // comes from the persisted StartPriceUpdated/canonical-rebuild projection.
  const settlement = wallet && indexer ? indexer.walletSettlement(wallet) : null;
  const reservation = wallet ? migrationReservationPayloadForWallet(
    wallet,
    Boolean(settlement?.homePlanetId && settlement.homePlanetId === migrationReservedPlanetsForWallet(wallet)[0]?.planetId)
  ) : null;
  const migrationClaim = wallet && !reservation?.claimed ? migrationClaimPayloadForWallet(wallet) : null;
  const resourceTokensConfigured = Boolean(
    config.resourceTokenAddresses.metal
      && config.resourceTokenAddresses.crystal
      && config.resourceTokenAddresses.deuterium
  );
  if (!hasWarmPlanetIndex(indexer) && !migrationClaim) {
    return indexedReadNotReadyResponse("settlement funding", indexer, { wallet });
  }
  if (!indexer) {
    return indexedReadNotReadyResponse("settlement funding", indexer, { wallet });
  }
  const startPriceWei = indexer.currentStartPriceWei();

  return indexedJsonResponse({
    affordable: Boolean(startPriceWei) && resourceTokensConfigured,
    balanceWei: null,
    contractKind: "game",
    startPriceWei,
    ...(migrationClaim ? { migrationClaim } : {}),
    ...(reservation ? { migrationReservation: reservation } : {}),
    ...(resourceTokensConfigured
      ? {}
      : { unavailableReason: "Resource token reserves are not configured for this game deployment yet." }),
    ...(resourceTokensConfigured && !startPriceWei
      ? { unavailableReason: "Settlement start price is not available from indexed contract state yet." }
      : {})
  }, indexer.snapshot());
}

function migrationClaimPayloadFields(wallet: `0x${string}`):
  | { migrationClaim: MigrationClaimPayload }
  | Record<string, never> {
  const migrationClaim = migrationClaimPayloadForWallet(wallet);
  return migrationClaim ? { migrationClaim } : {};
}

function migrationReservationPayloadFields(
  wallet: `0x${string}`,
  settlement?: ReturnType<SettlementIndexer["walletSettlement"]>
):
  | { migrationReservation: MigrationReservedPlanet & { exists: true; claimed: boolean } }
  | Record<string, never> {
  const reservation = migrationReservationPayloadForWallet(
    wallet,
    Boolean(settlement?.homePlanetId && settlement.homePlanetId === migrationReservedPlanetsForWallet(wallet)[0]?.planetId)
  );
  return reservation ? { migrationReservation: reservation } : {};
}

function migrationReservationPayloadForWallet(
  wallet: `0x${string}`,
  claimed: boolean
): (MigrationReservedPlanet & { exists: true; claimed: boolean }) | null {
  const reservation = migrationReservedPlanetsForWallet(wallet)[0];
  return reservation ? { ...reservation, exists: true, claimed } : null;
}

function migrationClaimPayloadForWallet(wallet: `0x${string}`): MigrationClaimPayload | null {
  const path = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const claims = migrationClaimMap(parsed);
    const candidate = claims?.[wallet.toLowerCase()];
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    const statePayload = record.statePayload ?? record.payload;
    const signature = record.signature;
    if (isHexString(statePayload) && isHexString(signature)) {
      return { statePayload, signature };
    }
  } catch (error) {
    console.warn("Veydrift migration payload snapshot unavailable", reasonText(error));
  }
  return null;
}

function migrationReservedPlanetsForWallet(wallet: `0x${string}`): MigrationReservedPlanet[] {
  const path = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const claims = migrationClaimMap(parsed);
    const candidate = claims?.[wallet.toLowerCase()];
    if (!candidate || typeof candidate !== "object") return [];
    return migrationReservedPlanetList((candidate as Record<string, unknown>).reservedPlanets, wallet);
  } catch (error) {
    console.warn("Veydrift migration reserved planet snapshot unavailable", reasonText(error));
  }
  return [];
}

function migrationReservedPlanetsInSystem(galaxy: number, system: number): MigrationReservedPlanet[] {
  const path = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const claims = migrationClaimMap(parsed);
    if (!claims) return [];
    return Object.entries(claims).flatMap(([wallet, candidate]) => {
      if (!candidate || typeof candidate !== "object") return [];
      return migrationReservedPlanetList(
        (candidate as Record<string, unknown>).reservedPlanets,
        wallet as `0x${string}`
      ).filter((planet) => planet.galaxy === galaxy && planet.system === system);
    });
  } catch (error) {
    console.warn("Veydrift migration reserved planet snapshot unavailable", reasonText(error));
  }
  return [];
}

function migrationReservedPlanetList(value: unknown, wallet: `0x${string}`): MigrationReservedPlanet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const galaxy = numberField(record.galaxy);
    const system = numberField(record.system);
    const position = numberField(record.position);
    const fields = numberField(record.fields);
    const temperature = numberField(record.temperature);
    if (
      galaxy === null || system === null || position === null ||
      fields === null || temperature === null
    ) return [];
    return [{
      ...(typeof record.planetId === "string" ? { planetId: record.planetId } : {}),
      galaxy,
      system,
      position,
      fields,
      temperature,
      wallet
    }];
  });
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function migrationClaimMap(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const claims = root.claims ?? root.wallets ?? root;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  return Object.fromEntries(
    Object.entries(claims as Record<string, unknown>).map(([wallet, value]) => [
      wallet.toLowerCase(),
      value
    ])
  );
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function indexedDebrisTargetsResponse(indexer: SettlementIndexer | undefined, url: URL): Response {
  if (!hasWarmPlanetIndex(indexer)) {
    return indexedReadNotReadyResponse("raid finder debris", indexer);
  }

  const limit = positiveIntegerQuery(url, "limit", 250, 500);
  const snapshot = indexer.snapshot();
  return indexedJsonResponse(
    {
      targets: indexer.debrisTargets(limit).map((target) => indexedDebrisTargetRef(target, indexer)),
      pagination: {
        page: 1,
        pageSize: limit
      },
      detail: indexedWarmDetail("Raid Finder debris targets"),
      stale: !snapshot.safeToServeIndexedState,
      source: indexedSource
    },
    snapshot
  );
}

function indexedRiftTargetsResponse(indexer: SettlementIndexer | undefined, url: URL): Response {
  if (!hasWarmPlanetIndex(indexer)) {
    return indexedReadNotReadyResponse("Rifters", indexer);
  }

  const limit = positiveIntegerQuery(url, "limit", 250, 500);
  const snapshot = indexer.snapshot();
  return indexedJsonResponse(
    {
      targets: indexer.riftTargets(limit).map((target) => ({
        planetId: target.planet.planetId,
        name: target.planet.name,
        owner: target.planet.owner,
        coordinates: {
          galaxy: target.planet.galaxy,
          system: target.planet.system,
          position: target.planet.position
        },
        archetype: planetArchetypeForTemperature(target.planet.temperature),
        hasMoon: indexer.hasMoon(target.planet.planetId),
        startedAt: target.startedAt,
        unlocksAt: target.unlocksAt,
        resources: target.resources
      })),
      pagination: { page: 1, pageSize: limit },
      detail: indexedWarmDetail("Raid Finder Rifters"),
      stale: !snapshot.safeToServeIndexedState,
      source: indexedSource
    },
    snapshot
  );
}

function indexedAllianceResponse(
  wallet: `0x${string}`,
  indexer: SettlementIndexer | undefined,
  paidAllianceInviteAddress?: `0x${string}`,
  paidAllianceInviteIndexFromBlock?: bigint,
): Response {
  if (!hasWarmAllianceIndex(indexer)) {
    return indexedReadNotReadyResponse("alliance", indexer, { wallet });
  }
  if (
    paidAllianceInviteAddress
    && paidAllianceInviteIndexFromBlock !== undefined
    && indexer.paidAllianceInviteHistoryBackfillStatus(
      paidAllianceInviteAddress,
      paidAllianceInviteIndexFromBlock
    ).required
  ) {
    return indexedReadNotReadyResponse("paid alliance history", indexer, { wallet });
  }

  const snapshot = indexer.snapshot();
  const state = indexer.allianceState(wallet);
  const paidInviteSummaries = paidAllianceInviteAddress
    ? indexer.paidAllianceInviteSummaries()
    : null;
  const directory = state.directory.map((alliance) => ({
    ...alliance,
    bonusBalance: paidInviteSummaries
      ? (paidInviteSummaries.get(alliance.allianceId) ?? emptyPaidAllianceInviteSummary()).bonusBalance
      : null,
    privateInviteStats: paidInviteSummaries
      ? (paidInviteSummaries.get(alliance.allianceId) ?? emptyPaidAllianceInviteSummary()).privateInviteStats
      : null,
  }));
  const profile = state.profile
    ? {
        ...state.profile,
        bonusBalance: paidInviteSummaries
          ? (paidInviteSummaries.get(state.membership.allianceId) ?? emptyPaidAllianceInviteSummary()).bonusBalance
          : null,
        privateInviteStats: paidInviteSummaries
          ? (paidInviteSummaries.get(state.membership.allianceId) ?? emptyPaidAllianceInviteSummary()).privateInviteStats
          : null,
      }
    : null;
  return indexedJsonResponse(
    {
      ...state,
      profile,
      directory,
      detail: indexedWarmDetail("Alliance state"),
      stale: !snapshot.safeToServeAllianceState || !snapshot.safeToServeIndexedState
    },
    snapshot,
    snapshot.safeToServeAllianceState
      ? (snapshot.safeToServeIndexedState ? "healthy" : "alliance-healthy")
      : "stale"
  );
}

function emptyPaidAllianceInviteSummary() {
  return {
    bonusBalance: { metal: "0", crystal: "0", deuterium: "0" },
    pendingBonusBalance: { metal: "0", crystal: "0", deuterium: "0" },
    privateInviteStats: { remaining: 0, used: 0 }
  };
}

function indexedAttackProtectionResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  targetPlanetId: bigint
): Response {
  if (!hasWarmPlanetIndex(indexer)) {
    return indexedReadNotReadyResponse("attack protection", indexer, { wallet, targetPlanetId: targetPlanetId.toString() });
  }

  const target = indexer.planet(targetPlanetId.toString());
  if (!target) {
    return Response.json(
      {
        error: "target_planet_not_indexed",
        detail: "Attack protection target is not available from indexed contract state yet.",
        source: indexedSource
      },
      {
        headers: indexedStateHeaders("not-ready"),
        status: 404
      }
    );
  }

  const planetsByOwner = indexer.settledPlanetsByOwner();
  const attacker = indexer.highscoreForWallet(wallet, (planetsByOwner.get(wallet.toLowerCase()) ?? []).map((planet) => planet.planetId));
  const defender = indexer.highscoreForWallet(target.owner, (planetsByOwner.get(target.owner.toLowerCase()) ?? []).map((planet) => planet.planetId));
  // VEY-KANEO-489 follow-up: the score-protection gate must use the contract's _totalUserScore
  // (HighscoreEntry.totalUserScore), NOT the resource-based category total above. The category total is
  // on a ~hundreds scale, so against the contract's 50k/500k thresholds every player read as a newbie
  // and the UI false-flagged score_protection. User-facing relation labels use the same Score scale.
  const attackerProtectionScore = BigInt(attacker.totalUserScore);
  const defenderProtectionScore = BigInt(defender.totalUserScore);
  const attackerKey = wallet.toLowerCase();
  const defenderKey = target.owner.toLowerCase();
  // VEY-KANEO-489: model the contract's same_alliance gate, the HIGHEST-precedence reason in
  // VeydriftGameStorage._attackProtectionStatus (SameAlliance -> ScoreProtection -> BashingLimit).
  // Without it this single-target endpoint never returned `same_alliance`, so the frontend — which
  // derives ally targets solely from this signal (galaxyActions.ts: isAllyTarget = blockedReason ===
  // "same_alliance") — left the attack button enabled for allies and the launch reverted on-chain.
  // allianceIntelForPlayers only returns members of *active* alliances, so a missing entry means "no
  // alliance"; self-targets (attacker == owner) are never treated as same-alliance.
  const allianceIntel = indexer.allianceIntelForPlayers([attackerKey, defenderKey]);
  const attackerAlliance = allianceIntel.get(attackerKey) ?? null;
  const defenderAlliance = allianceIntel.get(defenderKey) ?? null;
  const defenderInactive = indexedDefenderInactive(
    indexer.playerLastActiveSeconds([defenderKey]).get(defenderKey),
    Math.floor(Date.now() / 1_000)
  );
  const sameAlliance = attackerKey !== defenderKey
    && attackerAlliance !== null
    && defenderAlliance !== null
    && attackerAlliance.allianceId !== "0"
    && attackerAlliance.allianceId === defenderAlliance.allianceId;
  const atWar = indexer.allianceRelationship(attackerAlliance?.allianceId, defenderAlliance?.allianceId) === "war";
  // VEY-KANEO-489: use the contract-faithful newbie/score-ratio gate (VeydriftAntiRaidPrimitives.
  // isScoreProtected) instead of a naive score-ratio heuristic. A fixed ratio false-blocks players
  // past the newbie-protection ceiling,
  // who the contract never score-protects (both ratios are 0). Kept raw (not gated by sameAlliance) so
  // plunderBps below still reflects the score-protection state.
  const scoreProtected = !defenderInactive
    && !atWar
    && isIndexedScoreProtected(attackerProtectionScore, defenderProtectionScore);
  // A nonzero planet-scoped Rift lock is fully contestable: it bypasses score/newbie and
  // bashing gates, but never same-alliance protection.
  const riftProtectionBypass = !sameAlliance
    && indexer.hasLiveRiftExtraction(targetPlanetId.toString());
  const scoreComparison = attackProtectionScoreComparison(attacker, defender, scoreProtected);
  // VEY-KANEO-489: also replay the per-(attacker, planet) bashing window the contract enforces. Self
  // attacks are rejected upstream by the contract and carry no window; a self-target read just returns
  // an empty launch history. same_alliance and score protection are checked first to match the
  // contract's precedence (VeydriftGameStorage._attackProtectionStatus: SameAlliance -> ScoreProtection
  // -> BashingLimit); skipping the launch-log replay when either short-circuits avoids needless work.
  const bashingLimited = !sameAlliance
    && !scoreProtected
    && !atWar
    && !defenderInactive
    && wallet.toLowerCase() !== target.owner.toLowerCase()
    && indexedBashingLimitReached(
      indexer.attackLaunchSecondsByTarget(wallet).get(targetPlanetId.toString()) ?? [],
      Math.floor(Date.now() / 1_000)
    );
  const blockedReason: AttackBlockReason = sameAlliance
    ? "same_alliance"
    : scoreProtected && !riftProtectionBypass
      ? "score_protection"
      : bashingLimited && !riftProtectionBypass
        ? "bashing_limit"
        : "none";
  const transportBlockReason = attackerKey === defenderKey
    ? "own_planet"
    : "not_allied";
  const transportAllowed = transportBlockReason === "own_planet";

  const body: AttackProtectionStatus & {
    source: typeof indexedSource;
  } = {
    wallet,
    targetPlanetId: targetPlanetId.toString(),
    allowed: blockedReason === "none",
    blockedReason,
    blockedReasonLabel: blockedReason === "none" ? null : attackBlockReasonLabel(blockedReason),
    relation: defenderProtectionScore > attackerProtectionScore
      ? "stronger"
      : defenderProtectionScore < attackerProtectionScore
        ? "weaker"
        : "peer",
    defenderHonorStatus: "neutral",
    plunderBps: scoreProtected ? 0 : 5000,
    defenderInactive,
    transportAllowed,
    transportBlockReason,
    transportBlockReasonLabel: transportBlockReasonLabel(transportBlockReason),
    scoreComparison,
    ...(riftProtectionBypass ? { riftProtectionBypass: true } : {}),
    ...(atWar ? { atWar: true } : {}),
    ...(defenderAlliance ? { targetAlliance: defenderAlliance } : {}),
    source: indexedSource
  };

  return Response.json(body, {
    headers: indexedStateHeaders(indexedStateLabel(indexer.snapshot()))
  });
}

function unavailableResponse(problems: ConfigProblem[]): Response {
  return Response.json(
    {
      error: "backend_not_configured",
      problems
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function backendReadiness(
  problems: ConfigProblem[],
  chainSyncSnapshot: unknown,
  indexerSnapshot: unknown,
  missionResolutionSnapshot: unknown,
  rpcSnapshots: unknown[] = [],
): {
  ready: boolean;
  degraded: boolean;
  degradationReasons: string[];
  configurationReady: boolean;
  chainSyncConnected: boolean | null;
  subscribedToHeads: boolean | null;
  subscribedToLogs: boolean | null;
  indexedState: string | null;
  safeToServeIndexedState: boolean | null;
  missionResolutionStatus: string | null;
  rpcUnfinishedRequests: number;
  rpcOldestUnfinishedRequestAgeMs: number | null;
  rpcUnfinishedRequestGrowthDetected: boolean;
} {
  const chainSyncConnected = booleanSnapshotField(chainSyncSnapshot, "connected");
  const subscribedToHeads = booleanSnapshotField(chainSyncSnapshot, "subscribedToHeads");
  const subscribedToLogs = booleanSnapshotField(chainSyncSnapshot, "subscribedToLogs");
  const indexedState = stringSnapshotField(indexerSnapshot, "indexedState");
  const safeToServeIndexedState = booleanSnapshotField(indexerSnapshot, "safeToServeIndexedState");
  const missionResolutionStatus = stringSnapshotField(missionResolutionSnapshot, "healthStatus");
  const missionResolutionWarnings = stringArraySnapshotField(missionResolutionSnapshot, "healthWarnings");
  const configurationReady = problems.length === 0;
  const rpcReadiness = rpcUnfinishedRequestReadiness(rpcSnapshots);
  const degradationReasons = [...missionResolutionWarnings];
  if (!rpcReadiness.ready) degradationReasons.push("Upstream RPC unfinished requests are growing or stale.");

  return {
    ready: configurationReady
      && chainSyncConnected !== false
      && subscribedToHeads !== false
      && subscribedToLogs !== false
      && safeToServeIndexedState !== false
      && rpcReadiness.ready,
    degraded: missionResolutionStatus === "degraded" || !rpcReadiness.ready,
    degradationReasons,
    configurationReady,
    chainSyncConnected,
    subscribedToHeads,
    subscribedToLogs,
    indexedState,
    safeToServeIndexedState,
    missionResolutionStatus,
    rpcUnfinishedRequests: rpcReadiness.unfinishedRequests,
    rpcOldestUnfinishedRequestAgeMs: rpcReadiness.oldestAgeMs,
    rpcUnfinishedRequestGrowthDetected: !rpcReadiness.ready,
  };
}

export function rpcUnfinishedRequestReadiness(
  snapshots: unknown[],
  options: { maxUnfinished?: number; maxAgeMs?: number } = {}
): { ready: boolean; unfinishedRequests: number; oldestAgeMs: number | null } {
  const maxUnfinished = options.maxUnfinished ?? 3;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  let unfinishedRequests = 0;
  let oldestAgeMs: number | null = null;
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const record = snapshot as Record<string, unknown>;
    const unfinished = typeof record.unfinishedHttpRequests === "number"
      ? Math.max(0, record.unfinishedHttpRequests)
      : 0;
    const age = typeof record.oldestUnfinishedRequestAgeMs === "number"
      ? Math.max(0, record.oldestUnfinishedRequestAgeMs)
      : null;
    unfinishedRequests += unfinished;
    if (age !== null) oldestAgeMs = oldestAgeMs === null ? age : Math.max(oldestAgeMs, age);
  }
  return {
    ready: unfinishedRequests <= maxUnfinished && (oldestAgeMs === null || oldestAgeMs <= maxAgeMs),
    unfinishedRequests,
    oldestAgeMs
  };
}

function booleanSnapshotField(snapshot: unknown, key: string): boolean | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function stringSnapshotField(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function stringArraySnapshotField(snapshot: unknown, key: string): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const value = (snapshot as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function errorResponse(error: unknown, status: number): Response {
  const responseStatus = statusForError(error, status);
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Request failed."
    },
    {
      headers: corsHeaders,
      status: responseStatus
    }
  );
}

function reasonText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusForError(error: unknown, fallback: number): number {
  if (!(error instanceof Error)) return fallback;

  if (isSqliteBusyError(error)) return 503;
  if (error instanceof RequestBodyTooLargeError) return 413;
  if (isLiveWalletReadTimeout(error)) return 503;
  if (isRateLimitedRpcError(error)) return 503;
  if (isUpstreamRpcError(error)) return 502;

  return fallback;
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("database is locked")
    || message.includes("sqlite_busy")
    || message.includes("sqlite_locked");
}

function isLiveWalletReadTimeout(error: Error): boolean {
  return /^Timed out reading .+ from live chain state after \d+ seconds\.$/.test(error.message);
}

function isRateLimitedRpcError(error: Error): boolean {
  return /RPC HTTP (429|503)|over rate limit|rate limit|too many requests/i.test(error.message);
}

function isUpstreamRpcError(error: Error): boolean {
  return /^RPC (HTTP \d+|-?\d+:)/i.test(error.message);
}

function selectedPlanetId(url: URL): bigint | undefined {
  const value = url.searchParams.get("planetId");
  if (!value) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("planetId must be a positive integer.");
  }
  const planetId = BigInt(value);
  if (planetId === 0n) {
    throw new Error("planetId must be a positive integer.");
  }
  return planetId;
}

function validBodyPlanetId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("planetId must be a positive integer.");
  }
  const stringValue = String(value);
  if (!/^[1-9][0-9]*$/.test(stringValue)) {
    throw new Error("planetId must be a positive integer.");
  }
  return stringValue;
}

function parseMissionId(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("Mission id must be a positive integer.");
  }
  const missionId = BigInt(value);
  if (missionId === 0n) {
    throw new Error("Mission id must be a positive integer.");
  }
  return missionId;
}

function positiveBigIntQuery(url: URL, name: string): bigint {
  const value = url.searchParams.get(name);
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function positiveIntegerQuery(url: URL, name: string, fallback: number, max: number): number {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function handleUniverseSystemRequest(url: URL): Response {
  const galaxyId = parseIntegerQuery(url, "galaxyId", 0);
  const systemId = parseIntegerQuery(url, "systemId", 1);
  const seed = url.searchParams.get("seed") ?? defaultUniverseSeed;

  if (galaxyId === null || galaxyId < 0) {
    return badRequest("galaxyId must be a non-negative integer.");
  }

  if (systemId === null || systemId < 1) {
    return badRequest("systemId must be a positive integer.");
  }

  return Response.json(
    {
      data: {
        system: generateSystem({
          seed,
          galaxyId,
          systemId
        })
      }
    },
    {
      headers: corsHeaders
    }
  );
}

function parseIntegerQuery(
  url: URL,
  name: string,
  fallback: number
): number | null {
  const value = url.searchParams.get(name);

  if (value === null) {
    return fallback;
  }

  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
}

function badRequest(message: string): Response {
  return Response.json(
    {
      errors: [
        {
          message
        }
      ]
    },
    {
      headers: corsHeaders,
      status: 400
    }
  );
}

async function handleGraphQLRequest(request: Request, workerRole: WorkerRole): Promise<Response> {
  let payload: GraphQLPayload;

  try {
    payload = (await readLimitedJson(request, graphqlBodyLimitBytes)) as GraphQLPayload;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        {
          errors: [
            {
              message: error.message
            }
          ]
        },
        {
          headers: corsHeaders,
          status: 413
        }
      );
    }
    return Response.json(
      {
        errors: [
          {
            message: "Request body must be valid JSON."
          }
        ]
      },
      {
        headers: corsHeaders,
        status: 400
      }
    );
  }

  if (!payload.query || !payload.query.trim()) {
    return Response.json(
      {
        errors: [
          {
            message: "GraphQL query is required."
          }
        ]
      },
      {
        headers: corsHeaders,
        status: 400
      }
    );
  }

  return Response.json(
    {
      data: {
        service: {
          name: "Veydrift",
          status: "playable-test",
          runtime: getRuntimeConfig(workerRole)
        }
      }
    },
    {
      headers: corsHeaders
    }
  );
}
