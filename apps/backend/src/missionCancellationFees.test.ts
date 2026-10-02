import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, custom, type PublicClient, type WalletClient } from "viem";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { ViemRandomnessCommitmentChainClient } from "./randomnessCommitter";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const game = "0x3333333333333333333333333333333333333333" as const;
const oldHash = `0x${"a".repeat(64)}` as const;
const cancelHash = `0x${"b".repeat(64)}` as const;
const nextHash = `0x${"c".repeat(64)}` as const;

for (const failure of ["fee-spike", "replacement-escalation", "missing-price", "stale-price", "future-price", "zero-price", "l1", "operator", "missing-l1", "missing-operator", "preflight", "quote-expiry", "lost-lease"] as const) {
  test(`stale cancellation ${failure} sends nothing and retains nonce ownership across restart`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-cancel-cap-"));
    const path = join(dir, "journal.sqlite");
    let latest = 7, pending = 7;
    const counts = async (tag: "latest" | "pending") => tag === "latest" ? latest : pending;
    const coordinator = new ResolverTransactionCoordinator(path, { staleTransactionMs: 0 });
    await expect(coordinator.submit({ chainId: 8453, address: account.address, operationId: "old-operation",
      getTransactionCount: counts, submit: async () => { pending = 8; return oldHash; },
      confirm: async () => { throw new Error("receipt unknown"); }
    })).rejects.toThrow("receipt unknown");
    const db = new Database(path);
    const original = db.query("SELECT * FROM resolver_transaction_attempts").all();
    let blocked = true;
    const originalNow = Date.now;
    let clock = originalNow();
    Date.now = () => clock;
    const calls: Array<Record<string, unknown>> = [];
    const sends: Array<Record<string, unknown>> = [];
    const contractWrites: Array<Record<string, unknown>> = [];
    const rpc = createPublicClient({ transport: custom({ async request({ method, params }) {
      expect(method).toBe("eth_call");
      const call = (params as unknown[])[0] as Record<string, unknown>;
      calls.push(call);
      if (call.to === account.address && blocked) {
        if (failure === "preflight") throw new Error("cancellation simulation failed");
        if (failure === "quote-expiry") clock += 31_000;
        if (failure === "lost-lease") db.query("UPDATE resolver_transaction_leases SET holder = 'successor'").run();
      }
      return "0x";
    } }, { retryCount: 0 }) });
    const publicClient = {
      call: rpc.call,
      getStorageAt: async () => "0x00",
      getTransactionCount: async ({ blockTag }: { blockTag: "latest" | "pending" }) => counts(blockTag),
      getTransaction: async () => ({ maxFeePerGas: blocked && failure === "replacement-escalation" ? 10n ** 12n : 80n, maxPriorityFeePerGas: 8n }),
      getBlock: async () => ({ baseFeePerGas: 1n }),
      estimateFeesPerGas: async () => ({ maxFeePerGas: blocked && failure === "fee-spike" ? 10n ** 12n : 90n, maxPriorityFeePerGas: 12n }),
      estimateMaxPriorityFeePerGas: async () => 1n,
      estimateGas: async () => 100_000n,
      readContract: async ({ functionName }: { functionName: string }) => {
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (functionName === "decimals") return 8;
        if (functionName === "latestRoundData") {
          if (blocked && failure === "missing-price") throw new Error("missing price");
          const updated = blocked && failure === "stale-price" ? now - 7200n : blocked && failure === "future-price" ? now + 600n : now;
          return [1n, blocked && failure === "zero-price" ? 0n : 3000_00000000n, updated, updated, 1n];
        }
        if (functionName === "getL1FeeUpperBound") {
          if (blocked && failure === "missing-l1") throw new Error("missing L1 oracle");
          return blocked && failure === "l1" ? 10n ** 15n : 1_000_000_000n;
        }
        if (functionName === "getOperatorFee") {
          if (blocked && failure === "missing-operator") throw new Error("missing operator oracle");
          return blocked && failure === "operator" ? 10n ** 15n : 2_000_000_000n;
        }
        throw new Error("unexpected oracle");
      },
      waitForTransactionReceipt: async () => { latest = ++pending; pending = latest; return { status: "success" }; }
    };
    // These adapters record envelopes only; no account signing or network send is invoked.
    const walletClient = {
      sendTransaction: async (tx: Record<string, unknown>) => { sends.push(tx); pending = 7; return cancelHash; },
      writeContract: async (tx: Record<string, unknown>) => { contractWrites.push(tx); return nextHash; }
    };
    const makeClient = () => new ViemMissionResolutionChainClient({
      listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
      isFleetChronologyOrderingReady: async () => true
    }, game, account, publicClient as unknown as PublicClient, walletClient as unknown as WalletClient,
    { id: 8453 } as never, undefined, new ResolverTransactionCoordinator(path, { staleTransactionMs: 0 }));
    try {
      await expect(makeClient().resolveFleetMission("88")).rejects.toThrow();
      expect(sends).toHaveLength(0);
      expect(contractWrites).toHaveLength(0);
      expect(db.query("SELECT * FROM resolver_transaction_attempts").all()).toEqual(original);
      expect([latest, pending]).toEqual([7, 8]);
      // A sibling sharing this EOA must not bypass the rejected mission cancellation.
      for (const operation of ["commit", "fulfill"] as const) {
        if (failure === "lost-lease") db.query("DELETE FROM resolver_transaction_leases").run();
        const sibling = new ViemRandomnessCommitmentChainClient(publicClient as unknown as PublicClient,
          walletClient as unknown as WalletClient, game, account, { id: 8453 } as never,
          new ResolverTransactionCoordinator(path, { staleTransactionMs: 0 }));
        await expect(operation === "commit" ? sibling.commitRandomnessBatch([oldHash])
          : sibling.fulfillRandomness(99n, 42n)).rejects.toThrow();
        expect(sends).toHaveLength(0);
        expect(contractWrites).toHaveLength(0);
        expect(db.query("SELECT * FROM resolver_transaction_attempts").all()).toEqual(original);
      }
      // Restart and retry must still address the original stale nonce, never allocate nonce 8.
      if (failure === "lost-lease") db.query("DELETE FROM resolver_transaction_leases").run();
      blocked = false;
      await expect(makeClient().resolveFleetMission("88")).resolves.toBe(nextHash);
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({ to: account.address, data: "0x", value: 0n, gas: 21_000n,
        nonce: 7, maxFeePerGas: 100n, maxPriorityFeePerGas: 12n });
      const cancellationCall = calls.filter((call) => call.to === account.address).at(-1);
      expect(cancellationCall).toEqual({ from: account.address, to: account.address, data: "0x", value: "0x0",
        nonce: "0x7", gas: "0x5208", maxFeePerGas: "0x64", maxPriorityFeePerGas: "0xc" });
      expect(contractWrites[0]?.nonce).toBe(8);
      expect(db.query("SELECT nonce, status, transaction_hash FROM resolver_transaction_attempts WHERE operation_id = 'old-operation'").get())
        .toEqual({ nonce: 7, status: "cancelled", transaction_hash: cancelHash });
      const quotedWei = 21_000n * 100n + 2n * (1_000_000_000n + 2_000_000_000n);
      expect(quotedWei * 3000n * 1_000_000n).toBeLessThanOrEqual(500_000n * 10n ** 18n);
    } finally { Date.now = originalNow; db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}
