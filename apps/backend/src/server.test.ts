import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { resolveWsRpcUrl, type BackendConfig } from "./config";
import type {
  Address,
  AllianceState,
  AttackProtectionStatus,
  ChainReader,
  DebrisFieldEvent,
  DefenseState,
  InfrastructureState,
  ManagedPlanet,
  MoonState,
  MoonChanceReportEvent,
  PlanetState,
  PlayerQueues,
  ResearchState,
  RiftState,
  SettledPlanetEvent,
  ShipyardState,
  WalletSettlement,
  WalletPlanets
} from "./evm";
import { calculateHighscore, type HighscoreEntry } from "./highscores";
import { VeydriftGameReader, riftRequirements } from "./evm";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";

const configuredTestConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: false,
  resourceTokenAddresses: {
    crystal: "0x6666666666666666666666666666666666666666",
    deuterium: "0x7777777777777777777777777777777777777777",
    metal: "0x5555555555555555555555555555555555555555"
  },
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "missing",
  settlementContractAddress: "0x1111111111111111111111111111111111111111",
  gameContractAddress: "0x3333333333333333333333333333333333333333"
};

const player = "0x2222222222222222222222222222222222222222" as Address;
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const planet: PlanetState = {
  planetId: "7",
  owner: player,
  name: "Eos",
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

describe("Rift requirement projection", () => {
  test("matches the current Interdimensional Rift Stabilizer build dependencies", () => {
    expect(riftRequirements(false, 0, 0, {})).toEqual([
      {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Interdimensional Rift Stabilizer",
        currentLevel: 0,
        requiredLevel: 1,
        binary: true,
        built: false
      },
      {
        kind: "building",
        key: "roboticsFactory",
        label: "Robotics Factory",
        currentLevel: 0,
        requiredLevel: 4
      },
      {
        kind: "building",
        key: "researchLab",
        label: "Research Lab",
        currentLevel: 0,
        requiredLevel: 2
      },
      {
        kind: "technology",
        key: "energy",
        label: "Energy Technology",
        currentLevel: 0,
        requiredLevel: 5
      },
      {
        kind: "technology",
        key: "hyperspace",
        label: "Hyperspace Technology",
        currentLevel: 0,
        requiredLevel: 1
      }
    ]);
  });
});

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

  async getWalletPlanets(wallet: Address): Promise<WalletPlanets> {
    const managedPlanet: ManagedPlanet = {
      ...planet,
      coordinates: "2:44:9",
      isHomePlanet: true,
      fieldsUsed: 3,
      fieldsCapacity: planet.fields,
      keyLevels: {
        metalMine: 1,
        crystalMine: 1,
        deuteriumSynthesizer: 0,
        solarPlant: 1,
        roboticsFactory: 0,
        shipyard: 1,
        researchLab: 1,
        terraformer: 0
      },
      queues: {
        building: null,
        defense: null,
        ship: null
      },
      moon: {
        exists: true
      }
    };
    return {
      wallet,
      homePlanetId: planet.planetId,
      planets: [managedPlanet]
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

  async getFleetMissionVisibility(wallet: Address) {
    return {
      wallet,
      homePlanetId: planet.planetId,
      incoming: [],
      outgoing: [],
      returning: [],
      joinableAttacks: []
    };
  }

  async getInfrastructureState(wallet: Address): Promise<InfrastructureState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: planet.resources,
      productionPerHour: {
        metal: "30",
        crystal: "15",
        deuterium: "8"
      },
      energyBalance: {
        produced: "60",
        required: "100",
        scaleBps: "6000"
      },
      storageCaps: {
        metal: "10000",
        crystal: "10000",
        deuterium: "10000"
      },
      protectedResources: {
        metal: "1000",
        crystal: "1000",
        deuterium: "1000"
      },
      raidableResources: {
        metal: "4000",
        crystal: "3900",
        deuterium: "3800"
      },
      technologyLevels: {
        "0": 3
      },
      buildings: [
        {
          id: 0,
          level: 1,
          cost: {
            metal: "120",
            crystal: "30",
            deuterium: "0"
          }
        }
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 0,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: {
          metal: "60",
          crystal: "15",
          deuterium: "0"
        }
      }
    };
  }

  async getMoonState(wallet: Address): Promise<MoonState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      moonAvailable: true,
      moon: {
        exists: true,
        planetId: planet.planetId,
        owner: wallet,
        fields: 4,
        diameterKm: 7120,
        createdAt: "1770000100",
        jumpGateReadyAt: "1770007200"
      },
      buildings: [
        {
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 1,
          cost: {
            metal: "40000",
            crystal: "80000",
            deuterium: "40000"
          }
        },
        {
          id: 2,
          key: "jumpGate",
          label: "Jump Gate",
          level: 1,
          cost: {
            metal: "4000000",
            crystal: "8000000",
            deuterium: "4000000"
          }
        }
      ],
      queue: {
        active: true,
        kind: "moon-building",
        itemId: 2,
        targetLevel: 2,
        readyAt: "1770000900",
        cost: {
          metal: "4000000",
          crystal: "8000000",
          deuterium: "4000000"
        }
      }
    };
  }

  async getShipyardState(wallet: Address): Promise<ShipyardState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      productionAvailable: true,
      resources: planet.resources,
      fleetSlots: {
        active: 1,
        limit: 2
      },
      shipyardLevel: 1,
      naniteLevel: 0,
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

  async getDefenseState(wallet: Address): Promise<DefenseState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      productionAvailable: true,
      resources: planet.resources,
      shipyardLevel: 1,
      missileSiloLevel: 2,
      technologyLevels: {
        "1": 1
      },
      defenses: [
        {
          id: 0,
          count: 3,
          cost: {
            metal: "2000",
            crystal: "0",
            deuterium: "0"
          }
        },
        {
          id: 1,
          count: 0,
          cost: {
            metal: "1500",
            crystal: "500",
            deuterium: "0"
          }
        }
      ],
      queue: {
        active: true,
        itemId: 0,
        kind: "defense",
          quantity: 2,
          readyAt: "1770000060",
          cost: {
            metal: "4000",
            crystal: "0",
            deuterium: "0"
        }
      }
    };
  }

  async getResearchState(wallet: Address): Promise<ResearchState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      researchAvailable: true,
      resources: planet.resources,
      researchLabLevel: 1,
      researchNetworkLabLevels: [],
      technologyLevels: {
        "0": 1
      },
      technologies: [
        {
          id: 0,
          level: 1,
          cost: {
            metal: "0",
            crystal: "1600",
            deuterium: "800"
          }
        },
        {
          id: 1,
          level: 0,
          cost: {
            metal: "200",
            crystal: "100",
            deuterium: "0"
          }
        }
      ],
      queue: {
        active: true,
        itemId: 0,
        kind: "research",
        targetLevel: 2,
        readyAt: "1770000060",
        cost: {
          metal: "0",
          crystal: "1600",
          deuterium: "800"
        }
      }
    };
  }

  async getRiftState(wallet: Address): Promise<RiftState> {
    return {
      wallet,
      homePlanetId: planet.planetId,
      riftAvailable: true,
      unlocked: true,
      withdrawalDelaySeconds: "2592000",
      requirements: [
        {
          kind: "building",
          key: "interdimensionalRiftStabilizer",
          label: "Interdimensional Rift Stabilizer",
          currentLevel: 1,
          requiredLevel: 1,
          binary: true,
          built: true
        }
      ],
      resources: [
        {
          key: "metal",
          label: "Metal",
          resourceId: 0,
          tokenAddress: "0x4444444444444444444444444444444444444444",
          walletBalance: "25000000",
          allowance: "5000000",
          inGameBalance: "5000",
          lockedBalance: "0"
        }
      ],
      pendingWithdrawals: [
        {
          id: "0",
          resource: "metal",
          amount: "1000000",
          requestedAt: "2026-05-01T00:00:00.000Z",
          unlocksAt: "2026-05-31T00:00:00.000Z",
          ready: false
        }
      ]
    };
  }

  async getAllianceState(wallet: Address): Promise<AllianceState> {
    return {
      wallet,
      allianceAvailable: true,
      membership: {
        allianceId: "1",
        role: "owner",
        joinedAt: "1770000000"
      },
      profile: {
        active: true,
        tag: "VDFT",
        name: "Veydrift Union",
        description: "Discord: https://discord.gg/vdft",
        owner: wallet,
        createdAt: "1770000000",
        memberCount: 1
      },
      directory: [
        {
          allianceId: "1",
          active: true,
          tag: "VDFT",
          name: "Veydrift Union",
          description: "Discord: https://discord.gg/vdft",
          owner: wallet,
          createdAt: "1770000000",
          memberCount: 1
        }
      ],
      pendingInvites: [],
      pendingJoinRequests: [],
      allianceJoinRequests: [],
      members: [{ address: wallet, role: "owner", joinedAt: "1770000000" }]
    };
  }

  async getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
    return {
      wallet,
      targetPlanetId: targetPlanetId.toString(),
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      relation: "peer",
      defenderHonorStatus: "neutral",
      plunderBps: 5000,
      defenderInactive: false
    };
  }

  async getHighscoreForWallet(wallet: Address): Promise<HighscoreEntry> {
    return calculateHighscore({
      wallet,
      homePlanetId: planet.planetId,
      planetCount: 1,
      planets: [
        {
          buildings: [
            { id: 0, level: 1 },
            { id: 5, level: 1 }
          ],
          defenses: [
            { id: 0, count: 3 }
          ],
          ships: [
            { id: 0, count: 2 }
          ]
        }
      ],
      technologies: [
        { id: 0, level: 1 }
      ]
    });
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

  async listMoonChanceReportEvents(): Promise<MoonChanceReportEvent[]> {
    return [
      {
        eventName: "MoonChanceRequested",
        transactionHash: "0xghi",
        blockNumber: "125",
        battleId: "42",
        targetPlanetId: planet.planetId,
        outcomeId: "5",
        defender: player,
        metalDebris: "90000",
        crystalDebris: "10000",
        chanceBps: 100,
        randomnessRequestId: "8",
        purposeHash: `0x${"abc".padStart(64, "0")}`
      }
    ];
  }

  async listDebrisFieldEvents(): Promise<DebrisFieldEvent[]> {
    return [
      {
        eventName: "DebrisFieldUpdated",
        transactionHash: "0xdef",
        blockNumber: "124",
        planetId: planet.planetId,
        resources: {
          metal: "27000",
          crystal: "9000"
        }
      }
    ];
  }
}

