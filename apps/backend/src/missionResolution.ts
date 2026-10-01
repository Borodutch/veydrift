import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  formatTransactionRequest,
  parseTransaction,
  parseAbi,
  toHex,
  type Hex,
  type PublicClient,
  type TransactionRequest,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BackendConfig } from "./config";
import { guardAllows, consumeProgress, progressKey, readMissionProgress, type MissionProgress, type ProgressGuard } from "../../battle-keeper/src/progress";
import { assertSignedTarget, signedAttempt, resumeSignedAttempt, MinedRevertError, PreBroadcastError, type SignedAttempt } from "../../battle-keeper/src/transaction";
import type { Address, GameMaintenanceState, ResolvableFleetMission, ReturnableFleetMission } from "./evm";
import { VeydriftGameReader } from "./evm";
import { emitObservabilityEvent } from "./observability";
import {
  resolverReplacementFees,
  resolverTransactionNeedsReplacement,
  type ResolverReplacementFees
} from "./resolverReplacementFees";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { safeDiagnosticText } from "./safeDiagnostics";

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
// Match the audited keeper envelope below Base's 2^24 cap. Explicit gas avoids Reth's
// misleading inner-delegatecall estimate; backend must not become a higher-gas retry bypass.
const fleetMissionResolutionGas = 15_000_000n;

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
  completeFleetMissionReturn(missionId: string): Promise<string>;
  isMissionLegComplete?(missionId: string, leg: "arrival" | "return"): Promise<boolean>;
  gamePaused?(): Promise<boolean>;
  recoverPendingMissions?(): Promise<string[]>;
  finalizeMoonChance?(outcomeId: string): Promise<"pending" | "finalized">;
};

export type MissionResolutionCandidates = {
  arrivals: ResolvableFleetMission[];
  returns: ReturnableFleetMission[];
};

export type MoonChanceResolutionCandidate = { cursor: number; outcomeId: string };

