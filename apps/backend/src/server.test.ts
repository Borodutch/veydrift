import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { privateKeyToAccount } from "viem/accounts";
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
  FleetMissionSummary,
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
import { MissionResolutionService } from "./missionResolution";
import { watchedPlanetMessage } from "./playerProfiles";
import { deriveInfrastructureFields } from "./readModels";
import { createRequestHandler, deriveLogBackfiller, readerBootstrapHealthResponse, runtimeConfigResponse, shouldRecoverFailedReconciliation } from "./server";
import { DEFAULT_MAX_WORKER_COUNT } from "./workerPool";

setSystemTime(new Date(1_770_007_680_000));
afterAll(() => setSystemTime());

const configuredTestConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  qaSyntheticStationedDefenders: false,
  indexDbPath: ":memory:",
  randomnessCommitmentStorePath: ".data/test-randomness.json",
  referralStorePath: ".data/test-referrals.json",
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
  settlementStartPriceWei: "50000000000000000",
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
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const planetDefenseCountChangedTopic = "0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3";
const moonCreatedTopic = "0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4";
const moonResourcesSettledTopic = "0xb20fd9e652e1b740544f362fb3047c43a7bf0d6c7fbf0f5cab5f1f939aac6917";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionRecalledTopic = "0x2c9b31f1abc732f3b6d28e7724439ea4713ae516632088b8c4dc0211479dc6ca";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
const defenseHoldStationedTopic = "0x1183ab32cc2efce96b8c0956b35dd1b46c594234a5717fd810d8cc569a193a47";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
const allianceDiplomacyUpdatedTopic = "0x3df4b2aa5708b43ef1805908826beae5c9a30fb60b1952ad99ce3444b2eec6da";

function expectedBackendGitSha(): string | null {
  return process.env.SOURCE_VERSION?.trim()
    || process.env.EASYPANEL_GIT_SHA?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GITHUB_SHA?.trim()
    || process.env.COMMIT_SHA?.trim()
    || process.env.VEYDRIFT_BUILD_GIT_SHA?.trim()
    || null;
}

function expectedBackendGitShaSource(): string | null {
  if (process.env.SOURCE_VERSION?.trim()) return "SOURCE_VERSION";
  if (process.env.EASYPANEL_GIT_SHA?.trim()) return "EASYPANEL_GIT_SHA";
  if (process.env.RAILWAY_GIT_COMMIT_SHA?.trim()) return "RAILWAY_GIT_COMMIT_SHA";
  if (process.env.GITHUB_SHA?.trim()) return "GITHUB_SHA";
  if (process.env.COMMIT_SHA?.trim()) return "COMMIT_SHA";
  if (process.env.VEYDRIFT_BUILD_GIT_SHA?.trim()) return "VEYDRIFT_BUILD_GIT_SHA";
  return null;
}

function expectedBackendBuildMetadata() {
  return {
    deploymentAbiHash: process.env.VEYDRIFT_DEPLOYMENT_ABI_HASH?.trim() || null,
    deploymentCommit: process.env.VEYDRIFT_DEPLOYMENT_COMMIT?.trim() || null,
    deploymentTimestamp: process.env.VEYDRIFT_DEPLOYMENT_TIMESTAMP?.trim() || null,
    gitSha: expectedBackendGitSha(),
    gitShaSource: expectedBackendGitShaSource()
  };
}

