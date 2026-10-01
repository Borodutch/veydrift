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
  test("persists exact batch membership/nonce/local hash before ambiguous send and blocks randomness across restart", async () => {
    await withDatabase(async (databasePath) => {
      let sends = 0;
      const membership = JSON.stringify([{ missionId: "12", leg: "return", dueAt: 5 }]);
      const coordinator = new ResolverTransactionCoordinator(databasePath);
      await expect(coordinator.submit({
        chainId, address, operationId: "batch:12", getTransactionCount: async () => 7,
        submit: async () => { throw new Error("must not use blind send"); },
        prepare: async (nonce) => ({ hash: hash(nonce), membership, broadcast: async () => {
          sends++;
          const db = new Database(databasePath);
          const intent = db.query("SELECT nonce, transaction_hash AS hash, membership, status FROM resolver_prepared_intents").get();
          expect(intent).toEqual({ nonce: 7, hash: hash(7), membership, status: "pending" });
          db.close();
          throw new Error("RPC disconnected after acceptance");
        } }),
        confirm: async () => {}
      })).rejects.toThrow("disconnected");
      const restarted = new ResolverTransactionCoordinator(databasePath);
      await expect(restarted.submit({ chainId, address, operationId: "randomness:5", getTransactionCount: async () => 7,
        submit: async () => { sends++; return hash(8); }, confirm: async () => {},
        cancelStale: async () => { throw new Error("must not cancel batch"); }
      })).rejects.toThrow("durable batch intent");
      await expect(restarted.reconcilePrepared(chainId, address, async () => { throw new Error("receipt unknown"); })).rejects.toThrow("unknown");
      expect(sends).toBe(1);
      await expect(restarted.recoverNonceGap({ chainId, address, fromNonce: 7, throughNonce: 7, broadcast: true,
        getTransactionCount: async () => 7, submitCancellation: async () => { sends++; return hash(7); }, confirm: async () => {}
      })).rejects.toThrow("cannot bypass");
      await restarted.reconcilePrepared(chainId, address, async (h) => { expect(h).toBe(hash(7)); return { finalized: true, blockNumber: "1", blockHash: hash(1), outcomes: "[]" }; });
      await restarted.submit({ chainId, address, operationId: "randomness:5", getTransactionCount: async () => 8,
        submit: async (nonce) => { sends++; expect(nonce).toBe(8); return hash(8); }, confirm: async () => {} });
      expect(sends).toBe(2);
    });
  });

  test("owned expiry is prevented but lost lease retains unresolved pending intent without any resend", async () => {
    for (const mode of ["expiry", "lease"] as const) await withDatabase(async (databasePath) => {
      const coordinator = new ResolverTransactionCoordinator(databasePath);
      let prepared = 0, sent = 0, checked = 0;
      const request = { chainId, address, operationId: "batch:guard", getTransactionCount: async () => 7,
        submit: async () => { sent++; return hash(7); }, confirm: async () => {},
        prepare: async () => {
          prepared++;
          return { hash: hash(7), membership: "[]",
            validateBeforeBroadcast: async () => {
              const db = new Database(databasePath);
              expect(db.query("SELECT status FROM resolver_prepared_intents").get()).toEqual({ status: "pending" });
              if (mode === "lease") db.query("UPDATE resolver_transaction_leases SET expires_at_ms = 0").run();
              db.close();
            },
            assertBeforeBroadcast: () => { checked++; throw new Error("quote expired at final boundary"); },
            broadcast: async () => { sent++; return hash(7); }
          };
        }
      };
      await expect(coordinator.submit(request)).rejects.toThrow(mode === "expiry" ? "quote expired" : "lease was lost");
      expect(checked).toBe(mode === "expiry" ? 1 : 0);
      const db = new Database(databasePath);
      expect(db.query("SELECT nonce, transaction_hash AS hash, status FROM resolver_prepared_intents").get())
        .toEqual({ nonce: 7, hash: hash(7), status: mode === "expiry" ? "prevented" : "pending" });
      expect(db.query("SELECT status FROM resolver_transaction_attempts").get()).toEqual({ status: mode === "expiry" ? "prevented" : "submitted" });
      db.close();
      const restarted = new ResolverTransactionCoordinator(databasePath);
      const blocked = mode === "expiry" ? "locally prevented" : "durable batch intent";
      await expect(restarted.submit(request)).rejects.toThrow(blocked);
      await expect(restarted.submit({ ...request, operationId: "randomness:1" })).rejects.toThrow(blocked);
      await expect(restarted.recoverNonceGap({ chainId, address, fromNonce: 7, throughNonce: 7,
        broadcast: true, getTransactionCount: async () => 7, submitCancellation: async () => { sent++; return hash(7); },
        confirm: async () => {}
      })).rejects.toThrow(blocked);
      expect(prepared).toBe(1);
      expect(sent).toBe(0);
    });
  });

  test("stale preflight owner changes zero rows and cannot overwrite successor nonce5/hashBB", async () => {
    for (const mode of ["lease", "identity", "intent"] as const) await withDatabase(async (databasePath) => {
      const coordinator = new ResolverTransactionCoordinator(databasePath);
      const oldHash = ("0x" + "aa".repeat(32)) as `0x${string}`;
      const nextHash = ("0x" + "bb".repeat(32)) as `0x${string}`;
      let sent = 0;
      let snapshot = "";
      const db = new Database(databasePath);
      // Capture all ownership/admission/audit rows after the successor mutation. No stale write is allowed.
      const state = () => JSON.stringify({
        intents: db.query("SELECT * FROM resolver_prepared_intents").all(),
        attempts: db.query("SELECT * FROM resolver_transaction_attempts").all(),
        audit: db.query("SELECT * FROM resolver_transaction_audit").all()
      });
      try {
        await expect(coordinator.submit({ chainId, address, operationId: "batch", getTransactionCount: async () => 4,
          submit: async () => oldHash, confirm: async () => {}, prepare: async () => ({ hash: oldHash, membership: "[]",
            validateBeforeBroadcast: async () => {
              if (mode === "lease") db.query("UPDATE resolver_transaction_leases SET holder = 'successor'").run();
              if (mode !== "intent") db.query("UPDATE resolver_transaction_attempts SET nonce = 5, transaction_hash = ?, status = 'submitted' WHERE operation_id = 'batch'").run(nextHash);
              else db.query("UPDATE resolver_prepared_intents SET membership = 'successor-membership'").run();
              snapshot = state();
              if (mode !== "lease") throw new Error("quote expired");
            }, broadcast: async () => { sent++; return oldHash; }
          }) })).rejects.toThrow(mode === "lease" ? "lease was lost" : mode === "identity" ? "identity changed" : "intent changed");
        expect(state()).toBe(snapshot);
        expect(sent).toBe(0);
        if (mode !== "intent") expect(db.query("SELECT nonce, transaction_hash AS hash, status FROM resolver_transaction_attempts").get())
          .toEqual({ nonce: 5, hash: nextHash, status: "submitted" });
      } finally { db.close(); }
    });
  });

  test("in-flight signing reservation blocks restarted sibling writers and nonce recovery before a result exists", async () => {
    await withDatabase(async (databasePath) => {
      let clock = 1_000, signs = 0, sends = 0;
      const options = { now: () => clock, leaseRenewIntervalMs: 1_000_000 };
      const owner = new ResolverTransactionCoordinator(databasePath, options);
      let release!: (signed: `0x${string}`) => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      const result = new Promise<`0x${string}`>((resolve) => { release = resolve; });
      const pending = owner.submit({ chainId, address, operationId: "batch:signing", getTransactionCount: async () => 4,
        submit: async () => { sends++; return hash(4); }, confirm: async () => {},
        prepare: async (_nonce, signing) => {
          await signing.sign("[]", () => { signs++; started(); return result; });
          throw new Error("must not resume preparation under lost lease");
        }
      });
      // Attach rejection observation before relinquishing the old lease.
      const rejected = pending.catch((error: unknown) => error);
      await ready;
      clock += 90_001;
      const restarted = new ResolverTransactionCoordinator(databasePath, options);
      await expect(restarted.submit({ chainId, address, operationId: "randomness:1", getTransactionCount: async () => 4,
        submit: async () => { sends++; return hash(4); }, confirm: async () => {}
      })).rejects.toThrow("explicit fenced recovery");
      await expect(restarted.recoverNonceGap({ chainId, address, fromNonce: 4, throughNonce: 4,
        broadcast: true, getTransactionCount: async () => 4, submitCancellation: async () => { sends++; return hash(4); }, confirm: async () => {}
      })).rejects.toThrow("explicit fenced recovery");
      const db = new Database(databasePath);
      const before = JSON.stringify(db.query("SELECT * FROM resolver_transaction_attempts").all());
      release("0x1234");
      expect(String(await rejected)).toContain("lease was lost");
      expect(JSON.stringify(db.query("SELECT * FROM resolver_transaction_attempts").all())).toBe(before);
      expect(db.query("SELECT transaction_hash FROM resolver_signing_results").get()).toEqual({
        transaction_hash: "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432"
      });
      expect(db.query("SELECT transferred FROM resolver_signing_reservations").get()).toEqual({ transferred: 0 });
      db.close();
      expect(signs).toBe(1);
      expect(sends).toBe(0);
    });
  });

  test("preparation failure never sends and successful intent confirmation releases shared signer", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let sent = 0;
    const request = { chainId, address, operationId: "batch", getTransactionCount: async () => 0,
      submit: async () => { throw new Error("blind"); }, confirm: async () => {},
      reconcilePrepared: async () => ({ finalized: true, blockNumber: "1", blockHash: hash(1), outcomes: "[]" }) };
    await expect(coordinator.submit({ ...request, prepare: async () => { throw new Error("fee cap changed"); } })).rejects.toThrow("fee cap");
    await coordinator.submit({ ...request, prepare: async () => ({ hash: hash(0), membership: "[]", broadcast: async () => { sent++; return hash(0); } }) });
    await coordinator.reconcilePrepared(chainId, address, async () => { throw new Error("already confirmed"); });
    expect(sent).toBe(1);
  });
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

  test("broadcasts another receipt when a canonical bounded operation is still incomplete", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let pending = 4;
    let complete = false;
    const broadcasts: number[] = [];
    const request = () => coordinator.submit({
      chainId,
      address,
      operationId: "mission:resolve:bounded-missile",
      getTransactionCount: async () => pending,
      submit: async (nonce) => {
        broadcasts.push(nonce);
        pending = nonce + 1;
        return hash(nonce);
      },
      isConfirmedCanonical: async () => true,
      isOperationComplete: async () => complete,
      confirm: async () => {}
    });

    expect(await request()).toBe(hash(4));
    expect(await request()).toBe(hash(5));
    complete = true;
    expect(await request()).toBe(hash(5));
    expect(broadcasts).toEqual([4, 5]);
  });

  test("re-broadcasts a confirmed operation when its receipt is no longer canonical", async () => {
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    let pending = 4;
    let confirmedCanonical = true;
    const broadcasts: number[] = [];
    const request = () => coordinator.submit({
      chainId,
      address,
      operationId: "mission:resolve:reorged-confirmation",
      getTransactionCount: async () => pending,
      submit: async (nonce) => {
        broadcasts.push(nonce);
        pending = nonce + 1;
        return hash(nonce);
      },
      isConfirmedCanonical: async () => confirmedCanonical,
      confirm: async () => {}
    });

    expect(await request()).toBe(hash(4));
    confirmedCanonical = false;
    expect(await request()).toBe(hash(5));
    expect(broadcasts).toEqual([4, 5]);
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
