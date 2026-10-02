import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient, WalletClient } from "viem";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const account = privateKeyToAccount("0x" + "1".repeat(64) as `0x${string}`);
const game = "0x3333333333333333333333333333333333333333" as const;
const moon = "0x4444444444444444444444444444444444444444" as const;
const engine = "0x5555555555555555555555555555555555555555" as const;
const first = "0x" + "a".repeat(64) as `0x${string}`;
const second = "0x" + "b".repeat(64) as `0x${string}`;
for (const mode of ["private-key", "unlocked"] as const) for (const leg of ["arrival", "return", "moon"] as const) {
  test(mode + " " + leg + " initial/replacement preserve liveness inside the fixed ETH quote without USD", async () => {
    let pending = 7;
    const writes: Array<{ nonce: number; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> = [];
    const calls: Array<Record<string, unknown>> = [];
    const send = (tx: typeof writes[number]) => { writes.push(tx); pending = 8; return writes.length === 1 ? first : second; };
    const publicClient = {
      call: async (tx: Record<string, unknown>) => { calls.push(tx); return { data: "0x" }; },
      getStorageAt: async () => "0x00",
      getTransactionCount: async ({ blockTag }: { blockTag: string }) => blockTag === "latest" ? 7 : pending,
      getBlock: async () => ({ number: 1n, hash: first, timestamp: BigInt(Math.floor(Date.now() / 1000)), baseFeePerGas: 49_999_995n }),
      getTransaction: async () => ({ maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10n }),
      estimateFeesPerGas: async () => ({ maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10n }),
      estimateMaxPriorityFeePerGas: async () => 10n,
      estimateGas: async () => 5_000_000n,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "getL1FeeUpperBound") return 1000n;
        if (functionName === "getOperatorFee") return 100n;
        if (functionName === "moonChanceRandomness") return [1n, first, false];
        if (functionName === "request") return { requester: moon, purposeHash: first, createdAt: 1n, fulfilledAt: 2n };
        throw new Error("unexpected read including unavailable USD oracle: " + functionName);
      },
      waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
        if (hash === first) throw new Error("receipt unknown");
        return { status: "success" };
      }
    };
    const make = () => new ViemMissionResolutionChainClient({ listResolvableFleetMissions: async () => [],
      listReturnableFleetMissions: async () => [], isFleetChronologyOrderingReady: async () => true },
    game, mode === "private-key" ? account : account.address, publicClient as unknown as PublicClient,
    { writeContract: async (tx: typeof writes[number]) => send(tx) } as unknown as WalletClient,
    { id: 8453 } as never, "https://inert.invalid", coordinator, moon, engine);
    const coordinator = new ResolverTransactionCoordinator(":memory:", { staleTransactionMs: 0 });
    const submit = () => leg === "arrival" ? make().resolveFleetMission("88") : leg === "return"
      ? make().completeFleetMissionReturn("88") : make().finalizeMoonChance("88");
    const originalFetch = globalThis.fetch;
    if (mode === "unlocked") globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const tx = JSON.parse(String(init?.body)).params[0];
      return new Response(JSON.stringify({ result: send({ nonce: Number(BigInt(tx.nonce)), gas: BigInt(tx.gas),
        maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) }) }));
    }) as unknown as typeof fetch;
    try {
      await expect(submit()).rejects.toThrow("receipt unknown");
      await expect(submit()).resolves.toBe(leg === "moon" ? "finalized" : second);
      expect(writes).toHaveLength(2);
      expect(calls).toHaveLength(2);
      for (const [i, tx] of writes.entries()) {
        expect(tx.nonce).toBe(7);
        expect(tx.maxFeePerGas).toBe(i === 0 ? 100_000_000n : 125_000_000n);
        expect(tx.gas).toBe((200_000_000_000_000n - 2200n) / tx.maxFeePerGas);
        expect(tx.gas * tx.maxFeePerGas + 2200n).toBeLessThanOrEqual(200_000_000_000_000n);
        expect(calls[i]).toMatchObject({ nonce: tx.nonce, gas: tx.gas, maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas, value: 0n, to: leg === "moon" ? moon : game });
      }
    } finally { globalThis.fetch = originalFetch; }
  });
}
