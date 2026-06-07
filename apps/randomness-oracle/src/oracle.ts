import { randomBytes } from "node:crypto";

// A single randomness request as the oracle needs to see it.
export type RequestState = {
  exists: boolean;
  fulfilled: boolean;
  createdAt: number;
};

// Minimal chain surface the oracle depends on. Implemented by the viem-backed
// EngineClient in production and by fakes in tests.
export interface RandomnessChain {
  nextRequestId(): Promise<bigint>;
  getRequest(requestId: bigint): Promise<RequestState>;
  // Returns the transaction hash. Implementations MUST treat an
  // already-fulfilled request as success (idempotent), not an error.
  fulfill(requestId: bigint, randomWord: bigint): Promise<string>;
}

export type OracleStatus = {
  cursor: string;
  nextRequestId: string;
  pending: number;
  fulfilledTotal: number;
  failedTotal: number;
  lastFulfilledId: string | null;
  lastFulfilledAt: string | null;
  lastError: string | null;
  lastTickAt: string | null;
};

export type OracleOptions = {
  startRequestId?: bigint;
  maxFulfillmentsPerTick?: number;
  randomWord?: () => bigint;
  now?: () => Date;
};

const UINT256_BYTES = 32;

// Cryptographically secure, non-zero uint256 (the engine rejects a zero word).
export function secureRandomUint256(): bigint {
  let hex = randomBytes(UINT256_BYTES).toString("hex");
  if (/^0+$/.test(hex)) hex = `1${hex.slice(1)}`;
  return BigInt(`0x${hex}`);
}

export class Oracle {
  private cursor: bigint;
  private readonly maxPerTick: number;
  private readonly randomWord: () => bigint;
  private readonly now: () => Date;

  private fulfilledTotal = 0;
  private failedTotal = 0;
  private lastFulfilledId: bigint | null = null;
  private lastFulfilledAt: Date | null = null;
  private lastError: string | null = null;
  private lastTickAt: Date | null = null;
  private lastNextRequestId = 0n;
  private lastPending = 0;

  constructor(
    private readonly chain: RandomnessChain,
    options: OracleOptions = {}
  ) {
    this.cursor = options.startRequestId ?? 1n;
    if (this.cursor < 1n) this.cursor = 1n;
    this.maxPerTick = options.maxFulfillmentsPerTick ?? 25;
    this.randomWord = options.randomWord ?? secureRandomUint256;
    this.now = options.now ?? (() => new Date());
  }

  // One pass: advance the cursor past the contiguous fulfilled prefix, then
  // fulfill any unfulfilled requests up to the per-tick cap. Stateless beyond
  // the cursor, which is a pure optimization (it only ever skips fulfilled ids).
  async tick(): Promise<OracleStatus> {
    this.lastTickAt = this.now();
    const next = await this.chain.nextRequestId();
    this.lastNextRequestId = next;

    // Skip the contiguous fulfilled/missing prefix so we never rescan it.
    await this.advanceCursor(next);

    let pending = 0;
    let fulfilledThisTick = 0;
    for (let id = this.cursor; id < next; id += 1n) {
      const state = await this.chain.getRequest(id);
      if (!state.exists || state.fulfilled) continue;
      if (fulfilledThisTick >= this.maxPerTick) {
        pending += 1;
        continue;
      }
      try {
        await this.chain.fulfill(id, this.randomWord());
        this.fulfilledTotal += 1;
        this.lastFulfilledId = id;
        this.lastFulfilledAt = this.now();
        this.lastError = null;
        fulfilledThisTick += 1;
      } catch (error) {
        this.failedTotal += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        pending += 1;
      }
    }

    // Re-advance past anything we just fulfilled so the cursor is tight.
    await this.advanceCursor(next);
    this.lastPending = pending;
    return this.status();
  }

  // Move the cursor forward over the leading run of fulfilled/missing requests.
  private async advanceCursor(next: bigint): Promise<void> {
    while (this.cursor < next) {
      const state = await this.chain.getRequest(this.cursor);
      if (state.exists && !state.fulfilled) break;
      this.cursor += 1n;
    }
  }

  status(): OracleStatus {
    return {
      cursor: this.cursor.toString(),
      nextRequestId: this.lastNextRequestId.toString(),
      pending: this.lastPending,
      fulfilledTotal: this.fulfilledTotal,
      failedTotal: this.failedTotal,
      lastFulfilledId: this.lastFulfilledId?.toString() ?? null,
      lastFulfilledAt: this.lastFulfilledAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastTickAt: this.lastTickAt?.toISOString() ?? null
    };
  }
}
