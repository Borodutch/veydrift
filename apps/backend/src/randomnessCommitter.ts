import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import {
  FileRandomnessCommitmentStore,
  saveRandomnessReadinessSnapshot,
  SqliteRandomnessCommitmentStore,
  RandomnessCommitmentWorker,
  type RandomnessCommitmentChainClient,
  type RandomnessCommitmentInventory,
  type RandomnessCommitmentStatus,
  type RandomnessCommitmentStore,
  type RandomnessRequestCandidateSource,
  type RandomnessRequestEvent
} from "./randomness";
import { resolverReplacementFees, resolverTransactionNeedsReplacement } from "./resolverReplacementFees";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

/**
 * Minimal RandomnessEngine ABI: the commit-reveal surface the backend fulfiller drives. Keeping it
 * inline (rather than importing a generated artifact) avoids a build dependency on the contracts
 * package while staying in lockstep with `packages/contracts/src/RandomnessEngine.sol`.
 */
const randomnessEngineAbi = [
  {
    type: "function",
    name: "nextRequestId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "randomnessCommitmentInventory",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "bytes32[]", name: "commitments" },
      { type: "uint64[]", name: "committedAtBlocks" },
      { type: "uint256", name: "readyCount" }
    ]
  },
  {
    type: "function",
    name: "randomnessCommitment",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "randomWord" }],
    outputs: [{ type: "bytes32" }]
  },
  {
    type: "function",
    name: "request",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "requestId" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "address", name: "requester" },
          { type: "bytes32", name: "purposeHash" },
          { type: "bytes32", name: "randomnessCommitment" },
          { type: "uint64", name: "createdAt" },
          { type: "uint64", name: "fulfilledAt" },
          { type: "uint256", name: "randomWord" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "commitRandomnessBatch",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32[]", name: "commitments" }],
    outputs: []
  },
  {
    type: "function",
    name: "fulfillRandomness",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "requestId" },
      { type: "uint256", name: "randomWord" }
    ],
    outputs: []
  }
] as const;

const zeroAddress = "0x0000000000000000000000000000000000000000";

type EngineRequest = {
  requester: `0x${string}`;
  purposeHash: Hex;
  randomnessCommitment: Hex;
  createdAt: bigint;
  fulfilledAt: bigint;
  randomWord: bigint;
};

/**
 * viem-backed implementation of the precommit lifecycle chain client. Reads engine state via a
 * public client and signs commit/reveal transactions locally with the configured fulfiller key, so
 * it works against hosted RPC providers (Base Sepolia / Alchemy) that have no unlocked accounts.
 */
