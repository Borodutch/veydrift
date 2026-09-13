import { describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ChainSyncService } from "./chainSync";
import type { BackendConfig } from "./config";
import { type Address, type RpcLog, VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";
import { SharedResponseCache } from "./sharedResponseCache";

const defender = "0x14074a4dc440230523a9fb7a0ce6934a6118e7c6" as Address;
const attacker = "0x000000000000000000000000000000000000dead" as Address;
const keeper = "0xec336742a19a9d0d046a83603491e4ae08329788" as Address;
const now = 1_789_308_913;
const afk = now - 8 * 86400;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const topic = (value: bigint) => `0x${word(value)}`;
const data = (...values: bigint[]) => `0x${values.map(word).join("")}`;
const config: BackendConfig = {
  chainId: 84532, deploymentMode: "test", qaSyntheticStationedDefenders: false,
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:", randomnessCommitmentStorePath: ".data/test-randomness.json",
  indexFromBlock: 100n, missionResolutionEnabled: false, resourceTokenAddresses: {},
  rpcSource: "custom-url", rpcUrl: "https://example.invalid/rpc", wsRpcSource: "missing"
};
const started: RpcLog = {
  address: config.gameContractAddress!, blockNumber: "0x64", transactionHash: "0xstart", logIndex: "0x0",
  topics: ["0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3", `0x${defender.slice(2).padStart(64, "0")}`, topic(295n)],
  data: data(5n, 200n, 13n, 211n, 1n)
};
const passive = (eventTopic: string, values: bigint[], index: number): RpcLog => ({
  address: config.gameContractAddress!, blockNumber: "0xc8", blockTimestamp: topic(BigInt(now)),
  transactionHash: "0xkeeper", logIndex: topic(BigInt(index)),
  topics: [eventTopic, topic(295n), topic(0n)], data: data(...values)
});

function fixture() {
  const database = new Database(":memory:");
  let active = afk;
  let fail = false;
  const reads: string[][] = [];
  const senders = new Map<string, Address>([["0xkeeper", keeper], ["0xattacker", attacker]]);
  const reader = {
    async listDebrisFieldEvents() { return []; },
    async listMoonChanceReportEvents() { return []; },
    async listSettledPlanetEvents() { return []; },
    async getTransactionActivity(logs: readonly RpcLog[]) {
      const hashes = [...new Set(logs.map(log => log.transactionHash.toLowerCase()))];
      reads.push(hashes);
      if (fail) throw new Error("activity RPC unavailable");
      return new Map(hashes.map(hash => [hash, { sender: senders.get(hash) ?? defender, timestamp: active }]));
    }
  };
  const indexer = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
  return {
    database, indexer, reader, reads,
    setActive: (value: number) => { active = value; },
    setFail: (value: boolean) => { fail = value; },
    setSender: (hash: string, sender: Address) => { senders.set(hash.toLowerCase(), sender); }
  };
}

describe("VEY-KANEO-869 actor-attributed activity", () => {
  test("ignores polluted legacy activity; keeper/attacker effects never refresh the defender, while owner actions do", async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    f.indexer.applyLog({
      ...passive("0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456", [], 336),
      topics: ["0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456", topic(84071n), `0x${defender.slice(2).padStart(64, "0")}`, topic(1n)],
      data: data(295n, 716n, BigInt(afk), BigInt(afk + 100), BigInt(afk + 200))
    });
    f.database.query("INSERT INTO indexed_player_activity VALUES (?, ?, ?)").run(defender, String(now), "0xkeeper:0x151");
    // Historical event attribution is not trusted even before the first successful repair.
    expect(f.indexer.playerLastActiveSeconds([defender]).has(defender)).toBe(false);
    const version = f.indexer.indexedStateCacheVersion();
    const repair = await f.indexer.preparePlayerActivitySnapshot(200n, [started]);
    expect(f.database.query("SELECT last_active_at FROM indexed_player_activity").get()).toEqual({ last_active_at: String(now) });
    f.indexer.commitLogBatch(repair!);
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    expect(f.indexer.indexedStateCacheVersion()).not.toBe(version);
    const passiveLogs = [
      passive("0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077", [5000n, 4000n, 3000n, BigInt(now)], 337),
      { ...passive("0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", [10n], 338), transactionHash: "0xattacker" },
      passive("0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf", [10n], 339),
      passive("0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6", [2n, 2n], 340),
      // A fleet return is just as passive for its owner as defender-side combat settlement.
      { ...passive("0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06", [], 341),
        topics: ["0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06", topic(84071n), `0x${defender.slice(2).padStart(64, "0")}`, topic(295n)] }
    ];
    f.setActive(now);
    for (const log of passiveLogs) {
      f.indexer.applyLog(log);
      f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(201n, [log]))!);
      expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    }
    const ownerAction = { ...started, blockNumber: "0xc9", transactionHash: "0xowner", logIndex: "0x1" };
    f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(202n, [ownerAction]))!);
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(now);
    f.database.close();
  });

  test("actor activity immediately invalidates cached Rankings/Raid Finder protection without per-target RPC", async () => {
    const f = fixture();
    await f.indexer.rebuild();
    f.indexer.applyLog(started);
    f.indexer.applyLog({ ...started, transactionHash: "0xattacker-start", logIndex: "0x1",
      topics: [started.topics[0]!, `0x${attacker.slice(2).padStart(64, "0")}`, topic(296n)],
      data: data(5n, 200n, 14n, 211n, 1n)
    });
    f.indexer.applyLog({ ...passive("0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", [350_000n], 341),
      topics: ["0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", topic(296n), topic(0n)]
    });
    const canonical = new VeydriftGameReader(config, { async request<T>(): Promise<T> { throw new Error("List reads must not call RPC"); } });
    const handler = createRequestHandler({ role: "reader", config, indexer: f.indexer, chainReader: canonical,
      enableResponseCache: true, sharedResponseCache: null, prewarmResponseCache: false });
    const request = () => new Request(`http://localhost/highscores?currentWallet=${attacker}&includeAttackProtection=true&limit=10`);
    const before = await (await handler(request())).json();
    expect(before.rankings.total.find((row: { wallet: string }) => row.wallet === defender).attackProtection)
      .toMatchObject({ allowed: false, blockedReason: "score_protection", defenderInactive: false });
    f.setActive(Math.floor(Date.now() / 1000) - 8 * 86400);
    f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(201n, [started]))!);
    // Same request, no clock advance and no fresh=1 escape: the committed actor row invalidates cache.
    const after = await (await handler(request())).json();
    expect(after.rankings.total.find((row: { wallet: string }) => row.wallet === defender).attackProtection)
      .toMatchObject({ allowed: true, blockedReason: "none", defenderInactive: true });
    f.database.close();
  });

  for (const cacheAgeMs of [0, 1_001]) for (const shared of [false, true]) {
    test(`AFK boundary invalidates ${shared ? "shared" : "local"} ${cacheAgeMs ? "stale" : "fresh"} protection immediately`, async () => {
      setSystemTime(new Date(now * 1000));
      const f = fixture();
      try {
        await f.indexer.rebuild();
        f.indexer.applyLog(started);
        f.indexer.applyLog({ ...started, transactionHash: "0xattacker-start", logIndex: "0x1",
          topics: [started.topics[0]!, `0x${attacker.slice(2).padStart(64, "0")}`, topic(296n)],
          data: data(5n, 200n, 14n, 211n, 1n)
        });
        f.indexer.applyLog({ ...passive("0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", [350_000n], 341),
          topics: ["0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", topic(296n), topic(0n)]
        });
        f.setActive(now - 7 * 86400 + 1);
        f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(200n, [started]))!);
        expect(f.indexer.recordResourceProjectionWatermark("200", String(now), topic(200n))).toBe(true);
        const version = f.indexer.indexedStateCacheVersion();
        const canonical = new VeydriftGameReader(config, { async request<T>(): Promise<T> { throw new Error("List reads must not call RPC"); } });
        const sharedResponseCache = shared ? new SharedResponseCache(":memory:") : null;
        const makeHandler = () => createRequestHandler({ role: "reader", config, indexer: f.indexer, chainReader: canonical,
          enableResponseCache: true, sharedResponseCache, prewarmResponseCache: false });
        const handler = makeHandler();
        const request = () => new Request(`http://localhost/highscores?currentWallet=${attacker}&includeAttackProtection=true&limit=10`);
        const protection = async (read: typeof handler) => {
          const response = await read(request());
          expect(response.status).toBe(200);
          const body = await response.json();
          return body.rankings.total.find((row: { wallet: string }) => row.wallet === defender).attackProtection;
        };
        expect(await protection(handler)).toMatchObject({ allowed: false, blockedReason: "score_protection", defenderInactive: false });
        // The activity values do not change; only the verified chain clock crosses seven days.
        expect(f.indexer.recordResourceProjectionWatermark("201", String(now + 1), topic(201n))).toBe(true);
        expect(f.indexer.indexedStateCacheVersion()).toBe(version);
        setSystemTime(new Date(now * 1000 + cacheAgeMs));
        // A new handler has no local entries, forcing the shared-cache path in that variant.
        // No fresh=1, no activity repair/version bump, no 300-second stale-window wait.
        expect(await protection(shared ? makeHandler() : handler))
          .toMatchObject({ allowed: true, blockedReason: "none", defenderInactive: true });
      } finally {
        f.database.close();
        setSystemTime();
      }
    });
  }

  test("failed or incomplete sampling is observable and cannot overwrite actor rows", async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(200n, [started]))!);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    try {
      f.setFail(true);
      expect(await f.indexer.preparePlayerActivitySnapshot(201n, [started])).toBeUndefined();
      expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
      f.setFail(false);
      f.reader.getTransactionActivity = async () => new Map();
      expect(await f.indexer.preparePlayerActivitySnapshot(202n, [started])).toBeUndefined();
      expect(warnings.some(line => line.includes('"status":"skipped"') && line.includes("activity RPC unavailable"))).toBe(true);
      expect(warnings.some(line => line.includes("Incomplete transaction activity snapshot"))).toBe(true);
      expect(f.database.query("SELECT value FROM indexer_metadata WHERE key = 'actorPlayerActivityBlock'").get()).toEqual({ value: "200" });
    } finally {
      console.warn = originalWarn;
      f.database.close();
    }
  });

  test("HTTP polling publishes logs and watermark when activity sampling fails, then refreshes owner activity", async () => {
    const f = fixture();
    const pollConfig = {
      ...config,
      referralSystemAddress: "0x4444444444444444444444444444444444444444" as Address,
      referralIndexFromBlock: 100n
    };
    let head = 200n;
    let logs = [started];
    let referralBackfills = 0;
    const sync = new ChainSyncService(pollConfig, f.indexer, { logBackfiller: {
      async getHeadBlock() { return head; },
      async getBlockProjectionAnchor(block) { return { hash: topic(block), timestamp: String(now) }; },
      async listContractLogs() { return logs; },
      async listReferralLogs() { referralBackfills++; return []; }
    } });
    f.setFail(true);
    await sync.poll();
    expect(f.indexer.planet("295")?.owner).toBe(defender);
    expect(f.indexer.snapshot().resourceProjectionBlock).toBe("200");
    expect(sync.snapshot()).toMatchObject({
      lastError: null,
      latestSyncedBlock: "200",
      pollFailureCount: 0,
      referralHistoryBackfill: { throughBlock: "200" }
    });
    expect(referralBackfills).toBe(1);
    expect(f.indexer.playerLastActiveSeconds([defender]).has(defender)).toBe(false);
    f.setFail(false);
    await sync.poll();
    expect(f.reads.at(-1)).toEqual(["0xstart"]);
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    head++;
    f.setActive(now);
    logs = [{ ...started, blockNumber: "0xc9", transactionHash: "0xowner", logIndex: "0x1" }];
    await sync.poll();
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(now);
    await sync.stop();
    f.database.close();
  });

  test("an unexpected activity preparation rejection cannot stall poll publication", async () => {
    const f = fixture();
    f.indexer.preparePlayerActivitySnapshot = async () => { throw new Error("RPC 3: execution reverted"); };
    const sync = new ChainSyncService(config, f.indexer, { logBackfiller: {
      async getHeadBlock() { return 200n; },
      async getBlockProjectionAnchor(block) { return { hash: topic(block), timestamp: String(now) }; },
      async listContractLogs() { return [started]; }
    } });
    await sync.poll();
    expect(f.indexer.planet("295")?.owner).toBe(defender);
    expect(f.indexer.snapshot().resourceProjectionBlock).toBe("200");
    expect(sync.snapshot()).toMatchObject({ lastError: null, latestSyncedBlock: "200", pollFailureCount: 0 });
    expect(f.indexer.playerLastActiveSeconds([defender]).has(defender)).toBe(false);
    await sync.stop();
    f.database.close();
  });

  test("removing the attributed action retires its timestamp instead of trusting reorged activity", async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    f.indexer.commitLogBatch((await f.indexer.preparePlayerActivitySnapshot(200n, [started]))!);
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    const version = f.indexer.indexedStateCacheVersion();
    f.indexer.applyLog({ ...started, removed: true });
    expect(f.indexer.playerLastActiveSeconds([defender]).has(defender)).toBe(false);
    expect(f.indexer.indexedStateCacheVersion()).not.toBe(version);
    f.database.close();
  });

  test("transaction enrichment rejects a block hash inconsistent with the log", async () => {
    const reader = new VeydriftGameReader(config, { async request<T>() {
      return { hash: topic(201n), timestamp: topic(BigInt(now)), transactions: [{ hash: started.transactionHash, from: defender }] } as T;
    } });
    await expect(reader.getTransactionActivity([{ ...started, blockHash: topic(200n) }])).rejects.toThrow("block hash changed");
  });

  test("head changes discard staged activity without publishing the repair", async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    let anchorReads = 0;
    const sync = new ChainSyncService(config, f.indexer, { logBackfiller: {
      async getHeadBlock() { return 200n; },
      async getBlockProjectionAnchor() { return { hash: topic(BigInt(++anchorReads)), timestamp: String(now) }; },
      async listContractLogs() { return [started]; }
    } });
    await sync.poll();
    expect(sync.snapshot().lastError).toContain("head changed");
    expect(f.indexer.playerLastActiveSeconds([defender]).has(defender)).toBe(false);
    await sync.stop();
    f.database.close();
  });

  for (const batch of [true, false]) test(`transaction activity reads sender and block timestamp (${batch ? "batch" : "sequential"})`, async () => {
    const hash = `0x${"ab".repeat(32)}`;
    const log = { ...started, blockNumber: "0xc8", transactionHash: hash };
    const check = (method: string, params: unknown[]) => {
      expect(method).toBe("eth_getBlockByNumber");
      expect(params).toEqual(["0xc8", true]);
      return { hash: topic(200n), timestamp: topic(BigInt(afk)), transactions: [{ hash, from: defender }] };
    };
    const reader = new VeydriftGameReader(config, {
      async request<T>(method: string, params: unknown[]) { return check(method, params) as T; },
      ...(batch ? { async requestBatch<T>(calls: { method: string; params: unknown[] }[]) {
        return calls.map(call => check(call.method, call.params) as T);
      } } : {})
    });
    expect(await reader.getTransactionActivity([log, log])).toEqual(new Map([[hash, { sender: defender, timestamp: afk }]]));
  });

  test("large transaction samples keep every RPC batch bounded", async () => {
    const sizes: number[] = [];
    const hashByBlock = new Map<string, string>();
    const reader = new VeydriftGameReader(config, {
      async request<T>(): Promise<T> { throw new Error("Expected batches"); },
      async requestBatch<T>(calls: { method: string; params: unknown[] }[]) {
        sizes.push(calls.length);
        return calls.map(call => ({
          hash: topic(BigInt(call.params[0] as string)),
          timestamp: topic(BigInt(afk)),
          transactions: [{ hash: hashByBlock.get(call.params[0] as string), from: defender }]
        }) as T);
      }
    });
    const logs = Array.from({ length: 121 }, (_, i) => ({
      ...started,
      blockNumber: `0x${(200 + i).toString(16)}`,
      transactionHash: `0x${(i + 1).toString(16).padStart(64, "0")}`
    }));
    for (const log of logs) hashByBlock.set(log.blockNumber, log.transactionHash);
    expect((await reader.getTransactionActivity(logs)).size).toBe(121);
    expect(sizes).toEqual([50, 50, 21]);
  });

  for (const [label, block] of [
    ["missing transaction", { timestamp: "0xc8", transactions: [] }],
    ["invalid sender", { timestamp: "0xc8", transactions: [{ hash: "0xstart", from: "0x1234" }] }],
    ["invalid timestamp", { timestamp: "invalid", transactions: [{ hash: "0xstart", from: defender }] }]
  ] as const) test(`rejects ${label} activity without inventing a value`, async () => {
    const reader = new VeydriftGameReader(config, { async request<T>() {
      return block as T;
    } });
    await expect(reader.getTransactionActivity([{ ...started, blockNumber: "0xc8" }])).rejects.toThrow("activity");
  });
  for (const [label, reason, flags, expectedReason, inactive, honor] of [
    ["inactive planet 295", 0, 0x11, "none", true, "neutral"],
    ["active low score", 2, 2, "score_protection", false, "neutral"],
    ["inactive same alliance", 3, 0x14, "same_alliance", true, "honorable"],
    ["active bashing", 1, 0, "bashing_limit", false, "neutral"],
    ["eligible war/exemption", 0, 4, "none", false, "honorable"],
    ["bandit", 0, 8, "none", false, "bandit"]
  ] as const) test(`API preserves canonical ${label} despite polluted indexed activity`, async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    f.database.query("INSERT INTO indexed_player_activity VALUES (?, ?, ?)").run(defender, String(now), "0xkeeper:0x151");
    let calls = 0;
    const canonical = new VeydriftGameReader(config, { async request<T>(method: string, params: unknown[]) {
      calls++;
      expect(method).toBe("eth_call");
      expect((params[0] as { data: string }).data).toBe(`0x8a6b2246${attacker.slice(2).padStart(64, "0")}${word(295n)}`);
      return data(BigInt(reason), BigInt(flags), 5000n) as T;
    } });
    const handler = createRequestHandler({ role: "reader", config, indexer: f.indexer, chainReader: canonical });
    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=295`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      allowed: reason === 0, blockedReason: expectedReason, defenderInactive: inactive,
      defenderHonorStatus: honor, plunderBps: 5000
    });
    expect(calls).toBe(1);
    f.database.close();
  });

  for (const value of ["0x", data(0n), data(4n, 0n, 5000n)]) test(`malformed protection cannot allow an attack: ${value}`, async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    const canonical = new VeydriftGameReader(config, { async request<T>() { return value as T; } });
    const response = await createRequestHandler({ role: "reader", config, indexer: f.indexer, chainReader: canonical })(
      new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=295`)
    );
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("allowed");
    f.database.close();
  });

});
