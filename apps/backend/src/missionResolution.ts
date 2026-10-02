import {
  decodeEventLog,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import type { Address, GameMaintenanceState, ResolvableFleetMission, ReturnableFleetMission } from "./evm";
import { VeydriftGameReader } from "./evm";
import { emitObservabilityEvent } from "./observability";
import {
  resolverReplacementFees,
  resolverTransactionNeedsReplacement,
  type ResolverReplacementFees
} from "./resolverReplacementFees";
import { ResolverTransactionCoordinator, type PreparedReceipt, type PreparedReconciliationPass } from "./resolverTransactions";
import { safeDiagnosticText } from "./safeDiagnostics";
import { batchCalldata, compareBatchLegs, defaultMissionBatchPolicy, packMissionBatch, type BatchLeg, type BatchExclusion, type BatchLegOutcome, type MissionBatchPolicy } from "./missionBatch";

import { cancelResolverTransaction } from "./resolverCancellation";
import { assertBatchQuoteFresh, quoteMissionBatch, batchOutcomeNames, rpcQuantity, gasOracle, oracleAbi, initialResolverFees, quoteResolverGas, singleResolverMaxUsdMicros } from "./missionBatchFees";

const missionResolutionIntervalMs = 5_000;
const maxMissionsPerTick = 100;
const missionResolutionConcurrency = 4;
const maxMoonChancesPerTick = 10;
const promptnessTargetMs = 60_000;
const latencySampleLimit = 1_000;
const initialFailureRetryMs = 30_000;
const maxFailureRetryMs = 300_000;
const maxPauseProbeBackoffMs = 30_000;
const longPauseAlertAfterMs = 10 * 60_000;
// VeydriftGame.v1 storage layout fixes `_gamePaused` at proxy slot 52. Reading the canonical proxy
// storage avoids a contract upgrade solely to expose an operational getter.
const gamePausedStorageSlot = toHex(52n, { size: 32 });
// Base caps an individual transaction at 2^24 gas. Supply that envelope explicitly: Reth's
// estimator can stop at an inner delegatecall's empty out-of-gas revert and misreport a valid,
// bounded battle as UnsupportedGameplayModule instead of broadcasting it.
const fleetMissionResolutionGas = 16_777_216n;

const batchReceiptAbi = parseAbi([
  "event FleetMissionBatchItem(uint256 indexed index,uint256 indexed missionId,uint8 leg,uint8 outcome,bytes4 errorSelector)"
]);
const batchEligibilityAbi = parseAbi([
  "function fleetMissionEligibility(uint256 id) view returns (bool eligible,uint256 blocker,bool orderingReady)"
]);

const moonReadAbi = parseAbi([
  "function moonChanceRandomness(uint256 outcomeId) view returns (uint256 requestId, bytes32 purposeHash, bool finalized, uint256 randomWord)",
  "function request(uint256 requestId) view returns ((address requester, bytes32 purposeHash, bytes32 randomnessCommitment, uint64 createdAt, uint64 fulfilledAt, uint256 randomWord))"
]);

const veydriftGameResolutionAbi = [
  {
    type: "function",
    name: "finalizeMoonChance",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "outcomeId" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "resolveFleetMission",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "missionId" }],
    outputs: []
  },
  {
    type: "function",
    name: "completeFleetMissionReturn",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "missionId" }],
    outputs: []
  }
] as const;

export type MissionResolutionChainClient = {
  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]>;
  listReturnableFleetMissions(): Promise<ReturnableFleetMission[]>;
  resolveFleetMission(missionId: string): Promise<string>;
  resolveMissionBatch?(items: BatchLeg[]): Promise<{ hash: string | null; items: BatchLeg[]; exclusions?: BatchExclusion[]; outcomes?: BatchLegOutcome[] }>;
  completeFleetMissionReturn(missionId: string): Promise<string>;
  isMissionLegComplete?(missionId: string, leg: "arrival" | "return"): Promise<boolean>;
  gamePaused?(): Promise<boolean>;
  finalizeMoonChance?(outcomeId: string): Promise<"pending" | "finalized">;
};

export type MissionResolutionCandidates = {
  arrivals: ResolvableFleetMission[];
  returns: ReturnableFleetMission[];
  nextCursor?: string;
};

export type MoonChanceResolutionCandidate = { cursor: number; outcomeId: string };

export type MissionResolutionCandidateSource = {
  moonChanceResolutionCandidateCount?(): number;
  moonChanceResolutionCandidates?(afterCursor: number, limit: number): MoonChanceResolutionCandidate[];
  moonChanceTerminalOutcomeIds?(outcomeIds: readonly string[]): string[];
  missionResolutionCandidates(asOfSeconds?: number, limit?: number, afterMissionId?: string): MissionResolutionCandidates | Promise<MissionResolutionCandidates>;
  /**
   * A resolver settlement can expose a stale event-indexed mission status, including when a durable
   * coordinator reuses a previously confirmed operation. Re-read just that candidate from canonical
   * storage so its next leg or terminal state is visible without waiting for a broad repair.
   */
  reconcileMissionResolutionCandidate?(missionId: string): Promise<void>;
  gameMaintenanceState?(): GameMaintenanceState | null;
  recordGameMaintenanceState?(state: GameMaintenanceState): void;
};

type MissionLeg = "arrival" | "return";

type MissionSettlementCandidate = {
  leg: MissionLeg;
  mission: ResolvableFleetMission | ReturnableFleetMission;
  dueAt: number;
};

type DueLegSnapshot = {
  count: number;
  oldestDueAt: string | null;
  oldestAgeSeconds: number | null;
};

type LatencySnapshot = {
  count: number;
  lastSeconds: number | null;
  maxSeconds: number | null;
  p95Seconds: number | null;
};

type MoonChanceResolutionSnapshot = {
  enabled: boolean;
  maxPerTick: number;
  cursor: number;
  indexedBacklog: number | null;
  lastScanned: number;
  lastPending: number;
  lastFinalized: number;
  lastDeferred: number;
  lastFailed: number;
  retrying: number;
  totalFailures: number;
  lastOutcomeId: string | null;
  lastResult: "pending" | "finalized" | "deferred" | "failed" | null;
  lastError: string | null;
  lastFailedOutcomeId: string | null;
  lastFailedError: string | null;
};

export type MissionResolutionSnapshot = {
  enabled: boolean;
  resolverConfigured: boolean;
  resolverAddress: Address | null;
  intervalMs: number;
  maxConcurrency: number;
  promptnessTargetSeconds: number;
  healthStatus: "healthy" | "degraded";
  healthWarnings: string[];
  gamePaused: boolean;
  gamePauseObservedAt: string | null;
  gamePausedSince: string | null;
  gamePauseAgeSeconds: number;
  nextGamePauseProbeAt: string | null;
  pausedResolutionAttempts: number;
  longPauseAlerts: number;
  inFlight: boolean;
  lastRunAt: string | null;
  lastCompletedRunAt: string | null;
  lastTickDurationMs: number | null;
  lastScanDurationMs: number | null;
  skippedOverlappingRuns: number;
  lastError: string | null;
  lastResolvedMissionId: string | null;
  lastReturnedMissionId: string | null;
  resolvedCount: number;
  returnedCount: number;
  dueArrivals: DueLegSnapshot;
  dueReturns: DueLegSnapshot;
  failuresByLeg: Record<MissionLeg, number>;
  moonChanceResolution: MoonChanceResolutionSnapshot;
  settlementLatency: Record<MissionLeg, LatencySnapshot>;
};

