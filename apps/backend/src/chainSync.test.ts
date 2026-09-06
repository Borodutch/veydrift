import { describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import { ChainSyncService } from "./chainSync";
import type { LiveLogSubscriber } from "./chainSync";
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
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const moonResourcesChangedTopic = "0xd1823653b6a3910ee502390b5bf01f05a3b571dc81899a6ac3af3f01fae05c26";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const interplanetaryMissileLaunchedTopic = "0x604ad2c11139a5c17dc4ad536be44e0decb1a46637bc3a7497c4e049e9ad3bd2";
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const referralInviteWindowActivatedTopic = "0xd51c9643dafa95fcfa30d65f2b6576bc03873e2630d73fc523daf87a7158d589";
const referralInviteRedeemedTopic = "0xf0e76a5aa6e423f978c7616fd6933b5d376a32654fc67c6fad0afdbc744ccce1";
const referralRewardClaimedTopic = "0x55b0859d9094fa40dfdcbcdd82c0d785132f6a627b6083e228d6bddb5e498558";
const paidAllianceInvitePurchasedTopic = "0x044d47943b4c703fffb74230521077d9baeb2977f8c12a23c79e60169ba20b41";
const allianceProductionBonusAccruedTopic = "0xc5911d6b2b795502459a9b1187d319db5d0d697f8278617b8f9b240c8892108b";
const referralAddress = "0x4444444444444444444444444444444444444444" as const;
const paidAllianceInviteAddress = "0x5555555555555555555555555555555555555555" as const;

function topicWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function ownerTopic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!predicate()) throw new Error("Timed out waiting for condition");
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
  referralLogsError: Error | null = null;
  failoverReasons: string[] = [];
  calls: string[] = [];
  ranges: Array<{ from: bigint; to: bigint | "latest" }> = [];
  referralRanges: Array<{ from: bigint; to: bigint | "latest" }> = [];
  paidAllianceInviteRanges: Array<{ from: bigint; to: bigint | "latest" }> = [];
  timedMissilePayloadRanges: Array<{ from: bigint; to: bigint | "latest" }> = [];
  headCalls = 0;
  timestampCalls: bigint[] = [];
  anchorHashFor: (blockNumber: bigint) => string = (blockNumber) => `0x${blockNumber.toString(16).padStart(64, "0")}`;
  logsFor: (from: bigint, to: bigint | "latest") => TestLog[];
  referralLogsFor: (from: bigint, to: bigint | "latest") => TestLog[] = () => [];
  paidAllianceInviteLogsFor: (from: bigint, to: bigint | "latest") => TestLog[] = () => [];
  timedMissilePayloadLogsFor: (from: bigint, to: bigint | "latest") => TestLog[] = () => [];

  constructor(head: bigint, logsFor: (from: bigint, to: bigint | "latest") => TestLog[] = () => []) {
    this.head = head;
    this.logsFor = logsFor;
  }

  async getHeadBlock(): Promise<bigint> {
    this.headCalls += 1;
    if (this.headError) throw this.headError;
    return this.head;
  }

  async getBlockProjectionAnchor(blockNumber: bigint): Promise<{ hash: string; timestamp: string }> {
    this.timestampCalls.push(blockNumber);
    return {
      hash: this.anchorHashFor(blockNumber),
      timestamp: (1_770_000_000n + blockNumber).toString()
    };
  }

  async listContractLogs(from: bigint, to: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    this.calls.push("generic");
    this.ranges.push({ from, to });
    if (this.logsError) throw this.logsError;
    return this.logsFor(from, to);
  }

  async listReferralLogs(from: bigint, to: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    this.calls.push("referral");
    this.referralRanges.push({ from, to });
    if (this.referralLogsError) throw this.referralLogsError;
    if (this.logsError) throw this.logsError;
    return this.referralLogsFor(from, to);
  }

  async listPaidAllianceInviteLogs(from: bigint, to: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    this.calls.push("paid-alliance");
    this.paidAllianceInviteRanges.push({ from, to });
    if (this.logsError) throw this.logsError;
    return this.paidAllianceInviteLogsFor(from, to);
  }

  async listTimedMissilePayloadLogs(from: bigint, to: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    this.calls.push("timed-missile");
    this.timedMissilePayloadRanges.push({ from, to });
    if (this.logsError) throw this.logsError;
    return this.timedMissilePayloadLogsFor(from, to);
  }

  failoverRpc(reason: string): boolean {
    this.failoverReasons.push(reason);
    return true;
  }
}

class MockLiveLogSubscriber implements LiveLogSubscriber {
  subscription:
    | {
      addresses: `0x${string}`[];
      onError: (error: Error) => void;
      onLogs: (logs: RpcLog[]) => void;
    }
    | null = null;
  subscribeCalls = 0;
  unsubscribeCalls = 0;

  constructor(private readonly setupError: Error | null = null) {}

  subscribe(options: {
    addresses: `0x${string}`[];
    onError: (error: Error) => void;
    onLogs: (logs: RpcLog[]) => void;
  }): () => void {
    this.subscribeCalls += 1;
    if (this.setupError) throw this.setupError;
    this.subscription = options;
    return () => {
      this.unsubscribeCalls += 1;
    };
  }

