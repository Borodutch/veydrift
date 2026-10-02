import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient, WalletClient } from "viem";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const account = privateKeyToAccount("0x" + "1".repeat(64) as `0x${string}`);
const game = "0x3333333333333333333333333333333333333333" as const;
const oldHash = "0x" + "a".repeat(64) as `0x${string}`;
const newHash = "0x" + "b".repeat(64) as `0x${string}`;
const successorHash = "0x" + "c".repeat(64);
for (const mode of ["private-key", "unlocked"] as const) {
  for (const operation of ["submit", "replacement"] as const) {
    for (const lostAt of ["preflight", "send", "confirmation"] as const) {
      test(mode + " " + operation + " lease loss at " + lostAt + " cannot send late or overwrite successor", async () => {
        const dir = mkdtempSync(join(tmpdir(), "vey-single-lease-"));
        const path = join(dir, "journal.sqlite");
        const coordinator = new ResolverTransactionCoordinator(path, { staleTransactionMs: 0 });
        let pending = 7;
        const counts = async (tag: "latest" | "pending") => tag === "latest" ? 7 : pending;
        if (operation === "replacement") await expect(coordinator.submit({ chainId: 8453, address: account.address,
          operationId: "mission:resolveFleetMission:88", getTransactionCount: counts,
          submit: async () => { pending = 8; return oldHash; },
          confirm: async () => { throw new Error("unknown receipt"); }
        })).rejects.toThrow("unknown receipt");
        const db = new Database(path);
        let snapshot: unknown[] = [];
        let audit: unknown[] = [];
        const loseLease = () => {
          db.query("UPDATE resolver_transaction_leases SET holder = 'successor'").run();
          db.query("UPDATE resolver_transaction_attempts SET nonce = 55, transaction_hash = ?, status = 'submitted'").run(successorHash);
          snapshot = db.query("SELECT * FROM resolver_transaction_attempts").all();
          audit = db.query("SELECT * FROM resolver_transaction_audit").all();
        };
        let sends = 0;
        const broadcast = () => { sends++; if (lostAt === "send") loseLease(); return newHash; };
        const publicClient = {
          call: async () => { if (lostAt === "preflight") loseLease(); return { data: "0x" }; },
          getStorageAt: async () => "0x00", getTransactionCount: async ({ blockTag }: { blockTag: "latest" | "pending" }) => counts(blockTag),
          getTransaction: async () => ({ maxFeePerGas: 80n, maxPriorityFeePerGas: 8n }),
          getBlock: async () => ({ baseFeePerGas: 1n }), estimateMaxPriorityFeePerGas: async () => 1n,
          estimateFeesPerGas: async () => ({ maxFeePerGas: 90n, maxPriorityFeePerGas: 12n }),
          readContract: async ({ functionName }: { functionName: string }) => {
            const now = BigInt(Math.floor(Date.now() / 1000));
            return functionName === "decimals" ? 8 : functionName === "latestRoundData"
              ? [1n, 3000_00000000n, now, now, 1n] : 0n;
          },
          waitForTransactionReceipt: async () => { if (lostAt === "confirmation") loseLease(); return { status: "success" }; }
        };
        const client = new ViemMissionResolutionChainClient({ listResolvableFleetMissions: async () => [],
          listReturnableFleetMissions: async () => [], isFleetChronologyOrderingReady: async () => true
        }, game, mode === "private-key" ? account : account.address, publicClient as unknown as PublicClient,
        { writeContract: async () => broadcast() } as unknown as WalletClient, { id: 8453 } as never,
        "https://example.invalid/rpc", coordinator);
        const originalFetch = globalThis.fetch;
        if (mode === "unlocked") globalThis.fetch = (async () => new Response(JSON.stringify({ result: broadcast() }))) as unknown as typeof fetch;
        try {
          await expect(client.resolveFleetMission("88")).rejects.toThrow("lease was lost");
          expect(sends).toBe(lostAt === "preflight" ? 0 : 1);
          expect(snapshot).toBeDefined();
          expect(db.query("SELECT * FROM resolver_transaction_attempts").all()).toEqual(snapshot);
          expect(db.query("SELECT * FROM resolver_transaction_audit").all()).toEqual(audit);
          expect(db.query("SELECT holder FROM resolver_transaction_leases").get()).toEqual({ holder: "successor" });
        } finally { globalThis.fetch = originalFetch; db.close(); rmSync(dir, { recursive: true, force: true }); }
      });
    }
  }
}