function testIndexer(): SettlementIndexer {
  const indexer = new SettlementIndexer(new MockChainReader(), 100n);
  indexer.applyEvent({
    ...planet,
    eventName: "PlanetStarted",
    transactionHash: "0xabc",
    blockNumber: "123"
  });
  return indexer;
}

function withoutIndexLists(reader: ChainReader): ChainReader {
  return new Proxy(reader, {
    get(target, property, receiver) {
      if (
        property === "listSettledPlanetEvents"
        || property === "listMoonChanceReportEvents"
        || property === "listDebrisFieldEvents"
      ) {
        return undefined;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

describe("Veydrift backend", () => {
  const handler = createRequestHandler();

  test("returns health status", async () => {
    const response = await handler(new Request("http://localhost/health"));

    await expect(response.json()).resolves.toEqual({
      chain: {
        alchemyWebhookConfigured: false,
        allianceContractConfigured: false,
        chainId: 84532,
        deploymentMode: "local",
        hasRpcUrl: false,
        indexFromBlock: "0",
        missionResolutionEnabled: false,
        missionResolverConfigured: false,
        resourceTokensConfigured: {
          crystal: false,
          deuterium: false,
          metal: false
        },
        rpcSource: "missing",
        wsRpcSource: "missing",
        hasWsRpcUrl: false,
        resourceTokenAddressesConfigured: false,
        settlementContractConfigured: false,
        moonContractConfigured: false,
        randomnessEngineConfigured: false,
        gameContractConfigured: false
      },
      configured: false,
      chainSync: null,
      indexer: null,
      missionResolution: null,
      rpc: null,
      ok: true,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(200);
  });

  test("returns public runtime config", async () => {
    const response = await handler(new Request("http://localhost/runtime-config"));

    await expect(response.json()).resolves.toEqual({
      apiUrl: "https://api-test.veydrift.com",
      allianceContractAddress: null,
      chainId: 84532,
      contractAddress: null,
      featureSupport: {
        allianceConfigured: false,
        gameConfigured: false,
        highscoresEndpoint: true,
        moonConfigured: false,
        randomnessConfigured: false,
        researchEndpoint: true,
        resourceTokensConfigured: false,
        settlementConfigured: false
      },
      gameContractAddress: null,
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      moonContractAddress: null,
      network: "Base Sepolia",
      randomnessEngineAddress: null,
      resourceTokenAddresses: {
        crystal: null,
        deuterium: null,
        metal: null
      },
      rpcProvider: "unknown"
    });
    expect(response.status).toBe(200);
  });

  test("publishes split settlement and game contracts in runtime config", async () => {
    const previousGameAddress = process.env.VEYDRIFT_CONTRACT_ADDRESS;
    const previousGameOverrideAddress = process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS;
    const previousSettlementAddress = process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS;
    const previousMoonAddress = process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS;
    const previousRandomnessEngineAddress = process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS;
    const previousAllianceAddress = process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS;
    const previousMetalTokenAddress = process.env.VEYDRIFT_METAL_TOKEN_ADDRESS;
    const previousCrystalTokenAddress = process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS;
    const previousDeuteriumTokenAddress = process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS;
    process.env.VEYDRIFT_CONTRACT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS = "0x4444444444444444444444444444444444444444";
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS = "0x8888888888888888888888888888888888888888";
    process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS = "0x9999999999999999999999999999999999999999";
    process.env.VEYDRIFT_METAL_TOKEN_ADDRESS = "0x5555555555555555555555555555555555555555";
    process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS = "0x6666666666666666666666666666666666666666";
    process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS = "0x7777777777777777777777777777777777777777";

    try {
      const response = await handler(new Request("http://localhost/runtime-config"));

      await expect(response.json()).resolves.toMatchObject({
        contractAddress: "0x1111111111111111111111111111111111111111",
        gameContractAddress: "0x4444444444444444444444444444444444444444",
        allianceContractAddress: "0x9999999999999999999999999999999999999999",
        moonContractAddress: "0x2222222222222222222222222222222222222222",
        randomnessEngineAddress: "0x8888888888888888888888888888888888888888",
        featureSupport: {
          allianceConfigured: true,
          gameConfigured: true,
          highscoresEndpoint: true,
          moonConfigured: true,
          randomnessConfigured: true,
          researchEndpoint: true,
          resourceTokensConfigured: true,
          settlementConfigured: true
        },
        resourceTokenAddresses: {
          crystal: "0x6666666666666666666666666666666666666666",
          deuterium: "0x7777777777777777777777777777777777777777",
          metal: "0x5555555555555555555555555555555555555555"
        }
      });
      expect(response.status).toBe(200);
    } finally {
      if (previousGameAddress === undefined) {
        delete process.env.VEYDRIFT_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_CONTRACT_ADDRESS = previousGameAddress;
      }
      if (previousAllianceAddress === undefined) {
        delete process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS = previousAllianceAddress;
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
      if (previousMoonAddress === undefined) {
        delete process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS = previousMoonAddress;
      }
      if (previousRandomnessEngineAddress === undefined) {
        delete process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS;
      } else {
        process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS = previousRandomnessEngineAddress;
      }
      if (previousMetalTokenAddress === undefined) {
        delete process.env.VEYDRIFT_METAL_TOKEN_ADDRESS;
      } else {
        process.env.VEYDRIFT_METAL_TOKEN_ADDRESS = previousMetalTokenAddress;
      }
      if (previousCrystalTokenAddress === undefined) {
        delete process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS;
      } else {
        process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS = previousCrystalTokenAddress;
      }
      if (previousDeuteriumTokenAddress === undefined) {
        delete process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS;
      } else {
        process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS = previousDeuteriumTokenAddress;
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
            allianceContractAddress: null,
            apiUrl: "https://api-test.veydrift.com",
            chainId: 84532,
            contractAddress: null,
            featureSupport: {
              allianceConfigured: false,
              gameConfigured: false,
              highscoresEndpoint: true,
              moonConfigured: false,
              randomnessConfigured: false,
              researchEndpoint: true,
              resourceTokensConfigured: false,
              settlementConfigured: false
            },
            gameContractAddress: null,
            graphqlUrl: "https://api-test.veydrift.com/graphql",
            moonContractAddress: null,
            network: "Base Sepolia",
            randomnessEngineAddress: null,
            resourceTokenAddresses: {
              crystal: null,
              deuterium: null,
              metal: null
            },
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
        wsRpcSource: "missing",
        hasWsRpcUrl: false,
        resourceTokenAddressesConfigured: true,
        settlementContractConfigured: true,
        moonContractConfigured: false,
        randomnessEngineConfigured: false,
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

  test("answers wallet planet management state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new MockChainReader())
    })(new Request(`http://localhost/wallet/${player}/planets`));

    await expect(response.json()).resolves.toMatchObject({
      wallet: player,
      homePlanetId: "7",
      planets: [
        {
          planetId: "7",
          name: "Eos",
          coordinates: "2:44:9",
          fieldsUsed: 3,
          fieldsCapacity: 211,
          moon: {
            exists: true
          }
        }
      ]
    });
    expect(response.status).toBe(200);
  });

  test("answers wallet planet management state from the DB-backed indexer without live RPC", async () => {
    const indexer = testIndexer();
    let liveReadCalled = false;
    const response = await createRequestHandler({
      config: configuredTestConfig,
      indexer,
      chainReader: new class extends MockChainReader {
        override async getWalletPlanets(): Promise<WalletPlanets> {
          liveReadCalled = true;
          throw new Error("RPC HTTP 429");
        }
      }()
    })(new Request(`http://localhost/wallet/${player}/planets`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(liveReadCalled).toBe(false);
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: "7",
      planets: [
        {
          planetId: "7",
          coordinates: "2:44:9",
          resources: {
            metal: "5000",
            crystal: "4900",
            deuterium: "4800"
          },
          queues: {
            building: null,
            defense: null,
            ship: null
          }
        }
      ]
    });
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

  test("returns service unavailable for transient shipyard RPC rate limits", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getShipyardState(): Promise<ShipyardState> {
          throw new Error("RPC HTTP 429");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    await expect(response.json()).resolves.toEqual({
      error: "RPC HTTP 429"
    });
    expect(response.status).toBe(503);
  });

  test("returns stale indexed shipyard context for transient RPC rate limits", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      indexer: testIndexer(),
      chainReader: new class extends MockChainReader {
        override async getShipyardState(): Promise<ShipyardState> {
          throw new Error("RPC HTTP 429");
        }
      }()
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: "7",
      degraded: true,
      stale: true,
      source: "contract-state-indexer",
      detail: "RPC HTTP 429",
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      }
    });
  });

  test("answers defense state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/defenses`));

    const body = await response.json();
    expect(body.wallet).toBe(player);
    expect(body.homePlanetId).toBe("7");
    expect(body.resources.metal).toBe("5000");
    expect(body.shipyardLevel).toBe(1);
    expect(body.missileSiloLevel).toBe(2);
    expect(body.technologyLevels["1"]).toBe(1);
    expect(body.queue).toMatchObject({
      active: true,
      itemId: 0,
      kind: "defense",
      quantity: 2
    });
    expect(body.defenses).toContainEqual({
      id: 0,
      count: 3,
      cost: {
        metal: "2000",
        crystal: "0",
        deuterium: "0"
      }
    });
    expect(response.status).toBe(200);
  });

  test("answers infrastructure state from a mocked chain reader", async () => {
    const handler = createRequestHandler({ chainReader: new MockChainReader(), config: configuredTestConfig });
    const response = await handler(
      new Request(`http://localhost/wallet/${player}/infrastructure`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.resources.metal).toBe("5000");
    expect(body.energyBalance).toEqual({
      produced: "60",
      required: "100",
      scaleBps: "6000"
    });
    expect(body.protectedResources).toEqual({
      metal: "1000",
      crystal: "1000",
      deuterium: "1000"
    });
    expect(body.raidableResources).toEqual({
      metal: "4000",
      crystal: "3900",
      deuterium: "3800"
    });
    expect(body.buildings).toContainEqual({
      id: 0,
      level: 1,
      cost: {
        metal: "120",
        crystal: "30",
        deuterium: "0"
      }
    });
    expect(body.queue).toMatchObject({
      active: true,
      kind: "building"
    });
  });

  test("batches infrastructure building level and cost RPC reads", async () => {
    const individualSelectors: string[] = [];
    const batchSelectors: string[] = [];
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(_method: string, params: unknown[]): Promise<T> {
        const [call] = params as [{ data: string; to: string }];
        const selector = call.data.slice(0, 10);
        individualSelectors.push(selector);
        if (selector === "0x0ff79fa5") return abiWords(7n) as T;
        if (selector === "0x181c1bc4") {
          return abiWords(
            BigInt(player),
            2n,
            44n,
            9n,
            211n,
            1n,
            9_788n,
            10_233n,
            10_584n,
            1_700_000_000n,
            5_000n,
            4_900n,
            4_800n
          ) as T;
        }
        if (
          selector === "0x0adbf924"
          || selector === "0x9ec5e0d5"
          || selector === "0x6db0ecd7"
          || selector === "0x222a58f5"
          || selector === "0x1da1f692"
        ) {
          return abiWords(5_000n, 4_900n, 4_800n) as T;
        }
        if (selector === "0x7938100c") return abiWords(60n, 100n, 6_000n) as T;
        if (selector === "0xb8e835ab") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
        if (selector === "0xe512884c") return abiWords(0n) as T;

        throw new Error(`Unexpected individual call ${selector}`);
      },
      async requestBatch<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
        return requests.map((request) => {
          const [call] = request.params as [{ data: string; to: string }];
          const selector = call.data.slice(0, 10);
          batchSelectors.push(selector);
          if (selector === "0xd9b24865") return abiWords(1n);
          if (selector === "0x291ee1b5") return abiWords(120n, 30n, 0n);
          if (selector === "0xe512884c") return abiWords(0n);
          throw new Error(`Unexpected batch call ${selector}`);
        }) as T[];
      }
    });

    const state = await reader.getInfrastructureState(player);

    expect(state.buildings).toHaveLength(16);
    expect(batchSelectors).toHaveLength(47);
    expect(batchSelectors.filter((selector) => selector === "0xd9b24865")).toHaveLength(16);
    expect(batchSelectors.filter((selector) => selector === "0x291ee1b5")).toHaveLength(16);
    expect(batchSelectors.filter((selector) => selector === "0xe512884c")).toHaveLength(15);
    expect(individualSelectors).not.toContain("0xd9b24865");
    expect(individualSelectors).not.toContain("0x291ee1b5");
    expect(individualSelectors).not.toContain("0xe512884c");
  });

  test("answers moon state from a mocked chain reader", async () => {
    const handler = createRequestHandler({ chainReader: new MockChainReader(), config: configuredTestConfig });
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.homePlanetId).toBe("7");
    expect(body.moon).toMatchObject({
      exists: true,
      fields: 4,
      diameterKm: 7120,
      jumpGateReadyAt: "1770007200"
    });
    expect(body.buildings.map((building: { key: string }) => building.key)).toEqual([
      "lunarBase",
      "jumpGate"
    ]);
    expect(body.queue).toMatchObject({
      active: true,
      kind: "moon-building",
      itemId: 2,
      targetLevel: 2
    });
  });

  test("reports transient Moon RPC failures as service unavailable", async () => {
    class RpcFailingMoonReader extends MockChainReader {
      override async getMoonState(): Promise<MoonState> {
        throw new Error("RPC HTTP 429");
      }
    }

    const handler = createRequestHandler({ chainReader: withoutIndexLists(new RpcFailingMoonReader()), config: configuredTestConfig });
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "RPC HTTP 429" });
  });

  test("answers research state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/research`));

    const body = await response.json();
    expect(body.wallet).toBe(player);
    expect(body.homePlanetId).toBe("7");
    expect(body.resources.metal).toBe("5000");
    expect(body.researchLabLevel).toBe(1);
    expect(body.technologyLevels["0"]).toBe(1);
    expect(body.queue).toMatchObject({
      active: true,
      itemId: 0,
      kind: "research",
      targetLevel: 2
    });
    expect(body.technologies).toContainEqual({
      id: 0,
      level: 1,
      cost: {
        metal: "0",
        crystal: "1600",
        deuterium: "800"
      }
    });
    expect(response.status).toBe(200);
  });

  test("answers Rift bridge state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/rift`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.riftAvailable).toBe(true);
    expect(body.resources).toContainEqual({
      key: "metal",
      label: "Metal",
      resourceId: 0,
      tokenAddress: "0x4444444444444444444444444444444444444444",
      walletBalance: "25000000",
      allowance: "5000000",
      inGameBalance: "5000",
      lockedBalance: "0"
    });
    expect(body.pendingWithdrawals[0]).toMatchObject({
      resource: "metal",
      ready: false
    });
  });

  test("answers alliance state from a mocked chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request(`http://localhost/wallet/${player}/alliance`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.allianceAvailable).toBe(true);
    expect(body.membership).toEqual({
      allianceId: "1",
      role: "owner",
      joinedAt: "1770000000"
    });
    expect(body.profile).toMatchObject({
      tag: "VDFT",
      name: "Veydrift Union",
      description: "Discord: https://discord.gg/vdft",
      memberCount: 1
    });
    expect(body.members).toEqual([{ address: player, role: "owner", joinedAt: "1770000000" }]);
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

    await expect(reader.getDefenseState(player)).resolves.toMatchObject({
      wallet: player,
      homePlanetId: null,
      productionAvailable: false,
      shipyardLevel: 0,
      defenses: []
    });
  });

  test("treats game-contract no-home state as authoritative over legacy compact settlement", async () => {
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(_method: string, params: unknown[]): Promise<T> {
        const [call] = params as [{ data: string; to: string }];
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0ff79fa5")) {
          return abiWords(0n) as T;
        }
        if (call.to === configuredTestConfig.settlementContractAddress && call.data.startsWith("0x1d750846")) {
          return abiWords(1n) as T;
        }
        if (call.to === configuredTestConfig.settlementContractAddress && call.data.startsWith("0x29147f24")) {
          return abiWords(2n, 44n, 9n, 0n, 0n, 1_770_000_000n, 123n) as T;
        }

        throw new Error(`Unexpected call ${call.to} ${call.data.slice(0, 10)}`);
      }
    });

    await expect(reader.getWalletSettlement(player)).resolves.toMatchObject({
      wallet: player,
      hasFirstPlanet: false,
      homePlanetId: null,
      contractKind: "game",
      planet: null
    });

    await expect(reader.getShipyardState(player)).resolves.toMatchObject({
      wallet: player,
      homePlanetId: null,
      productionAvailable: true,
      ships: expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          cost: {
            metal: "0",
            crystal: "0",
            deuterium: "0"
          }
        })
      ])
    });

    await expect(reader.getDefenseState(player)).resolves.toMatchObject({
      wallet: player,
      homePlanetId: null,
      productionAvailable: true,
      defenses: expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          cost: {
            metal: "0",
            crystal: "0",
            deuterium: "0"
          }
        })
      ])
    });
  });

  test("keeps shipyard state loadable when the deployment does not expose a newer ship id", async () => {
    const unsupportedShipIdWord = 15n.toString(16).padStart(64, "0");
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(_method: string, params: unknown[]): Promise<T> {
        const [call] = params as [{ data: string; to: string }];
        const selector = call.data.slice(0, 10);

        if (selector === "0x0ff79fa5") return abiWords(7n) as T;
        if (selector === "0x181c1bc4") {
          return abiWords(
            BigInt(player),
            2n,
            44n,
            9n,
            211n,
            1n,
            9_788n,
            10_233n,
            10_584n,
            1_700_000_000n,
            5_000n,
            4_900n,
            4_800n
          ) as T;
        }
        if (selector === "0x0adbf924") return abiWords(5_000n, 4_900n, 4_800n) as T;
        if (selector === "0xd9b24865") return abiWords(1n) as T;
        if (selector === "0xb6f4b7b7") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
        if (selector === "0xe512884c") return abiWords(0n) as T;
        if (selector === "0x423f9f10") throw new Error("RPC 3: execution reverted");
        if (selector === "0x57686701" || selector === "0xc4222030") {
          if (call.data.endsWith(unsupportedShipIdWord)) {
            throw new Error("RPC 3: execution reverted");
          }
          return selector === "0x57686701" ? abiWords(0n) as T : abiWords(2_000n, 2_000n, 0n) as T;
        }

        throw new Error(`Unexpected call ${call.to} ${selector}`);
      }
    });

    const state = await reader.getShipyardState(player);

    expect(state.homePlanetId).toBe("7");
    expect(state.productionAvailable).toBe(true);
    expect(state.fleetSlots.active).toBe(0);
    expect(state.ships.some((ship) => ship.id === 0)).toBe(true);
    expect(state.ships.some((ship) => ship.id === 15)).toBe(false);
  });

  test("hydrates active building queues with the BuildingStarted block timestamp", async () => {
    const startedAt = 1_700_000_000n;
    const readyAt = 1_700_000_600n;
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_getLogs") {
          const [filter] = params as [{ fromBlock: string }];
          expect(filter.fromBlock).toBe("0x64");
          return [
            {
              blockNumber: "0x2a",
              transactionHash: "0xabc",
              topics: [],
              data: abiWords(1n, readyAt, 48n, 24n, 0n)
            }
          ] as T;
        }

        if (method === "eth_getBlockByNumber") {
          return { timestamp: `0x${startedAt.toString(16)}` } as T;
        }

        const [call] = params as [{ data: string; to: string }];
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0ff79fa5")) {
          return abiWords(7n) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x181c1bc4")) {
          return abiWords(
            BigInt(player),
            2n,
            44n,
            9n,
            211n,
            1n,
            9_788n,
            10_233n,
            10_584n,
            1_700_000_000n,
            5_000n,
            4_900n,
            4_800n
          ) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0xb8e835ab")) {
          return abiWords(1n, 1n, 1n, readyAt, 48n, 24n, 0n) as T;
        }
        if (
          call.to === configuredTestConfig.gameContractAddress
          && (
            call.data.startsWith("0x5758361d")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x2b98afc7")
          )
        ) {
          return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
        }

        throw new Error(`Unexpected ${method} ${call.to} ${call.data.slice(0, 10)}`);
      }
    });

    await expect(reader.getPlayerQueues(player)).resolves.toMatchObject({
      wallet: player,
      homePlanetId: "7",
      building: {
        active: true,
        kind: "building",
        itemId: 1,
        targetLevel: 1,
        readyAt: readyAt.toString(),
        startedAt: startedAt.toString(),
        cost: {
          metal: "48",
          crystal: "24",
          deuterium: "0"
        }
      }
    });
  });

  test("preserves contract Deuterium Synthesizer readyAt duration for live queue display", async () => {
    const startedAt = 1_700_000_000n;
    const readyAt = startedAt + 432n;
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_getLogs") {
          return [
            {
              blockNumber: "0x2a",
              transactionHash: "0xdef",
              topics: [],
              data: abiWords(1n, readyAt, 225n, 75n, 0n)
            }
          ] as T;
        }

        if (method === "eth_getBlockByNumber") {
          return { timestamp: `0x${startedAt.toString(16)}` } as T;
        }

        const [call] = params as [{ data: string; to: string }];
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0ff79fa5")) {
          return abiWords(7n) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x181c1bc4")) {
          return abiWords(
            BigInt(player),
            2n,
            44n,
            9n,
            211n,
            1n,
            9_788n,
            10_233n,
            10_584n,
            1_700_000_000n,
            5_000n,
            4_900n,
            4_800n
          ) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0xb8e835ab")) {
          return abiWords(1n, 2n, 1n, readyAt, 225n, 75n, 0n) as T;
        }
        if (
          call.to === configuredTestConfig.gameContractAddress
          && (
            call.data.startsWith("0x5758361d")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x2b98afc7")
          )
        ) {
          return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
        }

        throw new Error(`Unexpected ${method} ${call.to} ${call.data.slice(0, 10)}`);
      }
    });

    const queues = await reader.getPlayerQueues(player);

    expect(queues.building).toMatchObject({
      active: true,
      kind: "building",
      itemId: 2,
      targetLevel: 1,
      readyAt: readyAt.toString(),
      startedAt: startedAt.toString(),
      cost: {
        metal: "225",
        crystal: "75",
        deuterium: "0"
      }
    });
    expect(Number(queues.building?.readyAt) - Number(queues.building?.startedAt)).toBe(432);
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
      indexedDebrisFields: 1,
      indexedMoonChanceReports: 1,
      indexedPlanets: 1,
      fromBlock: "100"
    });

    const system = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const body = await system.json();
    expect(body.planets.find((item: { position: number }) => item.position === 9)).toMatchObject({
      position: 9,
      fields: planet.fields,
      temperature: planet.temperature,
      occupiedBy: {
        planetId: "7",
        owner: player
      },
      debrisField: {
        metal: "27000",
        crystal: "9000"
      },
      moonChance: {
        battleId: "42",
        chanceBps: 100,
        status: "pending",
        targetPlanetId: "7"
      }
    });
    expect(system.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(chainReader.rebuildCalls).toBe(1);
  });

  test("coalesces concurrent index rebuilds", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);

    const [first, second] = await Promise.all([
      indexer.rebuild(),
      indexer.rebuild()
    ]);

    expect(first).toMatchObject({
      indexedDebrisFields: 1,
      indexedMoonChanceReports: 1,
      indexedPlanets: 1
    });
    expect(second).toEqual(first);
    expect(chainReader.rebuildCalls).toBe(1);
  });

  test("accepts signed Alchemy webhook logs and deduplicates retries", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: {
        ...configuredTestConfig,
        alchemyWebhookSigningKey: "webhook-secret"
      },
      chainReader,
      indexer
    });
    const body = JSON.stringify({
      event: {
        data: {
          block: {
            logs: [
              {
                blockNumber: "0x7c",
                transactionHash: "0xabc",
                logIndex: "0x0",
                topics: [
                  planetStartedTopic,
                  `0x${player.slice(2).padStart(64, "0")}`,
                  `0x${(7n).toString(16).padStart(64, "0")}`
                ],
                data: abiWords(2n, 44n, 9n, 211n, 1n)
              }
            ]
          }
        }
      }
    });
    const signature = createHmac("sha256", "webhook-secret").update(body).digest("hex");
    const request = () => new Request("http://localhost/webhooks/alchemy", {
      body,
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": signature
      },
      method: "POST"
    });

    const first = await handler(request());
    await expect(first.json()).resolves.toMatchObject({
      receivedLogs: 1,
      applied: 1,
      duplicates: 0,
      indexer: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "124"
      }
    });
    const second = await handler(request());
    await expect(second.json()).resolves.toMatchObject({
      receivedLogs: 1,
      applied: 0,
      duplicates: 1,
      indexer: {
        indexedEventLogs: 1,
        indexedPlanets: 1
      }
    });
  });

  test("serves indexed wallet settlement without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("wallet settlement should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm settlement index should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/settlement`));
    await expect(response.json()).resolves.toMatchObject({
      wallet: player,
      hasFirstPlanet: true,
      homePlanetId: planet.planetId,
      planet: {
        planetId: planet.planetId,
        owner: player
      }
    });
    expect(response.status).toBe(200);
  });

  test("serves indexed planet detail without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getPlanet = async () => {
      throw new Error("planet detail should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm planet index should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/planets/${planet.planetId}`));
    await expect(response.json()).resolves.toMatchObject({
      planetId: planet.planetId,
      owner: player
    });
    expect(response.status).toBe(200);
  });

  test("warms highscore rankings with settled planets only", async () => {
    const chainReader = new MockChainReader();
    const currentPlanetReader = chainReader as MockChainReader & {
      listCurrentPlanets: () => Promise<SettledPlanetEvent[]>;
    };
    currentPlanetReader.listCurrentPlanets = async () => {
      chainReader.rebuildCalls += 1;
      return [{
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      }];
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("historical settlement logs should not be required for highscores");
    };
    chainReader.listDebrisFieldEvents = async () => {
      throw new Error("debris logs should not be required for highscores");
    };
    chainReader.listMoonChanceReportEvents = async () => {
      throw new Error("moon chance logs should not be required for highscores");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total[0]).toMatchObject({
      rank: 1,
      wallet: player
    });
    expect(chainReader.rebuildCalls).toBe(1);
  });

  test("serves highscores derived from indexed canonical state", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.formula.pointsDivisor).toBe("1000");
    expect(body.rankings.total[0]).toMatchObject({
      rank: 1,
      wallet: player,
      homePlanetId: planet.planetId,
      homePlanet: {
        planetId: planet.planetId,
        name: "Eos",
        coordinates: {
          galaxy: 2,
          system: 44,
          position: 9
        },
        archetype: "temperate-ocean"
      },
      planetCount: 1,
      score: {
        total: "15",
        economy: "0",
        research: "1",
        researchLevels: "1",
        military: "14",
        fleet: "8",
        fleetCount: "2",
        defense: "6"
      }
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
  });

  test("serves empty highscore rankings as a successful payload", async () => {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => [];
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body.rankings).toEqual({
      total: [],
      economy: [],
      research: [],
      researchLevels: [],
      military: [],
      fleet: [],
      fleetCount: [],
      defense: []
    });
  });

  test("returns a service error instead of a bad request when highscore RPC reads fail", async () => {
    const chainReader = new MockChainReader();
    chainReader.getHighscoreForWallet = async () => {
      throw new Error("RPC HTTP 429");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body).toEqual({
      error: "highscores_unavailable",
      detail: "RPC HTTP 429"
    });
  });

  test("returns a service error instead of a bad request when highscore index rebuild fails", async () => {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("RPC HTTP 429");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body).toEqual({
      error: "highscores_unavailable",
      detail: "RPC HTTP 429"
    });
  });

  test("returns CORS headers when highscores are unsupported", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: {} as ChainReader
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body).toEqual({
      error: "highscores_not_supported"
    });
  });

  test("serves deterministic systems around a center coordinate", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=1"));

    const body = await response.json();
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
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