export type MissionResolutionLogger = {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export type MissionResolutionServiceOptions = {
  chainClient?: MissionResolutionChainClient;
  candidateSource?: MissionResolutionCandidateSource;
  intervalMs?: number;
  logger?: MissionResolutionLogger;
  maxMissionsPerTick?: number;
  maxConcurrency?: number;
  now?: () => number;
  promptnessTargetMs?: number;
  longPauseAlertAfterMs?: number;
  transactionCoordinator?: ResolverTransactionCoordinator;
};

export class MissionResolutionService {
  private readonly chainClient: MissionResolutionChainClient | undefined;
  private readonly candidateSource: MissionResolutionCandidateSource | undefined;
  private readonly intervalMs: number;
  private readonly logger: MissionResolutionLogger;
  private readonly maxMissionsPerTick: number;
  private readonly maxConcurrency: number;
  private readonly now: () => number;
  private readonly promptnessTargetMs: number;
  private readonly longPauseAlertAfterMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastCompletedRunAt: string | null = null;
  private lastTickDurationMs: number | null = null;
  private lastScanDurationMs: number | null = null;
  private skippedOverlappingRuns = 0;
  private moonChanceCursor = 0;
  private moonChanceIndexedBacklog: number | null = null;
  private moonChanceLastScanned = 0;
  private moonChanceLastPending = 0;
  private moonChanceLastFinalized = 0;
  private moonChanceLastDeferred = 0;
  private moonChanceLastFailed = 0;
  private moonChanceTotalFailures = 0;
  private moonChanceLastOutcomeId: string | null = null;
  private moonChanceLastResult: MoonChanceResolutionSnapshot["lastResult"] = null;
  private moonChanceLastError: string | null = null;
  private moonChanceRetryReconciliationOffset = 0;
  private lastError: string | null = null;
  private lastResolvedMissionId: string | null = null;
  private lastReturnedMissionId: string | null = null;
  private resolvedCount = 0;
  private returnedCount = 0;
  private gamePaused = false;
  private gamePauseObservedAt: string | null = null;
  private gamePausedSince: string | null = null;
  private nextGamePauseProbeAtMs = 0;
  private pauseProbeBackoffMs: number;
  private pausedResolutionAttempts = 0;
  private longPauseAlerts = 0;
  private lastLongPauseAlertAtMs = 0;
  private readonly pendingDueAt: Record<MissionLeg, Map<string, number>> = {
    arrival: new Map(),
    return: new Map()
  };
  private readonly failuresByLeg: Record<MissionLeg, number> = { arrival: 0, return: 0 };
  private readonly latencySamples: Record<MissionLeg, number[]> = { arrival: [], return: [] };
  // A permanently unpayable resolver must not resubmit every overdue mission every five seconds.
  // Besides wasting RPC/gas-estimation work, viem's multi-line error payloads can flood container
  // stdout and contend with API readers. Keep the candidate visible to health checks, but retry it
  // with bounded exponential backoff until its underlying condition changes.
  private readonly failedCandidateRetries = new Map<string, { failures: number; retryAtMs: number; error?: string }>();

  constructor(
    private readonly config: BackendConfig,
    options: MissionResolutionServiceOptions = {}
  ) {
    this.chainClient = options.chainClient ?? buildMissionResolutionChainClient(
      config,
      options.transactionCoordinator
    );
    this.candidateSource = options.candidateSource;
    this.intervalMs = options.intervalMs ?? missionResolutionIntervalMs;
    this.logger = options.logger ?? console;
    this.maxMissionsPerTick = Math.max(1, Math.floor(options.maxMissionsPerTick ?? maxMissionsPerTick));
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? missionResolutionConcurrency));
    this.now = options.now ?? Date.now;
    this.promptnessTargetMs = Math.max(1_000, Math.floor(options.promptnessTargetMs ?? promptnessTargetMs));
    this.longPauseAlertAfterMs = Math.max(1_000, Math.floor(options.longPauseAlertAfterMs ?? longPauseAlertAfterMs));
    this.pauseProbeBackoffMs = this.intervalMs;
  }

  snapshot(): MissionResolutionSnapshot {
    const nowMs = this.now();
    const dueArrivals = dueLegSnapshot([...this.pendingDueAt.arrival.values()], nowMs);
    const dueReturns = dueLegSnapshot([...this.pendingDueAt.return.values()], nowMs);
    const healthWarnings = this.healthWarnings(dueArrivals, dueReturns);
    const moonChanceLastFailure = this.moonChanceLastFailure();
    return {
      enabled: this.enabled,
      resolverConfigured: Boolean(this.config.missionResolverAddress || this.config.missionResolverPrivateKey),
      resolverAddress: this.resolverAddress(),
      intervalMs: this.intervalMs,
      maxConcurrency: this.maxConcurrency,
      promptnessTargetSeconds: Math.ceil(this.promptnessTargetMs / 1_000),
      healthStatus: healthWarnings.length === 0 ? "healthy" : "degraded",
      healthWarnings,
      gamePaused: this.gamePaused,
      gamePauseObservedAt: this.gamePauseObservedAt,
      gamePausedSince: this.gamePausedSince,
      gamePauseAgeSeconds: this.gamePauseAgeSeconds(nowMs),
      nextGamePauseProbeAt: this.gamePaused && this.nextGamePauseProbeAtMs > nowMs
        ? new Date(this.nextGamePauseProbeAtMs).toISOString()
        : null,
      pausedResolutionAttempts: this.pausedResolutionAttempts,
      longPauseAlerts: this.longPauseAlerts,
      inFlight: this.inFlight,
      lastRunAt: this.lastRunAt,
      lastCompletedRunAt: this.lastCompletedRunAt,
      lastTickDurationMs: this.lastTickDurationMs,
      lastScanDurationMs: this.lastScanDurationMs,
      skippedOverlappingRuns: this.skippedOverlappingRuns,
      lastError: this.lastError,
      lastResolvedMissionId: this.lastResolvedMissionId,
      lastReturnedMissionId: this.lastReturnedMissionId,
      resolvedCount: this.resolvedCount,
      returnedCount: this.returnedCount,
      dueArrivals,
      dueReturns,
      failuresByLeg: { ...this.failuresByLeg },
      moonChanceResolution: {
        enabled: this.moonChanceResolutionEnabled,
        maxPerTick: maxMoonChancesPerTick,
        cursor: this.moonChanceCursor,
        indexedBacklog: this.moonChanceIndexedBacklog,
        lastScanned: this.moonChanceLastScanned,
        lastPending: this.moonChanceLastPending,
        lastFinalized: this.moonChanceLastFinalized,
        lastDeferred: this.moonChanceLastDeferred,
        lastFailed: this.moonChanceLastFailed,
        retrying: this.moonChanceRetryingCount(),
        totalFailures: this.moonChanceTotalFailures,
        lastOutcomeId: this.moonChanceLastOutcomeId,
        lastResult: this.moonChanceLastResult,
        lastError: this.moonChanceLastError,
        lastFailedOutcomeId: moonChanceLastFailure?.outcomeId ?? null,
        lastFailedError: moonChanceLastFailure?.error ?? null
      },
      settlementLatency: {
        arrival: latencySnapshot(this.latencySamples.arrival),
        return: latencySnapshot(this.latencySamples.return)
      }
    };
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (!this.enabled || !this.chainClient) return;
    if (this.inFlight) {
      this.skippedOverlappingRuns += 1;
      return;
    }
    this.inFlight = true;
    const startedAtMs = this.now();
    this.lastRunAt = new Date(startedAtMs).toISOString();
    try {
      if (this.gamePaused && startedAtMs < this.nextGamePauseProbeAtMs) return;
      const paused = await this.readCanonicalGamePause();
      this.observeGamePause(paused, startedAtMs);
      const scanStartedAtMs = this.now();
      const candidates = await this.listCandidates();
      this.lastScanDurationMs = Math.max(0, this.now() - scanStartedAtMs);
      const settlementCandidates = toSettlementCandidates(candidates);
      this.publishDueCandidates(settlementCandidates);
      if (paused) {
        this.recordPausedResolutionAttempts(settlementCandidates, startedAtMs);
        this.lastError = null;
        return;
      }
      const results = await Promise.allSettled([
        this.settleCandidates(settlementCandidates),
        this.settleMoonChances()
      ]);
      // Keep the overlap guard until both lanes finish, even if an indexed read fails in one.
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      this.lastError = null;
    } catch (error) {
      const safeError = safeDiagnosticText(error);
      this.lastError = safeError;
      this.logger.error("[mission-resolution] tick failed", safeError);
    } finally {
      const completedAtMs = this.now();
      this.lastCompletedRunAt = new Date(completedAtMs).toISOString();
      this.lastTickDurationMs = Math.max(0, completedAtMs - startedAtMs);
      this.inFlight = false;
    }
  }

  private get enabled(): boolean {
    return this.config.missionResolutionEnabled && Boolean(this.chainClient);
  }

  private get moonChanceResolutionEnabled(): boolean {
    return this.enabled
      && Boolean(this.config.moonContractAddress && this.config.randomnessEngineAddress)
      && Boolean(this.candidateSource?.moonChanceResolutionCandidates)
      && Boolean(this.chainClient?.finalizeMoonChance);
  }

  private resolverAddress(): Address | null {
    if (this.config.missionResolverPrivateKey) {
      return privateKeyToAccount(this.config.missionResolverPrivateKey).address.toLowerCase() as Address;
    }
    return this.config.missionResolverAddress?.toLowerCase() as Address | undefined ?? null;
  }

  private missionCursor = "0";

  private async listCandidates(): Promise<MissionResolutionCandidates> {
    if (this.candidateSource) {
      if (!this.config.missionBatch?.enabled)
        return this.candidateSource.missionResolutionCandidates(undefined, this.maxMissionsPerTick * 5);
      const result = await this.candidateSource.missionResolutionCandidates(undefined, this.maxMissionsPerTick, this.missionCursor);
      this.missionCursor = result.nextCursor ?? "0";
      return result;
    }
    if (!this.chainClient) return { arrivals: [], returns: [] };
    const [arrivals, returns] = await Promise.all([
      this.chainClient.listResolvableFleetMissions(),
      this.chainClient.listReturnableFleetMissions()
    ]);
    return { arrivals, returns };
  }

  private async readCanonicalGamePause(): Promise<boolean> {
    if (!this.chainClient?.gamePaused) return false;
    return this.chainClient.gamePaused();
  }

  private observeGamePause(paused: boolean, observedAtMs: number): void {
    const observedAt = new Date(observedAtMs).toISOString();
    const shouldPersist = paused || this.gamePauseObservedAt === null || this.gamePaused !== paused;
    if (paused) {
      if (!this.gamePaused) {
        const persisted = this.candidateSource?.gameMaintenanceState?.();
        this.gamePausedSince = persisted?.paused && persisted.pausedSince
          ? persisted.pausedSince
          : observedAt;
        this.pauseProbeBackoffMs = this.intervalMs;
        this.lastLongPauseAlertAtMs = 0;
      }
      this.gamePaused = true;
      this.gamePauseObservedAt = observedAt;
      this.nextGamePauseProbeAtMs = observedAtMs + this.pauseProbeBackoffMs;
      this.pauseProbeBackoffMs = Math.min(maxPauseProbeBackoffMs, this.pauseProbeBackoffMs * 2);
    } else {
      const recovered = this.gamePaused;
      this.gamePaused = false;
      this.gamePauseObservedAt = observedAt;
      this.gamePausedSince = null;
      this.nextGamePauseProbeAtMs = 0;
      this.pauseProbeBackoffMs = this.intervalMs;
      this.lastLongPauseAlertAtMs = 0;
      if (recovered) {
        emitObservabilityEvent({ kind: "mission_resolution_game_unpaused", component: "mission-resolution" });
      }
    }
    if (shouldPersist) {
      this.candidateSource?.recordGameMaintenanceState?.({
        paused: this.gamePaused,
        observedAt,
        pausedSince: this.gamePausedSince,
        pauseAgeSeconds: this.gamePauseAgeSeconds(observedAtMs)
      });
    }
  }

  private recordPausedResolutionAttempts(candidates: readonly MissionSettlementCandidate[], nowMs: number): void {
    const attempted = candidates.length;
    this.pausedResolutionAttempts += attempted;
    const pauseAgeSeconds = this.gamePauseAgeSeconds(nowMs);
    emitObservabilityEvent({
      kind: "mission_resolution_suppressed_while_game_paused",
      component: "mission-resolution",
      attempted,
      dueArrivals: candidates.filter((candidate) => candidate.leg === "arrival").length,
      dueReturns: candidates.filter((candidate) => candidate.leg === "return").length,
      pauseAgeSeconds,
      nextProbeAt: new Date(this.nextGamePauseProbeAtMs).toISOString()
    }, "warn");
    if (
      pauseAgeSeconds * 1_000 >= this.longPauseAlertAfterMs
      && nowMs - this.lastLongPauseAlertAtMs >= this.longPauseAlertAfterMs
    ) {
      this.lastLongPauseAlertAtMs = nowMs;
      this.longPauseAlerts += 1;
      this.logger.warn(`[mission-resolution] game pause has lasted ${Math.floor(pauseAgeSeconds)}s; resolver submissions remain suppressed`);
      emitObservabilityEvent({
        kind: "mission_resolution_long_game_pause",
        component: "mission-resolution",
        pauseAgeSeconds,
        pausedSince: this.gamePausedSince
      }, "warn");
    }
  }

  private gamePauseAgeSeconds(nowMs: number): number {
    if (!this.gamePaused || !this.gamePausedSince) return 0;
    const pausedSinceMs = Date.parse(this.gamePausedSince);
    return Number.isFinite(pausedSinceMs) ? Math.max(0, (nowMs - pausedSinceMs) / 1_000) : 0;
  }

  private publishDueCandidates(candidates: readonly MissionSettlementCandidate[]): void {
    this.pendingDueAt.arrival.clear();
    this.pendingDueAt.return.clear();
    for (const candidate of candidates) {
      this.pendingDueAt[candidate.leg].set(candidate.mission.missionId, candidate.dueAt);
    }
  }

  private async settleCandidates(all: MissionSettlementCandidate[]): Promise<void> {
    const attemptable = all
      .filter((candidate) => this.canAttempt(candidate))
      .slice(0, this.maxMissionsPerTick * 5);
    if (this.config.missionBatch?.enabled) {
      if (!this.chainClient?.resolveMissionBatch) throw new Error("batch rollout enabled without supported durable batch client");
      const candidates = attemptable.slice(0, this.maxMissionsPerTick);
      try {
        const result = await this.chainClient.resolveMissionBatch(candidates.map((c) => ({ missionId: c.mission.missionId, leg: c.leg, dueAt: c.dueAt })));
        for (const excluded of result.exclusions ?? []) {
          await this.candidateSource?.reconcileMissionResolutionCandidate?.(excluded.item.missionId);
          const candidate = candidates.find((c) => c.mission.missionId === excluded.item.missionId && c.leg === excluded.item.leg);
          const key = candidate && candidateRetryKey(candidate);
          // Settled elsewhere (e.g. a concurrent manual resolve) is success, not a failure.
          if (excluded.terminal) { if (key) this.failedCandidateRetries.delete(key); continue; }
          // Unpaid ordering/oracle waits clear on their own: flat short retry, no escalation.
          if (key) excluded.unproductive ? this.scheduleFlatRetry(key) : this.scheduleRetry(key);
          emitObservabilityEvent({ kind: "mission_batch_skip", ...excluded.item, reason: excluded.reason,
            terminal: false }, excluded.unproductive ? "info" : "warn");
        }
        let settled = 0;
        for (const item of result.items) {
          const candidate = candidates.find((c) => c.mission.missionId === item.missionId && c.leg === item.leg)!;
          await this.candidateSource?.reconcileMissionResolutionCandidate?.(item.missionId);
          if (!await this.chainClient.isMissionLegComplete?.(item.missionId, item.leg)) {
            const outcome = result.outcomes?.find((o) => o.item.missionId === item.missionId && o.item.leg === item.leg);
            if (outcome?.outcome === "Progress") {
              // A staged battle committed more stages: continue next tick without backoff.
              this.failedCandidateRetries.delete(candidateRetryKey(candidate));
              continue;
            }
            emitObservabilityEvent({ kind: "mission_batch_skip", ...item, reason: outcome?.outcome ?? "canonical-leg-incomplete",
              errorSelector: outcome?.errorSelector ?? null, blockedDependency: outcome?.blockedDependency ?? null }, "warn");
            this.scheduleRetry(candidateRetryKey(candidate));
            continue;
          }
          settled++;
          if (item.leg === "arrival") { this.resolvedCount++; this.lastResolvedMissionId = item.missionId; }
          else { this.returnedCount++; this.lastReturnedMissionId = item.missionId; }
          this.recordLatency(item.leg, item.dueAt);
          this.pendingDueAt[item.leg].delete(item.missionId);
          this.failedCandidateRetries.delete(candidateRetryKey(candidate));
        }
        emitObservabilityEvent({ kind: "mission_batch_outcomes", hash: result.hash, requestedLegs: result.items.length,
          settledLegs: settled, blockedOrPartialLegs: result.items.length - settled });
      } catch (error) {
        // A concurrent settlement or fresh block only invalidates this packing: repack next tick.
        const transient = error instanceof Error && /membership changed|block changed or expired/.test(error.message);
        if (!transient) for (const candidate of candidates) this.scheduleRetry(candidateRetryKey(candidate));
        this.logger.warn("[mission-resolution] batch blocked: " + conciseReasonText(error));
        emitObservabilityEvent({ kind: "mission_batch_blocked", reason: conciseReasonText(error) }, "warn");
      }
      return;
    }
    let successful = 0;
    let cursor = 0;
    while (cursor < attemptable.length && successful < this.maxMissionsPerTick && !this.gamePaused) {
      const remainingSuccessSlots = this.maxMissionsPerTick - successful;
      const batchSize = Math.min(this.maxConcurrency, remainingSuccessSlots, attemptable.length - cursor);
      const batch = attemptable.slice(cursor, cursor + batchSize);
      cursor += batchSize;
      const results = await Promise.all(batch.map((candidate) => this.settleCandidate(candidate)));
      results.forEach((didSettle) => {
        if (didSettle) successful += 1;
      });
    }
  }

  private async settleMoonChances(): Promise<void> {
    if (!this.moonChanceResolutionEnabled
      || !this.candidateSource?.moonChanceResolutionCandidates || !this.chainClient?.finalizeMoonChance) return;
    this.moonChanceIndexedBacklog = this.candidateSource.moonChanceResolutionCandidateCount?.() ?? null;
    // Keyset pagination rotates past genuinely unfulfilled or failed requests, so an old pending
    // page cannot starve newer fulfilled outcomes. Restart begins at zero and catches existing rows.
    const candidates = this.candidateSource.moonChanceResolutionCandidates(this.moonChanceCursor, maxMoonChancesPerTick);
    const completedSweep = candidates.length < maxMoonChancesPerTick;
    this.moonChanceCursor = completedSweep ? 0 : candidates.at(-1)!.cursor;
    this.moonChanceLastScanned = candidates.length;
    this.moonChanceLastPending = 0;
    this.moonChanceLastFinalized = 0;
    this.moonChanceLastDeferred = 0;
    this.moonChanceLastFailed = 0;
    this.moonChanceLastOutcomeId = null;
    this.moonChanceLastResult = null;
    this.moonChanceLastError = null;
    for (const candidate of candidates) {
      if (this.gamePaused) break;
      const key = `moon-chance:${candidate.outcomeId}`;
      const retry = this.failedCandidateRetries.get(key);
      if (retry && retry.retryAtMs > this.now()) {
        this.recordMoonChanceResult(candidate.outcomeId, "deferred");
        this.moonChanceLastDeferred += 1;
        continue;
      }
      try {
        const result = await this.chainClient.finalizeMoonChance(candidate.outcomeId);
        this.recordMoonChanceResult(candidate.outcomeId, result);
        if (result === "pending") this.moonChanceLastPending += 1;
        else this.moonChanceLastFinalized += 1;
        this.failedCandidateRetries.delete(key);
        // Only indexed MoonChanceFinalized / MoonCreated logs update API/UI state. A canonical
        // finalized check can suppress a redundant write while chain-sync catches up after restart.
      } catch (error) {
        if (error instanceof GamePausedBeforeResolverAllocationError) {
          this.observeGamePause(true, this.now());
          break;
        }
        this.recordMoonChanceResult(candidate.outcomeId, "failed");
        this.moonChanceLastFailed += 1;
        this.moonChanceTotalFailures += 1;
        const reason = conciseReasonText(error);
        this.moonChanceLastError = reason;
        const retryAfterMs = this.scheduleRetry(key, reason);
        this.logger.warn(`[mission-resolution] finalizeMoonChance(${candidate.outcomeId}) failed; retry in ${Math.ceil(retryAfterMs / 1_000)}s: ${reason}`);
      }
    }
    if (completedSweep) this.reconcileTerminalMoonChanceRetries();
  }

  private reconcileTerminalMoonChanceRetries(): void {
    if (!this.candidateSource?.moonChanceTerminalOutcomeIds) return;
    const retryEntries = [...this.failedCandidateRetries.keys()]
      .filter(key => key.startsWith("moon-chance:"));
    if (retryEntries.length === 0) {
      this.moonChanceRetryReconciliationOffset = 0;
      return;
    }
    const start = this.moonChanceRetryReconciliationOffset < retryEntries.length
      ? this.moonChanceRetryReconciliationOffset
      : 0;
    const count = Math.min(maxMoonChancesPerTick, retryEntries.length);
    const batch = Array.from({ length: count }, (_, index) => retryEntries[(start + index) % retryEntries.length]!);
    this.moonChanceRetryReconciliationOffset = (start + count) % retryEntries.length;
    const outcomeIds = batch.map(key => key.slice("moon-chance:".length));
    const terminal = new Set(this.candidateSource.moonChanceTerminalOutcomeIds(outcomeIds));
    for (const key of batch) {
      if (terminal.has(key.slice("moon-chance:".length))) this.failedCandidateRetries.delete(key);
    }
  }

  private recordMoonChanceResult(
    outcomeId: string,
    result: Exclude<MoonChanceResolutionSnapshot["lastResult"], null>
  ): void {
    this.moonChanceLastOutcomeId = outcomeId;
    this.moonChanceLastResult = result;
    this.moonChanceLastError = null;
  }

  private moonChanceRetryingCount(): number {
    return [...this.failedCandidateRetries.keys()].filter(key => key.startsWith("moon-chance:")).length;
  }

  private moonChanceLastFailure(): { outcomeId: string; error: string | null } | null {
    let lastFailure: { outcomeId: string; error: string | null } | null = null;
    for (const [key, retry] of this.failedCandidateRetries) {
      if (!key.startsWith("moon-chance:")) continue;
      lastFailure = { outcomeId: key.slice("moon-chance:".length), error: retry.error ?? null };
    }
    return lastFailure;
  }

  private async settleCandidate(candidate: MissionSettlementCandidate): Promise<boolean> {
    if (!this.chainClient) return false;
    try {
      if (candidate.leg === "arrival") {
        await this.chainClient.resolveFleetMission(candidate.mission.missionId);
      } else {
        await this.chainClient.completeFleetMissionReturn(candidate.mission.missionId);
      }
      // A successful call can be an idempotent coordinator hit for a transaction confirmed before
      // this process started. Refresh the indexed source before treating the candidate as settled:
      // otherwise a canonically Resolved mission never reaches its return leg and a Returned mission
      // remains in the active projection forever despite no transaction needing to be rebroadcast.
      await this.candidateSource?.reconcileMissionResolutionCandidate?.(candidate.mission.missionId);
      if (!await this.chainClient.isMissionLegComplete?.(candidate.mission.missionId, candidate.leg)) return false;
      if (candidate.leg === "arrival") {
        this.lastResolvedMissionId = candidate.mission.missionId;
        this.resolvedCount += 1;
      } else {
        this.lastReturnedMissionId = candidate.mission.missionId;
        this.returnedCount += 1;
      }
      this.recordLatency(candidate.leg, candidate.dueAt);
      this.pendingDueAt[candidate.leg].delete(candidate.mission.missionId);
      this.failedCandidateRetries.delete(candidateRetryKey(candidate));
      return true;
    } catch (error) {
      if (error instanceof GamePausedBeforeResolverAllocationError) {
        this.observeGamePause(true, this.now());
        this.recordPausedResolutionAttempts([candidate], this.now());
        return false;
      }
      this.failuresByLeg[candidate.leg] += 1;
      const method = candidate.leg === "arrival" ? "resolveFleetMission" : "completeFleetMissionReturn";
      if (needsCanonicalMissionReconciliation(error) && this.candidateSource?.reconcileMissionResolutionCandidate) {
        try {
          await this.candidateSource.reconcileMissionResolutionCandidate(candidate.mission.missionId);
        } catch (reconciliationError) {
          this.logger.warn(
            `[mission-resolution] canonical refresh for ${candidate.mission.missionId} failed: ${conciseReasonText(reconciliationError)}`
          );
        }
      }
      // An earlier event at this body or a pending oracle word: the preflight caught it unpaid and
      // it clears on its own, so retry on a flat short interval instead of escalating backoff.
      if (isOrderingOrOracleWait(error)) {
        this.scheduleFlatRetry(candidateRetryKey(candidate));
        return false;
      }
      const retryAfterMs = this.scheduleRetry(candidateRetryKey(candidate));
      this.logger.warn(
        `[mission-resolution] ${method}(${candidate.mission.missionId}) failed; retry in ${Math.ceil(retryAfterMs / 1_000)}s: ${conciseReasonText(error)}`
      );
      return false;
    }
  }

  private canAttempt(candidate: MissionSettlementCandidate): boolean {
    const retry = this.failedCandidateRetries.get(candidateRetryKey(candidate));
    return !retry || retry.retryAtMs <= this.now();
  }

  private scheduleFlatRetry(key: string): void {
    this.failedCandidateRetries.set(key, { failures: 0, retryAtMs: this.now() + initialFailureRetryMs });
  }

  private scheduleRetry(key: string, error?: string): number {
    const failures = (this.failedCandidateRetries.get(key)?.failures ?? 0) + 1;
    const retryAfterMs = Math.min(maxFailureRetryMs, initialFailureRetryMs * 2 ** (failures - 1));
    this.failedCandidateRetries.delete(key);
    this.failedCandidateRetries.set(key, {
      failures,
      retryAtMs: this.now() + retryAfterMs,
      ...(error === undefined ? {} : { error })
    });
    return retryAfterMs;
  }

  private recordLatency(leg: MissionLeg, dueAtSeconds: number): void {
    const seconds = Math.max(0, (this.now() - dueAtSeconds * 1_000) / 1_000);
    const samples = this.latencySamples[leg];
    samples.push(seconds);
    if (samples.length > latencySampleLimit) samples.splice(0, samples.length - latencySampleLimit);
  }

  private healthWarnings(dueArrivals: DueLegSnapshot, dueReturns: DueLegSnapshot): string[] {
    const warnings: string[] = [];
    const targetSeconds = this.promptnessTargetMs / 1_000;
    if (!this.gamePaused && (dueArrivals.oldestAgeSeconds ?? 0) > targetSeconds) warnings.push("stale_due_arrival_backlog");
    if (!this.gamePaused && (dueReturns.oldestAgeSeconds ?? 0) > targetSeconds) warnings.push("stale_due_return_backlog");
    if (this.gamePaused) warnings.push("game_paused");
    if (this.gamePauseAgeSeconds(this.now()) * 1_000 >= this.longPauseAlertAfterMs) {
      warnings.push("game_pause_long_running");
    }
    if (this.moonChanceRetryingCount() > 0) warnings.push("moon_chance_resolution_retrying");
    if (this.lastError) warnings.push("mission_resolution_tick_failed");
    return warnings;
  }
}

