import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadBackendConfig, type BackendConfig } from "./config";
import {
  InMemoryRandomnessCommitmentStore,
  loadRandomnessReadinessSnapshot,
  type RandomnessCommitmentChainClient,
  type RandomnessCommitmentInventory,
  type RandomnessRequestEvent
} from "./randomness";
import { RandomnessCommitterService } from "./randomnessCommitter";

const baseConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  qaSyntheticStationedDefenders: false,
  indexDbPath: ":memory:",
  indexFromBlock: 0n,
  missionResolutionEnabled: false,
  randomnessCommitmentStorePath: ".data/test-randomness.json",
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://rpc.example",
  wsRpcSource: "missing",
  randomnessEngineAddress: "0x51a5faba3fa903edcecdebceea3865bd63d359bb"
};

// Silent logger so deliberate failure-path tests don't print to the CI output scanner.
const silentLogger = { warn: () => {}, error: () => {} };

/** In-memory engine simulating the commit-reveal lifecycle for service-level tests. */
class FakeEngineChainClient implements RandomnessCommitmentChainClient {
  block = 100;
  inventory: RandomnessCommitmentInventory["commitments"] = [];
  requests: RandomnessRequestEvent[] = [];
  committed: string[] = [];
  fulfilled: Array<{ requestId: bigint; randomWord: bigint }> = [];

  async getBlockNumber(): Promise<number> {
    return this.block;
  }

  async getCommitmentInventory(): Promise<RandomnessCommitmentInventory> {
    return {
      commitments: this.inventory.map((entry) => ({ ...entry })),
      readyCommitments: this.inventory.filter((entry) => this.block > entry.committedAtBlock).length
    };
  }

  async computeCommitment(randomWord: bigint): Promise<string> {
    // Deterministic stand-in for the on-chain keccak view.
    return "0x" + randomWord.toString(16).padStart(64, "0");
  }

  async commitRandomnessBatch(commitments: string[]): Promise<string> {
    this.inventory.push(...commitments.map((commitment) => ({
      commitment,
      committedAtBlock: this.block
    })));
    this.committed.push(...commitments);
    return "0xcommit";
  }

  async fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string> {
    this.fulfilled.push({ requestId, randomWord });
    return "0xfulfill";
  }

  async listPendingRequests(): Promise<RandomnessRequestEvent[]> {
    return this.requests;
  }
}

