import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { resolveWsRpcUrl, type BackendConfig } from "./config";
import type {
  Address,
  AllianceIdentity,
  AllianceState,
  AttackProtectionStatus,
  BattleReport,
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
import { SettlementIndexer, type IndexedRpcLog } from "./indexer";
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
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
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

  test("uses canonical Hyperspace technology id for the Rift requirement", () => {
    expect(riftRequirements(false, 0, 0, { "8": 1 }).find((requirement) => requirement.key === "hyperspace"))
      .toMatchObject({ currentLevel: 1, requiredLevel: 1 });

    expect(riftRequirements(false, 0, 0, { "9": 1 }).find((requirement) => requirement.key === "hyperspace"))
      .toMatchObject({ currentLevel: 0, requiredLevel: 1 });
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
      joinableAttacks: [],
      completedMissions: [],
      battleReports: []
    };
  }

  async getBattleReport() {
    return null;
  }

  async listBattleReports(): Promise<BattleReport[]> {
    return [];
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

  test("returns indexed-not-ready for cold settlement reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new class extends MockChainReader {
        override async getWalletSettlement(): Promise<WalletSettlement> {
          throw new Error("frontend settlement reads must not call chain reader");
        }
      }()
    })(new Request(`http://localhost/wallet/${player}/settlement`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
    });
  });

  test("returns indexed settlement-funding unavailable state without chain balance reads", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
          throw new Error("frontend settlement funding reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: null,
      source: "contract-state-indexer",
      stale: true
    });
  });

  test("does not read public battle report lists from the chain reader", async () => {
    const chainReader = new class extends MockChainReader {
      override async listBattleReports(): Promise<BattleReport[]> {
        throw new Error("frontend battle report lists must not call chain reader");
      }
    }();
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader
    })(new Request("http://localhost/battle-reports"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    await expect(response.json()).resolves.toEqual([]);
  });

  test("serves paginated completed mission archive from the indexed read model", async () => {
    const chainReader = new class extends MockChainReader {
      override async getFleetMissionVisibility(): Promise<never> {
        throw new Error("mission archive must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    for (let missionId = 1n; missionId <= 26n; missionId += 1n) {
      for (const log of completedFleetMissionLogs({ missionId, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
        indexer.applyLog(log);
      }
    }

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/missions?status=completed&page=2&pageSize=25`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 25,
      totalEntries: 26,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      kind: "mission",
      mission: {
        missionId: "1",
        status: "Returned"
      }
    });
  });

  test("keeps galaxy planet rows indexed-only instead of resolving owner alliance through chain reader calls", async () => {
    const chainReader = new class extends MockChainReader {
      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        throw new Error(`galaxy system state must not fetch alliance intel for ${wallets.join(",")}`);
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
      alliance: null,
      owner: player,
      ownerDisplayName: "borodutch",
      planetId: "7"
    });
  });

  test("returns indexed-not-ready for cold wallet planet reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getWalletPlanets(): Promise<WalletPlanets> {
          throw new Error("frontend planet reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/planets`));

    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
    });
    expect(response.status).toBe(503);
  });

  test("serves DB-backed wallet planet management state when the index is warm", async () => {
    const indexer = testIndexer();
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xwallet-planet-defense",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(4n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xwallet-planet-ship",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(2n, 2n)
    });
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
          tactical: {
            raidableResources: {
              metal: "5000",
              crystal: "4900",
              deuterium: "4800"
            },
            raidableResourceTotal: "14700",
            ships: {
              count: 2,
              power: expect.any(String)
            },
            defenses: {
              count: 4,
              power: expect.any(String)
            },
            combatPower: expect.any(String)
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

  test("returns indexed-not-ready for cold shipyard reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getShipyardState(): Promise<ShipyardState> {
          throw new Error("frontend shipyard reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "indexed_read_not_ready", source: "contract-state-indexer" });
  });

  test("does not expose transient shipyard RPC errors on frontend read requests", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getShipyardState(): Promise<ShipyardState> {
          throw new Error("RPC HTTP 429");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
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
    })(new Request(`http://localhost/wallet/${player}/shipyard`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: "7",
      stale: true,
      source: "contract-state-indexer",
      detail: "shipyard loaded from DB-indexed contract state.",
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      }
    });
  });

  test("returns indexed-not-ready for cold defense reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getDefenseState(): Promise<DefenseState> {
          throw new Error("frontend defense reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/defenses`));

    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "indexed_read_not_ready", source: "contract-state-indexer" });
  });

  test("returns indexed-not-ready for cold infrastructure reads without chain reader", async () => {
    const handler = createRequestHandler({
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getInfrastructureState(): Promise<InfrastructureState> {
          throw new Error("frontend infrastructure reads must not call chain reader");
        }
      }()),
      config: configuredTestConfig
    });
    const response = await handler(
      new Request(`http://localhost/wallet/${player}/infrastructure`)
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "indexed_read_not_ready", source: "contract-state-indexer" });
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

  test("returns indexed-not-ready for cold Moon reads without chain reader", async () => {
    const handler = createRequestHandler({
      chainReader: new class extends MockChainReader {
        override async getMoonState(): Promise<MoonState> {
          throw new Error("frontend moon reads must not call chain reader");
        }
      }(),
      config: configuredTestConfig
    });
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.homePlanetId).toBe(null);
    expect(response.headers.get("x-veydrift-index-state")).toBe("not-ready");
    expect(body).toMatchObject({
      indexedNotReady: true,
      moon: null,
      source: "contract-state-indexer",
      stale: true
    });
  });

  test("returns a fast indexed-not-ready Moon response instead of chain reader calls when indexed state is cold", async () => {
    class SlowMoonReader extends MockChainReader {
      liveMoonReads = 0;

      override async getMoonState(): Promise<MoonState> {
        this.liveMoonReads += 1;
        throw new Error("moon endpoint should not call chain reader while indexed state is unavailable");
      }
    }

    const chainReader = new SlowMoonReader();
    const handler = createRequestHandler({ chainReader: withoutIndexLists(chainReader), config: configuredTestConfig });
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("not-ready");
    expect(response.headers.get("x-veydrift-moon-read-ms")).toMatch(/^\d+$/);
    expect(chainReader.liveMoonReads).toBe(0);
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: null,
      moonAvailable: false,
      unavailableReason: "Moon indexed state is not available from this backend yet. Refresh shortly.",
      indexedNotReady: true,
      source: "contract-state-indexer",
      stale: true,
      indexer: null,
      moon: null,
      queue: null
    });
    expect(typeof body.indexedNotReadyAt).toBe("string");
  });

  test("does not run diagnostic Moon chain reader calls for frontend requests", async () => {
    class RpcFailingMoonReader extends MockChainReader {
      override async getMoonState(): Promise<MoonState> {
        throw new Error("diagnostic request must not call chain reader");
      }
    }

    const handler = createRequestHandler({ chainReader: withoutIndexLists(new RpcFailingMoonReader()), config: configuredTestConfig });
    const response = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("not-ready");
    expect(body).toMatchObject({
      indexedNotReady: true,
      source: "contract-state-indexer"
    });
  });

  test("returns indexed-not-ready for cold research reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getResearchState(): Promise<ResearchState> {
          throw new Error("frontend research reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/research`));

    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "indexed_read_not_ready", source: "contract-state-indexer" });
  });

  test("returns indexed-not-ready for cold Rift reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getRiftState(): Promise<RiftState> {
          throw new Error("frontend rift reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/rift`));

    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "indexed_read_not_ready", source: "contract-state-indexer" });
  });

  test("returns indexed-not-ready for cold Alliance reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getAllianceState(): Promise<AllianceState> {
          throw new Error("frontend alliance reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/alliance`));

    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
    });
  });

  test("serves direct attack protection from indexed scores without chain reader", async () => {
    const chainReader = new class extends MockChainReader {
      override async getAttackProtectionStatus(): Promise<AttackProtectionStatus> {
        throw new Error("frontend attack protection reads must not call chain reader");
      }
    }();
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer: testIndexer()
    })(new Request(`http://localhost/wallet/${player}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      wallet: player,
      targetPlanetId: "7",
      source: "contract-state-indexer"
    });
  });

  test("serves indexed no-membership Alliance state without chain alliance reads", async () => {
    const chainReader = new class extends MockChainReader {
      override async getAllianceState(wallet: Address): Promise<AllianceState> {
        throw new Error(`frontend alliance reads must not call chain reader for ${wallet}`);
      }

      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        throw new Error(`frontend alliance reads must not call live alliance intel for ${wallets.join(",")}`);
      }
    }();
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

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/alliance`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      wallet: player,
      allianceAvailable: true,
      source: "contract-state-indexer",
      stale: false,
      membership: {
        allianceId: "0",
        role: "none",
        joinedAt: "0"
      }
    });
    expect(body.profile).toBeNull();
    expect(body.directory).toEqual([]);
  });

  test("serves indexed Alliance profile, membership, and applications without chain reader", async () => {
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const chainReader = new class extends MockChainReader {
      override async getAllianceState(wallet: Address): Promise<AllianceState> {
        throw new Error(`frontend alliance reads must not call chain reader for ${wallet}`);
      }

      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        throw new Error(`frontend alliance reads must not call live alliance intel for ${wallets.join(",")}`);
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xalliance-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
      data: abiStrings("VEY", "Veydrift Command")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xalliance-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xalliance-profile",
      logIndex: "0x0",
      topics: [allianceProfileUpdatedTopic, topic(1n)],
      data: abiStrings("VEY", "Veydrift Command", "Indexed alliance")
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xalliance-request",
      logIndex: "0x0",
      topics: [allianceJoinRequestedTopic, topic(1n), addressTopic(applicant)],
      data: abiWords(1770003000n)
    });

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/alliance`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("healthy");
    expect(body).toMatchObject({
      wallet: player,
      allianceAvailable: true,
      source: "contract-state-indexer",
      stale: false,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        description: "Indexed alliance",
        owner: player,
        memberCount: 1
      },
      members: [
        { address: player, role: "owner", joinedAt: String(0x69801c81) }
      ],
      allianceJoinRequests: [
        { allianceId: "1", requester: applicant, requestedAt: "1770003000" }
      ]
    });
  });

  test("serves reconciled Alliance state while unrelated indexed state is stale", async () => {
    const chainReader = new class extends MockChainReader {
      override async getAllianceState(wallet: Address): Promise<AllianceState> {
        throw new Error(`frontend alliance reads must not call chain reader for ${wallet}`);
      }

      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        throw new Error(`frontend alliance reads must not call live alliance intel for ${wallets.join(",")}`);
      }

      async listAllianceLogs() {
        return [
          {
            blockNumber: "0x90",
            blockTimestamp: "0x69801c80",
            transactionHash: "0xalliance-create",
            logIndex: "0x0",
            topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
            data: abiStrings("VEY", "Veydrift Command")
          },
          {
            blockNumber: "0x91",
            blockTimestamp: "0x69801c81",
            transactionHash: "0xalliance-owner",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
            data: abiWords(3n)
          }
        ];
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.markStale("indexed_state_reconciliation_pending");

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/alliance`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("alliance-healthy");
    expect(body).toMatchObject({
      wallet: player,
      allianceAvailable: true,
      source: "contract-state-indexer",
      stale: true,
      indexer: {
        allianceStaleReason: null,
        safeToServeAllianceState: true,
        safeToServeIndexedState: false,
        staleReason: "indexed_state_reconciliation_pending"
      },
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        owner: player,
        memberCount: 1
      }
    });
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0adbf924")) {
          return abiWords(5_000n, 4_900n, 4_800n) as T;
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0adbf924")) {
          return abiWords(5_000n, 4_900n, 4_800n) as T;
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0adbf924")) {
          return abiWords(5_000n, 4_900n, 4_800n) as T;
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0x0adbf924")) {
          return abiWords(5_000n, 4_900n, 4_800n) as T;
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
    const getInfrastructureState = chainReader.getInfrastructureState.bind(chainReader);
    chainReader.getInfrastructureState = async (...args) => ({
      ...(await getInfrastructureState(...args)),
      resources: {
        metal: "5064",
        crystal: "4900",
        deuterium: "4800"
      }
    });
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

  test("serves indexed wallet settlement resources when the index is warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getWalletSettlement = async (wallet) => {
      liveReadCalled = true;
      return {
        wallet,
        hasFirstPlanet: true,
        homePlanetId: planet.planetId,
        planet: {
          ...planet,
          resources: {
            metal: "6100",
            crystal: "5300",
            deuterium: "4900"
          }
        }
      };
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
      source: "contract-state-indexer",
      planet: {
        planetId: planet.planetId,
        owner: player,
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800"
        }
      }
    });
    expect(liveReadCalled).toBe(false);
    expect(response.status).toBe(200);
  });

  test("falls back to accrued indexed wallet resources for settlement, planets, and infrastructure when chain reader is unavailable", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("RPC HTTP 503");
    };
    chainReader.getWalletPlanets = async () => {
      throw new Error("RPC HTTP 503");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("RPC HTTP 503");
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
    expect(infrastructureBody.planetId).toBe("7");
    expect(infrastructureBody.planetLastSettledAt).toBe(settlementBody.planet.lastSettledAt);
    expect(infrastructureBody.resources.metal).toBe("5064");
    expect(infrastructureBody.raidableResources.metal).toBe("5064");
  });

  test("serves selected infrastructure planet resources from warm indexed state without chain preview reads", async () => {
    const wallet = "0x9ea58b89140f60b7a706e88128c56b9de62c8bd8" as Address;
    const stalePlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "10",
      owner: wallet,
      galaxy: 8,
      system: 490,
      position: 11,
      lastSettledAt: "1780716473",
      resources: {
        metal: "13363",
        crystal: "3054",
        deuterium: "1855"
      },
      eventName: "ColonyCreated",
      transactionHash: "0xstale",
      blockNumber: "321"
    };
    const previewResources = {
      metal: "14214",
      crystal: "3389",
      deuterium: "1934"
    };
    const chainReader = new MockChainReader();
    chainReader.getInfrastructureState = (async (requestWallet: Address, selectedPlanetId?: bigint) => {
      expect(requestWallet).toBe(wallet);
      expect(selectedPlanetId).toBe(10n);
      return {
        wallet,
        homePlanetId: "7",
        planetId: "10",
        planetLastSettledAt: "1780716473",
        infrastructureAvailable: true,
        resources: previewResources,
        productionPerHour: {
          metal: "1594",
          crystal: "627",
          deuterium: "148"
        },
        energyBalance: {
          produced: "1000",
          required: "800",
          scaleBps: "10000"
        },
        storageCaps: {
          metal: "20000",
          crystal: "20000",
          deuterium: "10000"
        },
        protectedResources: {
          metal: "1000",
          crystal: "1000",
          deuterium: "1000"
        },
        raidableResources: {
          metal: "13214",
          crystal: "2389",
          deuterium: "934"
        },
        technologyLevels: {},
        buildings: [],
        queue: null
      };
    }) as ChainReader["getInfrastructureState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm resource endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent(stalePlanet);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${wallet}/infrastructure?planetId=10`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resources).toEqual(stalePlanet.resources);
    expect(body.source).toBe("contract-state-indexer");
  });

  test("serves post-spend indexed resources after multiple active queued spends", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("RPC HTTP 503");
    };
    chainReader.getWalletPlanets = async () => {
      throw new Error("RPC HTTP 503");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("RPC HTTP 503");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm queued-spend index should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: Math.floor(Date.now() / 1_000).toString()
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xqueued-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(12n, 1770002000n, 648n, 259n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xqueued-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, 1770002100n, 200n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xqueued-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1770002200n, 300n, 100n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xqueued-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(9n)],
      data: abiWords(1n, 1770002300n, 200n, 400n, 60n)
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

    const expectedResources = {
      metal: "3652",
      crystal: "4141",
      deuterium: "4740"
    };
    expect(settlementResponse.status).toBe(200);
    expect(planetsResponse.status).toBe(200);
    expect(infrastructureResponse.status).toBe(200);
    expect(settlementBody.planet.resources).toEqual(expectedResources);
    expect(planetsBody.planets[0].resources).toEqual(expectedResources);
    expect(infrastructureBody.resources).toEqual(expectedResources);
    expect(infrastructureBody.raidableResources).toEqual(expectedResources);
    expect(planetsBody.planets[0].queues).toMatchObject({
      building: { kind: "building", itemId: 3, targetLevel: 12 },
      defense: { kind: "defense", itemId: 0, quantity: 1 },
      ship: { kind: "ship", itemId: 1, quantity: 1 }
    });
    expect(planetsBody.queues.research).toMatchObject({
      kind: "research",
      itemId: 9,
      targetLevel: 1
    });
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

    expect(response.status).toBe(503);
    expect(liveReadCalled).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
    });
  });

  test("returns indexed-not-ready for cold wallet highscore reads without chain reader", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getHighscoreForWallet(): Promise<HighscoreEntry> {
          throw new Error("frontend wallet highscore reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/highscore`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
    });
  });

  test("serves indexed player queues without chain reader calls when warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getPlayerQueues = async () => {
      liveReadCalled = true;
      throw new Error("player queues should not call chain reader");
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
      detail: "player queues loaded from DB-indexed contract state."
    });
  });

  test("serves indexed building queues and levels without chain reader calls when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getPlayerQueues = async () => {
      throw new Error("queues should not call chain reader");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("RPC HTTP 503");
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
      throw new Error("RPC HTTP 503");
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

  test("serves indexed shipyard research and rift state without chain reader calls when warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = async () => {
      throw new Error("shipyard should not call chain reader");
    };
    chainReader.getResearchState = async () => {
      throw new Error("research should not call chain reader");
    };
    chainReader.getRiftState = async () => {
      throw new Error("rift should not call chain reader");
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

  test("serves indexed infrastructure resources when the index is warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getInfrastructureState = async () => {
      liveReadCalled = true;
      throw new Error("RPC HTTP 503");
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
      unavailableReason: "infrastructure loaded from DB-indexed contract state.",
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
      detail: "infrastructure loaded from DB-indexed contract state."
    });
  });

  test("serves a healthy indexed infrastructure snapshot", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.getInfrastructureState = async () => {
      throw new Error("RPC HTTP 503");
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
      source: "contract-state-indexer",
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

  test("keeps indexed infrastructure globally healthy while selected planet resources warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.getInfrastructureState = async () => {
      liveReadCalled = true;
      throw new Error("pending planet resources should not call chain reader");
    };
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xpending-planet",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(125n)
      ],
      data: abiWords(2n, 45n, 10n, 211n, 1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/infrastructure?planetId=125`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("healthy");
    expect(liveReadCalled).toBe(false);
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: "125",
      planetId: "125",
      planetLastSettledAt: null,
      infrastructureAvailable: false,
      unavailableReason: "Infrastructure indexed resources for this planet are still warming. Refresh shortly.",
      resources: null,
      stale: false,
      source: "contract-state-indexer",
      indexer: {
        indexedState: "healthy",
        pendingReconciliationReason: "planet_resources_pending:125",
        safeToServeIndexedState: true,
        staleReason: null
      }
    });
  });

  test("serves indexed page state without chain reader calls when warm", async () => {
    const chainReader = new MockChainReader();
    const liveReads: string[] = [];
    chainReader.getShipyardState = async () => {
      liveReads.push("shipyard");
      throw new Error("shipyard should not call chain reader");
    };
    chainReader.getDefenseState = async () => {
      liveReads.push("defenses");
      throw new Error("defenses should not call chain reader");
    };
    chainReader.getResearchState = async () => {
      liveReads.push("research");
      throw new Error("research should not call chain reader");
    };
    chainReader.getMoonState = async () => {
      liveReads.push("moon");
      throw new Error("moon should not call chain reader");
    };
    chainReader.getRiftState = async () => {
      liveReads.push("rift");
      throw new Error("rift should not call chain reader");
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
        detail: `${surface} loaded from DB-indexed contract state.`
      });
    }
    expect(liveReads).toEqual([]);
  });

  test("keeps selected planet id in warm indexed shipyard responses", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = async () => {
      throw new Error("warm selected shipyard should not call chain reader");
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

  test("falls back from client indexed-only resource requests to canonical warm indexed wallet state", async () => {
    const chainReader = new MockChainReader();
    chainReader.getWalletSettlement = async () => {
      throw new Error("client indexed request must not bypass indexed settlement");
    };
    chainReader.getWalletPlanets = async () => {
      throw new Error("client indexed request must not bypass indexed planets");
    };
    chainReader.getPlayerQueues = async () => {
      throw new Error("client indexed request must not bypass indexed queues");
    };
    chainReader.getInfrastructureState = async () => {
      throw new Error("client indexed request must not bypass indexed infrastructure");
    };
    chainReader.getShipyardState = async () => {
      throw new Error("client indexed request must not bypass indexed shipyard");
    };
    chainReader.getDefenseState = async () => {
      throw new Error("client indexed request must not bypass indexed defenses");
    };
    chainReader.getResearchState = async () => {
      throw new Error("client indexed request must not bypass indexed research");
    };
    chainReader.getMoonState = async () => {
      throw new Error("client indexed request must not bypass indexed moon");
    };
    chainReader.getRiftState = async () => {
      throw new Error("client indexed request must not bypass indexed rift");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("client indexed request should not rebuild the warm index");
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

    const settlementResponse = await handler(new Request(`http://localhost/wallet/${player}/settlement`));
    const settlementBody = await settlementResponse.json();
    const planetsResponse = await handler(new Request(`http://localhost/wallet/${player}/planets`));
    const planetsBody = await planetsResponse.json();
    const queuesResponse = await handler(new Request(`http://localhost/wallet/${player}/queues`));
    const queuesBody = await queuesResponse.json();
    const infrastructureResponse = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const infrastructureBody = await infrastructureResponse.json();
    const shipyardResponse = await handler(new Request(`http://localhost/wallet/${player}/shipyard`));
    const shipyardBody = await shipyardResponse.json();
    const defensesResponse = await handler(new Request(`http://localhost/wallet/${player}/defenses`));
    const defensesBody = await defensesResponse.json();
    const researchResponse = await handler(new Request(`http://localhost/wallet/${player}/research`));
    const researchBody = await researchResponse.json();
    const moonResponse = await handler(new Request(`http://localhost/wallet/${player}/moon`));
    const moonBody = await moonResponse.json();
    const riftResponse = await handler(new Request(`http://localhost/wallet/${player}/rift`));
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

  test("serves indexed resources for planet detail when the index is warm", async () => {
    const chainReader = new MockChainReader();
    chainReader.getPlanet = async (planetId) => {
      expect(planetId).toBe(7n);
      return {
        ...planet,
        resources: {
          metal: "14214",
          crystal: "3389",
          deuterium: "1934"
        }
      };
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
      owner: player,
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      }
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
      planets: [
        {
          planetId: planet.planetId,
          name: "Eos",
          coordinates: {
            galaxy: 2,
            system: 44,
            position: 9
          },
          archetype: "temperate-ocean",
          tactical: {
            raidableResources: {
              metal: "5000",
              crystal: "4900",
              deuterium: "4800"
            },
            raidableResourceTotal: "14700",
            ships: {
              count: expect.any(Number),
              power: expect.any(String)
            },
            defenses: {
              count: expect.any(Number),
              power: expect.any(String)
            },
            combatPower: expect.any(String)
          }
        }
      ],
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

  test("paginates highscore rankings while preserving absolute ranks", async () => {
    const owners = [
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555"
    ] as Address[];
    const currentWallet = owners[2]!;
    const requestedTargets: string[] = [];
    const chainReader = new class extends MockChainReader {
      override async getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
        expect(wallet).toBe(currentWallet);
        requestedTargets.push(targetPlanetId.toString());
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
    }();
    chainReader.listSettledPlanetEvents = async () => owners.map((owner, index) => ({
      ...planet,
      eventName: "PlanetStarted",
      owner,
      planetId: String(index + 10),
      transactionHash: `0xabc${index}`,
      blockNumber: String(123 + index)
    }));
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/highscores?page=2&pageSize=1&currentWallet=${currentWallet}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 1,
      totalEntries: 3,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true
    });
    expect(body.rankings.total).toHaveLength(1);
    expect(body.rankings.total[0]).toMatchObject({
      rank: 2,
      wallet: owners[1]
    });
    expect(requestedTargets).toEqual([]);
    expect(body.rankings.total[0].attackProtection).toEqual({
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null
    });
    expect(body.currentPlayer).toMatchObject({
      wallet: owners[2],
      rankings: {
        total: {
          rank: 3,
          page: 3
        }
      }
    });
  });

  test("hydrates highscore planet details only for the visible ranking page", async () => {
    const owners = [
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666"
    ] as Address[];
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => owners.map((owner, index) => ({
      ...planet,
      eventName: "PlanetStarted",
      owner,
      planetId: String(index + 10),
      transactionHash: `0xranking${index}`,
      blockNumber: String(123 + index)
    }));
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();

    const detailPlanetIds = new Set<string>();
    const detailOwners = new Set<string>();
    const infrastructureRows = indexer.infrastructureRows.bind(indexer);
    const defenseRows = indexer.defenseRows.bind(indexer);
    const shipRows = indexer.shipRows.bind(indexer);
    const technologyLevels = indexer.technologyLevels.bind(indexer);
    indexer.infrastructureRows = ((planetId: string) => {
      detailPlanetIds.add(planetId);
      return infrastructureRows(planetId);
    }) as SettlementIndexer["infrastructureRows"];
    indexer.defenseRows = ((planetId: string) => {
      detailPlanetIds.add(planetId);
      return defenseRows(planetId);
    }) as SettlementIndexer["defenseRows"];
    indexer.shipRows = ((planetId: string) => {
      detailPlanetIds.add(planetId);
      return shipRows(planetId);
    }) as SettlementIndexer["shipRows"];
    indexer.technologyLevels = ((wallet: Address) => {
      detailOwners.add(wallet.toLowerCase());
      return technologyLevels(wallet);
    }) as SettlementIndexer["technologyLevels"];

    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/highscores?category=total&page=2&pageSize=1&currentWallet=${owners[3]}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total).toHaveLength(1);
    expect(body.rankings.total[0]).toMatchObject({
      rank: 2,
      wallet: owners[1]
    });
    expect(body.rankings.economy).toEqual([]);
    expect(body.currentPlayer.rankings.total).toMatchObject({
      rank: 4,
      page: 4
    });
    expect(body.currentPlayer.rankings.economy).toBeNull();
    expect(detailPlanetIds).toEqual(new Set(["11"]));
    expect(detailOwners).toEqual(new Set([owners[1]!]));
  });

  test("includes all indexed planets for each ranked commander", async () => {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => [
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "7",
        owner: player,
        transactionHash: "0xabc1",
        blockNumber: "123"
      },
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "8",
        name: "Borealis",
        galaxy: 3,
        system: 12,
        position: 4,
        owner: player,
        temperature: -40,
        transactionHash: "0xabc2",
        blockNumber: "124"
      }
    ];
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
    expect(body.rankings.total[0].planets).toEqual([
      expect.objectContaining({
        planetId: "7",
        name: "Eos",
        coordinates: {
          galaxy: 2,
          system: 44,
          position: 9
        },
        archetype: "temperate-ocean",
        tactical: expect.objectContaining({
          raidableResources: expect.any(Object),
          raidableResourceTotal: expect.any(String),
          ships: expect.objectContaining({ count: expect.any(Number), power: expect.any(String) }),
          defenses: expect.objectContaining({ count: expect.any(Number), power: expect.any(String) }),
          combatPower: expect.any(String)
        })
      }),
      expect.objectContaining({
        planetId: "8",
        name: "Borealis",
        coordinates: {
          galaxy: 3,
          system: 12,
          position: 4
        },
        archetype: "frozen-ice",
        tactical: expect.objectContaining({
          raidableResources: expect.any(Object),
          raidableResourceTotal: expect.any(String),
          ships: expect.objectContaining({ count: expect.any(Number), power: expect.any(String) }),
          defenses: expect.objectContaining({ count: expect.any(Number), power: expect.any(String) }),
          combatPower: expect.any(String)
        })
      })
    ]);
  });

  test("does not block indexed highscore rankings on attack-protection reads by default", async () => {
    const currentWallet = "0x9999999999999999999999999999999999999999" as Address;
    const chainReader = new class extends MockChainReader {
      override async getAttackProtectionStatus(): Promise<AttackProtectionStatus> {
        throw new Error("rankings should not fetch per-row attack protection before rendering");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${currentWallet}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("contract-state-indexer");
    expect(body.currentPlayer).toMatchObject({
      wallet: currentWallet,
      rankings: {
        total: null
      }
    });
    expect(body.rankings.total[0].attackProtection).toBeNull();
  });

  test("keeps highscore alliance identity indexed-only instead of chain reader calls", async () => {
    const chainReader = new class extends MockChainReader {
      async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
        throw new Error(`highscores must not call live alliance intel for ${wallets.join(",")}`);
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
    expect(body.rankings.total[0].alliance).toBeNull();
  });

  test("adds indexed score protection to highscore rows without chain protection reads", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const chainReader = new class extends MockChainReader {
      override async getAttackProtectionStatus(): Promise<AttackProtectionStatus> {
        throw new Error("indexed rankings should not call live attack protection");
      }
    }();
    chainReader.listSettledPlanetEvents = async () => [
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "7",
        owner: player,
        transactionHash: "0xabc1",
        blockNumber: "123"
      },
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "8",
        owner: attacker,
        transactionHash: "0xabc2",
        blockNumber: "124"
      }
    ];
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xdefenseattacker",
      logIndex: "0x0",
      topics: [
        defenseCompletedTopic,
        topic(8n),
        topic(0n)
      ],
      data: abiWords(9n, 1000n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toEqual({
      allowed: false,
      blockedReason: "score_protection",
      blockedReasonLabel: "Attack blocked: target is protected by newbie or score-ratio protection."
    });
  });

  test("does not fetch same-alliance protection in indexed highscore rows", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const chainReader = new class extends MockChainReader {
      override async getAttackProtectionStatus(): Promise<AttackProtectionStatus> {
        throw new Error("indexed rankings should not call live attack protection");
      }

      async getAllianceIntelForPlayers(): Promise<Map<Address, AllianceIdentity>> {
        throw new Error("indexed rankings should not call live alliance intel");
      }
    }();
    chainReader.listSettledPlanetEvents = async () => [
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "7",
        owner: player,
        transactionHash: "0xabc1",
        blockNumber: "123"
      },
      {
        ...planet,
        eventName: "PlanetStarted",
        planetId: "8",
        owner: attacker,
        transactionHash: "0xabc2",
        blockNumber: "124"
      }
    ];
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xdefenseattacker",
      logIndex: "0x0",
      topics: [
        defenseCompletedTopic,
        topic(8n),
        topic(0n)
      ],
      data: abiWords(9n, 1000n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toEqual({
      allowed: false,
      blockedReason: "score_protection",
      blockedReasonLabel: "Attack blocked: target is protected by newbie or score-ratio protection."
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

  test("serves indexed highscores without chain highscore reads", async () => {
    const chainReader = new MockChainReader();
    chainReader.getHighscoreForWallet = async () => {
      throw new Error("highscores should not call chain reader");
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

  test("returns CORS headers when indexed highscores are unavailable", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: {} as ChainReader
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body).toMatchObject({
      error: "indexed_read_not_ready",
      source: "contract-state-indexer"
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

function abiStrings(...values: string[]): string {
  const tails = values.map((value) => {
    const bytes = new TextEncoder().encode(value);
    const data = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${BigInt(bytes.length).toString(16).padStart(64, "0")}${data.padEnd(Math.ceil(data.length / 64) * 64, "0")}`;
  });
  let offset = 32n * BigInt(values.length);
  const heads = tails.map((tail) => {
    const head = offset.toString(16).padStart(64, "0");
    offset += BigInt(tail.length / 2);
    return head;
  });
  return `0x${[...heads, ...tails].join("")}`;
}

function topic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressTopic(address: Address): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function completedFleetMissionLogs({
  missionId,
  owner,
  originPlanetId,
  targetPlanetId,
}: {
  missionId: bigint;
  owner: Address;
  originPlanetId: bigint;
  targetPlanetId: bigint;
}): IndexedRpcLog[] {
  const arrivalAt = 1_800_000_000n + missionId;
  const returnAt = arrivalAt + 300n;
  return [
    fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(0n)],
      data: abiWords(originPlanetId, targetPlanetId, arrivalAt, returnAt),
      logIndex: Number(missionId * 10n),
    }),
    fleetMissionLog({
      topics: [fleetMissionCargoTopic, topic(missionId)],
      data: abiWords(0n, 0n, 0n, 1n),
      logIndex: Number(missionId * 10n + 1n),
    }),
    fleetMissionLog({
      topics: [fleetMissionShipsTopic, topic(missionId)],
      data: abiWords(...Array.from({ length: 14 }, (_, index) => index === 0 ? 1n : 0n)),
      logIndex: Number(missionId * 10n + 2n),
    }),
    fleetMissionLog({
      topics: [fleetMissionReturnedTopic, topic(missionId), addressTopic(owner), topic(originPlanetId)],
      data: "0x",
      logIndex: Number(missionId * 10n + 3n),
    }),
  ];
}

function fleetMissionLog({
  data,
  logIndex,
  topics,
}: {
  data: string;
  logIndex: number;
  topics: string[];
}): IndexedRpcLog {
  const log: IndexedRpcLog = {
    blockNumber: "0x64",
    data,
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics,
    transactionHash: `0x${logIndex.toString(16).padStart(64, "0")}`,
  };
  return log;
}
