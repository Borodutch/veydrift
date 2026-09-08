import { afterEach, describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import type { WriteTransactionState } from "./transactionActionGate";
import { storePaidAllianceInvite } from "./walletFlow";

const journalKey = "veydrift:pending-transactions:https://recovery.test";
const stores: BackendDataStore[] = [];
const restorers: Array<() => void> = [];
const status = (hash: string, phase: "submitted" | "confirmed" | "applied" | "reverted" = "applied") => ({
  events: [], indexedEventCount: 0, latestIndexedBlock: "20", phase,
  receiptBlock: phase === "submitted" ? null : "20", transactionHash: hash,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await Bun.sleep(1);
  expect(check()).toBe(true);
}
function globalValue(key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  restorers.push(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
}
function browser(entries: unknown[] = []) {
  const values = new Map<string, string>();
  if (entries.length) values.set(journalKey, JSON.stringify(entries));
  const events = Object.assign(new EventTarget(), { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const navigator = { onLine: true };
  globalValue("window", events);
  globalValue("document", document);
  globalValue("navigator", navigator);
  return { values, events, document, navigator };
}
function store(options: ConstructorParameters<typeof BackendDataStore>[1] = {}) {
  const data = new BackendDataStore("https://recovery.test", { transactionPollIntervalMs: 0, transactionStatusReader: async (hash) => status(hash), ...options });
  stores.push(data);
  return data;
}
const saved = (hash = "0xold", wallet = "0xabc", chainId = "0x2105") => ({
  actionId: "building:start:mine", chainId, submittedAt: 1, transactionHash: hash, wallet,
  planetIds: ["7"], conflictKeys: ["planet:7"],
});
const action = (hash = "0xnew", planetId = "7", wallet = "0xabc") => ({
  key: "building:start:mine", label: "Build mine", chainId: "0x2105",
  invalidateTags: [`wallet:${wallet}`, `planet:${planetId}`] as const,
  send: async () => hash,
});
afterEach(() => {
  for (const data of stores.splice(0)) data.dispose();
  for (const restore of restorers.splice(0).reverse()) restore();
});

describe("automatic transaction recovery", () => {
  test("ten restored hashes begin observation independently", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ ...saved("0xtx" + index), planetIds: [String(index)], conflictKeys: ["planet:" + index] }));
    const { values } = browser(entries);
    const ready = deferred<void>();
    let reads = 0;
    const data = store({ transactionStatusReader: async (hash) => { reads++; await ready.promise; return status(hash); } });
    data.setContext("0xabc", "7", "0x2105");
    await until(() => reads === 10);
    ready.resolve();
    await until(() => !values.has(journalKey));
    expect(reads).toBe(10);
  });

  test("a response for another hash cannot complete this transaction", async () => {
    browser();
    let reads = 0;
    const data = store({ transactionStatusReader: async (hash) => status(++reads === 1 ? "0xwrong" : hash) });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnew" });
    expect(reads).toBe(2);
  });

  test("disposal aborts a real status transport while preserving its journal", async () => {
    const { values } = browser();
    let started = false;
    let aborted = false;
    globalValue("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      started = true;
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal?.reason); }, { once: true });
    }));
    const data = new BackendDataStore("https://recovery.test");
    stores.push(data);
    const write = data.runWriteTransaction(action());
    await until(() => started);
    data.dispose();
    await expect(write).resolves.toMatchObject({ outcome: "submitted", txHash: "0xnew" });
    expect(aborted).toBe(true);
    expect(values.has(journalKey)).toBe(true);
  });

  test("preparation is gated and wallet rejection never creates a journal", async () => {
    const { values } = browser();
    const prepared = deferred<void>();
    let sends = 0;
    const data = store();
    const first = data.runWriteTransaction({ ...action(), prepare: () => prepared.promise, send: async () => { throw new Error("Wallet request rejected"); } });
    await expect(data.runWriteTransaction({ ...action("0xother", "8"), send: async () => { sends++; return "0xother"; } })).resolves.toMatchObject({ outcome: "not-submitted" });
    prepared.resolve();
    await expect(first).resolves.toMatchObject({ outcome: "not-submitted" });
    expect(values.has(journalKey)).toBe(false);
    expect(sends).toBe(0);
    expect(data.isTransactionPending("0xabc")).toBe(false);
  });

  test("invite authorization happens before submission and survives reload without wallet prompts", async () => {
    const { values } = browser();
    const steps: string[] = [];
    const secret = "0x" + "ab".repeat(32);
    const provider = { request: async <T>() => { steps.push("authorize"); return "0xsignature" as T; } };
    const first = store({ transactionStatusReader: async (hash) => status(hash, "submitted") });
    const write = first.runWriteTransaction({
      ...action(), indexing: first.indexing.paidAllianceInvite("0xabc", provider, secret),
      send: async () => { steps.push("send"); return "0xnew"; },
    });
    await until(() => values.has(journalKey));
    first.dispose();
    await write;
    expect(steps).toEqual(["authorize", "send"]);
    expect(JSON.parse(values.get(journalKey)!)[0].completions).toEqual([{ kind: "paid-alliance-invite", secret, signature: "0xsignature" }]);
    let attempts = 0;
    globalValue("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://recovery.test/alliance-invites/store");
      expect(JSON.parse(String(init?.body))).toEqual({ purchaser: "0xabc", secret, signature: "0xsignature" });
      return ++attempts === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ stored: true });
    });
    const next = store();
    next.setContext("0xabc", "7", "0x2105");
    await until(() => !values.has(journalKey));
    expect(attempts).toBe(2);
    expect(steps).toEqual(["authorize", "send"]);
  });

  test("the post-application mutation timeout covers a stalled response body", async () => {
    const originalTimeout = globalThis.setTimeout;
    globalValue("setTimeout", ((callback: TimerHandler, ms?: number, ...args: unknown[]) => originalTimeout(callback, ms === 10_000 ? 1 : ms, ...args)) as typeof setTimeout);
    globalValue("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })),
    }));
    await expect(storePaidAllianceInvite("https://recovery.test", "0xabc", "secret", "signature")).rejects.toThrow("Timed out writing");
  });

  test("a failed follow-up read does not repeat completed invite storage or authorization", async () => {
    browser();
    let signatures = 0;
    let writes = 0;
    let reads = 0;
    globalValue("fetch", async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/alliance-invites/store")) { writes++; return Response.json({ stored: true }); }
      return ++reads === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ membership: { allianceId: null } });
    });
    const data = store();
    await expect(data.runWriteTransaction({ ...action(), indexing: data.indexing.paidAllianceInvite("0xabc", {
      request: async <T>() => { signatures++; return "0xsignature" as T; },
    }, "0x" + "ab".repeat(32)) })).resolves.toMatchObject({ outcome: "indexed" });
    expect(signatures).toBe(1);
    expect(writes).toBe(1);
    expect(reads).toBe(2);
  });

  test("persists the hash before status observation and completes only after indexed refresh", async () => {
    const { values } = browser();
    const refresh = deferred<{ revision: number }>();
    let loads = 0;
    const data = store({ transactionStatusReader: async (hash) => {
      expect(values.get(journalKey)).toContain(hash);
      return status(hash);
    } });
    const key = data.key("infrastructure", "0xabc", "7");
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => ++loads === 1 ? { revision: 1 } : refresh.promise, { wallet: "0xabc", planetId: "7" });
    const write = data.runWriteTransaction(action());
    await until(() => loads === 2);
    expect(values.get(journalKey)).toContain("0xnew");
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase).toBe("indexing");
    refresh.resolve({ revision: 2 });
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
    expect(data.snapshot(key)?.data).toEqual({ revision: 2 });
    expect(values.has(journalKey)).toBe(false);
  });

  test("a stalled planet does not block another planet, and action identities stay separate", async () => {
    browser();
    const receipt = deferred<ReturnType<typeof status>>();
    const data = store({ transactionStatusReader: (hash) => hash === "0xfirst" ? receipt.promise : Promise.resolve(status(hash)) });
    const first = data.runWriteTransaction(action("0xfirst", "7"));
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase === "confirming");
    expect(data.isTransactionPending("0xabc", ["planet:7"])).toBe(true);
    expect(data.isTransactionPending("0xabc", ["planet:8"])).toBe(false);
    let conflictingSends = 0;
    await expect(data.runWriteTransaction({ ...action(), key: "ship:start", send: async () => { conflictingSends++; return "0xbad"; } })).resolves.toMatchObject({ outcome: "not-submitted" });
    expect(conflictingSends).toBe(0);
    await expect(data.runWriteTransaction(action("0xsecond", "8"))).resolves.toMatchObject({ outcome: "indexed", txHash: "0xsecond" });
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "7"))?.data?.txHash).toBe("0xfirst");
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "8"))?.data?.txHash).toBe("0xsecond");
    receipt.resolve(status("0xfirst"));
    await first;
  });

  test("reload resumes an arbitrarily old hash without submitting or asking for a decision", async () => {
    const { values, events } = browser([saved()]);
    let reads = 0;
    const phases: string[] = [];
    const data = store({ transactionStatusReader: async (hash) => {
      reads++;
      if (reads < 3) throw new Error("temporarily unavailable");
      return status(hash, reads === 3 ? "confirmed" : "applied");
    } });
    data.subscribe(() => {
      const state = data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data;
      if (state) phases.push(state.phase);
    });
    data.setContext("0xabc", "7", "0x2105");
    events.dispatchEvent(new Event("pageshow"));
    events.dispatchEvent(new Event("online"));
    await until(() => !values.has(journalKey));
    expect(reads).toBe(4);
    expect(phases).not.toContain("error");
    expect(phases).not.toContain("pending");
    expect(phases.at(-1)).toBe("success");
    expect(data.snapshot(data.key("pending-transaction-recovery", "0xabc"))).toBeUndefined();
  });

  test("dispose retains the submitted hash and a new store recovers it without resubmitting", async () => {
    const { values } = browser();
    const first = store({ transactionStatusReader: async (hash) => status(hash, "submitted") });
    let sends = 0;
    const pending = first.runWriteTransaction({ ...action(), send: async () => { sends++; return "0xnew"; } });
    await until(() => values.has(journalKey));
    first.dispose();
    await expect(pending).resolves.toMatchObject({ outcome: "submitted", txHash: "0xnew" });
    expect(values.has(journalKey)).toBe(true);
    const next = store();
    next.setContext("0xabc", "7", "0x2105");
    await until(() => !values.has(journalKey));
    expect(sends).toBe(1);
  });

  test("a reverted receipt is terminal, while an API error is not", async () => {
    const { values } = browser();
    let reads = 0;
    const data = store({ transactionStatusReader: async (hash) => {
      if (++reads === 1) throw new Error("upstream mentions reverted but returned no receipt");
      return status(hash, "reverted");
    } });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "reverted", txHash: "0xnew" });
    expect(reads).toBe(2);
    expect(values.has(journalKey)).toBe(false);
  });

  test("a failed refresh preserves last-good data and the journal until a retry succeeds", async () => {
    const { values } = browser();
    const data = store();
    const key = data.key("shipyard", "0xabc", "7");
    let loads = 0;
    let permitRefresh = false;
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => {
      if (++loads > 1 && !permitRefresh) throw new Error("read unavailable");
      return { revision: loads };
    }, { wallet: "0xabc", planetId: "7" });
    const write = data.runWriteTransaction(action());
    await until(() => loads >= 2);
    expect(values.has(journalKey)).toBe(true);
    expect(data.snapshot(key)?.data).toEqual({ revision: 1 });
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase).toBe("indexing");
    permitRefresh = true;
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
    expect(values.has(journalKey)).toBe(false);
  });

  test("a read begun before submission cannot satisfy the post-application refresh", async () => {
    browser();
    const data = store();
    const old = deferred<{ revision: number }>();
    const key = data.key("infrastructure", "0xabc", "7");
    let loads = 0;
    const load = async () => ++loads === 2 ? old.promise : { revision: loads };
    data.subscribeKey(key, () => {});
    await data.refresh(key, load, { wallet: "0xabc", planetId: "7" });
    const staleRead = data.refresh(key, load, { wallet: "0xabc", planetId: "7" });
    const write = data.runWriteTransaction(action());
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase === "indexing");
    old.resolve({ revision: 2 });
    await staleRead;
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
    expect(data.snapshot(key)?.data).toEqual({ revision: 3 });
  });

  test("offline/hidden recovery pauses and resumes once on online/pageshow/visibility", async () => {
    const { values, document, navigator, events } = browser([saved()]);
    document.visibilityState = "hidden";
    navigator.onLine = false;
    let reads = 0;
    const data = store({ transactionStatusReader: async (hash) => { reads++; return status(hash); } });
    data.setContext("0xabc", "7", "0x2105");
    await Bun.sleep(5);
    expect(reads).toBe(0);
    document.visibilityState = "visible";
    events.dispatchEvent(new Event("pageshow"));
    expect(reads).toBe(0);
    navigator.onLine = true;
    events.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    events.dispatchEvent(new Event("pageshow"));
    await until(() => !values.has(journalKey));
    expect(reads).toBe(1);
  });

  test("wallet switching pauses the old recovery without exposing or deleting it", async () => {
    const { values } = browser([saved()]);
    const receipt = deferred<ReturnType<typeof status>>();
    const data = store({ transactionStatusReader: () => receipt.promise });
    data.setContext("0xabc", "7", "0x2105");
    data.setContext("0xdef", "8", "0x2105");
    receipt.resolve(status("0xold"));
    await Bun.sleep(5);
    expect(values.has(journalKey)).toBe(true);
    expect(data.snapshot(data.writeTransactionKey(undefined, "0xabc"))).toBeUndefined();
    expect(data.isTransactionPending("0xdef", ["planet:7"])).toBe(false);
    data.setContext("0xabc", "7", "0x2105");
    await until(() => !values.has(journalKey));
  });

  test("a different-chain journal is retained and never queried against the current chain", async () => {
    const { values } = browser([saved("0xotherchain", "0xabc", "0x1")]);
    const hashes: string[] = [];
    const data = store({ transactionStatusReader: async (hash) => { hashes.push(hash); return status(hash); } });
    data.setContext("0xabc", "7", "0x2105");
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
    expect(hashes).toEqual(["0xnew"]);
    expect(values.get(journalKey)).toContain("0xotherchain");
  });

  test("storage failure still preserves in-memory recovery and duplicate protection", async () => {
    const { events } = browser();
    events.localStorage.setItem = () => { throw new Error("storage disabled"); };
    const receipt = deferred<ReturnType<typeof status>>();
    const data = store({ transactionStatusReader: () => receipt.promise });
    const first = data.runWriteTransaction(action());
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase === "confirming");
    let sends = 0;
    const duplicate = data.runWriteTransaction({ ...action(), send: async () => { sends++; return "0xbad"; } });
    receipt.resolve(status("0xnew"));
    await Promise.all([first, duplicate]);
    expect(sends).toBe(0);
  });

  test("neither shell contains the removed recovery decision UI", async () => {
    for (const name of ["PlayableMvpApp.tsx", "FirstPlanetSettlementApp.tsx"]) {
      const source = await Bun.file(new URL(name, import.meta.url)).text();
      expect(source).not.toContain("PendingTransactionRecoveryDialog");
      expect(source).not.toContain("discardPendingTransactionRecovery");
      expect(source).not.toContain("keepPendingTransactionRecovery");
    }
  });
});
