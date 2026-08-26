import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient, WalletClient } from "viem";
import type { BackendConfig } from "./config";
import {
  MissionResolutionService,
  ViemMissionResolutionChainClient,
  type MissionResolutionChainClient,
  type MissionResolutionLogger
} from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: true,
  missionResolverAddress: "0x4444444444444444444444444444444444444444",
  qaSyntheticStationedDefenders: false,
  randomnessCommitmentStorePath: ".data/test-randomness.json",
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "missing"
};

describe("MissionResolutionService", () => {
  test("settles resolvable arrival legs and due return legs in one tick", async () => {
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      chainClient: fakeClient({
        calls,
        resolvable: ["4347", "4348"],
        returnable: ["4777"]
      }),
      logger: silentLogger()
    });

    await service.tick();

    expect(calls).toEqual([
      "resolve:4347",
      "resolve:4348",
      "return:4777"
    ]);
    expect(service.snapshot()).toMatchObject({
      enabled: true,
      lastError: null,
      lastResolvedMissionId: "4348",
      lastReturnedMissionId: "4777",
      resolvedCount: 2,
      returnedCount: 1
    });
  });

  test("stays disabled when mission resolution config is off", async () => {
    const calls: string[] = [];
    const service = new MissionResolutionService(
      { ...config, missionResolutionEnabled: false },
      {
        chainClient: fakeClient({ calls, resolvable: ["4347"], returnable: ["4777"] }),
        logger: silentLogger()
      }
    );

    await service.tick();

    expect(calls).toEqual([]);
    expect(service.snapshot().enabled).toBe(false);
  });

  test("retains due arrivals and returns without allocating work while the canonical game pause is active", async () => {
    let nowMs = 1_000_000;
    let paused = true;
    let pauseProbes = 0;
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("27543", "Transport", "900")],
          returns: [returnLeg("27544", "Returning", "920")]
        })
      },
      chainClient: fakeClient({
        calls,
        resolvable: [],
        returnable: [],
        paused: async () => {
          pauseProbes += 1;
          return paused;
        }
      }),
      intervalMs: 5_000,
      logger: silentLogger(),
      now: () => nowMs
    });

    await service.tick();
    expect(calls).toEqual([]);
    expect(service.snapshot()).toMatchObject({
      gamePaused: true,
      gamePauseAgeSeconds: 0,
      healthStatus: "degraded",
      healthWarnings: ["game_paused"],
      dueArrivals: { count: 1 },
      dueReturns: { count: 1 },
      pausedResolutionAttempts: 2
    });

    nowMs += 4_999;
    await service.tick();
    expect(pauseProbes).toBe(1);
    expect(calls).toEqual([]);

    nowMs += 1;
    await service.tick();
    expect(pauseProbes).toBe(2);
    expect(calls).toEqual([]);

    paused = false;
    nowMs += 10_000;
    await service.tick();
    expect(calls).toEqual(["resolve:27543", "return:27544"]);
    expect(service.snapshot()).toMatchObject({
      gamePaused: false,
      gamePauseAgeSeconds: 0,
      dueArrivals: { count: 0 },
      dueReturns: { count: 0 }
    });
  });

  test("discovers missions that become due during a pause and recovers promptly after unpause", async () => {
    let nowMs = 1_000_000;
    let paused = true;
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: nowMs >= 1_005_000 ? [arrival("27545", "Transport", "1005")] : [],
          returns: []
        })
      },
      chainClient: fakeClient({ calls, resolvable: [], returnable: [], paused: async () => paused }),
      intervalMs: 5_000,
      logger: silentLogger(),
      now: () => nowMs
    });

    await service.tick();
    expect(service.snapshot().dueArrivals.count).toBe(0);
    nowMs += 5_000;
    await service.tick();
    expect(service.snapshot().dueArrivals.count).toBe(1);
    expect(calls).toEqual([]);

    paused = false;
    nowMs += 10_000;
    await service.tick();
    expect(calls).toEqual(["resolve:27545"]);
  });

  test("preserves pause age across a rolling service restart and alerts on a long pause", async () => {
    let nowMs = 1_600_000;
    const stored = {
      paused: true,
      observedAt: "1970-01-01T00:25:00.000Z",
      pausedSince: "1970-01-01T00:25:00.000Z",
      pauseAgeSeconds: 100
    };
    const warnings: string[] = [];
    const source = {
      missionResolutionCandidates: () => ({ arrivals: [], returns: [] }),
      gameMaintenanceState: () => stored,
      recordGameMaintenanceState(state: typeof stored) { Object.assign(stored, state); }
    };
    const service = new MissionResolutionService(config, {
      candidateSource: source,
      chainClient: fakeClient({ calls: [], resolvable: [], returnable: [], paused: async () => true }),
      intervalMs: 5_000,
      longPauseAlertAfterMs: 60_000,
      logger: { warn(message) { warnings.push(message); }, error() {} },
      now: () => nowMs
    });

    await service.tick();
    expect(service.snapshot()).toMatchObject({
      gamePaused: true,
      gamePausedSince: "1970-01-01T00:25:00.000Z",
      gamePauseAgeSeconds: 100,
      healthWarnings: ["game_paused", "game_pause_long_running"],
      longPauseAlerts: 1
    });
    expect(warnings).toHaveLength(1);
  });

  test("fails closed on an unrelated pause-probe RPC failure and remains actionable on recovery", async () => {
    let probeFails = true;
    const calls: string[] = [];
    const client = fakeClient({
      calls,
      resolvable: ["27546"],
      returnable: [],
      paused: async () => {
        if (probeFails) throw new Error("RPC pause probe failed");
        return false;
      }
    });
    const service = new MissionResolutionService(config, { chainClient: client, logger: silentLogger() });

    await service.tick();
    expect(calls).toEqual([]);
    expect(service.snapshot()).toMatchObject({
      lastError: "RPC pause probe failed",
      healthWarnings: ["mission_resolution_tick_failed"]
    });

    probeFails = false;
    await service.tick();
    expect(calls).toEqual(["resolve:27546"]);
    expect(service.snapshot().lastError).toBeNull();
  });

  test("continues past failed return candidates until the per-tick success cap", async () => {
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      chainClient: fakeClient({
        calls,
        failReturns: ["1"],
        resolvable: [],
        returnable: ["1", "2", "3"]
      }),
      logger: silentLogger(),
      maxMissionsPerTick: 2
    });

    await service.tick();

    expect(calls).toEqual([
      "return:1",
      "return:2",
      "return:3"
    ]);
    expect(service.snapshot()).toMatchObject({
      lastReturnedMissionId: "3",
      returnedCount: 2,
      dueReturns: { count: 1 },
      failuresByLeg: { return: 1 }
    });
  });

  test("uses one bounded indexed candidate scan instead of the history-listing methods", async () => {
    const calls: string[] = [];
    let sourceCalls = 0;
    const client = fakeClient({ calls, resolvable: ["history-arrival"], returnable: ["history-return"] });
    client.listResolvableFleetMissions = async () => {
      throw new Error("history arrival scan must not run");
    };
    client.listReturnableFleetMissions = async () => {
      throw new Error("history return scan must not run");
    };
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates() {
          sourceCalls += 1;
          return {
            arrivals: [arrival("10", "Transport", "900")],
            returns: [returnLeg("11", "Recalled", "950")]
          };
        }
      },
      chainClient: client,
      logger: silentLogger(),
      now: () => 1_000_000
    });

    await service.tick();

    expect(sourceCalls).toBe(1);
    expect(calls).toEqual(["resolve:10", "return:11"]);
  });

  test("reconciles a stale return row after FleetMissionNotResolved instead of leaving it in the retry loop", async () => {
    let reconciled: string | null = null;
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [],
          returns: [returnLeg("24524", "Returning", "950")]
        }),
        async reconcileMissionResolutionCandidate(missionId) {
          reconciled = missionId;
        }
      },
      chainClient: {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async resolveFleetMission() { return "0xresolve"; },
        async completeFleetMissionReturn() {
          throw new Error("execution reverted: 0xb3439205");
        }
      },
      logger: silentLogger(),
      now: () => 1_000_000
    });

    await service.tick();

    expect(reconciled as string | null).toBe("24524");
    expect(service.snapshot().failuresByLeg).toEqual({ arrival: 0, return: 1 });
  });

  test("reconciles a stale arrival when a mined receipt omits the revert selector", async () => {
    let reconciled: string | null = null;
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("24921", "Deploy", "950")],
          returns: []
        }),
        async reconcileMissionResolutionCandidate(missionId) {
          reconciled = missionId;
        }
      },
      chainClient: {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async resolveFleetMission() {
          throw new Error(
            "transaction 0x6ab9e9303048286bce29b9a1d239bcb671395f309f444efb0f39267064cf7af1 reverted"
          );
        },
        async completeFleetMissionReturn() { return "0xreturn"; }
      },
      logger: silentLogger(),
      now: () => 1_000_000
    });

    await service.tick();

    expect(reconciled as string | null).toBe("24921");
    expect(service.snapshot().failuresByLeg).toEqual({ arrival: 1, return: 0 });
  });

  test("reconciles a previously confirmed no-log operation so Resolved advances and Returned disappears", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const broadcasts: string[] = [];
    let pendingNonce = 7;
    const publicClient = {
      async getTransactionCount() { return pendingNonce; },
      async getStorageAt() { return `0x${"0".repeat(64)}`; },
      async waitForTransactionReceipt() { return { status: "success" }; }
    } as unknown as PublicClient;
    const walletClient = {
      async writeContract(input: { functionName: string; nonce: number }) {
        broadcasts.push(`${input.functionName}:${input.nonce}`);
        pendingNonce = input.nonce + 1;
        return `0x${input.nonce.toString(16).padStart(64, "0")}`;
      }
    } as unknown as WalletClient;
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    const client = new ViemMissionResolutionChainClient(
      {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      account,
      publicClient,
      walletClient,
      { id: 8453 } as never,
      config.rpcUrl,
      coordinator
    );

    // Simulate the operation confirmed before the indexed source caught up. Reusing this operation
    // below must not broadcast another resolve transaction.
    await client.resolveFleetMission("24531");

    let canonicalStatus: "stale-arrival" | "resolved" | "returned" = "stale-arrival";
    const reconciled: string[] = [];
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: canonicalStatus === "stale-arrival" ? [arrival("24531", "Transport", "950")] : [],
          returns: canonicalStatus === "resolved" ? [returnLeg("24531", "Returning", "950")] : []
        }),
        async reconcileMissionResolutionCandidate(missionId) {
          reconciled.push(missionId);
          canonicalStatus = canonicalStatus === "stale-arrival" ? "resolved" : "returned";
        }
      },
      chainClient: client,
      logger: silentLogger(),
      now: () => 1_000_000
    });

    await service.tick();

    expect(broadcasts).toEqual(["resolveFleetMission:7"]);
    expect(reconciled).toEqual(["24531"]);
    expect(canonicalStatus as string).toBe("resolved");
    expect(service.snapshot()).toMatchObject({
      resolvedCount: 1,
      returnedCount: 0,
      dueArrivals: { count: 0 }
    });

    await service.tick();
    await service.tick();

    expect(broadcasts).toEqual([
      "resolveFleetMission:7",
      "completeFleetMissionReturn:8"
    ]);
    expect(reconciled).toEqual(["24531", "24531"]);
    expect(canonicalStatus as string).toBe("returned");
    expect(service.snapshot()).toMatchObject({
      resolvedCount: 1,
      returnedCount: 1,
      dueArrivals: { count: 0 },
      dueReturns: { count: 0 }
    });
  });

  test("retries a successfully chunked Attack on the next tick until canonical status is terminal", async () => {
    let attempts = 0;
    let terminal = false;
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: terminal ? [] : [arrival("23007", "Attack", "900")],
          returns: []
        })
      },
      chainClient: {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async resolveFleetMission() {
          attempts += 1;
          terminal = attempts === 2;
          return `0xchunk${attempts}`;
        },
        async completeFleetMissionReturn() { return "0xreturn"; }
      },
      logger: silentLogger()
    });

    await service.tick();
    await service.tick();
    await service.tick();

    expect(attempts).toBe(2);
    expect(service.snapshot()).toMatchObject({
      failuresByLeg: { arrival: 0 },
      dueArrivals: { count: 0 },
      lastResolvedMissionId: "23007",
      resolvedCount: 2
    });
  });

  test("drains a burst with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const settled: string[] = [];
    const arrivals = Array.from({ length: 24 }, (_, index) => arrival(String(index + 1), "Transport", "950"));
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({ arrivals, returns: [] })
      },
      chainClient: {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async resolveFleetMission(missionId) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          settled.push(missionId);
          active -= 1;
          return `0x${missionId}`;
        },
        async completeFleetMissionReturn() { return "0xreturn"; }
      },
      logger: silentLogger(),
      maxConcurrency: 4,
      now: () => 1_000_000
    });

    await service.tick();

    expect(settled).toHaveLength(24);
    expect(peak).toBe(4);
    expect(service.snapshot()).toMatchObject({
      dueArrivals: { count: 0 },
      resolvedCount: 24,
      settlementLatency: { arrival: { count: 24, p95Seconds: 50 } },
      healthStatus: "healthy"
    });
  });

  test("a failing arrival does not starve later ready arrivals or returns", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      calls,
      failArrivals: ["1"],
      resolvable: [],
      returnable: []
    });
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("1", "Attack", "900"), arrival("2", "Harvest", "901")],
          returns: [returnLeg("3", "Attack", "902")]
        })
      },
      chainClient: client,
      logger: silentLogger(),
      maxConcurrency: 2,
      now: () => 1_000_000
    });

    await service.tick();

    expect(calls).toEqual(["resolve:1", "resolve:2", "return:3"]);
    expect(service.snapshot()).toMatchObject({
      resolvedCount: 1,
      returnedCount: 1,
      dueArrivals: { count: 1 },
      dueReturns: { count: 0 },
      failuresByLeg: { arrival: 1, return: 0 }
    });
  });

  test("backs off a repeatedly failing candidate instead of retrying it every resolution tick", async () => {
    let nowMs = 1_000_000;
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("1", "Attack", "900")],
          returns: []
        })
      },
      chainClient: fakeClient({ calls, failArrivals: ["1"], resolvable: [], returnable: [] }),
      logger: silentLogger(),
      now: () => nowMs
    });

    await service.tick();
    await service.tick();
    expect(calls).toEqual(["resolve:1"]);

    nowMs += 30_000;
    await service.tick();
    expect(calls).toEqual(["resolve:1", "resolve:1"]);
  });

  test("suppresses overlapping timer runs and reports the skip", async () => {
    let release = () => {};
    let scans = 0;
    const service = new MissionResolutionService(config, {
      candidateSource: {
        async missionResolutionCandidates() {
          scans += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return { arrivals: [], returns: [] };
        }
      },
      chainClient: fakeClient({ calls: [], resolvable: [], returnable: [] }),
      logger: silentLogger()
    });

    const first = service.tick();
    await Promise.resolve();
    await service.tick();
    release();
    await first;

    expect(scans).toBe(1);
    expect(service.snapshot()).toMatchObject({
      inFlight: false,
      skippedOverlappingRuns: 1
    });
  });

  test("degrades health for a stale ready backlog and exposes run and leg metrics", async () => {
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("1", "Attack", "900")],
          returns: []
        })
      },
      chainClient: fakeClient({ calls: [], failArrivals: ["1"], resolvable: [], returnable: [] }),
      logger: silentLogger(),
      now: () => 1_000_000,
      promptnessTargetMs: 60_000
    });

    await service.tick();

    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["stale_due_arrival_backlog"],
      lastCompletedRunAt: "1970-01-01T00:16:40.000Z",
      lastTickDurationMs: 0,
      lastScanDurationMs: 0,
      dueArrivals: {
        count: 1,
        oldestDueAt: "1970-01-01T00:15:00.000Z",
        oldestAgeSeconds: 100
      },
      failuresByLeg: { arrival: 1, return: 0 }
    });
  });

  test("degrades health while a stale due mission settlement is in flight", async () => {
    let nowMs = 959_000;
    let startedCount = 0;
    let markBothStarted = () => {};
    let releaseArrival = () => {};
    let releaseReturn = () => {};
    const bothStarted = new Promise<void>((resolve) => { markBothStarted = resolve; });
    const arrivalGate = new Promise<void>((resolve) => { releaseArrival = resolve; });
    const returnGate = new Promise<void>((resolve) => { releaseReturn = resolve; });
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: () => ({
          arrivals: [arrival("1", "Deploy", "900")],
          returns: [returnLeg("2", "Attack", "920")]
        })
      },
      chainClient: {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async resolveFleetMission() {
          startedCount += 1;
          if (startedCount === 2) markBothStarted();
          await arrivalGate;
          return "0xarrival";
        },
        async completeFleetMissionReturn() {
          startedCount += 1;
          if (startedCount === 2) markBothStarted();
          await returnGate;
          return "0xreturn";
        }
      },
      logger: silentLogger(),
      maxConcurrency: 2,
      now: () => nowMs,
      promptnessTargetMs: 60_000
    });

    const tick = service.tick();
    await bothStarted;

    expect(service.snapshot()).toMatchObject({
      inFlight: true,
      healthStatus: "healthy",
      dueArrivals: { count: 1, oldestAgeSeconds: 59 },
      dueReturns: { count: 1, oldestAgeSeconds: 39 }
    });

    nowMs = 1_001_000;
    expect(service.snapshot()).toMatchObject({
      inFlight: true,
      healthStatus: "degraded",
      healthWarnings: ["stale_due_arrival_backlog", "stale_due_return_backlog"],
      dueArrivals: { count: 1, oldestAgeSeconds: 101 },
      dueReturns: { count: 1, oldestAgeSeconds: 81 }
    });

    releaseArrival();
    await waitUntil(() => service.snapshot().dueArrivals.count === 0);
    expect(service.snapshot()).toMatchObject({
      inFlight: true,
      healthWarnings: ["stale_due_return_backlog"],
      dueArrivals: { count: 0 },
      dueReturns: { count: 1, oldestAgeSeconds: 81 }
    });

    releaseReturn();
    await tick;
    expect(service.snapshot()).toMatchObject({
      inFlight: false,
      healthStatus: "healthy",
      dueArrivals: { count: 0 },
      dueReturns: { count: 0 }
    });
  });
});