// FleetMissionNotResolved(uint64), PendingRandomness(uint256), or chronology ordering not ready.
function isOrderingOrOracleWait(error: unknown): boolean {
  const reason = reasonText(error);
  return reason.includes("0xb3439205") || reason.includes("0x6eb4f8ed") || /ordering is not ready/i.test(reason);
}

function needsCanonicalMissionReconciliation(error: unknown): boolean {
  const reason = reasonText(error);
  // FleetMissionNotResolved(uint64); the selector is stable across the proxy modules. A private-key
  // submission can also reach this path through a mined receipt whose RPC response exposes only the
  // transaction hash, not the revert data. Refreshing that single mission from canonical state is
  // safe for every mined resolver revert and prevents a terminal mission from remaining in the due
  // queue forever. Pre-broadcast failures (funds, nonce, RPC, lease) deliberately do not match.
  return reason.includes("0xb3439205")
    || /transaction 0x[0-9a-f]+ reverted/i.test(reason);
}

export class ViemMissionResolutionChainClient implements MissionResolutionChainClient {
  constructor(
    private readonly reader: Pick<
      VeydriftGameReader,
      "listResolvableFleetMissions" | "listReturnableFleetMissions"
    > & Partial<Pick<VeydriftGameReader, "getCanonicalFleetMission" | "isFleetChronologyOrderingReady">>,
    private readonly gameAddress: Address,
    private readonly sender: Address | ReturnType<typeof privateKeyToAccount>,
    private readonly publicClient?: PublicClient,
    private readonly walletClient?: WalletClient,
    private readonly chain?: ReturnType<typeof defineChain>,
    private readonly rpcUrl?: string,
    private readonly transactionCoordinator = new ResolverTransactionCoordinator(":memory:"),
    private readonly moonAddress?: Address,
    private readonly randomnessEngineAddress?: Address,
    private readonly batchPolicy: MissionBatchPolicy = defaultMissionBatchPolicy
  ) {
    if (this.publicClient && this.chain && this.reader.getCanonicalFleetMission) {
      const address = typeof this.sender === "string" ? this.sender : this.sender.address;
      this.transactionCoordinator.setPreparedReconciler(this.chain.id, address,
        (hash, membership, stored, pass) => this.reconcileBatchReceipt(hash, membership, stored, pass));
    }
  }

  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]> {
    return this.reader.listResolvableFleetMissions();
  }

  listReturnableFleetMissions(): Promise<ReturnableFleetMission[]> {
    return this.reader.listReturnableFleetMissions();
  }

  resolveFleetMission(missionId: string): Promise<string> {
    return this.write("resolveFleetMission", missionId);
  }

  completeFleetMissionReturn(missionId: string): Promise<string> {
    return this.write("completeFleetMissionReturn", missionId);
  }

  isMissionLegComplete(missionId: string, leg: "arrival" | "return"): Promise<boolean> {
    return this.isResolutionOperationComplete(leg === "arrival" ? "resolveFleetMission" : "completeFleetMissionReturn", missionId);
  }

  async resolveMissionBatch(candidates: BatchLeg[]): Promise<{ hash: string | null; items: BatchLeg[]; exclusions: BatchExclusion[]; outcomes?: BatchLegOutcome[] }> {
    if (!this.batchPolicy.enabled) throw new Error("mission batching disabled pending separate release greenlight/runtime enable");
    if (typeof this.sender === "string" || !this.publicClient || !this.chain) throw new Error("durable batching requires local signer");
    const account = this.sender;
    const client = this.publicClient;
    const chainId = this.chain.id;
    if (await this.gamePaused()) throw new GamePausedBeforeResolverAllocationError();
    // Reconcile even when no indexed candidates remain: a mined batch can disappear from the
    // index before a process restarts, but its durable intent must still release the signer.
    await this.transactionCoordinator.reconcilePrepared(chainId, account.address, (hash, membership, stored, pass) => this.reconcileBatchReceipt(hash, membership, stored, pass));
    if (!Number.isInteger(this.batchPolicy.maxItems) || this.batchPolicy.maxItems < 1 || this.batchPolicy.maxItems > 32
      || this.batchPolicy.maxFeeUsdMicros <= 0n || this.batchPolicy.maxFeeUsdMicros > 1_000_000n)
      throw new Error("invalid batch limits; signer guard cannot exceed provisional cap");
    const exclusions: BatchExclusion[] = [];
    const initialBlock = await client.getBlock({ blockTag: "latest" });
    if (initialBlock.number === null) throw new Error("canonical batch block unavailable");
    const fresh = await this.freshBatchCandidates(candidates.slice(0, 100), initialBlock.number, exclusions);
    if (!fresh.length) return { hash: null, items: [], exclusions };
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    const quote = (items: BatchLeg[], currentNonce = nonce, blockNumber = initialBlock.number!) => quoteMissionBatch(client, {
      items, blockNumber, nonce: currentNonce, account: account.address, game: this.gameAddress, chainId, policy: this.batchPolicy
    });
    const packed = await packMissionBatch(fresh, this.batchPolicy.maxItems, quote, (item, reason) => {
      emitObservabilityEvent({ kind: "mission_batch_indivisible_blocker", ...item, reason,
        action: "review contract gas/prerequisites; do not raise cap or bypass batching" }, "warn");
    });
    exclusions.push(...packed.exclusions);
    if (!packed.items.length) return { hash: null, items: [], exclusions };
    const items = packed.items;
    const data = batchCalldata(items);
    const operationId = "mission-batch:" + this.gameAddress.toLowerCase() + ":" + keccak256(data);
    const hash = await this.transactionCoordinator.submit({
      chainId, address: account.address, operationId,
      getTransactionCount: (blockTag) => client.getTransactionCount({ address: account.address, blockTag }),
      submit: async () => { throw new Error("batch requires persisted preparation"); },
      prepare: async (currentNonce, signing) => {
        if (await this.gamePaused()) throw new GamePausedBeforeResolverAllocationError();
        const block = await client.getBlock({ blockTag: "latest" });
        if (block.number === null) throw new Error("canonical batch block unavailable");
        const current = await this.freshBatchCandidates(items, block.number);
        if (JSON.stringify(current) !== JSON.stringify(items)) throw new Error("batch canonical membership changed; repack next tick");
        const fees = await quote(items, currentNonce, block.number); // exact signed-gas productive simulation under lease
        const canonical = await client.getBlock({ blockNumber: block.number });
        if (fees.provenance.blockNumber !== block.number || fees.provenance.blockHash !== block.hash
          || fees.provenance.blockTimestamp !== block.timestamp || canonical.hash !== fees.provenance.blockHash)
          throw new Error("batch quote block changed before signing");
        assertBatchQuoteFresh(fees.provenance);
        const signed = await signing.sign(JSON.stringify(items), () => {
          assertBatchQuoteFresh(fees.provenance);
          return account.signTransaction({ type: "eip1559", chainId, to: this.gameAddress, data,
            nonce: currentNonce, value: 0n, gas: fees.gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        });
        emitObservabilityEvent({ kind: "mission_batch_prepared", legs: items.length, estimates: packed.estimates + 1,
          fillLimit: items.length === this.batchPolicy.maxItems ? "max-items" : items.length < fresh.length ? "fee/gas" : "queue",
          queueAgeSeconds: Math.max(0, Math.floor(Date.now() / 1000) - items[0]!.dueAt),
          estimatedGas: fees.gas.toString(), maxTotalFeeWei: fees.totalWei.toString(), maxTotalUsdMicros: fees.usdMicros.toString(),
          l1FeeWei: fees.l1Fee.toString(), operatorFeeWei: fees.operatorFee.toString() });
        return { hash: keccak256(signed), membership: JSON.stringify(items),
          validateBeforeBroadcast: async () => {
            const canonical = await client.getBlock({ blockNumber: fees.provenance.blockNumber });
            if (canonical.hash !== fees.provenance.blockHash) throw new Error("batch quote block changed before broadcast");
            assertBatchQuoteFresh(fees.provenance);
          },
          // No asynchronous work between this final freshness check and the RPC invocation.
          assertBeforeBroadcast: () => assertBatchQuoteFresh(fees.provenance),
          broadcast: () => client.sendRawTransaction({ serializedTransaction: signed }) };
      },
      reconcilePrepared: (hash, membership, stored, pass) => this.reconcileBatchReceipt(hash, membership, stored, pass),
      isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
      isOperationComplete: async () => false, // partial progress may require another bounded tx
      confirm: async (hash) => { await client.waitForTransactionReceipt({ hash, timeout: 30_000 }); }
      // No replacements/cancellation: unknown receipt blocks the shared signer, never uncapped fees.
    });
    return { hash, items, exclusions, outcomes: this.batchReceiptOutcomes.get(hash) ?? [] };
  }

  private async freshBatchCandidates(items: BatchLeg[], blockNumber?: bigint, exclusions: BatchExclusion[] = []): Promise<BatchLeg[]> {
    const fresh: BatchLeg[] = [];
    for (const item of items) {
      const mission = await this.reader.getCanonicalFleetMission?.(BigInt(item.missionId), blockNumber);
      if (!mission) throw new Error("canonical batch candidate unavailable: " + item.missionId);
      const complete = item.leg === "arrival" ? ["Returning", "Recalled", "Resolved", "Returned"].includes(mission.status)
        : ["Resolved", "Returned"].includes(mission.status);
      const hold = item.leg === "arrival" && mission.missionType === "DefenseHold";
      if (hold && mission.defenseHoldUntil === undefined) throw new Error("canonical defense hold deadline unavailable");
      const dueAt = Number(item.leg === "arrival" ? hold ? mission.defenseHoldUntil : mission.arrivalAt : mission.returnAt);
      const eligible = item.leg === "arrival" ? ["Outbound", "Arrived"].includes(mission.status)
        : ["Returning", "Recalled"].includes(mission.status);
      if (complete || !eligible || dueAt <= 0 || dueAt > Math.floor(Date.now() / 1000)) {
        exclusions.push({ item, reason: complete ? "settled" : "not-due-or-stale", terminal: complete });
        emitObservabilityEvent({ kind: "mission_batch_skip", ...item, reason: complete ? "settled" : "not-due-or-stale" });
        continue;
      }
      if (!await this.reader.isFleetChronologyOrderingReady?.(BigInt(item.missionId), blockNumber)) {
        exclusions.push({ item, reason: "ordering-unavailable" });
        emitObservabilityEvent({ kind: "mission_batch_skip", ...item, reason: "ordering-unavailable" }, "warn");
        continue;
      }
      fresh.push({ ...item, dueAt, ...(hold ? { chronologyKind: 2 as const } : {}) });
    }
    return fresh.sort(compareBatchLegs);
  }

  private readonly batchReceiptOutcomes = new Map<string, BatchLegOutcome[]>();

  private async reconcileBatchReceipt(hash: Hex, membership: string, stored: PreparedReceipt | undefined,
    pass: PreparedReconciliationPass): Promise<PreparedReceipt> {
    const client = this.publicClient!;
    // Durable inclusion/outcomes need only a fresh containing-block hash, not logs/state/fees.
    const finalized = await (pass.finalizedHead ??= pass.read(async () => {
      const block = await client.getBlock({ blockTag: "finalized" });
      if (block.number === null) throw new Error("explicit finalized block unavailable");
      return block.number;
    }));
    if (stored) {
      const block = await pass.read(() => client.getBlock({ blockNumber: BigInt(stored.blockNumber) }));
      if (!block.hash || block.hash !== stored.blockHash) throw new Error("batch receipt is not canonical");
      pass.assertActive();
      return { ...stored, finalized: BigInt(stored.blockNumber) <= finalized };
    }
    const receipt = await pass.read(() => client.getTransactionReceipt({ hash }));
    const block = await pass.read(() => client.getBlock({ blockNumber: receipt.blockNumber }));
    if (!block.hash || block.hash !== receipt.blockHash) throw new Error("batch receipt is not canonical");
    const items: BatchLeg[] = JSON.parse(membership);
    if (!Array.isArray(items) || items.length > 32) throw new Error("invalid persisted batch membership");
    const events = (receipt.logs ?? []).flatMap((log) => {
      if (log.address.toLowerCase() !== this.gameAddress.toLowerCase()) return [];
      try { return [decodeEventLog({ abi: batchReceiptAbi, data: log.data, topics: log.topics }).args]; }
      catch { return []; } // unrelated game events
    });
    const outcomes: BatchLegOutcome[] = [];
    for (const [index, item] of items.entries()) {
      const event = events.find((event) => event.index === BigInt(index) && event.missionId === BigInt(item.missionId)
        && event.leg === (item.leg === "arrival" ? 0 : 1));
      const mission = await pass.read(async () => this.reader.getCanonicalFleetMission?.(BigInt(item.missionId), receipt.blockNumber, pass.assertActive));
      if (!mission) throw new Error("persisted batch member canonical state unavailable");
      const complete = (item.leg === "arrival" ? ["Returning", "Recalled", "Resolved", "Returned"] : ["Resolved", "Returned"]).includes(mission.status);
      let blockedDependency: string | null = null;
      if (!complete) {
        const proof = await pass.read(() => client.readContract({ address: this.gameAddress, abi: batchEligibilityAbi,
          functionName: "fleetMissionEligibility", args: [BigInt(item.missionId)], blockNumber: receipt.blockNumber }));
        blockedDependency = proof[1] === 0n ? null : proof[1].toString();
      }
      outcomes.push({ item, complete, blockedDependency, errorSelector: event?.errorSelector ?? null,
        outcome: receipt.status === "reverted" ? "Reverted" : event ? batchOutcomeNames[event.outcome] ?? "UnknownOutcome" : "MissingOutcome" });
    }
    const extra = receipt as unknown as Record<string, unknown>;
    const l1Fee = rpcQuantity(extra.l1Fee);
    let operatorFee = rpcQuantity(extra.operatorFee);
    let operatorFeeSource = operatorFee === null ? "unavailable" : "receipt";
    if (operatorFee === null) {
      // At the receipt's canonical block the fork-aware oracle supplies actual operator cost.
      try {
        operatorFee = await pass.read(() => client.readContract({ address: gasOracle, abi: oracleAbi,
          functionName: "getOperatorFee", args: [receipt.gasUsed], blockNumber: receipt.blockNumber }));
        operatorFeeSource = "canonical-block-oracle";
      } catch { /* unknown is NOT zero; actual total remains unavailable */ }
    }
    pass.assertActive();
    const executionFee = receipt.gasUsed * receipt.effectiveGasPrice;
    emitObservabilityEvent({ kind: "mission_batch_receipt", hash, status: receipt.status, outcomes,
      gasUsed: receipt.gasUsed.toString(), executionFeeWei: executionFee.toString(),
      l1FeeWei: l1Fee?.toString() ?? null, operatorFeeWei: operatorFee?.toString() ?? null, operatorFeeSource,
      actualTotalFeeWei: l1Fee !== null && operatorFee !== null ? (executionFee + l1Fee + operatorFee).toString() : null });
    this.batchReceiptOutcomes.set(hash, outcomes);
    // Bounded in-memory reporting cache; immutable membership/outcomes remain in SQLite.
    if (this.batchReceiptOutcomes.size > 128) this.batchReceiptOutcomes.delete(this.batchReceiptOutcomes.keys().next().value!);
    return { finalized: receipt.blockNumber <= finalized, blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash, outcomes: JSON.stringify(outcomes) };
  }

  async finalizeMoonChance(outcomeId: string): Promise<"pending" | "finalized"> {
    if (!this.publicClient || !this.moonAddress || !this.randomnessEngineAddress) {
      throw new Error("moon chance resolver is missing canonical contract clients");
    }
    const [requestId, purposeHash, finalized] = await this.publicClient.readContract({
      abi: moonReadAbi, address: this.moonAddress,
      functionName: "moonChanceRandomness", args: [BigInt(outcomeId)]
    });
    if (finalized) return "finalized";
    if (requestId === 0n) throw new Error(`unknown moon chance outcome ${outcomeId}`);
    const request = await this.publicClient.readContract({
      abi: moonReadAbi, address: this.randomnessEngineAddress,
      functionName: "request", args: [requestId]
    });
    if (request.requester.toLowerCase() !== this.moonAddress.toLowerCase()
      || request.purposeHash.toLowerCase() !== purposeHash.toLowerCase() || request.createdAt === 0n) {
      throw new Error(`moon chance ${outcomeId} randomness identity mismatch`);
    }
    if (request.fulfilledAt === 0n) return "pending";
    await this.write("finalizeMoonChance", outcomeId);
    return "finalized";
  }

  async gamePaused(): Promise<boolean> {
    if (!this.publicClient) throw new Error("mission resolver is missing a public client for the canonical game pause probe");
    const value = await this.publicClient.getStorageAt({
      address: this.gameAddress,
      slot: gamePausedStorageSlot
    });
    return value !== undefined && BigInt(value) !== 0n;
  }

  private async write(functionName: "resolveFleetMission" | "completeFleetMissionReturn" | "finalizeMoonChance", missionId: string): Promise<string> {
    const targetAddress = functionName === "finalizeMoonChance" ? this.moonAddress! : this.gameAddress;
    const operationId = functionName === "finalizeMoonChance"
      ? `moon-chance:${targetAddress.toLowerCase()}:${missionId}`
      : `mission:${functionName}:${missionId}`;
    const data = encodeFunctionData({
      abi: veydriftGameResolutionAbi,
      functionName,
      args: [BigInt(missionId)]
    });
    const from = typeof this.sender === "string" ? this.sender : this.sender.address;
    const preflight = async (gas: bigint, nonce: number, fees: ResolverReplacementFees) => {
      if (!this.publicClient?.call) throw new Error("mission resolver is missing RPC simulation client");
      if (functionName !== "finalizeMoonChance" && !await this.reader.isFleetChronologyOrderingReady?.(BigInt(missionId))) {
        throw new Error(`fleet chronology ordering is not ready for ${missionId}; ordering support unavailable`);
      }
      // Ordering support alone does not exclude a chronological/randomness revert. Simulate
      // the exact funded entrypoint at the exact capped gas under the nonce lease before both
      // submit and replacement: a leg that cannot fit the USD cap fails here, unpaid.
      // Empty return data is valid bounded progress; only canonical post-receipt state settles it.
      await this.publicClient.call({ account: from, to: targetAddress, data, gas, nonce, value: 0n, ...fees, blockTag: "latest" });
    };
    // Every single-call write stays within singleResolverMaxUsdMicros: explicit fees, and gas shrunk
    // to what the cap affords. A staged battle uses whatever gas it gets (fewer stages per tx).
    const cappedFees = async (nonce: number, previousHash?: Hex) => {
      const client = this.publicClient!;
      const fees = previousHash ? await resolverReplacementFees(client, previousHash) : await initialResolverFees(client);
      const requested = functionName === "resolveFleetMission"
        ? fleetMissionResolutionGas
        : (await client.estimateGas({ account: from, to: targetAddress, data })) * 6n / 5n;
      const quote = await quoteResolverGas(client, { chainId: this.chain!.id, dataBytes: (data.length - 2) / 2, gas: requested,
        maxFeePerGas: fees.maxFeePerGas, priceFeed: this.batchPolicy.priceFeed, maxUsdMicros: singleResolverMaxUsdMicros });
      await preflight(quote.gas, nonce, fees);
      quote.assertFresh();
      return { gas: quote.gas, ...fees, assertFresh: quote.assertFresh };
    };
    // The service probes once before scanning, but a long batch can straddle an operator pause.
    // Re-check at the final boundary before entering the persistent coordinator: no lease, nonce
    // allocation, wallet estimate, or broadcast is allowed after the canonical pause flips.
    if (await this.gamePaused()) throw new GamePausedBeforeResolverAllocationError();
    if (typeof this.sender !== "string") {
      const account = this.sender;
      if (!this.walletClient || !this.publicClient || !this.chain) {
        throw new Error("private-key mission resolver is missing viem clients");
      }
      return this.transactionCoordinator.submit({
        chainId: this.chain.id,
        address: account.address,
        operationId,
        getTransactionCount: (blockTag) => this.publicClient!.getTransactionCount({
          address: account.address,
          blockTag
        }),
        submit: async (nonce, assertLease) => {
          const { assertFresh, ...fees } = await cappedFees(nonce);
          assertFresh();
          assertLease();
          return this.walletClient!.writeContract({ abi: veydriftGameResolutionAbi, account,
            address: targetAddress, chain: this.chain!, functionName, args: [BigInt(missionId)], nonce, ...fees });
        },
        isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
        isOperationComplete: () => this.isResolutionOperationComplete(functionName, missionId),
        shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
        replace: async (nonce, previousHash, assertLease) => {
          const { assertFresh, ...fees } = await cappedFees(nonce, previousHash);
          assertFresh();
          assertLease();
          return this.walletClient!.writeContract({ abi: veydriftGameResolutionAbi, account,
            address: targetAddress, chain: this.chain!, functionName, args: [BigInt(missionId)], nonce, ...fees });
        },
        cancelStale: (nonce, previousHash, assertLease) => cancelResolverTransaction({
          client: this.publicClient!, wallet: this.walletClient!, account, chain: this.chain!,
          nonce, previousHash, assertLease, priceFeed: this.batchPolicy.priceFeed
        }),
        confirm: (hash) => this.confirm(hash)
      });
    }
    if (!this.rpcUrl || !this.publicClient || !this.chain) {
      throw new Error("unlocked-account mission resolver is missing RPC/public client");
    }
    return this.transactionCoordinator.submit({
      chainId: this.chain.id,
      address: from,
      operationId,
      getTransactionCount: (blockTag) => this.publicClient!.getTransactionCount({
        address: from,
        blockTag
      }),
      submit: async (nonce, assertLease) => {
        const { gas, assertFresh, ...fees } = await cappedFees(nonce);
        assertFresh();
        assertLease();
        return this.sendUnlockedTransaction(from, targetAddress, data, nonce, gas, fees);
      },
      isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
      isOperationComplete: () => this.isResolutionOperationComplete(functionName, missionId),
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
      replace: async (nonce, previousHash, assertLease) => {
        const { gas, assertFresh, ...fees } = await cappedFees(nonce, previousHash);
        assertFresh();
        assertLease();
        return this.sendUnlockedTransaction(from, targetAddress, data, nonce, gas, fees);
      },
      confirm: (hash) => this.confirm(hash)
    });
  }

  private async isResolutionOperationComplete(
    functionName: "resolveFleetMission" | "completeFleetMissionReturn" | "finalizeMoonChance",
    missionId: string
  ): Promise<boolean> {
    if (functionName === "finalizeMoonChance") {
      const state = await this.publicClient!.readContract({
        abi: moonReadAbi, address: this.moonAddress!,
        functionName: "moonChanceRandomness", args: [BigInt(missionId)]
      });
      return state[2];
    }
    const mission = await this.reader.getCanonicalFleetMission?.(BigInt(missionId));
    if (!mission) throw new Error(`canonical mission status unavailable for ${missionId}`);
    if (functionName === "resolveFleetMission") {
      return ["Returning", "Recalled", "Resolved", "Returned"].includes(mission.status);
    }
    return ["Resolved", "Returned"].includes(mission.status);
  }

  private async confirm(hash: Hex): Promise<void> {
    if (!this.publicClient) return;
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`transaction ${hash} reverted`);
    }
  }

  private async isConfirmedCanonical(hash: Hex): Promise<boolean> {
    if (!this.publicClient) return false;
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash });
      return receipt.status === "success";
    } catch {
      return false;
    }
  }

  private async sendUnlockedTransaction(
    from: Address,
    to: Address,
    data: Hex,
    nonce: number,
    gas?: bigint,
    fees?: ResolverReplacementFees
  ): Promise<Hex> {
    const response = await fetch(this.rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendTransaction",
        params: [{
          from,
          to,
          data,
          nonce: `0x${nonce.toString(16)}`,
          ...(gas === undefined ? {} : { gas: `0x${gas.toString(16)}` }),
          ...(fees === undefined ? {} : {
            maxFeePerGas: `0x${fees.maxFeePerGas.toString(16)}`,
            maxPriorityFeePerGas: `0x${fees.maxPriorityFeePerGas.toString(16)}`
          })
        }]
      })
    });
    const body = await response.json() as { error?: { message?: string }; result?: string };
    if (!response.ok || body.error || !body.result) {
      throw new Error(body.error?.message ?? `RPC HTTP ${response.status}`);
    }
    return body.result as Hex;
  }
}

