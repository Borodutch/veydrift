import { describe, expect, test } from "bun:test";
import { ChainSyncService } from "./chainSync";
import type { BackendConfig } from "./config";
import type { RpcLog, SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222";
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
// Authoritative per-mutation count events the contract emits on EVERY ship/defense count change,
// including combat losses (overwrite-to-total).
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const planetDefenseCountChangedTopic = "0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3";

function topicWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function ownerTopic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

// eth_getLogs responses carry logIndex at runtime even though the RpcLog type doesn't declare it
// (applyLog dedups on txHash:logIndex). Widen the test log type so fixtures can set it explicitly.
type TestLog = RpcLog & { logIndex?: string };

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  qaSyntheticStationedDefenders: false,
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:",
  randomnessCommitmentStorePath: ".data/test-randomness.json",
  indexFromBlock: 100n,
  missionResolutionEnabled: false,
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "custom-url",
  wsRpcUrl: "wss://example.invalid/ws"
};

function makeIndexer(): SettlementIndexer {
  return new SettlementIndexer(
    {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
    },
    100n
  );
}

// Controllable HTTP-poll source. `head` is the chain head returned by getHeadBlock; `ranges` records
// every [from,to] listContractLogs was asked for; `logsFor` decides which logs each range returns.
class MockBackfiller {
  head: bigint;
  headError: Error | null = null;
  logsError: Error | null = null;
  ranges: Array<{ from: bigint; to: bigint | "latest" }> = [];
  headCalls = 0;
  logsFor: (from: bigint, to: bigint | "latest") => TestLog[];

  constructor(head: bigint, logsFor: (from: bigint, to: bigint | "latest") => TestLog[] = () => []) {
    this.head = head;
    this.logsFor = logsFor;
  }

  async getHeadBlock(): Promise<bigint> {
    this.headCalls += 1;
    if (this.headError) throw this.headError;
    return this.head;
  }

  async listContractLogs(from: bigint, to: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    this.ranges.push({ from, to });
    if (this.logsError) throw this.logsError;
    return this.logsFor(from, to);
  }
}

function planetStartedLog(block: string, planetId: bigint, tx: string): RpcLog {
  return {
    blockNumber: block,
    transactionHash: tx,
    topics: [planetStartedTopic, ownerTopic(player), topicWord(planetId)],
    data: abiWords(2n, 44n, 9n, 211n, 1n)
  };
}