export class ViemRandomnessCommitmentChainClient implements RandomnessCommitmentChainClient {
  private scanFloorId = 1n;
  private lastFullRescanAt = Date.now();
  private historicalAuditCursorId = 1n;

  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly engineAddress: `0x${string}`,
    private readonly account: ReturnType<typeof privateKeyToAccount>,
    private readonly chain: ReturnType<typeof defineChain>,
    private readonly transactionCoordinator = new ResolverTransactionCoordinator(":memory:"),
    private readonly candidateSource?: RandomnessRequestCandidateSource
  ) {}

  get fulfillerAddress(): `0x${string}` {
    return this.account.address;
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.publicClient.getBlockNumber());
  }

  async getCommitmentInventory(): Promise<RandomnessCommitmentInventory> {
    const [commitments, committedAtBlocks, readyCount] = (await this.publicClient.readContract({
      abi: randomnessEngineAbi,
      address: this.engineAddress,
      functionName: "randomnessCommitmentInventory"
    })) as readonly [readonly Hex[], readonly bigint[], bigint];

    return {
      commitments: commitments.map((commitment, index) => ({
        commitment,
        committedAtBlock: Number(committedAtBlocks[index] ?? 0n)
      })),
      readyCommitments: Number(readyCount)
    };
  }

  /**
   * Resolve the commitment via the on-chain view rather than recomputing keccak client-side. This
   * guarantees the value we commit is exactly what `fulfillRandomness` will recompute at reveal time
   * (a client-side mismatch would brick every consuming request with RandomnessCommitmentMismatch).
   */
  async computeCommitment(randomWord: bigint): Promise<string> {
    const commitment = (await this.publicClient.readContract({
      abi: randomnessEngineAbi,
      address: this.engineAddress,
      functionName: "randomnessCommitment",
      args: [randomWord]
    })) as Hex;
    return commitment;
  }

  async commitRandomnessBatch(commitments: string[]): Promise<string> {
    const operationId = `randomness:commit:${createHash("sha256").update(commitments.join(":"), "utf8").digest("hex")}`;
    return this.transactionCoordinator.submit({
      chainId: this.chain.id,
      address: this.account.address,
      operationId,
      getTransactionCount: (blockTag) => this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag
      }),
      submit: (nonce) => this.walletClient.writeContract({
        abi: randomnessEngineAbi,
        account: this.account,
        address: this.engineAddress,
        chain: this.chain,
        functionName: "commitRandomnessBatch",
        args: [commitments as Hex[]],
        nonce
      }),
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient, hash),
      replace: async (nonce, previousHash) => this.walletClient.writeContract({
        abi: randomnessEngineAbi,
        account: this.account,
        address: this.engineAddress,
        chain: this.chain,
        functionName: "commitRandomnessBatch",
        args: [commitments as Hex[]],
        nonce,
        ...await resolverReplacementFees(this.publicClient, previousHash)
      }),
      cancelStale: async (nonce, previousHash) => this.walletClient.sendTransaction({
        account: this.account,
        chain: this.chain,
        nonce,
        to: this.account.address,
        value: 0n,
        ...await resolverReplacementFees(this.publicClient, previousHash)
      }),
      confirm: (hash) => this.confirm(hash)
    });
  }

  async fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string> {
    return this.transactionCoordinator.submit({
      chainId: this.chain.id,
      address: this.account.address,
      operationId: `randomness:fulfill:${requestId}`,
      getTransactionCount: (blockTag) => this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag
      }),
      submit: (nonce) => this.walletClient.writeContract({
        abi: randomnessEngineAbi,
        account: this.account,
        address: this.engineAddress,
        chain: this.chain,
        functionName: "fulfillRandomness",
        args: [requestId, randomWord],
        nonce
      }),
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient, hash),
      replace: async (nonce, previousHash) => this.walletClient.writeContract({
        abi: randomnessEngineAbi,
        account: this.account,
        address: this.engineAddress,
        chain: this.chain,
        functionName: "fulfillRandomness",
        args: [requestId, randomWord],
        nonce,
        ...await resolverReplacementFees(this.publicClient, previousHash)
      }),
      cancelStale: async (nonce, previousHash) => this.walletClient.sendTransaction({
        account: this.account,
        chain: this.chain,
        nonce,
        to: this.account.address,
        value: 0n,
        ...await resolverReplacementFees(this.publicClient, previousHash)
      }),
      confirm: (hash) => this.confirm(hash)
    });
  }

  async listPendingRequests(): Promise<RandomnessRequestEvent[]> {
    const nextRequestId = (await this.publicClient.readContract({
      abi: randomnessEngineAbi,
      address: this.engineAddress,
      functionName: "nextRequestId"
    })) as bigint;

    const indexed = await this.candidateSource?.randomnessRequestCandidates();
    let nextHistoricalAuditCursorId = this.historicalAuditCursorId;
    if (!indexed && Date.now() - this.lastFullRescanAt >= fullRandomnessRequestRescanIntervalMs) {
      // The standalone/fallback client has no canonical event ledger. Preserve its periodic reorg
      // safety scan; the production backend always supplies candidateSource and never enters here.
      this.scanFloorId = 1n;
      this.lastFullRescanAt = Date.now();
    }
    const requestIds = new Set<bigint>();
    for (const requestId of indexed?.pendingRequestIds ?? []) {
      const id = BigInt(requestId);
      if (id > 0n && id < nextRequestId) requestIds.add(id);
    }
    if (indexed && nextRequestId > 1n) {
      if (nextHistoricalAuditCursorId >= nextRequestId) nextHistoricalAuditCursorId = 1n;
      for (
        let audited = 0;
        audited < historicalRandomnessRequestAuditBatchSize && nextHistoricalAuditCursorId < nextRequestId;
        audited += 1
      ) {
        requestIds.add(nextHistoricalAuditCursorId);
        nextHistoricalAuditCursorId += 1n;
      }
    }
    const tailStart = indexed
      ? BigInt(indexed.highestIndexedRequestId) + 1n
      : this.scanFloorId;
    const directTailSize = nextRequestId > tailStart ? nextRequestId - tailStart : 0n;
    const boundedTailStart = indexed && directTailSize > maxDirectRandomnessRequestTail
      ? nextRequestId - maxDirectRandomnessRequestTail
      : tailStart;
    for (let id = boundedTailStart; id < nextRequestId; id += 1n) requestIds.add(id);

    const orderedRequestIds = [...requestIds].sort(
      (left, right) => left < right ? -1 : left > right ? 1 : 0
    );
    const requests: Array<{ id: bigint; request: EngineRequest }> = [];
    for (let offset = 0; offset < orderedRequestIds.length; offset += maxConcurrentRandomnessRequestReads) {
      const batch = orderedRequestIds.slice(offset, offset + maxConcurrentRandomnessRequestReads);
      requests.push(...await Promise.all(batch.map(async (id) => ({
        id,
        request: (await this.publicClient.readContract({
            abi: randomnessEngineAbi,
            address: this.engineAddress,
            functionName: "request",
            args: [id]
          })) as EngineRequest
      }))));
    }

    const pending: RandomnessRequestEvent[] = [];
    let oldestUnfulfilled = nextRequestId;
    for (const { id, request } of requests) {
      if (request.requester === zeroAddress || request.fulfilledAt !== 0n) {
        continue;
      }

      if (id < oldestUnfulfilled) {
        oldestUnfulfilled = id;
      }
      pending.push({
        requestId: id.toString(),
        requester: request.requester,
        purposeHash: request.purposeHash,
        createdAt: Number(request.createdAt),
        randomnessCommitment: request.randomnessCommitment
      });
    }

    if (indexed) this.historicalAuditCursorId = nextHistoricalAuditCursorId;
    if (!indexed) this.scanFloorId = oldestUnfulfilled;
    return pending;
  }

  private async confirm(hash: Hex): Promise<void> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`transaction ${hash} reverted`);
    }
  }
}

