import { describe, expect, test } from "bun:test";

import { Oracle, secureRandomUint256, type RandomnessChain, type RequestState } from "./oracle";

class FakeChain implements RandomnessChain {
  next: bigint;
  // requestId -> fulfilled?
  readonly fulfilled = new Map<bigint, boolean>();
  readonly missing = new Set<bigint>();
  fulfillCalls: Array<{ id: bigint; word: bigint }> = [];
  failOn = new Set<bigint>();

  constructor(next: bigint) {
    this.next = next;
  }

  async nextRequestId(): Promise<bigint> {
    return this.next;
  }

  async getRequest(requestId: bigint): Promise<RequestState> {
    if (this.missing.has(requestId)) {
      return { exists: false, fulfilled: false, createdAt: 0 };
    }
    return { exists: true, fulfilled: this.fulfilled.get(requestId) ?? false, createdAt: 0 };
  }

  async fulfill(requestId: bigint, randomWord: bigint): Promise<string> {
    this.fulfillCalls.push({ id: requestId, word: randomWord });
    if (this.failOn.has(requestId)) throw new Error(`boom ${requestId}`);
    this.fulfilled.set(requestId, true);
    return `0xhash${requestId}`;
  }
}

describe("Oracle", () => {
  test("fulfills all unfulfilled requests in a tick", async () => {
    const chain = new FakeChain(4n); // requests 1,2,3
    const oracle = new Oracle(chain, { randomWord: () => 7n });

    const status = await oracle.tick();

    expect(chain.fulfillCalls.map((c) => c.id)).toEqual([1n, 2n, 3n]);
    expect(status.fulfilledTotal).toBe(3);
    expect(status.pending).toBe(0);
  });

  test("skips already-fulfilled and advances the cursor", async () => {
    const chain = new FakeChain(4n);
    chain.fulfilled.set(1n, true);
    chain.fulfilled.set(2n, true);
    const oracle = new Oracle(chain, { randomWord: () => 7n });

    const status = await oracle.tick();

    expect(chain.fulfillCalls.map((c) => c.id)).toEqual([3n]);
    // cursor advanced past the contiguous fulfilled prefix (1,2,3 all fulfilled now)
    expect(status.cursor).toBe("4");
  });

  test("is idempotent across ticks and never re-fulfills", async () => {
    const chain = new FakeChain(3n); // 1,2
    const oracle = new Oracle(chain, { randomWord: () => 7n });
    await oracle.tick();
    chain.next = 5n; // 3,4 appear later
    const status = await oracle.tick();

    expect(chain.fulfillCalls.map((c) => c.id)).toEqual([1n, 2n, 3n, 4n]);
    expect(status.fulfilledTotal).toBe(4);
  });

  test("a failed fulfillment is retried next tick and does not advance cursor past it", async () => {
    const chain = new FakeChain(3n); // 1,2
    chain.failOn.add(1n);
    const oracle = new Oracle(chain, { randomWord: () => 7n });

    let status = await oracle.tick();
    expect(status.failedTotal).toBe(1);
    expect(status.cursor).toBe("1"); // stuck at the failing request
    expect(status.pending).toBe(1);

    chain.failOn.delete(1n);
    status = await oracle.tick();
    expect(status.cursor).toBe("3");
    expect(status.pending).toBe(0);
  });

  test("respects the per-tick cap", async () => {
    const chain = new FakeChain(11n); // 1..10
    const oracle = new Oracle(chain, { randomWord: () => 7n, maxFulfillmentsPerTick: 3 });

    const status = await oracle.tick();
    expect(chain.fulfillCalls.length).toBe(3);
    expect(status.pending).toBe(7);
  });

  test("tolerates missing request ids (gaps)", async () => {
    const chain = new FakeChain(4n);
    chain.missing.add(2n);
    const oracle = new Oracle(chain, { randomWord: () => 7n });

    const status = await oracle.tick();
    expect(chain.fulfillCalls.map((c) => c.id)).toEqual([1n, 3n]);
    expect(status.fulfilledTotal).toBe(2);
  });

  test("secureRandomUint256 is non-zero", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(secureRandomUint256()).toBeGreaterThan(0n);
    }
  });
});
