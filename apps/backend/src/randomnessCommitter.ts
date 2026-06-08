import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import {
  FileRandomnessCommitmentStore,
  RandomnessCommitmentWorker,
  type RandomnessCommitmentChainClient,
  type RandomnessCommitmentStatus,
  type RandomnessCommitmentStore,
  type RandomnessPendingCommitment,
  type RandomnessRequestEvent
} from "./randomness";

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
    name: "pendingCommitment",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }]
  },
  {
    type: "function",
    name: "pendingCommitmentBlock",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }]
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
    name: "commitRandomness",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32", name: "commitment" }],
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

  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly engineAddress: `0x${string}`,
    private readonly account: ReturnType<typeof privateKeyToAccount>,
    private readonly chain: ReturnType<typeof defineChain>
  ) {}

  get fulfillerAddress(): `0x${string}` {
    return this.account.address;
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.publicClient.getBlockNumber());
  }

  async getPendingCommitment(): Promise<RandomnessPendingCommitment> {
    const [commitment, committedAtBlock] = await Promise.all([
      this.publicClient.readContract({
        abi: randomnessEngineAbi,
        address: this.engineAddress,
        functionName: "pendingCommitment"
      }) as Promise<Hex>,
      this.publicClient.readContract({
        abi: randomnessEngineAbi,
        address: this.engineAddress,
        functionName: "pendingCommitmentBlock"
      }) as Promise<bigint>
    ]);

    return { commitment, committedAtBlock: Number(committedAtBlock) };
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

  async commitRandomness(commitment: string): Promise<string> {
    const hash = await this.walletClient.writeContract({
      abi: randomnessEngineAbi,
      account: this.account,
      address: this.engineAddress,
      chain: this.chain,
      functionName: "commitRandomness",
      args: [commitment as Hex]
    });
    await this.confirm(hash);
    return hash;
  }

  async fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string> {
    const hash = await this.walletClient.writeContract({
      abi: randomnessEngineAbi,
      account: this.account,
      address: this.engineAddress,
      chain: this.chain,
      functionName: "fulfillRandomness",
      args: [requestId, randomWord]
    });
    await this.confirm(hash);
    return hash;
  }

  async listPendingRequests(): Promise<RandomnessRequestEvent[]> {
    const nextRequestId = (await this.publicClient.readContract({
      abi: randomnessEngineAbi,
      address: this.engineAddress,
      functionName: "nextRequestId"
    })) as bigint;

    const pending: RandomnessRequestEvent[] = [];
    let oldestUnfulfilled = nextRequestId;

    for (let id = this.scanFloorId; id < nextRequestId; id += 1n) {
      const request = (await this.publicClient.readContract({
        abi: randomnessEngineAbi,
        address: this.engineAddress,
        functionName: "request",
        args: [id]
      })) as EngineRequest;

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

    // Advance the scan floor to the oldest still-unfulfilled id so future ticks don't re-read the
    // ever-growing prefix of already-revealed requests.
    this.scanFloorId = oldestUnfulfilled;
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
};

const consoleLogger: RandomnessCommitterLogger = {
  warn: (message) => console.warn(message),
  error: (message, error) => console.error(message, error)
};

const defaultCommitIntervalMs = 15_000;

/**
 * Long-running service that drives {@link RandomnessCommitmentWorker} on an interval so a pending
 * commitment is essentially always available on-chain (otherwise attacks/combat revert with
 * NoRandomnessCommitment). Mirrors the start/stop/snapshot shape of the other backend services.
 */
export class RandomnessCommitterService {
  private readonly enabled: boolean;
  private readonly worker: RandomnessCommitmentWorker | undefined;
  private readonly intervalMs: number;
  private readonly fulfillerAddress: string | null;
  private readonly logger: RandomnessCommitterLogger;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastStatus: RandomnessCommitmentStatus | null = null;

  constructor(
    private readonly config: BackendConfig,
    options: RandomnessCommitterOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? defaultCommitIntervalMs;
    this.logger = options.logger ?? consoleLogger;

    let chainClient = options.chainClient;
    let fulfillerAddress = options.fulfillerAddress ?? null;
    if (!chainClient) {
      const built = buildViemChainClient(config);
      if (built) {
        chainClient = built;
        fulfillerAddress = built.fulfillerAddress;
      }
    }
    this.fulfillerAddress = fulfillerAddress;

    const store =
      options.store ?? new FileRandomnessCommitmentStore(config.randomnessCommitmentStorePath);
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
      for (const alert of status.alerts) {
        this.logger.warn(`[randomness-committer] ${alert}`);
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("[randomness-committer] tick failed", error);
    } finally {
      this.inFlight = false;
    }
  }
}

function buildViemChainClient(
  config: BackendConfig
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
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return new ViemRandomnessCommitmentChainClient(
    publicClient,
    walletClient,
    config.randomnessEngineAddress,
    account,
    chain
  );
}

export function createRandomnessCommitterService(
  config: BackendConfig,
  options: RandomnessCommitterOptions = {}
): RandomnessCommitterService {
  return new RandomnessCommitterService(config, options);
}
