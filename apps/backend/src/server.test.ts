import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { resolveWsRpcUrl, type BackendConfig } from "./config";
import type {
  Address,
  AllianceIdentity,
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
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
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

  async getSettlementFunding() {
    return {
      affordable: true,
      balanceWei: "100000000000000000",
      contractKind: "game" as const,
      startPriceWei: "50000000000000000"
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
      planetId: planet.planetId,
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
      naniteLevel: 0,
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
      readiness: {
        ready: false,
        configurationReady: false,
        chainSyncConnected: null,
        subscribedToHeads: null,
        subscribedToLogs: null,
        indexedState: null,
        safeToServeIndexedState: null
      },
      chainSync: null,
      indexer: null,
      missionResolution: null,
      rpc: null,
      ok: true,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(200);
  });

  test("requires websocket head and log subscriptions for ready chain sync health", async () => {
    const chainSync = {
      start() {},
      snapshot() {
        return {
          connected: true,
          subscribedToHeads: false,
          subscribedToLogs: true
        };
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(body.readiness).toMatchObject({
      ready: false,
      chainSyncConnected: true,
      subscribedToHeads: false,
      subscribedToLogs: true
    });
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

  test("adds real owner alliance identity to galaxy planet rows when the chain reader can resolve it", async () => {
    const chainReader = new class extends MockChainReader {
      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        expect(wallets).toContain(player);
        return new Map([
          [player, {
            allianceId: "3",
            name: "Veydrift Union",
            tag: "VDFT"
          }]
        ]);
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.upsertPlayerDisplayName(player, "borodutch");

    const response = await createRequestHandler({
      config: {
        ...configuredTestConfig,
        allianceContractAddress: "0x4444444444444444444444444444444444444444"
      },
      chainReader,
      indexer
    })(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const body = await response.json();
    const occupied = body.planets.find((item: { position: number }) => item.position === 9);

    expect(occupied.occupiedBy).toMatchObject({
      alliance: {
        allianceId: "3",
        name: "Veydrift Union",
        tag: "VDFT"
      },
      owner: player,
      ownerDisplayName: "borodutch",
      planetId: "7"
    });
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
      queues: {
        research: null
      },
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
    })(new Request(`http://localhost/wallet/${player}/shipyard?source=live`));

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
    })(new Request(`http://localhost/wallet/${player}/shipyard?source=live`));

    await expect(response.json()).resolves.toEqual({
      error: "RPC HTTP 429"
    });
    expect(response.status).toBe(503);
  });

  test("returns indexed shipyard context before transient RPC rate limit fallbacks", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      indexer: testIndexer(),
      chainReader: new class extends MockChainReader {
        override async getShipyardState(): Promise<ShipyardState> {
          throw new Error("RPC HTTP 429");
        }
      }()
    })(new Request(`http://localhost/wallet/${player}/shipyard?source=live`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: "7",
      stale: true,
      source: "contract-state-indexer",
      detail: "shipyard loaded from DB-indexed contract state before live RPC.",
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
    })(new Request(`http://localhost/wallet/${player}/defenses?source=live`));

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
      new Request(`http://localhost/wallet/${player}/infrastructure?source=live`)
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
        if (selector === "0x4f5ed437") return abiWords(32n, 0n) as T;
        if (selector === "0x52b55205") return abiWords(32n, 0n) as T;
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
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon?source=live`));
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
    expect(body.buildings).toContainEqual({
      id: 2,
      key: "jumpGate",
      label: "Jump Gate",
      level: 1,
      cost: {
        metal: "4000000",
        crystal: "8000000",
        deuterium: "4000000"
      }
    });
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
    })(new Request(`http://localhost/wallet/${player}/research?source=live`));

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
    })(new Request(`http://localhost/wallet/${player}/rift?source=live`));

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
    expect(body.dismissJoinRequestAvailable).toBe(true);
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
        if (selector === "0x4f5ed437") return abiWords(32n, 0n) as T;
        if (selector === "0x52b55205") return abiWords(32n, 0n) as T;
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
            || call.data.startsWith("0x4f5ed437")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x52b55205")
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

  test("hydrates active defense queues with the DefenseQueued block timestamp", async () => {
    const startedAt = 1_700_000_000n;
    const readyAt = 1_700_000_600n;
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_getLogs") {
          const [filter] = params as [{ fromBlock: string; topics: string[] }];
          expect(filter.fromBlock).toBe("0x64");
          expect(filter.topics[1]).toBe("0x0000000000000000000000000000000000000000000000000000000000000007");
          expect(filter.topics[2]).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
          return [
            {
              blockNumber: "0x2a",
              transactionHash: "0xabc",
              topics: [],
              data: abiWords(2n, readyAt, 4000n, 0n, 0n)
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x5758361d")) {
          return abiWords(1n, 0n, 2n, readyAt, 4000n, 0n, 0n) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x4f5ed437")) {
          return abiWords(32n, 1n, 1n, 1n, 3n, readyAt + 600n, 4500n, 1500n, 0n) as T;
        }
        if (
          call.to === configuredTestConfig.gameContractAddress
          && (
            call.data.startsWith("0xb8e835ab")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x52b55205")
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
      defense: {
        active: true,
        kind: "defense",
        itemId: 0,
        quantity: 2,
        readyAt: readyAt.toString(),
        startedAt: startedAt.toString(),
        backlog: [
          {
            active: true,
            kind: "defense",
            itemId: 1,
            quantity: 3,
            readyAt: (readyAt + 600n).toString(),
            cost: {
              metal: "4500",
              crystal: "1500",
              deuterium: "0"
            }
          }
        ],
        cost: {
          metal: "4000",
          crystal: "0",
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
            || call.data.startsWith("0x4f5ed437")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x52b55205")
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

  test("hydrates active research queues with the ResearchQueued block timestamp", async () => {
    const startedAt = 1_700_000_000n;
    const readyAt = 1_700_000_900n;
    let researchLogQueries = 0;
    const reader = new VeydriftGameReader(configuredTestConfig, {
      async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_getLogs") {
          const [filter] = params as [{ fromBlock: string; topics: string[] }];
          researchLogQueries += 1;
          expect(filter.fromBlock).toBe("0x64");
          expect(filter.topics[1]).toBe(`0x${player.slice(2).toLowerCase().padStart(64, "0")}`);
          return [
            {
              blockNumber: "0x2a",
              transactionHash: "0xresearch",
              topics: [],
              data: abiWords(2n, readyAt, 0n, 1_600n, 800n)
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
        if (
          call.to === configuredTestConfig.gameContractAddress
          && (
            call.data.startsWith("0xb8e835ab")
            || call.data.startsWith("0x5758361d")
            || call.data.startsWith("0x4f5ed437")
            || call.data.startsWith("0xb6f4b7b7")
            || call.data.startsWith("0x52b55205")
          )
        ) {
          return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
        }
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x2b98afc7")) {
          return abiWords(1n, 0n, 2n, readyAt, 0n, 1_600n, 800n) as T;
        }

        throw new Error(`Unexpected ${method} ${call.to} ${call.data.slice(0, 10)}`);
      }
    });

    const queues = await reader.getPlayerQueues(player);

    expect(researchLogQueries).toBe(1);
    expect(queues.research).toMatchObject({
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      readyAt: readyAt.toString(),
      startedAt: startedAt.toString(),
      cost: {
        metal: "0",
        crystal: "1600",
        deuterium: "800"
      }
    });
  });

  test("rebuilds the cache and marks occupied system coordinates", async () => {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => {
      chainReader.rebuildCalls += 1;
      return [{
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123",
        lastSettledAt: (Math.floor(Date.now() / 1_000) - 7_200).toString()
      }];
    };
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
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(2n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xsatdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(5n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xdefensedone",
      logIndex: "0x0",
      topics: [
        defenseCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(3n, 3n)
    });
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xresearchdone",
      logIndex: "0x0",
      topics: [
        researchCompletedTopic,
        addressTopic(player),
        topic(0n)
      ],
      data: abiWords(1n)
    });

    const system = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const body = await system.json();
    const occupiedPlanet = body.planets.find((item: { position: number }) => item.position === 9);
    expect(occupiedPlanet).toMatchObject({
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
    expect(occupiedPlanet.publicState).toMatchObject({
      resources: {
        metal: "5064",
        crystal: "4900",
        deuterium: "4800"
      },
      queues: {
        building: {
          active: true,
          kind: "building",
          targetLevel: 2,
          readyAt: "1770000060"
        }
      }
    });
    expect(occupiedPlanet.publicState.buildings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, level: 1 })
    ]));
    expect(occupiedPlanet.publicState.fleet).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, count: 2 }),
      expect.objectContaining({ id: 9, count: 5 })
    ]));
    expect(occupiedPlanet.publicState.defenses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, count: 3 })
    ]));
    expect(occupiedPlanet.publicState.research).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, level: 1 })
    ]));
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

  test("serves accrued indexed wallet resources for settlement, planets, and infrastructure", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("settlement should not call live RPC");
    };
    chainReader.getWalletPlanets = async () => {
      throw new Error("planets should not call live RPC");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("infrastructure should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm accrued index should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: (Math.floor(Date.now() / 1_000) - 7_200).toString()
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xmine",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(3n)
      ],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const settlementResponse = await handler(new Request(`http://localhost/wallet/${player}/settlement`));
    const settlementBody = await settlementResponse.json();
    const planetsResponse = await handler(new Request(`http://localhost/wallet/${player}/planets`));
    const planetsBody = await planetsResponse.json();
    const infrastructureResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const infrastructureBody = await infrastructureResponse.json();

    expect(settlementResponse.status).toBe(200);
    expect(planetsResponse.status).toBe(200);
    expect(infrastructureResponse.status).toBe(200);
    expect(settlementBody.planet.resources.metal).toBe("5064");
    expect(planetsBody.planets[0].resources.metal).toBe("5064");
    expect(infrastructureBody.resources.metal).toBe("5064");
    expect(infrastructureBody.raidableResources.metal).toBe("5064");
  });

  test("does not rebuild a cold planet index during wallet settlement requests", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getWalletSettlement = async (wallet) => {
      liveReadCalled = true;
      return {
        wallet,
        hasFirstPlanet: false,
        homePlanetId: null,
        planet: null
      };
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("cold settlement request should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/settlement`));

    expect(response.status).toBe(200);
    expect(liveReadCalled).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      wallet: player,
      hasFirstPlanet: false,
      homePlanetId: null,
      planet: null
    });
  });

  test("serves indexed player queues without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getPlayerQueues = async () => {
      liveReadCalled = true;
      throw new Error("player queues should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm queues index should not rebuild from chain");
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

    const response = await handler(new Request(`http://localhost/wallet/${player}/queues`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(liveReadCalled).toBe(false);
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: planet.planetId,
      building: null,
      defense: null,
      ship: null,
      research: null,
      stale: true,
      source: "contract-state-indexer",
      detail: "player queues loaded from DB-indexed contract state before live RPC."
    });
    expect(typeof body.liveReadSkippedAt).toBe("string");
  });

  test("serves indexed building queues and levels without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getPlayerQueues = async () => {
      throw new Error("queues should not call live RPC");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("infrastructure should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm indexed state should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [
        buildingStartedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n, 1770000900n, 400n, 120n, 60n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const queuesResponse = await handler(new Request(`http://localhost/wallet/${player}/queues`));
    const queuesBody = await queuesResponse.json();
    const infrastructureResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const infrastructureBody = await infrastructureResponse.json();

    expect(queuesResponse.status).toBe(200);
    expect(queuesResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(queuesBody.building).toMatchObject({
      active: true,
      kind: "building",
      itemId: 5,
      targetLevel: 1,
      readyAt: "1770000900",
      cost: {
        metal: "400",
        crystal: "120",
        deuterium: "60"
      }
    });
    expect(infrastructureResponse.status).toBe(200);
    expect(infrastructureResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(infrastructureBody).toMatchObject({
      resources: {
        metal: "4600",
        crystal: "4780",
        deuterium: "4740"
      },
      productionPerHour: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      },
      energyBalance: {
        produced: "0",
        required: "0",
        scaleBps: "10000"
      },
      storageCaps: {
        metal: "10000",
        crystal: "10000",
        deuterium: "10000"
      },
      protectedResources: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      },
      raidableResources: {
        metal: "4600",
        crystal: "4780",
        deuterium: "4740"
      },
      queue: {
        active: true,
        kind: "building",
        itemId: 5
      }
    });

    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xbuilddone",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n)
    });

    const completedInfrastructureResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const completedInfrastructureBody = await completedInfrastructureResponse.json();
    expect(completedInfrastructureBody.queue).toBeNull();
    expect(completedInfrastructureBody.buildings.find((building: { id: number }) => building.id === 5)).toMatchObject({
      id: 5,
      level: 1
    });
  });

  test("serves indexed infrastructure energy from solar satellite ship counts", async () => {
    const chainReader = new MockChainReader();
    chainReader.getInfrastructureState = async () => {
      throw new Error("infrastructure should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm indexed state should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xbuilddone",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xsatdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(5n, 5n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const poweredResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const poweredBody = await poweredResponse.json();
    expect(poweredBody.energyBalance).toEqual({
      produced: "110",
      required: "11",
      scaleBps: "10000",
      sources: {
        solarPlant: "0",
        fusionReactor: "0",
        fusionReactorDeuteriumConsumed: "0",
        solarSatellites: "110",
        solarSatelliteCount: 5,
        solarSatelliteEnergy: "22"
      }
    });

    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xcombat",
      logIndex: "0x0",
      topics: [
        planetShipCountChangedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(2n)
    });
    const damagedResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const damagedBody = await damagedResponse.json();
    expect(damagedBody.energyBalance).toEqual({
      produced: "44",
      required: "11",
      scaleBps: "10000",
      sources: {
        solarPlant: "0",
        fusionReactor: "0",
        fusionReactorDeuteriumConsumed: "0",
        solarSatellites: "44",
        solarSatelliteCount: 2,
        solarSatelliteEnergy: "22"
      }
    });
  });

  test("serves indexed shipyard research and rift state without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = async () => {
      throw new Error("shipyard should not call live RPC");
    };
    chainReader.getResearchState = async () => {
      throw new Error("research should not call live RPC");
    };
    chainReader.getRiftState = async () => {
      throw new Error("rift should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm indexed state should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xship",
      logIndex: "0x0",
      topics: [
        shipQueuedTopic,
        topic(7n),
        topic(3n)
      ],
      data: abiWords(2n, 1770001000n, 2000n, 1000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(3n)
      ],
      data: abiWords(2n, 7n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xresearch",
      logIndex: "0x0",
      topics: [
        researchQueuedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(2n, 1770001100n, 800n, 400n, 200n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xriftbuild",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(15n)
      ],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xdeposit",
      logIndex: "0x0",
      topics: [
        marketResourceDepositedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1000n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const shipyard = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard`))).json();
    const research = await (await handler(new Request(`http://localhost/wallet/${player}/research`))).json();
    const rift = await (await handler(new Request(`http://localhost/wallet/${player}/rift`))).json();

    expect(shipyard).toMatchObject({
      source: "contract-state-indexer",
      ships: expect.arrayContaining([
        expect.objectContaining({ id: 3, count: 7 }),
        expect.objectContaining({ id: 9, energyPerUnit: "22" })
      ])
    });
    expect(research).toMatchObject({
      source: "contract-state-indexer",
      queue: {
        kind: "research",
        itemId: 4,
        targetLevel: 2
      }
    });
    expect(rift).toMatchObject({
      source: "contract-state-indexer",
      unlocked: true,
      resources: expect.arrayContaining([
        expect.objectContaining({
          key: "metal",
          inGameBalance: "1000"
        })
      ])
    });
  });

  test("serves indexed infrastructure resources without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getInfrastructureState = async () => {
      liveReadCalled = true;
      throw new Error("infrastructure should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm infrastructure index should not rebuild from chain");
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

    const response = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(liveReadCalled).toBe(false);
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      unavailableReason: "infrastructure loaded from DB-indexed contract state before live RPC.",
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      },
      buildings: expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          level: 0,
          cost: {
            metal: "60",
            crystal: "15",
            deuterium: "0"
          }
        })
      ]),
      productionPerHour: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      },
      energyBalance: {
        produced: "0",
        required: "0",
        scaleBps: "10000"
      },
      storageCaps: {
        metal: "10000",
        crystal: "10000",
        deuterium: "10000"
      },
      protectedResources: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      },
      raidableResources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      },
      queue: null,
      stale: true,
      source: "contract-state-indexer",
      detail: "infrastructure loaded from DB-indexed contract state before live RPC."
    });
    expect(typeof body.liveReadSkippedAt).toBe("string");
  });

  test("marks warm indexed responses healthy after canonical reconciliation", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.getInfrastructureState = async () => {
      throw new Error("healthy indexed infrastructure should not call live RPC during hydration");
    };

    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("healthy");
    expect(body).toMatchObject({
      stale: false,
      indexer: {
        indexedState: "healthy",
        safeToServeIndexedState: true,
        staleReason: null
      },
      buildings: expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          level: 1
        })
      ]),
      queue: {
        kind: "building",
        targetLevel: 2
      }
    });
  });

  test("serves indexed page state without live chain reads when warm", async () => {
    const chainReader = new MockChainReader();
    const liveReads: string[] = [];
    chainReader.getShipyardState = async () => {
      liveReads.push("shipyard");
      throw new Error("shipyard should not call live RPC");
    };
    chainReader.getDefenseState = async () => {
      liveReads.push("defenses");
      throw new Error("defenses should not call live RPC");
    };
    chainReader.getResearchState = async () => {
      liveReads.push("research");
      throw new Error("research should not call live RPC");
    };
    chainReader.getMoonState = async () => {
      liveReads.push("moon");
      throw new Error("moon should not call live RPC");
    };
    chainReader.getRiftState = async () => {
      liveReads.push("rift");
      throw new Error("rift should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm page index should not rebuild from chain");
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

    for (const [path, surface] of [
      ["shipyard", "shipyard"],
      ["defenses", "defenses"],
      ["research", "research"],
      ["moon", "moon"],
      ["rift", "rift"]
    ] as const) {
      const response = await handler(new Request(`http://localhost/wallet/${player}/${path}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
      expect(body).toMatchObject({
        wallet: player,
        homePlanetId: planet.planetId,
        stale: true,
        source: "contract-state-indexer",
        detail: `${surface} loaded from DB-indexed contract state before live RPC.`
      });
      expect(typeof body.liveReadSkippedAt).toBe("string");
    }
    expect(liveReads).toEqual([]);
  });

  test("keeps selected planet id in warm indexed shipyard responses", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = async () => {
      throw new Error("warm selected shipyard should not call live RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm selected shipyard should not rebuild from chain");
    };
    const selectedPlanet = {
      ...planet,
      planetId: "8",
      position: 10,
      name: "Nyx"
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xhome",
      blockNumber: "123"
    });
    indexer.applyEvent({
      ...selectedPlanet,
      eventName: "ColonyCreated",
      transactionHash: "0xcolony",
      blockNumber: "124"
    });
    indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xship",
      logIndex: "0x0",
      topics: [
        planetShipCountChangedTopic,
        topic(8n),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=8`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body.homePlanetId).toBe("8");
    expect(body.planetId).toBe("8");
    expect(body.ships).toContainEqual(expect.objectContaining({
      id: 0,
      count: 1
    }));
  });

  test("ignores client live-read requests for canonical warm indexed wallet state", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("client source=live must not bypass indexed settlement");
    };
    chainReader.getWalletPlanets = async () => {
      throw new Error("client source=live must not bypass indexed planets");
    };
    chainReader.getPlayerQueues = async () => {
      throw new Error("client source=live must not bypass indexed queues");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("client source=live must not bypass indexed infrastructure");
    };
    chainReader.getShipyardState = async () => {
      throw new Error("client source=live must not bypass indexed shipyard");
    };
    chainReader.getDefenseState = async () => {
      throw new Error("client source=live must not bypass indexed defenses");
    };
    chainReader.getResearchState = async () => {
      throw new Error("client source=live must not bypass indexed research");
    };
    chainReader.getMoonState = async () => {
      throw new Error("client source=live must not bypass indexed moon");
    };
    chainReader.getRiftState = async () => {
      throw new Error("client source=live must not bypass indexed rift");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("client source=live should not rebuild the warm index");
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

    const settlementResponse = await handler(new Request(`http://localhost/wallet/${player}/settlement?source=live`));
    const settlementBody = await settlementResponse.json();
    const planetsResponse = await handler(new Request(`http://localhost/wallet/${player}/planets?source=live`));
    const planetsBody = await planetsResponse.json();
    const queuesResponse = await handler(new Request(`http://localhost/wallet/${player}/queues?source=live`));
    const queuesBody = await queuesResponse.json();
    const infrastructureResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure?source=live`));
    const infrastructureBody = await infrastructureResponse.json();
    const shipyardResponse = await handler(new Request(`http://localhost/wallet/${player}/shipyard?source=live`));
    const shipyardBody = await shipyardResponse.json();
    const defensesResponse = await handler(new Request(`http://localhost/wallet/${player}/defenses?source=live`));
    const defensesBody = await defensesResponse.json();
    const researchResponse = await handler(new Request(`http://localhost/wallet/${player}/research?source=live`));
    const researchBody = await researchResponse.json();
    const moonResponse = await handler(new Request(`http://localhost/wallet/${player}/moon?source=live`));
    const moonBody = await moonResponse.json();
    const riftResponse = await handler(new Request(`http://localhost/wallet/${player}/rift?source=live`));
    const riftBody = await riftResponse.json();

    expect(settlementResponse.status).toBe(200);
    expect(settlementBody.homePlanetId).toBe(planet.planetId);
    expect(planetsResponse.status).toBe(200);
    expect(planetsBody.planets).toHaveLength(1);
    expect(queuesResponse.status).toBe(200);
    expect(queuesResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(queuesBody).toMatchObject({ source: "contract-state-indexer", building: null });
    expect(infrastructureResponse.status).toBe(200);
    expect(infrastructureResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(infrastructureBody).toMatchObject({
      source: "contract-state-indexer",
      infrastructureAvailable: true,
      resources: {
        metal: "5000"
      }
    });
    expect(shipyardResponse.status).toBe(200);
    expect(shipyardResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(shipyardBody).toMatchObject({ source: "contract-state-indexer", shipyardLevel: 0 });
    expect(defensesResponse.status).toBe(200);
    expect(defensesResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(defensesBody).toMatchObject({ source: "contract-state-indexer", missileSiloLevel: 0 });
    expect(researchResponse.status).toBe(200);
    expect(researchResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(researchBody).toMatchObject({ source: "contract-state-indexer", researchLabLevel: 0 });
    expect(moonResponse.status).toBe(200);
    expect(moonResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(moonBody).toMatchObject({ source: "contract-state-indexer", moon: null });
    expect(riftResponse.status).toBe(200);
    expect(riftResponse.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(riftBody).toMatchObject({ source: "contract-state-indexer", riftAvailable: true, unlocked: false });
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

  test("returns indexed-not-ready instead of rebuilding cold highscore rankings on request", async () => {
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

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body).toMatchObject({
      error: "highscores_index_not_ready",
      detail: "Rankings are warming from indexed game state.",
      retryable: true,
      source: "contract-state-indexer",
      indexer: {
        indexedPlanets: 0,
        indexedState: "stale",
        lastRebuiltAt: null,
        staleReason: "never_reconciled"
      }
    });
    expect(body.durationMs).toEqual(expect.any(Number));
    expect(chainReader.rebuildCalls).toBe(0);
  });

  test("serves highscores derived from indexed canonical state", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xbuildingdone",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xdefensedone",
      logIndex: "0x0",
      topics: [
        defenseCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(3n, 3n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(2n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xresearchdone",
      logIndex: "0x0",
      topics: [
        researchCompletedTopic,
        addressTopic(player),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.durationMs).toEqual(expect.any(Number));
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
    expect(body.source).toBe("contract-state-indexer");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
  });

  test("adds canonical alliance identity to highscore rows when available", async () => {
    const chainReader = new class extends MockChainReader {
      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        expect(wallets).toContain(player);
        return new Map([
          [player, {
            allianceId: "3",
            name: "Veydrift Union",
            tag: "VDFT"
          }]
        ]);
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: {
        ...configuredTestConfig,
        allianceContractAddress: "0x4444444444444444444444444444444444444444"
      },
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total[0].alliance).toMatchObject({
      allianceId: "3",
      name: "Veydrift Union",
      tag: "VDFT"
    });
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
    expect(body.durationMs).toEqual(expect.any(Number));
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

  test("serves indexed highscores without live highscore RPC reads", async () => {
    const chainReader = new MockChainReader();
    chainReader.getHighscoreForWallet = async () => {
      throw new Error("highscores should not call live RPC");
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

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body.durationMs).toEqual(expect.any(Number));
    expect(body.source).toBe("contract-state-indexer");
    expect(body.rankings.total[0]).toMatchObject({
      rank: 1,
      wallet: player,
      homePlanetId: planet.planetId,
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
  });

  test("serves warmed empty highscore rankings as a successful indexed payload", async () => {
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
    expect(body.durationMs).toEqual(expect.any(Number));
    expect(body.source).toBe("contract-state-indexer");
    expect(body.rankings.total).toEqual([]);
    expect(chainReader.rebuildCalls).toBe(0);
  });

  test("returns indexed-not-ready without waiting for a reconciling highscore index", async () => {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => {
      chainReader.rebuildCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return [];
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const rebuilding = indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "highscores_index_not_ready",
      retryable: true,
      source: "contract-state-indexer",
      indexer: {
        indexedState: "reconciling"
      }
    });
    expect(body.durationMs).toEqual(expect.any(Number));
    expect(chainReader.rebuildCalls).toBe(1);
    await rebuilding;
  });

  test("serves persisted indexed highscores while refreshing the index", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.rebuildCalls = 0;
    chainReader.listSettledPlanetEvents = async () => {
      chainReader.rebuildCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return [];
    };
    const rebuilding = indexer.reconcile("startup refresh");
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("contract-state-indexer");
    expect(body.rankings.total[0]).toMatchObject({
      rank: 1,
      wallet: player,
      homePlanetId: planet.planetId
    });
    expect(chainReader.rebuildCalls).toBe(1);
    await rebuilding;
  });

  test("keeps highscore rebuild failures off the user-facing rankings request", async () => {
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
    expect(body).toMatchObject({
      error: "highscores_index_not_ready",
      detail: "Rankings are warming from indexed game state.",
      retryable: true,
      source: "contract-state-indexer",
      indexer: {
        indexedState: "stale",
        lastRebuiltAt: null,
        staleReason: "never_reconciled"
      }
    });
    expect(body.durationMs).toEqual(expect.any(Number));
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

function topic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressTopic(address: Address): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}
