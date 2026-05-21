import { describe, expect, test } from "bun:test";
import {
  RandomnessFulfillmentWorker,
  secureRandomUint256,
  type RandomnessChainClient,
  type RandomnessRequestEvent
} from "./randomness";

const request: RandomnessRequestEvent = {
  requestId: "42",
  requester: "0x1111111111111111111111111111111111111111",
  purposeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  createdAt: 1000
};

describe("Randomness fulfillment worker", () => {
  test("fulfills pending requests with secure uint256 words", async () => {
    const fulfilled: Array<{ requestId: bigint; randomWord: bigint }> = [];
    const client: RandomnessChainClient = {
      async listPendingRequests() {
        return [request];
      },
      async fulfillRandomness(requestId, randomWord) {
        fulfilled.push({ requestId, randomWord });
        return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      }
    };
    const worker = new RandomnessFulfillmentWorker(client, {
      now: () => new Date(1_060_000),
      randomWord: () => 777n
    });

    const status = await worker.tick();

    expect(fulfilled).toEqual([{ requestId: 42n, randomWord: 777n }]);
    expect(status.pending).toBe(0);
    expect(status.fulfilled).toBe(1);
    expect(status.failed).toBe(0);
    expect(status.alerts).toEqual([]);
    expect(worker.fulfillmentHistory()[0]?.randomWord).toBe("777");
  });

  test("records failures and pending-age alerts without inventing fallback randomness", async () => {
    const client: RandomnessChainClient = {
      async listPendingRequests() {
        return [request];
      },
      async fulfillRandomness() {
        throw new Error("oracle wallet has no gas");
      }
    };
    const worker = new RandomnessFulfillmentWorker(client, {
      maxPendingAgeSeconds: 30,
      now: () => new Date(1_060_000),
      randomWord: () => 888n
    });

    const status = await worker.tick();

    expect(status.fulfilled).toBe(0);
    expect(status.failed).toBe(1);
    expect(status.pending).toBe(1);
    expect(status.oldestPendingAgeSeconds).toBe(60);
    expect(status.alerts).toEqual([
      "oldest randomness request has been pending for 60s",
      "last randomness fulfillment failed for request 42: oracle wallet has no gas"
    ]);
  });

  test("secureRandomUint256 returns a non-zero uint256", () => {
    const word = secureRandomUint256();
    expect(word).toBeGreaterThan(0n);
    expect(word).toBeLessThan(1n << 256n);
  });
});
