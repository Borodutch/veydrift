import { randomBytes } from "node:crypto";

export type Address = string;

export type RandomnessRequestEvent = {
  requestId: string;
  requester: Address;
  purposeHash: string;
  createdAt: number;
  transactionHash?: string;
};

export type RandomnessFulfillmentRecord = RandomnessRequestEvent & {
  fulfilledAt: string;
  randomWord: string;
  transactionHash: string;
};

export type RandomnessFailureRecord = RandomnessRequestEvent & {
  failedAt: string;
  error: string;
};

export type RandomnessOperationalStatus = {
  pending: number;
  oldestPendingAgeSeconds: number | null;
  fulfilled: number;
  failed: number;
  lastFulfilledAt: string | null;
  alerts: string[];
};

export interface RandomnessChainClient {
  listPendingRequests(): Promise<RandomnessRequestEvent[]>;
  fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string>;
}

export type RandomnessWorkerOptions = {
  maxPendingAgeSeconds?: number;
  now?: () => Date;
  randomWord?: () => bigint;
};

const uint256Bytes = 32;
const defaultMaxPendingAgeSeconds = 5 * 60;

export class RandomnessFulfillmentWorker {
  private readonly failures: RandomnessFailureRecord[] = [];
  private readonly fulfilled: RandomnessFulfillmentRecord[] = [];

  constructor(
    private readonly chainClient: RandomnessChainClient,
    private readonly options: RandomnessWorkerOptions = {}
  ) {}

  async tick(): Promise<RandomnessOperationalStatus> {
    const pending = await this.chainClient.listPendingRequests();
    const stillPending: RandomnessRequestEvent[] = [];

    for (const request of pending) {
      try {
        const randomWord = this.randomWord();
        const txHash = await this.chainClient.fulfillRandomness(BigInt(request.requestId), randomWord);
        this.fulfilled.push({
          ...request,
          fulfilledAt: this.now().toISOString(),
          randomWord: randomWord.toString(),
          transactionHash: txHash
        });
      } catch (error) {
        stillPending.push(request);
        this.failures.push({
          ...request,
          failedAt: this.now().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return this.status(stillPending);
  }

  status(pendingRequests: RandomnessRequestEvent[] = []): RandomnessOperationalStatus {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const pendingAges = pendingRequests.map((request) => Math.max(nowSeconds - request.createdAt, 0));
    const oldestPendingAgeSeconds = pendingAges.length > 0 ? Math.max(...pendingAges) : null;
    const alerts: string[] = [];
    const maxPendingAgeSeconds = this.options.maxPendingAgeSeconds ?? defaultMaxPendingAgeSeconds;

    if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > maxPendingAgeSeconds) {
      alerts.push("oldest randomness request has been pending for " + oldestPendingAgeSeconds + "s");
    }
    if (this.failures.length > 0) {
      const lastFailure = this.failures[this.failures.length - 1]!;
      alerts.push("last randomness fulfillment failed for request " + lastFailure.requestId + ": " + lastFailure.error);
    }

    return {
      pending: pendingRequests.length,
      oldestPendingAgeSeconds,
      fulfilled: this.fulfilled.length,
      failed: this.failures.length,
      lastFulfilledAt: this.fulfilled[this.fulfilled.length - 1]?.fulfilledAt ?? null,
      alerts
    };
  }

  fulfillmentHistory(): RandomnessFulfillmentRecord[] {
    return [...this.fulfilled];
  }

  failureHistory(): RandomnessFailureRecord[] {
    return [...this.failures];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private randomWord(): bigint {
    return this.options.randomWord?.() ?? secureRandomUint256();
  }
}

export function secureRandomUint256(): bigint {
  const bytes = randomBytes(uint256Bytes);
  let hex = bytes.toString("hex");
  if (/^0+$/.test(hex)) {
    hex = "1" + hex.slice(1);
  }
  return BigInt("0x" + hex);
}
