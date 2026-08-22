import { describe, expect, test } from "bun:test";
import { createTransactionActionGate, runWriteTransaction, type WriteTransactionPhase, type WriteTransactionState } from "../src/transactionActionGate";
import { confirmTransactionReceiptForProviderSource, type Eip1193Provider } from "../src/walletFlow";

describe("transaction action gate", () => {
  test("prevents rapid duplicate start actions while the wallet path is in flight", async () => {
    const gate = createTransactionActionGate();
    const start = deferred<void>();
    let calls = 0;

    const first = gate.run("building:start:metalMine", async () => {
      calls += 1;
      await start.promise;
      return "0xtx1";
    });
    const duplicate = gate.run("building:start:metalMine", async () => {
      calls += 1;
      return "0xtx2";
    });

    await expect(duplicate).resolves.toBeUndefined();
    expect(calls).toBe(1);

    start.resolve();
    await expect(first).resolves.toBe("0xtx1");
  });

  test("prevents rapid duplicate finish actions until the confirmation path settles", async () => {
    const gate = createTransactionActionGate();
    const finish = deferred<void>();
    let calls = 0;

    const first = gate.run("building:finish:7", async () => {
      calls += 1;
      await finish.promise;
      return "0xfinish1";
    });
    const duplicate = gate.run("building:finish:7", async () => {
      calls += 1;
      return "0xfinish2";
    });

    await expect(duplicate).resolves.toBeUndefined();
    expect(calls).toBe(1);

    finish.resolve();
    await expect(first).resolves.toBe("0xfinish1");

    await expect(gate.run("building:finish:7", async () => "0xfinish3")).resolves.toBe("0xfinish3");
  });

  test("prevents duplicate first-settlement submissions while wallet and chain confirmation are pending", async () => {
    const gate = createTransactionActionGate();
    const settlement = deferred<void>();
    let calls = 0;

    const first = gate.run("settlement:first-planet", async () => {
      calls += 1;
      await settlement.promise;
      return "0xsettled";
    });
    const duplicate = gate.run("settlement:first-planet", async () => {
      calls += 1;
      return "0xduplicate";
    });

    await expect(duplicate).resolves.toBeUndefined();
    expect(calls).toBe(1);

    settlement.resolve();
    await expect(first).resolves.toBe("0xsettled");
  });

  test("prevents different mutating actions while any transaction path is in flight", async () => {
    const gate = createTransactionActionGate();
    const building = deferred<void>();
    let calls = 0;

    const first = gate.run("building:start:metalMine", async () => {
      calls += 1;
      await building.promise;
      return "0xbuilding";
    });
    const second = gate.run("fleet:recall:17", async () => {
      calls += 1;
      return "0xfleet";
    });

    expect(gate.isRunning()).toBe(true);
    expect(gate.isRunning("building:start:metalMine")).toBe(true);
    expect(gate.isRunning("fleet:recall:17")).toBe(false);
    await expect(second).resolves.toBeUndefined();
    expect(calls).toBe(1);

    building.resolve();
    await expect(first).resolves.toBe("0xbuilding");
    expect(gate.isRunning()).toBe(false);
    await expect(gate.run("fleet:recall:17", async () => "0xfleet")).resolves.toBe("0xfleet");
  });

  test("runs write transactions through pending, confirming, confirmed, indexing, and success phases", async () => {
    const gate = createTransactionActionGate();
    const phases: WriteTransactionPhase[] = [];

    const completed = await runWriteTransaction(gate, {
      key: "shipyard:start:1",
      label: "Ship production",
      send: async () => "0xship",
      confirm: async () => ({ transactionHash: "0xship", blockNumber: "0x20" }),
      waitForIndexed: async () => "indexed",
      applyIndexedState: async (snapshot) => {
        expect(snapshot).toBe("indexed");
      },
      onStateChange: (state) => {
        phases.push(state.phase);
      },
    });

    expect(completed).toBe(true);
    expect(phases).toEqual(["pending", "confirming", "confirmed", "indexing", "success"]);
  });

  test("keeps wallet preparation inside the same gate as submission", async () => {
    const gate = createTransactionActionGate();
    const prepared = deferred<void>();
    const steps: string[] = [];

    const first = runWriteTransaction(gate, {
      key: "referral:claim",
      label: "Referral reward claim",
      prepare: async () => {
        steps.push("prepare");
        await prepared.promise;
      },
      send: async () => {
        steps.push("send");
        return "0xclaim";
      },
      confirm: async () => ({}),
    });
    const second = runWriteTransaction(gate, {
      key: "settlement:first-planet",
      label: "First planet settlement",
      send: async () => "0xsettlement",
      confirm: async () => ({}),
    });

    await expect(second).resolves.toBe(false);
    expect(steps).toEqual(["prepare"]);
    prepared.resolve();
    await expect(first).resolves.toBe(true);
    expect(steps).toEqual(["prepare", "send"]);
  });

  test("keeps other writes blocked until backend indexing and apply callbacks settle", async () => {
    const gate = createTransactionActionGate();
    const indexed = deferred<void>();
    let calls = 0;

    const first = runWriteTransaction(gate, {
      key: "research:start:4",
      label: "Research",
      send: async () => "0xresearch",
      confirm: async () => ({
        transactionHash: "0xresearch",
        blockNumber: "0x20",
      }),
      waitForIndexed: async () => {
        await indexed.promise;
      },
      onStateChange: () => undefined,
    });
    const second = runWriteTransaction(gate, {
      key: "defense:start:1",
      label: "Defense production",
      send: async () => {
        calls += 1;
        return "0xdefense";
      },
      confirm: async () => ({}),
      onStateChange: () => undefined,
    });

    await expect(second).resolves.toBe(false);
    expect(calls).toBe(0);
    expect(gate.isRunning()).toBe(true);

    indexed.resolve();
    await expect(first).resolves.toBe(true);
    expect(gate.isRunning()).toBe(false);
  });

  test("keeps a visible timed-out terminal state while releasing the global write gate", async () => {
    const gate = createTransactionActionGate();
    const states: WriteTransactionState[] = [];

    await expect(
      runWriteTransaction(gate, {
        key: "shipyard:start:timeout",
        label: "Ship production",
        send: async () => "0xtimeout",
        confirm: async () => ({
          transactionHash: "0xtimeout",
          blockNumber: "0x20",
        }),
        waitForIndexed: async () => {
          throw new Error("Indexed shipyard state timed out while still syncing.");
        },
        onStateChange: (state) => states.push(state),
      }),
    ).resolves.toBe(false);

    expect(states.at(-1)).toMatchObject({
      phase: "error",
      stage: "timed-out",
      txHash: "0xtimeout",
    });
    expect(gate.isRunning()).toBe(false);
    await expect(gate.run("research:start:next", async () => "next")).resolves.toBe("next");
  });

  test("releases the global gate for a second mission after Farcaster app-RPC confirmation and indexing", async () => {
    const gate = createTransactionActionGate();
    let walletReceiptReads = 0;
    const farcasterProvider: Eip1193Provider = {
      request: async () => {
        walletReceiptReads += 1;
        throw new Error("Farcaster receipt read rejected by host.");
      },
    };
    const confirmedTransactions: string[] = [];
    const confirm = (txHash: string) =>
      confirmTransactionReceiptForProviderSource(farcasterProvider, "farcaster", "https://base-rpc.example.test", txHash, {
        fetcher: async () =>
          Response.json({
            result: { status: "0x1", transactionHash: txHash },
          }),
        pollMs: 1,
        timeoutMs: 100,
      });

    const first = await runWriteTransaction(gate, {
      key: "mission:transport:1",
      label: "Transport mission",
      send: async () => `0x${"11".repeat(32)}`,
      confirm,
      waitForIndexed: async (_receipt, txHash) => {
        confirmedTransactions.push(txHash);
      },
    });
    const second = await runWriteTransaction(gate, {
      key: "mission:transport:2",
      label: "Transport mission",
      send: async () => `0x${"22".repeat(32)}`,
      confirm,
      waitForIndexed: async (_receipt, txHash) => {
        confirmedTransactions.push(txHash);
      },
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(walletReceiptReads).toBe(0);
    expect(confirmedTransactions).toEqual([`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`]);
    expect(gate.isRunning()).toBe(false);
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}
