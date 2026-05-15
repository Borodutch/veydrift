import { describe, expect, test } from "bun:test";
import type { BackendConfig } from "./config";
import type {
  Address,
  ChainReader,
  PlanetState,
  PlayerQueues,
  SettledPlanetEvent,
  ShipyardState,
  WalletSettlement
} from "./evm";
import { VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";

const configuredTestConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  indexFromBlock: 100n,
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  settlementContractAddress: "0x1111111111111111111111111111111111111111",
  gameContractAddress: "0x3333333333333333333333333333333333333333"
};

const player = "0x2222222222222222222222222222222222222222" as Address;
const planet: PlanetState = {
  planetId: "7",
  owner: player,
  galaxy: 2,
  system: 44,
  position: 9,
  fields: 211,
  temperature: -8,
  metalMultiplierBps: 9788,
  crystalMultiplierBps: 10233,
  deuteriumMultiplierBps: 10584,
  lastSettledAt: "1770000000",
  resources: {
    metal: "5000",
    crystal: "4900",
    deuterium: "4800"
  }
};

class MockChainReader implements ChainReader {
  rebuildCalls = 0;

  async getWalletSettlement(wallet: Address): Promise<WalletSettlement> {
    return {
      wallet,
      hasFirstPlanet: true,
      homePlanetId: planet.planetId,
      planet
    };
  }

  async getPlanet(planetId: bigint): Promise<PlanetState | null> {
    return planetId === 7n ? planet : null;
  }

  async getPlayerQueues(wallet: Address): Promise<PlayerQueues> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      building: {
        active: true,
        kind: "building",
        targetLevel: 2,
        readyAt: "1770000060",
        cost: {
          metal: "60",
          crystal: "15",
          deuterium: "0"
        }
      },
      defense: null,
      ship: null,
      research: null
    };
  }

  async getShipyardState(wallet: Address): Promise<ShipyardState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      productionAvailable: true,
      resources: planet.resources,
      shipyardLevel: 1,
      technologyLevels: {
        "3": 1
      },
      ships: [
        {
          id: 0,
          count: 2,
          cost: {
            metal: "2000",
            crystal: "2000",
            deuterium: "0"
          }
        },
        {
          id: 1,
          count: 0,
          cost: {
            metal: "3000",
            crystal: "1000",
            deuterium: "0"
          }
        }
      ],
      queue: {
        active: true,
        itemId: 0,
        kind: "ship",
        quantity: 1,
        readyAt: "1770000060",
        cost: {
          metal: "2000",
          crystal: "2000",
          deuterium: "0"
        }
      }
    };
  }

  async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> {
    this.rebuildCalls += 1;
    return [
      {
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      }
    ];
  }
}