  emit(logs: RpcLog[]): void {
    if (!this.subscription) throw new Error("No live-log subscription is active.");
    this.subscription.onLogs(logs);
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

function referralMigrationLogs(): TestLog[] {
  const invitee = "0x5555555555555555555555555555555555555555";
  const codeHash = keccak256(toHex("borodutch"));
  const commitment = `0x${"12".repeat(32)}`;
  return [
    {
      address: referralAddress,
      blockNumber: "0x78",
      transactionHash: `0x${"21".repeat(32)}`,
      logIndex: "0x0",
      topics: [referralInviteWindowActivatedTopic, ownerTopic(player), codeHash, commitment],
      data: encodeAbiParameters(
        parseAbiParameters("string,uint64,uint64,bool"),
        ["borodutch", 1_783_526_400n, 1_783_612_800n, true]
      )
    },
    {
      address: referralAddress,
      blockNumber: "0x79",
      transactionHash: `0x${"22".repeat(32)}`,
      logIndex: "0x0",
      topics: [referralInviteRedeemedTopic, ownerTopic(player), ownerTopic(invitee), commitment],
      data: abiWords(25_000_000_000_000_000n, 0n, 1n, 1_783_526_500n)
    },
    {
      address: referralAddress,
      blockNumber: "0x7a",
      transactionHash: `0x${"23".repeat(32)}`,
      logIndex: "0x0",
      topics: [referralRewardClaimedTopic, ownerTopic(player), ownerTopic(invitee), commitment],
      data: abiWords(BigInt(player), 25_000_000_000_000_000n, 1_783_526_600n)
    }
  ];
}

describe("ChainSyncService (polling)", () => {
  test("subscribes to settlement and migration contract activity", () => {
    const settlementContractAddress = "0x5555555555555555555555555555555555555555" as const;
    const migrationContractAddress = "0x6666666666666666666666666666666666666666" as const;
    const service = new ChainSyncService(
      { ...config, settlementContractAddress, migrationContractAddress },
      makeIndexer()
    );

    expect(service.snapshot().subscribedAddresses).toEqual([
      config.gameContractAddress!,
      settlementContractAddress,
      migrationContractAddress
    ]);
  });

  test("closes an event stream when the request signal aborts", async () => {
    const service = new ChainSyncService(config, makeIndexer());
    const abortController = new AbortController();
    const reader = service.eventStream(abortController.signal).getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    abortController.abort();

    await expect(reader.read()).resolves.toMatchObject({ done: true });
    service.stop();
  });

  test("uses websocket notifications to wake the canonical HTTP ingestion path", async () => {
    const indexer = makeIndexer();
    const canonicalLog = {
      ...planetStartedLog("0x181", 7n, "0xlive"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    };
    const backfiller = new MockBackfiller(0x180n, (from, to) =>
      from <= 0x181n && to !== "latest" && to >= 0x181n ? [canonicalLog] : []
    );
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => liveLogs.subscription !== null && service.snapshot().liveListenerConnected);
    await waitFor(() => service.snapshot().latestSyncedBlock === String(0x180n));
    backfiller.head = 0x181n;
    liveLogs.emit([canonicalLog]);

    await waitFor(() => indexer.snapshot().indexedPlanets === 1);
    expect(service.snapshot()).toMatchObject({
      activeSource: "viem_ws",
      eventsReceived: 1,
      latestSyncedBlock: String(0x181n),
      liveListenerConnected: true,
      pollingEnabled: true,
      subscribedToLogs: true
    });
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x141n, to: 0x181n });
    service.stop();
    expect(liveLogs.unsubscribeCalls).toBe(1);
  });

  test("does not apply an unverified websocket payload while the canonical scan is in progress", async () => {
    const indexer = makeIndexer();
    let resolveCatchUp!: () => void;
    const catchUpBlocked = new Promise<void>((resolve) => {
      resolveCatchUp = resolve;
    });
    const ranges: Array<{ from: bigint; to: bigint | "latest" }> = [];
    let listCalls = 0;
    let head = 0x180n;
    const canonicalLog = {
      ...planetStartedLog("0x181", 7n, "0xcanonical-after-catch-up"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    };
    const backfiller = {
      async getHeadBlock() {
        return head;
      },
      async listContractLogs(from: bigint, to: bigint | "latest" = "latest") {
        ranges.push({ from, to });
        listCalls += 1;
        if (listCalls === 1) {
          await catchUpBlocked;
        }
        return from <= 0x181n && to !== "latest" && to >= 0x181n ? [canonicalLog] : [];
      }
    };
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => liveLogs.subscription !== null && ranges.length === 1);
    liveLogs.emit([{
      ...planetStartedLog("0x181", 7n, "0xunverified-websocket-payload"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(indexer.snapshot().indexedPlanets).toBe(0);
    resolveCatchUp();
    await waitFor(() => service.snapshot().lastPollDurationMs !== null);
    head = 0x181n;
    liveLogs.emit([canonicalLog]);
    await waitFor(() => indexer.snapshot().indexedPlanets === 1);

    expect(indexer.planet("7")?.transactionHash).toBe("0xcanonical-after-catch-up");
    expect(service.snapshot()).toMatchObject({
      latestHeadBlock: String(0x181n),
      latestSyncedBlock: String(0x181n),
      pollBacklogBlocks: "0"
    });
    service.stop();
  });

  test("coalesces a burst of per-log websocket wakeups into one active scan plus one rerun", async () => {
    const indexer = makeIndexer();
    let releaseNotifiedScan!: () => void;
    const notifiedScanBlocked = new Promise<void>((resolve) => {
      releaseNotifiedScan = resolve;
    });
    let listCalls = 0;
    const canonicalLogs = Array.from({ length: 24 }, (_, index) => ({
      ...planetStartedLog("0x181", BigInt(index + 1), `0xcanonical-${index}`),
      address: config.gameContractAddress!,
      logIndex: `0x${index.toString(16)}`
    }));
    const backfiller = new MockBackfiller(0x180n, () => canonicalLogs);
    const originalList = backfiller.listContractLogs.bind(backfiller);
    backfiller.listContractLogs = async (from, to = "latest") => {
      listCalls += 1;
      if (listCalls === 2) await notifiedScanBlocked;
      return originalList(from, to);
    };
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService({ ...config, pollIntervalMs: 60_000 }, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => liveLogs.subscription !== null && service.snapshot().lastPolledAt !== null);
    backfiller.head = 0x181n;
    liveLogs.emit([canonicalLogs[0]!]);
    await waitFor(() => listCalls === 2);
    for (const log of canonicalLogs.slice(1)) liveLogs.emit([log]);
    releaseNotifiedScan();

    await waitFor(() => listCalls === 3 && indexer.snapshot().indexedPlanets === canonicalLogs.length);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(listCalls).toBe(3);
    expect(backfiller.ranges).toHaveLength(3);
    service.stop();
  });

  test("retires a websocket-removed mission log before indexing its canonical replacement", async () => {
    const indexer = makeIndexer();
    const orphanedLaunch: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xorphaned-mission-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topicWord(16512n), ownerTopic(player), topicWord(0n)],
      data: abiWords(7n, 99n, 4_000_000_000n, 4_000_000_100n, 0n)
    };
    const replacementLaunch: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xcanonical-mission-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topicWord(16513n), ownerTopic(player), topicWord(0n)],
      data: abiWords(8n, 100n, 4_000_000_000n, 4_000_000_100n, 0n)
    };
    let canonicalLogs: TestLog[] = [orphanedLaunch];
    const backfiller = new MockBackfiller(0x181n, (from, to) => {
      if (to === "latest") return [];
      return canonicalLogs.filter((log) => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to);
    });
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService({ ...config, pollIntervalMs: 60_000 }, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => indexer.fleetMission("16512") !== null && indexer.resourceProjectionContext().safeToProject);
    canonicalLogs = [replacementLaunch];
    backfiller.head = 0x182n;
    liveLogs.emit([{ ...orphanedLaunch, removed: true }, replacementLaunch]);

    await waitFor(() => indexer.fleetMission("16513") !== null);
    await waitFor(() => indexer.resourceProjectionContext().safeToProject);
    const db = (indexer as unknown as { db: Database }).db;
    const orphanedRow = db.query(`
      SELECT removed
      FROM indexed_event_logs
      WHERE transaction_hash = ? AND log_index = ?
    `).get(orphanedLaunch.transactionHash, "0x0") as { removed: number } | null;
    const orphanedMissionRows = db.query(`
      SELECT COUNT(*) AS count
      FROM indexed_mission_event_logs
      WHERE event_id = ?
    `).get(`${orphanedLaunch.transactionHash}:0x0`) as { count: number };
    expect(orphanedRow).toEqual({ removed: 1 });
    expect(orphanedMissionRows.count).toBe(0);
    expect(indexer.fleetMission("16512")).toBeNull();
    expect(indexer.fleetMission("16513")).toMatchObject({ missionId: "16513" });
    expect(indexer.snapshot().pendingReconciliationReason).toBeNull();
    service.stop();
  });

  test("retires a Game launch removed while the writer was offline before indexing its replacement", async () => {
    const indexer = makeIndexer();
    const orphanedLaunch: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x181",
      transactionHash: "0xoffline-orphaned-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topicWord(16516n), ownerTopic(player), topicWord(7n)],
      data: abiWords(7n, 99n, 4_000_000_000n, 4_000_000_100n, 0n)
    };
    const replacementLaunch: TestLog = {
      ...orphanedLaunch,
      transactionHash: "0xoffline-canonical-launch",
      topics: [fleetMissionLaunchedTopic, topicWord(16517n), ownerTopic(player), topicWord(7n)]
    };
    indexer.applyLog(orphanedLaunch);
    expect(indexer.fleetMission("16516")).not.toBeNull();

    const backfiller = new MockBackfiller(0x182n, () => [replacementLaunch]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    await service.poll();

    expect(indexer.fleetMission("16516")).toBeNull();
    expect(indexer.fleetMission("16517")).toMatchObject({ missionId: "16517" });
    const db = (indexer as unknown as { db: Database }).db;
    expect(db.query(`
      SELECT removed FROM indexed_event_logs
      WHERE transaction_hash = ? AND log_index = ?
    `).get(orphanedLaunch.transactionHash, "0x0")).toEqual({ removed: 1 });
    service.stop();
  });

  test("rolls back a missile defense total removed while the writer was offline", async () => {
    const indexer = makeIndexer();
    const baseline: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x180",
      transactionHash: "0xcanonical-defense-baseline",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(5n)
    };
    const orphanedImpact: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x181",
      transactionHash: "0xoffline-orphaned-missile-impact",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(3n)
    };
    indexer.applyLog(baseline);
    indexer.applyLog(orphanedImpact);
    expect(indexer.defenseRows("7").find((defense) => defense.id === 1)?.count).toBe(3);

    const backfiller = new MockBackfiller(0x182n, () => [baseline]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    await service.poll();

    expect(indexer.defenseRows("7").find((defense) => defense.id === 1)?.count).toBe(5);
    const db = (indexer as unknown as { db: Database }).db;
    expect(db.query(`
      SELECT removed FROM indexed_event_logs
      WHERE transaction_hash = ? AND log_index = ?
    `).get(orphanedImpact.transactionHash, "0x0")).toEqual({ removed: 1 });
    service.stop();
  });

