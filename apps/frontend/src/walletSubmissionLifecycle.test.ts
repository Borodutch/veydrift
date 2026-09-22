import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { configureWalletTransactionTransport, transactionWalletProvider, type Eip1193Provider } from "./walletFlow";
import type { WriteTransactionState } from "./transactionActionGate";

const stores: BackendDataStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(1);
  expect(check()).toBe(true);
}
function fixture(timeout = 1_000) {
  const result = deferred<string>();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let sends = 0;
  const provider: Eip1193Provider = {
    async request<T>() { expect(this).toBe(provider); sends++; return await result.promise as T; },
    on(event, listener) { expect(this).toBe(provider); if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { expect(this).toBe(provider); listeners.get(event)?.delete(listener); },
  };
  Object.assign(provider, { isTrust: true, selectedAddress: "PRIVATE_ACCOUNT", secret: "PRIVATE_SECRET" });
  configureWalletTransactionTransport(provider, "injected", "https://rpc.test");
  const hashes: string[] = [];
  const store = new BackendDataStore("https://wallet-lifecycle.test", {
    transactionForegroundTimeoutMs: timeout,
    transactionPollIntervalMs: 0,
    transactionStatusReader: async hash => {
      hashes.push(hash);
      return { events: [], indexedEventCount: 0, latestIndexedBlock: "20", phase: "applied", receiptBlock: "20", transactionHash: hash };
    },
  });
  stores.push(store);
  const action = {
    key: "mission:launch", label: "Deploy mission", chainId: "0x2105", invalidateTags: ["wallet:0xabc", "planet:7"] as const,
    send: (beforeSend: Parameters<typeof transactionWalletProvider>[1]) => transactionWalletProvider(provider, beforeSend).request<string>({
      method: "eth_sendTransaction", params: [{ from: "PRIVATE_ACCOUNT", data: "PRIVATE_CALLDATA", value: "PRIVATE_VALUE" }],
    }),
  };
  const state = () => store.snapshot<WriteTransactionState>(store.writeTransactionKey(action.key, "0xabc", "7"))?.data;
  return { result, provider, store, action, state, hashes, sends: () => sends,
    emit: (event: string, value?: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); },
    listenerCount: () => listeners.get("disconnect")?.size ?? 0,
  };
}