export type MissionResolutionCandidateSource = {
  moonChanceResolutionCandidateCount?(): number;
  moonChanceResolutionCandidates?(afterCursor: number, limit: number): MoonChanceResolutionCandidate[];
  moonChanceTerminalOutcomeIds?(outcomeIds: readonly string[]): string[];
  missionResolutionCandidates(asOfSeconds?: number, limit?: number): MissionResolutionCandidates | Promise<MissionResolutionCandidates>;
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
  private readonly chunkPending = new Set<string>();
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
      if (!paused) {
        for (const missionId of await this.chainClient.recoverPendingMissions?.() ?? []) {
          await this.candidateSource?.reconcileMissionResolutionCandidate?.(missionId);
        }
      }
      const scanStartedAtMs = this.now();
      const candidates = await this.listCandidates();
      this.lastScanDurationMs = Math.max(0, this.now() - scanStartedAtMs);
      const settlementCandidates = toSettlementCandidates(candidates);
      this.publishDueCandidates(settlementCandidates);
      for (const id of this.chunkPending) {
        if (!settlementCandidates.some(candidate => candidate.mission.missionId === id)) this.chunkPending.delete(id);
      }
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

  private async listCandidates(): Promise<MissionResolutionCandidates> {
    if (this.candidateSource) {
      return this.candidateSource.missionResolutionCandidates(undefined, this.maxMissionsPerTick * 5);
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
      this.chunkPending.delete(candidate.mission.missionId);
      return true;
    } catch (error) {
      if (error instanceof GamePausedBeforeResolverAllocationError) {
        this.observeGamePause(true, this.now());
        this.recordPausedResolutionAttempts([candidate], this.now());
        return false;
      }
      if (error instanceof MissionChunkPendingError) {
        await this.candidateSource?.reconcileMissionResolutionCandidate?.(candidate.mission.missionId);
        // Read-only probes remain prompt; durable operation identity suppresses paid no-op retries.
        this.chunkPending.add(candidate.mission.missionId);
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
    if (this.chunkPending.size > 0) warnings.push("mission_chunk_pending_progress_guard");
    if (this.lastError) warnings.push("mission_resolution_tick_failed");
    return warnings;
  }
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
  private readonly progressDb: Database;
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
    progressStorePath = ":memory:",
    private readonly arrivalProgressVersions: readonly string[] = []
  ) {
    if (progressStorePath !== ":memory:") mkdirSync(dirname(progressStorePath), { recursive: true });
    this.progressDb = new Database(progressStorePath, { create: true });
    this.progressDb.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    this.progressDb.exec("CREATE TABLE IF NOT EXISTS mission_progress_intents (identity TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mission_signed_attempts (identity TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  private async reconcilePreparedMissions(): Promise<void> {
    if (!this.chain || !this.reader.getCanonicalFleetMission) return;
    const address = typeof this.sender === "string" ? this.sender : this.sender.address;
    await this.transactionCoordinator.withAccountLease(this.chain.id, address, async lease => {
      lease.reconcilePreparations(this.progressDb, `${this.chain!.id}:${this.gameAddress.toLowerCase()}:`);
    });
  }

  async recoverPendingMissions(): Promise<string[]> {
    await this.reconcilePreparedMissions();
    const recovered: string[] = [];
    const prefix = [this.chain!.id, this.gameAddress.toLowerCase()].join(":") + ":";
    for (const row of this.progressDb.query<{ identity: string }, []>("SELECT identity FROM mission_signed_attempts").all()) {
      if (!row.identity.startsWith(prefix)) continue;
      const [missionId, leg] = row.identity.slice(prefix.length).split(":");
      if (!missionId || (leg !== "resolveFleetMission" && leg !== "completeFleetMissionReturn")) {
        throw new Error("invalid persisted mission identity");
      }
      await this.writeGuardedMission(leg, missionId);
      recovered.push(missionId);
    }
    return recovered;
  }

  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]> {
    return this.reader.listResolvableFleetMissions();
  }

  listReturnableFleetMissions(): Promise<ReturnableFleetMission[]> {
    return this.reader.listReturnableFleetMissions();
  }

  async resolveFleetMission(missionId: string): Promise<string> {
    await this.reconcilePreparedMissions();
    if (this.reader.getCanonicalFleetMission && !this.loadSigned(missionId, "resolveFleetMission")) {
      const mission = await this.reader.getCanonicalFleetMission(BigInt(missionId));
      if (!mission) throw new Error("canonical mission unavailable; resolver signing disabled");
      if (["Returning", "Recalled", "Resolved", "Returned"].includes(mission.status)) return "canonical:arrival-complete";
      if (mission.status !== "Outbound") throw new Error("canonical mission status unavailable; resolver signing disabled");
    }
    const hash = await this.write("resolveFleetMission", missionId);
    if (this.reader.getCanonicalFleetMission) {
      const mission = await this.reader.getCanonicalFleetMission(BigInt(missionId));
      if (!mission || mission.status === "Outbound") throw new MissionChunkPendingError();
    }
    return hash;
  }

  async completeFleetMissionReturn(missionId: string): Promise<string> {
    await this.reconcilePreparedMissions();
    if (this.reader.getCanonicalFleetMission && !this.loadSigned(missionId, "completeFleetMissionReturn") && await this.isResolutionOperationComplete("completeFleetMissionReturn", missionId)) {
      return "canonical:return-complete";
    }
    const hash = await this.write("completeFleetMissionReturn", missionId);
    if (this.reader.getCanonicalFleetMission && !await this.isResolutionOperationComplete("completeFleetMissionReturn", missionId)) {
      throw new MissionChunkPendingError();
    }
    return hash;
  }

  isMissionLegComplete(missionId: string, leg: "arrival" | "return"): Promise<boolean> {
    return this.isResolutionOperationComplete(leg === "arrival" ? "resolveFleetMission" : "completeFleetMissionReturn", missionId);
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

  private async preflightMission(functionName: "resolveFleetMission" | "completeFleetMissionReturn" | "finalizeMoonChance", missionId: string, envelope?: TransactionRequest, assertLease: () => void = () => {}): Promise<void> {
      if (functionName === "finalizeMoonChance") return;
      assertLease();
      if (!await this.reader.isFleetChronologyOrderingReady?.(BigInt(missionId))) {
        throw new Error(`fleet chronology ordering is not ready for ${missionId}; ordering support unavailable`);
      }
      assertLease();
      if (!this.publicClient?.call) throw new Error("mission resolver is missing RPC simulation client");
      if (envelope) {
        // viem.call drops transaction type (and some typed-envelope fields). Format directly so
        // the RPC sees the same envelope as the signer, including access/authorization lists.
        const request = formatTransactionRequest({
          ...envelope, from: typeof this.sender === "string" ? this.sender : this.sender.address,
          value: envelope.value ?? 0n
        });
        if (envelope.type && envelope.type !== "legacy") request.accessList ??= [];
        await this.publicClient.request({ method: "eth_call", params: [request, "latest"] });
        assertLease();
        return;
      }
      // Early entrypoint check before allocation. The guarded path additionally simulates the
      // prepared envelope before signing and the validated durable envelope before dispatch.
      await this.publicClient.call({
        account: typeof this.sender === "string" ? this.sender : this.sender.address,
        to: this.gameAddress,
        data: encodeFunctionData({ abi: veydriftGameResolutionAbi, functionName, args: [BigInt(missionId)] }),
        gas: fleetMissionResolutionGas,
        blockTag: "latest"
      });
      assertLease();
  }

  private async write(functionName: "resolveFleetMission" | "completeFleetMissionReturn" | "finalizeMoonChance", missionId: string): Promise<string> {
    const targetAddress = functionName === "finalizeMoonChance" ? this.moonAddress! : this.gameAddress;
    if (functionName !== "finalizeMoonChance" && this.reader.getCanonicalFleetMission) {
      return this.writeGuardedMission(functionName, missionId);
    }
    if (this.progressDb.query("SELECT 1 FROM mission_signed_attempts LIMIT 1").get()) {
      throw new Error("a durable signed mission must be reconciled before other resolver writes");
    }
    // Older injected adapters and moon settlement retain the existing coordinator path.
    const operationId = functionName === "finalizeMoonChance"
      ? `moon-chance:${targetAddress.toLowerCase()}:${missionId}` : `mission:${functionName}:${missionId}`;
    const data = encodeFunctionData({
      abi: veydriftGameResolutionAbi,
      functionName,
      args: [BigInt(missionId)]
    });
    const preflight = () => this.preflightMission(functionName, missionId);
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
        submit: async (nonce) => {
          await preflight();
          return this.walletClient!.writeContract({
            abi: veydriftGameResolutionAbi,
            account,
            address: targetAddress,
            chain: this.chain!,
            functionName,
            args: [BigInt(missionId)],
            nonce,
            gas: fleetMissionResolutionGas
          });
        },
        isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
        isOperationComplete: () => this.isResolutionOperationComplete(functionName, missionId),
        shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
        replace: async (nonce, previousHash) => {
          await preflight();
          return this.walletClient!.writeContract({
            abi: veydriftGameResolutionAbi,
            account,
            address: targetAddress,
            chain: this.chain!,
            functionName,
            args: [BigInt(missionId)],
            nonce,
            gas: fleetMissionResolutionGas,
            ...await resolverReplacementFees(this.publicClient!, previousHash)
          });
        },
        cancelStale: async (nonce, previousHash) => this.walletClient!.sendTransaction({
          account,
          chain: this.chain!,
          nonce,
          to: account.address,
          value: 0n,
          ...await resolverReplacementFees(this.publicClient!, previousHash)
        }),
        confirm: (hash) => this.confirm(hash)
      });
    }
    if (!this.rpcUrl || !this.publicClient || !this.chain) {
      throw new Error("unlocked-account mission resolver is missing RPC/public client");
    }
    const from = this.sender as Address;
    return this.transactionCoordinator.submit({
      chainId: this.chain.id,
      address: from,
      operationId,
      getTransactionCount: (blockTag) => this.publicClient!.getTransactionCount({
        address: from,
        blockTag
      }),
      submit: async (nonce) => {
        await preflight();
        return this.sendUnlockedTransaction(
          from,
          targetAddress,
          data,
          nonce,
          functionName === "resolveFleetMission" ? fleetMissionResolutionGas : undefined
        );
      },
      isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
      isOperationComplete: () => this.isResolutionOperationComplete(functionName, missionId),
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
      replace: async (nonce, previousHash) => {
        await preflight();
        return this.sendUnlockedTransaction(
          from,
          targetAddress,
          data,
          nonce,
          functionName === "resolveFleetMission" ? fleetMissionResolutionGas : undefined,
          await resolverReplacementFees(this.publicClient!, previousHash)
        );
      },
      confirm: (hash) => this.confirm(hash)
    });
  }

  private progressIdentity(missionId: string, leg: string): string {
    return [this.chain!.id, this.gameAddress.toLowerCase(), missionId, leg].join(":");
  }

  private loadSigned(missionId: string, leg: string): SignedAttempt | undefined {
    const row = this.progressDb.query<{ value: string }, [string]>(
      "SELECT value FROM mission_signed_attempts WHERE identity = ?").get(this.progressIdentity(missionId, leg));
    return row ? JSON.parse(row.value) as SignedAttempt : undefined;
  }

  private loadGuard(identity: string): ProgressGuard | undefined {
    const row = this.progressDb.query<{ value: string }, [string]>(
      "SELECT value FROM mission_progress_intents WHERE identity = ?").get(identity);
    if (!row) return undefined;
    const value = JSON.parse(row.value) as ProgressGuard | MissionProgress;
    // The pre-release A7 intent format is conservative on migration, never silently discarded.
    return "before" in value ? value : { missionId: "legacy", leg: "arrival", before: value };
  }

  private async writeGuardedMission(functionName: "resolveFleetMission" | "completeFleetMissionReturn", missionId: string): Promise<string> {
    if (!this.publicClient || !this.chain) throw new Error("canonical resolver clients unavailable");
    const address = typeof this.sender === "string" ? this.sender : this.sender.address;
    return this.transactionCoordinator.withAccountLease(this.chain.id, address, async lease => {
      lease.reconcilePreparations(this.progressDb, `${this.chain!.id}:${this.gameAddress.toLowerCase()}:`);
      const identity = this.progressIdentity(missionId, functionName);
      const transport = { request: async <T>(method: string, params: unknown[]): Promise<T> => {
        lease.assert();
        // Recovery retains exact raw bytes, but must still respect current chronology before
        // a new dispatch. Canonical receipt-only recovery does not re-simulate or broadcast.
        if (method === "eth_sendRawTransaction") {
          try {
            const attempt = this.loadSigned(missionId, functionName);
            if (!attempt || params[0] !== attempt.raw) throw new Error("raw dispatch differs from durable mission envelope");
            await assertSignedTarget(attempt, { from: address, to: this.gameAddress,
              data: encodeFunctionData({ abi: veydriftGameResolutionAbi, functionName, args: [BigInt(missionId)] }),
              chainId: this.chain!.id, maxGas: fleetMissionResolutionGas });
            lease.assert();
            const { sidecars: _sidecars, ...envelope } = parseTransaction(attempt.raw);
            await this.preflightMission(functionName, missionId, envelope, lease.assert);
          } catch (error) { throw new PreBroadcastError(error); }
        }
        lease.assert();
        return this.publicClient!.request({ method, params } as never) as Promise<T>;
      } };
      const finish = async (attempt: SignedAttempt): Promise<Hex> => {
        const consumeReceipt = (reverted = false) => {
          lease.assert();
          const current = this.loadSigned(missionId, functionName);
          if (current?.hash !== attempt.hash || current.nonce !== attempt.nonce) {
            throw new Error("stale signed mission acknowledgment; guard unchanged");
          }
          if (!attempt.progress) throw new Error("signed mission missing progress checkpoint");
          // These connections share one SQLite file in production: acknowledge outside the local
          // write transaction, under the same account lease. A crash here retains the paid envelope
          // for receipt-only recovery, rather than orphaning a central reservation after local delete.
          lease.acknowledge(identity + ":progress:" + progressKey(attempt.progress), Number(attempt.nonce), attempt.hash, reverted);
          this.progressDb.transaction(() => {
            lease.assert();
            const deleted = this.progressDb.query(
              "DELETE FROM mission_signed_attempts WHERE identity = ? AND json_extract(value, '$.hash') = ? AND json_extract(value, '$.nonce') = ?"
            ).run(identity, attempt.hash, attempt.nonce);
            if (deleted.changes !== 1) throw new Error("stale signed mission acknowledgment; guard unchanged");
            if (!attempt.progress) throw new Error("signed mission missing progress checkpoint");
            const guard = consumeProgress(this.loadGuard(identity), attempt.progress, missionId,
              functionName === "resolveFleetMission" ? "arrival" : "return");
            this.progressDb.query("INSERT OR REPLACE INTO mission_progress_intents VALUES (?, ?)")
              .run(identity, JSON.stringify(guard));
          }).immediate();
        };
        try {
          await assertSignedTarget(attempt, { from: typeof this.sender === "string" ? this.sender : this.sender.address,
            to: this.gameAddress, data: encodeFunctionData({ abi: veydriftGameResolutionAbi, functionName, args: [BigInt(missionId)] }),
            chainId: this.chain!.id, maxGas: fleetMissionResolutionGas });
          lease.assert();
          const hash = await resumeSignedAttempt(transport, attempt);
          consumeReceipt();
          return hash;
        } catch (error) {
          if (error instanceof MinedRevertError) consumeReceipt(true);
          throw error;
        }
      };
      const previous = this.loadSigned(missionId, functionName);
      // Recovery cannot allocate a nonce or sign: replay only the persisted bytes. It is safe even
      // if the coordinator process died before it recorded the returned hash (allocating state).
      if (previous) {
        if (!previous.progress) throw new Error("signed mission missing progress checkpoint");
        return lease.recover(identity + ":progress:" + progressKey(previous.progress), Number(previous.nonce), previous.hash, () => finish(previous));
      }
      if (this.progressDb.query("SELECT 1 FROM mission_signed_attempts LIMIT 1").get()) {
        throw new Error("another durable signed mission owns the resolver nonce");
      }
      if (await this.gamePaused()) throw new GamePausedBeforeResolverAllocationError();
      const progress = await this.resolutionProgress(missionId);
      if (progress.arrivalCapability === false || (progress.arrivalOrderCursor !== undefined && progress.arrivalGeneration === undefined)) {
        throw new Error("arrival progress runtime unverified: configure the reviewed implementation/runtime hash after Game upgrade");
      }
      if (!guardAllows(this.loadGuard(identity), progress)) throw new MissionChunkPendingError();
      await this.preflightMission(functionName, missionId, undefined, lease.assert);
      const account = typeof this.sender === "string" ? undefined : this.sender;
      return lease.submit({
        chainId: this.chain!.id, address, operationId: identity + ":progress:" + progressKey(progress), signedEnvelope: true,
        preparation: { store: this.progressDb, identity },
        getTransactionCount: blockTag => this.publicClient!.getTransactionCount({ address, blockTag }),
        isConfirmedCanonical: hash => this.isConfirmedCanonical(hash),
        isOperationComplete: async () => true,
        submit: async nonce => {
          if (this.progressDb.query("SELECT 1 FROM mission_signed_attempts LIMIT 1").get()) {
            throw new Error("another durable signed mission owns the resolver nonce");
          }
          if (await this.gamePaused()) throw new GamePausedBeforeResolverAllocationError();
          const current = await this.resolutionProgress(missionId);
          if (progressKey(progress) !== progressKey(current) || !guardAllows(this.loadGuard(identity), current)) {
            throw new MissionChunkPendingError();
          }
          await this.preflightMission(functionName, missionId, undefined, lease.assert);
          const data = encodeFunctionData({ abi: veydriftGameResolutionAbi, functionName, args: [BigInt(missionId)] });
          // Fee/gas preparation and signing are entirely pre-broadcast. Definite failures here leave
          // no consumed intent. Persist deterministic raw bytes before the first send RPC.
          const request = await this.publicClient!.prepareTransactionRequest({
            account: address, chain: null, to: this.gameAddress, data, nonce,
            gas: fleetMissionResolutionGas, value: 0n, type: "eip1559", accessList: []
          });
          lease.assert();
          await this.preflightMission(functionName, missionId, request, lease.assert);
          let raw: Hex;
          if (account) raw = await account.signTransaction({ ...request, chainId: this.chain!.id } as never);
          else {
            const signed = await transport.request<Hex | { raw: Hex }>("eth_signTransaction", [{
              ...formatTransactionRequest({ ...request, from: address }), chainId: toHex(this.chain!.id)
            }]);
            raw = typeof signed === "string" ? signed : signed.raw;
          }
          const attempt = signedAttempt(raw, nonce, current);
          lease.assert();
          this.progressDb.query("INSERT INTO mission_signed_attempts VALUES (?, ?)").run(identity, JSON.stringify(attempt));
          // Coordinator now records the deterministic hash before confirm performs any broadcast.
          return attempt.hash;
        },
        confirm: async hash => {
          const attempt = this.loadSigned(missionId, functionName);
          if (attempt) {
            if (attempt.hash !== hash) throw new Error("coordinator/signed transaction identity mismatch");
            await finish(attempt);
          } else await this.confirm(hash);
        }
      });
    });
  }

  private async resolutionProgress(missionId: string): Promise<MissionProgress> {
    const mission = await this.reader.getCanonicalFleetMission!(BigInt(missionId));
    if (!mission) throw new Error("canonical mission unavailable; resolver signing disabled");
    if (!this.publicClient) throw new Error("canonical progress client unavailable");
    const transport = {
      request: <T>(method: string, params: unknown[]): Promise<T> =>
        this.publicClient!.request({ method, params } as never) as Promise<T>
    };
    const progress = await readMissionProgress(transport, this.gameAddress, missionId,
      mission.status === "Outbound" ? mission.targetPlanetId : undefined,
      mission.missionTypeId === 7, this.arrivalProgressVersions);
    return progress;
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
    if (!mission) {
      if (this.reader.getCanonicalFleetMission) throw new Error("canonical mission status unavailable; resolver signing disabled");
      return true;
    }
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

export class MissionChunkPendingError extends Error {
  constructor() {
    super("mission remains pending; paid retries require canonical progress/version change");
    this.name = "MissionChunkPendingError";
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
      config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite",
      config.arrivalProgressVersions ?? []
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
    config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite",
    config.arrivalProgressVersions ?? []
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