describe("ChainSyncService (polling)", () => {
  test("replays from configured base on the first poll, then ingests only new ranges", async () => {
    const indexer = makeIndexer();
    const seeded = planetStartedLog("0x191", 7n, "0xseed");
    const backfiller = new MockBackfiller(0x192n, () => [seeded]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    // First poll event-replays from the configured base. There is no boot canonical self-heal to seed
    // history, so startup must not skip straight to head.
    await service.poll();
    expect(backfiller.ranges).toEqual([{ from: 100n, to: 0x192n }]);
    expect(indexer.snapshot().indexedPlanets).toBeGreaterThanOrEqual(1);
    expect(service.snapshot().latestSyncedBlock).toBe(String(0x192n));
    expect(service.snapshot().connected).toBe(true);
    expect(service.snapshot().eventsReceived).toBeGreaterThanOrEqual(1);

    // Head advances; the next poll ingests exactly (cursor+1 .. head).
    backfiller.head = 0x193n;
    await service.poll();
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x193n, to: 0x193n });
    expect(service.snapshot().latestSyncedBlock).toBe(String(0x193n));

    service.stop();
  });

  test("resumes from the DB latestIndexedBlock on startup instead of skipping to live head", async () => {
    const indexer = makeIndexer();
    indexer.applyLog({
      ...planetStartedLog("0x180", 7n, "0xexisting"),
      logIndex: "0x0"
    });
    const backfiller = new MockBackfiller(0x182n, () => [{
      ...planetStartedLog("0x181", 8n, "0xmissed"),
      logIndex: "0x0"
    }]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(backfiller.ranges).toEqual([{ from: 0x181n, to: 0x182n }]);
    expect(indexer.snapshot().indexedPlanets).toBe(2);
    service.stop();
  });

  test("applies authoritative PlanetShipCountChanged/PlanetDefenseCountChanged combat losses to total", async () => {
    const indexer = makeIndexer();
    // One ingested range carries the full sequence the live chain emits: seed planet 7, build 18
    // ships / 20 defenses, then the combat-loss count events overwriting to the chain totals 3 / 0.
    const logs: TestLog[] = [
      planetStartedLog("0x180", 7n, "0xplanet"),
      {
        blockNumber: "0x181",
        transactionHash: "0xbuild-ships",
        topics: [shipCompletedTopic, topicWord(7n), topicWord(1n)],
        data: abiWords(18n, 18n)
      },
      {
        blockNumber: "0x181",
        transactionHash: "0xbuild-def",
        topics: [defenseCompletedTopic, topicWord(7n), topicWord(0n)],
        data: abiWords(20n, 20n)
      },
      {
        blockNumber: "0x18e",
        transactionHash: "0xship-combat-loss",
        logIndex: "0x0",
        topics: [planetShipCountChangedTopic, topicWord(7n), topicWord(1n)],
        data: abiWords(3n)
      },
      {
        blockNumber: "0x18e",
        transactionHash: "0xdef-combat-loss",
        logIndex: "0x1",
        topics: [planetDefenseCountChangedTopic, topicWord(7n), topicWord(0n)],
        data: abiWords(0n)
      }
    ];
    const backfiller = new MockBackfiller(0x190n, () => logs);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // ingest the whole sequence

    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(3);
    expect(indexer.defenseRows("7").find((defense) => defense.id === 0)?.count).toBe(0);
    service.stop();
  });

  test("re-scanning an overlapping range is idempotent (no double count, deduped)", async () => {
    const indexer = makeIndexer();
    const countLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xship-count",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(5n)
    };
    const logs: TestLog[] = [planetStartedLog("0x180", 7n, "0xplanet"), countLog];
    const backfiller = new MockBackfiller(0x182n, () => logs);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // ingest -> count 5
    const afterFirst = service.snapshot().eventsReceived;
    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(5);

    // Force another ingest returning the SAME already-applied logs: the absolute-SET stays 5 and the
    // deduped logs (same txHash:logIndex) are not re-counted.
    backfiller.head = 0x183n;
    await service.poll();
    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(5);
    expect(service.snapshot().eventsReceived).toBe(afterFirst); // duplicates not re-counted
    service.stop();
  });

  test("a transient poll failure records the error, keeps the cursor, and recovers next tick", async () => {
    const indexer = makeIndexer();
    const seeded = planetStartedLog("0x181", 7n, "0xseed");
    const backfiller = new MockBackfiller(0x180n, (from) => from === 0x181n ? [seeded] : []);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // replay through 0x180, no logs
    // Head moved, but the ingest getLogs fails transiently. Cursor must NOT advance.
    backfiller.head = 0x182n;
    backfiller.logsError = new Error("Unexpected end of JSON input");
    await service.poll();
    expect(service.snapshot().lastError).toContain("Unexpected end of JSON input");
    expect(service.snapshot().connected).toBe(true); // one blip never flaps readiness
    expect(indexer.snapshot().indexedPlanets).toBe(0); // nothing applied

    // RPC recovers; the same range is retried and the log is finally applied — no event lost.
    backfiller.logsError = null;
    await service.poll();
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x181n, to: 0x182n });
    expect(indexer.snapshot().indexedPlanets).toBeGreaterThanOrEqual(1);
    expect(service.snapshot().lastError).toBeNull();
    service.stop();
  });

  test("connected flips false only after sustained consecutive poll failures", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // healthy anchor
    expect(service.snapshot().connected).toBe(true);

    backfiller.headError = new Error("RPC down");
    for (let i = 0; i < 4; i += 1) await service.poll();
    expect(service.snapshot().connected).toBe(true); // below threshold
    await service.poll(); // 5th consecutive failure
    expect(service.snapshot().connected).toBe(false);

    backfiller.headError = null;
    await service.poll();
    expect(service.snapshot().connected).toBe(true); // recovers on next good poll
    service.stop();
  });

  test("start() is disabled (and reports it) without a log backfiller", () => {
    const indexer = makeIndexer();
    const service = new ChainSyncService(config, indexer, {});
    service.start();
    const snapshot = service.snapshot();
    expect(snapshot.pollingEnabled).toBe(false);
    expect(snapshot.connected).toBe(false);
    expect(snapshot.lastError).toContain("polling disabled");
    service.stop();
  });

  test("stop() halts the loop so a later poll is a no-op", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    await service.poll();
    const callsBefore = backfiller.headCalls;
    service.stop();
    await service.poll();
    expect(backfiller.headCalls).toBe(callsBefore); // stopped: no further head fetch
  });
});