export type RandomnessCommitterSnapshot = {
  enabled: boolean;
  engineConfigured: boolean;
  fulfiller: string | null;
  intervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
  status: RandomnessCommitmentStatus | null;
};

export type RandomnessCommitterLogger = {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export type RandomnessCommitterOptions = {
  intervalMs?: number;
  chainClient?: RandomnessCommitmentChainClient;
  store?: RandomnessCommitmentStore;
  now?: () => Date;
  fulfillerAddress?: string;
  logger?: RandomnessCommitterLogger;
  transactionCoordinator?: ResolverTransactionCoordinator;
  candidateSource?: RandomnessRequestCandidateSource;
};

const consoleLogger: RandomnessCommitterLogger = {
  warn: (message) => console.warn(message),
  error: (message, error) => console.error(message, error)
};

const defaultCommitIntervalMs = 1_000;
const fullRandomnessRequestRescanIntervalMs = 5 * 60 * 1_000;
const historicalRandomnessRequestAuditBatchSize = 8;
const maxConcurrentRandomnessRequestReads = 8;
const maxDirectRandomnessRequestTail = 16n;

/**
 * Long-running service that keeps a burst inventory ready on-chain. The one-second interval is a
 * fallback/recovery cadence; normal attacks consume from the already-ready inventory.
 */
export class RandomnessCommitterService {
  private readonly enabled: boolean;
  private readonly worker: RandomnessCommitmentWorker | undefined;
  private readonly intervalMs: number;
  private readonly fulfillerAddress: string | null;
  private readonly logger: RandomnessCommitterLogger;
  private readonly readinessSnapshotEnabled: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastStatus: RandomnessCommitmentStatus | null = null;
  private activeAlerts = new Set<string>();
  private lastReadinessFingerprint: string | null = null;
  private lastReadinessWrittenAt = 0;

  constructor(
    private readonly config: BackendConfig,
    options: RandomnessCommitterOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? defaultCommitIntervalMs;
    this.logger = options.logger ?? consoleLogger;

    let chainClient = options.chainClient;
    let fulfillerAddress = options.fulfillerAddress ?? null;
    if (!chainClient) {
      const built = buildViemChainClient(
        config,
        options.transactionCoordinator,
        options.candidateSource
      );
      if (built) {
        chainClient = built;
        fulfillerAddress = built.fulfillerAddress;
      }
    }
    this.fulfillerAddress = fulfillerAddress;

    const store = options.store ?? (
      config.randomnessCommitmentStorePath.endsWith(".sqlite")
        ? new SqliteRandomnessCommitmentStore(
          config.randomnessCommitmentStorePath,
          config.randomnessCommitmentLegacyStorePath
        )
        : new FileRandomnessCommitmentStore(config.randomnessCommitmentStorePath)
    );
    // Unit/integration callers often inject an in-memory store and run in parallel. Only the
    // production-selected durable store is allowed to publish the cross-process readiness file.
    this.readinessSnapshotEnabled = options.store === undefined;
    this.worker = chainClient
      ? new RandomnessCommitmentWorker(
          chainClient,
          store,
          options.now ? { now: options.now } : {}
        )
      : undefined;
    this.enabled = Boolean(this.worker);
  }

  start(): void {
    if (!this.enabled || this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  snapshot(): RandomnessCommitterSnapshot {
    return {
      enabled: this.enabled,
      engineConfigured: Boolean(this.config.randomnessEngineAddress),
      fulfiller: this.fulfillerAddress,
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      status: this.lastStatus
    };
  }

  async tick(): Promise<void> {
    if (!this.enabled || this.inFlight || !this.worker) {
      return;
    }

    this.inFlight = true;
    this.lastRunAt = new Date().toISOString();
    try {
      const status = await this.worker.tick();
      this.lastStatus = status;
      if (this.readinessSnapshotEnabled) this.persistReadiness(status);
      const nextAlerts = new Set(status.alerts.map(randomnessAlertKey));
      for (const alert of status.alerts) {
        if (!this.activeAlerts.has(randomnessAlertKey(alert))) {
          this.logger.warn(`[randomness-committer] ${alert}`);
        }
      }
      this.activeAlerts = nextAlerts;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (this.readinessSnapshotEnabled) this.persistReadiness(null, this.lastError);
      this.logger.error("[randomness-committer] tick failed", error);
    } finally {
      this.inFlight = false;
    }
  }

  private persistReadiness(status: RandomnessCommitmentStatus | null, tickError?: string): void {
    const reasons = tickError
      ? ["The randomness safety check is unavailable. New attacks are temporarily paused."]
      : (status?.readinessReasons ?? []);
    const uniqueReasons = [...new Set(reasons)];
    const ready = uniqueReasons.length === 0;
    const fingerprint = JSON.stringify({ ready, reasons: uniqueReasons });
    const now = Date.now();
    // Readers fail closed if this snapshot becomes stale, so refresh it periodically without adding
    // a write on every one-second committer tick.
    if (fingerprint === this.lastReadinessFingerprint && now - this.lastReadinessWrittenAt < 15_000) return;
    saveRandomnessReadinessSnapshot(this.config.randomnessCommitmentStorePath, {
      ready,
      reasons: uniqueReasons,
      updatedAt: new Date(now).toISOString()
    });
    this.lastReadinessFingerprint = fingerprint;
    this.lastReadinessWrittenAt = now;
  }
}

function randomnessAlertKey(alert: string): string {
  // Age is intentionally dynamic, but must not turn one persistent missing-mapping condition into
  // a fresh alert every committer tick. Preserve all semantically meaningful alert changes.
  return alert.replace(/oldest randomness request has been pending for \d+s/, "oldest randomness request pending");
}

function buildViemChainClient(
  config: BackendConfig,
  transactionCoordinator?: ResolverTransactionCoordinator,
  candidateSource?: RandomnessRequestCandidateSource
): ViemRandomnessCommitmentChainClient | undefined {
  if (!config.randomnessEngineAddress || !config.randomnessFulfillerPrivateKey || !config.rpcUrl) {
    return undefined;
  }

  const chain = defineChain({
    id: config.chainId,
    name: `veydrift-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } }
  });
  const account = privateKeyToAccount(config.randomnessFulfillerPrivateKey);
  const transport = http(config.rpcUrl, { timeout: 10_000 });
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return new ViemRandomnessCommitmentChainClient(
    publicClient,
    walletClient,
    config.randomnessEngineAddress,
    account,
    chain,
    transactionCoordinator ?? new ResolverTransactionCoordinator(
      config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite"
    ),
    candidateSource
  );
}

export function createRandomnessCommitterService(
  config: BackendConfig,
  options: RandomnessCommitterOptions = {}
): RandomnessCommitterService {
  return new RandomnessCommitterService(config, options);
}
