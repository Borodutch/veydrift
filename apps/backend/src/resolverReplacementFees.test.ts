import { describe, expect, test } from "bun:test";
import type { PublicClient } from "viem";

import { resolverReplacementFees, resolverTransactionNeedsReplacement } from "./resolverReplacementFees";

describe("resolverReplacementFees", () => {
  test("beats both the prior transaction and the current network estimate", async () => {
    const publicClient = {
      getTransaction: async () => ({
        gasPrice: null,
        maxFeePerGas: 80n,
        maxPriorityFeePerGas: 8n
      }),
      estimateFeesPerGas: async () => ({
        maxFeePerGas: 60n,
        maxPriorityFeePerGas: 12n
      })
    } as unknown as PublicClient;

    await expect(resolverReplacementFees(publicClient, `0x${"1".repeat(64)}`)).resolves.toEqual({
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 12n
    });
  });

  test("raises an underpriced transaction to the current Base fee estimate", async () => {
    const publicClient = {
      getTransaction: async () => ({
        gasPrice: null,
        maxFeePerGas: 7n,
        maxPriorityFeePerGas: 1n
      }),
      estimateFeesPerGas: async () => ({
        maxFeePerGas: 60n,
        maxPriorityFeePerGas: 2n
      })
    } as unknown as PublicClient;

    await expect(resolverReplacementFees(publicClient, `0x${"2".repeat(64)}`)).resolves.toEqual({
      maxFeePerGas: 60n,
      maxPriorityFeePerGas: 2n
    });
  });

  test("recognizes a transaction whose fee cap fell below the pending Base fee", async () => {
    const publicClient = {
      getTransaction: async () => ({ gasPrice: null, maxFeePerGas: 59n }),
      getBlock: async () => ({ baseFeePerGas: 60n })
    } as unknown as PublicClient;

    await expect(resolverTransactionNeedsReplacement(
      publicClient,
      `0x${"3".repeat(64)}`
    )).resolves.toBe(true);
  });

  test("leaves a currently mineable pending transaction on its confirmation path", async () => {
    const publicClient = {
      getTransaction: async () => ({ gasPrice: null, maxFeePerGas: 61n }),
      getBlock: async () => ({ baseFeePerGas: 60n })
    } as unknown as PublicClient;

    await expect(resolverTransactionNeedsReplacement(
      publicClient,
      `0x${"4".repeat(64)}`
    )).resolves.toBe(false);
  });
});