describe("RandomnessCommitterService", () => {
  test("is disabled when no fulfiller key/chain client is configured", () => {
    const result = loadBackendConfig({
      VEYDRIFT_RPC_URL: "https://rpc.example",
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
      VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS: "0x51a5faba3fa903edcecdebceea3865bd63d359bb"
    });
    const service = new RandomnessCommitterService(result.config);
    const snapshot = service.snapshot();

    expect(snapshot.enabled).toBe(false);
    expect(snapshot.engineConfigured).toBe(true);
    // start() must be a no-op and not throw when disabled.
    service.start();
    expect(service.snapshot().status).toBeNull();
  });

  test("fills the burst inventory and reports readiness after activation", async () => {
    const engine = new FakeEngineChainClient();
    const service = new RandomnessCommitterService(baseConfig, {
      logger: silentLogger,
      chainClient: engine,
      store: new InMemoryRandomnessCommitmentStore(),
      fulfillerAddress: "0xc2142a4918754abe5975ecd486a66dfeba39a419"
    });

    expect(service.snapshot().enabled).toBe(true);

    await service.tick();

    expect(engine.committed.length).toBe(8);
    expect(service.snapshot().status?.commitmentInventory).toBe(8);
    expect(service.snapshot().status?.readyCommitments).toBe(0);

    engine.block += 1;
    await service.tick();
    const snapshot = service.snapshot();
    expect(snapshot.status?.pendingCommitmentAvailable).toBe(true);
    expect(snapshot.status?.readyCommitments).toBe(8);
    expect(snapshot.status?.targetCommitments).toBe(8);
    expect(snapshot.status?.alerts ?? []).not.toContain(
      "no pending randomness commitment available; randomness-consuming actions will revert"
    );
    expect(snapshot.fulfiller).toBe("0xc2142a4918754abe5975ecd486a66dfeba39a419");
    expect(snapshot.lastError).toBeNull();
  });

  test("reveals a consumed commitment with the exact committed word across restart", async () => {
    const store = new InMemoryRandomnessCommitmentStore();
    const engine = new FakeEngineChainClient();
    const first = new RandomnessCommitterService(baseConfig, { chainClient: engine, store });

    // Tick 1: commits word for an empty engine.
    await first.tick();
    const committedCommitment = engine.committed[0]!;
    const committedWord = BigInt(committedCommitment); // computeCommitment is identity-hex in the fake

    // The game consumes the commitment: a request now carries it, and on-chain pending clears.
    engine.inventory.shift();
    engine.block = 105;
    engine.requests = [
      {
        requestId: "7",
        requester: "0x1111111111111111111111111111111111111111",
        purposeHash: "0x" + "aa".repeat(32),
        createdAt: 1000,
        randomnessCommitment: committedCommitment
      }
    ];

    // Restart: a fresh service must load the persisted secret and reveal the exact word.
    const restarted = new RandomnessCommitterService(baseConfig, { chainClient: engine, store });
    await restarted.tick();

    expect(engine.fulfilled).toEqual([{ requestId: 7n, randomWord: committedWord }]);
    // After revealing and clearing the request, it recommits so a commitment stays pending.
    expect(engine.committed.length).toBe(9);
    expect(restarted.snapshot().status?.pendingCommitmentAvailable).toBe(true);
  });

  test("alerts and records lastError when the engine read fails", async () => {
    const engine = new FakeEngineChainClient();
    engine.getBlockNumber = async () => {
      throw new Error("rpc down");
    };
    const service = new RandomnessCommitterService(baseConfig, {
      logger: silentLogger,
      chainClient: engine,
      store: new InMemoryRandomnessCommitmentStore()
    });

    await service.tick();

    expect(service.snapshot().lastError).toContain("rpc down");
  });

  test("logs a persistent readiness alert once until it clears", async () => {
    const engine = new FakeEngineChainClient();
    const warnings: string[] = [];
    const store = new InMemoryRandomnessCommitmentStore();
    const service = new RandomnessCommitterService(baseConfig, {
      logger: { warn: (message) => warnings.push(message), error: () => {} },
      chainClient: engine,
      store
    });

    engine.commitRandomnessBatch = async () => {
      throw new Error("oracle wallet has no gas");
    };
    await service.tick();
    const firstWarningCount = warnings.length;
    expect(firstWarningCount).toBeGreaterThan(0);

    await service.tick();
    expect(warnings).toHaveLength(firstWarningCount);

    engine.commitRandomnessBatch = async (commitments) => {
      engine.inventory.push(...commitments.map((commitment) => ({
        commitment,
        committedAtBlock: engine.block
      })));
      return "0xcommit";
    };
    await service.tick();
    expect(service.snapshot().status?.alerts).toEqual([]);
  });

  test("fails closed for new attacks when a consumed commitment has no durable reveal word", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-randomness-committer-"));
    const config = { ...baseConfig, randomnessCommitmentStorePath: join(dir, "commitments.sqlite") };
    const engine = new FakeEngineChainClient();
    engine.requests = [{
      requestId: "3168",
      requester: "0x1111111111111111111111111111111111111111",
      purposeHash: "0x" + "aa".repeat(32),
      createdAt: 1000,
      randomnessCommitment: "0x" + "ff".repeat(32)
    }];
    try {
      const service = new RandomnessCommitterService(config, {
        logger: silentLogger,
        chainClient: engine
      });
      await service.tick();
      expect(loadRandomnessReadinessSnapshot(config.randomnessCommitmentStorePath)).toMatchObject({
        ready: false,
        reasons: ["A required randomness reveal mapping is unavailable. New attacks are temporarily paused."]
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