  test("replaces a same-ID Game log when a reorg changes its canonical block and payload", async () => {
    const indexer = makeIndexer();
    const orphaned: TestLog = {
      address: config.gameContractAddress!,
      blockHash: `0x${"11".repeat(32)}`,
      blockNumber: "0x181",
      transactionHash: "0xsame-id-defense-reorg",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(3n)
    };
    const canonical: TestLog = {
      ...orphaned,
      blockHash: `0x${"22".repeat(32)}`,
      blockNumber: "0x182",
      data: abiWords(4n)
    };
    indexer.applyLog(orphaned);
    expect(indexer.defenseRows("7").find((defense) => defense.id === 1)?.count).toBe(3);

    const service = new ChainSyncService(
      config,
      indexer,
      { logBackfiller: new MockBackfiller(0x182n, () => [canonical]) }
    );
    await service.poll();

    expect(indexer.defenseRows("7").find((defense) => defense.id === 1)?.count).toBe(4);
    const db = (indexer as unknown as { db: Database }).db;
    const stored = db.query(`
      SELECT event_json, removed FROM indexed_event_logs
      WHERE transaction_hash = ? AND log_index = ?
    `).get(orphaned.transactionHash, "0x0") as { event_json: string; removed: number };
    expect(stored.removed).toBe(0);
    expect(JSON.parse(stored.event_json)).toMatchObject({
      blockHash: canonical.blockHash,
      blockNumber: canonical.blockNumber,
      data: canonical.data
    });
    service.stop();
  });

