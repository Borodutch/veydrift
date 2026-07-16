import { describe, expect, test } from "bun:test";

import { loadBackendConfig, type BackendConfig } from "./config";
import {
  InMemoryRandomnessCommitmentStore,
  type RandomnessCommitmentChainClient,
  type RandomnessPendingCommitment,
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

const zeroCommitment = "0x" + "0".repeat(64);

// Silent logger so deliberate failure-path tests don't print to the CI output scanner.
const silentLogger = { warn: () => {}, error: () => {} };

/** In-memory engine simulating the commit-reveal lifecycle for service-level tests. */
class FakeEngineChainClient implements RandomnessCommitmentChainClient {
  block = 100;
  pending: RandomnessPendingCommitment = { commitment: zeroCommitment, committedAtBlock: 0 };
  requests: RandomnessRequestEvent[] = [];
  committed: string[] = [];
  fulfilled: Array<{ requestId: bigint; randomWord: bigint }> = [];

  async getBlockNumber(): Promise<number> {
    return this.block;
  }

  async getPendingCommitment(): Promise<RandomnessPendingCommitment> {
    return this.pending;
  }

  async computeCommitment(randomWord: bigint): Promise<string> {
    // Deterministic stand-in for the on-chain keccak view.
    return "0x" + randomWord.toString(16).padStart(64, "0");
  }

  async commitRandomness(commitment: string): Promise<string> {
    if (this.pending.commitment !== zeroCommitment) {
      throw new Error("RandomnessCommitmentAlreadyPending");
    }
    this.pending = { commitment, committedAtBlock: this.block };
    this.committed.push(commitment);
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

  test("commits a word when none is pending and surfaces the resulting status", async () => {
    const engine = new FakeEngineChainClient();
    const service = new RandomnessCommitterService(baseConfig, {
      logger: silentLogger,
      chainClient: engine,
      store: new InMemoryRandomnessCommitmentStore(),
      fulfillerAddress: "0xc2142a4918754abe5975ecd486a66dfeba39a419"
    });

    expect(service.snapshot().enabled).toBe(true);

    await service.tick();

    expect(engine.committed.length).toBe(1);
    const snapshot = service.snapshot();
    expect(snapshot.status?.pendingCommitmentAvailable).toBe(true);
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
    engine.pending = { commitment: zeroCommitment, committedAtBlock: 0 };
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
    expect(engine.committed.length).toBe(2);
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
});
