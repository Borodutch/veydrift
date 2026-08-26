import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ResolverNonceStalledError,
  ResolverSubmissionAmbiguousError,
  ResolverTransactionCoordinator
} from "./resolverTransactions";

const address = "0x1111111111111111111111111111111111111111" as const;
const chainId = 8453;

describe("ResolverTransactionCoordinator", () => {
  test("serializes concurrent mission/randomness writers through one nonce stream", async () => {
    await withDatabase(async (databasePath) => {
      const coordinator = new ResolverTransactionCoordinator(databasePath);
      let latest = 40;
      let pending = 40;
      let active = 0;
      let peak = 0;
      const nonces: number[] = [];
      const request = (operationId: string) => coordinator.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async (blockTag) => blockTag === "pending" ? pending : latest,
        submit: async (nonce) => {
          active += 1;
          peak = Math.max(peak, active);
          nonces.push(nonce);
          pending = nonce + 1;
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return hash(nonce);
        },
        confirm: async () => { latest = pending; }
      });

      await Promise.all([
        request("mission:resolve:1"),
        request("randomness:fulfill:8"),
        request("mission:return:2")
      ]);

      expect(nonces).toEqual([40, 41, 42]);
      expect(peak).toBe(1);
    });
  });

  test("keeps rolling backend processes mutually exclusive until confirmation", async () => {
    await withDatabase(async (databasePath) => {
      const first = new ResolverTransactionCoordinator(databasePath);
      const second = new ResolverTransactionCoordinator(databasePath);
      let latest = 9;
      let pending = 9;
      let releaseConfirmation = () => {};
      let markSubmitted = () => {};
      const confirmationGate = new Promise<void>((resolve) => { releaseConfirmation = resolve; });
      const submitted = new Promise<void>((resolve) => { markSubmitted = resolve; });
      const order: string[] = [];
      const counts = async (blockTag: "latest" | "pending") => blockTag === "pending" ? pending : latest;

      const oldProcess = first.submit({
        chainId,
        address,
        operationId: "mission:resolve:old",
        getTransactionCount: counts,
        submit: async (nonce) => {
          order.push(`old-submit:${nonce}`);
          pending = nonce + 1;
          markSubmitted();
          return hash(nonce);
        },
        confirm: async () => {
          await confirmationGate;
          latest = pending;
          order.push("old-confirm");
        }
      });
      await submitted;
      const newProcess = second.submit({
        chainId,
        address,
        operationId: "randomness:commit:new",
        getTransactionCount: counts,
        submit: async (nonce) => {
          order.push(`new-submit:${nonce}`);
          pending = nonce + 1;
          return hash(nonce);
        },
        confirm: async () => { latest = pending; }
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(order).toEqual(["old-submit:9"]);
      releaseConfirmation();
      await Promise.all([oldProcess, newProcess]);
      expect(order).toEqual(["old-submit:9", "old-confirm", "new-submit:10"]);
    });
  });

  test("resynchronizes after replacement-underpriced when another writer advanced pending", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:", {
      replacementWaitMs: 10,
      replacementPollMs: 1
    });
    let pending = 7;
    const attempted: number[] = [];
    const result = await coordinator.submit({
      chainId,
      address,
      operationId: "mission:resolve:7",
      getTransactionCount: async () => pending,
      submit: async (nonce) => {
        attempted.push(nonce);
        if (attempted.length === 1) {
          pending = 8;
          throw new Error("replacement transaction underpriced");
        }
        pending = nonce + 1;
        return hash(nonce);
      },
      confirm: async () => {}
    });

    expect(attempted).toEqual([7, 8]);
    expect(result).toBe(hash(8));
  });

  test("stops at a replacement-underpriced nonce gap instead of allocating future nonces", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:", {
      replacementWaitMs: 2,
      replacementPollMs: 1
    });
    const attempted: number[] = [];
    await expect(coordinator.submit({
      chainId,
      address,
      operationId: "randomness:fulfill:42",
      getTransactionCount: async () => 63_996,
      submit: async (nonce) => {
        attempted.push(nonce);
        throw new Error("replacement transaction underpriced");
      },
      confirm: async () => {}
    })).rejects.toBeInstanceOf(ResolverNonceStalledError);
    expect(attempted).toEqual([63_996]);
  });

  test("persists an accepted hash across restart and confirms it without rebroadcast", async () => {
    await withDatabase(async (databasePath) => {
      const operationId = "mission:return:99";
      let broadcasts = 0;
      const first = new ResolverTransactionCoordinator(databasePath);
      await expect(first.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async () => 12,
        submit: async (nonce) => {
          broadcasts += 1;
          return hash(nonce);
        },
        confirm: async () => { throw new Error("receipt RPC timed out"); }
      })).rejects.toThrow("receipt RPC timed out");

      const restarted = new ResolverTransactionCoordinator(databasePath);
      const result = await restarted.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async () => 13,
        submit: async (nonce) => {
          broadcasts += 1;
          return hash(nonce);
        },
        confirm: async () => {}
      });

      expect(result).toBe(hash(12));
      expect(broadcasts).toBe(1);
    });
  });

  test("replaces the same durable operation at its original nonce after receipt timeout", async () => {
    await withDatabase(async (databasePath) => {
      const operationId = "mission:resolve:stale-fee";
      let latest = 12;
      let pending = 12;
      const first = new ResolverTransactionCoordinator(databasePath);
      await expect(first.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async (blockTag) => blockTag === "latest" ? latest : pending,
        submit: async (nonce) => {
          pending = nonce + 1;
          return hash(nonce);
        },
        confirm: async () => { throw new Error("receipt RPC timed out"); }
      })).rejects.toThrow("receipt RPC timed out");

      const replacements: Array<{ nonce: number; previousHash: string }> = [];
      const replacementHash = `0x${"f".repeat(64)}` as const;
      const restarted = new ResolverTransactionCoordinator(databasePath);
      const result = await restarted.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async (blockTag) => blockTag === "latest" ? latest : pending,
        submit: async () => { throw new Error("must not allocate a future nonce"); },
        shouldReplace: async () => true,
        replace: async (nonce, previousHash) => {
          replacements.push({ nonce, previousHash });
          return replacementHash;
        },
        confirm: async (transactionHash) => {
          if (transactionHash === replacementHash) {
            latest = 13;
            pending = 13;
            return;
          }
          throw new Error("receipt RPC timed out");
        }
      });

      expect(result).toBe(replacementHash);
      expect(replacements).toEqual([{ nonce: 12, previousHash: hash(12) }]);
    });
  });

  test("does not allocate beyond an earlier pending nonce owned by another operation", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let broadcasts = 0;
    await expect(coordinator.submit({
      chainId,
      address,
      operationId: "randomness:commit:later",
      getTransactionCount: async (blockTag) => blockTag === "latest" ? 12 : 18,
      submit: async (nonce) => {
        broadcasts += 1;
        return hash(nonce);
      },
      confirm: async () => {}
    })).rejects.toBeInstanceOf(ResolverNonceStalledError);
    expect(broadcasts).toBe(0);
  });

  test("cancels a stale orphaned operation before allocating the next canonical operation", async () => {
    let latest = 12;
    let pending = 12;
    const coordinator = new ResolverTransactionCoordinator(":memory:", { staleTransactionMs: 0 });
    await expect(coordinator.submit({
      chainId,
      address,
      operationId: "mission:resolve:already-manually-resolved",
      getTransactionCount: async (blockTag) => blockTag === "latest" ? latest : pending,
      submit: async (nonce) => {
        pending = nonce + 1;
        return hash(nonce);
      },
      confirm: async () => { throw new Error("receipt RPC timed out"); }
    })).rejects.toThrow("receipt RPC timed out");

    const cancellations: number[] = [];
    const submissions: number[] = [];
    const cancellationHash = `0x${"e".repeat(64)}` as const;
    const result = await coordinator.submit({
      chainId,
      address,
      operationId: "mission:resolve:still-due",
      getTransactionCount: async (blockTag) => blockTag === "latest" ? latest : pending,
      submit: async (nonce) => {
        submissions.push(nonce);
        pending = nonce + 1;
        return hash(nonce);
      },
      shouldReplace: async () => false,
      cancelStale: async (nonce) => {
        cancellations.push(nonce);
        return cancellationHash;
      },
      confirm: async (transactionHash) => {
        if (transactionHash === cancellationHash) {
          latest = 13;
          pending = 13;
          return;
        }
        latest = pending;
      }
    });

    expect(cancellations).toEqual([12]);
    expect(submissions).toEqual([13]);
    expect(result).toBe(hash(13));
  });

  test("returns a confirmed operation idempotently without allocating another nonce", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let pending = 4;
    let broadcasts = 0;
    const request = () => coordinator.submit({
      chainId,
      address,
      operationId: "randomness:fulfill:confirmed",
      getTransactionCount: async () => pending,
      submit: async (nonce) => {
        broadcasts += 1;
        pending = nonce + 1;
        return hash(nonce);
      },
      confirm: async () => {}
    });

    expect(await request()).toBe(hash(4));
    expect(await request()).toBe(hash(4));
    expect(broadcasts).toBe(1);
  });

  test("defers a crash-after-broadcast ambiguity until canonical state refreshes", async () => {
    await withDatabase(async (databasePath) => {
      const coordinator = new ResolverTransactionCoordinator(databasePath);
      const operationId = "mission:resolve:crash-window";
      const database = new Database(databasePath);
      database.query(`
        INSERT INTO resolver_transaction_attempts (
          chain_id, resolver_address, operation_id, nonce, transaction_hash, status, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'allocating', ?)
      `).run(chainId, address, operationId, 30, new Date().toISOString());
      database.close();

      let latest = 30;
      let pending = 31;
      let broadcasts = 0;
      const request = () => coordinator.submit({
        chainId,
        address,
        operationId,
        getTransactionCount: async (blockTag) => blockTag === "latest" ? latest : pending,
        submit: async (nonce) => {
          broadcasts += 1;
          pending = nonce + 1;
          return hash(nonce);
        },
        confirm: async () => { latest = pending; }
      });

      await expect(request()).rejects.toBeInstanceOf(ResolverSubmissionAmbiguousError);
      expect(broadcasts).toBe(0);

      latest = 31;
      pending = 31;
      await expect(request()).rejects.toThrow("refresh canonical operation state before any retry");
      expect(broadcasts).toBe(0);

      expect(await request()).toBe(hash(31));
      expect(broadcasts).toBe(1);
    });
  });

  test("dry-runs and then fills only an exact contiguous nonce gap", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let latest = 63_996;
    let pending = 63_996;
    const sent: number[] = [];
    const base = {
      chainId,
      address,
      fromNonce: 63_996,
      throughNonce: 64_001,
      getTransactionCount: async (blockTag: "latest" | "pending") => blockTag === "latest" ? latest : pending,
      submitCancellation: async (nonce: number) => {
        sent.push(nonce);
        pending = nonce + 1;
        return hash(nonce);
      },
      confirm: async () => { latest = pending; }
    };

    const dryRun = await coordinator.recoverNonceGap({ ...base, broadcast: false });
    expect(dryRun.plannedNonces).toEqual([63_996, 63_997, 63_998, 63_999, 64_000, 64_001]);
    expect(sent).toEqual([]);

    const recovered = await coordinator.recoverNonceGap({ ...base, broadcast: true });
    expect(sent).toEqual(dryRun.plannedNonces);
    expect(recovered.submitted.map(({ nonce }) => nonce)).toEqual(dryRun.plannedNonces);
  });

  test("aborts gap recovery when the requested first nonce is already occupied", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    await expect(coordinator.recoverNonceGap({
      chainId,
      address,
      fromNonce: 63_996,
      throughNonce: 64_001,
      broadcast: true,
      getTransactionCount: async (blockTag) => blockTag === "latest" ? 63_996 : 63_997,
      submitCancellation: async (nonce) => hash(nonce),
      confirm: async () => {}
    })).rejects.toThrow("expected latest/pending 63996, got 63996/63997");
  });
});

function hash(nonce: number): `0x${string}` {
  return `0x${nonce.toString(16).padStart(64, "0")}`;
}

async function withDatabase(operation: (databasePath: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "veydrift-resolver-transactions-"));
  try {
    await operation(join(directory, "resolver-transactions.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