describe("ViemMissionResolutionChainClient", () => {
  test("serializes broadcasts and confirmations while assigning pending nonces", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const broadcasts: Array<{ functionName: string; gas: bigint | undefined; nonce: number }> = [];
    let activeBroadcasts = 0;
    let peakBroadcasts = 0;
    let pendingNonce = 7;
    const publicClient = {
      async getTransactionCount() { return pendingNonce; },
      async getStorageAt() { return `0x${"0".repeat(64)}`; },
      async waitForTransactionReceipt() { return { status: "success" }; }
    } as unknown as PublicClient;
    const walletClient = {
      async writeContract(input: { functionName: string; gas?: bigint; nonce: number }) {
        activeBroadcasts += 1;
        peakBroadcasts = Math.max(peakBroadcasts, activeBroadcasts);
        broadcasts.push({
          functionName: input.functionName,
          gas: input.gas,
          nonce: input.nonce
        });
        pendingNonce = input.nonce + 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeBroadcasts -= 1;
        return `0x${input.nonce.toString(16).padStart(64, "0")}`;
      }
    } as unknown as WalletClient;
    const client = new ViemMissionResolutionChainClient(
      {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      account,
      publicClient,
      walletClient,
      { id: 8453 } as never,
      config.rpcUrl
    );

    await Promise.all([
      client.resolveFleetMission("1"),
      client.completeFleetMissionReturn("2")
    ]);

    expect(broadcasts).toEqual([
      { functionName: "resolveFleetMission", gas: 16_777_216n, nonce: 7 },
      { functionName: "completeFleetMissionReturn", gas: undefined, nonce: 8 }
    ]);
    expect(peakBroadcasts).toBe(1);
  });

  test("replaces an underpriced mission transaction at the same nonce with bumped fees", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const firstHash = `0x${"a".repeat(64)}` as const;
    const replacementHash = `0x${"b".repeat(64)}` as const;
    let latestNonce = 7;
    let pendingNonce = 7;
    const writes: Array<Record<string, unknown>> = [];
    const publicClient = {
      async getTransactionCount(input: { blockTag: "latest" | "pending" }) {
        return input.blockTag === "latest" ? latestNonce : pendingNonce;
      },
      async getStorageAt() { return `0x${"0".repeat(64)}`; },
      async getTransaction() {
        return { gasPrice: null, maxFeePerGas: 80n, maxPriorityFeePerGas: 8n };
      },
      async getBlock() { return { baseFeePerGas: 90n }; },
      async estimateFeesPerGas() { return { maxFeePerGas: 90n, maxPriorityFeePerGas: 12n }; },
      async waitForTransactionReceipt({ hash }: { hash: string }) {
        if (hash === firstHash) throw new Error("receipt RPC timed out");
        latestNonce = 8;
        pendingNonce = 8;
        return { status: "success" };
      }
    } as unknown as PublicClient;
    const walletClient = {
      async writeContract(input: Record<string, unknown>) {
        writes.push(input);
        pendingNonce = 8;
        return writes.length === 1 ? firstHash : replacementHash;
      }
    } as unknown as WalletClient;
    const client = new ViemMissionResolutionChainClient(
      {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      account,
      publicClient,
      walletClient,
      { id: 8453 } as never,
      config.rpcUrl,
      new ResolverTransactionCoordinator(":memory:")
    );

    await expect(client.resolveFleetMission("45237")).rejects.toThrow("receipt RPC timed out");
    await expect(client.resolveFleetMission("45237")).resolves.toBe(replacementHash);

    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ gas: 16_777_216n, nonce: 7 });
    expect(writes[1]).toMatchObject({
      gas: 16_777_216n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 12n,
      nonce: 7
    });
  });

  test("supplies the same explicit combat gas envelope to unlocked-account submissions", async () => {
    const previousFetch = globalThis.fetch;
    const transactions: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const payload = JSON.parse(String(init?.body)) as {
        params: Array<Array<Record<string, unknown>> | Record<string, unknown>>;
      };
      transactions.push(payload.params[0] as Record<string, unknown>);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: `0x${transactions.length.toString(16).padStart(64, "0")}`
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const publicClient = {
        async getTransactionCount() { return 7 + transactions.length; },
        async getStorageAt() { return `0x${"0".repeat(64)}`; },
        async waitForTransactionReceipt() { return { status: "success" }; }
      } as unknown as PublicClient;
      const client = new ViemMissionResolutionChainClient(
        {
          async listResolvableFleetMissions() { return []; },
          async listReturnableFleetMissions() { return []; }
        },
        config.gameContractAddress!,
        "0x1111111111111111111111111111111111111111",
        publicClient,
        undefined,
        { id: 8453 } as never,
        config.rpcUrl
      );

      await client.resolveFleetMission("23007");
      await client.completeFleetMissionReturn("23008");

      expect(transactions[0]?.gas).toBe("0x1000000");
      expect(transactions[0]?.nonce).toBe("0x7");
      expect(transactions[1]).not.toHaveProperty("gas");
      expect(transactions[1]?.nonce).toBe("0x8");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("reads the canonical game pause from the fixed proxy storage slot", async () => {
    let requestedSlot: string | undefined;
    const publicClient = {
      async getStorageAt(input: { slot: string }) {
        requestedSlot = input.slot;
        return `0x${"1".padStart(64, "0")}`;
      }
    } as unknown as PublicClient;
    const client = new ViemMissionResolutionChainClient(
      {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      "0x1111111111111111111111111111111111111111",
      publicClient,
      undefined,
      { id: 8453 } as never,
      config.rpcUrl
    );

    expect(await client.gamePaused()).toBe(true);
    expect(requestedSlot).toBe(`0x${"34".padStart(64, "0")}`);
  });

  test("rechecks pause immediately before coordinator entry without allocating a nonce", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    let nonceReads = 0;
    let broadcasts = 0;
    const publicClient = {
      async getStorageAt() { return `0x${"1".padStart(64, "0")}`; },
      async getTransactionCount() { nonceReads += 1; return 7; },
      async waitForTransactionReceipt() { return { status: "success" }; }
    } as unknown as PublicClient;
    const walletClient = {
      async writeContract() {
        broadcasts += 1;
        return `0x${"1".padStart(64, "0")}`;
      }
    } as unknown as WalletClient;
    const client = new ViemMissionResolutionChainClient(
      {
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      account,
      publicClient,
      walletClient,
      { id: 8453 } as never,
      config.rpcUrl,
      new ResolverTransactionCoordinator(":memory:")
    );

    await expect(client.completeFleetMissionReturn("27543")).rejects.toThrow("canonical game pause is active");
    expect(nonceReads).toBe(0);
    expect(broadcasts).toBe(0);
  });
});

function fakeClient(input: {
  calls: string[];
  failArrivals?: string[];
  failReturns?: string[];
  resolvable: string[];
  returnable: string[];
  paused?: () => Promise<boolean>;
}): MissionResolutionChainClient {
  return {
    ...(input.paused ? { gamePaused: input.paused } : {}),
    async listResolvableFleetMissions() {
      return input.resolvable.map((missionId) => ({
        arrivalAt: "1",
        missionId,
        missionType: "Attack",
        originPlanetId: "85",
        targetPlanetId: "86"
      }));
    },
    async listReturnableFleetMissions() {
      return input.returnable.map((missionId) => ({
        missionId,
        missionType: "Attack",
        originPlanetId: "85",
        returnAt: "2",
        targetPlanetId: "86"
      }));
    },
    async resolveFleetMission(missionId: string) {
      input.calls.push(`resolve:${missionId}`);
      if (input.failArrivals?.includes(missionId)) {
        throw new Error(`arrival ${missionId} failed`);
      }
      return `0xresolve${missionId}`;
    },
    async completeFleetMissionReturn(missionId: string) {
      input.calls.push(`return:${missionId}`);
      if (input.failReturns?.includes(missionId)) {
        throw new Error(`return ${missionId} failed`);
      }
      return `0xreturn${missionId}`;
    }
  };
}

function arrival(missionId: string, missionType: string, arrivalAt: string) {
  return {
    arrivalAt,
    missionId,
    missionType,
    originPlanetId: "85",
    targetPlanetId: "86"
  };
}

function returnLeg(missionId: string, missionType: string, returnAt: string) {
  return {
    missionId,
    missionType,
    originPlanetId: "85",
    returnAt,
    targetPlanetId: "86"
  };
}

function silentLogger(): MissionResolutionLogger {
  return {
    warn() {},
    error() {}
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not met before timeout");
}
