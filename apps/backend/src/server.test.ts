import { describe, expect, test } from "bun:test";
import type { BackendConfig } from "./config";
import type { Address, ChainReader, PlanetState, PlayerQueues, SettledPlanetEvent, WalletSettlement } from "./evm";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";

const configuredTestConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  indexFromBlock: 100n,
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  settlementContractAddress: "0x1111111111111111111111111111111111111111"
};

const player = "0x2222222222222222222222222222222222222222" as Address;
const planet: PlanetState = {
  planetId: "7",
  owner: player,
  galaxy: 2,
  system: 44,
  position: 8,
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
  test("returns health status", async () => {
    const handler = createRequestHandler();
    const response = await handler(new Request("http://localhost/health"));

    await expect(response.json()).resolves.toEqual({
      chain: {
        chainId: 84532,
        deploymentMode: "local",
        hasRpcUrl: false,
        indexFromBlock: "0",
        rpcSource: "missing",
        settlementContractConfigured: false
      },
      configured: false,
      indexer: null,
      ok: true,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(200);
  });

  test("returns a minimal GraphQL response", async () => {
    const handler = createRequestHandler();
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
          status: "coming-soon"
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
        settlementContractConfigured: true
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
        position: 8
      }
    });
    expect(response.status).toBe(200);
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
    expect(body.planets[7]).toMatchObject({
      position: 8,
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
    expect(body.systems[1].planets[7]).toMatchObject({
      galaxy: 2,
      system: 44,
      position: 8,
      key: "2:44:8"
    });
  });
});