  test("restores a defense queue settled by an offline-reorged missile impact", async () => {
    const indexer = makeIndexer();
    indexer.applyLog({
      ...planetStartedLog("0x17f", 7n, "0xplanet"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    });
    const activeQueue: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x180",
      transactionHash: "0xqueue-active",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(2n, 2_000_001_000n, 100n, 50n, 0n)
    };
    const backlogQueue: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x180",
      transactionHash: "0xqueue-backlog",
      logIndex: "0x1",
      topics: [defenseQueuedTopic, topicWord(7n), topicWord(0n)],
      data: abiWords(3n, 2_000_001_600n, 200n, 0n, 0n)
    };
    const orphanedCompletion: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0x181",
      transactionHash: "0xmissile-impact-settled-queue",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topicWord(7n), topicWord(1n)],
      data: abiWords(2n, 2n)
    };
    for (const log of [activeQueue, backlogQueue, orphanedCompletion]) indexer.applyLog(log);
    expect(indexer.playerQueues(player, "7").defense).toMatchObject({ itemId: 0, quantity: 3 });

    const backfiller = new MockBackfiller(0x182n, () => [activeQueue, backlogQueue]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    await service.poll();

    expect(indexer.playerQueues(player, "7").defense).toMatchObject({
      itemId: 1,
      quantity: 2,
      backlog: [expect.objectContaining({ itemId: 0, quantity: 3 })]
    });
    const db = (indexer as unknown as { db: Database }).db;
    expect(db.query(`
      SELECT removed FROM indexed_event_logs
      WHERE transaction_hash = ? AND log_index = ?
    `).get(orphanedCompletion.transactionHash, "0x0")).toEqual({ removed: 1 });
    service.stop();
  });

  test("keeps an unrelated stale reason while reconciling a websocket removal", async () => {
    const indexer = makeIndexer();
    const orphanedLaunch: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xorphaned-launch-with-existing-stale-reason",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topicWord(16514n), ownerTopic(player), topicWord(0n)],
      data: abiWords(7n, 99n, 4_000_000_000n, 4_000_000_100n, 0n)
    };
    const replacementLaunch: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xreplacement-with-existing-stale-reason",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topicWord(16515n), ownerTopic(player), topicWord(0n)],
      data: abiWords(8n, 100n, 4_000_000_000n, 4_000_000_100n, 0n)
    };
    let canonicalLogs: TestLog[] = [orphanedLaunch];
    const backfiller = new MockBackfiller(0x181n, (from, to) => {
      if (to === "latest") return [];
      return canonicalLogs.filter((log) => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to);
    });
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService({ ...config, pollIntervalMs: 60_000 }, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => indexer.fleetMission("16514") !== null && indexer.resourceProjectionContext().safeToProject);
    indexer.markStale("planet_resources_pending:7");
    canonicalLogs = [replacementLaunch];
    backfiller.head = 0x182n;
    liveLogs.emit([{ ...orphanedLaunch, removed: true }, replacementLaunch]);

    await waitFor(() => indexer.fleetMission("16515") !== null);
    expect(indexer.fleetMission("16514")).toBeNull();
    expect(indexer.snapshot().pendingReconciliationReason).toBe("planet_resources_pending:7");
    expect(indexer.resourceProjectionContext().safeToProject).toBe(false);
    service.stop();
  });

  test("uses one complete HTTP range for a websocket-notified head and its cursor gap", async () => {
    const indexer = makeIndexer();
    const gapLog = {
      ...planetStartedLog("0x181", 7n, "0xgap"),
      logIndex: "0x0"
    };
    const canonicalLiveLog = {
      ...planetStartedLog("0x182", 8n, "0xlive-after-gap"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    };
    const backfiller = new MockBackfiller(0x180n, (from, to) => {
      if (to === "latest") return [];
      return [gapLog, canonicalLiveLog].filter((log) => {
        const block = BigInt(log.blockNumber);
        return block >= from && block <= to;
      });
    });
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    service.start();
    await waitFor(() => service.snapshot().latestSyncedBlock === String(0x180n));
    backfiller.head = 0x182n;
    liveLogs.emit([canonicalLiveLog]);

    await waitFor(() => indexer.snapshot().indexedPlanets === 2);
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x141n, to: 0x182n });
    expect(service.snapshot()).toMatchObject({
      activeSource: "viem_ws",
      latestSyncedBlock: String(0x182n),
      pollBacklogBlocks: "0"
    });
    service.stop();
  });

  for (const httpHead of [0x181n, 0x182n]) {
    test(`HTTP tail replay backfills a websocket-missed same-block mission return at head ${httpHead.toString(16)}`, async () => {
      const indexer = makeIndexer();
      indexer.applyLog({
        blockNumber: "0x17f",
        transactionHash: "0xmission-16511-launch",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topicWord(16511n), ownerTopic(player), topicWord(0n)],
        data: abiWords(7n, 99n, 4_000_000_000n, 4_000_000_100n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x180",
        transactionHash: "0xmission-16511-returning",
        logIndex: "0x0",
        topics: [fleetMissionReturnExposedTopic, topicWord(16511n), ownerTopic(player), topicWord(2n)],
        data: abiWords(7n, 99n, 4_000_000_200n, 0n, 0n, 0n)
      });
      expect(indexer.fleetMission("16511")).toMatchObject({ status: "Returning" });

      let exposeMissedSibling = false;
      let exposeNotifiedSibling = false;
      const notifiedSibling = {
        ...planetStartedLog("0x181", 8n, "0xwebsocket-notified-sibling"),
        address: config.gameContractAddress!,
        logIndex: "0x0"
      };
      const missedReturn: TestLog = {
        blockNumber: "0x181",
        transactionHash: "0xmission-16511-returned",
        logIndex: "0x1",
        topics: [fleetMissionReturnedTopic, topicWord(16511n), ownerTopic(player), topicWord(7n)],
        data: "0x"
      };
      const backfiller = new MockBackfiller(0x180n, (from, to) => {
        if (to === "latest" || from > 0x181n || to < 0x181n) return [];
        return [
          ...(exposeNotifiedSibling ? [notifiedSibling] : []),
          ...(exposeMissedSibling ? [missedReturn] : [])
        ];
      });
      const liveLogs = new MockLiveLogSubscriber();
      const service = new ChainSyncService({ ...config, pollIntervalMs: 60_000 }, indexer, {
        liveLogSubscriber: liveLogs,
        logBackfiller: backfiller
      });

      service.start();
      await waitFor(() => liveLogs.subscription !== null && service.snapshot().lastPolledAt !== null);
      exposeNotifiedSibling = true;
      backfiller.head = 0x181n;
      liveLogs.emit([notifiedSibling]);
      await waitFor(() => service.snapshot().latestSyncedBlock === String(0x181n));

      exposeMissedSibling = true;
      backfiller.head = httpHead;
      await service.poll();

      const replayRange = backfiller.ranges.at(-1);
      expect(replayRange?.to).toBe(httpHead);
      expect(replayRange?.from ?? httpHead + 1n).toBeLessThanOrEqual(0x181n);
      expect(indexer.fleetMission("16511")).toMatchObject({ status: "Returned" });
      service.stop();
    });
  }

  test("falls back to HTTP polling when websocket setup fails", async () => {
    const indexer = makeIndexer();
    const log = {
      ...planetStartedLog("0x181", 7n, "0xfallback"),
      logIndex: "0x0"
    };
    const backfiller = new MockBackfiller(0x181n, () => [log]);
    const liveLogs = new MockLiveLogSubscriber(new Error("websocket refused"));
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller,
      pollIntervalMs: 60_000
    });

    service.start();

    await waitFor(() => indexer.snapshot().indexedPlanets === 1);
    expect(service.snapshot()).toMatchObject({
      activeSource: "fallback_poll",
      liveListenerConnected: false,
      liveListenerErrorCount: 1,
      liveListenerLastError: "websocket refused",
      pollingEnabled: true
    });
    service.stop();
  });

  test("does not canonical-heal combat logs during websocket-triggered canonical polling", async () => {
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const backfiller = new MockBackfiller(0x180n);
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });
    const combatLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xcombat-ws-slow-heal",
      logIndex: "0x0",
      topics: [
        attackBattleResolvedTopic,
        topicWord(99n),
        ownerTopic(player),
        topicWord(8n)
      ],
      data: abiWords(1n, 2n, 3n, 4n)
    };
    backfiller.head = 0x181n;
    backfiller.logsFor = () => [combatLog];

    service.start();
    await waitFor(() => liveLogs.subscription !== null && service.snapshot().liveListenerConnected);
    liveLogs.emit([combatLog]);

    await waitFor(() => service.snapshot().latestSyncedBlock === String(0x181n));
    expect(service.snapshot()).toMatchObject({
      activeSource: "viem_ws",
      eventsReceived: 1,
      pollBacklogBlocks: "0"
    });
    service.stop();
  });

  test("keeps websocket-triggered canonical poll latency scoped to event indexing", async () => {
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const backfiller = new MockBackfiller(0x180n);
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });
    const combatLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xcombat-ws-sync-heal-enqueue",
      logIndex: "0x0",
      topics: [
        attackBattleResolvedTopic,
        topicWord(99n),
        ownerTopic(player),
        topicWord(8n)
      ],
      data: abiWords(1n, 2n, 3n, 4n)
    };
    backfiller.head = 0x181n;
    backfiller.logsFor = () => [combatLog];

    service.start();
    await waitFor(() => liveLogs.subscription !== null && service.snapshot().liveListenerConnected);
    liveLogs.emit([combatLog]);

    await waitFor(() => service.snapshot().latestSyncedBlock === String(0x181n));
    expect(service.snapshot()).toMatchObject({
      recentHandlerDurationMs: { count: 1 },
      slowHandlerCount300Ms: 0,
      slowHandlerCount1000Ms: 0
    });
    service.stop();
  });

  test("logs handler completion timing and warns for slow websocket-triggered canonical handlers", async () => {
    const backfiller = new MockBackfiller(0x180n);
    const liveLogs = new MockLiveLogSubscriber();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    const indexer = {
      applyLog: () => {
        const deadline = Date.now() + 320;
        while (Date.now() < deadline) {}
        return {
          applied: true,
          duplicate: false,
          ignored: false,
          removed: false,
          snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
        };
      },
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });
    const slowLog = {
      ...planetStartedLog("0x181", 7n, "0xslow"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    };
    backfiller.head = 0x181n;
    backfiller.logsFor = () => [slowLog];

    try {
      service.start();
      await waitFor(() => liveLogs.subscription !== null);
      liveLogs.emit([slowLog]);

      await waitFor(() => service.snapshot().slowHandlerCount300Ms === 1);
      expect(service.snapshot()).toMatchObject({
        activeSource: "viem_ws",
        eventsReceived: 1,
        recentHandlerDurationMs: { count: 1 },
        slowHandlerCount300Ms: 1,
        slowHandlerCount1000Ms: 0
      });
      expect(warnings.length).toBeGreaterThan(0);
      expect(JSON.parse(warnings.at(-1) ?? "{}")).toMatchObject({
        msg: "Veydrift chain event handled",
        source: "fallback_poll",
        eventTopic: planetStartedTopic,
        contractAddress: config.gameContractAddress,
        transactionHash: "0xslow",
        applyResult: { applied: true },
        sideEffects: { canonicalHealQueued: false }
      });
    } finally {
      console.warn = originalWarn;
      service.stop();
    }
  });

  test("keeps handler latency readiness window fresh without hiding cumulative slow counters", async () => {
    const baseTime = new Date("2026-06-24T19:20:00.000Z").getTime();
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    let applyCalls = 0;
    const indexer = {
      applyLog: (log: RpcLog) => {
        applyCalls += 1;
        if (log.transactionHash === "0xold-slow") {
          setSystemTime(new Date(baseTime + 1_500));
        } else {
          setSystemTime(new Date(baseTime + 62_012));
        }
        return {
          applied: true,
          duplicate: false,
          ignored: false,
          removed: false,
          snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
        };
      },
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const backfiller = new MockBackfiller(0x180n);
    const liveLogs = new MockLiveLogSubscriber();
    const service = new ChainSyncService(config, indexer, {
      liveLogSubscriber: liveLogs,
      logBackfiller: backfiller
    });

    try {
      service.start();
      await waitFor(() => liveLogs.subscription !== null);

      setSystemTime(new Date(baseTime));
      const oldSlowLog = {
        ...planetStartedLog("0x181", 7n, "0xold-slow"),
        address: config.gameContractAddress!,
        logIndex: "0x0"
      };
      backfiller.head = 0x181n;
      backfiller.logsFor = () => [oldSlowLog];
      liveLogs.emit([oldSlowLog]);
      await waitFor(() => applyCalls === 1);
      expect(service.snapshot()).toMatchObject({
        maxHandlerDurationMs: 1500,
        slowHandlerCount1000Ms: 1,
        recentHandlerDurationMs: { count: 1, p95: 1500, max: 1500 }
      });

      setSystemTime(new Date(baseTime + 62_000));
      const freshFastLog = {
        ...planetStartedLog("0x182", 8n, "0xfresh-fast"),
        address: config.gameContractAddress!,
        logIndex: "0x0"
      };
      backfiller.head = 0x182n;
      backfiller.logsFor = () => [oldSlowLog, freshFastLog];
      liveLogs.emit([freshFastLog]);
      await waitFor(() => applyCalls === 2);

      expect(service.snapshot()).toMatchObject({
        maxHandlerDurationMs: 1500,
        slowHandlerCount1000Ms: 1,
        recentHandlerDurationMs: {
          count: 1,
          p95: 12,
          max: 12,
          windowMs: 60_000,
          lastSampledAt: "2026-06-24T19:21:02.012Z"
        }
      });
    } finally {
      setSystemTime();
      console.warn = originalWarn;
      console.log = originalLog;
      service.stop();
    }
  });

  test("marks chain events that change the wallet planet roster", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x181n, () => [{
      ...planetStartedLog("0x181", 7n, "0xplanet"),
      logIndex: "0x0"
    }]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    const reader = service.eventStream().getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await service.poll();
    const event = await reader.read();
    const text = new TextDecoder().decode(event.value);

    expect(text).toContain("event: chain-event");
    expect(text).toContain("\"walletPlanetsChanged\":true");
    await reader.cancel();
    service.stop();
  });

  test("publishes exact planet and moon resource transactions for receipt-backed frontend refreshes", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x181n, () => [
      {
        blockNumber: "0x181",
        transactionHash: "0xresource-credit",
        logIndex: "0x2",
        topics: [planetSettledTopic, topicWord(7n)],
        data: abiWords(1_000n, 2_000n, 3_000n, 1_770_000_300n)
      },
      {
        blockNumber: "0x181",
        transactionHash: "0xmoon-credit",
        logIndex: "0x3",
        topics: [moonResourcesChangedTopic, topicWord(7n)],
        data: abiWords(4_000n, 5_000n, 6_000n)
      }
    ]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });
    const reader = service.eventStream().getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await service.poll();
    const event = await reader.read();
    const text = new TextDecoder().decode(event.value);

    expect(text).toContain('"resourceChanges":[{"bodyKind":"planet","blockNumber":"385","planetId":"7","transactionHash":"0xresource-credit"},{"bodyKind":"moon","blockNumber":"385","planetId":"7","transactionHash":"0xmoon-credit"}]');
    await reader.cancel();
    service.stop();
  });

  test("replays from configured base on the first poll, then replays a bounded tail", async () => {
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
    expect(indexer.snapshot()).toMatchObject({
      resourceProjectionBlock: String(0x192n),
      resourceProjectionHash: `0x${(0x192n).toString(16).padStart(64, "0")}`,
      resourceProjectionTimestamp: String(1_770_000_000n + 0x192n)
    });
    // The writer reads the anchor before and after scanning so a same-height reorg cannot publish
    // the pre-scan hash/timestamp against post-scan state.
    expect(backfiller.timestampCalls).toEqual([0x192n, 0x192n]);

    // Head advances; the next poll overlaps the last 64 cursor blocks through the new head.
    backfiller.head = 0x193n;
    await service.poll();
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x153n, to: 0x193n });
    expect(service.snapshot().latestSyncedBlock).toBe(String(0x193n));
    expect(indexer.snapshot()).toMatchObject({
      resourceProjectionBlock: String(0x193n),
      resourceProjectionTimestamp: String(1_770_000_000n + 0x193n)
    });

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

    expect(backfiller.ranges).toEqual([{ from: 0x141n, to: 0x182n }]);
    expect(indexer.snapshot().indexedPlanets).toBe(2);
    service.stop();
  });

  test("backfills a replacement referral contract before the shared cursor and persists an idempotent restart marker", async () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
    };
    const indexer = new SettlementIndexer(reader, 100n, { database });
    indexer.applyLog({
      ...planetStartedLog("0xb4", 7n, `0x${"11".repeat(32)}`),
      logIndex: "0x0"
    });
    database.query(`
      INSERT INTO indexed_referral_claims
        (event_id, owner, commitment, transaction_hash, block_number, event_json)
      VALUES (?, lower(?), lower(?), lower(?), ?, ?)
    `).run(
      "legacy-code-claim",
      player,
      `0x${"99".repeat(32)}`,
      `0x${"98".repeat(32)}`,
      "110",
      JSON.stringify({
        eventName: "ReferralCodeClaimed",
        inviter: player,
        commitment: `0x${"99".repeat(32)}`,
        transactionHash: `0x${"98".repeat(32)}`,
        blockNumber: "110"
      })
    );

    const referralConfig: BackendConfig = {
      ...config,
      referralIndexFromBlock: 112n,
      referralSystemAddress: referralAddress
    };
    const backfiller = new MockBackfiller(182n);
    backfiller.referralLogsFor = () => referralMigrationLogs();
    const service = new ChainSyncService(referralConfig, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(backfiller.referralRanges).toEqual([{ from: 112n, to: 182n }]);
    expect(backfiller.ranges).toEqual([{ from: 117n, to: 182n }]);
    expect(indexer.referralClaims(player)).toHaveLength(1);
    expect(indexer.referralClaims(player)[0]).toMatchObject({ code: "borodutch", migrated: true });
    expect(indexer.referralRedemptionsForInviter(player)).toHaveLength(1);
    expect(indexer.referralRewardClaimsForInviter(player)).toHaveLength(1);
    expect(service.snapshot().referralHistoryBackfill).toMatchObject({
      contractAddress: referralAddress,
      fromBlock: "112",
      inProgress: false,
      lastError: null,
      throughBlock: "182"
    });
    service.stop();

    const restartedIndexer = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
    const restartBackfiller = new MockBackfiller(182n);
    restartBackfiller.referralLogsFor = () => referralMigrationLogs();
    const restarted = new ChainSyncService(referralConfig, restartedIndexer, { logBackfiller: restartBackfiller });
    await restarted.poll();
    expect(restartBackfiller.referralRanges).toEqual([]);
    expect(restartedIndexer.referralClaims(player)).toHaveLength(1);
    restarted.stop();

    // Simulate an interrupted completion marker write: re-entry replays the same migration batch but
    // txHash:logIndex idempotency keeps every canonical projection at exactly one row.
    database.query("DELETE FROM indexer_metadata WHERE key = 'referralHistoryBackfillV1'").run();
    const retryBackfiller = new MockBackfiller(182n);
    retryBackfiller.referralLogsFor = () => referralMigrationLogs();
    const retry = new ChainSyncService(referralConfig, restartedIndexer, { logBackfiller: retryBackfiller });
    await retry.poll();
    expect(retryBackfiller.referralRanges).toEqual([{ from: 112n, to: 182n }]);
    expect(restartedIndexer.referralClaims(player)).toHaveLength(1);
    expect(restartedIndexer.referralRedemptionsForInviter(player)).toHaveLength(1);
    expect(restartedIndexer.referralRewardClaimsForInviter(player)).toHaveLength(1);
    retry.stop();
  });

  test("re-runs the bounded referral history gate when the configured referral address changes", async () => {
    const indexer = makeIndexer();
    indexer.recordReferralHistoryBackfill(referralAddress, 112n, 150n);
    const replacementAddress = "0x6666666666666666666666666666666666666666" as const;
    const replacementConfig: BackendConfig = {
      ...config,
      referralIndexFromBlock: 140n,
      referralSystemAddress: replacementAddress
    };
    const backfiller = new MockBackfiller(182n);
    const logs = referralMigrationLogs().map((log) => ({ ...log, address: replacementAddress }));
    backfiller.referralLogsFor = () => logs;
    const service = new ChainSyncService(replacementConfig, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(backfiller.referralRanges).toEqual([{ from: 140n, to: 182n }]);
    expect(indexer.referralClaims(player)).toHaveLength(1);
    expect(indexer.referralHistoryBackfillStatus(replacementAddress, 140n)).toMatchObject({
      required: false,
      marker: { contractAddress: replacementAddress, fromBlock: "140", throughBlock: "182" }
    });
    service.stop();
  });

  test("single-flights paid alliance invite history from its deployment block and persists completion", async () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
    };
    const indexer = new SettlementIndexer(reader, 100n, { database });
    const paidConfig: BackendConfig = {
      ...config,
      paidAllianceInviteAddress,
      paidAllianceInviteIndexFromBlock: 150n
    };
    const backfiller = new MockBackfiller(182n);
    backfiller.paidAllianceInviteLogsFor = () => [
      {
        address: paidAllianceInviteAddress,
        blockNumber: "0x98",
        transactionHash: "0xpaid-buy",
        logIndex: "0x0",
        topics: [paidAllianceInvitePurchasedTopic, topicWord(1n), topicWord(7n), ownerTopic(player)],
        data: abiWords(6_000_000_000_000_000n, 1_770_000_000n)
      },
      {
        address: paidAllianceInviteAddress,
        blockNumber: "0x99",
        transactionHash: "0xpaid-accrue",
        logIndex: "0x0",
        topics: [allianceProductionBonusAccruedTopic, topicWord(7n), ownerTopic(player)],
        data: abiWords(10n, 20n, 30n)
      }
    ];
    const service = new ChainSyncService(paidConfig, indexer, { logBackfiller: backfiller });

    await Promise.all(Array.from({ length: 10 }, () => service.poll()));

    expect(backfiller.paidAllianceInviteRanges).toEqual([{ from: 150n, to: 182n }]);
    expect(backfiller.ranges).toEqual([{ from: 100n, to: 182n }]);
    expect(backfiller.calls.slice(0, 2)).toEqual(["generic", "paid-alliance"]);
    expect(indexer.paidAllianceInviteSummaries().get("7")).toEqual({
      bonusBalance: { metal: "10", crystal: "20", deuterium: "30" },
      pendingBonusBalance: { metal: "0", crystal: "0", deuterium: "0" },
      privateInviteStats: { remaining: 1, used: 0 }
    });
    expect(service.snapshot()).toMatchObject({
      connected: true,
      paidAllianceInviteHistoryBackfill: {
        contractAddress: paidAllianceInviteAddress,
        fromBlock: "150",
        inProgress: false,
        lastError: null,
        throughBlock: "182"
      }
    });
    service.stop();

    const restartedIndexer = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
    const restartBackfiller = new MockBackfiller(182n);
    const restarted = new ChainSyncService(paidConfig, restartedIndexer, { logBackfiller: restartBackfiller });
    await restarted.poll();
    expect(restartBackfiller.paidAllianceInviteRanges).toEqual([]);
    expect(restartedIndexer.paidAllianceInviteSummaries().get("7")?.bonusBalance).toEqual({
      metal: "10",
      crystal: "20",
      deuterium: "30"
    });
    restarted.stop();
  });

  test("periodically reconciles paid alliance overlap and removes orphaned projections", async () => {
    const indexer = makeIndexer();
    const paidConfig: BackendConfig = {
      ...config,
      paidAllianceInviteAddress,
      paidAllianceInviteIndexFromBlock: 150n
    };
    const backfiller = new MockBackfiller(182n);
    const purchase = {
      address: paidAllianceInviteAddress,
      blockNumber: "0xb4",
      transactionHash: "0xpaid-reorg",
      logIndex: "0x0",
      topics: [paidAllianceInvitePurchasedTopic, topicWord(1n), topicWord(7n), ownerTopic(player)],
      data: abiWords(6_000_000_000_000_000n, 1_770_000_000n)
    };
    backfiller.paidAllianceInviteLogsFor = () => [purchase];
    const service = new ChainSyncService(paidConfig, indexer, { logBackfiller: backfiller });

    await service.poll();
    expect(indexer.paidAllianceInviteSummaries().get("7")?.privateInviteStats.remaining).toBe(1);

    backfiller.head = 198n;
    backfiller.paidAllianceInviteLogsFor = () => [];
    await service.poll();

    expect(backfiller.paidAllianceInviteRanges.at(-1)).toEqual({ from: 150n, to: 198n });
    expect(indexer.paidAllianceInviteSummaries().get("7")).toBeUndefined();
    service.stop();
  });

  test("replays timed missile payloads from the upgrade boundary after an old-backend rollback", async () => {
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
    }, 100n, { database, runStartupBackfill: false });
    const tx = "0xmissile-rollback";
    const launchLogs: TestLog[] = [
      {
        address: config.gameContractAddress!,
        blockNumber: "0xa0",
        transactionHash: tx,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topicWord(51n), ownerTopic(player), topicWord(7n)],
        data: abiWords(99n, 7n, 1770001200n, 1770001200n, 0n)
      },
      {
        address: config.gameContractAddress!,
        blockNumber: "0xa0",
        transactionHash: tx,
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topicWord(51n)],
        data: abiWords(0n, 0n, 0n, 0n)
      },
      {
        address: config.gameContractAddress!,
        blockNumber: "0xa0",
        transactionHash: tx,
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topicWord(51n)],
        data: abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
      }
    ];
    for (const log of launchLogs) indexer.applyLog(log);
    const payloadLog: TestLog = {
      address: config.gameContractAddress!,
      blockNumber: "0xa0",
      transactionHash: tx,
      logIndex: "0x3",
      topics: [interplanetaryMissileLaunchedTopic, topicWord(51n)],
      data: abiWords(4n, 3n)
    };
    database.query(`
      INSERT INTO indexed_event_logs
        (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(
      `${tx}:0x3`,
      tx,
      "0x3",
      "160",
      JSON.stringify(payloadLog),
      new Date().toISOString()
    );
    const headLog = {
      ...planetStartedLog("0x12c", 88n, "0xhead"),
      address: config.gameContractAddress!,
      logIndex: "0x0"
    };
    indexer.applyLog(headLog);
    expect(indexer.fleetMission("51")).not.toHaveProperty("missileQuantity");

    const backfiller = new MockBackfiller(300n, (from, to) => (
      from <= 300n && to !== "latest" && to >= 300n ? [headLog] : []
    ));
    backfiller.timedMissilePayloadLogsFor = () => [payloadLog];
    const service = new ChainSyncService({
      ...config,
      timedMissileIndexFromBlock: 150n
    }, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(backfiller.timedMissilePayloadRanges).toEqual([{ from: 150n, to: 300n }]);
    expect(indexer.fleetMission("51")).toMatchObject({
      missilePrimaryTargetId: 4,
      missileQuantity: 3
    });
    expect(service.snapshot().timedMissilePayloadHistoryBackfill).toMatchObject({
      contractAddress: config.gameContractAddress,
      fromBlock: "150",
      inProgress: false,
      lastError: null,
      throughBlock: "300"
    });

    backfiller.head = 316n;
    backfiller.timedMissilePayloadLogsFor = () => [];
    await service.poll();
    expect(backfiller.timedMissilePayloadRanges.at(-1)).toEqual({ from: 236n, to: 316n });
    service.stop();
  });

  test("keeps readiness disconnected and retries when referral history backfill fails", async () => {
    const indexer = makeIndexer();
    const referralConfig: BackendConfig = {
      ...config,
      referralIndexFromBlock: 112n,
      referralSystemAddress: referralAddress
    };
    const backfiller = new MockBackfiller(182n);
    backfiller.referralLogsError = new Error("replacement referral history unavailable");
    const service = new ChainSyncService(referralConfig, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(service.snapshot()).toMatchObject({
      connected: false,
      lastError: "replacement referral history unavailable",
      referralHistoryBackfill: {
        inProgress: false,
        lastError: "replacement referral history unavailable",
        throughBlock: null
      }
    });
    expect(indexer.referralHistoryBackfillStatus(referralAddress, 112n).required).toBe(true);

    backfiller.referralLogsError = null;
    backfiller.referralLogsFor = () => referralMigrationLogs();
    await service.poll();

    expect(service.snapshot()).toMatchObject({
      connected: true,
      lastError: null,
      referralHistoryBackfill: { inProgress: false, lastError: null, throughBlock: "182" }
    });
    expect(backfiller.referralRanges).toEqual([
      { from: 112n, to: 182n },
      { from: 112n, to: 182n }
    ]);
    expect(indexer.referralClaims(player)).toHaveLength(1);
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
    const originalApplyLog = indexer.applyLog.bind(indexer);
    let applyAttempts = 0;
    indexer.applyLog = (log) => {
      applyAttempts += 1;
      return originalApplyLog(log);
    };
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
    const attemptsAfterFirst = applyAttempts;
    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(5);

    // Force another ingest returning the SAME already-applied logs: the absolute-SET stays 5 and the
    // deduped logs (same txHash:logIndex) are not re-counted.
    backfiller.head = 0x183n;
    await service.poll();
    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(5);
    expect(service.snapshot().eventsReceived).toBe(afterFirst); // duplicates not re-counted
    // The HTTP safety overlap remains enabled for websocket-missed siblings, but exact events already
    // processed in this process do not need another SQLite dedupe transaction.
    expect(applyAttempts).toBe(attemptsAfterFirst);
    service.stop();
  });

  test("a transient poll failure records the error, keeps the cursor, and recovers next tick", async () => {
    const indexer = makeIndexer();
    const seeded = planetStartedLog("0x181", 7n, "0xseed");
    const backfiller = new MockBackfiller(0x180n, (from, to) =>
      from <= 0x181n && to !== "latest" && to >= 0x181n ? [seeded] : []
    );
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // replay through 0x180, no logs
    expect(indexer.snapshot().resourceProjectionBlock).toBe(String(0x180n));
    // Head moved, but the ingest getLogs fails transiently. Cursor must NOT advance.
    backfiller.head = 0x182n;
    backfiller.logsError = new Error("Unexpected end of JSON input");
    await service.poll();
    expect(service.snapshot().lastError).toContain("Unexpected end of JSON input");
    expect(service.snapshot().connected).toBe(true); // one blip never flaps readiness
    expect(indexer.snapshot().indexedPlanets).toBe(0); // nothing applied
    expect(indexer.snapshot().resourceProjectionBlock).toBe(String(0x180n));

    // RPC recovers; the same range is retried and the log is finally applied — no event lost.
    backfiller.logsError = null;
    await service.poll();
    expect(backfiller.ranges.at(-1)).toEqual({ from: 0x141n, to: 0x182n });
    expect(indexer.snapshot().indexedPlanets).toBeGreaterThanOrEqual(1);
    expect(indexer.snapshot().resourceProjectionBlock).toBe(String(0x182n));
    expect(service.snapshot().lastError).toBeNull();
    service.stop();
  });

  test("invalidates spendable projections when the canonical head rolls back", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();
    expect(indexer.resourceProjectionContext().safeToProject).toBe(true);

    backfiller.head = 0x17fn;
    await service.poll();

    expect(indexer.snapshot()).toMatchObject({
      pendingReconciliationReason: "resource_projection_invalidated: canonical block anchor changed",
      resourceProjectionBlock: String(0x17fn)
    });
    expect(indexer.resourceProjectionContext().safeToProject).toBe(false);
    service.stop();
  });

  test("invalidates spendable projections when a same-height canonical block hash changes", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();
    expect(indexer.resourceProjectionContext().safeToProject).toBe(true);

    backfiller.anchorHashFor = () => `0x${"f".repeat(64)}`;
    await service.poll();

    expect(indexer.snapshot()).toMatchObject({
      pendingReconciliationReason: "resource_projection_invalidated: canonical block anchor changed",
      resourceProjectionHash: `0x${"f".repeat(64)}`
    });
    expect(indexer.resourceProjectionContext().safeToProject).toBe(false);
    service.stop();
  });

  test("does not publish a projection watermark when the canonical head changes during the scan", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    let anchorReads = 0;
    backfiller.anchorHashFor = () => {
      anchorReads += 1;
      return anchorReads === 1 ? `0x${"1".repeat(64)}` : `0x${"2".repeat(64)}`;
    };
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(indexer.snapshot()).toMatchObject({
      pendingReconciliationReason: "resource_projection_invalidated: canonical head changed during scan",
      resourceProjectionBlock: null,
      resourceProjectionHash: null
    });
    expect(indexer.resourceProjectionContext().safeToProject).toBe(false);
    service.stop();
  });

  test("does not publish an older poll clock when websocket ingestion advances during verification", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    let anchorReads = 0;
    backfiller.anchorHashFor = (blockNumber) => {
      anchorReads += 1;
      if (anchorReads === 2) {
        indexer.applyLog(planetStartedLog("0x181", 7n, "0xws-ahead-during-poll"));
      }
      return `0x${blockNumber.toString(16).padStart(64, "0")}`;
    };
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(indexer.snapshot().latestIndexedBlock).toBe(String(0x181n));
    expect(indexer.resourceProjectionContext()).toMatchObject({
      block: null,
      safeToProject: false,
      timestamp: null
    });
    service.stop();
  });

  test("sorts live polled logs by block and logIndex before applying them", async () => {
    const indexer = makeIndexer();
    const logs: TestLog[] = [
      {
        blockNumber: "0x181",
        transactionHash: "0xship-newer",
        logIndex: "0x2",
        topics: [planetShipCountChangedTopic, topicWord(7n), topicWord(1n)],
        data: abiWords(9n)
      },
      planetStartedLog("0x180", 7n, "0xplanet"),
      {
        blockNumber: "0x181",
        transactionHash: "0xship-older",
        logIndex: "0x1",
        topics: [planetShipCountChangedTopic, topicWord(7n), topicWord(1n)],
        data: abiWords(4n)
      }
    ];
    const backfiller = new MockBackfiller(0x181n, () => logs);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(9);
    service.stop();
  });

  test("does not canonical-heal applied combat settlement logs", async () => {
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const combatLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xcombat",
      logIndex: "0x0",
      topics: [
        attackBattleResolvedTopic,
        topicWord(99n), // mission id
        ownerTopic(player),
        topicWord(8n) // target planet id
      ],
      data: abiWords(1n, 2n, 3n, 4n)
    };
    const backfiller = new MockBackfiller(0x181n, () => [combatLog]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(service.snapshot()).toMatchObject({
      latestSyncedBlock: String(0x181n),
      pollBacklogBlocks: "0"
    });
    service.stop();
  });

  test("keeps live poll event-only for combat settlement logs", async () => {
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const combatLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xcombat-slow-heal",
      logIndex: "0x0",
      topics: [
        attackBattleResolvedTopic,
        topicWord(99n),
        ownerTopic(player),
        topicWord(8n)
      ],
      data: abiWords(1n, 2n, 3n, 4n)
    };
    const backfiller = new MockBackfiller(0x181n, () => [combatLog]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(service.snapshot()).toMatchObject({
      latestSyncedBlock: String(0x181n),
      pollBacklogBlocks: "0"
    });
    service.stop();
  });

  test("surfaces poll timing, getLogs range, backlog, and recent receive lag metrics", async () => {
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>
    };
    const blockTimestamp = Math.floor(Date.now() / 1000) - 3;
    const log: TestLog & { blockTimestamp: string } = {
      ...planetStartedLog("0x181", 7n, "0xlagged"),
      blockTimestamp: blockTimestamp.toString(),
      logIndex: "0x0"
    };
    const backfiller = new MockBackfiller(0x182n, () => [log]);
    const published: Array<ReturnType<ChainSyncService["snapshot"]>> = [];
    const service = new ChainSyncService(config, indexer, {
      logBackfiller: backfiller,
      diagnosticsPublisher: (snapshot) => published.push(snapshot)
    });

    await service.poll();

    expect(service.snapshot()).toMatchObject({
      lastGetLogsRange: { fromBlock: "321", toBlock: "386" },
      latestHeadBlock: "386",
      latestSyncedBlock: "386",
      pollBacklogBlocks: "0",
      pollBacklogMs: 0,
      recentEventReceiveLagMs: {
        count: 1
      }
    });
    expect(service.snapshot().lastPollDurationMs).toBeGreaterThanOrEqual(0);
    expect(service.snapshot().lastGetLogsDurationMs).toBeGreaterThanOrEqual(0);
    expect(service.snapshot().recentEventReceiveLagMs.p95).toBeGreaterThanOrEqual(2_000);
    expect(published.at(-1)).toMatchObject({
      lastGetLogsRange: { fromBlock: "321", toBlock: "386" },
      latestHeadBlock: "386",
      latestSyncedBlock: "386",
      pollBacklogBlocks: "0",
      recentEventReceiveLagMs: { count: 1 }
    });
    service.stop();
  });

  test("does not canonical-heal ordinary return exposure logs", async () => {
    const healCalls: string[][] = [];
    const indexer = {
      applyLog: () => ({
        applied: true,
        duplicate: false,
        ignored: false,
        removed: false,
        snapshot: {} as ReturnType<SettlementIndexer["snapshot"]>
      }),
      snapshot: () => ({ latestIndexedBlock: "0x180" }) as ReturnType<SettlementIndexer["snapshot"]>,
      healCanonicalPlanets: async (planetIds: string[]) => {
        healCalls.push(planetIds);
      }
    };
    const returnLog: TestLog = {
      blockNumber: "0x181",
      transactionHash: "0xreturn-exposed",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topicWord(42n), ownerTopic(player)],
      data: abiWords(12n, 23n, 2n, 5n)
    };
    const backfiller = new MockBackfiller(0x181n, () => [returnLog]);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(healCalls).toEqual([]);
    service.stop();
  });

  test("does not canonical-heal ordinary fleet-return logs", async () => {
    let canonicalReads = 0;
    const indexer = new SettlementIndexer(
      {
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; },
        async getCanonicalPlanetState(planetId: bigint) {
          canonicalReads += 1;
          expect(planetId).toBe(83n);
          return {
            planetId: "83",
            resources: { metal: "0", crystal: "0", deuterium: "0" },
            buildings: [],
            defenses: [],
            ships: [
              { id: 0, count: 34, cost: { metal: "0", crystal: "0", deuterium: "0" } },
              { id: 1, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
              { id: 4, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } },
              { id: 5, count: 5, cost: { metal: "0", crystal: "0", deuterium: "0" } }
            ],
            queues: {
              building: null,
              defense: null,
              ship: null
            }
          };
        }
      },
      100n
    );
    const logs: TestLog[] = [
      planetStartedLog("0x180", 83n, "0xplanet83"),
      {
        blockNumber: "0x180",
        transactionHash: "0xstale-zero",
        logIndex: "0x1",
        topics: [planetShipCountChangedTopic, topicWord(83n), topicWord(0n)],
        data: abiWords(0n)
      },
      {
        blockNumber: "0x181",
        transactionHash: "0xreturn83",
        logIndex: "0x0",
        topics: [fleetMissionReturnedTopic, topicWord(2582n), ownerTopic(player), topicWord(83n)],
        data: "0x"
      }
    ];
    const backfiller = new MockBackfiller(0x181n, () => logs);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();

    expect(canonicalReads).toBe(0);
    expect(indexer.shipRows("83").filter((ship) => ship.count > 0)).toEqual([]);
    expect(service.snapshot().latestSyncedBlock).toBe(String(0x181n));
    service.stop();
  });

  test("an applyLog failure aborts the range so the next poll retries it", async () => {
    const indexer = makeIndexer();
    let attempt = 0;
    const badPlanetLog: TestLog = {
      ...planetStartedLog("0x181", 7n, "0xbad-planet"),
      logIndex: "0x0",
      data: "0x"
    };
    const goodPlanetLog: TestLog = {
      ...planetStartedLog("0x181", 7n, "0xgood-planet"),
      logIndex: "0x0"
    };
    const backfiller = new MockBackfiller(0x181n, () => {
      attempt += 1;
      return attempt === 1 ? [badPlanetLog] : [goodPlanetLog];
    });
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll();
    expect(service.snapshot().lastError).toBeTruthy();
    expect(indexer.snapshot().indexedPlanets).toBe(0);

    await service.poll();
    expect(backfiller.ranges).toEqual([
      { from: 100n, to: 0x181n },
      { from: 100n, to: 0x181n }
    ]);
    expect(indexer.snapshot().indexedPlanets).toBe(1);
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

  test("marks indexed state unsafe when the RPC head is pinned across sustained polls", async () => {
    const indexer = makeIndexer();
    const backfiller = new MockBackfiller(0x180n);
    const service = new ChainSyncService(config, indexer, { logBackfiller: backfiller });

    await service.poll(); // healthy anchor
    expect(service.snapshot().connected).toBe(true);

    for (let i = 0; i < 29; i += 1) await service.poll();
    expect(service.snapshot().connected).toBe(true);

    await service.poll();
    expect(service.snapshot()).toMatchObject({
      connected: false,
      headStallPollCount: 30,
      lastError: "RPC head stalled at block 384; failed over to fallback RPC",
      latestHeadBlock: "384"
    });
    expect(backfiller.failoverReasons).toEqual(["rpc_head_stalled:384"]);
    expect(indexer.snapshot()).toMatchObject({
      pendingReconciliationReason: "rpc_head_stalled:384",
      safeToServeIndexedState: false,
      staleReason: "rpc_head_stalled:384"
    });

    backfiller.head = 0x181n;
    await service.poll();
    expect(service.snapshot()).toMatchObject({
      connected: true,
      headStallPollCount: 0,
      lastError: null,
      latestHeadBlock: "385"
    });
    expect(indexer.snapshot().pendingReconciliationReason).toBeNull();
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
