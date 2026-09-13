import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { toFunctionSelector } from "viem";
import { ChainSyncService } from "./chainSync";
import type { BackendConfig } from "./config";
import { type Address, type RpcLog, VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";

const defender = "0x14074a4dc440230523a9fb7a0ce6934a6118e7c6" as Address;
const attacker = "0x000000000000000000000000000000000000dead" as Address;
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
  const reads: { wallets: readonly Address[]; block: bigint }[] = [];
  const reader = {
    async listDebrisFieldEvents() { return []; },
    async listMoonChanceReportEvents() { return []; },
    async listSettledPlanetEvents() { return []; },
    async getPlayerLastActiveAt(wallets: readonly Address[], block: bigint) {
      reads.push({ wallets, block });
      if (fail) throw new Error("activity RPC unavailable");
      return new Map(wallets.map(wallet => [wallet, active]));
    }
  };
  const indexer = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
  return { database, indexer, reader, reads, setActive: (value: number) => { active = value; }, setFail: (value: boolean) => { fail = value; } };
}

describe("VEY-KANEO-869 canonical activity", () => {
  test("repairs a polluted planet-295 owner row downward; passive settlement/count/mission logs never refresh it", async () => {
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
    const repair = await f.indexer.preparePlayerActivitySnapshot(200n, []);
    expect(f.database.query("SELECT last_active_at FROM indexed_player_activity").get()).toEqual({ last_active_at: String(now) });
    f.indexer.commitLogBatch(repair);
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    expect(f.indexer.indexedStateCacheVersion()).not.toBe(version);
    for (const log of [
      passive("0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077", [5000n, 4000n, 3000n, BigInt(now)], 337),
      passive("0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3", [10n], 338),
      passive("0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf", [10n], 339),
      // A fleet return is just as passive for its owner as defender-side combat settlement.
      { ...passive("0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06", [], 340),
        topics: ["0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06", topic(84071n), `0x${defender.slice(2).padStart(64, "0")}`, topic(295n)] }
    ]) {
      f.indexer.applyLog(log);
      expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    }
    (await f.indexer.preparePlayerActivitySnapshot(201n, []))();
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    // Genuine owner _touchPlayer, even with no emitted log, is picked up by the next snapshot.
    f.setActive(now);
    (await f.indexer.preparePlayerActivitySnapshot(202n, []))();
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(now);
    // Reorgs and canonical zero must replace rather than MAX the previous timestamp.
    f.setActive(0);
    (await f.indexer.preparePlayerActivitySnapshot(203n, []))();
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(0);
    f.database.close();
  });

  test("canonical repair immediately invalidates cached Rankings/Raid Finder protection without per-target RPC", async () => {
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
    f.setActive(Math.floor(Date.now() / 1000));
    (await f.indexer.preparePlayerActivitySnapshot(200n, []))();
    const canonical = new VeydriftGameReader(config, { async request<T>(): Promise<T> { throw new Error("List reads must not call RPC"); } });
    const handler = createRequestHandler({ role: "reader", config, indexer: f.indexer, chainReader: canonical });
    const request = () => new Request(`http://localhost/highscores?currentWallet=${attacker}&includeAttackProtection=true&limit=10`);
    const before = await (await handler(request())).json();
    expect(before.rankings.total.find((row: { wallet: string }) => row.wallet === defender).attackProtection)
      .toMatchObject({ allowed: false, blockedReason: "score_protection", defenderInactive: false });
    f.setActive(Math.floor(Date.now() / 1000) - 8 * 86400);
    (await f.indexer.preparePlayerActivitySnapshot(201n, []))();
    // Same request, no clock advance and no fresh=1 escape: the committed repair invalidates cache.
    const after = await (await handler(request())).json();
    expect(after.rankings.total.find((row: { wallet: string }) => row.wallet === defender).attackProtection)
      .toMatchObject({ allowed: true, blockedReason: "none", defenderInactive: true });
    f.database.close();
  });

  test("failed or incomplete snapshots cannot partially overwrite existing canonical rows", async () => {
    const f = fixture();
    f.indexer.applyLog(started);
    (await f.indexer.preparePlayerActivitySnapshot(200n, []))();
    f.setFail(true);
    await expect(f.indexer.preparePlayerActivitySnapshot(201n, [])).rejects.toThrow("activity RPC unavailable");
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    f.reader.getPlayerLastActiveAt = async () => new Map();
    await expect(f.indexer.preparePlayerActivitySnapshot(202n, [])).rejects.toThrow("Incomplete canonical");
    expect(f.database.query("SELECT value FROM indexer_metadata WHERE key = 'canonicalPlayerActivityBlock'").get()).toEqual({ value: "200" });
    f.database.close();
  });

  test("HTTP polling stages new owners, retries RPC failure atomically and catches no-log owner activity", async () => {
    const f = fixture();
    let head = 200n;
    const sync = new ChainSyncService(config, f.indexer, { logBackfiller: {
      async getHeadBlock() { return head; },
      async getBlockProjectionAnchor(block) { return { hash: topic(block), timestamp: String(now) }; },
      async listContractLogs() { return [started]; }
    } });
    f.setFail(true);
    await sync.poll();
    expect(f.indexer.planet("295")).toBeNull();
    expect(sync.snapshot().lastError).toContain("activity RPC unavailable");
    f.setFail(false);
    await sync.poll();
    expect(f.indexer.planet("295")?.owner).toBe(defender);
    expect(f.reads.at(-1)).toEqual({ wallets: [defender], block: 200n });
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(afk);
    head++;
    f.setActive(now);
    await sync.poll();
    expect(f.indexer.playerLastActiveSeconds([defender]).get(defender)).toBe(now);
    await sync.stop();
    f.database.close();
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

  for (const batch of [true, false]) test(`mapping reads pin the block and preserve zero (${batch ? "batch" : "sequential"})`, async () => {
    const check = (method: string, params: unknown[]) => {
      expect(method).toBe("eth_call");
      const [call, tag] = params as [{ data: string; to: string }, string];
      expect(tag).toBe("0xc8");
      expect(call.to).toBe(config.gameContractAddress!);
      expect(call.data.slice(0, 10)).toBe(toFunctionSelector("playerLastActiveAt(address)"));
      return data(call.data.endsWith(defender.slice(2)) ? BigInt(afk) : 0n);
    };
    const reader = new VeydriftGameReader(config, {
      async request<T>(method: string, params: unknown[]) { return check(method, params) as T; },
      ...(batch ? { async requestBatch<T>(calls: { method: string; params: unknown[] }[]) {
        return calls.map(call => check(call.method, call.params) as T);
      } } : {})
    });
    expect(await reader.getPlayerLastActiveAt([defender, attacker, defender], 200n)).toEqual(new Map([[defender, afk], [attacker, 0]]));
  });

  test("large owner rosters keep every batch bounded and pinned", async () => {
    const sizes: number[] = [];
    const reader = new VeydriftGameReader(config, {
      async request<T>(): Promise<T> { throw new Error("Expected batches"); },
      async requestBatch<T>(calls: { method: string; params: unknown[] }[]) {
        sizes.push(calls.length);
        expect(calls.every(call => call.params[1] === "0xc8")).toBe(true);
        return calls.map(() => data(0n) as T);
      }
    });
    const wallets = Array.from({ length: 121 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address);
    expect((await reader.getPlayerLastActiveAt(wallets, 200n)).size).toBe(121);
    expect(sizes).toEqual([50, 50, 21]);
  });

  for (const value of ["0x", "0x01", data(2n ** 64n)]) test(`rejects malformed canonical activity ${value}`, async () => {
    const reader = new VeydriftGameReader(config, { async request<T>() { return value as T; } });
    await expect(reader.getPlayerLastActiveAt([defender], 200n)).rejects.toThrow("Invalid canonical");
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
