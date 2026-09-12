import { afterEach, describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { GameApiError } from "./gameApiError";
import { transactionIsBusy, type WriteTransactionState } from "./transactionActionGate";
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
async function until(check: () => boolean, label = "condition") {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await Bun.sleep(1);
  if (!check()) throw new Error(`Timed out waiting for ${label}`);
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
  send: async (beforeSend: () => void) => { beforeSend(); return hash; },
});
afterEach(() => {
  for (const data of stores.splice(0)) data.dispose();
  for (const restore of restorers.splice(0).reverse()) restore();
});

describe("automatic transaction recovery", () => {
  test("a rogue wallet neither blocks unrelated writes nor live missions, polling, or focus recovery", async () => {
    const { events } = browser();
    const stream = new EventTarget();
    Object.assign(events, { EventSource: class {
      addEventListener = stream.addEventListener.bind(stream);
      close() {}
    } });
    let now = Date.now();
    let missions: string[] = [];
    const wallet = deferred<string>();
    const data = store({ now: () => now, transactionForegroundTimeoutMs: 50 });
    data.setContext("0xabc", "7", "0x2105");
    const key = data.queries.fleetVisibility("0xabc").key;
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => [...missions], { wallet: "0xabc" });
    const stop = data.connectChainEvents("0xabc", { debounceMs: 0 });
    const first = data.runWriteTransaction({ ...action(), send: beforeSend => { beforeSend(); return wallet.promise; } });
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase === "pending", "wallet prompt");
    await expect(data.runWriteTransaction({ ...action("0xship"), key: "ship:start" })).resolves.toMatchObject({ outcome: "indexed" });
    missions = ["new mission"];
    stream.dispatchEvent(new MessageEvent("chain-event", { data: JSON.stringify({ wallets: ["0xabc"], planetIds: ["7"] }) }));
    await until(() => data.snapshot<string[]>(key)?.data?.length === 1, "SSE mission update");
    missions = [];
    now += 20_000;
    (data as any).refreshGameplay();
    await until(() => data.snapshot<string[]>(key)?.data?.length === 0, "poll mission update");
    missions = ["another mission"];
    events.dispatchEvent(new Event("focus"));
    await until(() => data.snapshot<string[]>(key)?.data?.length === 1, "focus mission update");
    await expect(first).resolves.toMatchObject({ outcome: "unknown" });
    const state = data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "7"))?.data;
    expect(state?.phase).toBe("unknown");
    expect(transactionIsBusy(state)).toBe(false);
    wallet.resolve("0xlate");
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "7"))?.data?.phase === "success", "late hash completion");
    stop();
  });

  test("an uncertain retry requires consent and a late hash cannot overwrite the newer action", async () => {
    browser();
    const wallet = deferred<string>();
    const observed: string[] = [];
    const data = store({ transactionForegroundTimeoutMs: 5, transactionStatusReader: async hash => { observed.push(hash); return status(hash); } });
    const oldPhases: string[] = [];
    await expect(data.runWriteTransaction({ ...action(), send: beforeSend => { beforeSend(); return wallet.promise; }, onStateChange: state => oldPhases.push(state.phase) })).resolves.toMatchObject({ outcome: "unknown" });
    let sends = 0;
    const retry = { ...action("0xnext"), send: async () => { sends++; return "0xnext"; } };
    const key = data.writeTransactionKey("building:start:mine", "0xabc", "7");
    const beforeRetry = data.snapshot<WriteTransactionState>(key)?.data;
    await expect(data.runWriteTransaction(retry)).resolves.toMatchObject({ outcome: "unknown" });
    expect(sends).toBe(0);
    expect(data.snapshot<WriteTransactionState>(key)?.data).not.toBe(beforeRetry);
    expect(transactionIsBusy(data.snapshot<WriteTransactionState>(key)?.data)).toBe(false);
    await expect(data.runWriteTransaction({ ...retry, confirmRetry: () => true })).resolves.toMatchObject({ outcome: "indexed" });
    const oldPhaseCount = oldPhases.length;
    wallet.resolve("0xlate");
    await until(() => observed.includes("0xlate"));
    await Bun.sleep(2);
    expect(sends).toBe(1);
    expect(oldPhases.length).toBe(oldPhaseCount);
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey("group:building", "0xabc", "7"))?.data?.txHash).toBe("0xnext");
  });

  test("expired preparation cannot ask the wallet to send later", async () => {
    browser();
    const prepare = deferred<void>();
    const data = store({ transactionForegroundTimeoutMs: 5 });
    let sends = 0;
    await expect(data.runWriteTransaction({ ...action(), prepare: () => prepare.promise, send: async beforeSend => { beforeSend(); sends++; return "0xlate"; } })).resolves.toMatchObject({ outcome: "not-submitted" });
    prepare.resolve();
    await Bun.sleep(2);
    expect(sends).toBe(0);
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
  });

  test("failed inventory preparation refreshes its scope without sending or blocking the next action", async () => {
    browser();
    const data = store();
    let refreshed = 0;
    let sent = 0;
    const result = await data.runWriteTransaction({ ...action(),
      prepare: async () => { throw new Error("Need 2 ships, only 0 available"); },
      onErrorRefresh: async () => { refreshed++; },
      send: async () => { sent++; return "0xunexpected"; },
    });
    expect(result.outcome).toBe("not-submitted");
    await until(() => refreshed === 1);
    expect(sent).toBe(0);
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
  });

  test("a late settlement hash still completes referral bookkeeping after the UI returns", async () => {
    browser();
    const wallet = deferred<string>();
    const writes: unknown[] = [];
    globalValue("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://recovery.test/referrals/redeem-transaction");
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ recorded: true });
    });
    const data = store({ transactionForegroundTimeoutMs: 5 });
    await expect(data.runWriteTransaction({ ...action(), key: "settlement:first-planet",
      indexing: data.indexing.settledPlanet("0xabc", () => "refcode"),
      send: beforeSend => { beforeSend(); return wallet.promise; },
    })).resolves.toMatchObject({ outcome: "unknown" });
    expect(writes).toEqual([]);
    wallet.resolve("0xlate");
    await until(() => writes.length === 1);
    expect(writes).toEqual([{ code: "refcode", invitee: "0xabc", txHash: "0xlate" }]);
  });

  test("background tracking returns the hash without waiting for indexing", async () => {
    browser();
    const indexed = deferred<ReturnType<typeof status>>();
    const data = store({ transactionStatusReader: hash => hash === "0xfirst" ? indexed.promise : Promise.resolve(status(hash)) });
    await expect(data.runWriteTransaction({ ...action("0xfirst"), waitForIndexing: false })).resolves.toMatchObject({ outcome: "submitted", txHash: "0xfirst" });
    expect(transactionIsBusy(data.pendingTransactionState("0xabc", "7"))).toBe(false);
    await expect(data.runWriteTransaction(action("0xduplicate"))).resolves.toMatchObject({ outcome: "not-submitted" });
    await expect(data.runWriteTransaction({ ...action("0xother"), key: "ship:start" })).resolves.toMatchObject({ outcome: "indexed" });
    indexed.resolve(status("0xfirst"));
    await until(() => !data.isTransactionPending("0xabc"));
  });

  test("send transport failure is uncertain, but explicit wallet rejection is terminal", async () => {
    browser();
    const data = store();
    await expect(data.runWriteTransaction({ ...action(), send: async beforeSend => { beforeSend(); throw new Error("Provider disconnected"); } })).resolves.toMatchObject({ outcome: "unknown" });
    await expect(data.runWriteTransaction({ ...action(), confirmRetry: () => true, send: async beforeSend => { beforeSend(); throw Object.assign(new Error("User rejected"), { code: 4001 }); } })).resolves.toMatchObject({ outcome: "not-submitted" });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
  });

  test("permanent API errors pause until recovery without losing or resubmitting the hash", async () => {
    const { events } = browser();
    let reads = 0, sends = 0;
    const data = store({ transactionStatusReader: async hash => {
      if (++reads === 1) throw new GameApiError("Unauthorized", { status: 401 });
      return status(hash);
    } });
    const pending = data.runWriteTransaction({ ...action(), send: async () => { sends++; return "0xnew"; } });
    await until(() => reads === 1);
    await Bun.sleep(5);
    expect(reads).toBe(1);
    expect(data.isTransactionPending("0xabc")).toBe(true);
    expect(data.pendingTransactionState("0xabc", "7")?.phase).toBe("confirming");
    events.dispatchEvent(new Event("pageshow"));
    await expect(pending).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnew" });
    expect(sends).toBe(1);
  });

  test("rate-limited transaction observation respects Retry-After", async () => {
    browser();
    let reads = 0;
    const started = Date.now();
    const data = store({ transactionStatusReader: async hash => {
      if (++reads === 1) throw new GameApiError("Busy", { status: 429, retryAfter: "0.03" });
      return status(hash);
    } });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
    expect(reads).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
  test("applied transactions release conflicts and refresh while auxiliary saves retry without receipt checks", async () => {
    browser();
    let statusReads = 0;
    let saveAttempts = 0;
    let reads = 0;
    const saved = deferred<Response>();
    globalValue("fetch", async () => ++saveAttempts === 1 ? new Response("unavailable", { status: 503 }) : saved.promise);
    const data = store({ transactionStatusReader: async hash => { statusReads++; return status(hash); } });
    const query = data.queries.alliance("0xabc");
    data.subscribeKey(query.key, () => {});
    await data.refresh(query.key, async () => ({ revision: ++reads }), { wallet: "0xabc" });
    let complete = false;
    const first = data.runWriteTransaction({ ...action(), indexing: data.indexing.paidAllianceInvite("0xabc", {
      request: async <T>() => "0xsignature" as T,
    }, "0x" + "ab".repeat(32)) }).then(result => { complete = true; return result; });
    await until(() => saveAttempts === 2 && reads === 2);
    expect(statusReads).toBe(1);
    expect(complete).toBe(false); // Do not claim auxiliary setup succeeded.
    expect(data.isTransactionPending("0xabc")).toBe(false);
    expect(data.pendingTransactionState("0xabc", "7")).toBeUndefined();
    await expect(data.runWriteTransaction(action("0xnext"))).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnext" });
    expect(statusReads).toBe(2);
    saved.resolve(Response.json({ stored: true }));
    await expect(first).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnew" });
    expect(statusReads).toBe(2);
    expect(data.snapshot<any>(data.writeTransactionKey("building:start:mine", "0xabc", "7"))?.data?.txHash).toBe("0xnext");
  });

  test("mission completion waits for backend application and refreshes subscribed mission queries", async () => {
    browser();
    let applied = false;
    let checks = 0;
    const data = store({ transactionStatusReader: async hash => { checks++; return status(hash, applied ? "applied" : "confirmed"); } });
    data.setContext("0xabc", "7", "0x2105");
    const queries = [data.queries.globalActiveMissions(), data.queries.fleetVisibility("0xabc")];
    const reads = [0, 0];
    for (const [i, query] of queries.entries()) {
      data.subscribeKey(query.key, () => {});
      await data.refresh(query.key, async () => ({ revision: ++reads[i]! }), { wallet: "0xabc" });
    }
    let finished = false;
    const pending = data.runWriteTransaction({ ...action(), indexing: data.indexing.missionLaunch("0xabc") }).then(result => { finished = true; return result; });
    await until(() => checks > 0);
    expect(finished).toBe(false);
    expect(reads).toEqual([1, 1]);
    applied = true;
    await expect(pending).resolves.toMatchObject({ outcome: "indexed" });
    expect(reads).toEqual([2, 2]);
  });

  test("a dirty in-flight query finishing while hidden waits for foreground recovery", async () => {
    const { document, events } = browser();
    const data = store();
    data.setContext("0xabc", "7");
    const key = data.queries.infrastructure("0xabc", "7").key;
    data.subscribeKey(key, () => {});
    const first = deferred<number>();
    let reads = 0;
    const request = data.refresh(key, async () => ++reads === 1 ? first.promise : reads, { wallet: "0xabc", planetId: "7" });
    await until(() => reads === 1);
    await data.invalidate(["planet:7"]);
    document.visibilityState = "hidden";
    first.resolve(1);
    await request;
    await Bun.sleep(2);
    expect(reads).toBe(1);
    document.visibilityState = "visible";
    events.dispatchEvent(new Event("pageshow"));
    await until(() => reads === 2);
  });

  test("a fresh session ignores old stored locks and can submit again", async () => {
    const { values } = browser([saved()]);
    const hashes: string[] = [];
    const data = store({ transactionStatusReader: async hash => { hashes.push(hash); return status(hash); } });
    data.setContext("0xabc", "7", "0x2105");
    expect(data.isTransactionPending("0xabc")).toBe(false);
    expect(values.has(journalKey)).toBe(false);
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
    expect(hashes).toEqual(["0xnew"]);
  });
  test("wallet-only completion leaves planet reads alone", async () => {
    browser();
    const data = store();
    const loads = { wallet: 0, planet: 0 };
    for (const scope of ["wallet", "planet"] as const) {
      const planetId = scope === "planet" ? "7" : undefined;
      const key = data.key(scope, "0xabc", planetId);
      data.subscribeKey(key, () => {});
      await data.refresh(key, async () => ++loads[scope], { wallet: "0xabc", planetId });
    }
    await data.runWriteTransaction({ ...action(), planetIds: [], conflictKeys: ["alliance"] });
    expect(loads).toEqual({ wallet: 2, planet: 1 });
  });
  test("ten submitted hashes begin observation independently", async () => {
    browser();
    const ready = deferred<void>();
    let reads = 0;
    const data = store({ transactionStatusReader: async hash => { reads++; await ready.promise; return status(hash); } });
    const writes: Promise<unknown>[] = [];
    for (let index = 0; index < 10; index++) {
      writes.push(data.runWriteTransaction(action("0xtx" + index, String(index))));
      await until(() => reads === index + 1);
    }
    ready.resolve();
    await Promise.all(writes);
    expect(reads).toBe(10);
  });
  test("a response for another hash cannot complete this transaction", async () => {
    browser();
    let reads = 0;
    const data = store({ transactionStatusReader: async (hash) => status(++reads === 1 ? "0xwrong" : hash) });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnew" });
    expect(reads).toBe(2);
  });

  test("disposal aborts a real status transport without persisting a lock", async () => {
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
    expect(values.has(journalKey)).toBe(false);
  });

  test("preparation guards only duplicate actions and rejection never creates a journal", async () => {
    const { values } = browser();
    const prepared = deferred<void>();
    let sends = 0;
    const data = store();
    const first = data.runWriteTransaction({ ...action(), prepare: () => prepared.promise, send: async () => { throw new Error("Wallet request rejected"); } });
    await expect(data.runWriteTransaction({ ...action(), send: async () => { sends++; return "0xduplicate"; } })).resolves.toMatchObject({ outcome: "not-submitted" });
    await expect(data.runWriteTransaction({ ...action("0xother", "8"), send: async () => { sends++; return "0xother"; } })).resolves.toMatchObject({ outcome: "indexed" });
    prepared.resolve();
    await expect(first).resolves.toMatchObject({ outcome: "not-submitted" });
    expect(values.has(journalKey)).toBe(false);
    expect(sends).toBe(1);
    expect(data.isTransactionPending("0xabc")).toBe(false);
  });

  test("invite authorization precedes submission and retries in-session without wallet prompts", async () => {
    browser();
    const steps: string[] = [];
    const secret = "0x" + "ab".repeat(32);
    let attempts = 0;
    globalValue("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://recovery.test/alliance-invites/store");
      expect(JSON.parse(String(init?.body))).toEqual({ purchaser: "0xabc", secret, signature: "0xsignature" });
      return ++attempts === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ stored: true });
    });
    const data = store();
    await data.runWriteTransaction({
      ...action(),
      indexing: data.indexing.paidAllianceInvite("0xabc", { request: async <T>() => { steps.push("authorize"); return "0xsignature" as T; } }, secret),
      send: async () => { steps.push("send"); return "0xnew"; },
    });
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
    const key = data.queries.alliance("0xabc").key;
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => ({ membership: null }), { wallet: "0xabc" });
    // Install the real loader without consuming the intentional failing read.
    (data as any).resources.get(key).load = async () => {
      const response = await fetch("https://recovery.test/wallet/0xabc/alliance");
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    };
    await expect(data.runWriteTransaction({ ...action(), indexing: data.indexing.paidAllianceInvite("0xabc", {
      request: async <T>() => { signatures++; return "0xsignature" as T; },
    }, "0x" + "ab".repeat(32)) })).resolves.toMatchObject({ outcome: "indexed" });
    expect(signatures).toBe(1);
    expect(writes).toBe(1);
    expect(reads).toBe(2);
  });

  test("tracks the hash in-session and releases the lock before an applied refresh finishes", async () => {
    const { values } = browser();
    const refresh = deferred<{ revision: number }>();
    let loads = 0;
    const data = store({ transactionStatusReader: async (hash) => {
      expect(data.pendingTransactionState("0xabc", "7")?.txHash).toBe(hash);
      return status(hash);
    } });
    const key = data.key("infrastructure", "0xabc", "7");
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => ++loads === 1 ? { revision: 1 } : refresh.promise, { wallet: "0xabc", planetId: "7" });
    const write = data.runWriteTransaction(action());
    await until(() => loads === 2);
    expect(data.isTransactionPending("0xabc")).toBe(false);
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase).toBe("success");
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
    await expect(data.runWriteTransaction({ ...action(), key: "ship:start", send: async () => { conflictingSends++; return "0xship"; } })).resolves.toMatchObject({ outcome: "indexed" });
    expect(conflictingSends).toBe(1);
    await expect(data.runWriteTransaction(action("0xsecond", "8"))).resolves.toMatchObject({ outcome: "indexed", txHash: "0xsecond" });
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "7"))?.data?.txHash).toBe("0xfirst");
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey("building:start:mine", "0xabc", "8"))?.data?.txHash).toBe("0xsecond");
    receipt.resolve(status("0xfirst"));
    await first;
  });

  test("temporary status errors retry in-session without claiming submission failed", async () => {
    browser();
    let reads = 0;
    const phases: string[] = [];
    const data = store({ transactionStatusReader: async hash => {
      if (++reads < 3) throw new Error("temporarily unavailable");
      return status(hash, reads === 3 ? "confirmed" : "applied");
    } });
    await data.runWriteTransaction({ ...action(), onStateChange: state => phases.push(state.phase) });
    expect(reads).toBe(4);
    expect(phases).not.toContain("error");
    expect(phases.at(-1)).toBe("success");
  });
  test("reload starts without pending UI or automatic resubmission", async () => {
    const { values } = browser();
    const first = store({ transactionStatusReader: async hash => status(hash, "submitted") });
    let sends = 0;
    const pending = first.runWriteTransaction({ ...action(), send: async () => { sends++; return "0xnew"; } });
    await until(() => first.isTransactionPending("0xabc") && first.pendingTransactionState("0xabc", "7")?.phase === "confirming");
    first.dispose();
    await expect(pending).resolves.toMatchObject({ outcome: "submitted", txHash: "0xnew" });
    expect(values.has(journalKey)).toBe(false);
    const next = store();
    next.setContext("0xabc", "7", "0x2105");
    expect(next.isTransactionPending("0xabc")).toBe(false);
    expect(next.pendingTransactionState("0xabc", "7")).toBeUndefined();
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

  test("applied releases the lock even if a refresh fails, allowing the next transaction", async () => {
    browser();
    const data = store();
    const key = data.key("shipyard", "0xabc", "7");
    let loads = 0;
    data.subscribeKey(key, () => {});
    await data.refresh(key, async () => {
      if (++loads > 1) throw new Error("read unavailable");
      return { revision: 1 };
    }, { wallet: "0xabc", planetId: "7" });
    await expect(data.runWriteTransaction(action())).resolves.toMatchObject({ outcome: "indexed" });
    expect(data.isTransactionPending("0xabc")).toBe(false);
    expect(data.snapshot(key)?.data).toEqual({ revision: 1 });
    expect(data.snapshot(key)?.freshness).toBe("delayed");
    expect(data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase).toBe("success");
    let sends = 0;
    await expect(data.runWriteTransaction({ ...action("0xnext"), send: async () => { sends++; return "0xnext"; } })).resolves.toMatchObject({ outcome: "indexed", txHash: "0xnext" });
    expect(sends).toBe(1);
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
    await until(() => data.snapshot<WriteTransactionState>(data.writeTransactionKey(undefined, "0xabc"))?.data?.phase === "success");
    old.resolve({ revision: 2 });
    await staleRead;
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
    expect(data.snapshot(key)?.data).toEqual({ revision: 3 });
  });

  test("in-session hidden recovery pauses and resumes on foreground", async () => {
    const { document, events } = browser();
    const receipt = deferred<ReturnType<typeof status>>();
    let reads = 0;
    const data = store({ transactionStatusReader: async hash => ++reads === 1 ? receipt.promise : status(hash) });
    const write = data.runWriteTransaction(action());
    await until(() => reads === 1);
    document.visibilityState = "hidden";
    receipt.resolve(status("0xnew"));
    await Bun.sleep(5);
    expect(data.isTransactionPending("0xabc")).toBe(true);
    expect(reads).toBe(1);
    document.visibilityState = "visible";
    events.dispatchEvent(new Event("pageshow"));
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
    expect(reads).toBe(2);
  });
  test("wallet switching pauses in-session recovery without exposing or deleting it", async () => {
    browser();
    const receipt = deferred<ReturnType<typeof status>>();
    let reads = 0;
    const data = store({ transactionStatusReader: async () => { reads++; return receipt.promise; } });
    data.setContext("0xabc", "7", "0x2105");
    const write = data.runWriteTransaction(action());
    await until(() => reads === 1);
    data.setContext("0xdef", "8", "0x2105");
    receipt.resolve(status("0xnew"));
    await Bun.sleep(5);
    expect(data.isTransactionPending("0xabc")).toBe(true);
    expect(data.snapshot(data.writeTransactionKey(undefined, "0xabc"))).toBeUndefined();
    expect(data.isTransactionPending("0xdef", ["planet:7"])).toBe(false);
    data.setContext("0xabc", "7", "0x2105");
    await expect(write).resolves.toMatchObject({ outcome: "indexed" });
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
