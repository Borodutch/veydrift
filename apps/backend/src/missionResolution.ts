import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
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
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const missionResolutionIntervalMs = 5_000;
const maxMissionsPerTick = 100;
const missionResolutionConcurrency = 4;
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

const veydriftGameResolutionAbi = [
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
  gamePaused?(): Promise<boolean>;
};

export type MissionResolutionCandidates = {
  arrivals: ResolvableFleetMission[];
  returns: ReturnableFleetMission[];
};

export type MissionResolutionCandidateSource = {
  missionResolutionCandidates(): MissionResolutionCandidates | Promise<MissionResolutionCandidates>;
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
  private readonly failedCandidateRetries = new Map<string, { failures: number; retryAtMs: number }>();

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
      await this.settleCandidates(settlementCandidates);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("[mission-resolution] tick failed", error);
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

  private resolverAddress(): Address | null {
    if (this.config.missionResolverPrivateKey) {
      return privateKeyToAccount(this.config.missionResolverPrivateKey).address.toLowerCase() as Address;
    }
    return this.config.missionResolverAddress?.toLowerCase() as Address | undefined ?? null;
  }

  private async listCandidates(): Promise<MissionResolutionCandidates> {
    if (this.candidateSource) {
      return this.candidateSource.missionResolutionCandidates();
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
      const retryAfterMs = this.scheduleRetry(candidate);
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

  private scheduleRetry(candidate: MissionSettlementCandidate): number {
    const key = candidateRetryKey(candidate);
    const failures = (this.failedCandidateRetries.get(key)?.failures ?? 0) + 1;
    const retryAfterMs = Math.min(maxFailureRetryMs, initialFailureRetryMs * 2 ** (failures - 1));
    this.failedCandidateRetries.set(key, {
      failures,
      retryAtMs: this.now() + retryAfterMs
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
    if (this.lastError) warnings.push("mission_resolution_tick_failed");
    return warnings;
  }
}

function needsCanonicalMissionReconciliation(error: unknown): boolean {
  const reason = conciseReasonText(error);
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
    private readonly reader: Pick<VeydriftGameReader, "listResolvableFleetMissions" | "listReturnableFleetMissions">,
    private readonly gameAddress: Address,
    private readonly sender: Address | ReturnType<typeof privateKeyToAccount>,
    private readonly publicClient?: PublicClient,
    private readonly walletClient?: WalletClient,
    private readonly chain?: ReturnType<typeof defineChain>,
    private readonly rpcUrl?: string,
    private readonly transactionCoordinator = new ResolverTransactionCoordinator(":memory:")
  ) {}

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

  async gamePaused(): Promise<boolean> {
    if (!this.publicClient) throw new Error("mission resolver is missing a public client for the canonical game pause probe");
    const value = await this.publicClient.getStorageAt({
      address: this.gameAddress,
      slot: gamePausedStorageSlot
    });
    return value !== undefined && BigInt(value) !== 0n;
  }

  private async write(functionName: "resolveFleetMission" | "completeFleetMissionReturn", missionId: string): Promise<string> {
    const data = encodeFunctionData({
      abi: veydriftGameResolutionAbi,
      functionName,
      args: [BigInt(missionId)]
    });
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
        operationId: `mission:${functionName}:${missionId}`,
        getTransactionCount: (blockTag) => this.publicClient!.getTransactionCount({
          address: account.address,
          blockTag
        }),
        submit: (nonce) => this.walletClient!.writeContract({
          abi: veydriftGameResolutionAbi,
          account,
          address: this.gameAddress,
          chain: this.chain!,
          functionName,
          args: [BigInt(missionId)],
          nonce,
          ...(functionName === "resolveFleetMission" ? { gas: fleetMissionResolutionGas } : {})
        }),
        isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
        shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
        replace: async (nonce, previousHash) => this.walletClient!.writeContract({
          abi: veydriftGameResolutionAbi,
          account,
          address: this.gameAddress,
          chain: this.chain!,
          functionName,
          args: [BigInt(missionId)],
          nonce,
          ...(functionName === "resolveFleetMission" ? { gas: fleetMissionResolutionGas } : {}),
          ...await resolverReplacementFees(this.publicClient!, previousHash)
        }),
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
      operationId: `mission:${functionName}:${missionId}`,
      getTransactionCount: (blockTag) => this.publicClient!.getTransactionCount({
        address: from,
        blockTag
      }),
      submit: (nonce) => this.sendUnlockedTransaction(
        from,
        data,
        nonce,
        functionName === "resolveFleetMission" ? fleetMissionResolutionGas : undefined
      ),
      isConfirmedCanonical: (hash) => this.isConfirmedCanonical(hash),
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient!, hash),
      replace: async (nonce, previousHash) => this.sendUnlockedTransaction(
        from,
        data,
        nonce,
        functionName === "resolveFleetMission" ? fleetMissionResolutionGas : undefined,
        await resolverReplacementFees(this.publicClient!, previousHash)
      ),
      confirm: (hash) => this.confirm(hash)
    });
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
          to: this.gameAddress,
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
      )
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
    )
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
  const firstParagraph = message.split(/\n\s*\n|\nRequest Arguments:|\nContract Call:/)[0] ?? "Unknown resolver failure";
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