export class GamePausedBeforeResolverAllocationError extends Error {
  constructor() {
    super("canonical game pause is active; resolver transaction allocation is suppressed");
    this.name = "GamePausedBeforeResolverAllocationError";
  }
}

function buildMissionResolutionChainClient(
  config: BackendConfig,
  transactionCoordinator?: ResolverTransactionCoordinator
): MissionResolutionChainClient | undefined {
  if (!config.gameContractAddress || !config.rpcUrl || !config.missionResolutionEnabled) return undefined;
  if (!config.missionResolverAddress && !config.missionResolverPrivateKey) return undefined;

  const reader = new VeydriftGameReader(config, undefined, { hydrateQueueStartedAt: false });
  if (config.missionResolverPrivateKey) {
    const chain = defineChain({
      id: config.chainId,
      name: `veydrift-${config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } }
    });
    const account = privateKeyToAccount(config.missionResolverPrivateKey);
    const transport = http(config.rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });
    return new ViemMissionResolutionChainClient(
      reader,
      config.gameContractAddress,
      account,
      publicClient,
      walletClient,
      chain,
      config.rpcUrl,
      transactionCoordinator ?? new ResolverTransactionCoordinator(
        config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite"
      ),
      config.moonContractAddress,
      config.randomnessEngineAddress,
      config.missionBatch
    );
  }

  const chain = defineChain({
    id: config.chainId,
    name: `veydrift-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } }
  });
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

  return new ViemMissionResolutionChainClient(
    reader,
    config.gameContractAddress,
    config.missionResolverAddress!,
    publicClient,
    undefined,
    chain,
    config.rpcUrl,
    transactionCoordinator ?? new ResolverTransactionCoordinator(
      config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite"
    ),
    config.moonContractAddress,
    config.randomnessEngineAddress,
    config.missionBatch
  );
}

