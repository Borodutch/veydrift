import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import type { Address, ResolvableFleetMission, ReturnableFleetMission } from "./evm";
import { VeydriftGameReader } from "./evm";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const missionResolutionIntervalMs = 5_000;
const maxMissionsPerTick = 100;
const missionResolutionConcurrency = 4;
const promptnessTargetMs = 60_000;
const latencySampleLimit = 1_000;
const initialFailureRetryMs = 30_000;
const maxFailureRetryMs = 300_000;
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
};

export type MissionResolutionCandidates = {
  arrivals: ResolvableFleetMission[];
  returns: ReturnableFleetMission[];
};

export type MissionResolutionCandidateSource = {
  missionResolutionCandidates(): MissionResolutionCandidates | Promise<MissionResolutionCandidates>;
  /**
   * A resolver revert can expose a stale event-indexed mission status. Re-read just that candidate
   * from canonical storage so it does not remain in the writer's retry loop until a broad repair.
   */
  reconcileMissionResolutionCandidate?(missionId: string): Promise<void>;
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
      const scanStartedAtMs = this.now();
      const candidates = await this.listCandidates();
      this.lastScanDurationMs = Math.max(0, this.now() - scanStartedAtMs);
      const settlementCandidates = toSettlementCandidates(candidates);
      this.publishDueCandidates(settlementCandidates);
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
    while (cursor < attemptable.length && successful < this.maxMissionsPerTick) {
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
        this.lastResolvedMissionId = candidate.mission.missionId;
        this.resolvedCount += 1;
      } else {
        await this.chainClient.completeFleetMissionReturn(candidate.mission.missionId);
        this.lastReturnedMissionId = candidate.mission.missionId;
        this.returnedCount += 1;
      }
      this.recordLatency(candidate.leg, candidate.dueAt);
      this.pendingDueAt[candidate.leg].delete(candidate.mission.missionId);
      this.failedCandidateRetries.delete(candidateRetryKey(candidate));
      return true;
    } catch (error) {
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
    if ((dueArrivals.oldestAgeSeconds ?? 0) > targetSeconds) warnings.push("stale_due_arrival_backlog");
    if ((dueReturns.oldestAgeSeconds ?? 0) > targetSeconds) warnings.push("stale_due_return_backlog");
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

  private async write(functionName: "resolveFleetMission" | "completeFleetMissionReturn", missionId: string): Promise<string> {
    const data = encodeFunctionData({
      abi: veydriftGameResolutionAbi,
      functionName,
      args: [BigInt(missionId)]
    });
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

  private async sendUnlockedTransaction(from: Address, data: Hex, nonce: number, gas?: bigint): Promise<Hex> {
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
          ...(gas === undefined ? {} : { gas: `0x${gas.toString(16)}` })
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