function expectedBackendWorkerCount(): number {
  return Math.max(1, Math.min(Math.floor(navigator.hardwareConcurrency), DEFAULT_MAX_WORKER_COUNT));
}

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
  test("matches the current Rift Stabilizer build dependencies", () => {
    expect(riftRequirements(false, 0, 0, {})).toEqual([
      {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Rift Stabilizer",
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
      bodyKind: "planet",
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
        bodyKind: "moon",
        exists: true,
        parentPlanetId: planet.planetId,
        planetId: planet.planetId,
        coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
        resources: { metal: "101", crystal: "202", deuterium: "303" },
        resourcesAsOfNow: { metal: "101", crystal: "202", deuterium: "303" },
        ships: [],
        defenses: []
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
        metal: "2000",
        crystal: "1950",
        deuterium: "1900"
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
      bodyKind: "moon",
      homePlanetId: planet.planetId,
      parentPlanetId: planet.planetId,
      moonAvailable: true,
      resources: { metal: "101", crystal: "202", deuterium: "303" },
      resourcesAsOfNow: { metal: "101", crystal: "202", deuterium: "303" },
      ships: [],
      defenses: [],
      moon: {
        exists: true,
        planetId: planet.planetId,
        owner: wallet,
        fields: 4,
        diameterKm: 7120,
        createdAt: "1770000100",
        jumpGateReadyAt: "1770007200"
      },
      fleet: [],
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
      },
      technologyLevels: {},
      defenseQueue: null
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
          label: "Rift Stabilizer",
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
      diplomacy: [],
      activeWars: [],
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

describe("chain-sync log backfill wiring", () => {
  test("production reader exposes the log backfiller chain-sync depends on", () => {
    // server.ts builds the chain-sync logBackfiller from the production reader via
    // deriveLogBackfiller. If VeydriftGameReader stopped exposing listContractLogs, or the
    // wiring dropped it, gap replay and reconnect backfill would silently become a no-op
    // in production. This asserts the real reader satisfies the backfiller contract.
    const reader = new VeydriftGameReader(configuredTestConfig);
    const backfiller = deriveLogBackfiller(reader);
    expect(backfiller).toBeDefined();
    expect(typeof backfiller?.listContractLogs).toBe("function");
    expect(typeof backfiller?.failoverRpc).toBe("function");
    expect(typeof backfiller?.rpcMetrics).toBe("function");
  });

  test("deriveLogBackfiller yields nothing when the reader cannot list contract logs", () => {
    expect(deriveLogBackfiller(undefined)).toBeUndefined();
    expect(deriveLogBackfiller({} as unknown as Parameters<typeof deriveLogBackfiller>[0])).toBeUndefined();
  });
});

describe("Veydrift backend", () => {
  const handler = createRequestHandler();

  test("returns health status", async () => {
    const response = await handler(new Request("http://localhost/health"));

    await expect(response.json()).resolves.toEqual({
      chain: {
        allianceContractConfigured: false,
        chainId: 84532,
        deploymentMode: "local",
        hasRpcUrl: false,
        indexFromBlock: "0",
        logChunkSpan: "90000",
        missionResolutionEnabled: false,
        missionResolverConfigured: false,
        resourceTokensConfigured: {
          crystal: false,
          deuterium: false,
          metal: false
        },
        rpcFallbackConfigured: false,
        rpcFallbackCount: 0,
        rpcSource: "missing",
        wsRpcSource: "missing",
        hasWsRpcUrl: false,
        resourceTokenAddressesConfigured: false,
        settlementContractConfigured: false,
        settlementStartPriceConfigured: false,
        moonContractConfigured: false,
        migrationContractConfigured: false,
        randomnessEngineConfigured: false,
        randomnessCommitterConfigured: false,
        referralSignerConfigured: false,
        gameContractConfigured: false,
        qaSyntheticStationedDefenders: false
      },
      configured: false,
      backend: {
        build: expectedBackendBuildMetadata(),
        worker: {
          count: expectedBackendWorkerCount(),
          defaultMaxWorkerCount: DEFAULT_MAX_WORKER_COUNT,
          index: 0,
          role: "writer"
        }
      },
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
      randomnessCommitter: null,
      rpc: null,
      chainSyncRpc: null,
      ok: false,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(503);
  });

  test("returns immediately for requests already aborted by the client", async () => {
    const controller = new AbortController();
    const request = new Request("http://localhost/health", { signal: controller.signal });
    controller.abort();

    const response = await handler(request);

    expect(response.status).toBe(499);
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
    expect(body.ok).toBe(false);
    expect(response.status).toBe(503);
  });

  test("returns 200 only when the backend readiness gate is satisfied", async () => {
    const chainSync = {
      start() {},
      snapshot() {
        return {
          connected: true,
          subscribedToHeads: true,
          subscribedToLogs: true
        };
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const indexer = {
      snapshot() {
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      indexer
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.readiness).toMatchObject({
      ready: true,
      configurationReady: true,
      chainSyncConnected: true,
      subscribedToHeads: true,
      subscribedToLogs: true,
      indexedState: "healthy",
      safeToServeIndexedState: true
    });
  });

  test("logs every backend request with response time metadata", async () => {
    const originalInfo = console.info;
    const logs: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const chainSync = {
        start() {},
        snapshot() {
          return {
            connected: true,
            subscribedToHeads: true,
            subscribedToLogs: true
          };
        }
      } as unknown as import("./chainSync").ChainSyncService;
      const loggedHandler = createRequestHandler({
        chainReader: new MockChainReader(),
        chainSync,
        config: configuredTestConfig,
        logRequests: true
      });

      const response = await loggedHandler(new Request("http://localhost/runtime-config?source=test"));

      expect(response.status).toBe(200);
      expect(logs).toHaveLength(1);
      const log = logs[0];
      expect(log).toBeDefined();
      const entry = JSON.parse(String(log![0])) as {
        durationMs: number;
        kind: string;
        method: string;
        path: string;
        queryKeys: string[];
        route: string;
        service: string;
        status: number;
        stream: boolean;
        workerRole: string;
      };
      expect(entry).toMatchObject({
        kind: "api_request",
        method: "GET",
        path: "/runtime-config?source=test",
        queryKeys: ["source"],
        route: "/runtime-config",
        service: "veydrift",
        status: 200,
        stream: false,
        workerRole: "writer"
      });
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      console.info = originalInfo;
    }
  });

  test("does not touch the indexer snapshot on reader health checks", async () => {
    const indexer = {
      snapshot() {
        throw new Error("reader health must stay off indexed read models");
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      indexer,
      role: "reader"
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.backend.worker.role).toBe("reader");
    expect(body.indexer).toBeNull();
    expect(body.readiness).toMatchObject({
      ready: true,
      indexedState: null,
      safeToServeIndexedState: null
    });
  });

  test("keeps concurrent health reads off the response cache", async () => {
    let snapshots = 0;
    const chainSync = {
      start() {},
      snapshot() {
        return {
          connected: true,
          subscribedToHeads: true,
          subscribedToLogs: true
        };
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const indexer = {
      snapshot() {
        snapshots += 1;
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer
    });

    const responses = await Promise.all(Array.from({ length: 10 }, () => handler(new Request("http://localhost/health"))));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(snapshots).toBe(10);
  });

  test("does not wait on stale shared-cache locks for health", async () => {
    let waitDeadlineMs: number | undefined;
    let snapshots = 0;
    const sharedResponseCache = {
      get() {
        return null;
      },
      tryAcquireRefresh() {
        return false;
      },
      async waitForFresh(_cacheKey: string, deadlineMs?: number) {
        waitDeadlineMs = deadlineMs;
        return null;
      },
      set() {},
      releaseRefresh() {}
    } as unknown as import("./sharedResponseCache").SharedResponseCache;
    const chainSync = {
      start() {},
      snapshot() {
        return {
          connected: true,
          subscribedToHeads: true,
          subscribedToLogs: true
        };
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const indexer = {
      snapshot() {
        snapshots += 1;
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer,
      sharedResponseCache
    });

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(waitDeadlineMs).toBeUndefined();
    expect(snapshots).toBe(1);
  });

  test("serves versionless shared stale reads instead of recomputing cold routes", async () => {
    let staleKeyUsed = false;
    const staleBody = new TextEncoder().encode(JSON.stringify({ stale: true })).buffer as ArrayBuffer;
    const sharedResponseCache = {
      get(cacheKey: string, _now?: number, includeStale?: boolean) {
        if (!includeStale || !cacheKey.endsWith(" indexer=stale")) return null;
        staleKeyUsed = true;
        return {
          body: staleBody,
          expiresAt: Date.now() - 1_000,
          headers: [["content-type", "application/json"]],
          status: 200,
          statusText: ""
        };
      },
      tryAcquireRefresh() {
        return false;
      },
      async waitForFresh() {
        throw new Error("should not wait for a versioned refresh when versionless stale data exists");
      },
      set() {},
      releaseRefresh() {}
    } as unknown as import("./sharedResponseCache").SharedResponseCache;
    const chainSync = {
      start() {},
      snapshot() {
        throw new Error("stale cache should avoid recomputing the cold route");
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      enableResponseCache: true,
      sharedResponseCache
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ stale: true });
    expect(staleKeyUsed).toBe(true);
  });

  test("does not serve versionless shared stale wallet snapshots across indexed-state versions", async () => {
    let staleKeyUsed = false;
    const staleBody = new TextEncoder().encode(JSON.stringify({ stale: true })).buffer as ArrayBuffer;
    const sharedResponseCache = {
      get(cacheKey: string, _now?: number, includeStale?: boolean) {
        if (!includeStale || !cacheKey.endsWith(" indexer=stale")) return null;
        staleKeyUsed = true;
        return {
          body: staleBody,
          expiresAt: Date.now() - 1_000,
          headers: [["content-type", "application/json"]],
          status: 200,
          statusText: ""
        };
      },
      tryAcquireRefresh() {
        return false;
      },
      async waitForFresh() {
        return null;
      },
      set() {},
      releaseRefresh() {}
    } as unknown as import("./sharedResponseCache").SharedResponseCache;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer: testIndexer(),
      prewarmResponseCache: false,
      sharedResponseCache
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/planets`));
    const body = await response.json() as WalletPlanets;

    expect(response.status).toBe(200);
    expect(body.wallet).toBe(player);
    expect(body.planets).toHaveLength(1);
    expect(staleKeyUsed).toBe(false);
  });

  test("does not wait on stale shared-cache locks for cold indexed reads", async () => {
    let waitCalled = false;
    const sharedResponseCache = {
      get() {
        return null;
      },
      tryAcquireRefresh() {
        return false;
      },
      async waitForFresh() {
        waitCalled = true;
        return null;
      },
      set() {},
      releaseRefresh() {}
    } as unknown as import("./sharedResponseCache").SharedResponseCache;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer: testIndexer(),
      prewarmResponseCache: false,
      sharedResponseCache
    });

    const response = await handler(new Request("http://localhost/universe/galaxies/1/systems/1"));

    expect(response.status).toBe(200);
    expect(waitCalled).toBe(false);
  });

  test("keeps health off the response-cache path", async () => {
    let sharedCacheRead = false;
    const sharedResponseCache = {
      get() {
        sharedCacheRead = true;
        return null;
      },
      tryAcquireRefresh() {
        throw new Error("health should not acquire shared refresh locks");
      },
      async waitForFresh() {
        throw new Error("health should not wait for shared refreshes");
      },
      set() {
        throw new Error("health should not write shared cache entries");
      },
      releaseRefresh() {}
    } as unknown as import("./sharedResponseCache").SharedResponseCache;
    const chainSync = {
      start() {},
      snapshot() {
        return { connected: true, subscribedToHeads: true, subscribedToLogs: true };
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const indexer = {
      snapshot() {
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer,
      sharedResponseCache
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sharedCacheRead).toBe(false);
  });

  test("returns quickly when indexed SQLite reads are busy", async () => {
    const chainSync = {
      start() {},
      snapshot() {
        throw new Error("database is locked");
      }
    } as unknown as import("./chainSync").ChainSyncService;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      chainSync,
      config: configuredTestConfig,
      enableResponseCache: false
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("database is locked");
  });

  test("returns public runtime config", async () => {
    const response = await handler(new Request("http://localhost/runtime-config"));
    const body = await response.json();

    expect(body).toEqual({
      apiUrl: "https://api-test.veydrift.com",
      allianceContractAddress: null,
      backend: {
        build: expectedBackendBuildMetadata(),
        worker: {
          count: expectedBackendWorkerCount(),
          defaultMaxWorkerCount: DEFAULT_MAX_WORKER_COUNT,
          index: 0,
          role: "writer"
        }
      },
      burningChicken: {
        burnContractAddress: null,
        burnSelector: "0xe1775196",
        nftContractAddress: null,
        rpcUrl: "https://mainnet.base.org"
      },
      chainId: 84532,
      contractAddress: null,
      featureSupport: {
        allianceConfigured: false,
        chickenBurnConfigured: false,
        gameConfigured: false,
        highscoresEndpoint: true,
        migrationConfigured: false,
        moonConfigured: false,
        randomnessConfigured: false,
        referralsConfigured: false,
        researchEndpoint: true,
        resourceTokensConfigured: false,
        settlementConfigured: false
      },
      gameContractAddress: null,
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      migrationContractAddress: null,
      moonContractAddress: null,
      network: "Base Sepolia",
      randomnessEngineAddress: null,
      referralSystemAddress: null,
      resourceTokenAddresses: {
        crystal: null,
        deuterium: null,
        metal: null
      },
      rpcProvider: "unknown"
    });
    expect(response.status).toBe(200);
  });

  test("builds reader runtime config without request handler dependencies", async () => {
    const response = runtimeConfigResponse("reader");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body.backend.worker.role).toBe("reader");
    expect(body.apiUrl).toBe("https://api-test.veydrift.com");
  });

  test("builds reader health without request handler dependencies", async () => {
    const response = readerBootstrapHealthResponse("reader");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(body.backend.worker.role).toBe("reader");
    expect(body.indexer).toBeNull();
    expect(body.rpc).toBeNull();
    expect(body.readiness).toMatchObject({
      ready: false,
      configurationReady: false,
      indexedState: null,
      safeToServeIndexedState: null
    });
  });

  test("prefers provider build SHA metadata over stale generic GIT_SHA", async () => {
    const previousGitSha = process.env.GIT_SHA;
    const previousSourceVersion = process.env.SOURCE_VERSION;
    process.env.GIT_SHA = "stale-generic-sha";
    process.env.SOURCE_VERSION = "provider-source-sha";

    try {
      const response = await createRequestHandler()(new Request("http://localhost/runtime-config"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.backend.build).toEqual({
        deploymentAbiHash: null,
        deploymentCommit: null,
        deploymentTimestamp: null,
        gitSha: "provider-source-sha",
        gitShaSource: "SOURCE_VERSION"
      });
    } finally {
      if (previousGitSha === undefined) {
        delete process.env.GIT_SHA;
      } else {
        process.env.GIT_SHA = previousGitSha;
      }
      if (previousSourceVersion === undefined) {
        delete process.env.SOURCE_VERSION;
      } else {
        process.env.SOURCE_VERSION = previousSourceVersion;
      }
    }
  });

  test("does not use contract deployment manifest commit as the source build SHA", async () => {
    const previousBuildGitSha = process.env.VEYDRIFT_BUILD_GIT_SHA;
    const previousDeploymentCommit = process.env.VEYDRIFT_DEPLOYMENT_COMMIT;
    const previousDeploymentAbiHash = process.env.VEYDRIFT_DEPLOYMENT_ABI_HASH;
    const previousDeploymentTimestamp = process.env.VEYDRIFT_DEPLOYMENT_TIMESTAMP;
    process.env.VEYDRIFT_BUILD_GIT_SHA = "current-image-sha";
    process.env.VEYDRIFT_DEPLOYMENT_COMMIT = "old-contract-deploy-sha";
    process.env.VEYDRIFT_DEPLOYMENT_ABI_HASH = "abi-hash";
    process.env.VEYDRIFT_DEPLOYMENT_TIMESTAMP = "2026-06-22T17:31:10Z";

    try {
      const response = await createRequestHandler()(new Request("http://localhost/runtime-config"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.backend.build).toMatchObject({
        deploymentAbiHash: "abi-hash",
        deploymentCommit: "old-contract-deploy-sha",
        deploymentTimestamp: "2026-06-22T17:31:10Z"
      });
      expect(body.backend.build.gitSha).not.toBe("old-contract-deploy-sha");
      expect(body.backend.build.gitShaSource).not.toBe("VEYDRIFT_DEPLOYMENT_COMMIT");
    } finally {
      if (previousBuildGitSha === undefined) {
        delete process.env.VEYDRIFT_BUILD_GIT_SHA;
      } else {
        process.env.VEYDRIFT_BUILD_GIT_SHA = previousBuildGitSha;
      }
      if (previousDeploymentCommit === undefined) {
        delete process.env.VEYDRIFT_DEPLOYMENT_COMMIT;
      } else {
        process.env.VEYDRIFT_DEPLOYMENT_COMMIT = previousDeploymentCommit;
      }
      if (previousDeploymentAbiHash === undefined) {
        delete process.env.VEYDRIFT_DEPLOYMENT_ABI_HASH;
      } else {
        process.env.VEYDRIFT_DEPLOYMENT_ABI_HASH = previousDeploymentAbiHash;
      }
      if (previousDeploymentTimestamp === undefined) {
        delete process.env.VEYDRIFT_DEPLOYMENT_TIMESTAMP;
      } else {
        process.env.VEYDRIFT_DEPLOYMENT_TIMESTAMP = previousDeploymentTimestamp;
      }
    }
  });

  test("ignores stale generic GIT_SHA metadata without a provider or build artifact SHA", async () => {
    const previousGitSha = process.env.GIT_SHA;
    const previousBuildGitSha = process.env.VEYDRIFT_BUILD_GIT_SHA;
    const previousSourceVersion = process.env.SOURCE_VERSION;
    const previousEasypanelGitSha = process.env.EASYPANEL_GIT_SHA;
    const previousRailwayGitCommitSha = process.env.RAILWAY_GIT_COMMIT_SHA;
    const previousGithubSha = process.env.GITHUB_SHA;
    const previousCommitSha = process.env.COMMIT_SHA;
    process.env.GIT_SHA = "stale-generic-sha";
    delete process.env.VEYDRIFT_BUILD_GIT_SHA;
    delete process.env.SOURCE_VERSION;
    delete process.env.EASYPANEL_GIT_SHA;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.GITHUB_SHA;
    delete process.env.COMMIT_SHA;

    try {
      const response = await createRequestHandler()(new Request("http://localhost/runtime-config"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.backend.build.gitSha).toBeNull();
      expect(body.backend.build.gitShaSource).toBeNull();
    } finally {
      if (previousGitSha === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = previousGitSha;
      if (previousBuildGitSha === undefined) delete process.env.VEYDRIFT_BUILD_GIT_SHA;
      else process.env.VEYDRIFT_BUILD_GIT_SHA = previousBuildGitSha;
      if (previousSourceVersion === undefined) delete process.env.SOURCE_VERSION;
      else process.env.SOURCE_VERSION = previousSourceVersion;
      if (previousEasypanelGitSha === undefined) delete process.env.EASYPANEL_GIT_SHA;
      else process.env.EASYPANEL_GIT_SHA = previousEasypanelGitSha;
      if (previousRailwayGitCommitSha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
      else process.env.RAILWAY_GIT_COMMIT_SHA = previousRailwayGitCommitSha;
      if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousGithubSha;
      if (previousCommitSha === undefined) delete process.env.COMMIT_SHA;
      else process.env.COMMIT_SHA = previousCommitSha;
    }
  });

  test("does not rate-limit runtime config bootstrap reads", async () => {
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await handler(new Request("https://api-test.veydrift.com/runtime-config", {
        headers: { "x-forwarded-for": "203.0.113.10" }
      })));
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  test("does not prewarm broad indexed reads on reader workers by default", async () => {
    const indexer = testIndexer();
    let prewarmCalls = 0;
    indexer.allActiveFleetMissions = () => {
      prewarmCalls += 1;
      return [];
    };

    createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer,
      role: "reader"
    });

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(prewarmCalls).toBe(0);
  });

  test("serves concurrent external cold cache misses without refresh_busy responses", async () => {
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer: testIndexer(),
      prewarmResponseCache: false
    });
    const headers = { "x-forwarded-for": "203.0.113.42", accept: "application/json" };

    const responses = await Promise.all([
      handler(new Request("https://api-test.veydrift.com/highscores?limit=10", { headers })),
      handler(new Request("https://api-test.veydrift.com/universe/galaxies/1/systems/1", { headers })),
      handler(new Request("https://api-test.veydrift.com/missions?status=active", { headers }))
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).not.toContain(429);
    expect(bodies.map((body) => body.error)).not.toContain("refresh_busy");
  });

  test("does not rate-limit warm cached public reads during repeated stress probes", async () => {
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      enableResponseCache: true,
      indexer: testIndexer(),
      prewarmResponseCache: false
    });
    const headers = { "x-forwarded-for": "203.0.113.43", accept: "application/json" };

    const warmup = await handler(new Request("https://api-test.veydrift.com/universe/systems?galaxy=2&center=44&radius=1", { headers }));
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await handler(new Request("https://api-test.veydrift.com/universe/systems?galaxy=2&center=44&radius=1", { headers })));
    }

    expect(warmup.status).toBe(200);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  test("publishes split settlement and game contracts in runtime config", async () => {
    const previousGameAddress = process.env.VEYDRIFT_CONTRACT_ADDRESS;
    const previousGameOverrideAddress = process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS;
    const previousSettlementAddress = process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS;
    const previousMoonAddress = process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS;
    const previousRandomnessEngineAddress = process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS;
    const previousAllianceAddress = process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS;
    const previousChickenNftAddress = process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS;
    const previousChickenBurnAddress = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS;
    const previousChickenBurnSelector = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR;
    const previousBaseMainnetRpcUrl = process.env.VEYDRIFT_BASE_MAINNET_RPC_URL;
    const previousMetalTokenAddress = process.env.VEYDRIFT_METAL_TOKEN_ADDRESS;
    const previousCrystalTokenAddress = process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS;
    const previousDeuteriumTokenAddress = process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS;
    process.env.VEYDRIFT_CONTRACT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS = "0x4444444444444444444444444444444444444444";
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS = "0x8888888888888888888888888888888888888888";
    process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS = "0x9999999999999999999999999999999999999999";
    process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR = "0xe1775196";
    process.env.VEYDRIFT_BASE_MAINNET_RPC_URL = "https://base.example.test";
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
        burningChicken: {
          burnContractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          burnSelector: "0xe1775196",
          nftContractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          rpcUrl: "https://base.example.test"
        },
        featureSupport: {
          allianceConfigured: true,
          chickenBurnConfigured: true,
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
      if (previousChickenNftAddress === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS = previousChickenNftAddress;
      }
      if (previousChickenBurnAddress === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS = previousChickenBurnAddress;
      }
      if (previousChickenBurnSelector === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR = previousChickenBurnSelector;
      }
      if (previousBaseMainnetRpcUrl === undefined) {
        delete process.env.VEYDRIFT_BASE_MAINNET_RPC_URL;
      } else {
        process.env.VEYDRIFT_BASE_MAINNET_RPC_URL = previousBaseMainnetRpcUrl;
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

  test("does not enable Chicken burns for stale coordinate selector config", async () => {
    const previousChickenNftAddress = process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS;
    const previousChickenBurnAddress = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS;
    const previousChickenBurnSelector = process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR;
    process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR = "0x6364233d";

    try {
      const response = await handler(new Request("http://localhost/runtime-config"));

      await expect(response.json()).resolves.toMatchObject({
        burningChicken: {
          burnContractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          burnSelector: "0x6364233d",
          nftContractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        featureSupport: {
          chickenBurnConfigured: false
        }
      });
      expect(response.status).toBe(200);
    } finally {
      if (previousChickenNftAddress === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_NFT_CONTRACT_ADDRESS = previousChickenNftAddress;
      }
      if (previousChickenBurnAddress === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_BURN_CONTRACT_ADDRESS = previousChickenBurnAddress;
      }
      if (previousChickenBurnSelector === undefined) {
        delete process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR;
      } else {
        process.env.VEYDRIFT_BURNING_CHICKEN_BURN_SELECTOR = previousChickenBurnSelector;
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
            backend: {
              build: expectedBackendBuildMetadata(),
              worker: {
                count: expectedBackendWorkerCount(),
                defaultMaxWorkerCount: DEFAULT_MAX_WORKER_COUNT,
                index: 0,
                role: "writer"
              }
            },
            burningChicken: {
              burnContractAddress: null,
              burnSelector: "0xe1775196",
              nftContractAddress: null,
              rpcUrl: "https://mainnet.base.org"
            },
            chainId: 84532,
            contractAddress: null,
            featureSupport: {
              allianceConfigured: false,
              chickenBurnConfigured: false,
              gameConfigured: false,
              highscoresEndpoint: true,
              migrationConfigured: false,
              moonConfigured: false,
              randomnessConfigured: false,
              referralsConfigured: false,
              researchEndpoint: true,
              resourceTokensConfigured: false,
              settlementConfigured: false
            },
            gameContractAddress: null,
            graphqlUrl: "https://api-test.veydrift.com/graphql",
            migrationContractAddress: null,
            moonContractAddress: null,
            network: "Base Sepolia",
            randomnessEngineAddress: null,
            referralSystemAddress: null,
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

  test("does not leak secrets in public runtime config output", async () => {
    const response = await createRequestHandler({
      config: {
        ...configuredTestConfig,
        rpcSource: "alchemy-key",
        rpcUrl: "https://base-sepolia.g.alchemy.com/v2/not-for-output"
      },
      chainReader: new MockChainReader()
    })(new Request("http://localhost/runtime-config"));

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("not-for-output");
    expect(body).toMatchObject({
      chainId: 84532,
      rpcProvider: "unknown"
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

  test("returns indexed-not-ready for settlement-funding when the index is cold", async () => {
    // VEY-KANEO-478: a cold/booting indexer must surface a real retryable not-ready
    // response (like /settlement and /planets), not the old permanent unavailable stub
    // that blocked onboarding. It must also not reach the chain reader to do so.
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
          throw new Error("cold settlement funding reads must not call chain reader");
        }
      }())
    })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "indexed_read_not_ready",
      retryable: true,
      source: "contract-state-indexer"
    });
  });

  test("serves migration settlement-funding claims when the mainnet index is still empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-migration-claims-"));
    const snapshotPath = join(dir, "claims.json");
    writeFileSync(snapshotPath, JSON.stringify({
      claims: {
        [player.toLowerCase()]: {
          signature: "0xabcd",
          statePayload: "0x1234",
          reservedPlanets: [{
            planetId: "1",
            galaxy: 2,
            system: 99,
            position: 7,
            fields: 211,
            temperature: -14
          }]
        }
      }
    }));
    const previousPath = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
    process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = snapshotPath;
    try {
      const chainReader = withoutIndexLists(new class extends MockChainReader {
        override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
          throw new Error("migration settlement funding reads must not call chain reader");
        }
      }());
      const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
      const response = await createRequestHandler({
        config: configuredTestConfig,
        chainReader,
        indexer
      })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        migrationClaim: {
          signature: "0xabcd",
          statePayload: "0x1234"
        },
        migrationReservation: {
          exists: true,
          claimed: false,
          planetId: "1",
          galaxy: 2,
          system: 99,
          position: 7,
          fields: 211,
          temperature: -14
        },
        source: "contract-state-indexer"
      });
    } finally {
      if (previousPath === undefined) delete process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
      else process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = previousPath;
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("serves cold wallet settlement for wallets with signed migration claims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-migration-claims-"));
    const snapshotPath = join(dir, "claims.json");
    writeFileSync(snapshotPath, JSON.stringify({
      claims: {
        [player.toLowerCase()]: {
          signature: "0xabcd",
          statePayload: "0x1234"
        }
      }
    }));
    const previousPath = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
    process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = snapshotPath;
    try {
      const chainReader = withoutIndexLists(new class extends MockChainReader {
        override async getWalletSettlement(): Promise<WalletSettlement> {
          throw new Error("migration wallet settlement reads must not call chain reader");
        }
      }());
      const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
      const response = await createRequestHandler({
        config: configuredTestConfig,
        chainReader,
        indexer
      })(new Request(`http://localhost/wallet/${player}/settlement`));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        contractKind: "game",
        hasFirstPlanet: false,
        homePlanetId: null,
        migrationClaim: {
          signature: "0xabcd",
          statePayload: "0x1234"
        },
        source: "contract-state-indexer",
        wallet: player
      });
    } finally {
      if (previousPath === undefined) delete process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
      else process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = previousPath;
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("serves settlement-funding from config when the indexer is warm without a request-time chain read", async () => {
    const chainReader = new class extends MockChainReader {
      override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
        throw new Error("warm settlement funding reads must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      affordable: true,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: "50000000000000000",
      source: "contract-state-indexer"
    });
    expect(body.startPriceWei).not.toBeNull();
    expect(body.unavailableReason).toBeUndefined();
  });

  test("serves signed migration claim payloads from the configured snapshot file", async () => {
    const chainReader = new class extends MockChainReader {
      override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
        throw new Error("warm settlement funding reads must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    const dir = mkdtempSync(join(tmpdir(), "veydrift-migration-claims-"));
    const snapshotPath = join(dir, "claims.json");
    writeFileSync(snapshotPath, JSON.stringify({
      claims: {
        [player.toLowerCase()]: {
          signature: "0xabcd",
          statePayload: "0x1234"
        }
      }
    }));
    const previousPath = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
    process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = snapshotPath;
    try {
      const response = await createRequestHandler({
        config: configuredTestConfig,
        chainReader,
        indexer
      })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        migrationClaim: {
          signature: "0xabcd",
          statePayload: "0x1234"
        }
      });
    } finally {
      if (previousPath === undefined) delete process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
      else process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = previousPath;
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("keeps signed migration claim visible on warm wallet settlement when the wallet already has a normal planet", async () => {
    const chainReader = new class extends MockChainReader {
      override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
        throw new Error("warm settlement claim should not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    const dir = mkdtempSync(join(tmpdir(), "veydrift-migration-claims-"));
    const snapshotPath = join(dir, "claims.json");
    writeFileSync(snapshotPath, JSON.stringify({
      claims: {
        [player.toLowerCase()]: {
          signature: "0xabcd",
          statePayload: "0x1234",
          reservedPlanets: [{
            planetId: "26",
            galaxy: 9,
            system: 400,
            position: 1,
            fields: 224,
            temperature: 55
          }]
        }
      }
    }));
    const previousPath = process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
    process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = snapshotPath;
    try {
      const response = await createRequestHandler({
        config: configuredTestConfig,
        chainReader,
        indexer
      })(new Request(`http://localhost/wallet/${player}/settlement`));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        hasFirstPlanet: true,
        migrationClaim: {
          signature: "0xabcd",
          statePayload: "0x1234"
        },
        migrationReservation: {
          exists: true,
          claimed: false,
          planetId: "26",
          galaxy: 9,
          system: 400,
          position: 1
        }
      });
    } finally {
      if (previousPath === undefined) delete process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH;
      else process.env.VEYDRIFT_MIGRATION_STATE_PAYLOADS_PATH = previousPath;
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reports settlement-funding unavailable when no static start price is configured", async () => {
    const chainReader = new class extends MockChainReader {
      override getSettlementFunding(): ReturnType<MockChainReader["getSettlementFunding"]> {
        throw new Error("unconfigured settlement funding must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    const configWithoutStartPrice: BackendConfig = { ...configuredTestConfig };
    delete configWithoutStartPrice.settlementStartPriceWei;

    const response = await createRequestHandler({
      config: configWithoutStartPrice,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/settlement-funding`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: null,
      unavailableReason: "Settlement start price is not configured for this game deployment yet.",
      source: "contract-state-indexer"
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

  test("filters completed mission archives by mission number before pagination", async () => {
    const chainReader = new class extends MockChainReader {
      override async getFleetMissionVisibility(): Promise<never> {
        throw new Error("mission archive search must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    for (const missionId of [112n, 212n, 330n]) {
      for (const log of completedFleetMissionLogs({ missionId, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
        indexer.applyLog(log);
      }
    }

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/missions?status=completed&missionNumber=%2312&page=1&pageSize=1`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalEntries: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true
    });
    expect(body.rows).toHaveLength(1);
    expect(["112", "212"]).toContain(body.rows[0].mission.missionId);
  });

  test("serves paginated incoming attack archive from the indexed read model", async () => {
    const attacker = "0x5555555555555555555555555555555555555555" as Address;
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
    for (const log of completedFleetMissionLogs({ missionId: 1n, missionTypeId: 3n, owner: attacker, originPlanetId: 9n, targetPlanetId: 7n })) {
      indexer.applyLog(log);
    }
    for (const log of completedFleetMissionLogs({ missionId: 2n, missionTypeId: 3n, owner: player, originPlanetId: 7n, targetPlanetId: 9n })) {
      indexer.applyLog(log);
    }
    for (const log of completedFleetMissionLogs({ missionId: 3n, missionTypeId: 0n, owner: attacker, originPlanetId: 9n, targetPlanetId: 7n })) {
      indexer.applyLog(log);
    }

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/missions?status=completed&filter=incomingAttacks&page=1&pageSize=25`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 25,
      totalEntries: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false
    });
    expect(body.rows).toEqual([
      expect.objectContaining({
        kind: "mission",
        mission: expect.objectContaining({
          missionId: "1",
          missionType: "Attack",
          owner: attacker,
          targetPlanetId: "7"
        })
      })
    ]);
  });

  test("keeps cached mission archive filters and search queries separate", async () => {
    const attacker = "0x5555555555555555555555555555555555555555" as Address;
    const chainReader = new class extends MockChainReader {
      override async getFleetMissionVisibility(): Promise<never> {
        throw new Error("cached mission archive reads must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "100"
    });
    for (const missionId of [112n, 212n, 330n]) {
      for (const log of completedFleetMissionLogs({ missionId, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
        indexer.applyLog(log);
      }
    }
    for (const log of completedFleetMissionLogs({ missionId: 413n, missionTypeId: 3n, owner: attacker, originPlanetId: 9n, targetPlanetId: 7n })) {
      indexer.applyLog(log);
    }
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });

    const unfiltered = await handler(new Request(`http://localhost/wallet/${player}/missions?status=completed&page=1&pageSize=25`));
    const unfilteredBody = await unfiltered.json();
    const searched = await handler(new Request(`http://localhost/wallet/${player}/missions?status=completed&missionNumber=12&page=1&pageSize=25`));
    const searchedBody = await searched.json();
    const incoming = await handler(new Request(`http://localhost/wallet/${player}/missions?status=completed&filter=incomingAttacks&page=1&pageSize=25`));
    const incomingBody = await incoming.json();

    expect(unfiltered.status).toBe(200);
    expect(unfilteredBody.pagination.totalEntries).toBe(4);
    expect(searched.status).toBe(200);
    expect(searchedBody.rows.map((row: { mission: FleetMissionSummary }) => row.mission.missionId).sort()).toEqual(["112", "212"]);
    expect(incoming.status).toBe(200);
    expect(incomingBody.rows).toEqual([
      expect.objectContaining({
        mission: expect.objectContaining({
          missionId: "413",
          owner: attacker
        })
      })
    ]);
  });

  test("serves completed attack archive rows without rebuilding battle reports", async () => {
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
    const chainReader = new class extends MockChainReader {
      override async getFleetMissionVisibility(): Promise<never> {
        throw new Error("mission archive must not call chain reader");
      }
    }();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xhomeplanet",
      blockNumber: "100"
    });
    for (const log of completedFleetMissionLogs({ missionId: 77n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xbattleresolved-77",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(77n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 2n, 12345n, 75n, 25n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xcombatlosses-77",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(77n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/missions?status=completed&page=1&pageSize=1`));

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalEntries: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      kind: "mission",
      mission: {
        missionId: "77",
        status: "Returned"
      }
    });
    expect(body.rows[0].report).toBeUndefined();

    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");

    const materializedResponse = await createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    })(new Request(`http://localhost/wallet/${player}/missions?status=completed&page=1&pageSize=1`));

    const materializedBody = await materializedResponse.json();
    expect(materializedResponse.status).toBe(200);
    expect(materializedBody.rows[0]).toMatchObject({
      kind: "mission",
      mission: {
        missionId: "77",
        status: "Returned"
      },
      report: {
        missionId: "77",
        outcome: "AttackerWin",
        loot: { metal: "75", crystal: "25", deuterium: "0" },
        attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
        defenderLosses: { metal: "900", crystal: "250", deuterium: "0" }
      }
    });
  });

  test("global completed mission archive attaches materialized battle report summaries without raw decoding", async () => {
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xhomeplanet",
      blockNumber: "100"
    });
    for (const log of completedFleetMissionLogs({ missionId: 88n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
      indexer.applyLog(log);
    }
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader, indexer });

    const beforeReportResponse = await handler(new Request("http://localhost/missions?status=completed&page=1&pageSize=25"));
    const beforeReportBody = await beforeReportResponse.json();
    expect(beforeReportResponse.status).toBe(200);
    expect(beforeReportBody.rows[0]).toMatchObject({ kind: "mission", mission: { missionId: "88" } });
    expect(beforeReportBody.rows[0].report).toBeUndefined();

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xbattleresolved-88",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(88n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 2n, 12345n, 75n, 25n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xcombatlosses-88",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(88n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });

    const afterReportResponse = await handler(new Request("http://localhost/missions?status=completed&page=1&pageSize=25"));
    const afterReportBody = await afterReportResponse.json();
    expect(afterReportResponse.status).toBe(200);
    expect(afterReportBody.rows[0]).toMatchObject({ kind: "mission", mission: { missionId: "88" } });
    expect(afterReportBody.rows[0].report).toBeUndefined();

    indexer.materializeBattleReportReadModelsForWorker(["88"], "ingest");

    const afterMaterializedReportResponse = await handler(new Request("http://localhost/missions?status=completed&page=1&pageSize=25"));
    const afterMaterializedReportBody = await afterMaterializedReportResponse.json();
    expect(afterMaterializedReportResponse.status).toBe(200);
    expect(afterMaterializedReportBody.rows[0]).toMatchObject({
      kind: "mission",
      mission: { missionId: "88" },
      report: {
        missionId: "88",
        outcome: "AttackerWin",
        loot: { metal: "75", crystal: "25", deuterium: "0" },
        attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
        defenderLosses: { metal: "900", crystal: "250", deuterium: "0" }
      }
    });
  });

  test("serves universe-wide active missions from the indexed read model (all players, no wallet scope)", async () => {
    const otherPlayer = "0x5555555555555555555555555555555555555555" as Address;
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({ ...planet, eventName: "PlanetStarted", transactionHash: "0xabc", blockNumber: "100" });
    // One active mission from the connected wallet, one from a different wallet, and one already
    // completed (must be excluded from the active feed).
    for (const log of activeFleetMissionLogs({ missionId: 1n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) indexer.applyLog(log);
    for (const log of activeFleetMissionLogs({ missionId: 2n, owner: otherPlayer, originPlanetId: 9n, targetPlanetId: 7n })) indexer.applyLog(log);
    for (const log of completedFleetMissionLogs({ missionId: 3n, owner: otherPlayer, originPlanetId: 9n, targetPlanetId: 8n })) indexer.applyLog(log);

    const response = await createRequestHandler({ config: configuredTestConfig, chainReader, indexer })(
      new Request("http://localhost/missions?status=active")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const ids = body.missions.map((mission: { missionId: string }) => mission.missionId).sort();
    expect(ids).toEqual(["1", "2"]);
    // Universe-wide: missions from a wallet other than the connected one are present.
    expect(body.missions.some((mission: { owner: string }) => mission.owner.toLowerCase() === otherPlayer.toLowerCase())).toBe(true);
    expect(body.missions.every((mission: { status: string }) => mission.status === "Outbound")).toBe(true);
    // As-of-now derivation (VEY-KANEO-464): outbound missions arrive in the future, so
    // every active mission reports a positive ETA and neither leg is due yet.
    for (const mission of body.missions as Array<{ asOfNow: {
      secondsUntilArrival: number;
      secondsUntilReturn: number;
      arrived: boolean;
      returned: boolean;
    } }>) {
      expect(mission.asOfNow.arrived).toBe(false);
      expect(mission.asOfNow.returned).toBe(false);
      expect(mission.asOfNow.secondsUntilArrival).toBeGreaterThan(0);
      expect(mission.asOfNow.secondsUntilReturn).toBeGreaterThan(mission.asOfNow.secondsUntilArrival);
    }
  });

  test("serves paginated universe-wide completed mission archive (all players, no wallet scope)", async () => {
    const otherPlayer = "0x5555555555555555555555555555555555555555" as Address;
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({ ...planet, eventName: "PlanetStarted", transactionHash: "0xabc", blockNumber: "100" });
    // 26 completed missions split across two wallets so a global archive must page across both.
    for (let missionId = 1n; missionId <= 26n; missionId += 1n) {
      const owner = missionId % 2n === 0n ? otherPlayer : player;
      for (const log of completedFleetMissionLogs({ missionId, owner, originPlanetId: 7n, targetPlanetId: 8n })) indexer.applyLog(log);
    }

    const response = await createRequestHandler({ config: configuredTestConfig, chainReader, indexer })(
      new Request("http://localhost/missions?status=completed&page=2&pageSize=25")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wallet).toBeUndefined();
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 25,
      totalEntries: 26,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ kind: "mission", mission: { status: "Returned" } });
  });

  test("mission detail exposes the defender planet's indexed fleet/defenses composition (VEY-401)", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    // Defender's target planet (id 9) with a surviving fleet (Light Fighter id 1 x12) and defenses
    // (Gauss Cannon id 4 x3) tracked in the indexed read model.
    indexer.applyEvent({
      ...planet,
      planetId: "9",
      owner: attacker,
      eventName: "PlanetStarted",
      transactionHash: "0xtargetplanet",
      blockNumber: "100"
    });
    indexer.applyLog({
      blockNumber: "0x65",
      transactionHash: "0xshipcount",
      logIndex: "0x0",
      removed: false,
      topics: [planetShipCountChangedTopic, topic(9n), topic(1n)],
      data: abiWords(12n)
    });
    indexer.applyLog({
      blockNumber: "0x66",
      transactionHash: "0xdefensedone",
      logIndex: "0x0",
      removed: false,
      topics: [defenseCompletedTopic, topic(9n), topic(4n)],
      data: abiWords(3n, 3n)
    });
    // A resolved attack mission (id 1) against planet 9, plus its indexed battle report logs.
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 1n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattleresolved",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(1n), addressTopic(attacker), topic(9n)],
      data: abiWords(1n, 2n, 12345n, 100n, 50n, 10n)
    });
    indexer.applyLog({
      blockNumber: "0x71",
      transactionHash: "0xcombatlosses",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(1n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });
    indexer.materializeBattleReportReadModelsForWorker(["1"], "ingest");

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.battleReport).toMatchObject({ missionId: "1", targetPlanetId: "9" });
    expect(body.defenderPlanetState).toEqual({
      fleet: [{ id: 1, count: 12 }],
      defenses: [{ id: 4, count: 3 }],
      stationedDefenders: []
    });
  });

  test("refreshes cached mission detail when a resolved attack report is indexed", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyEvent({
      ...planet,
      planetId: "9",
      owner: attacker,
      eventName: "PlanetStarted",
      transactionHash: "0xtargetplanet",
      blockNumber: "100"
    });
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 89n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      enableResponseCache: true,
      indexer
    });

    const beforeReportResponse = await handler(new Request("http://localhost/mission/89"));
    const beforeReportBody = await beforeReportResponse.json();
    expect(beforeReportResponse.status).toBe(200);
    expect(beforeReportBody.mission).toMatchObject({ missionId: "89", status: "Outbound" });
    expect(beforeReportBody.battleReport).toBeNull();

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xbattleresolved-89",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(89n), addressTopic(attacker), topic(9n)],
      data: abiWords(1n, 2n, 12345n, 100n, 50n, 10n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xcombatlosses-89",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(89n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });
    indexer.materializeBattleReportReadModelsForWorker(["89"], "ingest");

    expect(indexer.battleReportMaterializationStatus("89")).toMatchObject({
      status: "ready",
      error: null
    });

    const afterReportResponse = await handler(new Request("http://localhost/mission/89"));
    const afterReportBody = await afterReportResponse.json();
    expect(afterReportResponse.status).toBe(200);
    expect(afterReportBody.battleReportMaterialization).toEqual({ status: "ready" });
    expect(afterReportBody.battleReport).toMatchObject({
      missionId: "89",
      outcome: "AttackerWin",
      loot: { metal: "100", crystal: "50", deuterium: "10" },
      attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
      defenderLosses: { metal: "900", crystal: "250", deuterium: "0" }
    });
  });

  test("non-combat mission detail skips battle report lookup on cold read", async () => {
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of completedFleetMissionLogs({ missionId: 6395n, missionTypeId: 0n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
      indexer.applyLog(log);
    }

    let battleReportCalls = 0;
    let materializationCalls = 0;
    indexer.battleReport = () => {
      battleReportCalls += 1;
      throw new Error("non-combat detail should not read battle reports");
    };
    indexer.battleReportMaterializationStatus = () => {
      materializationCalls += 1;
      throw new Error("non-combat detail should not read battle report materialization");
    };

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/6395"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mission).toMatchObject({ missionId: "6395", missionType: "Transport", status: "Returned" });
    expect(body.battleReport).toBeNull();
    expect(body.battleReportMaterialization).toEqual({ status: "missing" });
    expect(battleReportCalls).toBe(0);
    expect(materializationCalls).toBe(0);
  });

  test("combat mission detail does not raw-decode missing battle reports on request", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 90n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }

    const battleReportOptions: Array<{ includeRawFallback?: boolean } | undefined> = [];
    const originalBattleReport = indexer.battleReport.bind(indexer);
    indexer.battleReport = (missionId, options) => {
      battleReportOptions.push(options);
      if (options?.includeRawFallback !== false) {
        throw new Error("mission detail must not raw-decode battle reports on a cold read");
      }
      return originalBattleReport(missionId, options);
    };

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/90"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mission).toMatchObject({ missionId: "90", missionType: "Attack" });
    expect(body.battleReport).toBeNull();
    expect(body.battleReportMaterialization).toEqual({ status: "missing" });
    expect(battleReportOptions).toEqual([{ includeRawFallback: false }]);
  });

  test("mission detail reports divergent persisted battle report rows explicitly", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 92n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    (indexer as any).db.query(`
      INSERT INTO indexed_battle_report_read_models (
        mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
      )
      VALUES (?, 'ready', ?, NULL, 1, 4, '145', '2026-06-25T00:00:00.000Z')
    `).run("92", JSON.stringify({
      missionId: "999",
      participants: [],
      blockNumber: "145",
      targetPlanetId: "9"
    }));

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/92"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.battleReport).toBeNull();
    expect(body.battleReportMaterialization).toMatchObject({
      status: "failed",
      attempts: 1,
      durationMs: 4,
      error: "Persisted battle report read model did not match this mission."
    });
  });

  test("persists battle report read model asynchronously and resolves ACS participant ids after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-battle-report-read-model-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const participant = "0x4444444444444444444444444444444444444444" as Address;

    try {
      const writer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, { databasePath });
      await writer.rebuild();
      for (const log of activeFleetMissionLogs({ missionId: 500n, missionTypeId: 3n, owner: attacker, originPlanetId: 7n, targetPlanetId: 9n })) {
        writer.applyLog(log);
      }
      for (const log of activeFleetMissionLogs({ missionId: 501n, missionTypeId: 8n, owner: participant, originPlanetId: 8n, targetPlanetId: 9n })) {
        if (log.topics[0] === fleetMissionLaunchedTopic) {
          writer.applyLog({ ...log, data: abiWords(8n, 9n, 1_800_000_501n, 1_800_000_801n, 500n) });
        } else {
          writer.applyLog(log);
        }
      }

      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xbattleresolved-500",
        logIndex: "0x0",
        removed: false,
        topics: [attackBattleResolvedTopic, topic(500n), addressTopic(attacker), topic(9n)],
        data: abiWords(1n, 2n, 12345n, 100n, 50n, 10n)
      });

      expect(writer.battleReportMaterializationStatus("500")).toMatchObject({ status: "pending" });

      writer.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xcombatlosses-500",
        logIndex: "0x0",
        removed: false,
        topics: [combatLossesTopic, topic(500n)],
        data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
      });
      writer.materializeBattleReportReadModelsForWorker(["500"], "ingest");

      expect(writer.battleReportMaterializationStatus("500")).toMatchObject({ status: "ready" });
      expect(writer.battleReportMaterializationStatus("501")).toMatchObject({ status: "ready" });

      const reader = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, {
        databasePath,
        runStartupBackfill: false
      });
      const report = reader.battleReport("501", { includeRawFallback: false });

      expect(report).toMatchObject({
        missionId: "500",
        attackGroupId: "500",
        loot: { metal: "100", crystal: "50", deuterium: "10" }
      });
      expect(report?.participants.map((entry) => entry.missionId).sort()).toEqual(["500", "501"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("returns a fast explicit processing state while battle report materialization is pending", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 91n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xbattleresolved-91",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(91n), addressTopic(attacker), topic(9n)],
      data: abiWords(1n, 2n, 12345n, 100n, 50n, 10n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xcombatlosses-91",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(91n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });
    await indexer.drainBattleReportMaterializationQueue();
    (indexer as any).db.query(`
      UPDATE indexed_battle_report_read_models
      SET status = 'pending',
        report_json = NULL,
        error = NULL,
        attempts = 0,
        duration_ms = NULL,
        block_number = '145',
        updated_at = '2026-06-25T00:00:00.000Z'
      WHERE mission_id = '91'
    `).run();

    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    });
    const response = await handler(new Request("http://localhost/battle-report/91"));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      error: "battle_report_processing",
      materialization: { status: "pending" }
    });

    const missionResponse = await handler(new Request("http://localhost/mission/91"));
    const missionBody = await missionResponse.json();
    expect(missionResponse.status).toBe(200);
    expect(missionBody.battleReport).toBeNull();
    expect(missionBody.battleReportMaterialization).toMatchObject({ status: "pending" });
  });

  test("main backend only marks reports pending while separate generator materializes them", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 93n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xbattleresolved-93",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(93n), addressTopic(attacker), topic(9n)],
      data: abiWords(1n, 2n, 12345n, 100n, 50n, 10n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xcombatlosses-93",
      logIndex: "0x0",
      removed: false,
      topics: [combatLossesTopic, topic(93n)],
      data: abiWords(100n, 50n, 0n, 900n, 250n, 0n)
    });

    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    });
    const runtimeResponse = await resolvesWithin(handler(new Request("http://localhost/runtime-config")), 50);
    const missionResponse = await resolvesWithin(handler(new Request("http://localhost/mission/93")), 50);
    const missionBody = await missionResponse.json();

    expect(runtimeResponse.status).toBe(200);
    expect(missionResponse.status).toBe(200);
    expect(missionBody.mission).toMatchObject({ missionId: "93", missionType: "Attack" });
    expect(missionBody.battleReport).toBeNull();
    expect(missionBody.battleReportMaterialization).toMatchObject({ status: "pending" });
    expect(indexer.battleReport("93")).toBeNull();
    expect(indexer.pendingBattleReportMaterializationMissionIds()).toContain("93");

    expect(indexer.materializeBattleReportReadModelsForWorker(["93"], "ingest")).toBe(1);
    expect(indexer.battleReportMaterializationStatus("93")).toMatchObject({ status: "ready" });
    expect(indexer.battleReport("93")).toMatchObject({ missionId: "93", outcome: "AttackerWin" });
  });

  test("refreshes warmed shipyard and defense API caches after unit-count logs are indexed", async () => {
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xhomeplanet",
      blockNumber: "100"
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xship-count-before",
      logIndex: "0x0",
      removed: false,
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(5n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xdefense-count-before",
      logIndex: "0x1",
      removed: false,
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(3n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      enableResponseCache: true,
      indexer
    });

    const warmShipyard = await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`));
    const warmShipyardBody = await warmShipyard.json() as ShipyardState;
    expect(warmShipyardBody.ships.find((ship) => ship.id === 0)?.count).toBe(5);
    const warmDefenses = await handler(new Request(`http://localhost/wallet/${player}/defenses?planetId=7`));
    const warmDefensesBody = await warmDefenses.json() as DefenseState;
    expect(warmDefensesBody.defenses.find((defense) => defense.id === 1)?.count).toBe(3);

    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xship-count-after",
      logIndex: "0x0",
      removed: false,
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(0n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xdefense-count-after",
      logIndex: "0x1",
      removed: false,
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(4n)
    });

    const freshShipyard = await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`));
    const freshShipyardBody = await freshShipyard.json() as ShipyardState;
    expect(freshShipyardBody.ships.find((ship) => ship.id === 0)?.count).toBe(0);
    const freshDefenses = await handler(new Request(`http://localhost/wallet/${player}/defenses?planetId=7`));
    const freshDefensesBody = await freshDefenses.json() as DefenseState;
    expect(freshDefensesBody.defenses.find((defense) => defense.id === 1)?.count).toBe(4);
  });

  test("refreshes reader-worker cached mission detail after another process indexes resolved attack logs", async () => {
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
    const dir = mkdtempSync(join(tmpdir(), "veydrift-server-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const writer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, { databasePath });
      writer.applyEvent({
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xhomeplanet",
        blockNumber: "100"
      });
      for (const log of activeFleetMissionLogs({ missionId: 1777n, missionTypeId: 3n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
        writer.applyLog(log);
      }

      const reader = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, {
        databasePath,
        runStartupBackfill: false
      });
      const handler = createRequestHandler({
        config: configuredTestConfig,
        chainReader: new MockChainReader(),
        enableResponseCache: true,
        indexer: reader
      });

      const beforeReportResponse = await handler(new Request("http://localhost/mission/1777"));
      const beforeReportBody = await beforeReportResponse.json();
      expect(beforeReportResponse.status).toBe(200);
      expect(beforeReportBody.mission).toMatchObject({ missionId: "1777", status: "Outbound" });
      expect(beforeReportBody.battleReport).toBeNull();

      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xbattleresolved-1777",
        logIndex: "0x0",
        removed: false,
        topics: [attackBattleResolvedTopic, topic(1777n), addressTopic(player), topic(8n)],
        data: abiWords(1n, 2n, 12345n, 3098n, 1448n, 454n)
      });
      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xbattleresolved-1777",
        logIndex: "0x1",
        removed: false,
        topics: [combatLossesTopic, topic(1777n)],
        data: abiWords(0n, 0n, 0n, 0n, 0n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xreturn-1777",
        logIndex: "0x0",
        removed: false,
        topics: [fleetMissionReturnExposedTopic, topic(1777n), addressTopic(player), topic(4n)],
        data: abiWords(7n, 8n, 1_800_000_300n + 1777n, 3098n, 1448n, 454n)
      });
      writer.applyLog({
        blockNumber: "0x92",
        transactionHash: "0xreturn-1777",
        logIndex: "0x1",
        removed: false,
        topics: [fleetMissionReturnedTopic, topic(1777n), addressTopic(player), topic(7n)],
        data: "0x"
      });
      writer.materializeBattleReportReadModelsForWorker(["1777"], "ingest");

      const afterReportResponse = await handler(new Request("http://localhost/mission/1777"));
      const afterReportBody = await afterReportResponse.json();
      expect(afterReportResponse.status).toBe(200);
      expect(afterReportBody.mission).toMatchObject({
        missionId: "1777",
        status: "Returned",
        returnCargo: { metal: "3098", crystal: "1448", deuterium: "454" },
        transactionHash: "0xreturn-1777"
      });
      expect(afterReportBody.battleReport).toMatchObject({
        missionId: "1777",
        loot: { metal: "3098", crystal: "1448", deuterium: "454" }
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("mission detail battle report carries historical battle-time defender composition instead of current defenses", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyEvent({
      ...planet,
      planetId: "92",
      owner: attacker,
      eventName: "PlanetStarted",
      transactionHash: "0xtargetplanet",
      blockNumber: "100"
    });
    indexer.applyLog({
      blockNumber: "0x66",
      transactionHash: "0xdefense-before-battle",
      logIndex: "0x0",
      removed: false,
      topics: [planetDefenseCountChangedTopic, topic(92n), topic(0n)],
      data: abiWords(37n)
    });
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 1240n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 92n
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattle-1240",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(1240n), addressTopic(attacker), topic(92n)],
      data: abiWords(2n, 4n, 12345n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattle-1240",
      logIndex: "0x1",
      removed: false,
      topics: [combatRoundResolvedTopic, topic(1240n), topic(1n)],
      data: abiWords(16n, 37n, 17_000n, 7_000n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattle-1240",
      logIndex: "0x2",
      removed: false,
      topics: [planetDefenseCountChangedTopic, topic(92n), topic(0n)],
      data: abiWords(4n)
    });
    indexer.materializeBattleReportReadModelsForWorker(["1240"], "ingest");

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/1240"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.battleReport.defenderSnapshot).toEqual({
      fleet: [],
      defenses: [{ id: 0, count: 37 }]
    });
    expect(body.battleReport.roundReports[0].defenderUnits).toBe("37");
    expect(body.defenderPlanetState).toEqual({
      fleet: [],
      defenses: [{ id: 0, count: 4 }],
      stationedDefenders: []
    });
  });

  test("battle report snapshots update when historical unit-count logs arrive after the report cache is warm", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of completedFleetMissionLogs({ missionId: 1241n, owner: attacker, originPlanetId: 7n, targetPlanetId: 92n })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattle-1241",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(1241n), addressTopic(attacker), topic(92n)],
      data: abiWords(2n, 4n, 12345n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattle-1241",
      logIndex: "0x1",
      removed: false,
      topics: [combatRoundResolvedTopic, topic(1241n), topic(1n)],
      data: abiWords(16n, 37n, 17_000n, 7_000n, 0n, 0n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["1241"], "ingest");
    expect(indexer.battleReport("1241")?.defenderSnapshot).toBeNull();

    indexer.applyLog({
      blockNumber: "0x66",
      transactionHash: "0xlate-historical-defense-before-battle",
      logIndex: "0x0",
      removed: false,
      topics: [planetDefenseCountChangedTopic, topic(92n), topic(0n)],
      data: abiWords(37n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["1241"], "repair");
    expect(indexer.battleReport("1241")?.defenderSnapshot).toEqual({
      fleet: [],
      defenses: [{ id: 0, count: 37 }]
    });
  });

  test("battle report endpoint distinguishes returned recalled attacks from missing indexed reports", async () => {
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();

    const missionId = 1692n;
    const arrivalAt = 1_800_010_000n;
    const recallReturnAt = arrivalAt - 600n;
    for (const log of activeFleetMissionLogs({
      missionId,
      missionTypeId: 3n,
      owner: player,
      originPlanetId: 7n,
      targetPlanetId: 9n,
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionRecalledTopic, topic(missionId), addressTopic(player)],
      data: abiWords(recallReturnAt, 695n),
      logIndex: Number(missionId * 10n + 3n),
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionReturnedTopic, topic(missionId), addressTopic(player), topic(7n)],
      data: "0x",
      logIndex: Number(missionId * 10n + 4n),
    }));

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/battle-report/1692"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: "battle_report_not_expected",
      mission: {
        missionId: "1692",
        missionType: "Attack",
        status: "Returned",
        recallCost: "695"
      }
    });
    expect(body.detail).not.toContain("catches up");
  });

  test("lightweight fleet visibility keeps active attack battle reports for Mission Control cards", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyEvent({ ...planet, eventName: "PlanetStarted", transactionHash: "0xhomeplanet", blockNumber: "100" });
    indexer.applyEvent({ ...planet, eventName: "PlanetStarted", planetId: "9", owner: attacker, transactionHash: "0xtargetplanet", blockNumber: "101" });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xactive-attack",
      logIndex: "0x0",
      removed: false,
      topics: [fleetMissionLaunchedTopic, topic(1154n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 9n, 1_800_000_000n, 1_800_000_600n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xactive-attack",
      logIndex: "0x1",
      removed: false,
      topics: [fleetMissionCargoTopic, topic(1154n)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xactive-attack",
      logIndex: "0x2",
      removed: false,
      topics: [fleetMissionShipsTopic, topic(1154n)],
      data: abiWords(...Array.from({ length: 14 }, (_, index) => index === 0 ? 1n : 0n))
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xreturning-attack",
      logIndex: "0x0",
      removed: false,
      topics: [fleetMissionReturnExposedTopic, topic(1154n), addressTopic(player), topic(2n)],
      data: abiWords(7n, 9n, 1_800_000_600n, 75n, 25n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xbattleresolved-active",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(1154n), addressTopic(player), topic(9n)],
      data: abiWords(1n, 2n, 12345n, 75n, 25n, 0n)
    });

    for (const log of completedFleetMissionLogs({ missionId: 2000n, owner: player, originPlanetId: 7n, targetPlanetId: 9n })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xbattleresolved-completed",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(2000n), addressTopic(player), topic(9n)],
      data: abiWords(1n, 1n, 54321n, 5n, 0n, 0n)
    });
    indexer.materializeBattleReportReadModelsForWorker(["1154"], "ingest");

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request(`http://localhost/wallet/${player}/fleet-visibility?archive=none`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.returning.map((mission: FleetMissionSummary) => mission.missionId)).toContain("1154");
    expect(body.completedMissions).toEqual([]);
    expect(body.battleReports.map((report: BattleReport) => report.missionId)).toEqual(["1154"]);
    expect(body.battleReports[0].loot).toEqual({ metal: "75", crystal: "25", deuterium: "0" });
  });

  test("mission detail exposes target combat intel before a battle report exists (VEY-KANEO-516)", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const otherAttacker = "0x5555555555555555555555555555555555555555" as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyEvent({
      ...planet,
      planetId: "9",
      owner: defender,
      eventName: "PlanetStarted",
      transactionHash: "0xtargetplanet",
      blockNumber: "100"
    });
    indexer.applyLog({
      blockNumber: "0x65",
      transactionHash: "0xshipcount",
      logIndex: "0x0",
      removed: false,
      topics: [planetShipCountChangedTopic, topic(9n), topic(1n)],
      data: abiWords(12n)
    });
    indexer.applyLog({
      blockNumber: "0x66",
      transactionHash: "0xdefensedone",
      logIndex: "0x0",
      removed: false,
      topics: [defenseCompletedTopic, topic(9n), topic(4n)],
      data: abiWords(3n, 3n)
    });
    indexer.applyLog({
      blockNumber: "0x67",
      transactionHash: "0xdefensequeued",
      logIndex: "0x0",
      removed: false,
      topics: [defenseQueuedTopic, topic(9n), topic(4n)],
      data: abiWords(2n, 1_800_000_400n, 9000n, 3000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x68",
      transactionHash: "0xshipqueued",
      logIndex: "0x0",
      removed: false,
      topics: [shipQueuedTopic, topic(9n), topic(1n)],
      data: abiWords(4n, 1_800_000_500n, 12000n, 4000n, 0n)
    });
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(51n), addressTopic(attacker), topic(3n)],
      data: abiWords(7n, 9n, 1_800_000_000n, 1_800_000_300n),
      logIndex: 510
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionCargoTopic, topic(51n)],
      data: abiWords(0n, 0n, 0n, 1n),
      logIndex: 511
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionShipsTopic, topic(51n)],
      data: abiWords(...Array.from({ length: 14 }, (_, index) => index === 1 ? 5n : 0n)),
      logIndex: 512
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(52n), addressTopic(otherAttacker), topic(3n)],
      data: abiWords(7n, 9n, 1_800_000_100n, 1_800_000_400n),
      logIndex: 520
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionCargoTopic, topic(52n)],
      data: abiWords(0n, 0n, 0n, 1n),
      logIndex: 521
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionShipsTopic, topic(52n)],
      data: abiWords(...Array.from({ length: 14 }, (_, index) => index === 0 ? 3n : 0n)),
      logIndex: 522
    }));

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/51"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.battleReport).toBeNull();
    const targetCombatIntel = body.targetCombatIntel;
    expect(BigInt(targetCombatIntel.combatPower)).toBeGreaterThan(0n);
    expect(targetCombatIntel.activeMissions.map((entry: { missionId: string }) => entry.missionId).sort()).toEqual(["51", "52"]);
    expect(targetCombatIntel).toMatchObject({
      planetId: "9",
      combatPower: expect.any(String),
      combatShips: {
        count: 12,
        power: expect.any(String),
        units: [expect.objectContaining({ id: 1, count: 12, power: expect.any(String) })]
      },
      defenses: {
        count: 3,
        power: expect.any(String),
        units: [expect.objectContaining({ id: 4, count: 3, power: expect.any(String) })]
      },
      activeMissions: expect.arrayContaining([
        expect.objectContaining({ missionId: "51", owner: attacker, targetPlanetId: "9" }),
        expect.objectContaining({ missionId: "52", owner: otherAttacker, targetPlanetId: "9" })
      ]),
      queues: {
        defense: expect.objectContaining({
          active: true,
          itemId: 4,
          quantity: 2,
          readyAt: "1800000400"
        }),
        ship: expect.objectContaining({
          active: true,
          itemId: 1,
          quantity: 4,
          readyAt: "1800000500"
        })
      }
    });
    expect(body.defenderPlanetState).toBeNull();
  });

  test("mission detail exposes battle-time DefenseHold defenders when planet fleet and defenses are zero (VEY-498)", async () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
    const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    indexer.applyEvent({
      ...planet,
      planetId: "9",
      owner: attacker,
      eventName: "PlanetStarted",
      transactionHash: "0xtargetplanet",
      blockNumber: "100"
    });
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_700_000_000n,
      missionId: 1n,
      missionTypeId: 3n,
      owner: attacker,
      originPlanetId: 7n,
      targetPlanetId: 9n
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(41n), addressTopic(defender), topic(9n)],
      data: abiWords(12n, 9n, 1_700_000_000n, 1_700_000_600n, 0n),
      logIndex: 411
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionCargoTopic, topic(41n)],
      data: abiWords(0n, 0n, 0n, 1n),
      logIndex: 412
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionShipsTopic, topic(41n)],
      data: abiWords(0n, 15n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n),
      logIndex: 413
    }));
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xbattleresolved",
      logIndex: "0x0",
      removed: false,
      topics: [attackBattleResolvedTopic, topic(1n), addressTopic(attacker), topic(9n)],
      data: abiWords(1n, 1n, 12345n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x71",
      transactionHash: "0xcombatround",
      logIndex: "0x0",
      removed: false,
      topics: [combatRoundResolvedTopic, topic(1n), topic(1n)],
      data: abiWords(0n, 15n, 9000n, 7000n, 0n, 0n)
    });
    indexer.materializeBattleReportReadModelsForWorker(["1"], "ingest");

    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      indexer
    })(new Request("http://localhost/mission/1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.defenderPlanetState.fleet).toEqual([]);
    expect(body.defenderPlanetState.defenses).toEqual([]);
    expect(body.defenderPlanetState.stationedDefenders).toEqual([
      expect.objectContaining({
        missionId: "41",
        defender,
        ships: expect.objectContaining({ lightFighter: "15" }),
        holdUntil: "1700000600"
      })
    ]);
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
    expect(occupied).not.toHaveProperty("publicState");
    expect(occupied).not.toHaveProperty("publicMoonState");
  });

  test("memoizes galaxy system payloads until indexed state changes", async () => {
    const chainReader = new MockChainReader();
    const indexer = new class extends SettlementIndexer {
      systemReads = 0;

      override settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
        this.systemReads += 1;
        return super.settledPlanetsInSystem(galaxy, system);
      }
    }(chainReader, configuredTestConfig.indexFromBlock);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const firstResponse = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const secondResponse = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(indexer.systemReads).toBe(1);
    expect(secondBody).toEqual(firstBody);

    indexer.applyEvent({
      ...planet,
      planetId: "8",
      galaxy: 3,
      system: 45,
      position: 1,
      eventName: "PlanetStarted",
      transactionHash: "0xother-system",
      blockNumber: "122"
    });

    const unrelatedChangeResponse = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const unrelatedChangeBody = await unrelatedChangeResponse.json();

    expect(unrelatedChangeResponse.status).toBe(200);
    expect(indexer.systemReads).toBe(1);
    expect(unrelatedChangeBody).toEqual(firstBody);

    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });

    const changedResponse = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const changedBody = await changedResponse.json();
    const occupied = changedBody.planets.find((item: { position: number }) => item.position === 9);

    expect(indexer.systemReads).toBe(2);
    expect(occupied.occupiedBy).toMatchObject({
      owner: player,
      planetId: "7"
    });
  });

  test("keeps cached galaxy system summary and full responses separate", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xsummary-full-cache",
      blockNumber: "123"
    });

    const requestBodies = async (firstUrl: string, secondUrl: string) => {
      const handler = createRequestHandler({
        config: configuredTestConfig,
        chainReader,
        enableResponseCache: true,
        indexer,
        sharedResponseCache: null
      });
      const first = await (await handler(new Request(firstUrl))).json();
      const second = await (await handler(new Request(secondUrl))).json();
      return [first, second] as const;
    };
    const summaryUrl = "http://localhost/universe/galaxies/2/systems/44";
    const fullUrl = `${summaryUrl}?detail=full`;

    const [summaryFirst, fullSecond] = await requestBodies(summaryUrl, fullUrl);
    const summaryOccupied = summaryFirst.planets.find((item: { position: number }) => item.position === 9);
    const fullOccupied = fullSecond.planets.find((item: { position: number }) => item.position === 9);

    expect(summaryOccupied).not.toHaveProperty("publicState");
    expect(summaryOccupied).not.toHaveProperty("publicMoonState");
    expect(fullOccupied).toHaveProperty("publicState");
    expect(fullOccupied).toHaveProperty("publicMoonState");

    const [fullFirst, summarySecond] = await requestBodies(fullUrl, summaryUrl);
    const fullFirstOccupied = fullFirst.planets.find((item: { position: number }) => item.position === 9);
    const summarySecondOccupied = summarySecond.planets.find((item: { position: number }) => item.position === 9);

    expect(fullFirstOccupied).toHaveProperty("publicState");
    expect(fullFirstOccupied).toHaveProperty("publicMoonState");
    expect(summarySecondOccupied).not.toHaveProperty("publicState");
    expect(summarySecondOccupied).not.toHaveProperty("publicMoonState");
  });

  test("serves galaxy system summaries when materialized snapshot writes are unavailable", async () => {
    const chainReader = new MockChainReader();
    const indexer = new class extends SettlementIndexer {
      override storeMaterializedUniverseSystemSnapshot(): void {
        throw new Error("attempt to write a readonly database");
      }
    }(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xsummary-readonly-cache",
      blockNumber: "123"
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request("http://localhost/universe/galaxies/2/systems/44"));
    const body = await response.json();
    const occupied = body.planets.find((item: { position: number }) => item.position === 9);

    expect(response.status).toBe(200);
    expect(occupied.occupiedBy).toMatchObject({
      owner: player,
      planetId: "7"
    });
    expect(occupied).not.toHaveProperty("publicState");
    expect(occupied).not.toHaveProperty("publicMoonState");
  });

  test("persists watched planets and lists them paginated from indexed state", async () => {
    const watcher = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
    const watcherWallet = watcher.address as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      owner: watcherWallet,
      eventName: "PlanetStarted",
      transactionHash: "0xhome",
      blockNumber: "123"
    });
    indexer.applyEvent({
      ...planet,
      planetId: "8",
      owner: defender,
      position: 10,
      eventName: "PlanetStarted",
      transactionHash: "0xwatched8",
      blockNumber: "124"
    });
    indexer.applyEvent({
      ...planet,
      planetId: "9",
      owner: defender,
      position: 11,
      eventName: "PlanetStarted",
      transactionHash: "0xwatched9",
      blockNumber: "125"
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });
    const watchEightSignature = await watcher.signMessage({ message: watchedPlanetMessage(watcherWallet, "watch", "8") });
    const watchNineSignature = await watcher.signMessage({ message: watchedPlanetMessage(watcherWallet, "watch", "9") });

    const watchEight = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`, {
      method: "POST",
      body: JSON.stringify({ planetId: "8", signature: watchEightSignature }),
      headers: { "content-type": "application/json" }
    }));
    const watchNine = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`, {
      method: "POST",
      body: JSON.stringify({ planetId: "9", signature: watchNineSignature }),
      headers: { "content-type": "application/json" }
    }));
    const pageOne = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets?page=1&pageSize=1`));
    const body = await pageOne.json();

    expect(watchEight.status).toBe(200);
    expect(watchNine.status).toBe(200);
    expect(pageOne.status).toBe(200);
    expect(body.watchedPlanetIds).toEqual(["8", "9"]);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(body.planets).toHaveLength(1);
    expect(body.planets[0]).toMatchObject({
      position: 10,
      occupiedBy: {
        owner: defender,
        planetId: "8"
      }
    });
  });

  test("unwatches planets and rejects watching own planets", async () => {
    const watcher = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
    const watcherWallet = watcher.address as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      owner: watcherWallet,
      eventName: "PlanetStarted",
      transactionHash: "0xhome",
      blockNumber: "123"
    });
    indexer.applyEvent({
      ...planet,
      planetId: "8",
      owner: defender,
      position: 10,
      eventName: "PlanetStarted",
      transactionHash: "0xwatched8",
      blockNumber: "124"
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });
    const ownSignature = await watcher.signMessage({ message: watchedPlanetMessage(watcherWallet, "watch", planet.planetId) });
    const watchSignature = await watcher.signMessage({ message: watchedPlanetMessage(watcherWallet, "watch", "8") });
    const unwatchSignature = await watcher.signMessage({ message: watchedPlanetMessage(watcherWallet, "unwatch", "8") });

    const ownWatch = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`, {
      method: "POST",
      body: JSON.stringify({ planetId: planet.planetId, signature: ownSignature }),
      headers: { "content-type": "application/json" }
    }));
    const watch = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`, {
      method: "POST",
      body: JSON.stringify({ planetId: "8", signature: watchSignature }),
      headers: { "content-type": "application/json" }
    }));
    const unwatch = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets/8`, {
      method: "DELETE",
      body: JSON.stringify({ signature: unwatchSignature }),
      headers: { "content-type": "application/json" }
    }));
    const list = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`));
    const body = await list.json();

    expect(ownWatch.status).toBe(400);
    expect(watch.status).toBe(200);
    expect(unwatch.status).toBe(200);
    expect(await unwatch.json()).toMatchObject({ watched: false, watchedPlanetIds: [] });
    expect(body.watchedPlanetIds).toEqual([]);
    expect(body.planets).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  test("rejects watched planet mutations signed by another wallet", async () => {
    const watcher = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
    const attacker = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
    const watcherWallet = watcher.address as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      owner: watcherWallet,
      eventName: "PlanetStarted",
      transactionHash: "0xhome",
      blockNumber: "123"
    });
    indexer.applyEvent({
      ...planet,
      planetId: "8",
      owner: defender,
      position: 10,
      eventName: "PlanetStarted",
      transactionHash: "0xwatched8",
      blockNumber: "124"
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });
    const wrongSignature = await attacker.signMessage({ message: watchedPlanetMessage(watcherWallet, "watch", "8") });

    const watch = await handler(new Request(`http://localhost/wallet/${watcherWallet}/watched-planets`, {
      method: "POST",
      body: JSON.stringify({ planetId: "8", signature: wrongSignature }),
      headers: { "content-type": "application/json" }
    }));
    const body = await watch.json();

    expect(watch.status).toBe(401);
    expect(body).toMatchObject({ error: "invalid_signature" });
    expect(indexer.watchedPlanetIds(watcherWallet)).toEqual([]);
  });

  test("serves contract-aligned unoccupied planet preview traits", async () => {
    const response = await createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader()
    })(new Request("http://localhost/universe/galaxies/6/systems/439"));
    const body = await response.json();
    const unoccupied = body.planets.find((item: { position: number }) => item.position === 5);

    expect(response.status).toBe(200);
    expect(unoccupied).toMatchObject({
      galaxy: 6,
      system: 439,
      position: 5,
      fields: 176,
      temperature: 26,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 12_280,
      archetype: "warm-terracotta",
      occupiedBy: null
    });
    expect(unoccupied).not.toMatchObject({
      fields: 237,
      temperature: 63,
      archetype: "scorching-molten"
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
              metal: "2500",
              crystal: "2450",
              deuterium: "2400"
            },
            raidableResourceTotal: "7350",
            ships: {
              count: 2,
              power: expect.any(String),
              units: expect.any(Array)
            },
            defenses: {
              count: 4,
              power: expect.any(String),
              units: expect.any(Array)
            },
            combatShips: expect.objectContaining({
              count: expect.any(Number),
              power: expect.any(String),
              units: expect.any(Array)
            }),
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

  test("logs healthy indexed misses as missing rows, not global readiness failures", async () => {
    const indexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const missingWallet = "0x9999999999999999999999999999999999999999" as Address;
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const response = await createRequestHandler({
        config: configuredTestConfig,
        chainReader: new MockChainReader(),
        indexer
      })(new Request(`http://localhost/wallet/${missingWallet}/shipyard`));
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        error: "indexed_read_not_ready",
        reason: "missing_indexed_row",
        lookup: { wallet: missingWallet },
        source: "contract-state-indexer"
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toBe("Frontend indexed read missing indexed row");
    expect(warnings[0]?.[1]).toMatchObject({
      surface: "shipyard",
      reason: "missing_indexed_row",
      lookup: { wallet: missingWallet },
      indexer: {
        indexedState: "healthy",
        safeToServeIndexedState: true
      }
    });
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
      chainReader: withoutIndexLists(new class extends MockChainReader {
        override async getMoonState(): Promise<MoonState> {
          throw new Error("frontend moon reads must not call chain reader");
        }
      }()),
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

  // VEY-KANEO-489: build a warm two-planet indexer (planet 7 -> player, planet 8 -> attacker) so the
  // single-target /attack-protection read derives both scores from indexed defenses.
  async function twoPlanetIndexer(attacker: Address): Promise<SettlementIndexer> {
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => [
      { ...planet, eventName: "PlanetStarted", planetId: "7", owner: player, transactionHash: "0xabc1", blockNumber: "123" },
      { ...planet, eventName: "PlanetStarted", planetId: "8", owner: attacker, transactionHash: "0xabc2", blockNumber: "124" }
    ];
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    return indexer;
  }

  test("indexed attack protection no longer score-protects two veterans past the newbie ceiling (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    // Attacker ~700k score, defender ~8M score (defense unit value 2,000 / 1,000-point divisor). Both are
    // past the 500k newbie-protection ceiling, so the contract's newbie/score-ratio gate never protects
    // them. The old 5x-score heuristic false-blocked them because 8M > 700k * 5.
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 4_000_000n, logIndex: 2 }));
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      transportAllowed: false,
      transportBlockReason: "not_allied",
      transportBlockReasonLabel:
        "Transport blocked: target must be one of your planets."
    });
  });

  test("indexed attack protection score-protects low-score targets using raw contract score in the 1.5x band (VEY-KANEO-489)", async () => {
    const attacker = "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    // Telegram #11745 reproduced the live boundary shape: contract score protection blocked an attacker
    // over 1.5x the defender score, while the backend highscore preview is not the source of truth
    // for this contract-side check.
    // Use low-cost tech id 14 to raise the contract-parity _totalUserScore just over the defender's
    // 1.5x low-score threshold while keeping display score.total distinct from the defender's display
    // threshold. A regression back to display-score comparison would allow.
    indexer.applyLog(researchCompletedLog({
      owner: attacker,
      technologyId: 14n,
      level: 34n,
      logIndex: 1
    }));
    // Defender raw score stays low; the derived fixture lands in the 1.5x newbie-protection band.
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 335n, logIndex: 2 }));
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const directResponse = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const directBody = await directResponse.json();
    const rankingsResponse = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const rankingsBody = await rankingsResponse.json();

    const attackerScore = indexer.highscoreForWallet(attacker);
    const defenderScore = indexer.highscoreForWallet(player);
    expect(BigInt(attackerScore.totalUserScore) * 2n).toBeGreaterThan(BigInt(defenderScore.totalUserScore) * 3n);
    expect(directResponse.status).toBe(200);
    expect(directBody).toMatchObject({
      allowed: false,
      blockedReason: "score_protection",
      blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      defenderInactive: false,
      relation: "weaker",
      scoreComparison: {
        scoreType: "contract_total_user_score",
        attackerScore: attackerScore.totalUserScore,
        defenderScore: defenderScore.totalUserScore,
        attackerVisibleScore: attackerScore.score.total,
        defenderVisibleScore: defenderScore.score.total,
        protected: true
      }
    });
    expect(rankingsResponse.status).toBe(200);
    const rankedDefender = rankingsBody.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player) as (HighscoreEntry & {
      attackProtection?: Partial<AttackProtectionStatus>;
    }) | undefined;
    expect(rankedDefender?.attackProtection).toMatchObject({
      allowed: false,
      blockedReason: "score_protection",
      blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      defenderInactive: false,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        attackerScore: attackerScore.totalUserScore,
        defenderScore: rankedDefender?.totalUserScore,
        attackerVisibleScore: attackerScore.score.total,
        defenderVisibleScore: rankedDefender?.score.total,
        protected: true
      }
    });
  });

  test("indexed attack protection reports bashing_limit after six attacks in the 24h window (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    // Equal ~700k scores (both veterans) so score protection does not apply and bashing can be observed.
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 350_000n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (let index = 0; index < 6; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 3_600 + index,
        logIndex: 100 + index,
      }));
    }
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      allowed: false,
      blockedReason: "bashing_limit",
      blockedReasonLabel: "Attack blocked: bashing limit reached for this attacker, defender, and planet in the current 24-hour window."
    });
  });

  test("indexed attack protection allows the attack below the bashing cap (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 350_000n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (let index = 0; index < 5; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 3_600 + index,
        logIndex: 100 + index,
      }));
    }
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ allowed: true, blockedReason: "none" });
  });

  test("indexed attack protection ignores attacks older than the 24h bashing window (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 350_000n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    // Six attacks, but the whole cluster is older than 24h, so the window has lapsed and the live count is 0.
    for (let index = 0; index < 6; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 90_000 + index,
        logIndex: 100 + index,
      }));
    }
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ allowed: true, blockedReason: "none" });
  });

  test("indexed attack protection reports same_alliance for an ally target, ahead of bashing_limit (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    // Equal veteran scores so score protection does not apply, and six attacks in the window so
    // bashing_limit WOULD fire — proving same_alliance short-circuits first, matching the contract
    // precedence (SameAlliance -> ScoreProtection -> BashingLimit).
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 350_000n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (let index = 0; index < 6; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 3_600 + index,
        logIndex: 100 + index,
      }));
    }
    // Put both the attacker and the defender (player, owner of planet 7) into alliance 1.
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xally-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
      data: abiStrings("VEY", "Veydrift Command")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xally-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      blockTimestamp: "0x69801c82",
      transactionHash: "0xally-member",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(attacker)],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      allowed: false,
      blockedReason: "same_alliance",
      blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
      transportAllowed: false,
      transportBlockReason: "not_allied",
      transportBlockReasonLabel: "Transport blocked: target must be one of your planets."
    });
  });

  test("indexed attack protection reports active war and bypasses score/bashing gates", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 1n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (let index = 0; index < 6; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 3_600 + index,
        logIndex: 100 + index,
      }));
    }
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xattacker-alliance-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(attacker)],
      data: abiStrings("ATK", "Attackers")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xattacker-alliance-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(attacker)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      blockTimestamp: "0x69801c82",
      transactionHash: "0xdefender-alliance-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(2n), addressTopic(player)],
      data: abiStrings("DEF", "Defenders")
    });
    indexer.applyLog({
      blockNumber: "0x93",
      blockTimestamp: "0x69801c83",
      transactionHash: "0xdefender-alliance-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(2n), addressTopic(player)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      blockTimestamp: "0x69801c84",
      transactionHash: "0xalliance-war",
      logIndex: "0x0",
      topics: [allianceDiplomacyUpdatedTopic, topic(1n), topic(2n)],
      data: abiWords(3n)
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      allowed: true,
      atWar: true,
      blockedReason: "none",
      targetAlliance: { allianceId: "2", tag: "DEF", name: "Defenders" }
    });

    const highscores = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const highscoreBody = await highscores.json();
    expect(highscoreBody.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toMatchObject({
      allowed: true,
      atWar: true,
      blockedReason: "none",
      targetAlliance: { allianceId: "2", tag: "DEF", name: "Defenders" }
    });
  });

  test("indexed highscore rankings report bashing_limit per planet (VEY-KANEO-489)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    // Equal veteran scores so neither score protection nor same-alliance applies; bashing is the gate.
    indexer.applyLog(defenseCompletedLog({ planetId: 8n, defenseId: 0n, total: 350_000n, logIndex: 1 }));
    indexer.applyLog(defenseCompletedLog({ planetId: 7n, defenseId: 0n, total: 350_000n, logIndex: 2 }));
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (let index = 0; index < 6; index++) {
      indexer.applyLog(attackLaunchLog({
        missionId: BigInt(index + 1),
        attacker,
        targetPlanetId: 7n,
        blockTimestampSeconds: nowSeconds - 3_600 + index,
        logIndex: 100 + index,
      }));
    }
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toMatchObject({
      allowed: false,
      blockedReason: "bashing_limit",
      blockedReasonLabel: "Attack blocked: bashing limit reached for this attacker, defender, and planet in the current 24-hour window.",
      defenderInactive: false,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        protected: false
      }
    });
  });

  test("indexed attack protection marks inactive defenders from indexed player activity (VEY-KANEO-500)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    indexer.applyLog(defenseCompletedLog({
      planetId: 7n,
      defenseId: 0n,
      total: 10n,
      blockTimestampSeconds: Math.floor(Date.now() / 1_000) - (8 * 24 * 60 * 60),
      logIndex: 1
    }));
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/wallet/${attacker}/attack-protection?targetPlanetId=7`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive: true
    });
  });

  test("indexed highscore rankings report defenderInactive from indexed player activity (VEY-KANEO-500)", async () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const indexer = await twoPlanetIndexer(attacker);
    indexer.applyLog(defenseCompletedLog({
      planetId: 7n,
      defenseId: 0n,
      total: 10n,
      blockTimestampSeconds: Math.floor(Date.now() / 1_000) - (8 * 24 * 60 * 60),
      logIndex: 1
    }));
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader: new MockChainReader(), indexer });

    const response = await handler(new Request(`http://localhost/highscores?limit=10&currentWallet=${attacker}&includeAttackProtection=true`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toMatchObject({
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive: true,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        protected: false
      }
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
        { allianceId: "1", requester: applicant, requesterTotalScore: "0", requestedAt: "1770003000" }
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
        if (method === "eth_blockNumber") {
          return "0x200" as T;
        }
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
            || call.data.startsWith("0xd0b044c5")
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
        if (method === "eth_blockNumber") {
          return "0x200" as T;
        }
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
            || call.data.startsWith("0xd0b044c5")
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
        if (method === "eth_blockNumber") {
          return "0x200" as T;
        }
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
            || call.data.startsWith("0xd0b044c5")
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
        if (method === "eth_blockNumber") {
          return "0x200" as T;
        }
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
        if (call.to === configuredTestConfig.gameContractAddress && call.data.startsWith("0xd0b044c5")) {
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

    // The POST /index/rebuild route was removed (HTTP requests must never trigger an RPC read under the
    // canonical-mirror contract); seed the index by calling explicit rebuild directly instead.
    await expect(indexer.rebuild()).resolves.toMatchObject({
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
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const now = BigInt(Math.floor(Date.now() / 1_000));
    indexer.applyLog(fleetMissionLog({
      topics: [defenseHoldStationedTopic, topic(42n), addressTopic(defender), topic(7n)],
      data: abiWords(12n, now - 60n, now + 3_600n, now + 7_200n),
      logIndex: 420
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(42n), addressTopic(defender), topic(9n)],
      data: abiWords(12n, 7n, now - 60n, now + 7_200n, 0n),
      logIndex: 421
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionCargoTopic, topic(42n)],
      data: abiWords(0n, 0n, 0n, 1n),
      logIndex: 422
    }));
    indexer.applyLog(fleetMissionLog({
      topics: [fleetMissionShipsTopic, topic(42n)],
      data: abiWords(0n, 15n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n),
      logIndex: 423
    }));
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmoon-public-system",
      logIndex: "0x0",
      topics: [
        moonCreatedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xmoonresources-public-system",
      logIndex: "0x0",
      topics: [moonResourcesSettledTopic, topic(7n)],
      data: abiWords(7386n, 2472n, 1335n, 1770000300n)
    });

    const system = await handler(new Request("http://localhost/universe/galaxies/2/systems/44?detail=full"));
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
      }
    });
    // Ready building/research/unit queues are projected complete for public read state; contract
    // events still remain the persisted source, and this is request-local read projection.
    expect(occupiedPlanet.publicState.queues.building).toBeNull();
    expect(occupiedPlanet.publicState.queues.research).toBeNull();
    expect(occupiedPlanet.publicState.buildings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, level: 2 })
    ]));
    expect(occupiedPlanet.publicState.fleet).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, count: 3 }),
      expect.objectContaining({ id: 9, count: 5 })
    ]));
    expect(occupiedPlanet.publicState.defenses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, count: 5 })
    ]));
    expect(occupiedPlanet.publicState.stationedDefenders).toEqual([
      expect.objectContaining({
        missionId: "42",
        defender,
        ships: expect.objectContaining({ lightFighter: "15" }),
        holdUntil: String(now + 3_600n)
      })
    ]);
    expect(occupiedPlanet.publicState.research).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, level: 2 })
    ]));
    expect(occupiedPlanet.publicMoonState).toMatchObject({
      fields: 12,
      diameterKm: 8777,
      createdAt: expect.any(String),
      resources: {
        metal: "7386",
        crystal: "2472",
        deuterium: "1335"
      },
      buildings: expect.any(Array),
      fleet: expect.any(Array),
      defenses: expect.any(Array),
      queues: {
        building: null,
        defense: null
      }
    });
    expect(system.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    expect(chainReader.rebuildCalls).toBe(1);
  });

  test("serves Raid Finder debris targets from indexed debris fields", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const richPlanet = {
      ...planet,
      planetId: "8",
      name: "Rubble",
      galaxy: 2,
      system: 45,
      position: 6,
    };
    indexer.applyEvent({ ...planet, eventName: "PlanetStarted", transactionHash: "0xabc", blockNumber: "123" });
    indexer.applyEvent({ ...richPlanet, eventName: "PlanetStarted", transactionHash: "0xabd", blockNumber: "124" });
    indexer.applyDebrisEvent({
      eventName: "DebrisFieldUpdated",
      transactionHash: "0xsmall",
      blockNumber: "125",
      planetId: planet.planetId,
      resources: { metal: "1000", crystal: "500" },
    });
    indexer.applyDebrisEvent({
      eventName: "DebrisFieldUpdated",
      transactionHash: "0xrich",
      blockNumber: "126",
      planetId: richPlanet.planetId,
      resources: { metal: "9000", crystal: "2000" },
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader, indexer });

    const response = await handler(new Request("http://localhost/raid-finder/debris?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.targets).toEqual([
      expect.objectContaining({
        planetId: "8",
        name: "Rubble",
        owner: player,
        coordinates: { galaxy: 2, system: 45, position: 6 },
        debris: { metal: "9000", crystal: "2000" },
        updatedAtBlock: "126",
        transactionHash: "0xrich",
      }),
    ]);
    expect(body.source).toBe("contract-state-indexer");
  });

  test("cold-starts without canonical rebuild, then serves pages without re-reading chain (VEY-KANEO-497)", async () => {
    const chainReader = new MockChainReader();
    const chainSync = {
      start() {},
      snapshot() {
        return { connected: true, subscribedToHeads: true, subscribedToLogs: true };
      },
      addListener() {
        return () => {};
      }
    } as unknown as import("./chainSync").ChainSyncService;
    // No injected indexer → createRequestHandler builds one over a fresh (cold) in-memory DB, but must
    // NOT fire a canonical eth_call rebuild. Event replay/listeners are the automatic path; canonical
    // rebuild is now explicit operator/test work only.
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      chainSync
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chainReader.rebuildCalls).toBe(0);

    // Serving player pages must not trigger chain history reads either.
    await handler(new Request(`http://localhost/wallet/${player}/shipyard`));
    await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    await handler(new Request(`http://localhost/wallet/${player}/defenses`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chainReader.rebuildCalls).toBe(0);
  });

  test("an explicit operator reconcile recovers a frozen baseline left by a failed prior reconcile", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    // Warm the DB: a first reconcile succeeds and sets `lastReconciledAt`.
    await indexer.rebuild();
    // A LATER reconcile then fails the way the self-hosted node truncated the heavy read
    // ("Unexpected end of JSON input"), leaving `lastReconciliationError` set and the baseline frozen.
    chainReader.listSettledPlanetEvents = async () => {
      chainReader.rebuildCalls += 1;
      throw new Error("Unexpected end of JSON input");
    };
    await indexer.reconcile("failed reconcile").catch(() => {});
    expect(indexer.snapshot().lastReconciledAt).not.toBeNull();
    expect(indexer.snapshot().lastReconciliationError).toBe("Unexpected end of JSON input");
    const callsBeforeBoot = chainReader.rebuildCalls;
    // Restore a healthy reader so an explicit operator reconcile completes and clears the error.
    chainReader.listSettledPlanetEvents = MockChainReader.prototype.listSettledPlanetEvents;

    // Explicit canonical reconcile recovers the DB; it is not run implicitly by server startup.
    await indexer.rebuild();

    expect(chainReader.rebuildCalls).toBe(callsBeforeBoot + 1);
    expect(indexer.snapshot().lastReconciliationError).toBeNull();
    expect(indexer.snapshot().lastReconciledAt).not.toBeNull();
  });

  test("only explicit startup reconcile opt-in runs a canonical rebuild", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    expect(indexer.snapshot().lastReconciliationError).toBeNull();
    chainReader.rebuildCalls = 0;

    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer,
      runStartupReconcile: true
    });

    // Let the fire-and-forget explicit reconcile run.
    for (let i = 0; i < 50 && chainReader.rebuildCalls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Exactly one canonical rebuild from the opt-in path — no periodic sweep follows.
    expect(chainReader.rebuildCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chainReader.rebuildCalls).toBe(1);
    expect(handler).toBeDefined();
  });

  test("explicit startup current-state heal runs one fleet mission snapshot inside the writer process", async () => {
    const chainReader = new MockChainReader();
    let fleetMissionSnapshotReads = 0;
    const seedableReader = chainReader as MockChainReader & Pick<ChainReader, "listCanonicalFleetMissions" | "listCurrentPlanets">;
    seedableReader.listCurrentPlanets = async () => {
      throw new Error("startup fleet mission heal must not scan planets");
    };
    seedableReader.listCanonicalFleetMissions = async () => {
      fleetMissionSnapshotReads += 1;
      return [];
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    const config = {
      ...configuredTestConfig,
      currentStateHealRunId: "test-current-heal",
      currentStateHealConcurrency: 25
    } satisfies BackendConfig;

    const handler = createRequestHandler({
      config,
      chainReader,
      indexer
    });

    for (let i = 0; i < 50 && !indexer.snapshot().currentStateOneTimeHealCompletedAt; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fleetMissionSnapshotReads).toBe(1);
    expect(indexer.snapshot()).toMatchObject({
      lastCurrentStateHealRunId: "test-current-heal",
      currentStateOneTimeHealCompletedAt: expect.any(String),
      lastCanonicalFleetMissionSyncRows: 0,
      lastReconciliationError: null
    });

    createRequestHandler({
      config,
      chainReader,
      indexer
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fleetMissionSnapshotReads).toBe(1);
    expect(handler).toBeDefined();
  });

  // Canonical-mirror rule 1/3: the request-time RPC routes POST /index/rebuild and
  // POST /index/verify/:planetId?heal=true were REMOVED — no HTTP request may trigger an RPC read or a
  // runtime canonical self-heal. They must now 404 and must NOT issue any chain read.
  test("removed request-time RPC routes /index/rebuild and /index/verify 404 without hitting chain", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const callsAfterSeed = chainReader.rebuildCalls;
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const rebuild = await handler(new Request("http://localhost/index/rebuild", { method: "POST" }));
    expect(rebuild.status).toBe(404);
    await expect(rebuild.json()).resolves.toMatchObject({ error: "not_found" });

    const verify = await handler(new Request("http://localhost/index/verify/7?heal=true", { method: "POST" }));
    expect(verify.status).toBe(404);
    await expect(verify.json()).resolves.toMatchObject({ error: "not_found" });

    // Neither route triggered any chain history read (the indexer is injected, so the handler fires no
    // implicit reconcile of its own here, and the removed routes do no chain work).
    expect(chainReader.rebuildCalls).toBe(callsAfterSeed);
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

  test("falls back to indexed wallet resources without double-accruing when chain reader is unavailable", async () => {
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
    chainReader.getPlanet = async () => {
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
    expect(settlementBody.planet.resources.metal).toBe("5000");
    expect(settlementBody.planet.resourcesAsOfNow.metal).toBe("5064");
    // The planet roster is a settled-snapshot surface (VEY-KANEO-488): `resources` is the
    // canonical value at `lastSettledAt` (5000 stored, matching the chain at a matched settle
    // time so the contract<->DB watchdog reports no db>chain divergence), while the live
    // production-accrued balance is exposed separately as `resourcesAsOfNow` (5064).
    expect(planetsBody.planets[0].resources.metal).toBe("5000");
    expect(planetsBody.planets[0].resourcesAsOfNow.metal).toBe("5064");
    expect(planetsBody.planets[0].resourceSnapshot).toMatchObject({
      planetId: "7",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: settlementBody.planet.lastSettledAt,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" }
    });
    expect(infrastructureBody.planetId).toBe("7");
    expect(infrastructureBody.planetLastSettledAt).toBe(settlementBody.planet.lastSettledAt);
    expect(infrastructureBody.resources.metal).toBe("5000");
    expect(infrastructureBody.resourcesAsOfNow.metal).toBe("5064");
    expect(infrastructureBody.resourceSnapshot).toMatchObject(planetsBody.planets[0].resourceSnapshot);
    // Raidable loot reflects ~50% of resources (RAID_PLUNDER_BPS), not the full 5064 (VEY-451).
    expect(infrastructureBody.raidableResources.metal).toBe("2532");
  });

  test("personal indexed resource endpoints derive resourcesAsOfNow exactly once (VEY-KANEO-517)", async () => {
    const chainReader = new MockChainReader();
    chainReader.getInfrastructureState = async () => {
      throw new Error("personal resource endpoints must not read live infrastructure state");
    };
    chainReader.getShipyardState = async () => {
      throw new Error("personal resource endpoints must not read live shipyard state");
    };
    chainReader.getDefenseState = async () => {
      throw new Error("personal resource endpoints must not read live defense state");
    };
    chainReader.getResearchState = async () => {
      throw new Error("personal resource endpoints must not read live research state");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm personal resource endpoints should not rebuild from chain");
    };
    // Fixed-clock previewResources-style fixture: the canonical settled metal snapshot is 5000,
    // one current-resource projection is 5064, and re-projecting that value would produce 5128.
    const canonicalMetal = "5000";
    const previewResourcesMetal = "5064";
    const doubleAccruedMetal = "5128";
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
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const settlementBody = await (await handler(new Request(`http://localhost/wallet/${player}/settlement`))).json();
    const planetsBody = await (await handler(new Request(`http://localhost/wallet/${player}/planets`))).json();
    const infrastructureBody = await (await handler(new Request(`http://localhost/wallet/${player}/infrastructure`))).json();
    const shipyardBody = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard`))).json();
    const defensesBody = await (await handler(new Request(`http://localhost/wallet/${player}/defenses`))).json();
    const researchBody = await (await handler(new Request(`http://localhost/wallet/${player}/research`))).json();
    const overviewBody = await (await handler(new Request(`http://localhost/wallet/${player}/overview`))).json();

    for (const body of [infrastructureBody, shipyardBody, defensesBody, researchBody]) {
      expect(body.resources.metal).toBe(canonicalMetal);
      expect(body.resourcesAsOfNow.metal).toBe(previewResourcesMetal);
      expect(body.resourcesAsOfNow.metal).not.toBe(doubleAccruedMetal);
    }

    expect(settlementBody.planet.resources.metal).toBe(canonicalMetal);
    expect(settlementBody.planet.resourcesAsOfNow.metal).toBe(previewResourcesMetal);
    expect(planetsBody.planets[0].resources.metal).toBe(canonicalMetal);
    expect(planetsBody.planets[0].resourcesAsOfNow.metal).toBe(previewResourcesMetal);
    expect(overviewBody.settlement.planet.resources.metal).toBe(canonicalMetal);
    expect(overviewBody.settlement.planet.resourcesAsOfNow.metal).toBe(previewResourcesMetal);
    expect(overviewBody.planetsResponse.planets[0].resources.metal).toBe(canonicalMetal);
    expect(overviewBody.planetsResponse.planets[0].resourcesAsOfNow.metal).toBe(previewResourcesMetal);
    expect(infrastructureBody.raidableResources.metal).toBe("2532");
  });

  test("resourcesAsOfNow and served buildings project elapsed building queues across readyAt (VEY-KANEO-546)", async () => {
    const chainReader = new MockChainReader();
    chainReader.getInfrastructureState = async () => {
      throw new Error("resource projection must not call live infrastructure state");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm resource projection should not rebuild from chain");
    };
    const startTs = 1_770_004_080;
    const readyAt = startTs + 60;
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: startTs.toString()
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xbase-mine",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xbase-solar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(30n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xelapsed-mine-upgrade",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(10n, BigInt(readyAt), 0n, 0n, 0n)
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader, indexer });

    const infrastructureBody = await (await handler(new Request(`http://localhost/wallet/${player}/infrastructure`))).json();
    const rawRows = indexer.resourceProjectionRows(planet.planetId, player);
    const rawRate = deriveInfrastructureFields(
      { ...planet, lastSettledAt: startTs.toString() },
      rawRows.buildings,
      rawRows.ships,
      rawRows.technologyLevels
    ).productionPerHour;
    if (!rawRate) throw new Error("expected derivable production rates");
    const elapsed = Math.floor(Date.now() / 1_000) - startTs;
    const rawProjectedMetal = Number(planet.resources.metal) + Math.floor((Number(rawRate.metal) * elapsed) / 3_600);

    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(10);
    expect(rawRows.buildings.find((building) => building.id === 0)?.level).toBe(1);
    expect(Number(infrastructureBody.resourcesAsOfNow.metal)).toBeGreaterThan(rawProjectedMetal);
    expect(infrastructureBody.buildings.find((building: { id: number }) => building.id === 0)?.level).toBe(10);
    expect(infrastructureBody.queue).toBeNull();
  });

  test("returned loot resource credit updates every wallet current-resource feeder (VEY-KANEO-517)", async () => {
    const chainReader = new MockChainReader();
    chainReader.getInfrastructureState = async () => {
      throw new Error("returned-loot resource endpoints must not read live infrastructure state");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm returned-loot resource endpoints should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: Math.floor(Date.now() / 1_000).toString(),
      resources: { metal: "2022", crystal: "1005", deuterium: "1259" }
    });
    for (const log of activeFleetMissionLogs({ missionId: 915n, owner: player, originPlanetId: 7n, targetPlanetId: 8n })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xreturned-loot-credit",
      logIndex: "0x1",
      topics: [planetSettledTopic, topic(7n)],
      data: abiWords(5000n, 2824n, 1359n, BigInt(Math.floor(Date.now() / 1_000)))
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xreturned-mission",
      logIndex: "0x2",
      topics: [fleetMissionReturnedTopic, topic(915n), addressTopic(player), topic(7n)],
      data: "0x"
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const settlementBody = await (await handler(new Request(`http://localhost/wallet/${player}/settlement`))).json();
    const planetsBody = await (await handler(new Request(`http://localhost/wallet/${player}/planets`))).json();
    const infrastructureBody = await (await handler(new Request(`http://localhost/wallet/${player}/infrastructure`))).json();
    const overviewBody = await (await handler(new Request(`http://localhost/wallet/${player}/overview`))).json();

    const credited = { metal: "5000", crystal: "2824", deuterium: "1359" };
    expect(settlementBody.planet.resourcesAsOfNow).toEqual(credited);
    expect(planetsBody.planets[0].resourcesAsOfNow).toEqual(credited);
    expect(infrastructureBody.resourcesAsOfNow).toEqual(credited);
    expect(overviewBody.settlement.planet.resourcesAsOfNow).toEqual(credited);
    expect(overviewBody.planetsResponse.planets[0].resourcesAsOfNow).toEqual(credited);
  });

  test("planet roster serves the settled resource snapshot at lastSettledAt, with the accrued balance in resourcesAsOfNow (VEY-KANEO-488)", async () => {
    // The external contract<->DB watchdog compares the roster's `resources` against the chain's
    // stored `planet().resources` whenever `lastSettledAt` matches on both sides. Projecting
    // production into `resources` while keeping the settled `lastSettledAt` made the served value
    // exceed the chain at a matched settle time (db>chain). The roster must therefore keep
    // `resources` equal to the settled snapshot and surface the live balance as `resourcesAsOfNow`.
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm roster should not rebuild from chain");
    };
    const settledAt = (Math.floor(Date.now() / 1_000) - 7_200).toString();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123",
      lastSettledAt: settledAt
    });
    // A metal mine + solar plant give the planet a nonzero production rate, so the accrued
    // balance diverges from the settled snapshot over the elapsed two hours.
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xmine",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({ config: configuredTestConfig, chainReader, indexer });

    const planetsResponse = await handler(new Request(`http://localhost/wallet/${player}/planets`));
    const planetsBody = await planetsResponse.json();
    const served = planetsBody.planets[0];

    expect(planetsResponse.status).toBe(200);
    // `resources` is the settled snapshot, unchanged from the indexed event — equals the chain's
    // stored resources at the matched `lastSettledAt`, so the watchdog reports no db>chain divergence.
    expect(served.lastSettledAt).toBe(settledAt);
    expect(served.resources).toEqual(planet.resources);
    // The live, production-accrued balance is exposed separately and strictly exceeds the snapshot.
    expect(Number(served.resourcesAsOfNow.metal)).toBeGreaterThan(Number(served.resources.metal));
    // Plunderable loot still reflects the live balance, not the frozen snapshot.
    expect(Number(served.tactical.raidableResourceTotal)).toBeGreaterThan(0);
  });

  test("serves selected infrastructure planet resources from the indexed DB without a per-request chain read (VEY-KANEO-461)", async () => {
    const wallet = "0x9ea58b89140f60b7a706e88128c56b9de62c8bd8" as Address;
    const indexedPlanet: SettledPlanetEvent = {
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
    const chainReader = new MockChainReader();
    // No authoritative read-through any more: opening a page must never hit the contract (AC2).
    chainReader.getInfrastructureState = (async () => {
      throw new Error("infrastructure page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getInfrastructureState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm resource endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent(indexedPlanet);
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${wallet}/infrastructure?planetId=10`));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The served balance is the indexed snapshot (no buildings → zero accrual), proving the page
    // is answered from SQLite rather than a contract read.
    expect(body.resources).toEqual(indexedPlanet.resources);
    expect(body.source).toBe("contract-state-indexer");
  });

  test("serves selected research planet id from the indexed DB without falling back to home planet", async () => {
    const wallet = "0x9ea58b89140f60b7a706e88128c56b9de62c8bd8" as Address;
    const homePlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "7",
      owner: wallet,
      eventName: "PlanetStarted",
      transactionHash: "0xhome",
      blockNumber: "321"
    };
    const selectedPlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "10",
      owner: wallet,
      eventName: "ColonyCreated",
      transactionHash: "0xselected",
      blockNumber: "322"
    };
    const chainReader = new MockChainReader();
    chainReader.getResearchState = (async () => {
      throw new Error("research page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getResearchState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm research endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent(homePlanet);
    indexer.applyEvent(selectedPlanet);
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xlab",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(10n),
        topic(6n)
      ],
      data: abiWords(6n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${wallet}/research?planetId=10`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: "contract-state-indexer",
      planetId: "10",
      researchLabLevel: 6
    });
  });

  test("serves shipyard ships from the indexed roster without a per-request chain read (VEY-KANEO-461)", async () => {
    // The shipyard page is now served straight from the event-synced indexed roster; the contract
    // getter must not be invoked per request (AC2).
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = (async () => {
      throw new Error("shipyard page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getShipyardState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm shipyard endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    // A build completion the event indexer records — the roster the page serves comes from here.
    indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xship",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(4n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/shipyard`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ships).toContainEqual(expect.objectContaining({ id: 0, count: 4 }));
    expect(body.source).toBe("contract-state-indexer");
  });

  test("does not serve stale cached shipyard inventory after indexed ship counts change", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = (async () => {
      throw new Error("shipyard page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getShipyardState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm shipyard endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xship-warm",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(5n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      prewarmResponseCache: false,
      indexer
    });

    const warmed = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
    expect(warmed.ships).toContainEqual(expect.objectContaining({ id: 0, count: 5 }));

    indexer.applyLog({
      blockNumber: "0x7e",
      transactionHash: "0xship-debit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(0n)
    });

    const fresh = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
    expect(fresh.ships).toContainEqual(expect.objectContaining({ id: 0, count: 0 }));
  });

  test("projects lazy-completed shipyard counts after readyAt without mutating indexed counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-lazy-shipyard-"));
    const databasePath = join(dir, "index.sqlite");
    const beforeReadyAt = 1_770_007_680;
    const readyAt = beforeReadyAt + 60;
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = (async () => {
      throw new Error("shipyard page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getShipyardState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm shipyard endpoint should not rebuild from chain");
    };

    try {
      setSystemTime(new Date(beforeReadyAt * 1_000));
      const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, { databasePath });
      indexer.applyEvent({
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      });
      indexer.applyLog({
        blockNumber: "0x7d",
        transactionHash: "0xship-queued",
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(1n)],
        data: abiWords(3n, BigInt(readyAt), 9000n, 3000n, 0n)
      });
      const handler = createRequestHandler({
        config: { ...configuredTestConfig, indexDbPath: databasePath },
        chainReader,
        enableResponseCache: true,
        prewarmResponseCache: false,
        indexer
      });

      const beforeVersion = indexer.responseCacheVersion();
      const warmed = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json() as ShipyardState;
      expect(warmed.ships).toContainEqual(expect.objectContaining({ id: 1, count: 0 }));
      expect(warmed.queue).toMatchObject({ itemId: 1, quantity: 3, readyAt: String(readyAt) });

      setSystemTime(new Date((readyAt + 1) * 1_000));

      const afterVersion = indexer.responseCacheVersion();
      const fresh = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json() as ShipyardState;
      expect(afterVersion).not.toBe(beforeVersion);
      expect(fresh.ships).toContainEqual(expect.objectContaining({ id: 1, count: 3 }));
      expect(fresh.queue).toBeNull();

      const db = new Database(databasePath);
      try {
        const stored = db.query(`
          SELECT count
          FROM contract_ship_counts
          WHERE planet_id = '7' AND ship_id = 1
        `).get() as { count: number } | null;
        expect(stored?.count ?? 0).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      setSystemTime(new Date(1_770_007_680_000));
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("invalidates reader-worker shipyard response cache from the shared indexed-state version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-server-cache-"));
    const databasePath = join(dir, "index.sqlite");
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = (async () => {
      throw new Error("shipyard page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getShipyardState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm shipyard endpoint should not rebuild from chain");
    };

    try {
      const writerIndexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, { databasePath });
      writerIndexer.applyEvent({
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      });
      writerIndexer.applyLog({
        blockNumber: "0x7d",
        transactionHash: "0xship-warm",
        logIndex: "0x0",
        topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
        data: abiWords(5n)
      });

      const readerIndexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, { databasePath });
      const handler = createRequestHandler({
        config: { ...configuredTestConfig, indexDbPath: databasePath },
        chainReader,
        enableResponseCache: true,
        indexer: readerIndexer,
        prewarmResponseCache: false,
        role: "reader"
      });

      const warmed = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
      expect(warmed.ships).toContainEqual(expect.objectContaining({ id: 0, count: 5 }));

      writerIndexer.applyLog({
        blockNumber: "0x7e",
        transactionHash: "0xship-debit",
        logIndex: "0x0",
        topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
        data: abiWords(0n)
      });

      const fresh = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
      expect(fresh.ships).toContainEqual(expect.objectContaining({ id: 0, count: 0 }));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("serves fresh mission-critical unit endpoints even when cache version is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-server-unit-cache-"));
    const databasePath = join(dir, "index.sqlite");
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = (async () => {
      throw new Error("shipyard page must be served from the indexed DB, never a live eth_call");
    }) as ChainReader["getShipyardState"];
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("unit endpoints should not rebuild from chain");
    };

    try {
      const writerIndexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, { databasePath });
      writerIndexer.applyEvent({
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      });
      writerIndexer.applyLog({
        blockNumber: "0x7d",
        transactionHash: "0xship-warm",
        logIndex: "0x0",
        topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
        data: abiWords(5n)
      });
      writerIndexer.applyLog({
        blockNumber: "0x7d",
        transactionHash: "0xdefense-warm",
        logIndex: "0x1",
        topics: [planetDefenseCountChangedTopic, topic(7n), topic(1n)],
        data: abiWords(3n)
      });

      const readerIndexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, {
        databasePath,
        runStartupBackfill: false
      });
      const handler = createRequestHandler({
        config: { ...configuredTestConfig, indexDbPath: databasePath },
        chainReader,
        enableResponseCache: true,
        indexer: readerIndexer,
        prewarmResponseCache: false,
        role: "reader"
      });

      const warmedShipyard = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
      expect(warmedShipyard.ships).toContainEqual(expect.objectContaining({ id: 0, count: 5 }));
      const warmedDefenses = await (await handler(new Request(`http://localhost/wallet/${player}/defenses?planetId=7`))).json();
      expect(warmedDefenses.defenses).toContainEqual(expect.objectContaining({ id: 1, count: 3 }));

      const db = new Database(databasePath);
      try {
        // Simulate another worker applying the canonical event mutation while this reader's persisted
        // version token stays unchanged. These endpoints must still avoid worker-local response cache.
        db.query("UPDATE contract_ship_counts SET count = 0 WHERE planet_id = '7' AND ship_id = 0").run();
        db.query("UPDATE contract_defense_counts SET count = 4 WHERE planet_id = '7' AND defense_id = 1").run();
      } finally {
        db.close();
      }

      const freshShipyard = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`))).json();
      expect(freshShipyard.ships).toContainEqual(expect.objectContaining({ id: 0, count: 0 }));
      const freshDefenses = await (await handler(new Request(`http://localhost/wallet/${player}/defenses?planetId=7`))).json();
      expect(freshDefenses.defenses).toContainEqual(expect.objectContaining({ id: 1, count: 4 }));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
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
    chainReader.getPlanet = async () => {
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
    // Raidable loot is ~50% of current resources (RAID_PLUNDER_BPS), not the full amount (VEY-451).
    expect(infrastructureBody.raidableResources).toEqual({
      metal: "1826",
      crystal: "2070",
      deuterium: "2370"
    });
    // Building/research queues are projected complete; unit queues retain the old as-of-now visibility
    // behavior in this narrow fixture. The point of this test is still the resource deductions from the
    // spends, asserted above.
    expect(planetsBody.planets[0].queues).toMatchObject({
      building: null,
      defense: null,
      ship: null
    });
    expect(planetsBody.queues.research).toBeNull();
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

  test("serves Overview as one DB-backed indexed snapshot without chain reader calls", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getWalletPlanets = async () => {
      liveReadCalled = true;
      throw new Error("overview should not call wallet planet RPC");
    };
    chainReader.getPlayerQueues = async () => {
      liveReadCalled = true;
      throw new Error("overview should not call player queue RPC");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm overview index should not rebuild from chain");
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

    const response = await handler(new Request(`http://localhost/wallet/${player}/overview`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(liveReadCalled).toBe(false);
    expect(body).toMatchObject({
      source: "contract-state-indexer",
      detail: "overview snapshot loaded from DB-indexed contract state.",
      settlement: {
        wallet: player,
        homePlanetId: planet.planetId,
        planet: {
          planetId: planet.planetId
        }
      },
      planetsResponse: {
        wallet: player,
        homePlanetId: planet.planetId,
        planets: [
          {
            planetId: planet.planetId
          }
        ]
      },
      queues: {
        wallet: player,
        homePlanetId: planet.planetId,
        building: null,
        defense: null,
        ship: null,
        research: null
      },
      fleetVisibility: {
        wallet: player,
        homePlanetId: planet.planetId,
        completedMissions: [],
        battleReports: []
      }
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
    // Elapsed building queues are projected complete for served UI state.
    expect(queuesBody.building).toBeNull();
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
        metal: "2300",
        crystal: "2390",
        deuterium: "2370"
      },
      // Accrued-to-now resources (VEY-KANEO-464). Production is 0 here (no mines), so
      // the projection equals canonical resources but the field is always present.
      resourcesAsOfNow: {
        metal: "4600",
        crystal: "4780",
        deuterium: "4740"
      },
      // The elapsed building is projected complete for the UI.
      queue: null,
      buildings: expect.arrayContaining([expect.objectContaining({ id: 5, level: 1 })])
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

  test("projects accrued resources across a due storage upgrade without applying the new cap early", async () => {
    const chainReader = new MockChainReader();
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const readyAt = now - 3_600n;
    const lastSettledAt = readyAt - 3_600n;
    const cappedPlanet: PlanetState = {
      ...planet,
      lastSettledAt: lastSettledAt.toString(),
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "10000"
      }
    };
    chainReader.listSettledPlanetEvents = async () => [
      {
        ...cappedPlanet,
        eventName: "PlanetStarted",
        transactionHash: "0xabc",
        blockNumber: "123"
      }
    ];
    chainReader.getInfrastructureState = async (wallet) => ({
      ...(await MockChainReader.prototype.getInfrastructureState.call(chainReader, wallet)),
      resources: cappedPlanet.resources,
      resourcesAsOfNow: cappedPlanet.resources,
      storageCaps: {
        metal: "10000",
        crystal: "10000",
        deuterium: "10000"
      }
    });
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.getInfrastructureState = async () => {
      throw new Error("infrastructure page must be served from the indexed DB");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm indexed state should not rebuild from chain");
    };
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xdeutsynth",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(2n)],
      data: abiWords(5n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(10n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      blockTimestamp: `0x${lastSettledAt.toString(16)}`,
      transactionHash: "0xtank",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(9n)],
      data: abiWords(1n, readyAt, 1000n, 1000n, 0n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const body = await response.json();
    const deuteriumPerHour = Number(body.productionPerHour.deuterium);

    expect(body.storageCaps.deuterium).toBe("20000");
    expect(body.resourcesAsOfNow.deuterium).toBe((10_000 + deuteriumPerHour).toString());
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

  test("derives indexed infrastructure Solar Satellite E/Sat with canonical bounds", () => {
    const buildings: InfrastructureState["buildings"] = [
      { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
    ];
    const ships: ShipyardState["ships"] = [
      { id: 9, count: 3, cost: { metal: "0", crystal: "2000", deuterium: "500" } },
    ];

    expect(deriveInfrastructureFields({ ...planet, temperature: -200 }, buildings, ships, {}).energyBalance?.sources).toMatchObject({
      solarSatellites: "3",
      solarSatelliteCount: 3,
      solarSatelliteEnergy: "1",
    });
    expect(deriveInfrastructureFields({ ...planet, temperature: 400 }, buildings, ships, {}).energyBalance?.sources).toMatchObject({
      solarSatellites: "195",
      solarSatelliteCount: 3,
      solarSatelliteEnergy: "65",
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
    // The elapsed research queue is projected complete for served UI state.
    expect(research).toMatchObject({
      source: "contract-state-indexer",
      queue: null
    });
    expect(research.technologies).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 4, level: 2 })])
    );
    // Personal state endpoints expose accrued resourcesAsOfNow (VEY-KANEO-464). This
    // fixture has no mines (zero production), so the projection equals canonical
    // resources, but the field must be present and non-null for a warm planet.
    expect(shipyard.resourcesAsOfNow).not.toBeNull();
    expect(shipyard.resourcesAsOfNow).toEqual(shipyard.resources);
    expect(research.resourcesAsOfNow).toEqual(research.resources);
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

  test("serves indexed infrastructure resources without attempting an authoritative chain read", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    chainReader.getInfrastructureState = async () => {
      liveReadCalled = true;
      throw new Error("infrastructure page must be served from the indexed DB, never a live eth_call");
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
    // No per-request chain read happens at all — the page is answered from the indexed snapshot
    // (VEY-KANEO-461). The stubbed getter would throw if it were ever called.
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
        metal: "2500",
        crystal: "2450",
        deuterium: "2400"
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
          level: 2
        })
      ])
    });
    // Elapsed queues project into served building levels.
    expect(body.queue).toBeNull();
  });

  test("keeps indexed infrastructure globally healthy while selected planet resources warm", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    chainReader.getInfrastructureState = async () => {
      liveReadCalled = true;
      throw new Error("infrastructure page must be served from the indexed DB, never a live eth_call");
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
    // No chain read at all; the still-warming indexed snapshot is served directly (VEY-KANEO-461).
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

  test("keeps infrastructure available when a due mission can be lazily resolved (VEY-590)", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_770_000_000n,
      missionId: 572n,
      missionTypeId: 3n,
      owner: player,
      originPlanetId: 7n,
      targetPlanetId: 8n,
    })) {
      indexer.applyLog(log);
    }
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
      infrastructureAvailable: true,
      indexer: {
        indexedState: "healthy",
        safeToServeIndexedState: true
      }
    });
    expect(body.actionBlocker).toBeUndefined();
    expect(body.stale).not.toBe(true);
  });

  test("keeps pending-randomness combat arrivals as hard infrastructure blockers (VEY-590)", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock, {
      randomnessEngineConfigured: true
    });
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_770_000_000n,
      missionId: 590n,
      missionTypeId: 3n,
      owner: player,
      originPlanetId: 7n,
      targetPlanetId: 8n,
      randomnessRequestId: 5900n,
    })) {
      indexer.applyLog(log);
    }
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/infrastructure`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body).toMatchObject({
      infrastructureAvailable: false,
      stale: true,
      unavailableReason: "Mission resolution is pending for this planet (mission 590). The indexer or keeper must settle the due mission before infrastructure upgrades can be started.",
      actionBlocker: {
        kind: "mission_resolution_pending",
        missionIds: ["590"],
        earliestArrivalAt: "1770000000"
      },
      indexer: {
        indexedState: "healthy",
        safeToServeIndexedState: true
      }
    });
  });

  test("does not keep infrastructure blocked when a resolved attack report is indexed without a terminal mission log (VEY-KANEO-590)", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    for (const log of activeFleetMissionLogs({
      arrivalAt: 1_770_000_000n,
      missionId: 590n,
      missionTypeId: 3n,
      owner: player,
      originPlanetId: 7n,
      targetPlanetId: 8n,
    })) {
      indexer.applyLog(log);
    }
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xresolved-590",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(590n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 2n, 12345n, 100n, 50n, 0n)
    });
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
      infrastructureAvailable: true,
      stale: false,
      indexer: {
        indexedState: "healthy",
        safeToServeIndexedState: true
      }
    });
    expect(body.actionBlocker).toBeUndefined();
  });

  test("serves every player surface from indexed page state with no per-request chain reads (VEY-KANEO-461)", async () => {
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
    // Every surface — shipyard/defenses/research included — is served from the indexed DB now;
    // none of them issue a per-request chain read (VEY-KANEO-461).
    expect(liveReads).toEqual([]);
  });

  test("serves the indexed shipyard page instantly and never waits on a chain read (VEY-KANEO-461)", async () => {
    const chainReader = new MockChainReader();
    let liveReadCalled = false;
    // A getter that would hang forever — proving the page never awaits it.
    chainReader.getShipyardState = async () => {
      liveReadCalled = true;
      return new Promise<ShipyardState>(() => {});
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm shipyard endpoint should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xship",
      logIndex: "0x0",
      topics: [
        planetShipCountChangedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const startedAt = Date.now();
    const response = await handler(new Request(`http://localhost/wallet/${player}/shipyard`));
    const body = await response.json();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(liveReadCalled).toBe(false);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-veydrift-index-state")).toBe("stale");
    expect(body).toMatchObject({
      wallet: player,
      homePlanetId: planet.planetId,
      stale: true,
      source: "contract-state-indexer",
      detail: "shipyard loaded from DB-indexed contract state."
    });
    expect(body.ships).toContainEqual(expect.objectContaining({
      id: 0,
      count: 1
    }));
  });

  test("serves lazy-completed ship and defense queues as present in indexed reads", async () => {
    const chainReader = new MockChainReader();
    chainReader.getShipyardState = async () => {
      throw new Error("shipyard page must not use live reads for lazy projection");
    };
    chainReader.getDefenseState = async () => {
      throw new Error("defenses page must not use live reads for lazy projection");
    };
    chainReader.listSettledPlanetEvents = async () => {
      throw new Error("warm unit endpoints should not rebuild from chain");
    };
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    indexer.applyEvent({
      ...planet,
      eventName: "PlanetStarted",
      transactionHash: "0xabc",
      blockNumber: "123"
    });
    const now = Math.floor(Date.now() / 1_000);
    indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xship-base",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(4n)
    });
    indexer.applyLog({
      blockNumber: "0x7e",
      transactionHash: "0xship-active-ready",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(2n)],
      data: abiWords(1n, BigInt(now - 120), 100n, 100n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x7f",
      transactionHash: "0xship-backlog-ready",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, BigInt(now - 60), 1n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xdefense-base",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(10n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xdefense-active-ready",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, BigInt(now - 120), 100n, 100n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xdefense-backlog-ready",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(5n, BigInt(now - 60), 1n, 0n, 0n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const shipyardBody = await (await handler(new Request(`http://localhost/wallet/${player}/shipyard`))).json();
    const defensesBody = await (await handler(new Request(`http://localhost/wallet/${player}/defenses`))).json();

    expect(shipyardBody.queue).toBeNull();
    expect(shipyardBody.ships.filter((ship: { count: number }) => ship.count > 0).map(({ id, count }: { id: number; count: number }) => ({ id, count }))).toEqual([
      { id: 0, count: 7 },
      { id: 2, count: 1 }
    ]);
    expect(defensesBody.queue).toBeNull();
    expect(defensesBody.defenses.filter((defense: { count: number }) => defense.count > 0).map(({ id, count }: { id: number; count: number }) => ({ id, count }))).toEqual([
      { id: 0, count: 15 },
      { id: 1, count: 2 }
    ]);
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

  test("serves planet detail from the indexed snapshot without a per-request chain read (VEY-KANEO-461)", async () => {
    const chainReader = new MockChainReader();
    chainReader.getPlanet = async () => {
      throw new Error("planet detail must be served from the indexed DB, never a live eth_call");
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
      // The indexed snapshot's resources (no buildings → zero accrual), not a contract read.
      resources: planet.resources
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
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xmoon-highscore",
      logIndex: "0x0",
      topics: [
        moonCreatedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xmoonresources-highscore",
      logIndex: "0x0",
      topics: [moonResourcesSettledTopic, topic(7n)],
      data: abiWords(7386n, 2472n, 1335n, 1770000300n)
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
          hasMoon: true,
          moon: {
            exists: true,
            resources: {
              metal: "7386",
              crystal: "2472",
              deuterium: "1335"
            },
            resourcesAsOfNow: {
              metal: "7386",
              crystal: "2472",
              deuterium: "1335"
            }
          },
          tactical: {
            raidableResources: {
              metal: "2500",
              crystal: "2450",
              deuterium: "2400"
            },
            raidableResourceTotal: "7350",
            ships: {
              count: expect.any(Number),
              power: expect.any(String),
              units: expect.any(Array)
            },
            defenses: {
              count: expect.any(Number),
              power: expect.any(String),
              units: expect.any(Array)
            },
            combatShips: expect.objectContaining({
              count: expect.any(Number),
              power: expect.any(String),
              units: expect.any(Array)
            }),
            combatPower: expect.any(String)
          }
        }
      ],
      planetCount: 1,
      // Unit/building/research queues are not committed state until their completion event lands.
      score: {
        total: "8095",
        economy: "8080",
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

  test("keeps cached highscores stable across mission-only read-model changes", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const originalHighscoreLeaderboard = indexer.highscoreLeaderboard.bind(indexer);
    let highscoreLeaderboardCalls = 0;
    indexer.highscoreLeaderboard = () => {
      highscoreLeaderboardCalls += 1;
      return originalHighscoreLeaderboard();
    };
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });
    const request = new Request("http://localhost/highscores?category=total&page=1&pageSize=10");

    expect((await handler(request.clone())).status).toBe(200);
    expect(highscoreLeaderboardCalls).toBe(1);

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmission-only",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topic(50n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 100n, 300n, 0n, 0n, 0n)
    });

    expect((await handler(request.clone())).status).toBe(200);
    expect(highscoreLeaderboardCalls).toBe(1);
  });

  test("sends public browser cache headers for cached public API reads", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });

    const response = await handler(new Request("http://localhost/highscores?category=total&page=1&pageSize=10"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, stale-while-revalidate=300");
  });

  test("does not serve current-player highscore fields from anonymous response cache", async () => {
    const owners = [
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666"
    ] as Address[];
    const currentWallet = owners[2]!;
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => owners.map((owner, index) => ({
      ...planet,
      eventName: "PlanetStarted",
      owner,
      planetId: String(index + 10),
      transactionHash: `0xcurrentplayercache${index}`,
      blockNumber: String(123 + index)
    }));
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });
    const publicPath = "http://localhost/highscores?category=total&page=1&pageSize=1";

    const anonymous = await handler(new Request(publicPath));
    const anonymousBody = await anonymous.json();
    const personalized = await handler(new Request(`${publicPath}&currentWallet=${currentWallet}`));
    const personalizedBody = await personalized.json();
    const anonymousAgain = await handler(new Request(publicPath));
    const anonymousAgainBody = await anonymousAgain.json();

    expect(anonymous.status).toBe(200);
    expect(anonymousBody.currentPlayer).toBeUndefined();
    expect(personalized.status).toBe(200);
    expect(personalized.headers.get("cache-control")).toBe("private, no-store");
    expect(personalizedBody.currentPlayer).toMatchObject({
      wallet: currentWallet,
      rankings: {
        total: {
          rank: 3,
          page: 3
        }
      }
    });
    expect(anonymousAgainBody.currentPlayer).toBeUndefined();
  });

  test("keeps cached highscore current-player fields separated by wallet", async () => {
    const owners = [
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666"
    ] as Address[];
    const chainReader = new MockChainReader();
    chainReader.listSettledPlanetEvents = async () => owners.map((owner, index) => ({
      ...planet,
      eventName: "PlanetStarted",
      owner,
      planetId: String(index + 20),
      transactionHash: `0xwalletcache${index}`,
      blockNumber: String(223 + index)
    }));
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });

    const first = await handler(new Request(`http://localhost/highscores?category=total&page=1&pageSize=1&currentWallet=${owners[0]}`));
    const firstBody = await first.json();
    const second = await handler(new Request(`http://localhost/highscores?category=total&page=1&pageSize=1&currentWallet=${owners[2]}`));
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.currentPlayer).toMatchObject({
      wallet: owners[0],
      rankings: { total: { rank: 1, page: 1 } }
    });
    expect(second.status).toBe(200);
    expect(secondBody.currentPlayer).toMatchObject({
      wallet: owners[2],
      rankings: { total: { rank: 3, page: 3 } }
    });
  });

  test("does not serve cached highscore attack protection when the flag is absent", async () => {
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
      data: abiWords(9n, 25000n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });
    const personalizedPath = `http://localhost/highscores?limit=10&currentWallet=${attacker}`;

    const protectedResponse = await handler(new Request(`${personalizedPath}&includeAttackProtection=true`));
    const protectedBody = await protectedResponse.json();
    const unprotectedResponse = await handler(new Request(personalizedPath));
    const unprotectedBody = await unprotectedResponse.json();

    expect(protectedResponse.status).toBe(200);
    expect(protectedBody.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toMatchObject({
      allowed: false,
      blockedReason: "score_protection"
    });
    expect(unprotectedResponse.status).toBe(200);
    expect(unprotectedBody.rankings.total.find((entry: HighscoreEntry) => entry.wallet === player)?.attackProtection).toBeNull();
  });

  test("sends private browser cache headers for cached wallet API reads", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      enableResponseCache: true,
      indexer,
      prewarmResponseCache: false
    });

    const response = await handler(new Request(`http://localhost/wallet/${player}/overview`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=15, stale-while-revalidate=15");
  });

  test("accrues production into highscore raidable loot so it matches the public planet read (VEY-KANEO-454)", async () => {
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    // Same fixture as the accrued-resources fallback test: indexed infrastructure includes an
    // elapsed building queue, but lens-backed public resource reads follow the contract
    // previewResources semantics and accrue from raw stored building levels.
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
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const highscoreResponse = await handler(new Request("http://localhost/highscores?limit=10"));
    const highscoreBody = await highscoreResponse.json();

    expect(highscoreResponse.status).toBe(200);

    const tacticalPlanet = highscoreBody.rankings.total[0].planets[0];
    // The finder's raidable loot reflects the accrued 5128 metal (~50% plunder =>
    // 2564), matching the accrued resources the public planet read exposes. Before VEY-454 this
    // used the stale stored 5000 and under-reported LOOT at 2500.
    expect(tacticalPlanet.tactical.raidableResources.metal).toBe("2564");
    expect(Number(tacticalPlanet.tactical.raidableResources.metal)).toBeGreaterThan(2500);
  });

  test("public planet, universe, and Raid Target Finder resources share the same current public basis (VEY-KANEO-454/621)", async () => {
    // Cross-surface invariant for the QA report: the Raid Target Finder LOOT (highscores
    // `raidableResources`) must be derived from the SAME accrued/current (capped) resources the
    // public planet read (`GET /planets/{id}`) and universe surface (`publicState.resources`) show
    // — not a staler stored snapshot. The direct planet, highscores, and universe paths all run
    // `resourcesWithClaimableAccrual` over the identical settled base, so they must agree.
    const chainReader = new MockChainReader();
    const indexer = new SettlementIndexer(chainReader, configuredTestConfig.indexFromBlock);
    await indexer.rebuild();
    // Metal mine + solar plant settled two hours ago.
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
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader,
      indexer
    });

    const planetResponse = await handler(new Request("http://localhost/planets/7"));
    const planetBody = await planetResponse.json();
    const universeResponse = await handler(new Request("http://localhost/universe/galaxies/2/systems/44?detail=full"));
    const universeBody = await universeResponse.json();
    const publicPlanet = universeBody.planets.find((item: { position: number }) => item.position === 9);
    const publicResources = publicPlanet.publicState.resources;
    // The public planet and universe surfaces share one accrued/current basis.
    expect(planetBody.resources).toEqual(publicResources);
    expect(publicResources.metal).toBe("5128");
    expect(publicPlanet.publicState.productionPerHour).toEqual(expect.objectContaining({
      metal: expect.any(String),
      crystal: expect.any(String),
      deuterium: expect.any(String)
    }));
    expect(publicPlanet.publicState.storageCaps).toEqual(expect.objectContaining({
      metal: expect.any(String),
      crystal: expect.any(String),
      deuterium: expect.any(String)
    }));

    const highscoreResponse = await handler(new Request("http://localhost/highscores?limit=10"));
    const highscoreBody = await highscoreResponse.json();
    const tacticalPlanet = highscoreBody.rankings.total[0].planets[0];

    // Raidable loot derived from the public (accrued) resources, using the same shared derivation
    // the backend applies. The Finder must match this exactly, proving it reads the accrued base
    // instead of the stale stored snapshot (which would yield raidable metal 2500).
    const expectedDerived = deriveInfrastructureFields(
      { ...planet, resources: publicResources },
      indexer.infrastructureRows("7"),
      indexer.shipRows("7"),
      indexer.technologyLevels(player)
    );
    const expectedRaidable = expectedDerived.raidableResources!;
    expect(expectedRaidable).not.toBeNull();
    expect(tacticalPlanet.tactical.currentResources).toEqual(publicResources);
    expect(tacticalPlanet.tactical.productionPerHour).toEqual(expectedDerived.productionPerHour);
    expect(tacticalPlanet.tactical.storageCaps).toEqual(expectedDerived.storageCaps);
    expect(tacticalPlanet.tactical.raidableResources).toEqual(expectedRaidable);
    expect(tacticalPlanet.tactical.raidableResourceTotal).toBe(
      (BigInt(expectedRaidable.metal) + BigInt(expectedRaidable.crystal) + BigInt(expectedRaidable.deuterium)).toString()
    );
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
      blockedReasonLabel: null,
      defenderInactive: false,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        attackerScore: "1039",
        defenderScore: "1039",
        attackerVisibleScore: "15",
        defenderVisibleScore: "15",
        protected: false
      }
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
          ships: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
          defenses: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
          combatShips: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
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
          ships: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
          defenses: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
          combatShips: expect.objectContaining({ count: expect.any(Number), power: expect.any(String), units: expect.any(Array) }),
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
      data: abiWords(9n, 25000n)
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
      blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      defenderInactive: false,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        attackerScore: "51033",
        defenderScore: "1039",
        attackerVisibleScore: "50009",
        defenderVisibleScore: "8095",
        protected: true
      }
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
      data: abiWords(9n, 25000n)
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
      blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      defenderInactive: false,
      scoreComparison: {
        scoreType: "contract_total_user_score",
        attackerScore: "51033",
        defenderScore: "1039",
        attackerVisibleScore: "50009",
        defenderVisibleScore: "8095",
        protected: true
      }
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
        total: "8095",
        economy: "8080",
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

  test("reflects the public landing origin for CORS requests", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: {} as ChainReader
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10", {
      headers: {
        origin: "https://veydrift.com"
      }
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://veydrift.com");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("reflects the public landing origin for CORS preflight requests", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: {} as ChainReader
    });

    const response = await handler(new Request("http://localhost/highscores?limit=10", {
      method: "OPTIONS",
      headers: {
        origin: "https://veydrift.com"
      }
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://veydrift.com");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET,POST,DELETE,OPTIONS");
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

  test("gzips cached JSON responses when the client accepts gzip", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      enableResponseCache: true,
      prewarmResponseCache: false
    });

    const response = await handler(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=8", {
      headers: {
        "accept-encoding": "gzip"
      }
    }));
    const decoded = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString("utf8");
    const body = JSON.parse(decoded);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(body.systems).toHaveLength(17);
  });

  test("serves repeated cached reads without spending the cold-read rate limit budget", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      enableResponseCache: true,
      prewarmResponseCache: false
    });
    expect((await handler(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=1"))).status).toBe(200);

    for (let index = 0; index < 4; index += 1) {
      const response = await handler(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=1", {
        headers: {
          "x-forwarded-for": "203.0.113.9"
        }
      }));
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const rateLimited = await handler(new Request("http://localhost/universe/systems?galaxy=2&center=44&radius=1", {
      headers: {
        "x-forwarded-for": "203.0.113.9"
      }
    }));
    expect(rateLimited.status).toBe(200);
  });

  test("rate-limits repeated reads per route without starving shipyard inventory refreshes", async () => {
    const handler = createRequestHandler({
      config: configuredTestConfig,
      chainReader: new MockChainReader(),
      // Exercise the route-level limiter against a warm indexed response. A cold index emits
      // diagnostics for every request and makes this pure limiter test needlessly runner-sensitive.
      indexer: testIndexer(),
      enableResponseCache: false,
      prewarmResponseCache: false
    });
    const headers = { "x-forwarded-for": "203.0.113.10" };

    for (let index = 0; index < 40; index += 1) {
      await handler(new Request(`http://localhost/wallet/${player}/overview?planetId=7`, { headers }));
    }

    const repeatedOverview = await handler(
      new Request(`http://localhost/wallet/${player}/overview?planetId=7`, { headers })
    );
    const shipyardRefresh = await handler(
      new Request(`http://localhost/wallet/${player}/shipyard?planetId=7`, { headers })
    );

    expect(repeatedOverview.status).toBe(429);
    expect(shipyardRefresh.status).not.toBe(429);
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
  arrivalAt: arrivalAtOverride,
  missionId,
  missionTypeId = 0n,
  owner,
  randomnessRequestId = 0n,
  returnAt: returnAtOverride,
  originPlanetId,
  targetPlanetId,
}: {
  arrivalAt?: bigint;
  missionId: bigint;
  missionTypeId?: bigint;
  owner: Address;
  randomnessRequestId?: bigint;
  returnAt?: bigint;
  originPlanetId: bigint;
  targetPlanetId: bigint;
}): IndexedRpcLog[] {
  const arrivalAt = arrivalAtOverride ?? 1_800_000_000n + missionId;
  const returnAt = returnAtOverride ?? arrivalAt + 300n;
  return [
    fleetMissionLog({
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(missionTypeId)],
      data: abiWords(originPlanetId, targetPlanetId, arrivalAt, returnAt, randomnessRequestId),
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

// A launched-but-not-resolved mission (status "Outbound"): the first three logs of a completed
// mission without the trailing "returned" event.
function activeFleetMissionLogs(args: {
  arrivalAt?: bigint;
  missionId: bigint;
  missionTypeId?: bigint;
  owner: Address;
  randomnessRequestId?: bigint;
  returnAt?: bigint;
  originPlanetId: bigint;
  targetPlanetId: bigint;
}): IndexedRpcLog[] {
  return completedFleetMissionLogs(args).slice(0, 3);
}

// VEY-KANEO-489: a FleetMissionLaunched(Attack) log carrying the block timestamp the contract anchors
// the bashing window on. missionType 3 = Attack (the only type that calls _recordAttack). data word 1
// is the target planet id (word 0 origin, 2 arrival, 3 return, 4 randomness request).
function attackLaunchLog({
  missionId,
  attacker,
  targetPlanetId,
  blockTimestampSeconds,
  logIndex,
}: {
  missionId: bigint;
  attacker: Address;
  targetPlanetId: bigint;
  blockTimestampSeconds: number;
  logIndex: number;
}): IndexedRpcLog {
  return {
    blockNumber: `0x${(0x1000 + logIndex).toString(16)}`,
    blockTimestamp: blockTimestampSeconds.toString(),
    data: abiWords(9n, targetPlanetId, 1_800_000_000n, 1_800_000_300n, 0n),
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(attacker), topic(3n)],
    transactionHash: `0x${missionId.toString(16).padStart(64, "0")}`,
  };
}

// VEY-KANEO-489: a DefenseCompleted log (one point per 1,000 resources of defense unit cost), used to
// drive a wallet's highscore to a chosen value so attack-protection score gates can be exercised.
function defenseCompletedLog({
  planetId,
  defenseId,
  total,
  blockTimestampSeconds,
  logIndex,
}: {
  planetId: bigint;
  defenseId: bigint;
  total: bigint;
  blockTimestampSeconds?: number;
  logIndex: number;
}): IndexedRpcLog {
  return {
    blockNumber: `0x${(0x2000 + logIndex).toString(16)}`,
    ...(blockTimestampSeconds !== undefined ? { blockTimestamp: blockTimestampSeconds.toString() } : {}),
    data: abiWords(total, total),
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics: [defenseCompletedTopic, topic(planetId), topic(defenseId)],
    transactionHash: `0x${`def${logIndex}`.padStart(64, "0")}`,
  };
}

function researchCompletedLog({
  owner,
  technologyId,
  level,
  logIndex,
}: {
  owner: Address;
  technologyId: bigint;
  level: bigint;
  logIndex: number;
}): IndexedRpcLog {
  return {
    blockNumber: `0x${(0x3000 + logIndex).toString(16)}`,
    data: abiWords(level),
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false,
    topics: [researchCompletedTopic, addressTopic(owner), topic(technologyId)],
    transactionHash: `0x${`research${logIndex}`.padStart(64, "0")}`,
  };
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

describe("worker role gating (VEY-KANEO-466)", () => {
  test("reader workers skip every background loop but still serve reads", async () => {
    const indexer = {
      snapshot() {
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      indexer,
      role: "reader"
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    // Chain-sync ingestion and the on-chain committers must run only on the writer.
    expect(body.chainSync).toBeNull();
    expect(body.missionResolution).toBeNull();
    expect(body.randomnessCommitter).toBeNull();
    // Reader liveness must stay cheap and public debug endpoints stay unavailable.
    expect(body.indexer).toBeNull();
    expect(response.status).toBe(200);

    const debugResponse = await handler(new Request("http://localhost/debug/indexer"));
    expect(debugResponse.status).toBe(404);
  });

  test("reader debug indexer endpoint is removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-reader-debug-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const writerIndexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, { databasePath });
      writerIndexer.recordWriterChainSyncDiagnostics({
        chainSync: {
          lastPollDurationMs: 33128,
          lastGetLogsDurationMs: 17,
          lastGetLogsRange: { fromBlock: "43277454", toBlock: "43277454" },
          pollBacklogBlocks: "0",
          recentEventReceiveLagMs: { count: 100, p50: 20263, p95: 52236, max: 62933 }
        },
        chainSyncRpc: {
          callsByMethod: { eth_blockNumber: 364, eth_getLogs: 190 },
          timeouts: 0
        }
      });
      const readerIndexer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, {
        databasePath,
        readOnly: true
      });
      const handler = createRequestHandler({
        chainReader: new MockChainReader(),
        config: { ...configuredTestConfig, indexDbPath: databasePath },
        indexer: readerIndexer,
        role: "reader"
      });

      const response = await handler(new Request("http://localhost/debug/indexer"));

      expect(response.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reader workers skip mission resolution even when test config enables it", async () => {
    const indexer = {
      snapshot() {
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: {
        ...configuredTestConfig,
        missionResolutionEnabled: true,
        missionResolverAddress: "0x4444444444444444444444444444444444444444"
      },
      indexer,
      role: "reader"
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(body.missionResolution).toBeNull();
    expect(response.status).toBe(200);
  });

  test("writer health surfaces mission resolution status when enabled", async () => {
    const service = new MissionResolutionService(
      {
        ...configuredTestConfig,
        missionResolutionEnabled: true,
        missionResolverAddress: "0x4444444444444444444444444444444444444444"
      },
      {
        chainClient: {
          async listResolvableFleetMissions() {
            return [];
          },
          async listReturnableFleetMissions() {
            return [];
          },
          async resolveFleetMission() {
            return "0xresolve";
          },
          async completeFleetMissionReturn() {
            return "0xreturn";
          }
        },
        intervalMs: 60_000
      }
    );
    const indexer = {
      snapshot() {
        return {
          indexedState: "healthy",
          safeToServeIndexedState: true
        };
      }
    } as unknown as SettlementIndexer;
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: {
        ...configuredTestConfig,
        missionResolutionEnabled: true,
        missionResolverAddress: "0x4444444444444444444444444444444444444444"
      },
      indexer,
      missionResolution: service
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    service.stop();
    expect(body.missionResolution).toMatchObject({
      enabled: true,
      resolverConfigured: true,
      resolverAddress: "0x4444444444444444444444444444444444444444"
    });
    expect(response.status).toBe(503);
  });

  test("writer workers (the default) construct chain-sync and the committer", async () => {
    const indexer = new SettlementIndexer(new MockChainReader(), 100n);
    const handler = createRequestHandler({
      chainReader: new MockChainReader(),
      config: configuredTestConfig,
      indexer
    });

    const response = await handler(new Request("http://localhost/health"));
    const body = await response.json();

    expect(body.chainSync).not.toBeNull();
    expect(body.randomnessCommitter).not.toBeNull();
    expect(body.indexer).not.toBeNull();
  });

  test("writer boot skips expensive startup materialized backfill", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-server-boot-"));
    const databasePath = join(dir, "contract-state.sqlite");

    try {
      const writer = new SettlementIndexer(new MockChainReader(), configuredTestConfig.indexFromBlock, { databasePath });
      writer.applyEvent({
        ...planet,
        eventName: "PlanetStarted",
        transactionHash: "0xbootbackfill",
        blockNumber: "100"
      });
      expect(writer.walletSettlement(player)).toMatchObject({
        hasFirstPlanet: true,
        homePlanetId: planet.planetId
      });

      const database = new Database(databasePath);
      database.query("DELETE FROM contract_players").run();
      database.query("DELETE FROM contract_planets").run();
      database.query("DELETE FROM contract_planet_resources").run();
      database.close();

      const handler = createRequestHandler({
        chainReader: new MockChainReader(),
        config: {
          ...configuredTestConfig,
          indexDbPath: databasePath
        }
      });

      const response = await handler(new Request(`http://localhost/wallet/${player}/settlement`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        hasFirstPlanet: false,
        homePlanetId: null
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

async function resolvesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const result = await Promise.race([
    promise.then((value) => ({ timedOut: false as const, value })),
    new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    })
  ]);
  if (result.timedOut) {
    throw new Error(`Promise did not resolve within ${timeoutMs}ms`);
  }
  return result.value;
}

describe("shouldRecoverFailedReconciliation (VEY-KANEO-461)", () => {
  test("recovers a warm DB carrying a failed reconcile", () => {
    expect(shouldRecoverFailedReconciliation({
      lastReconciledAt: "2026-06-11T09:44:41.430Z",
      lastReconciliationError: "Unexpected end of JSON input",
      reconciliationInProgress: false
    })).toBe(true);
  });

  test("leaves a healthy warm DB untouched (no reintroduced sweep)", () => {
    expect(shouldRecoverFailedReconciliation({
      lastReconciledAt: "2026-06-11T09:44:41.430Z",
      lastReconciliationError: null,
      reconciliationInProgress: false
    })).toBe(false);
  });

  test("does not fire on a cold DB (cold-start path owns that)", () => {
    expect(shouldRecoverFailedReconciliation({
      lastReconciledAt: null,
      lastReconciliationError: "Unexpected end of JSON input",
      reconciliationInProgress: false
    })).toBe(false);
  });

  test("waits for an in-progress reconcile instead of stacking another", () => {
    expect(shouldRecoverFailedReconciliation({
      lastReconciledAt: "2026-06-11T09:44:41.430Z",
      lastReconciliationError: "Unexpected end of JSON input",
      reconciliationInProgress: true
    })).toBe(false);
  });
});
