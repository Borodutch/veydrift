import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, custom, encodeFunctionData, parseAbi, encodeFunctionResult, encodeAbiParameters, stringToHex, keccak256, parseTransaction, toHex, type Hex, type PublicClient, type WalletClient } from "viem";
import { progressAbi } from "../../battle-keeper/src/progress";
import type { BackendConfig } from "./config";
import { VeydriftGameReader } from "./evm";
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

  test("sanitizes tick failures before health state and logger output", async () => {
    const privateKey = `0x${"ab".repeat(32)}`;
    const queryKey = "synthetic-query-canary-1234567890";
    const bearer = "synthetic-bearer-canary-1234567890";
    const logged: unknown[][] = [];
    const service = new MissionResolutionService(config, {
      chainClient: fakeClient({
        calls: [],
        resolvable: [],
        returnable: [],
        paused: async () => {
          throw new Error(
            `request failed at https://user:${queryKey}@rpc.invalid/path?apiKey=${queryKey} `
            + `Authorization: Bearer ${bearer} private_key=${privateKey}`
          );
        }
      }),
      logger: {
        warn() {},
        error(...args) { logged.push(args); }
      }
    });

    await service.tick();

    const output = JSON.stringify({ snapshot: service.snapshot(), logged });
    expect(output).not.toContain(privateKey);
    expect(output).not.toContain(queryKey);
    expect(output).not.toContain(bearer);
    expect(output).toContain("https://rpc.invalid");
    expect(service.snapshot().healthWarnings).toContain("mission_resolution_tick_failed");
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
        async isMissionLegComplete() { return true; },
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
        async isMissionLegComplete() { return true; },
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
    let actualStatus = "Outbound";
    const blockHash = ("0x"+"a".repeat(64)) as Hex;
    const receipts = new Map<Hex,unknown>();
    const publicClient = {
      async call() { return {data:"0x"}; },
      async getTransactionCount() {return pendingNonce;},
      async getStorageAt() {return toHex(0n,{size:32});},
      async prepareTransactionRequest(input:object) {return {...input,maxFeePerGas:2n,maxPriorityFeePerGas:1n,type:"eip1559"};},
      async request({method,params}:{method:string;params:unknown[]}) {
        if(method==="eth_getBlockByNumber")return {number:"0x64",hash:blockHash};
        if(method==="eth_getCode")return "0x6000";
        if(method==="eth_getStorageAt")return toHex(0n,{size:32});
        if(method==="eth_call")return encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]});
        if(method==="eth_getTransactionReceipt")return receipts.get(params[0] as Hex)??null;
        if(method==="eth_sendRawTransaction") {
          const raw=params[0] as Hex,tx=parseTransaction(raw),hash=keccak256(raw);
          const name=actualStatus==="Outbound"?"resolveFleetMission":"completeFleetMissionReturn";
          broadcasts.push(name+":"+tx.nonce);pendingNonce=tx.nonce!+1;actualStatus=actualStatus==="Outbound"?"Returning":"Returned";
          receipts.set(hash,{status:"0x1",transactionHash:hash,blockNumber:"0x64",blockHash});return hash;
        }
        throw new Error(method);
      }
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
        async isFleetChronologyOrderingReady() { return true; },
        async getCanonicalFleetMission() { return { status: actualStatus, missionTypeId:0, targetPlanetId:"2" } as never; },
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; }
      },
      config.gameContractAddress!,
      account,
      publicClient,
      walletClient,
      { id: 8453 } as never,
      config.rpcUrl,
      coordinator, undefined, undefined, ":memory:", [config.gameContractAddress!.toLowerCase()+":"+keccak256("0x6000")]
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
        async isMissionLegComplete() { return terminal; },
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
      resolvedCount: 1
    });
  });

  test("drains a burst with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    let candidateLimit: number | undefined;
    const settled: string[] = [];
    const arrivals = Array.from({ length: 24 }, (_, index) => arrival(String(index + 1), "Transport", "950"));
    const service = new MissionResolutionService(config, {
      candidateSource: {
        missionResolutionCandidates: (_asOfSeconds, limit) => {
          candidateLimit = limit;
          return { arrivals, returns: [] };
        }
      },
      chainClient: {
        async isMissionLegComplete() { return true; },
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

    expect(candidateLimit).toBe(500);

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
        async isMissionLegComplete() { return true; },
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
  for (const leg of ["arrival", "return"] as const) {
    for (const mode of ["private-key", "unlocked"] as const) {
      test(leg + " " + mode + " preflights new and identical-raw recovery without replacement or nonce guessing", async () => {
        const account = privateKeyToAccount(("0x" + "1".repeat(64)) as Hex);
        const from = account.address;
        const functionName = leg === "arrival" ? "resolveFleetMission" : "completeFleetMissionReturn";
        const data = encodeFunctionData({abi:parseAbi(["function resolveFleetMission(uint256)","function completeFleetMissionReturn(uint256)"]),functionName,args:[77n]});
        const dir = mkdtempSync(join(tmpdir(), "merged-preflight-"));
        const store = join(dir, "journal.sqlite");
        const hash = ("0x" + "a".repeat(64)) as Hex;
        const chronologySlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}],
          [77n,BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1")))+1n]));
        let orderingReady=false, blocked=true, funded=false, settled=false, advance=true;
        let nonce=7, work=0n;
        let exactFailure = "", signCount = 0, prepareCount = 0;
        const sign = account.signTransaction;
        account.signTransaction = async (...args) => { signCount++; return sign(...args); };
        const raws: Hex[]=[];
        const receipts=new Map<Hex,unknown>();
        const simulations: unknown[][]=[];
        const events:string[]=[];
        const rpcClient=createPublicClient({transport:custom({async request({method,params}) {
          expect(method).toBe("eth_call"); events.push("simulate"); simulations.push(params as unknown[]);
          if(blocked) throw new Error("execution reverted: earlier attack randomness unavailable");
          const tx = (params as unknown[])[0] as Record<string, unknown>;
          if (exactFailure && tx.maxFeePerGas !== undefined) throw new Error(exactFailure);
          return "0x";
        }},{retryCount:0})});
        const publicClient={
          call:rpcClient.call,
          async getStorageAt(){return toHex(0n,{size:32});},
          async getTransactionCount(){return nonce;},
          async prepareTransactionRequest(input:object){prepareCount++; return {...input,maxFeePerGas:3n,maxPriorityFeePerGas:1n,type:"eip1559"};},
          async request({method,params}:{method:string;params:unknown[]}) {
            if(method==="eth_getBlockByNumber") return {number:"0x64",hash};
            if(method==="eth_getCode") return "0x6000";
            if(method==="eth_getStorageAt") return toHex(params[1]===chronologySlot?work:0n,{size:32});
            if(method==="eth_call") {
              if ((params[0] as {data:string}).data === data) return rpcClient.request({method:"eth_call",params:params as never});
              return encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]});
            }
            if(method==="eth_signTransaction") {
              const tx=params[0] as Record<string,Hex>;
              expect(tx.from).toBe(from);
              return account.signTransaction({to:tx.to!,data:tx.data!,nonce:Number(BigInt(tx.nonce!)),gas:BigInt(tx.gas!),
                chainId:Number(BigInt(tx.chainId!)),maxFeePerGas:BigInt(tx.maxFeePerGas!),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas!),type:"eip1559"});
            }
            if(method==="eth_getTransactionReceipt") return receipts.get(params[0] as Hex)??null;
            if(method==="eth_sendRawTransaction") {
              events.push("broadcast");const raw=params[0] as Hex;raws.push(raw);
              const tx=parseTransaction(raw);expect(tx.gas).toBe(15_000_000n);expect(tx.data).toBe(data);
              if(!funded) throw new Error("insufficient funds at raw broadcast");
              const receiptHash=keccak256(raw);nonce=tx.nonce!+1;if(advance)work+=12n;
              receipts.set(receiptHash,{status:"0x1",transactionHash:receiptHash,blockHash:hash,blockNumber:"0x64"});
              return receiptHash;
            }
            throw new Error(method);
          }
        };
        const reader={async listResolvableFleetMissions(){return [];},async listReturnableFleetMissions(){return [];},
          async isFleetChronologyOrderingReady(){events.push("ordering");return orderingReady;},
          async getCanonicalFleetMission(){return {status:settled?"Returned":leg==="arrival"?"Outbound":"Returning",missionTypeId:0,targetPlanetId:"2"} as never;}};
        const make=()=>new ViemMissionResolutionChainClient(reader,config.gameContractAddress!,mode==="private-key"?account:from,
          publicClient as unknown as PublicClient,undefined,{id:config.chainId} as never,config.rpcUrl,
          new ResolverTransactionCoordinator(store),undefined,undefined,store,[config.gameContractAddress!.toLowerCase()+":"+keccak256("0x6000")]);
        const submit=()=>make()[functionName]("77");
        const durable = () => {
          const db = new Database(store);
          try { return {
            signed: db.query("SELECT value FROM mission_signed_attempts").all(),
            reservations: db.query("SELECT operation_id, nonce, transaction_hash, status, signed_envelope FROM resolver_transaction_attempts WHERE status IN ('allocating','submitted')").all()
          }; } finally { db.close(); }
        };
        try {
          await expect(submit()).rejects.toThrow("ordering support unavailable");expect(simulations).toHaveLength(0);
          orderingReady=true;
          await expect(submit()).rejects.toThrow("earlier attack randomness unavailable");
          await expect(submit()).rejects.toThrow("earlier attack randomness unavailable");expect(raws).toHaveLength(0);expect(nonce).toBe(7);
          const call=publicClient.call;Object.assign(publicClient,{call:undefined});
          await expect(submit()).rejects.toThrow("missing RPC simulation client");expect(raws).toHaveLength(0);publicClient.call=call;
          blocked=false;
          for (const failure of ["max fee per gas less than block base fee", "insufficient funds for gas * price + value"]) {
            exactFailure = failure;
            await expect(submit()).rejects.toThrow(failure);
            expect(signCount).toBe(0); expect(raws).toHaveLength(0); expect(nonce).toBe(7);
            expect(durable()).toEqual({signed:[],reservations:[]});
          }
          exactFailure="";await expect(submit()).rejects.toThrow("insufficient funds");expect(raws).toHaveLength(1);
          const persisted = durable(), prepared = prepareCount;
          expect(persisted.signed).toHaveLength(1);expect(persisted.reservations).toHaveLength(1);
          for (const failure of ["max fee per gas less than block base fee", "insufficient funds for gas * price + value"]) {
            exactFailure=failure; await expect(submit()).rejects.toThrow(failure);
            expect(durable()).toEqual(persisted); expect(raws).toHaveLength(1); expect(nonce).toBe(7);
            expect(signCount).toBe(1);expect(prepareCount).toBe(prepared);
          }
          exactFailure="";
          blocked=true;await expect(submit()).rejects.toThrow("earlier attack randomness unavailable");expect(raws).toHaveLength(1);expect(nonce).toBe(7);
          Object.assign(publicClient,{call:undefined});await expect(submit()).rejects.toThrow("missing RPC simulation client");expect(raws).toHaveLength(1);publicClient.call=call;
          blocked=false;funded=true;
          await expect(submit()).rejects.toThrow("mission remains pending");expect(raws).toHaveLength(2);expect(raws[1]).toBe(raws[0]);
          expect(raws.map(raw=>parseTransaction(raw).nonce)).toEqual([7,7]);
          advance=false;await expect(submit()).rejects.toThrow("mission remains pending");expect(raws.map(raw=>parseTransaction(raw).nonce)).toEqual([7,7,8]);
          await expect(submit()).rejects.toThrow("mission remains pending");expect(raws).toHaveLength(3);
          settled=true;expect(await submit()).toBe(leg==="arrival"?"canonical:arrival-complete":"canonical:return-complete");expect(raws).toHaveLength(3);
          expect(await make().isMissionLegComplete("77",leg)).toBe(true);
          // A paid receipt is recovery evidence even when fresh simulation/ordering would fail.
          const db = new Database(store);
          try {
            const row = persisted.signed[0] as {value:string};
            const attempt = JSON.parse(row.value) as {hash:Hex;nonce:string};
            db.query("INSERT INTO mission_signed_attempts VALUES (?, ?)").run(
              `${config.chainId}:${config.gameContractAddress!.toLowerCase()}:77:${functionName}`, row.value);
            expect(attempt.nonce).toBe("7");
          } finally { db.close(); }
          const beforeReceiptRecovery = simulations.length;
          orderingReady=false;blocked=true;exactFailure="insufficient funds for gas * price + value";
          await make().recoverPendingMissions();
          expect(simulations).toHaveLength(beforeReceiptRecovery);expect(raws).toHaveLength(3);
          expect(signCount).toBe(2);expect(durable().signed).toEqual([]);
          expect(simulations.length).toBeGreaterThan(6);
          for(const params of simulations) {
            const tx = params[0] as Record<string,string>;
            if (tx.nonce === undefined) {
              expect(params).toEqual([{from,to:config.gameContractAddress,data,gas:"0xe4e1c0"},"latest"]);
            } else {
              const parsed = parseTransaction(raws.find(raw => toHex(parseTransaction(raw).nonce!) === tx.nonce)!);
              expect(params).toEqual([{from,to:parsed.to,data:parsed.data,gas:toHex(parsed.gas!),nonce:toHex(parsed.nonce!),
                value:toHex(parsed.value??0n),type:"0x2",maxFeePerGas:toHex(parsed.maxFeePerGas!),
                maxPriorityFeePerGas:toHex(parsed.maxPriorityFeePerGas!),accessList:parsed.accessList??[]},"latest"]);
            }
          }
          expect(simulations.filter(params => (params[0] as {nonce?:string}).nonce !== undefined).length).toBeGreaterThan(6);
          for(let i=0;i<events.length;i++) {
            if(events[i]==="simulate")expect(events[i-1]).toBe("ordering");
            if(events[i]==="broadcast")expect(events[i-1]).toBe("simulate");
          }
        } finally {rmSync(dir,{recursive:true,force:true});}
      },20_000);
    }
  }
  for (const leg of ["arrival", "return"] as const) {
    test(`${leg} canonical completion rejects missing/unknown status and retains active legs`, async () => {
      let status: string | null = null;
      const client = new ViemMissionResolutionChainClient({
        async listResolvableFleetMissions() { return []; },
        async listReturnableFleetMissions() { return []; },
        async getCanonicalFleetMission() { return status === null ? null : { status } as never; }
      }, config.gameContractAddress!, config.missionResolverAddress!);
      await expect(client.isMissionLegComplete("42", leg)).rejects.toThrow("canonical mission status unavailable");
      for (status of ["Outbound", "Unknown:255", "None"]) expect(await client.isMissionLegComplete("42", leg)).toBe(false);
      for (status of ["Returning", "Recalled"]) expect(await client.isMissionLegComplete("42", leg)).toBe(leg === "arrival");
      for (status of ["Returned", "Resolved"]) expect(await client.isMissionLegComplete("42", leg)).toBe(true);
    });

    test(`${leg} backend service does not report bounded progress or unavailable state as settlement`, async () => {
      const client = fakeClient({ calls: [], resolvable: ["1"], returnable: ["2"] });
      client.isMissionLegComplete = async () => false;
      const service = new MissionResolutionService(config, { chainClient: client, logger: silentLogger() });
      await service.tick();
      expect(service.snapshot()).toMatchObject({ resolvedCount: 0, returnedCount: 0, dueArrivals: { count: 1 }, dueReturns: { count: 1 } });
      delete client.isMissionLegComplete;
      await service.tick();
      expect(service.snapshot()).toMatchObject({ resolvedCount: 0, returnedCount: 0, dueArrivals: { count: 1 }, dueReturns: { count: 1 } });
    });
  }
  for (const leg of ["arrival", "return"] as const) {
    test(`${leg} progresses with false UI eligibility with ordering support, retaining pending until canonical transition`, async () => {
      const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
      let orderingReady = false;
      let settled = false;
      let pendingNonce = 7;
      const nonces: number[] = [];
      const reader = new VeydriftGameReader(config, {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_call");
          expect((params[0] as { data: string }).data.startsWith("0xce02abe2")).toBe(true);
          // UI ordering remains false throughout the bounded scan, without any historical backfill.
          return ("0x" + [0n, 0n, BigInt(orderingReady)].map(n => n.toString(16).padStart(64, "0")).join("")) as T;
        }
      });
      reader.listResolvableFleetMissions = async () => leg === "arrival" ? [arrival("77", "Transport", "950")] : [];
      reader.listReturnableFleetMissions = async () => leg === "return" ? [returnLeg("77", "Returning", "950")] : [];
      reader.getCanonicalFleetMission = async () => ({
        status: settled ? (leg === "arrival" ? "Returning" : "Returned") : (leg === "arrival" ? "Outbound" : "Returning")
      } as never);
      const blockHash = ("0x" + "a".repeat(64)) as Hex;
      const chronologySlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}],
        [77n,BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1")))+1n]));
      const receipts = new Map<Hex,unknown>();
      const publicClient = {
        async call() { return { data: "0x" }; },
        async getTransactionCount() { return pendingNonce; },
        async getStorageAt() { return toHex(0n,{size:32}); },
        async prepareTransactionRequest(input:object) { return {...input,maxFeePerGas:2n,maxPriorityFeePerGas:1n,type:"eip1559"}; },
        async request({method,params}:{method:string;params:unknown[]}) {
          if(method==="eth_getBlockByNumber")return {number:"0x64",hash:blockHash};
          if(method==="eth_getCode")return "0x6000";
          if(method==="eth_getStorageAt")return toHex(params[1]===chronologySlot?BigInt(pendingNonce-7):0n,{size:32});
          if(method==="eth_call")return encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]});
          if(method==="eth_getTransactionReceipt")return receipts.get(params[0] as Hex)??null;
          if(method==="eth_sendRawTransaction") {
            const raw=params[0] as Hex,tx=parseTransaction(raw),hash=keccak256(raw);
            nonces.push(tx.nonce!);pendingNonce=tx.nonce!+1;
            receipts.set(hash,{status:"0x1",transactionHash:hash,blockNumber:"0x64",blockHash});return hash;
          }
          throw new Error(method);
        }
      } as unknown as PublicClient;
      const walletClient = {
        async writeContract(input: { nonce: number }) {
          nonces.push(input.nonce);
          pendingNonce = input.nonce + 1;
          return "0x" + input.nonce.toString(16).padStart(64, "0");
        }
      } as unknown as WalletClient;
      const client = new ViemMissionResolutionChainClient(reader, config.gameContractAddress!, account,
        publicClient, walletClient, { id: 8453 } as never, config.rpcUrl, new ResolverTransactionCoordinator(":memory:"), undefined, undefined, ":memory:", [config.gameContractAddress!.toLowerCase()+":"+keccak256("0x6000")]);
      const submit = () => leg === "arrival" ? client.resolveFleetMission("77") : client.completeFleetMissionReturn("77");
      await expect(submit()).rejects.toThrow("ordering support unavailable");
      await expect(submit()).rejects.toThrow("ordering support unavailable");
      expect(nonces).toEqual([]);
      orderingReady = true;
      expect(await reader.canResolveFleetMission(77n, leg)).toBe(false);
      const service = new MissionResolutionService(config, { chainClient: client, logger: silentLogger(), now: () => 1_000_000 });
      await service.tick();
      await service.tick();
      expect(nonces).toEqual([7, 8]);
      expect(service.snapshot()).toMatchObject({ resolvedCount: 0, returnedCount: 0,
        dueArrivals: { count: leg === "arrival" ? 1 : 0 }, dueReturns: { count: leg === "return" ? 1 : 0 } });
      settled = true;
      await service.tick();
      expect(nonces).toEqual([7, 8]); // canonical transition reuses the receipt; no phantom extra broadcast
      expect(service.snapshot()).toMatchObject({ resolvedCount: leg === "arrival" ? 1 : 0,
        returnedCount: leg === "return" ? 1 : 0, dueArrivals: { count: 0 }, dueReturns: { count: 0 } });
    });
  }

  test("submits successive bounded missile chunks until canonical status leaves Outbound", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    let pendingNonce = 7;
    let canonicalStatus = "Outbound";
    let workDone = 0n;
    const nonces: number[] = [];
    const reader = {
      async isFleetChronologyOrderingReady() { return true; },
      async listResolvableFleetMissions() { return []; },
      async listReturnableFleetMissions() { return []; },
      async getCanonicalFleetMission(missionId: bigint) {
        return {
          missionId: missionId.toString(),
          statusId: canonicalStatus === "Outbound" ? 1 : 3,
          missionTypeId: 7,
          status: canonicalStatus,
          missionType: "MissileAttack",
          owner: account.address,
          originPlanetId: "1",
          targetPlanetId: "2",
          departureAt: "1",
          arrivalAt: "2",
          returnAt: "2",
          fuelCost: "0",
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          randomnessRequestId: null
        };
      }
    };
    let mined: Hex | undefined;
    let preparationFailure = true, rejectRaw = true, reverted = false;
    const rawAttempts: Hex[] = [];
    const blockHash = "0x" + "a".repeat(64);
    const arrivalSlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"bytes32"}], [2n,keccak256(stringToHex("veydrift.storage.arrival-progress.v1"))]));
    const queueSlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}], [77n,73n]));
    const publicClient = {
      async prepareTransactionRequest(input: { nonce: number; data: Hex; to: Hex; gas?: bigint }) {
        if (preparationFailure) throw new Error("insufficient funds for gas * price + value");
        return { ...input, gas: input.gas ?? 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, type: "eip1559" };
      },
      async request({ method, params }: { method: string; params: unknown[] }) {
        if (method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash };
        if (method === "eth_getStorageAt") return "0x" + (params[1] === queueSlot ? workDone : params[1] === arrivalSlot ? 1n : 0n).toString(16).padStart(64,"0");
        if (method === "eth_getCode") return "0x6000";
        if (method === "eth_call") return encodeFunctionResult({ abi: progressAbi,
          functionName: "stagedBattleProgress", result: [0, 0, 0n] });
        if (method === "eth_sendRawTransaction") {
          const raw = params[0] as Hex;
          rawAttempts.push(raw);
          if (rejectRaw) throw new Error("insufficient funds at raw broadcast");
          const tx = parseTransaction(raw);
          expect(tx.gas).toBe(15_000_000n);
          nonces.push(tx.nonce!); pendingNonce = tx.nonce! + 1;
          mined = keccak256(raw); return mined;
        }
        if (method === "eth_getTransactionReceipt") return mined === params[0]
          ? { status: reverted ? "0x0" : "0x1", transactionHash: mined, blockNumber: "0x64", blockHash } : null;
        throw new Error(method);
      },
      async call() { return { data: "0x" }; },
      async getTransactionCount() { return pendingNonce; },
      async getStorageAt() { return "0x" + "0".repeat(64); },
      async getTransactionReceipt() { return { status: "success" }; },
      async waitForTransactionReceipt() { return { status: "success" }; }
    } as unknown as PublicClient;
    const walletClient = {} as WalletClient;
    const dir = mkdtempSync(join(tmpdir(), "backend-progress-"));
    const makeClient = () => new ViemMissionResolutionChainClient(
      reader, config.gameContractAddress!, account, publicClient, walletClient,
      { id: 8453 } as never, config.rpcUrl,
      new ResolverTransactionCoordinator(":memory:"), undefined, undefined, join(dir, "intents.sqlite"),
      [`${config.gameContractAddress!}:${keccak256("0x6000")}`]
    );
    let client = makeClient();

    await expect(client.resolveFleetMission("77")).rejects.toThrow("insufficient funds");
    expect(nonces).toEqual([]);
    client = makeClient(); preparationFailure = false;
    await expect(client.resolveFleetMission("77")).rejects.toThrow("insufficient funds at raw broadcast");
    expect(nonces).toEqual([]);
    client = makeClient(); rejectRaw = false;
    await expect(client.resolveFleetMission("77")).rejects.toThrow("mission remains pending");
    expect(rawAttempts[0]).toBe(rawAttempts[1]);
    await expect(client.resolveFleetMission("77")).rejects.toThrow("mission remains pending");
    expect(nonces).toEqual([7]); // status-1 no-op never buys the same checkpoint twice
    client = makeClient(); // even loss of coordinator history cannot bypass the durable signing intent
    await expect(client.resolveFleetMission("77")).rejects.toThrow("mission remains pending");
    expect(nonces).toEqual([7]);
    workDone++;
    await expect(client.resolveFleetMission("77")).rejects.toThrow("mission remains pending");
    workDone++; reverted = true;
    await expect(client.resolveFleetMission("77")).rejects.toThrow("reverted");
    expect(nonces).toEqual([7, 8, 9]);
    client = makeClient();
    await expect(client.resolveFleetMission("77")).rejects.toThrow("mission remains pending");
    expect(nonces).toEqual([7, 8, 9]); // paid status0 cannot reopen unchanged checkpoint
    canonicalStatus = "Resolved";
    await client.resolveFleetMission("77");

    expect(nonces).toEqual([7, 8, 9]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("serializes broadcasts and confirmations while assigning pending nonces", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const broadcasts: Array<{ functionName: string; gas: bigint | undefined; nonce: number }> = [];
    let activeBroadcasts = 0;
    let peakBroadcasts = 0;
    let pendingNonce = 7;
    const publicClient = {
      async call() { return { data: "0x" }; },
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
        async isFleetChronologyOrderingReady() { return true; },
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
      { functionName: "resolveFleetMission", gas: 15_000_000n, nonce: 7 },
      { functionName: "completeFleetMissionReturn", gas: 15_000_000n, nonce: 8 }
    ]);
    expect(peakBroadcasts).toBe(1);
  });

  test("legacy injected adapter replaces an underpriced mission transaction at the same nonce with bumped fees", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const firstHash = `0x${"a".repeat(64)}` as const;
    const replacementHash = `0x${"b".repeat(64)}` as const;
    let latestNonce = 7;
    let pendingNonce = 7;
    const writes: Array<Record<string, unknown>> = [];
    const reader = new VeydriftGameReader(config, {
      async request<T>(): Promise<T> {
        return ("0x" + [0n, 0n, 1n].map(n => n.toString(16).padStart(64, "0")).join("")) as T;
      }
    });
    expect(await reader.canResolveFleetMission(45237n, "arrival")).toBe(false);
    const publicClient = {
      async call() { return { data: "0x" }; },
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
      // Explicit legacy adapter: production's canonical reader always takes durable raw signing.
      { async listResolvableFleetMissions() { return []; }, async listReturnableFleetMissions() { return []; },
        isFleetChronologyOrderingReady: id => reader.isFleetChronologyOrderingReady(id) },
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
    expect(writes[0]).toMatchObject({ gas: 15_000_000n, nonce: 7 });
    expect(writes[1]).toMatchObject({
      gas: 15_000_000n,
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
        async call() { return { data: "0x" }; },
        async getTransactionCount() { return 7 + transactions.length; },
        async getStorageAt() { return `0x${"0".repeat(64)}`; },
        async waitForTransactionReceipt() { return { status: "success" }; }
      } as unknown as PublicClient;
      const client = new ViemMissionResolutionChainClient(
        {
          async isFleetChronologyOrderingReady() { return true; },
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

      expect(transactions[0]?.gas).toBe("0xe4e1c0");
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
      async call() { return { data: "0x" }; },
      async getStorageAt(input: { slot: string }) {
        requestedSlot = input.slot;
        return `0x${"1".padStart(64, "0")}`;
      }
    } as unknown as PublicClient;
    const client = new ViemMissionResolutionChainClient(
      {
        async isFleetChronologyOrderingReady() { return true; },
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
      async call() { return { data: "0x" }; },
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
        async isFleetChronologyOrderingReady() { return true; },
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
    async isMissionLegComplete() { return true; },
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

describe("moon chance resolution", () => {
  const moon = "0x5555555555555555555555555555555555555555" as const;
  const engine = "0x6666666666666666666666666666666666666666" as const;
  const moonConfig = { ...config, moonContractAddress: moon, randomnessEngineAddress: engine };
  const purpose = `0x${"ab".repeat(32)}` as const;

  test("uses canonical fulfilled randomness, moon target and the shared mission nonce coordinator", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const coordinator = new ResolverTransactionCoordinator(":memory:");
    const writes: Array<{ address: string; functionName: string; nonce: number }> = [];
    let fulfilledAt = 0n;
    let finalized = false;
    let requester: string = moon;
    let requestPurpose: string = purpose;
    let paused = false;
    let nonceReads = 0;
    let pendingNonce = 4;
    const publicClient = {
      async call() { return { data: "0x" }; },
      readContract: async ({ functionName }: { functionName: string }) => functionName === "moonChanceRandomness"
        ? [16621n, purpose, finalized, 0n]
        : { requester, purposeHash: requestPurpose, createdAt: 1n, fulfilledAt, randomWord: 19n },
      getStorageAt: async () => paused ? "0x01" : "0x00",
      getTransactionCount: async () => { nonceReads++; return pendingNonce; },
      waitForTransactionReceipt: async () => ({ status: "success" }),
      getTransactionReceipt: async () => ({ status: "success" })
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async (call: typeof writes[number]) => {
        writes.push(call);
        pendingNonce = call.nonce + 1;
        return `0x${call.nonce.toString(16).padStart(64, "0")}`;
      }
    } as unknown as WalletClient;
    const client = () => new ViemMissionResolutionChainClient(
      { isFleetChronologyOrderingReady: async () => true, listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [] },
      config.gameContractAddress!, account, publicClient, walletClient,
      { id: config.chainId } as never, config.rpcUrl, coordinator, moon, engine
    );
    expect(await client().finalizeMoonChance("8")).toBe("pending");
    expect(nonceReads).toBe(0);
    fulfilledAt = 2n;
    requester = config.gameContractAddress!;
    await expect(client().finalizeMoonChance("8")).rejects.toThrow("identity mismatch");
    requester = moon;
    requestPurpose = `0x${"cd".repeat(32)}`;
    await expect(client().finalizeMoonChance("8")).rejects.toThrow("identity mismatch");
    requestPurpose = purpose;
    paused = true;
    await expect(client().finalizeMoonChance("8")).rejects.toThrow("canonical game pause");
    expect(nonceReads).toBe(0);
    paused = false;
    await Promise.all([client().finalizeMoonChance("8"), client().resolveFleetMission("99")]);
    expect(writes.map(({ address, functionName, nonce }) => ({ address, functionName, nonce }))).toEqual([
      { address: config.gameContractAddress!, functionName: "resolveFleetMission", nonce: 4 },
      { address: moon, functionName: "finalizeMoonChance", nonce: 5 }
    ]);
    finalized = true;
    // Re-created client / old indexed request: canonical finalization avoids any resubmission.
    expect(await client().finalizeMoonChance("8")).toBe("finalized");
    expect(writes).toHaveLength(2);
  });

  test("rotates bounded indexed candidates, catches existing pending on restart, backs off failures and honors pause/disable", async () => {
    let now = 0;
    let paused = false;
    let failFirstOutcome = true;
    const calls: string[] = [];
    const pages: number[] = [];
    const source = {
      missionResolutionCandidates: () => ({ arrivals: [], returns: [] }),
      moonChanceResolutionCandidateCount: () => 12,
      moonChanceResolutionCandidates: (after: number, limit: number) => {
        pages.push(after);
        expect(limit).toBe(10);
        return Array.from({ length: 12 }, (_, i) => ({ cursor: i + 1, outcomeId: String(i + 1) }))
          .filter(candidate => candidate.cursor > after).slice(0, limit);
      }
    };
    const options = {
      candidateSource: source,
      now: () => now,
      logger: silentLogger(),
      chainClient: {
        ...fakeClient({ calls: [], resolvable: [], returnable: [], paused: async () => paused }),
        finalizeMoonChance: async (id: string): Promise<"pending" | "finalized"> => {
          calls.push(id);
          if (id === "1" && failFirstOutcome) throw new Error("RPC temporarily unavailable");
          return id === "12" ? "finalized" : "pending";
        }
      }
    };
    const service = new MissionResolutionService(moonConfig, options);
    await service.tick();
    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["moon_chance_resolution_retrying"],
      moonChanceResolution: {
        enabled: true,
        maxPerTick: 10,
        cursor: 10,
        indexedBacklog: 12,
        lastScanned: 10,
        lastPending: 9,
        lastFinalized: 0,
        lastDeferred: 0,
        lastFailed: 1,
        retrying: 1,
        totalFailures: 1,
        lastOutcomeId: "10",
        lastResult: "pending",
        lastError: null,
        lastFailedOutcomeId: "1",
        lastFailedError: "RPC temporarily unavailable"
      }
    });
    await service.tick();
    expect(service.snapshot().moonChanceResolution).toMatchObject({
      cursor: 0,
      lastScanned: 2,
      lastPending: 1,
      lastFinalized: 1,
      lastFailed: 0,
      retrying: 1,
      totalFailures: 1,
      lastOutcomeId: "12",
      lastResult: "finalized",
      lastError: null,
      lastFailedOutcomeId: "1",
      lastFailedError: "RPC temporarily unavailable"
    });
    await service.tick();
    expect(pages).toEqual([0, 10, 0]);
    expect(calls.filter(id => id === "1")).toHaveLength(1);
    expect(calls).toContain("12");
    now = 30_000;
    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["moon_chance_resolution_retrying"],
      moonChanceResolution: {
        retrying: 1,
        lastFailedOutcomeId: "1",
        lastFailedError: "RPC temporarily unavailable"
      }
    });
    await service.tick();
    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["moon_chance_resolution_retrying"],
      moonChanceResolution: {
        retrying: 1,
        lastFailedOutcomeId: "1",
        lastFailedError: "RPC temporarily unavailable"
      }
    });
    failFirstOutcome = false;
    await service.tick();
    expect(calls.filter(id => id === "1")).toHaveLength(2);
    expect(service.snapshot()).toMatchObject({
      healthStatus: "healthy",
      healthWarnings: [],
      moonChanceResolution: {
        retrying: 0,
        lastFailedOutcomeId: null,
        lastFailedError: null
      }
    });
    paused = true;
    const beforePause = calls.length;
    await service.tick();
    expect(calls).toHaveLength(beforePause);
    paused = false;
    await new MissionResolutionService({ ...moonConfig, missionResolutionEnabled: false }, options).tick();
    expect(calls).toHaveLength(beforePause);
    await new MissionResolutionService(moonConfig, options).tick();
    expect(pages.at(-1)).toBe(0);
    expect(calls.filter(id => id === "1")).toHaveLength(3);
  });

  test("clears failed retry health only after a complete sweep observes its exact terminal report", async () => {
    const pending = new Set(Array.from({ length: 11 }, (_, index) => String(index + 1)));
    const terminal = new Set<string>();
    const pages: number[] = [];
    const terminalChecks: string[][] = [];
    const source = {
      missionResolutionCandidates: () => ({ arrivals: [], returns: [] }),
      moonChanceResolutionCandidateCount: () => pending.size,
      moonChanceResolutionCandidates: (after: number, limit: number) => {
        pages.push(after);
        return [...pending].map((outcomeId) => ({ cursor: Number(outcomeId), outcomeId }))
          .filter(candidate => candidate.cursor > after).slice(0, limit);
      },
      moonChanceTerminalOutcomeIds: (outcomeIds: readonly string[]) => {
        terminalChecks.push([...outcomeIds]);
        return outcomeIds.filter(outcomeId => terminal.has(outcomeId));
      }
    };
    const service = new MissionResolutionService(moonConfig, {
      candidateSource: source,
      logger: silentLogger(),
      chainClient: {
        ...fakeClient({ calls: [], resolvable: [], returnable: [] }),
        finalizeMoonChance: async (outcomeId: string): Promise<"pending"> => {
          if (outcomeId === "1") throw new Error("confirmation RPC timed out");
          return "pending";
        }
      }
    });

    await service.tick();
    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["moon_chance_resolution_retrying"],
      moonChanceResolution: { cursor: 10, retrying: 1, lastFailedOutcomeId: "1" }
    });

    // Outcome 1 is absent from this second keyset page, but omission from one page is not terminal
    // evidence. The retained retry must survive the completed sweep.
    await service.tick();
    expect(pages).toEqual([0, 10]);
    expect(terminalChecks).toEqual([["1"]]);
    expect(service.snapshot()).toMatchObject({
      healthStatus: "degraded",
      healthWarnings: ["moon_chance_resolution_retrying"],
      moonChanceResolution: { cursor: 0, retrying: 1, lastFailedOutcomeId: "1" }
    });

    // Chain sync replaces the pending request with an authoritative terminal report. The next
    // complete sweep must clear the stale failure even though the candidate can no longer reappear.
    pending.delete("1");
    terminal.add("1");
    await service.tick();
    expect(service.snapshot().moonChanceResolution.cursor).toBe(11);
    await service.tick();
    expect(pages).toEqual([0, 10, 0, 11]);
    expect(terminalChecks).toEqual([["1"], ["1"]]);
    expect(service.snapshot()).toMatchObject({
      healthStatus: "healthy",
      healthWarnings: [],
      moonChanceResolution: {
        cursor: 0,
        indexedBacklog: 10,
        retrying: 0,
        lastFailedOutcomeId: null,
        lastFailedError: null
      }
    });
  });
});
