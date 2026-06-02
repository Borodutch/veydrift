import { describe, expect, test } from "bun:test";
import { createTransactionActionGate } from "../src/transactionActionGate";

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