describe("Veydrift backend", () => {
  const handler = createRequestHandler();

  test("returns health status", async () => {
    const response = await handler(new Request("http://localhost/health"));

    await expect(response.json()).resolves.toEqual({
      chain: {
        chainId: 84532,
        deploymentMode: "local",
        hasRpcUrl: false,
        indexFromBlock: "0",
        rpcSource: "missing",
        settlementContractConfigured: false,
        gameContractConfigured: false
      },
      configured: false,
      indexer: null,
      ok: true,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(200);
  });

  test("returns public runtime config", async () => {
    const response = await handler(new Request("http://localhost/runtime-config"));

    await expect(response.json()).resolves.toEqual({
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532,
      contractAddress: null,
      gameContractAddress: null,
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      network: "Base Sepolia",
      rpcProvider: "unknown"
    });
    expect(response.status).toBe(200);
  });

  test("publishes split settlement and game contracts in runtime config", async () => {
    const previousGameAddress = process.env.VEYDRIFT_CONTRACT_ADDRESS;
    const previousGameOverrideAddress = process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS;
    const previousSettlementAddress = process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS;
    process.env.VEYDRIFT_CONTRACT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS = "0x4444444444444444444444444444444444444444";
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";

    try {
      const response = await handler(new Request("http://localhost/runtime-config"));

      await expect(response.json()).resolves.toMatchObject({
        contractAddress: "0x1111111111111111111111111111111111111111",
        gameContractAddress: "0x4444444444444444444444444444444444444444"
      });
      expect(response.status).toBe(200);
    } finally {
      if (previousGameAddress === undefined) {
        delete process.env.VEYDRIFT_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_CONTRACT_ADDRESS = previousGameAddress;
      }

      if (previousGameOverrideAddress === undefined) {
        delete process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS = previousGameOverrideAddress;
      }

      if (previousSettlementAddress === undefined) {
        delete process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS = previousSettlementAddress;
      }
    }
  });

  test("returns a minimal GraphQL response", async () => {
    const response = await handler(
      new Request("http://localhost/graphql", {
        body: JSON.stringify({
          query: "{ service { name status } }"
        }),
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({
      data: {
        service: {
          name: "Veydrift",
          runtime: {
            apiUrl: "https://api-test.veydrift.com",
            chainId: 84532,
            contractAddress: null,
            gameContractAddress: null,
            graphqlUrl: "https://api-test.veydrift.com/graphql",
            network: "Base Sepolia",
            rpcProvider: "unknown"
          },
          status: "playable-test"
        }
      }
    });
    expect(response.status).toBe(200);
  });

  test("does not leak secrets in config debug output", async () => {
    const response = await createRequestHandler({
      config: {
        ...configuredTestConfig,
        rpcSource: "alchemy-key",
        rpcUrl: "https://base-sepolia.g.alchemy.com/v2/not-for-output"
      },
      chainReader: new MockChainReader()
    })(new Request("http://localhost/debug/config"));

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("not-for-output");
    expect(body).toMatchObject({
      configured: true,
      chain: {
        hasRpcUrl: true,
        rpcSource: "alchemy-key",
        settlementContractConfigured: true,
        gameContractConfigured: true
      }
    });
  });

  test("answers first planet settlement from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/settlement`));

    await expect(response.json()).resolves.toMatchObject({
      wallet: player,
      hasFirstPlanet: true,
      homePlanetId: "7",
      planet: {
        galaxy: 2,
        system: 44,
        position: 9
      }
    });
    expect(response.status).toBe(200);
  });

  test("answers shipyard state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    const body = await response.json();
    expect(body.wallet).toBe(player);
    expect(body.homePlanetId).toBe("7");
    expect(body.resources.metal).toBe("5000");
    expect(body.shipyardLevel).toBe(1);
    expect(body.technologyLevels["3"]).toBe(1);
    expect(body.queue).toMatchObject({
      active: true,
      itemId: 0,
      kind: "ship"
    });
    expect(body.ships).toContainEqual({
      id: 0,
      count: 2,
      cost: {
        metal: "2000",
        crystal: "2000",
        deuterium: "0"
      }
    });
    expect(response.status).toBe(200);
  });

  test("falls back to compact settlement reads when configured contract is not VeydriftGame", async () => {
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(_method: string, params: unknown[]): Promise<T> {
        const [call] = params as [{ data: string }];
        if (call.data.startsWith("0x0ff79fa5")) {
          throw new Error("RPC 3: execution reverted");
        }
        if (call.data.startsWith("0x1d750846")) {
          return abiWords(1n) as T;
        }
        if (call.data.startsWith("0x29147f24")) {
          return abiWords(2n, 44n, 9n, 0n, 0n, 1_770_000_000n, 123n) as T;
        }

        throw new Error(`Unexpected call ${call.data.slice(0, 10)}`);
      }
    });

    await expect(reader.getWalletSettlement(player)).resolves.toMatchObject({
      wallet: player,
      hasFirstPlanet: true,
      homePlanetId: null,
      contractKind: "settlement",
      planet: {
        galaxy: 2,
        system: 44,
        position: 9,
        resources: {
          metal: "0",
          crystal: "0",
          deuterium: "0"
        }
      }
    });

    await expect(reader.getShipyardState(player)).resolves.toMatchObject({
      wallet: player,
      homePlanetId: null,
      productionAvailable: false,
      shipyardLevel: 0,
      ships: []
    });
  });

  test("rebuilds the cache and marks occupied system coordinates", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const rebuild = await handler(
      new Request("http://localhost/index/rebuild", {
        method: "POST"
      })
    );
    await expect(rebuild.json()).resolves.toMatchObject({
      indexedPlanets: 1,
      fromBlock: "100"
    });

    const system = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const body = await system.json();
    expect(body.planets.find((item: { position: number }) => item.position === 9)).toMatchObject({
      position: 9,
      occupiedBy: {
        planetId: "7",
        owner: player
      }
    });
    expect(chainReader.rebuildCalls).toBe(1);
  });

  test("serves deterministic systems around a center coordinate", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=1"));

    const body = await response.json();
    expect(body.systems).toHaveLength(3);
    expect(body.systems.map((system: { system: number }) => system.system)).toEqual([43, 44, 45]);
    expect(body.systems[1].planets.find((item: { position: number }) => item.position === 8)).toMatchObject({
      galaxy: 2,
      system: 44,
      position: 8,
      key: "2:44:8"
    });
  });

  test("returns deterministic universe system data", async () => {
    const response = await handler(
      new Request("http://localhost/universe/system?galaxyId=0&systemId=1")
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.system.galaxyId).toBe(0);
    expect(body.data.system.systemId).toBe(1);
    expect(body.data.system.slots.length).toBeGreaterThanOrEqual(5);
    expect(body.data.system.slots.length).toBeLessThanOrEqual(11);
    const populatedSlots = body.data.system.slots.map((slot: { slot: number }) => slot.slot);
    expect(populatedSlots).toEqual([...populatedSlots].sort((left, right) => left - right));
    expect(body).toEqual(
      await (
        await handler(
          new Request("http://localhost/universe/system?galaxyId=0&systemId=1")
        )
      ).json()
    );
  });

  test("rejects invalid universe coordinates", async () => {
    const response = await handler(
      new Request("http://localhost/universe/system?galaxyId=0&systemId=zero")
    );

    await expect(response.json()).resolves.toEqual({
      errors: [
        {
          message: "systemId must be a positive integer."
        }
      ]
    });
    expect(response.status).toBe(400);
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}