describe("wallet submission lifecycle (simulated providers, not real Trust/Vivaldi proof)", () => {
  test("disconnect releases foreground immediately as unknown, retains retry consent and late hash", async () => {
    const f = fixture();
    const first = f.store.runWriteTransaction(f.action);
    await until(() => f.sends() === 1);
    f.emit("disconnect", { code: 4900, message: "PRIVATE_ERROR", data: "PRIVATE_DATA" });
    await until(() => f.state()?.phase === "unknown");
    await expect(first).resolves.toMatchObject({ outcome: "unknown" });
    expect(f.state()?.label).toContain("Reconnect");
    expect(f.state()?.label).toContain("may already have been sent");
    expect(f.listenerCount()).toBe(0);
    await expect(f.store.runWriteTransaction(f.action)).resolves.toMatchObject({ outcome: "unknown" });
    expect(f.sends()).toBe(1);
    f.result.resolve("0xlate");
    await until(() => f.hashes.includes("0xlate"));
    await until(() => f.state()?.phase === "success");
  });

  test.each(["prompt never opens", "spinner closes silently"])("%s without terminal event keeps deadline/unknown and cleans listeners", async () => {
    const f = fixture(25);
    const first = f.store.runWriteTransaction(f.action);
    await until(() => f.sends() === 1);
    expect(f.listenerCount()).toBe(1);
    // No EIP-1193 popup-close event exists: focus/visibility is not a rejection.
    f.emit("accountsChanged", []);
    f.emit("chainChanged", "0x1");
    expect(f.state()?.phase).toBe("pending");
    await expect(first).resolves.toMatchObject({ outcome: "unknown" });
    expect(f.state()?.label).toContain("Open your wallet");
    expect(f.listenerCount()).toBe(0);
    f.result.resolve("0xlate");
    await until(() => f.hashes.includes("0xlate"));
    expect(f.sends()).toBe(1);
  });

  test.each([4001, 4900, -32002])("terminal request error %s releases immediately and cleans listeners", async code => {
    const f = fixture();
    const first = f.store.runWriteTransaction(f.action);
    await until(() => f.sends() === 1);
    f.result.reject(Object.assign(new Error("PRIVATE_ERROR"), { code, data: "PRIVATE_DATA" }));
    await expect(first).resolves.toMatchObject({ outcome: code === 4001 ? "not-submitted" : "unknown" });
    expect(f.listenerCount()).toBe(0);
    expect(f.sends()).toBe(1);
  });

  test("late result after disconnect cannot overwrite a consented newer attempt", async () => {
    const f = fixture();
    const first = f.store.runWriteTransaction(f.action);
    await until(() => f.sends() === 1);
    f.emit("disconnect");
    await until(() => f.state()?.phase === "unknown");
    await first;
    let retrySends = 0;
    await expect(f.store.runWriteTransaction({ ...f.action, confirmRetry: () => true,
      send: async beforeSend => { beforeSend(); retrySends++; return "0xnew"; },
    })).resolves.toMatchObject({ outcome: "indexed" });
    f.result.resolve("0xold");
    await until(() => f.hashes.includes("0xold"));
    expect(f.state()?.txHash).toBe("0xnew");
    expect(retrySends).toBe(1);
    expect(f.sends()).toBe(1);
  });

  test("success and disposal detach observers without losing a late result", async () => {
    const success = fixture();
    const first = success.store.runWriteTransaction(success.action);
    await until(() => success.sends() === 1);
    success.result.resolve("0xsuccess");
    await expect(first).resolves.toMatchObject({ outcome: "indexed" });
    expect(success.listenerCount()).toBe(0);
    success.emit("disconnect");
    expect(success.state()?.phase).toBe("success");
    const disposed = fixture();
    const pending = disposed.store.runWriteTransaction(disposed.action);
    await until(() => disposed.sends() === 1);
    disposed.store.dispose();
    await expect(pending).resolves.toMatchObject({ outcome: "unknown" });
    expect(disposed.listenerCount()).toBe(0);
    disposed.result.resolve("0xafterdispose");
  });

  test.each(["absent", "throws"])("optional provider event API %s does not block or duplicate a send", async kind => {
    const f = fixture(25);
    if (kind === "absent") { delete f.provider.on; delete f.provider.removeListener; }
    else f.provider.on = () => { throw new Error("Unsupported event"); };
    const first = f.store.runWriteTransaction(f.action);
    await until(() => f.sends() === 1);
    await expect(first).resolves.toMatchObject({ outcome: "unknown" });
    f.result.resolve("0xlate");
    await until(() => f.hashes.includes("0xlate"));
    expect(f.sends()).toBe(1);
  });

  test("the same coordinated attempt cannot send twice", async () => {
    const f = fixture();
    const first = f.store.runWriteTransaction({ ...f.action, send: async beforeSend => {
      const wrapped = transactionWalletProvider(f.provider, beforeSend);
      const pending = wrapped.request<string>({ method: "eth_sendTransaction" });
      expect(() => wrapped.request({ method: "eth_sendTransaction" })).toThrow("already requested");
      return pending;
    } });
    await until(() => f.sends() === 1);
    f.result.resolve("0xonce");
    await expect(first).resolves.toMatchObject({ outcome: "indexed" });
    expect(f.sends()).toBe(1);
  });

  test("synchronous provider throws release immediately and detach observers", async () => {
    const f = fixture();
    f.provider.request = () => { throw Object.assign(new Error("Provider disconnected"), { code: 4900 }); };
    await expect(f.store.runWriteTransaction(f.action)).resolves.toMatchObject({ outcome: "unknown" });
    expect(f.listenerCount()).toBe(0);
  });

  test("safe diagnostics correlate selected objects and request lifecycle without wallet payloads", async () => {
    const log = spyOn(console, "info").mockImplementation(() => {});
    try {
      const f = fixture();
      const first = f.store.runWriteTransaction(f.action);
      await until(() => f.sends() === 1);
      f.emit("disconnect", { code: 4900, message: "PRIVATE_ERROR", data: "PRIVATE_DATA" });
      await until(() => f.state()?.phase === "unknown");
      await first;
      f.result.resolve("PRIVATE_HASH");
      await until(() => f.hashes.includes("PRIVATE_HASH"));
      const records = log.mock.calls.map(call => JSON.parse(String(call[0]))).filter(record => record.event === "wallet_submission");
      expect(records.map(record => record.phase)).toEqual(["requested", "disconnected", "foreground_released", "resolved"]);
      expect(new Set(records.map(record => record.providerId)).size).toBe(1);
      expect(new Set(records.map(record => record.requestId)).size).toBe(1);
      expect(records[0].source).toBe("injected");
      expect(records[0].flags).toContain("isTrust");
      expect(JSON.stringify(records)).not.toContain("PRIVATE_");
    } finally { log.mockRestore(); }
  });
});
