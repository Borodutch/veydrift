import { describe, expect, test } from "bun:test";
import { ChainSyncService } from "./chainSync";
import type { BackendConfig } from "./config";
import type { SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222";
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const debrisFieldUpdatedTopic = "0x49f79a15c2a0409be62598b886efd90e25154bb9156b4bd64df41fd515aa4909";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
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

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  sent: string[] = [];
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.onclose?.(new Event("close"));
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  message(payload: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

describe("ChainSyncService", () => {
  test("subscribes to logs and new heads, then applies settlement logs to the indexer", () => {
    MockWebSocket.instances = [];
    const indexer = new SettlementIndexer(
      {
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
      },
      100n
    );
    const service = new ChainSyncService(config, indexer, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toBe(config.wsRpcUrl);
    socket?.open();

    expect(socket?.sent.map((item) => JSON.parse(item).params[0])).toEqual(["logs", "newHeads"]);
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    expect(service.snapshot()).toMatchObject({
      connected: true,
      subscribedToHeads: true,
      subscribedToLogs: true
    });

    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "heads-sub",
        result: { number: "0x7b" }
      }
    });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7c",
          transactionHash: "0xabc",
          topics: [
            planetStartedTopic,
            `0x${player.slice(2).padStart(64, "0")}`,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(2n, 44n, 9n, 211n, 1n)
        }
      }
    });

    expect(service.snapshot()).toMatchObject({
      eventsReceived: 1,
      latestSyncedBlock: "124"
    });
    expect(indexer.settledPlanetsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        owner: player,
        planetId: "7",
        position: 9
      })
    ]);

    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7d",
          transactionHash: "0xdef",
          topics: [
            debrisFieldUpdatedTopic,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(27_000n, 9_000n)
        }
      }
    });

    expect(indexer.debrisFieldsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        planetId: "7",
        position: 9,
        resources: {
          metal: "27000",
          crystal: "9000"
        }
      })
    ]);

    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7e",
          transactionHash: "0xfeed",
          topics: [
            debrisFieldUpdatedTopic,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(0n, 0n)
        }
      }
    });

    expect(indexer.debrisFieldsInSystem(2, 44)).toEqual([]);

    service.stop();
  });

  test("applies websocket logs incrementally without refreshing planets from chain", () => {
    MockWebSocket.instances = [];
    const applyLogCalls: unknown[] = [];
    let rebuildPlanetsCalls = 0;
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog(log: unknown) {
        applyLogCalls.push(log);
        return {
          applied: true,
          duplicate: false,
          ignored: false,
          removed: false,
          snapshot: {}
        };
      },
      async rebuildPlanets() {
        rebuildPlanetsCalls += 1;
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7c",
          transactionHash: "0xabc",
          topics: [
            planetStartedTopic,
            `0x${player.slice(2).padStart(64, "0")}`,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(2n, 44n, 9n, 211n, 1n)
        }
      }
    });

    expect(applyLogCalls).toHaveLength(1);
    expect(rebuildPlanetsCalls).toBe(0);
    expect(service.snapshot()).toMatchObject({
      eventsReceived: 1,
      latestSyncedBlock: "124"
    });
    service.stop();
  });

  test("reconnects after websocket close", async () => {
    MockWebSocket.instances = [];
    const service = new ChainSyncService(config, undefined, {
      WebSocketCtor: MockWebSocket,
      reconnectBaseMs: 1
    });

    service.start();
    MockWebSocket.instances[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(MockWebSocket.instances).toHaveLength(2);
    service.stop();
  });

  test("applies websocket logs incrementally without rebuilding all planets", async () => {
    MockWebSocket.instances = [];
    let appliedLogs = 0;
    let planetRebuilds = 0;
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog() {
        appliedLogs += 1;
        return {
          applied: true,
          duplicate: false,
          ignored: false,
          removed: false,
          snapshot: {}
        };
      },
      async rebuildPlanets() {
        planetRebuilds += 1;
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7c",
          transactionHash: "0xabc",
          topics: [planetStartedTopic],
          data: "0x"
        }
      }
    });
    await Promise.resolve();

    expect(appliedLogs).toBe(1);
    expect(planetRebuilds).toBe(0);
    service.stop();
  });

  test("marks websocket head gaps stale and triggers reconciliation", async () => {
    MockWebSocket.instances = [];
    const staleReasons: string[] = [];
    const reconcileReasons: string[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      markStale(reason: string) {
        staleReasons.push(reason);
      },
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, { WebSocketCtor: MockWebSocket });
    const syncStatusBlocks: Array<string | null> = [];
    service.addListener((event) => {
      if (event.kind === "sync-status") {
        syncStatusBlocks.push(event.blockNumber);
      }
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "heads-sub",
        result: { number: "0x7b" }
      }
    });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "heads-sub",
        result: { number: "0x7f" }
      }
    });
    await Promise.resolve();

    expect(service.snapshot()).toMatchObject({
      detectedGaps: 1,
      lastGap: {
        fromBlock: "124",
        toBlock: "127"
      },
      latestWebsocketBlock: "127"
    });
    expect(staleReasons).toEqual(["websocket head gap 124-127"]);
    expect(reconcileReasons).toEqual(["websocket head gap 124-127"]);
    expect(syncStatusBlocks).toEqual(expect.arrayContaining(["123", "127"]));
    service.stop();
  });

  test("applies queue logs incrementally without rebuilding canonical state", async () => {
    MockWebSocket.instances = [];
    const appliedLogs: Array<{ blockTimestamp?: string; transactionHash: string }> = [];
    const staleReasons: string[] = [];
    const rebuildReasons: string[] = [];
    const reconcileReasons: string[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog(log: { blockTimestamp?: string; transactionHash: string; removed?: boolean }) {
        appliedLogs.push(log);
        return {
          applied: true,
          duplicate: false,
          ignored: false,
          removed: log.removed === true,
          snapshot: {}
        };
      },
      markStale(reason: string) {
        staleReasons.push(reason);
      },
      async rebuildPlanets() {
        rebuildReasons.push("rebuildPlanets");
      },
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "heads-sub",
        result: {
          number: "0x90",
          timestamp: "0x69801c90"
        }
      }
    });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x90",
          transactionHash: "0xqueue-start",
          topics: [
            buildingStartedTopic,
            `0x${(7n).toString(16).padStart(64, "0")}`,
            `0x${(6n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(2n, 1770002000n, 100n, 50n, 0n)
        }
      }
    });
    await Promise.resolve();

    expect(appliedLogs).toEqual([
      expect.objectContaining({
        blockTimestamp: "1770003600",
        transactionHash: "0xqueue-start"
      })
    ]);
    expect(rebuildReasons).toEqual([]);
    expect(reconcileReasons).toEqual([]);
    expect(staleReasons).toEqual([]);
    expect(service.snapshot()).toMatchObject({
      eventsReceived: 1,
      latestSyncedBlock: "144"
    });
    service.stop();
  });

  test("subscribes to every configured contract address and exposes reorg health", () => {
    MockWebSocket.instances = [];
    const service = new ChainSyncService({
      ...config,
      allianceContractAddress: "0x4444444444444444444444444444444444444444",
      moonContractAddress: "0x5555555555555555555555555555555555555555",
      resourceTokenAddresses: {
        metal: "0x6666666666666666666666666666666666666666",
        crystal: "0x7777777777777777777777777777777777777777",
        deuterium: "0x8888888888888888888888888888888888888888"
      }
    }, undefined, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    const logSubscribe = JSON.parse(socket?.sent[0] ?? "{}");
    expect(logSubscribe.params[1].address).toEqual([
      "0x3333333333333333333333333333333333333333",
      "0x5555555555555555555555555555555555555555",
      "0x4444444444444444444444444444444444444444",
      "0x6666666666666666666666666666666666666666",
      "0x7777777777777777777777777777777777777777",
      "0x8888888888888888888888888888888888888888"
    ]);
    expect(service.snapshot().subscribedAddresses).toEqual(logSubscribe.params[1].address);

    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7c",
          transactionHash: "0xabc",
          removed: true,
          topics: [
            planetStartedTopic,
            `0x${player.slice(2).padStart(64, "0")}`,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(2n, 44n, 9n, 211n, 1n)
        }
      }
    });

    expect(service.snapshot()).toMatchObject({
      eventsReceived: 1,
      reorgDetectedAt: expect.any(String)
    });
    service.stop();
  });

  test("backfills only the missed range on reconnect instead of a full rebuild", async () => {
    MockWebSocket.instances = [];
    const backfillCalls: Array<{ from: bigint; to: bigint | "latest" }> = [];
    const appliedLogs: unknown[] = [];
    let reconcileCalls = 0;
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog(log: unknown) {
        appliedLogs.push(log);
        return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: {} };
      },
      markStale() {},
      async reconcile() {
        reconcileCalls += 1;
      }
    };
    const backfiller = {
      async listContractLogs(from: bigint, to?: bigint | "latest") {
        backfillCalls.push({ from, to: to ?? "latest" });
        return [{ blockNumber: "0x80", transactionHash: "0xnew", topics: [planetStartedTopic], data: "0x" }];
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      reconnectBaseMs: 1,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({
      method: "eth_subscription",
      params: { subscription: "heads-sub", result: { number: "0x7b" } }
    });

    socket?.close();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reconnected = MockWebSocket.instances[1];
    reconnected?.open();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(backfillCalls).toEqual([{ from: 124n, to: "latest" }]);
    expect(appliedLogs).toHaveLength(1);
    expect(reconcileCalls).toBe(0);
    service.stop();
  });

  test("throttles full reconciliations so a flapping websocket cannot storm rebuilds", async () => {
    MockWebSocket.instances = [];
    const reconcileReasons: string[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      markStale() {},
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      reconcileThrottleMs: 10_000
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x7b" } } });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x7f" } } });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x85" } } });
    await Promise.resolve();

    // First gap reconciles; the second gap is collapsed into a throttled trailing pass.
    expect(reconcileReasons).toEqual(["websocket head gap 124-127"]);
    service.stop();
  });

  test("sends a liveness probe when the websocket is quiet but alive", async () => {
    MockWebSocket.instances = [];
    const service = new ChainSyncService(config, undefined, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 2,
      heartbeatTimeoutMs: 1_000
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const pings = (socket?.sent ?? [])
      .map((item) => JSON.parse(item))
      .filter((message) => message.method === "eth_blockNumber");
    expect(pings.length).toBeGreaterThanOrEqual(1);
    service.stop();
  });

  test("forces a reconnect when the websocket goes silent past the heartbeat timeout", async () => {
    MockWebSocket.instances = [];
    const service = new ChainSyncService(config, undefined, {
      WebSocketCtor: MockWebSocket,
      reconnectBaseMs: 1,
      heartbeatIntervalMs: 2,
      heartbeatTimeoutMs: 6
    });

    service.start();
    MockWebSocket.instances[0]?.open();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    service.stop();
  });

  test("self-heals a live log the provider silently dropped by replaying a recent range", async () => {
    MockWebSocket.instances = [];
    const seen = new Set<string>();
    const appliedHashes: string[] = [];
    const backfillRanges: Array<{ from: bigint; to: bigint | "latest" }> = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog(log: { transactionHash: string }) {
        if (seen.has(log.transactionHash)) {
          return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: {} };
        }
        seen.add(log.transactionHash);
        appliedHashes.push(log.transactionHash);
        return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: {} };
      },
      markStale() {},
      async reconcile() {}
    };
    const backfiller = {
      async listContractLogs(from: bigint, to?: bigint | "latest") {
        backfillRanges.push({ from, to: to ?? "latest" });
        // A log that was never delivered over the live `logs` subscription.
        return [{ blockNumber: "0x18e", transactionHash: "0xdropped", topics: [planetStartedTopic], data: "0x" }];
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller,
      selfHealIntervalMs: 2,
      selfHealDepthBlocks: 50
    });
    const chainEventBlocks: Array<string | null> = [];
    service.addListener((event) => {
      if (event.kind === "chain-event") chainEventBlocks.push(event.blockNumber);
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    // Establish a recent block anchor (block 400) while the log at block 398 is never delivered.
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x190" } } });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Re-scans only the recent depth window (400 - 50 + 1 = 351 .. latest), not the whole index.
    expect(backfillRanges[0]).toEqual({ from: 351n, to: "latest" });
    // The dropped log is recovered exactly once; further passes are idempotent no-ops.
    expect(appliedHashes).toEqual(["0xdropped"]);
    const snapshot = service.snapshot();
    expect(snapshot.selfHealRecoveredEvents).toBe(1);
    expect(snapshot.lastSelfHealAt).toEqual(expect.any(String));
    // Recovering a dropped log emits a chain-event so read caches/SSE clients refresh.
    expect(chainEventBlocks).toContain("400");
    service.stop();
  });

  test("self-heal stays quiet when no live events were dropped", async () => {
    MockWebSocket.instances = [];
    const backfillCalls: bigint[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog() {
        // Everything in the recent range is already indexed.
        return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: {} };
      },
      markStale() {},
      async reconcile() {}
    };
    const backfiller = {
      async listContractLogs(from: bigint) {
        backfillCalls.push(from);
        return [{ blockNumber: "0x18e", transactionHash: "0xknown", topics: [planetStartedTopic], data: "0x" }];
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller,
      selfHealIntervalMs: 2,
      selfHealDepthBlocks: 50
    });
    const chainEventBlocks: Array<string | null> = [];
    service.addListener((event) => {
      if (event.kind === "chain-event") chainEventBlocks.push(event.blockNumber);
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x190" } } });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // The self-heal pass still ran (range was scanned)...
    expect(backfillCalls.length).toBeGreaterThanOrEqual(1);
    const snapshot = service.snapshot();
    expect(snapshot.lastSelfHealAt).toEqual(expect.any(String));
    // ...but recovered nothing and emitted no spurious chain-events.
    expect(snapshot.selfHealRecoveredEvents).toBe(0);
    expect(chainEventBlocks).toEqual([]);
    service.stop();
  });

  test("self-heal restores stale planet state into the real indexer after a dropped log", async () => {
    MockWebSocket.instances = [];
    const indexer = new SettlementIndexer(
      {
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
      },
      100n
    );
    // The SettledPlanet log for planet 7 in system (2,44) is never delivered live, so the
    // indexer is stale: the planet is missing from query results.
    const droppedLog = {
      blockNumber: "0x7c",
      transactionHash: "0xhealed",
      topics: [
        planetStartedTopic,
        `0x${player.slice(2).padStart(64, "0")}`,
        `0x${(7n).toString(16).padStart(64, "0")}`
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    };
    const backfiller = {
      async listContractLogs() { return [droppedLog]; }
    };
    const service = new ChainSyncService(config, indexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller,
      selfHealIntervalMs: 2,
      selfHealDepthBlocks: 50
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    // Anchor at block 124 (0x7c) with the dropped log's block inside the self-heal window.
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x7c" } } });
    // Stale before self-heal runs.
    expect(indexer.settledPlanetsInSystem(2, 44)).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // The self-heal pass replayed the dropped log and restored the planet into query results.
    expect(indexer.settledPlanetsInSystem(2, 44)).toEqual([
      expect.objectContaining({ owner: player, planetId: "7", position: 9 })
    ]);
    expect(service.snapshot().selfHealRecoveredEvents).toBe(1);
    service.stop();
  });

  test("falls back to a full reconcile when a gap recovery collides with an in-flight backfill", async () => {
    MockWebSocket.instances = [];
    const reconcileReasons: string[] = [];
    let releaseBackfill: (() => void) | undefined;
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog() {
        return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: {} };
      },
      markStale() {},
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const backfiller = {
      // Block the first backfill mid-flight so the slot stays occupied while a gap arrives.
      listContractLogs() {
        return new Promise<never[]>((resolve) => {
          releaseBackfill = () => resolve([]);
        });
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller,
      selfHealIntervalMs: 2,
      selfHealDepthBlocks: 50
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x190" } } });

    // Let a self-heal tick start a backfill that never resolves (slot now occupied).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(releaseBackfill).toBeDefined();

    // A head gap arrives while the backfill slot is busy.
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x1a0" } } });
    await Promise.resolve();

    // The known gap is not dropped: it falls back to a throttled full reconcile.
    expect(reconcileReasons).toEqual([expect.stringContaining("websocket head gap")]);

    releaseBackfill?.();
    service.stop();
  });

  test("self-heal is disabled when the interval is zero", async () => {
    MockWebSocket.instances = [];
    let backfillCalls = 0;
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      applyLog() {
        return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: {} };
      },
      markStale() {},
      async reconcile() {}
    };
    const backfiller = {
      async listContractLogs() {
        backfillCalls += 1;
        return [];
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      logBackfiller: backfiller,
      selfHealIntervalMs: 0
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    socket?.message({ method: "eth_subscription", params: { subscription: "heads-sub", result: { number: "0x190" } } });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(backfillCalls).toBe(0);
    expect(service.snapshot().lastSelfHealAt).toBeNull();
    expect(service.snapshot().selfHealRecoveredEvents).toBe(0);
    service.stop();
  });

  test("periodically reconciles the canonical read-model against on-chain getters", async () => {
    MockWebSocket.instances = [];
    const reconcileReasons: string[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      markStale() {},
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      canonicalReconcileIntervalMs: 2
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // The bounded periodic timer refreshes canonical state from the authoritative getters
    // even when no gap, reorg, or dropped log was ever detected.
    expect(reconcileReasons).toContain("periodic canonical reconcile");
    service.stop();
  });

  test("periodic canonical reconcile is disabled when the interval is zero", async () => {
    MockWebSocket.instances = [];
    const reconcileReasons: string[] = [];
    const indexer = {
      applyDebrisEvent() {},
      applyEvent() {},
      applyMoonChanceEvent() {},
      markStale() {},
      async reconcile(reason: string) {
        reconcileReasons.push(reason);
      }
    };
    const service = new ChainSyncService(config, indexer as unknown as SettlementIndexer, {
      WebSocketCtor: MockWebSocket,
      heartbeatIntervalMs: 0,
      canonicalReconcileIntervalMs: 0
    });

    service.start();
    const socket = MockWebSocket.instances[0];
    socket?.open();
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reconcileReasons).not.toContain("periodic canonical reconcile");
    service.stop();
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}
