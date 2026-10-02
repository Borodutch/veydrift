import { expect, test } from "bun:test";
import { createPublicClient, custom, type PublicClient } from "viem";
import { initialResolverFees, quoteResolverGas } from "./missionBatchFees";
import { resolverReplacementFees } from "./resolverReplacementFees";

const hash = "0x" + "a".repeat(64) as `0x${string}`;
const input = { chainId: 8453, dataBytes: 0, gas: 21_000n };

test("real viem rejects stale execution-fee source even if the next available oracle block is fresh", async () => {
  let blocks = 0, oracleReads = 0;
  const client = createPublicClient({ transport: custom({ async request({ method }) {
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash,
      timestamp: "0x" + (BigInt(Math.floor(Date.now() / 1000)) - (++blocks === 1 ? 3600n : 0n)).toString(16),
      baseFeePerGas: "0x64", gasLimit: "0x1c9c380", transactions: [] };
    if (method === "eth_maxPriorityFeePerGas") return "0xa";
    if (method === "eth_call") { oracleReads++; return "0x" + "0".repeat(64); }
    throw new Error("unexpected RPC " + method);
  } }, { retryCount: 0 }) });
  await expect(quoteResolverGas(client, input)).rejects.toThrow("expired");
  expect(blocks).toBe(1);
  expect(oracleReads).toBe(0);
});

for (const previousHash of [undefined, hash]) for (const delayedAt of ["tip", "previous", "oracle", "after-quote"] as const) {
  if (!previousHash && delayedAt === "previous") continue;
  test((previousHash ? "replacement/cancellation" : "initial") + " cannot outlive execution fee snapshot at " + delayedAt, async () => {
    const originalNow = Date.now;
    const start = Math.floor(originalNow() / 1000) * 1000;
    let clock = start, blocks = 0;
    Date.now = () => clock;
    const delay = (at: string) => { if (delayedAt === at) clock += 31_000; };
    const oracleBlocks: bigint[] = [];
    const client = {
      getBlock: async () => { blocks++; return { number: 7n, hash, timestamp: BigInt(start / 1000), baseFeePerGas: 100n }; },
      estimateMaxPriorityFeePerGas: async () => { delay("tip"); return 10n; },
      // No opaque, source-less network fee estimate may be substituted.
      estimateFeesPerGas: async () => { throw new Error("unproven execution-fee source used"); },
      getTransaction: async () => { delay("previous"); return { maxFeePerGas: 80n, maxPriorityFeePerGas: 8n }; },
      readContract: async ({ blockNumber }: { blockNumber: bigint }) => { oracleBlocks.push(blockNumber); delay("oracle"); return 0n; }
    } as unknown as PublicClient;
    try {
      const promise = quoteResolverGas(client, { ...input, ...(previousHash ? { previousHash } : {}) });
      if (delayedAt === "after-quote") {
        const quote = await promise;
        expect(quote.maxFeePerGas).toBe(210n);
        expect(oracleBlocks).toEqual([7n, 7n]);
        clock += 31_000;
        expect(quote.assertFresh).toThrow("expired");
      } else await expect(promise).rejects.toThrow("expired");
      expect(blocks).toBe(1);
    } finally { Date.now = originalNow; }
  });
}

test("missing or invalid execution fee inputs cannot acquire fresh reserve provenance", async () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const change of [{ baseFeePerGas: null }, { baseFeePerGas: undefined }, { baseFeePerGas: -1n },
    { number: undefined }, { hash: undefined }, { timestamp: undefined }]) {
    let reads = 0;
    const client = { getBlock: async () => ({ number: 1n, hash, timestamp: now, baseFeePerGas: 100n, ...change }),
      estimateMaxPriorityFeePerGas: async () => 10n, readContract: async () => { reads++; return 0n; }
    } as unknown as PublicClient;
    await expect(quoteResolverGas(client, input)).rejects.toThrow();
    expect(reads).toBe(0);
  }
  for (const tip of [undefined, -1n]) await expect(initialResolverFees({
    getBlock: async () => ({ number: 1n, hash, timestamp: now, baseFeePerGas: 100n }),
    estimateMaxPriorityFeePerGas: async () => tip
  } as unknown as PublicClient)).rejects.toThrow("invalid");
  for (const current of [{}, { maxFeePerGas: 100n }, { maxFeePerGas: -1n, maxPriorityFeePerGas: 1n },
    { maxFeePerGas: 100n, maxPriorityFeePerGas: 101n }]) await expect(resolverReplacementFees({
      getTransaction: async () => ({ maxFeePerGas: 80n, maxPriorityFeePerGas: 8n }),
      estimateFeesPerGas: async () => current
    } as unknown as PublicClient, hash)).rejects.toThrow("replacement fee inputs");
});