function reasonText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conciseReasonText(error: unknown): string {
  const shortMessage = error && typeof error === "object" && "shortMessage" in error
    ? (error as { shortMessage?: unknown }).shortMessage
    : undefined;
  const message = typeof shortMessage === "string" && shortMessage.trim().length > 0
    ? shortMessage
    : reasonText(error);
  const safeMessage = safeDiagnosticText(message);
  const firstParagraph = safeMessage.split(/\n\s*\n|\nRequest Arguments:|\nContract Call:/)[0] ?? "Unknown resolver failure";
  return firstParagraph
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function candidateRetryKey(candidate: MissionSettlementCandidate): string {
  return `${candidate.leg}:${candidate.mission.missionId}`;
}

function emptyDueLegSnapshot(): DueLegSnapshot {
  return { count: 0, oldestDueAt: null, oldestAgeSeconds: null };
}

function dueLegSnapshot(
  dueAtSeconds: readonly number[],
  nowMs: number
): DueLegSnapshot {
  if (dueAtSeconds.length === 0) return emptyDueLegSnapshot();
  const oldestDueAtSeconds = Math.min(...dueAtSeconds);
  return {
    count: dueAtSeconds.length,
    oldestDueAt: new Date(oldestDueAtSeconds * 1_000).toISOString(),
    oldestAgeSeconds: Math.max(0, (nowMs - oldestDueAtSeconds * 1_000) / 1_000)
  };
}

function toSettlementCandidates(candidates: MissionResolutionCandidates): MissionSettlementCandidate[] {
  return [
    ...candidates.arrivals.map((mission) => ({
      leg: "arrival" as const,
      mission,
      dueAt: Number(mission.arrivalAt)
    })),
    ...candidates.returns.map((mission) => ({
      leg: "return" as const,
      mission,
      dueAt: Number(mission.returnAt)
    }))
  ].sort(compareCandidates);
}

function latencySnapshot(samples: readonly number[]): LatencySnapshot {
  if (samples.length === 0) return { count: 0, lastSeconds: null, maxSeconds: null, p95Seconds: null };
  const sorted = [...samples].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    count: samples.length,
    lastSeconds: samples.at(-1) ?? null,
    maxSeconds: sorted.at(-1) ?? null,
    p95Seconds: sorted[p95Index] ?? null
  };
}

function compareCandidates(
  left: { leg: MissionLeg; mission: { missionId: string }; dueAt: number },
  right: { leg: MissionLeg; mission: { missionId: string }; dueAt: number }
): number {
  if (left.dueAt !== right.dueAt) return left.dueAt - right.dueAt;
  if (left.leg !== right.leg) return left.leg === "arrival" ? -1 : 1;
  const leftId = BigInt(left.mission.missionId);
  const rightId = BigInt(right.mission.missionId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
