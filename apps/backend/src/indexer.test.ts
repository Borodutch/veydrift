import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import { canonicalContractTables } from "./contractStateSchema";
import type { Address, AllianceState, CanonicalFleetMissionSnapshot, CanonicalPlanetChainState, DebrisFieldEvent, DefenseState, InfrastructureState, MoonChanceReportEvent, MoonState, PlayerQueues, ResearchState, ShipyardState, SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";
import { deriveBuildingRows, deriveDefenseRows, deriveInfrastructureFields, deriveShipRows } from "./readModels";

const player = "0x2222222222222222222222222222222222222222" as Address;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
setSystemTime(new Date("2026-01-01T00:00:00Z"));
afterAll(() => setSystemTime());
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const gameFirstPlanetSettledTopic = "0x1f673e84fe49fdcd9930a486d10cac412437f89541987902f82b43a93d86cf1c";
const legacyFirstPlanetSettledTopic = "0xb1abaa78f2f23a98f30148c8705b43e6c77e019acfeb9d5dc43085861dfad18e";
const migrationStateImportedTopic = "0xdb12a7cb693ed25a5a03977074fc4225831b157cd806cfcc62a03e06988f92d9";
const fullStateMigrationClaimedTopic = "0xc1eb9069a8811bc656d30388efd94a0e3d2c23f9783a2577482dae5dd554e793";
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const moonResourcesSettledTopic = "0xb20fd9e652e1b740544f362fb3047c43a7bf0d6c7fbf0f5cab5f1f939aac6917";
const planetRenamedTopic = "0x2b772c1fa271aad466ce009b6b5824b2ad6ccd942d21efc686513ffa8eb166cd";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const shipQueueTimingSetTopic = "0x241c6a6ecff5bf5d31df2871e9d836b18f8380508d2c5514ae9532687886d6ef";
const defenseQueueTimingSetTopic = "0xcdf898af8ba3659ffa369d372a1cacd237f74927074397a0ae531a4b60ed078e";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const planetDefenseCountChangedTopic = "0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3";
const moonShipCountChangedTopic = "0xbd55c2b529f64f3a888d38432d6c54b03515f3de3f0114255cb36620f5df1257";
const moonDefenseCountChangedTopic = "0x0bf9a31209477c6f81619cdd411e232ee9a5b64ec763c598ce43d938cc6194a2";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const researchQueuedV2Topic = "0xc656964d8e68d0b6942679e773cfa1067a21bfab5837879972bcf64c948deaa6";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const moonCreatedTopic = "0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4";
const moonResourcesChangedTopic = "0xd1823653b6a3910ee502390b5bf01f05a3b571dc81899a6ac3af3f01fae05c26";
const moonBuildingStartedTopic = "0x6b41aeb096e643752dad879b8f3875d8657186226c3cf8b6e7a38c27292f215a";
const moonBuildingCompletedTopic = "0x59b630c46c04307254808aac61ea2de2a7e6fbf5ed6eb0ebee81c917b575ed3a";
const moonDefenseQueuedTopic = "0xa53d76ce638ebf6aee45c30e9622beeafc4e9c2c9bcd3122a72a3a7e00500637";
const moonDefenseCompletedTopic = "0xb84a089b29951e8696b0ef11e5766578a0e1348284a93e4731fcb416d0536a70";
const jumpGateJumpedTopic = "0xf255456c5522e3e1e2a8063b9e1e2f5cd7243315601b1e8aef2893fe9efc3da6";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const marketResourceWithdrawalRequestedTopic = "0xc4694dfe978480c576eacc57b2b09e69c8b8f50c49739ca4c4515295be589eab";
const marketResourceWithdrawalFinishedTopic = "0x2b254e656a481b3978a707e6846146a1d7a3144e414cb803bbc7adc97d7587ee";
const riftExtractionStartedTopic = "0xe5c09fec813f00f51c26dceaa5c361061a323d98bd0b1cac790167587a3dc512";
const riftExtractionLootedTopic = "0x3f079e80fdea64b4c1bc83bafe580eda55ab7724bb9344b1e13a4c2c780784fb";
const riftExtractionFinalizedTopic = "0x31186e4a61fef32b3f8d7dcad582f862fbf906a37888ae53b7131ba2d60207a2";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceInviteCreatedTopic = "0x2ebeddd3f0119f5464f0f6acb95cbc1477a11e19b059f3234bbb0a671cf2b4bd";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
const allianceLeftTopic = "0x65b0be45688803f341e315da7be3de9dd83ebf51eb3cccb3788080695e19ec54";
const allianceRoleUpdatedTopic = "0xe4ba1cf47cfd4ff05de8585bf5cb06e7b0856932c0d81ef64a3458e26877f30d";
const allianceOwnershipTransferredTopic = "0x68f6446f7a86cbeefdd42de0fd5fe8291d2183c90343d9a43c0cdc976e5a1617";
const allianceDiplomacyUpdatedTopic = "0x3df4b2aa5708b43ef1805908826beae5c9a30fb60b1952ad99ce3444b2eec6da";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionBodiesTopic = "0xfa464e2180f08e3e4d8c4247566d0616a5e1ab845d1678c47fedae6d44e9c502";
const defenseHoldStationedTopic = "0x1183ab32cc2efce96b8c0956b35dd1b46c594234a5717fd810d8cc569a193a47";
const defenseHoldEndedTopic = "0xf72983c656a87e172935581e9c19f22826c62a2c4d552c6dd217c498a9d88586";
const fleetMissionRecalledTopic = "0x2c9b31f1abc732f3b6d28e7724439ea4713ae516632088b8c4dc0211479dc6ca";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const fleetMissionResolvedTopic = "0xcb928b431ffcdbe55fddc2bf06967951efb3dfe87d14bc436d546fdbbee9cb2d";
const attackMissionJoinedTopic = "0xc584e0cc52df45c2a92cc5556e493377d69bfe3e3658d1adb13f27cfcc89b146";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
const interplanetaryMissileAttackTopic = "0x44a8c2b7632935050468ed4d9acfb1e99a09cec32fd65811964b95b3693f872c";
const randomnessFulfilledTopic = "0x864b23caf5999ffe7e7b5bc685db237bcef9eb7bd6423c2fd395d9b4663372f5";
const startPriceUpdatedTopic = "0xdbcd6a03cdadcd71beb97d41ac0c321148e2556e112a52663ba4c94ff84d6717";
const referralInviteWindowActivatedTopic = "0xd51c9643dafa95fcfa30d65f2b6576bc03873e2630d73fc523daf87a7158d589";
const referralInviteRedeemedTopic = "0xf0e76a5aa6e423f978c7616fd6933b5d376a32654fc67c6fad0afdbc744ccce1";
const referralRewardClaimedTopic = "0x55b0859d9094fa40dfdcbcdd82c0d785132f6a627b6083e228d6bddb5e498558";
const planet: SettledPlanetEvent = {
  eventName: "PlanetStarted",
  transactionHash: "0xabc",
  blockNumber: "123",
  planetId: "7",
  owner: player,
  name: null,
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

const debris: DebrisFieldEvent = {
  eventName: "DebrisFieldUpdated",
  transactionHash: "0xdef",
  blockNumber: "124",
  planetId: planet.planetId,
  resources: {
    metal: "27000",
    crystal: "9000"
  }
};

const updatedDebris: DebrisFieldEvent = {
  ...debris,
  transactionHash: "0xdef2",
  blockNumber: "126",
  resources: {
    metal: "31000",
    crystal: "12000"
  }
};

const clearedDebris: DebrisFieldEvent = {
  ...debris,
  transactionHash: "0xdef3",
  blockNumber: "127",
  resources: {
    metal: "0",
    crystal: "0"
  }
};

const moonChance: MoonChanceReportEvent = {
  eventName: "MoonChanceRequested",
  transactionHash: "0xghi",
  blockNumber: "125",
  battleId: "42",
  targetPlanetId: planet.planetId,
  outcomeId: "5",
  defender: player,
  metalDebris: "90000",
  crystalDebris: "10000",
  chanceBps: 100
};

describe("SettlementIndexer", () => {
  test("projects all due resolver legs from canonical active rows without history reconstruction", () => {
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { database });
    const insert = database.query(`
      INSERT INTO contract_fleet_missions (
        mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id,
        departure_at, arrival_at, return_at, fuel_cost,
        metal_cargo, crystal_cargo, deuterium_cargo, ships_json, randomness_request_id, event_json
      ) VALUES (?, ?, ?, ?, '85', '86', '800', ?, ?, '0', '0', '0', '0', '{}', ?, NULL)
    `);
    const arrivalTypes = [
      ["1", 0, "Transport"],
      ["2", 1, "Deploy"],
      ["3", 2, "Colonize"],
      ["4", 3, "Attack"],
      ["5", 4, "Harvest"],
      ["6", 9, "DefenseHold"]
    ] as const;
    for (const [missionId, missionTypeId] of arrivalTypes) {
      insert.run(missionId, 1, missionTypeId, player, "900", "900", missionTypeId === 3 ? "44" : null);
    }
    insert.run("7", 2, 0, player, "800", "900", null);
    insert.run("8", 5, 3, player, "800", "850", null);
    insert.run("9", 1, 5, player, "900", "900", null); // AcsDefend is not permissionlessly resolved here.
    insert.run("10", 1, 0, player, "1100", "1200", null); // Future arrival.

    const candidates = indexer.missionResolutionCandidates(1_000);

    expect(candidates.arrivals.map((mission) => mission.missionType)).toEqual(
      arrivalTypes.map(([, , missionType]) => missionType)
    );
    expect(candidates.returns).toEqual([
      expect.objectContaining({ missionId: "8", missionType: "Attack", returnAt: "850" }),
      expect.objectContaining({ missionId: "7", missionType: "Transport", returnAt: "900" })
    ]);
    database.close();
  });

  test("excludes an arrived attack while its configured randomness is genuinely pending", () => {
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { database, randomnessEngineConfigured: true });
    database.query(`
      INSERT INTO contract_fleet_missions (
        mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id,
        departure_at, arrival_at, return_at, fuel_cost,
        metal_cargo, crystal_cargo, deuterium_cargo, ships_json, randomness_request_id, event_json
      ) VALUES ('44', 1, 3, ?, '85', '86', '800', '900', '1200', '0', '0', '0', '0', '{}', '77', NULL)
    `).run(player);

    expect(indexer.missionResolutionCandidates(1_000)).toEqual({ arrivals: [], returns: [] });
    database.close();
  });

  test("persists indexed contract state for read-side reuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return [debris]; },
        async listMoonChanceReportEvents() { return [moonChance]; },
        async listSettledPlanetEvents() { return [planet]; }
      }, 100n, { databasePath });

      await expect(first.rebuild()).resolves.toMatchObject({
        indexedDebrisFields: 1,
        indexedMoonChanceReports: 1,
        indexedPlanets: 1,
        lastReconciliationError: null,
        lastReconciledBlock: "125"
      });

      const second = new SettlementIndexer({
        async listDebrisFieldEvents() { throw new Error("chain should not be read"); },
        async listMoonChanceReportEvents() { throw new Error("chain should not be read"); },
        async listSettledPlanetEvents() { throw new Error("chain should not be read"); }
      }, 100n, { databasePath });

      expect(second.snapshot()).toMatchObject({
        indexedDebrisFields: 1,
        indexedMoonChanceReports: 1,
        indexedPlanets: 1
      });
      expect(second.walletSettlement(player)).toMatchObject({
        wallet: player,
        hasFirstPlanet: true,
        homePlanetId: planet.planetId,
        planet: {
          planetId: planet.planetId,
          owner: player
        }
      });
      expect(second.debrisFieldsInSystem(2, 44)).toEqual([
        expect.objectContaining({
          planetId: planet.planetId,
          position: 9,
          resources: debris.resources
        })
      ]);
      expect(second.moonChanceReportsInSystem(2, 44)).toEqual([
        expect.objectContaining({
          battleId: "42",
          position: 9,
          targetPlanetId: planet.planetId
        })
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("can skip startup materialized backfill for reader workers", async () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };

    const first = new SettlementIndexer(reader, 100n, { database });
    await first.rebuild();
    expect(first.walletSettlement(player)).toMatchObject({
      hasFirstPlanet: true,
      homePlanetId: planet.planetId
    });

    database.query("DELETE FROM contract_players").run();
    database.query("DELETE FROM contract_planets").run();
    database.query("DELETE FROM contract_planet_resources").run();

    const readerRestart = new SettlementIndexer(reader, 100n, {
      database,
      runStartupBackfill: false
    });
    expect(readerRestart.snapshot().indexedPlanets).toBe(1);
    expect(readerRestart.walletSettlement(player)).toMatchObject({
      hasFirstPlanet: false,
      homePlanetId: null
    });

    const writerRestart = new SettlementIndexer(reader, 100n, {
      database,
      runStartupBackfill: true
    });
    expect(writerRestart.walletSettlement(player)).toMatchObject({
      hasFirstPlanet: true,
      homePlanetId: planet.planetId
    });
  });

  test("narrowly backfills historical DefenseHoldEnded logs even when broad startup backfill is disabled", () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    };
    new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
    const eventId = "legacy-defense-hold-ended";
    const log = {
      blockNumber: "0x70",
      transactionHash: `0x${"71".repeat(32)}`,
      logIndex: "0x2",
      removed: false,
      topics: [defenseHoldEndedTopic, topic(2847n), topic(236n)],
      data: abiWords(5n)
    };
    database.query(`
      INSERT INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(eventId, log.transactionHash, log.logIndex, "112", JSON.stringify(log), new Date().toISOString());
    database.query("DELETE FROM indexer_metadata WHERE key = 'defenseHoldEndedMissionEventsBackfilledV1'").run();

    new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });

    expect(database.query(`
      SELECT event_kind, block_number
      FROM indexed_mission_event_logs
      WHERE event_id = ?
    `).get(eventId)).toEqual({ event_kind: "fleet", block_number: "112" });
  });

  test("queues only canonical legacy battle reports for defender-loss backfill on reader startup", () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    };
    new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
    const reportJson = JSON.stringify({
      missionId: "42",
      defenderLosses: { metal: "0", crystal: "0", deuterium: "0" }
    });
    const insert = database.query(`
      INSERT INTO indexed_battle_report_read_models (
        mission_id, status, report_json, error, attempts, duration_ms, block_number, updated_at
      )
      VALUES (?, 'ready', ?, NULL, 1, 1, '100', ?)
    `);
    const now = new Date().toISOString();
    insert.run("42", reportJson, now);
    insert.run("43", reportJson, now);
    database.query("DELETE FROM indexer_metadata WHERE key = 'defenderLossBreakdownBackfillV1'").run();

    new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });

    expect(database.query(`
      SELECT mission_id, status
      FROM indexed_battle_report_read_models
      ORDER BY mission_id
    `).all()).toEqual([
      { mission_id: "42", status: "pending" },
      { mission_id: "43", status: "ready" }
    ]);
    database.close();
  });

  test("indexes canonical referral claim, payout, credit, and reward-claim events", () => {
    const invitee = "0x3333333333333333333333333333333333333333" as Address;
    const code = "custom_code";
    const codeHash = keccak256(toHex(code));
    const commitment = `0x${"12".repeat(32)}` as `0x${string}`;
    const claimTxHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const redemptionTxHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const rewardClaimTxHash = `0x${"de".repeat(32)}` as `0x${string}`;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: claimTxHash,
      logIndex: "0x0",
      topics: [referralInviteWindowActivatedTopic, addressTopic(player), codeHash, commitment],
      data: encodeAbiParameters(
        parseAbiParameters("string,uint64,uint64,bool"),
        [code, 1783526400n, 1783612800n, false]
      )
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: redemptionTxHash,
      logIndex: "0x0",
      topics: [referralInviteRedeemedTopic, addressTopic(player), addressTopic(invitee), commitment],
      data: abiWords(25_000_000_000_000_000n, 0n, 1n, 1783526500n)
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: rewardClaimTxHash,
      logIndex: "0x0",
      topics: [referralRewardClaimedTopic, addressTopic(player), addressTopic(invitee), commitment],
      data: abiWords(BigInt(player), 25_000_000_000_000_000n, 1783526600n)
    });

    expect(indexer.referralClaim(player, commitment, claimTxHash)).toMatchObject({
      inviter: player,
      code,
      codeHash,
      commitment,
      transactionHash: claimTxHash,
      claimedAt: "1783526400",
      activeUntil: "1783612800"
    });
    expect(indexer.referralClaim(player, commitment, redemptionTxHash)).toBeNull();
    expect(indexer.referralRedemption(player, invitee, commitment, redemptionTxHash)).toMatchObject({
      inviter: player,
      invitee,
      commitment,
      transactionHash: redemptionTxHash,
      rewardAmount: "25000000000000000",
      paid: false,
      credited: true,
      redeemedAt: "1783526500"
    });
    expect(indexer.referralRedemption(invitee, invitee, commitment, redemptionTxHash)).toBeNull();
    expect(indexer.referralClaims(player)).toHaveLength(1);
    expect(indexer.referralClaimsByCodeHash(codeHash)).toHaveLength(1);
    expect(indexer.referralRedemptionsForInviter(player)).toHaveLength(1);
    expect(indexer.referralRedemptionPageForInviter(player, 1, 25)).toMatchObject({
      page: 1,
      pageSize: 25,
      totalEntries: 1,
      redemptions: [{ invitee, transactionHash: redemptionTxHash }]
    });
    expect(indexer.referralRedemptionsForInvitee(invitee)).toHaveLength(1);
    expect(indexer.referralRewardClaimsForInviter(player)).toEqual([
      expect.objectContaining({
        inviter: player,
        invitee,
        commitment,
        recipient: player,
        amount: "25000000000000000",
        claimedAt: "1783526600"
      })
    ]);
  });

  test("projects mutable start price from events, survives restart repair, and records bootstrap divergence", () => {
    const database = new Database(":memory:");
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    };
    const bootstrapStartPriceWei = "50000000000000000";
    const indexedStartPriceWei = "12000000000000000";
    const indexer = new SettlementIndexer(reader, 100n, {
      database,
      settlementStartPriceWei: bootstrapStartPriceWei
    });

    expect(indexer.currentStartPriceWei()).toBe(bootstrapStartPriceWei);
    expect(indexer.snapshot().startPriceSource).toBe("bootstrap");
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: `0x${"ef".repeat(32)}`,
      logIndex: "0x0",
      topics: [startPriceUpdatedTopic],
      data: abiWords(BigInt(bootstrapStartPriceWei), BigInt(indexedStartPriceWei))
    });

    expect(indexer.currentStartPriceWei()).toBe(indexedStartPriceWei);
    expect(indexer.snapshot()).toMatchObject({
      startPriceSource: "event",
      startPriceWei: indexedStartPriceWei
    });
    expect(indexer.snapshot().startPriceBootstrapDivergence).toContain(bootstrapStartPriceWei);
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: `0x${"ee".repeat(32)}`,
      logIndex: "0x1",
      topics: [startPriceUpdatedTopic],
      data: abiWords(60_000_000_000_000_000n, 70_000_000_000_000_000n)
    });
    expect(indexer.currentStartPriceWei()).toBe(indexedStartPriceWei);

    // Model upgrading an existing DB that already has the raw event but not the new projection.
    database.query("DELETE FROM indexer_metadata WHERE key LIKE '%StartPrice%' OR key LIKE 'startPrice%'").run();
    const restarted = new SettlementIndexer(reader, 100n, {
      database,
      runStartupBackfill: false,
      settlementStartPriceWei: bootstrapStartPriceWei
    });
    expect(restarted.currentStartPriceWei()).toBe(indexedStartPriceWei);
    expect(restarted.snapshot().startPriceSource).toBe("event");
  });

  test("seeds current start price from the canonical chain read during an explicit rebuild", async () => {
    const canonicalStartPriceWei = "18000000000000000";
    const indexer = new SettlementIndexer({
      async getBlockNumber() { return 200n; },
      async getStartPrice() { return canonicalStartPriceWei; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, {
      settlementStartPriceWei: "50000000000000000"
    });

    await indexer.rebuild();
    expect(indexer.snapshot()).toMatchObject({
      startPriceSource: "rebuild",
      startPriceWei: canonicalStartPriceWei
    });
    indexer.applyLog({
      blockNumber: "0xc7",
      transactionHash: `0x${"ed".repeat(32)}`,
      logIndex: "0x1",
      topics: [startPriceUpdatedTopic],
      data: abiWords(10_000_000_000_000_000n, 11_000_000_000_000_000n)
    });
    expect(indexer.currentStartPriceWei()).toBe(canonicalStartPriceWei);
  });

  test("surfaces a real error when the cold rebuild stalls past its deadline (VEY-KANEO-485)", async () => {
    // The incident: a wiped indexer DB pointed at the only (range-capped, self-hosted) RPC could not
    // finish the deploy->head backfill, so the index sat in reconciliation_in_progress with
    // lastReconciliationError=null forever. A stalled chain read must now reject with a real error the
    // boot-time recovery can retry. Model the stall with a settled-planet backfill that never resolves.
    const indexer = new SettlementIndexer({
      listDebrisFieldEvents() { return new Promise<never>(() => {}); },
      listMoonChanceReportEvents() { return new Promise<never>(() => {}); },
      listSettledPlanetEvents() { return new Promise<never>(() => {}); }
    }, 100n, { rebuildDeadlineMs: 20 });

    await expect(indexer.rebuild()).rejects.toThrow(/exceeded 20ms deadline/);

    const snapshot = indexer.snapshot();
    expect(snapshot.reconciliationInProgress).toBe(false);
    expect(snapshot.lastReconciliationError).toMatch(/exceeded 20ms deadline/);
    expect(snapshot.lastReconciledAt).toBeNull();
  });

  test("creates canonical mirror tables and preserves existing indexed state", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      indexer.applyEvent(planet);
      indexer.applyDebrisEvent(debris);
      indexer.applyMoonChanceEvent(moonChance);

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

      const db = new Database(databasePath, { readonly: true });
      try {
        const schemaNames = new Set(
          (db.query("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all() as Array<{ name: string }>)
            .map((row) => row.name)
        );
        for (const table of canonicalContractTables) {
          expect(schemaNames.has(table)).toBe(true);
        }

        expect(db.query("SELECT owner, galaxy, system_number, position FROM contract_planets WHERE planet_id = ?").get(planet.planetId)).toEqual({
          owner: player.toLowerCase(),
          galaxy: planet.galaxy,
          system_number: planet.system,
          position: planet.position
        });
        expect(db.query("SELECT metal, crystal, deuterium FROM contract_planet_resources WHERE planet_id = ?").get(planet.planetId)).toEqual({
          metal: "4600",
          crystal: "4780",
          deuterium: "4740"
        });
        expect(db.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get(planet.planetId, 5)).toEqual({
          level: 1
        });
        expect(db.query("SELECT metal, crystal FROM contract_debris_fields WHERE planet_id = ?").get(planet.planetId)).toEqual({
          metal: debris.resources.metal,
          crystal: debris.resources.crystal
        });
        expect(db.query("SELECT battle_id, outcome_id FROM contract_moon_chance_reports WHERE report_key = ?").get("outcome:5")).toEqual({
          battle_id: moonChance.battleId,
          outcome_id: moonChance.outcomeId
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("repairs materialized building levels from stored completion logs on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x2869251",
        transactionHash: "0x7ff7ffb3a61c90be59598960d8bfd95ecc455cfba667e206499e9c0f1c2eede4",
        logIndex: "0x46",
        topics: [
          buildingCompletedTopic,
          topic(1n),
          topic(10n)
        ],
        data: abiWords(1n)
      });

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("UPDATE indexed_building_levels SET level = 0 WHERE planet_id = ? AND building_id = ?").run("1", 10);
        staleDb.query("UPDATE contract_building_levels SET level = 0 WHERE planet_id = ? AND building_id = ?").run("1", 10);
        expect(staleDb.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get("1", 10)).toEqual({
          level: 0
        });
      } finally {
        staleDb.close();
      }

      const repaired = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      expect(repaired.infrastructureRows("1").find((building) => building.id === 10)?.level).toBe(1);
      const repairedDb = new Database(databasePath, { readonly: true });
      try {
        expect(repairedDb.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get("1", 10)).toEqual({
          level: 1
        });
      } finally {
        repairedDb.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("replays active production queue starts from stored event logs on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x290",
        transactionHash: "0xreplay-building",
        logIndex: "0x0",
        topics: [buildingStartedTopic, topic(7n), topic(6n)],
        data: abiWords(2n, 1770002000n, 100n, 50n, 0n)
      });
      first.applyLog({
        blockNumber: "0x291",
        transactionHash: "0xreplay-research",
        logIndex: "0x0",
        topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
        data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
      });
      first.applyLog({
        blockNumber: "0x292",
        transactionHash: "0xreplay-ship",
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 1770002200n, 60n, 30n, 0n)
      });
      first.applyLog({
        blockNumber: "0x293",
        transactionHash: "0xreplay-defense",
        logIndex: "0x0",
        topics: [defenseQueuedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 1770002300n, 40n, 20n, 0n)
      });
      const resourcesAfterStarts = first.walletSettlement(player).planet?.resources;

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("DELETE FROM indexed_planet_queues").run();
        staleDb.query("DELETE FROM contract_production_queues").run();
      } finally {
        staleDb.close();
      }

      const replayed = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      expect(replayed.playerQueues(player, planet.planetId)).toMatchObject({
        building: { kind: "building", itemId: 6, targetLevel: 2, readyAt: "1770002000" },
        research: { kind: "research", itemId: 4, targetLevel: 2, readyAt: "1770002100" },
        ship: { kind: "ship", itemId: 2, quantity: 3, readyAt: "1770002200" },
        defense: { kind: "defense", itemId: 1, quantity: 5, readyAt: "1770002300" }
      });
      expect(replayed.walletSettlement(player).planet?.resources).toEqual(resourcesAfterStarts);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("settles accrued resources before subtracting indexed queued spends", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
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

    indexer.applyLog({
      blockNumber: "0x83",
      blockTimestamp: "0x69801c90",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(5n)],
      data: abiWords(1n, 1770004000n, 400n, 120n, 60n)
    });

    const updated = indexer.walletSettlement(player).planet;
    expect(updated?.lastSettledAt).toBe("1770003600");
    expect(Number(updated?.resources.metal)).toBeGreaterThan(4600);
    expect(Number(updated?.resources.metal)).toBeLessThan(5000);
    expect(Number(updated?.resources.crystal)).toBe(4780);
  });

  test("serves planet resources from a PlanetSettled event alone, never an on-the-fly RPC read (VEY-KANEO-475)", () => {
    // Foundation invariant: with the contract now emitting the authoritative PlanetSettled balance on
    // every discrete resource mutation (cost spend, cargo/loot credit, collect, colony, start), the
    // latest event balance plus the read model's local production projection are sufficient to serve
    // resources — the serve path must never fall back to previewResources/getInfrastructureState RPC.
    // This reader throws on every on-the-fly state read, so the test passing proves none were called.
    const rpcForbidden = () => {
      throw new Error("on-the-fly RPC read at serve time is forbidden (VEY-KANEO-475)");
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      getInfrastructureState: rpcForbidden,
      getShipyardState: rpcForbidden,
      getDefenseState: rpcForbidden,
      getResearchState: rpcForbidden,
      getPlayerQueues: rpcForbidden,
      getPlanet: rpcForbidden
    } as never, 100n);

    indexer.applyEvent(planet);
    // Simulates the contract emitting PlanetSettled at the end of a build/ship/defense spend: the
    // final post-spend balance, settled to the spend's block timestamp. `settledAt == now` so the
    // production projection contributes nothing and the served balance equals the event exactly.
    const now = Math.floor(Date.now() / 1000);
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xspend",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(1234n, 567n, 89n, BigInt(now))
    });

    const served = indexer.walletSettlement(player).planet;
    expect(served?.lastSettledAt).toBe(String(now));
    expect(served?.resources).toEqual({ metal: "1234", crystal: "567", deuterium: "89" });
  });

  test("research queue events never debit the home planet and V2 preserves payer attribution", () => {
    const database = new Database(":memory:");
    const home = {
      ...planet,
      planetId: "74",
      resources: { metal: "95943", crystal: "48618", deuterium: "19956" }
    };
    const colony = {
      ...planet,
      planetId: "380",
      position: 10,
      resources: { metal: "104236", crystal: "51710", deuterium: "12066" }
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { database });
    indexer.applyEvent(home);
    indexer.applyEvent(colony);

    const transactionHash = "0x31b598712302453db135fa350e4cde562e58fe49197907ef892ad181e9589a8e";
    indexer.applyLog({
      blockNumber: "0x100",
      transactionHash,
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(380n)],
      data: abiWords(1836n, 510n, 12066n, 1770003600n)
    });
    indexer.applyLog({
      blockNumber: "0x100",
      transactionHash,
      logIndex: "0x1",
      topics: [researchQueuedTopic, topic(BigInt(player)), topic(0n)],
      data: abiWords(10n, 1770007200n, 102400n, 51200n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x100",
      transactionHash,
      logIndex: "0x2",
      topics: [researchQueuedV2Topic, topic(BigInt(player)), topic(380n), topic(0n)],
      data: abiWords(10n, 1770007200n, 102400n, 51200n, 0n)
    });

    expect(indexer.planet("74")?.resources).toEqual(home.resources);
    expect(indexer.planet("380")?.resources).toEqual({
      metal: "1836",
      crystal: "510",
      deuterium: "12066"
    });
    expect(indexer.researchQueue(player)).toMatchObject({
      active: true,
      itemId: 0,
      planetId: "380",
      targetLevel: 10
    });
    expect(database.query(`
      SELECT planet_id
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(`research:${player}`)).toEqual({ planet_id: "380" });
  });

  test("canonical in-writer resource heal restores raw resources and is idempotent", async () => {
    const database = new Database(":memory:");
    const home = {
      ...planet,
      planetId: "74",
      lastSettledAt: "1770003600",
      resources: { metal: "95943", crystal: "48618", deuterium: "19956" }
    };
    let reads = 0;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async getBlockNumber() { return 200n; },
      async listCurrentPlanets() {
        reads += 1;
        return [home];
      }
    }, 100n, { database });
    indexer.applyEvent(home);
    database.query(`
      UPDATE contract_planet_resources
      SET metal = '0', crystal = '0', deuterium = '19956',
          transaction_hash = '0xcorrupted', block_number = '150'
      WHERE planet_id = '74'
    `).run();

    await indexer.startCanonicalResourceHealOnce("research-resource-heal-20260728");

    expect(indexer.planet("74")).toMatchObject({
      lastSettledAt: "1770003600",
      resources: home.resources
    });
    expect(indexer.snapshot()).toMatchObject({
      lastCanonicalResourceHealRunId: "research-resource-heal-20260728",
      lastCanonicalResourceHealPlanetsScanned: 1
    });

    await indexer.startCanonicalResourceHealOnce("research-resource-heal-20260728");
    expect(reads).toBe(1);
  });

  test("settles resources at the old production rate up to readyAt when a building upgrade completes (VEY-KANEO-429)", () => {
    // Regression: the read-model projects `resources` forward from `lastSettledAt`
    // at the CURRENT production rate. When a metal-mine upgrade completed, the
    // indexer bumped the building level (raising the rate) but never settled the
    // pre-completion window or advanced `lastSettledAt`. The projection then
    // applied the new, higher rate over the whole window since the last settle,
    // over-reporting metal by up to ~3x. The contract instead settles
    // [lastSettledAt, readyAt] at the old rate, completes the building, then
    // accrues at the new rate from readyAt (VeydriftGame.sol:720-730).
    const startTs = 1_770_000_000;
    const readyAt = startTs + 3_600; // build window of exactly one hour
    const oldMineLevel = 4;
    const newMineLevel = 8;
    const solarLevel = 30; // plenty of energy so production is not throttled

    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });

    // Establish baseline building levels (no queue -> no settle), so the metal
    // mine starts at `oldMineLevel` with the planet settled at `startTs`.
    for (const [buildingId, level] of [[0, oldMineLevel], [3, solarLevel]] as const) {
      indexer.applyLog({
        blockNumber: "0x80",
        transactionHash: `0xbase${buildingId}`,
        logIndex: "0x0",
        topics: [buildingCompletedTopic, topic(7n), topic(BigInt(buildingId))],
        data: abiWords(BigInt(level))
      });
    }

    const planetState = { ...planet, lastSettledAt: startTs.toString() };
    const oldRate = deriveInfrastructureFields(
      planetState,
      deriveBuildingRows((id) => (id === 0 ? oldMineLevel : id === 3 ? solarLevel : 0)),
      deriveShipRows(() => 0),
      {}
    ).productionPerHour;
    if (!oldRate) throw new Error("expected a derivable old production rate");
    expect(Number(oldRate.metal)).toBeGreaterThan(0);

    const beforeUpgrade = indexer.walletSettlement(player).planet;
    expect(beforeUpgrade?.lastSettledAt).toBe(startTs.toString());
    const metalBeforeUpgrade = Number(beforeUpgrade?.resources.metal);

    // Start the mine upgrade. The spend settles to `startTs` (zero elapsed here)
    // and queues the upgrade with readyAt one hour out. Cost is zero to keep the
    // arithmetic focused on accrual.
    indexer.applyLog({
      blockNumber: "0x81",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xupgrade",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(BigInt(newMineLevel), BigInt(readyAt), 0n, 0n, 0n)
    });
    expect(indexer.planetQueue(planet.planetId, "building")?.readyAt).toBe(readyAt.toString());

    // Complete the upgrade.
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xupgradedone",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(BigInt(newMineLevel))
    });

    const afterUpgrade = indexer.walletSettlement(player).planet;
    // Baseline advances to readyAt...
    expect(afterUpgrade?.lastSettledAt).toBe(readyAt.toString());
    // ...and the settled metal reflects one hour at the OLD mine rate, not the new one.
    const expectedMetal = metalBeforeUpgrade + Math.floor((Number(oldRate.metal) * (readyAt - startTs)) / 3_600);
    expect(Number(afterUpgrade?.resources.metal)).toBe(expectedMetal);
    // The completed level is applied for subsequent (post-readyAt) accrual.
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(newMineLevel);

    // Validation: the read-model projected forward past readyAt must equal the
    // contract's previewResources, i.e. one hour at the old rate plus the rest at
    // the new rate, with no double-counting of the pre-completion window. Force a
    // settle to readyAt + 1h via a zero-cost spend.
    const projectTo = readyAt + 3_600;
    indexer.applyLog({
      blockNumber: "0x83",
      blockTimestamp: `0x${projectTo.toString(16)}`,
      transactionHash: "0xproject",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, BigInt(projectTo + 3_600), 0n, 0n, 0n)
    });
    const newRate = deriveInfrastructureFields(
      planetState,
      deriveBuildingRows((id) => (id === 0 ? newMineLevel : id === 3 ? solarLevel : 0)),
      deriveShipRows(() => 0),
      {}
    ).productionPerHour;
    if (!newRate) throw new Error("expected a derivable new production rate");
    const projected = indexer.walletSettlement(player).planet;
    expect(projected?.lastSettledAt).toBe(projectTo.toString());
    const previewOracle = metalBeforeUpgrade
      + Math.floor((Number(oldRate.metal) * (readyAt - startTs)) / 3_600)
      + Math.floor((Number(newRate.metal) * (projectTo - readyAt)) / 3_600);
    expect(Number(projected?.resources.metal)).toBe(previewOracle);
  });

  test("does not settle resources to a different active building queue's readyAt on replay", () => {
    const startTs = 1_781_631_864;
    const futureReadyAt = 1_781_648_416;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });

    indexer.applyLog({
      blockNumber: "0x100",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xfuture-building-start",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(17n, BigInt(futureReadyAt), 0n, 0n, 0n)
    });

    indexer.applyLog({
      blockNumber: "0x101",
      blockTimestamp: `0x${(startTs + 60).toString(16)}`,
      transactionHash: "0xold-building-finish",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(2n)],
      data: abiWords(8n)
    });

    const served = indexer.walletSettlement(player).planet;
    expect(served?.lastSettledAt).toBe(startTs.toString());
    expect(indexer.planetQueue(planet.planetId, "building")).toMatchObject({
      itemId: 3,
      targetLevel: 17,
      readyAt: futureReadyAt.toString()
    });
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 2)?.level).toBe(8);
  });

  test("startup event replay repairs stale resource snapshots from stored PlanetSettled logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x100",
        blockTimestamp: "0x6a2ad09c",
        transactionHash: "0xstored-settle",
        logIndex: "0x2",
        topics: [planetSettledTopic, topic(7n)],
        data: abiWords(15704n, 13731n, 9994n, 1781631864n)
      });

      const staleDb = new Database(databasePath);
      try {
        staleDb.query(`
          UPDATE contract_planet_resources
          SET metal = '25419', crystal = '18411', deuterium = '10738',
            last_settled_at = '1781648416', log_index = '0x0'
          WHERE planet_id = ?
        `).run("7");
        staleDb.query(`
          UPDATE contract_planets
          SET last_settled_at = '1781648416'
          WHERE planet_id = ?
        `).run("7");
      } finally {
        staleDb.close();
      }

      new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      const repairedDb = new Database(databasePath, { readonly: true });
      try {
        expect(repairedDb.query(`
          SELECT metal, crystal, deuterium, last_settled_at, log_index
          FROM contract_planet_resources
          WHERE planet_id = ?
        `).get("7")).toEqual({
          metal: "15704",
          crystal: "13731",
          deuterium: "9994",
          last_settled_at: "1781631864",
          log_index: "0x2"
        });
      } finally {
        repairedDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects elapsed building queues as completed for served building levels", () => {
    // A crystal-storage upgrade whose build timer has elapsed by wall-clock is still active in
    // contract storage until a transaction finalizes it and emits BuildingCompleted. Served UI
    // state projects that timer as completed so the building does not appear stuck.
    // Both timestamps sit before the suite's mocked clock (2026-01-01), so the queued upgrade's
    // build timer has already elapsed by wall-clock and would be optimistically completed.
    const startTs = 1_767_000_000;
    const elapsedReadyAt = startTs + 3_600;

    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });

    // Contract-authoritative crystal storage (building id 8) is level 1 -> cap 20,000.
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xcrystalstoragebase",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(8n)],
      data: abiWords(1n)
    });

    // Queue a crystal-storage upgrade to level 2 with a readyAt already in the past, but never emit
    // its BuildingCompleted.
    indexer.applyLog({
      blockNumber: "0x81",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xcrystalstorageupgrade",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(8n)],
      data: abiWords(2n, BigInt(elapsedReadyAt), 0n, 0n, 0n)
    });

    const rows = indexer.infrastructureRows(planet.planetId);
    expect(rows.find((building) => building.id === 8)?.level).toBe(2);
    expect(indexer.playerQueues(player, planet.planetId).building).toBeNull();
    const caps = deriveInfrastructureFields(
      { ...planet, lastSettledAt: startTs.toString() },
      rows,
      deriveShipRows(() => 0),
      {}
    ).storageCaps;
    expect(caps?.crystal).toBe("40000");

    // A non-storage building (metal mine, id 0) under the identical elapsed-queue setup also
    // projects to the completed level.
    const mineIndexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    mineIndexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });
    mineIndexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xminebase",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n)
    });
    mineIndexer.applyLog({
      blockNumber: "0x81",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xmineupgrade",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(8n, BigInt(elapsedReadyAt), 0n, 0n, 0n)
    });
    expect(mineIndexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(8);
    // The later completion log is monotonic and does not double-advance the level.
    mineIndexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xminedone",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(8n)
    });
    expect(mineIndexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(8);
    expect(mineIndexer.playerQueues(player, planet.planetId).building).toBeNull();
  });

  test("serves indexed activity and projected lazy queue completions from one feed", () => {
    const startTs = 1_767_000_000;
    const readyAt = startTs + 3_600;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });
    indexer.applyLog({
      blockNumber: "0x81",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xactivity-start",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(8n, BigInt(readyAt), 0n, 0n, 0n)
    });

    const history = indexer.playerActivity(player, { page: 1, pageSize: 25, through: readyAt + 10 });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      kind: "building-started",
      title: "Metal Mine upgrade started",
      detail: "Planet #7 · 2:44:9 · Level 8; ready 1767003600",
      transactionHash: "0xactivity-start",
      reconciliation: "indexed"
    });

    const away = indexer.playerActivity(player, {
      page: 1,
      pageSize: 25,
      since: startTs + 1,
      through: readyAt + 10,
      includeProjected: true
    });
    expect(away.items).toHaveLength(1);
    expect(away.summary).toEqual({ infrastructure: 1 });
    expect(away.items[0]).toMatchObject({
      kind: "building-completed",
      title: "Metal Mine completed",
      detail: "Planet #7 · 2:44:9 · Level 8",
      occurredAt: readyAt.toString(),
      transactionHash: null,
      relatedTransactionHash: "0xactivity-start",
      reconciliation: "projected"
    });
  });

  test("records settlement once and collapses migrated planets into one migration action", () => {
    const transactionAt = 1_767_100_000;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const settlementHash = "0xactivity-settlement";
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: `0x${transactionAt.toString(16)}`,
      transactionHash: settlementHash,
      logIndex: "0x0",
      topics: [planetStartedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
    });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: `0x${transactionAt.toString(16)}`,
      transactionHash: settlementHash,
      logIndex: "0x1",
      topics: [gameFirstPlanetSettledTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 0n, 0n)
    });

    const settlementActivity = indexer.playerActivity(player, { page: 1, pageSize: 25 }).items;
    expect(settlementActivity).toHaveLength(1);
    expect(settlementActivity[0]).toMatchObject({
      kind: "planet-started",
      title: "Home planet settled",
      detail: "Planet #7 · 2:44:9",
      transactionHash: settlementHash
    });

    const migrationHash = "0xactivity-migration";
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: `0x${(transactionAt + 10).toString(16)}`,
      transactionHash: migrationHash,
      logIndex: "0x0",
      topics: [planetStartedTopic, addressTopic(player), topic(8n)],
      data: abiWords(3n, 12n, 4n, 190n, signedWord(20n))
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: `0x${(transactionAt + 10).toString(16)}`,
      transactionHash: migrationHash,
      logIndex: "0x1",
      topics: [migrationStateImportedTopic, addressTopic(player)],
      data: abiWords(7n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: `0x${(transactionAt + 10).toString(16)}`,
      transactionHash: migrationHash,
      logIndex: "0x2",
      topics: [fullStateMigrationClaimedTopic, addressTopic(player), topic(123n)],
      data: "0x"
    });

    const history = indexer.playerActivity(player, { page: 1, pageSize: 25 });
    expect(history.items.filter((item) => item.transactionHash === migrationHash)).toEqual([
      expect.objectContaining({
        kind: "state-migrated",
        title: "Game state migrated",
        detail: "2 planets restored",
        metadata: expect.objectContaining({
          homePlanetId: "7",
          planetCount: 2,
          stateHash: topic(123n)
        })
      })
    ]);
  });

  test("records legacy settlement activity when no PlanetStarted event exists", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyLog({
      blockNumber: "0x92",
      blockTimestamp: "0x6955b900",
      transactionHash: "0xlegacy-settlement",
      logIndex: "0x0",
      topics: [legacyFirstPlanetSettledTopic, addressTopic(player), topic(4n), topic(20n)],
      data: abiWords(6n, 0n, 0n)
    });

    expect(indexer.playerActivity(player, { page: 1, pageSize: 25 }).items[0]).toMatchObject({
      kind: "planet-started",
      title: "Home planet settled",
      detail: "4:20:6",
      metadata: { planetId: null }
    });
  });

  test("runs the V2 activity reconciliation in production startup mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-activity-v2-"));
    const databasePath = join(dir, "activity.sqlite");
    try {
      const firstDatabase = new Database(databasePath);
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { database: firstDatabase });
      first.applyLog({
        blockNumber: "0x93",
        blockTimestamp: "0x6955b900",
        transactionHash: "0xbackfilled-settlement",
        logIndex: "0x0",
        topics: [legacyFirstPlanetSettledTopic, addressTopic(player), topic(5n), topic(21n)],
        data: abiWords(7n, 0n, 0n)
      });
      firstDatabase.query("UPDATE indexed_player_activity_feed SET activity_json = json_set(activity_json, '$.title', 'Stale V1 title')").run();
      firstDatabase.query("DELETE FROM indexer_metadata WHERE key = 'playerActivityFeedBackfilledV2'").run();
      firstDatabase.query(`
        INSERT OR REPLACE INTO indexer_metadata (key, value)
        VALUES ('playerActivityFeedBackfilledV1', 'already-ran')
      `).run();
      firstDatabase.close();

      const reconciledDatabase = new Database(databasePath);
      const reconciled = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { database: reconciledDatabase, runStartupBackfill: false });

      expect(reconciled.playerActivity(player, { page: 1, pageSize: 25 }).items[0]).toMatchObject({
        title: "Home planet settled",
        detail: "5:21:7"
      });
      expect(reconciledDatabase.query(
        "SELECT value FROM indexer_metadata WHERE key = 'playerActivityFeedBackfilledV2'"
      ).get()).toEqual({ value: expect.any(String) });
      reconciledDatabase.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("keeps a lazily reconciled completion's logical and transaction times distinct", () => {
    const startTs = 1_767_000_000;
    const readyAt = startTs + 3_600;
    const reconciledAt = readyAt + 900;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent({ ...planet, lastSettledAt: startTs.toString() });
    indexer.applyLog({
      blockNumber: "0x81",
      blockTimestamp: `0x${startTs.toString(16)}`,
      transactionHash: "0xactivity-queue",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(8n, BigInt(readyAt), 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      blockTimestamp: `0x${reconciledAt.toString(16)}`,
      transactionHash: "0xactivity-reconcile",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(8n)
    });

    const completion = indexer.playerActivity(player, {
      page: 1,
      pageSize: 25,
      since: startTs + 1,
      through: reconciledAt + 1,
      includeProjected: true
    }).items.find((item) => item.kind === "building-completed");
    expect(completion).toMatchObject({
      occurredAt: readyAt.toString(),
      transactionAt: reconciledAt.toString(),
      transactionHash: "0xactivity-reconcile",
      reconciliation: "indexed"
    });
  });

  test("records mission launches and logical mission completion times", () => {
    const launchedAt = 1_767_000_000;
    const arrivalAt = launchedAt + 600;
    const returnAt = launchedAt + 1_200;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    const transactionHash = "0xactivity-mission-launch";
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: `0x${launchedAt.toString(16)}`,
      transactionHash,
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(42n), addressTopic(player), topic(0n)],
      data: abiWords(7n, 8n, BigInt(arrivalAt), BigInt(returnAt))
    });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: `0x${launchedAt.toString(16)}`,
      transactionHash,
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(42n)],
      data: abiWords(0n, 0n, 0n, 10n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: `0x${launchedAt.toString(16)}`,
      transactionHash,
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(42n)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: `0x${(arrivalAt + 45).toString(16)}`,
      transactionHash: "0xactivity-mission-resolve",
      logIndex: "0x0",
      topics: [fleetMissionResolvedTopic, topic(42n)],
      data: abiWords(BigInt(returnAt))
    });

    const items = indexer.playerActivity(player, {
      page: 1,
      pageSize: 25,
      through: arrivalAt + 60
    }).items;
    expect(items.find((item) => item.kind === "mission-launched")).toMatchObject({
      title: "Transport launched",
      transactionHash
    });
    expect(items.find((item) => item.kind === "mission-completed")).toMatchObject({
      title: "Transport completed",
      occurredAt: arrivalAt.toString(),
      transactionAt: (arrivalAt + 45).toString(),
      transactionHash: "0xactivity-mission-resolve"
    });
  });

  test("records attack outcomes for both the attacker and defender", () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const target = { ...planet, planetId: "8", owner: player, galaxy: 3, system: 4, position: 5 };
    const origin = { ...planet, planetId: "9", owner: attacker, galaxy: 3, system: 4, position: 6 };
    const battleAt = 1_767_001_000;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(target);
    indexer.applyEvent(origin);
    indexer.applyLog({
      blockNumber: "0xa0",
      blockTimestamp: `0x${battleAt.toString(16)}`,
      transactionHash: "0xactivity-battle",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(77n), addressTopic(attacker), topic(8n)],
      data: abiWords(1n, 3n, 123n, 1_000n, 500n, 0n)
    });

    expect(indexer.playerActivity(attacker, { page: 1, pageSize: 25, through: battleAt + 1 }).items[0]).toMatchObject({
      direction: "outgoing",
      kind: "attack-resolved",
      title: "Attack won"
    });
    expect(indexer.playerActivity(player, { page: 1, pageSize: 25, through: battleAt + 1 }).items[0]).toMatchObject({
      direction: "incoming",
      kind: "attack-resolved",
      title: "Defense lost"
    });
  });

  test("records an active queue startedAt aligned with the spend settle time (VEY-318)", () => {
    // Regression: a build start drains its cost from stored resources and
    // re-settles the planet, but the indexed queue previously exposed
    // startedAt: null. The frontend skips re-subtracting an active queue cost
    // only when startedAt <= the snapshot's settle time; a missing startedAt
    // forced the conservative branch, double-subtracting the cost and pinning
    // the displayed balance (Metal/Crystal) at 0 until the build completed.
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      blockTimestamp: "0x69801c90",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(5n)],
      data: abiWords(1n, 1770004000n, 400n, 120n, 60n)
    });

    const queue = indexer.planetQueue(planet.planetId, "building");
    const settledAt = indexer.walletSettlement(player).planet?.lastSettledAt;
    expect(queue?.active).toBe(true);
    // startedAt is populated from the build's block timestamp...
    expect(queue?.startedAt).toBe("1770003600");
    // ...and matches the planet's post-spend settle time, so a snapshot taken at
    // that settle time is recognised as already reflecting the cost (startedAt <=
    // lastSettledAt) and is not subtracted a second time on the client.
    expect(queue?.startedAt).toBe(settledAt);
    expect(Number(queue?.startedAt)).toBeLessThanOrEqual(Number(settledAt));
  });

  test("applies combat ship count changes to indexed ship rows", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(5n, 5n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(5);
    expect(indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xcombat",
      logIndex: "0x0",
      topics: [
        planetShipCountChangedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(2n)
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 2
      }
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(2);
  });

  test("applies PlanetDefenseCountChanged events to indexed defense rows (VEY-KANEO-461/462)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Build 5 rocket launchers (defense id 0) on planet 7.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xdefdone",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(5n, 5n)
    });
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 0)?.count).toBe(5);

    // A combat defense loss emits PlanetDefenseCountChanged with the planet's resulting total (2).
    expect(indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xcombat-def",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(2n)
    })).toMatchObject({ applied: true, duplicate: false });
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 0)?.count).toBe(2);
  });

  test("availableShipRows reflects the launch debit emitted by PlanetShipCountChanged (VEY-KANEO-461)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Build 5 light fighters (ship id 1) and 4 small cargo (ship id 0) on planet 7.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-lf",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x1",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });

    // Launch an Outbound mission from planet 7 carrying 3 light fighters. Post the events upgrade the
    // contract debits them at launch and emits PlanetShipCountChanged(planet 7, ship 1, total 2), which the
    // indexer applies directly — so contract_ship_counts is the authoritative at-planet roster of 2.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(50n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(50n)],
      data: abiWords(0n, 3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    // The launch debit event: planet 7, light fighter (ship id 1), new total 2 (5 - 3 away).
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-debit",
      logIndex: "0x3",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(2n)
    });

    // Launchable roster is the evented at-planet count: 2 light fighters present (3 away), no phantom ships.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(2);
    // Ship types not committed to the mission emitted no event and stay at their built count.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(4);
  });

  test("legacy fleet launch logs debit origin ships when no PlanetShipCountChanged total exists", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xlegacy-build-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xlegacy-build-lf",
      logIndex: "0x1",
      topics: [shipCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, 2n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(64n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 55n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-launch",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(64n)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-launch",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(64n)],
      data: abiWords(2n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-launch",
      logIndex: "0x3",
      topics: [fleetMissionShipsTopic, topic(64n)],
      data: abiWords(2n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(0);
  });

  test("modern PlanetShipCountChanged totals remain authoritative over legacy launch compatibility", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-modern",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmodern-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(65n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 55n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmodern-launch",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(65n)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmodern-launch",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(65n)],
      data: abiWords(0n, 3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmodern-launch",
      logIndex: "0x3",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(2n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(2);
  });

  test("legacy missile attack logs mutate defense counts when no PlanetDefenseCountChanged total exists", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const target = { ...planet, planetId: "8" };
    indexer.applyEvent(planet);
    indexer.applyEvent(target);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xorigin-ipm",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topic(7n), topic(9n)],
      data: abiWords(3n, 3n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xtarget-abm",
      logIndex: "0x1",
      topics: [defenseCompletedTopic, topic(8n), topic(8n)],
      data: abiWords(1n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xtarget-light-laser",
      logIndex: "0x2",
      topics: [defenseCompletedTopic, topic(8n), topic(1n)],
      data: abiWords(5n, 5n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-ipm",
      logIndex: "0x0",
      topics: [interplanetaryMissileAttackTopic, addressTopic(player), topic(7n), topic(8n)],
      data: abiWords(1n, 3n, 1n, 2n, 2n)
    });

    expect(indexer.defenseRows("7").find((defense) => defense.id === 9)?.count).toBe(0);
    expect(indexer.defenseRows("8").find((defense) => defense.id === 8)?.count).toBe(0);
    expect(indexer.defenseRows("8").find((defense) => defense.id === 1)?.count).toBe(3);
    expect(indexer.missileAttackArchivePage(player, { page: 1, pageSize: 25 }).rows).toMatchObject([{
      attacker: player,
      originPlanetId: "7",
      targetPlanetId: "8",
      primaryTargetDefenseId: 1,
      launched: 3,
      intercepted: 1,
      hits: 2,
      destroyedPrimary: 2,
      originPlanet: { planetId: "7" },
      targetPlanet: { planetId: "8" },
    }]);
  });

  test("legacy combat losses apply when the defender loss vector has one exact unit solution", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-combat-cargo",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 2n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(77n), addressTopic(player), topic(7n)],
      data: abiWords(1n, 1n, 123n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle",
      logIndex: "0x1",
      topics: [combatRoundResolvedTopic, topic(77n), topic(1n)],
      data: abiWords(1n, 0n, 0n, 0n, 4000n, 4000n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle",
      logIndex: "0x2",
      topics: [combatLossesTopic, topic(77n)],
      data: abiWords(0n, 0n, 0n, 4000n, 4000n, 0n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
  });

  test("legacy combat round counts remove a unique stale defender unit when loss resources prove it was absent", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-small-cargo",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-light-fighter",
      logIndex: "0x1",
      topics: [shipCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, 2n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-stale-light-laser",
      logIndex: "0x2",
      topics: [defenseCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle-stale-defense",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(228n), addressTopic(player), topic(7n)],
      data: abiWords(1n, 2n, 123n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle-stale-defense",
      logIndex: "0x1",
      topics: [combatRoundResolvedTopic, topic(228n), topic(1n)],
      data: abiWords(10n, 1n, 0n, 0n, 7000n, 5000n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle-stale-defense",
      logIndex: "0x2",
      topics: [combatRoundResolvedTopic, topic(228n), topic(2n)],
      data: abiWords(10n, 0n, 0n, 0n, 3000n, 1000n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlegacy-battle-stale-defense",
      logIndex: "0x3",
      topics: [combatLossesTopic, topic(228n)],
      data: abiWords(0n, 0n, 0n, 10000n, 6000n, 0n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(0);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)?.count).toBe(0);
  });

  test("stored-log replay sorts hex log indexes numerically inside the same transaction", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xsame-tx-order",
        logIndex: "0x5",
        topics: [shipCompletedTopic, topic(7n), topic(0n)],
        data: abiWords(3n, 3n)
      });
      first.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xsame-tx-order",
        logIndex: "0xf",
        topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
        data: abiWords(2n)
      });
      first.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xsame-tx-order",
        logIndex: "0x12",
        topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
        data: abiWords(0n)
      });
      expect(first.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("UPDATE contract_ship_counts SET count = 2 WHERE planet_id = ? AND ship_id = ?").run("7", 0);
        staleDb.query("UPDATE indexed_ship_counts SET count = 2 WHERE planet_id = ? AND ship_id = ?").run("7", 0);
      } finally {
        staleDb.close();
      }

      const replayed = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      expect(replayed.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("legacy unit replay reapplies a marked mutation when the count still matches the absolute event total", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      indexer.applyEvent(planet);
      indexer.applyLog({
        blockNumber: "0x83",
        transactionHash: "0xbuild-combat-cargo",
        logIndex: "0x0",
        topics: [shipCompletedTopic, topic(7n), topic(0n)],
        data: abiWords(2n, 2n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xlegacy-battle",
        logIndex: "0x0",
        topics: [attackBattleResolvedTopic, topic(77n), addressTopic(player), topic(7n)],
        data: abiWords(1n, 1n, 123n, 0n, 0n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xlegacy-battle",
        logIndex: "0x1",
        topics: [combatRoundResolvedTopic, topic(77n), topic(1n)],
        data: abiWords(1n, 0n, 0n, 0n, 4000n, 4000n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xlegacy-battle",
        logIndex: "0x2",
        topics: [combatLossesTopic, topic(77n)],
        data: abiWords(0n, 0n, 0n, 4000n, 4000n, 0n)
      });
      expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("UPDATE contract_ship_counts SET count = 2 WHERE planet_id = ? AND ship_id = ?").run("7", 0);
        staleDb.query("UPDATE indexed_ship_counts SET count = 2 WHERE planet_id = ? AND ship_id = ?").run("7", 0);
      } finally {
        staleDb.close();
      }

      indexer.applyLegacyUnitMutationsFromEventLogs();
      expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("availableShipRows applies a Colonize launch's colony-ship debit, leaving no phantom at origin (VEY-KANEO-490)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Build 1 colony ship (ship id 3) on planet 7: ShipCompleted(planet 7, ship 3, qty 1, total 1).
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-colony",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n, 1n)
    });
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 3)?.count).toBe(1);

    // Launch the Colonize fleet mission (missionType 2) carrying the colony ship. The contract debits the
    // colony ship at launch and emits PlanetShipCountChanged(planet 7, ship 3, total 0) — the same sink
    // every other mission type uses (VEY-KANEO-490). The fleet-mission logs alone carry no ship debit.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(50n), addressTopic(player), topic(2n)],
      data: abiWords((1n << 255n) | (2n << 24n) | (44n << 8n) | 10n, 0n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(50n)],
      // One colony ship (4th ship slot), nothing else.
      data: abiWords(0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x2",
      topics: [planetShipCountChangedTopic, topic(7n), topic(3n)],
      data: abiWords(0n)
    });

    // The departed colony ship is debited from the at-planet roster: no phantom over-reporting the origin.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 3)?.count).toBe(0);
    // The active colonize mission is still surfaced to its owner from the fleet-mission logs.
    expect(indexer.fleetMissionVisibility(player).outgoing.find((mission) => mission.missionId === "50"))
      .toMatchObject({ missionType: "Colonize", status: "Outbound", ships: { colonyShip: "1" } });

    // A SUCCESSFUL colony consumes the ship permanently: arrival resolves the mission (FleetMissionResolved,
    // no FleetMissionReturnExposed / no credit-back event), so the debited 0 must hold — the colony ship is
    // gone for good and the origin roster never regrows the phantom.
    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xcolonize-resolved",
      logIndex: "0x0",
      topics: [fleetMissionResolvedTopic, topic(50n), addressTopic(player), topic(2n)],
      data: abiWords(1770002400n)
    });
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 3)?.count).toBe(0);
  });

  test("availableShipRows credits a blocked Colonize's colony ship back to origin when it returns (VEY-KANEO-490)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Build 1 colony ship and launch a Colonize fleet mission; the launch debits it (total 0 at origin).
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-colony",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(50n), addressTopic(player), topic(2n)],
      data: abiWords((1n << 255n) | (2n << 24n) | (44n << 8n) | 10n, 0n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x1",
      topics: [planetShipCountChangedTopic, topic(7n), topic(3n)],
      data: abiWords(0n)
    });
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 3)?.count).toBe(0);

    // The target was occupied / over the planet limit, so the colony is NOT created: the mission turns
    // around (FleetMissionReturnExposed -> Returning) and the colony ship flies home. When the return
    // lands the contract credits it back through the same PlanetShipCountChanged sink (total 1 at origin).
    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xcolonize-return",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });

    // The colony ship is back at the origin: blocked colonizations restore the roster, no permanent loss.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 3)?.count).toBe(1);
  });

  test("availableShipRows never double-subtracts: the evented at-planet count is the single source of truth (VEY-KANEO-461)", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getShipyardState() {
        return {
          wallet: player,
          homePlanetId: planet.planetId,
          planetId: planet.planetId,
          productionAvailable: true,
          resources: planet.resources,
          fleetSlots: { active: 1, limit: 1 },
          shipyardLevel: 1,
          naniteLevel: 0,
          technologyLevels: {},
          // On-chain count the contract returns: 5 light fighters present at reconcile time.
          ships: [{ id: 1, count: 5, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
          queue: null
        };
      }
    }, 100n);

    // Reconcile from the planet event (block 123) → stored count id1 = 5.
    await indexer.rebuild();
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(5);

    // A mission launches and the contract debits 3 light fighters, emitting the new at-planet total of 2.
    // The indexer pins contract_ship_counts to that absolute value — there is no separate departed-ships
    // projection that could subtract the same launch a second time.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(60n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(60n)],
      data: abiWords(0n, 3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-debit",
      logIndex: "0x2",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(2n)
    });

    // Exactly the evented at-planet count — 2, not 5 - 3 - 3.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(2);

    // A second launch debits 1 more, emitting the new total of 1; the count tracks the latest event.
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xlaunch2-debit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(1n)
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(1);
  });

  // Canonical-mirror rework: the runtime refreshCanonicalState() self-heal was removed. Explicit
  // operator rebuild remains the canonical chain read, and it OVERWRITES the stored roster with
  // the on-chain value on every run. This test asserts that contract — a re-run of rebuild() re-pins the
  // served ship counts to the latest on-chain values even after events drove them elsewhere (VEY-452).
  test("explicit rebuild() re-pins served ship counts to chain (VEY-452)", async () => {
    let onchainShipCount = 2;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCurrentPlanets() { return [planet]; },
      async getShipyardState() {
        return {
          wallet: player,
          homePlanetId: planet.planetId,
          planetId: planet.planetId,
          productionAvailable: true,
          resources: planet.resources,
          fleetSlots: { active: 1, limit: 1 },
          shipyardLevel: 1,
          naniteLevel: 0,
          technologyLevels: {},
          ships: [{ id: 1, count: onchainShipCount, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
          queue: null
        };
      }
    }, 100n);

    // Reconcile from the planet event (block 123) → stored id1 = 2.
    await indexer.rebuild();
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(2);

    // A mission launches and the contract debits 1 light fighter, emitting the new at-planet total of 1.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-452",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(61n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-452-debit",
      logIndex: "0x1",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(1n)
    });
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(1);

    // The fleet comes home and the contract now reports 5 at the planet. Explicit rebuild
    // overwrites the stored roster with the authoritative on-chain value; served counts land at 5.
    onchainShipCount = 5;
    await indexer.rebuild();

    // Re-pinned to chain (was 1).
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(5);
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(5);
  });

  test("an out-of-order/backfilled older log cannot drag the indexed head back, and returned ships are credited from events (VEY-KANEO-460)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Build 5 light fighters on planet 7 (block 0x83 = 131).
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-460",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 5n)
    });

    // A mission launches at block 0x90 (144); the contract debits 4 light fighters and emits the new
    // at-planet total of 1. applyLog advances the indexed head to 144.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-460",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(61n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-460-debit",
      logIndex: "0x1",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(1n)
    });
    expect(indexer.snapshot().latestIndexedBlock).toBe("144");
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(1);

    // A gap/self-heal backfill re-applies a previously-missed OLDER log (block 0x80 = 128 — here a ship
    // build completion). A non-monotonic head write would drag latestIndexedBlock back to 128; the
    // monotonic clamp must keep it at 144.
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xbackfill-460",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });
    expect(indexer.snapshot().latestIndexedBlock).toBe("144");

    // The fleet comes home intact. The contract credits the survivors and emits the new at-planet total
    // of 5 — applied directly from events, no reconcile, no on-chain read. The returned ships reappear in
    // the launchable roster purely from event integration.
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-460-credit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(5n)
    });
    expect(indexer.snapshot().latestIndexedBlock).toBe("149");
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(5);
  });

  test("applyLog is atomic: a handler that throws rolls back the event row and the indexed head, so the log is not poisoned as a duplicate (VEY-KANEO-460)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Index one valid event so the head sits at a known block (0x83 = 131).
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });
    expect(indexer.snapshot().indexedEventLogs).toBe(1);
    expect(indexer.snapshot().latestIndexedBlock).toBe("131");

    // A malformed PlanetShipCountChanged log at a LATER block (0x90 = 144): the topic matches so the
    // handler runs, but the empty data payload makes the decoder throw partway through application.
    const malformed = {
      blockNumber: "0x90",
      transactionHash: "0xmalformed",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: "0x"
    };
    expect(() => indexer.applyLog(malformed)).toThrow();

    // The transaction rolled back: the event row was NOT committed (so a retry will re-process it rather
    // than skip it as a duplicate) and the indexed head did NOT advance past the unapplied event.
    expect(indexer.snapshot().indexedEventLogs).toBe(1);
    expect(indexer.snapshot().latestIndexedBlock).toBe("131");
  });

  test("credits a returned combat fleet minus its losses from PlanetShipCountChanged events alone (VEY-KANEO-461)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // Built 4 small cargo (ship id 0) on planet 7.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });

    // An Attack (mission type 3) launches from planet 7 with 3 small cargo. The contract debits them and
    // emits the new at-planet total of 1.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(70n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(70n)],
      data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-debit",
      logIndex: "0x2",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });

    // In flight: 1 launchable.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);

    // The mission returns. 1 of the 3 attackers was lost in combat and 2 came home — the spec is "credit all
    // ships that came back, excluding the ones destroyed". The contract routes both the combat loss and the
    // surviving-ship credit through _setPlanetShipCount, so it emits the exact surviving at-planet total of 3
    // (1 stayed home + 2 returned). availableShipRows reads that survivor count from events alone.
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-credit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn",
      logIndex: "0x1",
      // FleetMissionReturned(missionId, owner, planetId): owner=topic2, originPlanetId=topic3.
      topics: [fleetMissionReturnedTopic, topic(70n), addressTopic(player), topic(7n)],
      data: "0x"
    });

    // The mission is no longer active.
    expect(indexer.allActiveFleetMissions().some((mission) => mission.missionId === "70")).toBe(false);
    // Launchable roster reflects the survivors: 3 (the destroyed ship is excluded), from events alone.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(3);
  });

  test("credits a returned non-combat fleet back to the launchable roster from events alone (VEY-KANEO-461/460)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // 4 small cargo (ship id 0) on planet 7.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });

    // Launch a Transport (mission type 0 — no combat losses possible) carrying 3 small cargo. The contract
    // debits them and emits the new at-planet total of 1.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(80n), addressTopic(player), topic(0n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(80n)],
      data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-debit",
      logIndex: "0x2",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });

    // In flight: the 3 are debited, 1 launchable.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);

    // The fleet physically returns home. A non-combat return brought every ship back, so the contract
    // credits all 3 and emits the new at-planet total of 4 — applied from event integration alone, no
    // canonical reconcile / on-chain read involved (this is the New Zion 6:9:1 case).
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-credit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(4n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn",
      logIndex: "0x1",
      topics: [fleetMissionReturnedTopic, topic(80n), addressTopic(player), topic(7n)],
      data: "0x"
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(4);
  });

  test("credits legacy returned non-combat fleet ships when the return tx lacks absolute ship-count logs (VEY-KANEO-604)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-legacy",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(604n), addressTopic(player), topic(0n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-legacy",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(604n)],
      data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);

    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-legacy",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topic(604n), addressTopic(player), topic(4n)],
      data: abiWords(7n, 99n, 1770002400n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-legacy",
      logIndex: "0x1",
      topics: [fleetMissionReturnedTopic, topic(604n), addressTopic(player), topic(7n)],
      data: "0x"
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(4);
  });

  test("credits legacy returned combat fleet survivors when the return tx lacks absolute ship-count logs (VEY-KANEO-604)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-combat-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-combat-legacy",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(605n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-combat-legacy",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(605n)],
      data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);

    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xcombat-legacy",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(605n), addressTopic(player), topic(99n)],
      data: abiWords(1n, 1n, 123n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xcombat-legacy",
      logIndex: "0x1",
      topics: [combatLossesTopic, topic(605n)],
      data: abiWords(2000n, 2000n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-combat-legacy",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topic(605n), addressTopic(player), topic(4n)],
      data: abiWords(7n, 99n, 1770002400n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-combat-legacy",
      logIndex: "0x1",
      topics: [fleetMissionReturnedTopic, topic(605n), addressTopic(player), topic(7n)],
      data: "0x"
    });

    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(3);
  });

  test("legacy mutation replay repairs stored returned-fleet logs that predate the return-credit fix (VEY-KANEO-604)", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    };

    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);

      writer.applyLog({
        blockNumber: "0x83",
        transactionHash: "0xbuild-replay-sc",
        logIndex: "0x0",
        topics: [shipCompletedTopic, topic(7n), topic(0n)],
        data: abiWords(4n, 4n)
      });
      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xlaunch-replay-legacy",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(606n), addressTopic(player), topic(0n)],
        data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xlaunch-replay-legacy",
        logIndex: "0x1",
        topics: [fleetMissionShipsTopic, topic(606n)],
        data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x95",
        transactionHash: "0xreturn-replay-legacy",
        logIndex: "0x0",
        topics: [fleetMissionReturnExposedTopic, topic(606n), addressTopic(player), topic(4n)],
        data: abiWords(7n, 99n, 1770002400n, 0n, 0n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x95",
        transactionHash: "0xreturn-replay-legacy",
        logIndex: "0x1",
        topics: [fleetMissionReturnedTopic, topic(606n), addressTopic(player), topic(7n)],
        data: "0x"
      });

      const staleDb = new Database(databasePath);
      staleDb.query("DELETE FROM indexed_legacy_unit_mutations WHERE mutation_key = ?").run("legacy:fleet-return:606");
      staleDb.query(`
        UPDATE contract_ship_counts
        SET count = 1
        WHERE planet_id = ? AND ship_id = 0
      `).run(planet.planetId);
      staleDb.close();

      const reader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(reader.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);

      reader.applyLegacyUnitMutationsFromEventLogs();

      expect(reader.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(4);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("projects elapsed returning missions as returned while future returns stay active", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    const pastReturnAt = 1767225500n;
    const futureReturnAt = 1767225900n;
    for (const [missionId, returnAt] of [[82n, pastReturnAt], [83n, futureReturnAt]] as const) {
      const transactionHash = `0x${missionId.toString(16).padStart(64, "0")}`;
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(player), topic(0n)],
        data: abiWords(7n, 99n, 1767225000n, 1767225200n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x91",
        transactionHash,
        logIndex: "0x1",
        topics: [fleetMissionReturnExposedTopic, topic(missionId), addressTopic(player), topic(2n)],
        data: abiWords(7n, 99n, returnAt, 0n, 0n, 0n)
      });
    }

    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).toEqual(["83"]);
    expect(indexer.allCompletedFleetMissions().find((mission) => mission.missionId === "82")).toMatchObject({
      status: "Returned",
      asOfNow: expect.objectContaining({ returned: true })
    });
    expect(indexer.fleetMissionVisibility(player).returning.map((mission) => mission.missionId)).toEqual(["83"]);
    expect(indexer.fleetMissionVisibility(player).completedMissions.find((mission) => mission.missionId === "82")).toMatchObject({
      status: "Returned"
    });
    expect(indexer.fleetSlots(player)).toEqual({ active: 1, limit: 1 });
    expect(indexer.pendingFleetSlotSettlementMissionsForWallet(player).map((mission) => mission.missionId)).toEqual([]);
  });

  test("frees due transport arrivals from projected fleet slots because launch lazily settles them (VEY-590)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xtransport-arrival",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(590n), addressTopic(player), topic(0n)],
      data: abiWords(7n, 99n, 1767225000n, 1767225200n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xtransport-arrival",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(590n)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    expect(indexer.allActiveFleetMissions().find((mission) => mission.missionId === "590")).toMatchObject({
      missionType: "Transport",
      needsResolution: true,
      status: "Outbound"
    });
    expect(indexer.fleetSlots(player)).toEqual({ active: 0, limit: 1 });
    expect(indexer.pendingFleetSlotSettlementMissionsForWallet(player)).toEqual([]);
  });

  test("projects an arrived moon Deploy into launchable moon ships while freeing its fleet slot (VEY-KANEO-722)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon",
      logIndex: "0x0",
      topics: [moonCreatedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xcomputer",
      logIndex: "0x0",
      topics: [researchCompletedTopic, addressTopic(player), topic(4n)],
      data: abiWords(5n)
    });

    // Five genuinely active missions plus one Deploy that has reached the moon reproduce the
    // reported raw 6/6 mission roster. The next launch settles the due Deploy on-chain before the
    // slot/inventory checks, so the launchable projection must expose 5/6 and one moon cargo ship.
    for (let missionId = 1n; missionId <= 6n; missionId += 1n) {
      const isArrivedMoonDeploy = missionId === 6n;
      const arrivalAt = isArrivedMoonDeploy ? 1767225200n : 1767225900n + missionId;
      const txHash = `0x${missionId.toString(16).padStart(64, "0")}`;
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: txHash,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(player), topic(isArrivedMoonDeploy ? 1n : 0n)],
        data: abiWords(8n, 7n, arrivalAt, arrivalAt + 300n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: txHash,
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(missionId)],
        data: abiWords(0n, 0n, 0n, 1n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: txHash,
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(missionId)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });
      if (isArrivedMoonDeploy) {
        indexer.applyLog({
          blockNumber: "0x90",
          transactionHash: txHash,
          logIndex: "0x3",
          topics: [fleetMissionBodiesTopic, topic(missionId)],
          data: abiWords(0n, 1n)
        });
      }
    }

    expect(indexer.allActiveFleetMissions()).toHaveLength(6);
    expect(indexer.fleetSlots(player)).toEqual({ active: 5, limit: 6 });
    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      ships: expect.arrayContaining([expect.objectContaining({ id: 0, count: 0 })]),
      launchableShips: expect.arrayContaining([expect.objectContaining({ id: 0, count: 1 })])
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
  });

  // Canonical-mirror rework: the combat-triggered bounded per-planet reconcile was removed; combat
  // survivor/loss credits now come purely from PlanetShipCountChanged events. This test asserts that
  // event-only correctness (the bounded-reconcile confirmation step is gone) (VEY-KANEO-461).
  test("credits a returned combat fleet's survivors from events alone (VEY-KANEO-461)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n);
    indexer.applyEvent(planet);

    // 4 small cargo built, then an Attack (mission type 3) launches with 3 of them.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xbuild-sc",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(81n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(81n)],
      data: abiWords(3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    // Launch debit: 3 of 4 leave, new at-planet total 1.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-debit",
      logIndex: "0x2",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });

    // Combat resolves then the survivors come home. 1 attacker was lost; 2 returned. The contract routes
    // both the combat loss and the survivor credit through _setPlanetShipCount, so it emits the surviving
    // at-planet total of 3 (1 stayed home + 2 returned) on return — applied directly from events.
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xresolve",
      logIndex: "0x0",
      topics: [fleetMissionResolvedTopic, topic(81n)],
      data: abiWords(1770002400n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn-credit",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xreturn",
      logIndex: "0x1",
      topics: [fleetMissionReturnedTopic, topic(81n), addressTopic(player), topic(7n)],
      data: "0x"
    });

    // Survivors credited from events alone — 3 launchable (1 destroyed ship excluded), no on-chain read.
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(3);
  });

  test("applies duplicate webhook logs only once", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const log = {
      blockNumber: "0x7c",
      transactionHash: "0xabc",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        `0x${player.slice(2).padStart(64, "0")}`,
        `0x${(7n).toString(16).padStart(64, "0")}`
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    };

    expect(indexer.applyLog(log)).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "124"
      }
    });
    expect(indexer.applyLog(log)).toMatchObject({
      applied: false,
      duplicate: true,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1
      }
    });
  });

  test("applies collect resource settlement logs to indexed wallet state", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xcollect",
      logIndex: "0x0",
      topics: [
        planetSettledTopic,
        `0x${(7n).toString(16).padStart(64, "0")}`
      ],
      data: abiWords(6000n, 5900n, 5800n, 1770000600n)
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "128"
      }
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      planetId: planet.planetId,
      transactionHash: "0xcollect",
      blockNumber: "128",
      lastSettledAt: "1770000600",
      resources: {
        metal: "6000",
        crystal: "5900",
        deuterium: "5800"
      }
    });
  });

  test("keeps zero-resource settlement logs stale until canonical resources arrive", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    expect(indexer.applyLog({
      blockNumber: "0x7c",
      transactionHash: "0xstarted",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        safeToServeIndexedState: false,
        staleReason: "planet_resources_pending:7"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      lastSettledAt: "0",
      resources: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      }
    });

    expect(indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xsettled",
      logIndex: "0x1",
      topics: [
        planetSettledTopic,
        topic(7n)
      ],
      data: abiWords(5000n, 4900n, 4800n, 1770000000n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        staleReason: "never_reconciled"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: "0xsettled",
      blockNumber: "125",
      lastSettledAt: "1770000000",
      resources: planet.resources
    });
  });

  test("preserves resource logs that arrive before settlement identity logs", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    expect(indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xsettled",
      logIndex: "0x0",
      topics: [
        planetSettledTopic,
        topic(7n)
      ],
      data: abiWords(5000n, 4900n, 4800n, 1770000000n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 0,
        indexedState: "stale",
        staleReason: "planet_identity_pending:7"
      }
    });

    expect(indexer.applyLog({
      blockNumber: "0x7e",
      transactionHash: "0xstarted",
      logIndex: "0x1",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        staleReason: "never_reconciled"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: "0xsettled",
      blockNumber: "125",
      lastSettledAt: "1770000000",
      resources: planet.resources
    });
  });

  test("keeps reconciled indexed state serveable for planet-specific identity and resource gaps", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n);

    await indexer.rebuild();
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });

    expect(indexer.applyLog({
      blockNumber: "0x7f",
      transactionHash: "0xresource-before-identity",
      logIndex: "0x0",
      topics: [
        planetSettledTopic,
        topic(124n)
      ],
      data: abiWords(5000n, 4900n, 4800n, 1770000000n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedState: "healthy",
        pendingReconciliationReason: "planet_identity_pending:124",
        safeToServeIndexedState: true,
        staleReason: null
      }
    });

    expect(indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xidentity-placeholder",
      logIndex: "0x1",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(125n)
      ],
      data: abiWords(2n, 45n, 10n, 211n, 1n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedState: "healthy",
        pendingReconciliationReason: "planet_resources_pending:125",
        safeToServeIndexedState: true,
        staleReason: null
      }
    });
    expect(indexer.hasPendingPlanetResources("125")).toBe(true);
  });

  test("applies planet rename logs to every indexed planet read model", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xrename",
      logIndex: "0x0",
      topics: [
        planetRenamedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiString("New Eos")
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "129"
      }
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      planetId: planet.planetId,
      name: "New Eos"
    });
    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      planetId: planet.planetId,
      name: "New Eos"
    });
    expect(indexer.planet(planet.planetId)).toMatchObject({
      name: "New Eos"
    });
    expect(indexer.settledPlanetsInSystem(planet.galaxy, planet.system)[0]).toMatchObject({
      name: "New Eos"
    });
  });

  test("indexes active production queues and completed building levels", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [
        buildingStartedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n, 1770000900n, 400n, 120n, 60n)
    })).toMatchObject({
      applied: true,
      duplicate: false
    });

    expect(indexer.playerQueues(player, planet.planetId).building).toMatchObject({
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
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "4600",
      crystal: "4780",
      deuterium: "4740"
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

    expect(indexer.playerQueues(player, planet.planetId).building).toBeNull();
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)).toMatchObject({
      id: 5,
      level: 1
    });
    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      keyLevels: {
        shipyard: 1
      },
      queues: {
        building: null
      }
    });
  });

  test("keeps indexed building completion levels monotonic when older logs arrive late", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xbuilddone2",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xbuilddone1",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n)
    });

    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)).toMatchObject({
      id: 5,
      level: 2
    });
    expect(indexer.walletPlanets(player).planets[0]?.keyLevels.shipyard).toBe(2);
  });

  test("a stale, out-of-order older PlanetSettled cannot clobber a newer decreasing balance (VEY-KANEO-491)", () => {
    // PlanetSettled carries the authoritative post-mutation balance. A raid/spend emits a DECREASING
    // PlanetSettled; the read model must keep that lower balance. But logs do not always arrive in block
    // order — a gap/self-heal backfill or reconcile re-applies a previously-missed OLDER range after the
    // live head feed has already advanced. The resource snapshot write used to be unconditional, so the
    // older (pre-raid, higher) PlanetSettled clobbered the newer (post-raid, lower) one, over-reporting
    // resources. The frontend then let the player queue an upgrade they could not afford on-chain, and the
    // transaction reverted. The snapshot write must be monotonic by block, mirroring the head clamp.
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    // `settledAt == now` keeps the production projection at zero, so the served balance equals the latest
    // event balance exactly and the assertions isolate the snapshot, not accrual.
    const now = Math.floor(Date.now() / 1000);

    // A raid at block 0x90 (144) drops the planet's metal from 5000 to 1000.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xraid",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(1000n, 900n, 800n, BigInt(now))
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "1000",
      crystal: "900",
      deuterium: "800"
    });

    // A gap/self-heal backfill re-applies a previously-missed OLDER PlanetSettled (block 0x80 = 128)
    // carrying the pre-raid, higher balance. It must NOT overwrite the newer post-raid snapshot.
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xbackfill-pre-raid",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(9000n, 8000n, 7000n, BigInt(now - 600))
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "1000",
      crystal: "900",
      deuterium: "800"
    });

    // A genuinely newer PlanetSettled (block 0x95 = 149) still applies and can move the balance again.
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xnewer-settle",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(1500n, 1400n, 1300n, BigInt(now))
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "1500",
      crystal: "1400",
      deuterium: "1300"
    });
  });

  test("same-block PlanetSettled freshness follows logIndex order, not arrival order (VEY-KANEO-517)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xresource-newer",
      logIndex: "0x2",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(9000n, 8000n, 7000n, 1770000300n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xresource-older",
      logIndex: "0x1",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(1000n, 1000n, 1000n, 1770000300n)
    });

    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "9000",
      crystal: "8000",
      deuterium: "7000"
    });

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xresource-newest",
      logIndex: "0x3",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(9500n, 8200n, 7100n, 1770000300n)
    });

    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "9500",
      crystal: "8200",
      deuterium: "7100"
    });
  });

  test("a decreasing PlanetSettled after a reconcile that stamped a newer lastSettledAt still drops served resources (VEY-KANEO-491)", async () => {
    // Acceptance scenario from the field report: the canonical reconcile (rebuild) reads on-chain state and
    // writes the resource snapshot stamped with `reconciledAt = now` — a lastSettledAt NEWER than any real
    // PlanetSettled event timestamp. The authoritative DECREASING PlanetSettled a raid/spend produces must
    // still land and drop the served balance; it must not be discarded in favour of the reconcile-set
    // future timestamp. (The runtime refreshCanonicalState self-heal was removed; the startup reconcile is
    // the only chain read, so it is the path that stamps the newer timestamp here.)
    const onchain: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      // Stale-high balance the read model over-reported in the field (P36 served ~3351 vs chain ~508).
      resources: { metal: "9000", crystal: "8000", deuterium: "7000" },
      productionPerHour: { metal: "0", crystal: "0", deuterium: "0" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "100000", crystal: "100000", deuterium: "100000" },
      protectedResources: { metal: "0", crystal: "0", deuterium: "0" },
      raidableResources: { metal: "9000", crystal: "8000", deuterium: "7000" },
      technologyLevels: {},
      buildings: [{ id: 0, level: 4, cost: { metal: "960", crystal: "240", deuterium: "0" } }],
      queue: null
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCurrentPlanets() { return [planet]; },
      async getInfrastructureState() { return onchain; }
    }, 100n);

    // Reconcile: writes the canonical snapshot stamped with reconciledAt = now (a lastSettledAt newer than
    // any real event). Zero production keeps the served balance equal to the snapshot exactly.
    await indexer.rebuild();
    const reconciledBlock = BigInt(indexer.snapshot().latestIndexedBlock || "0");
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "9000",
      crystal: "8000",
      deuterium: "7000"
    });

    const now = Math.floor(Date.now() / 1000);

    // The authoritative raid/spend PlanetSettled — a genuinely newer event (block past the reconcile block)
    // carrying the lower post-mutation balance. It MUST drop the served resources even though the snapshot's
    // stored lastSettledAt is newer.
    const raidBlock = `0x${(reconciledBlock + 0x100n).toString(16)}`;
    indexer.applyLog({
      blockNumber: raidBlock,
      transactionHash: "0xraid-after-reconcile",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(508n, 460n, 410n, BigInt(now))
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "508",
      crystal: "460",
      deuterium: "410"
    });

    // A stale, out-of-order older PlanetSettled (block before the raid) carrying the pre-raid high balance
    // must NOT restore the over-report — this is the regression that made upgrades revert on-chain.
    const staleBlock = `0x${(reconciledBlock + 0x10n).toString(16)}`;
    indexer.applyLog({
      blockNumber: staleBlock,
      transactionHash: "0xstale-pre-raid",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
      data: abiWords(9000n, 8000n, 7000n, BigInt(now))
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "508",
      crystal: "460",
      deuterium: "410"
    });
  });

  test("reports used fields as completed building levels only", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xmetal2",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xterraformer1",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(12n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xdefense5",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xship7",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(7n, 7n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xresearch4",
      logIndex: "0x0",
      topics: [researchCompletedTopic, addressTopic(player), topic(4n)],
      data: abiWords(4n)
    });

    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      fieldsUsed: 3,
      fieldsCapacity: planet.fields,
      keyLevels: {
        metalMine: 2,
        terraformer: 1
      }
    });
  });

  test("indexes ship and research queues plus completed counts and levels", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x83",
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
      blockNumber: "0x84",
      transactionHash: "0xresearch",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(7n)],
      data: abiWords(2200n, 3500n, 4600n, 1770000000n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xresearch",
      logIndex: "0x1",
      topics: [
        researchQueuedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(2n, 1770001100n, 800n, 400n, 200n)
    });

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      ship: {
        kind: "ship",
        itemId: 3,
        quantity: 2,
        readyAt: "1770001000"
      },
      research: {
        kind: "research",
        itemId: 4,
        targetLevel: 2,
        readyAt: "1770001100"
      }
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "2200",
      crystal: "3500",
      deuterium: "4600"
    });

    indexer.applyLog({
      blockNumber: "0x85",
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
      blockNumber: "0x86",
      transactionHash: "0xresearchdone",
      logIndex: "0x0",
      topics: [
        researchCompletedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(2n)
    });

    expect(indexer.playerQueues(player, planet.planetId).ship).toBeNull();
    expect(indexer.playerQueues(player, planet.planetId).research).toBeNull();
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 3)).toMatchObject({
      id: 3,
      count: 7
    });
    expect(indexer.technologyLevels(player)).toMatchObject({
      "4": 2
    });
  });

  test("derives fleet slots from indexed active missions and Computer Technology", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xresearchdone",
      logIndex: "0x0",
      topics: [
        researchCompletedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(4n)
    });
    for (let missionId = 1n; missionId <= 5n; missionId += 1n) {
      const baseLogIndex = Number(missionId * 10n);
      const logs = [
        {
          blockNumber: "0x90",
          transactionHash: `0x${missionId.toString(16).padStart(64, "0")}`,
          logIndex: `0x${baseLogIndex.toString(16)}`,
          removed: false,
          topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(player), topic(0n)],
          data: abiWords(7n, 100n + missionId, 1_800_000_000n + missionId, 1_800_000_300n + missionId),
        },
        {
          blockNumber: "0x90",
          transactionHash: `0x${missionId.toString(16).padStart(64, "0")}`,
          logIndex: `0x${(baseLogIndex + 1).toString(16)}`,
          removed: false,
          topics: [fleetMissionCargoTopic, topic(missionId)],
          data: abiWords(0n, 0n, 0n, 0n),
        },
        {
          blockNumber: "0x90",
          transactionHash: `0x${missionId.toString(16).padStart(64, "0")}`,
          logIndex: `0x${(baseLogIndex + 2).toString(16)}`,
          removed: false,
          topics: [fleetMissionShipsTopic, topic(missionId)],
          data: abiWords(...Array.from({ length: 14 }, (_, index) => index === 0 ? 1n : 0n)),
        },
      ];
      for (const log of logs) {
        indexer.applyLog(log);
      }
    }

    expect(indexer.fleetSlots(player)).toEqual({ active: 5, limit: 5 });
  });

  test("keeps legacy elapsed queues out of served rows while launchable ships include them", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xship-count",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(9n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xready-ship",
      logIndex: "0x1",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(14n, 1767225500n, 2000n, 1000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xdefense-count",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(8n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xready-defense",
      logIndex: "0x1",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 1767225500n, 4000n, 2000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xready-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(2n, 1767225500n, 800n, 400n, 200n)
    });

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      ship: null,
      defense: null,
      research: null
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)).toMatchObject({
      id: 0,
      count: 9
    });
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 0)).toMatchObject({
      id: 0,
      count: 23
    });
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)).toMatchObject({
      id: 1,
      count: 8
    });
    expect(indexer.technologyLevels(player)).toMatchObject({ "4": 2 });
  });

  test("projects Solar Satellites per unit at 1/N, middle, and final queue boundaries", () => {
    const now = Math.floor(Date.now() / 1_000);

    for (const completedQuantity of [1, 3, 6]) {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n);
      indexer.applyEvent(planet);
      indexer.applyLog({
        blockNumber: "0x83",
        transactionHash: `0xsat-count-${completedQuantity}`,
        logIndex: "0x0",
        topics: [planetShipCountChangedTopic, topic(7n), topic(9n)],
        data: abiWords(44n)
      });

      const startedAt = BigInt(now - completedQuantity * 10);
      const readyAt = startedAt + 60n;
      indexer.applyLog({
        blockNumber: "0x84",
        transactionHash: `0xsat-queue-${completedQuantity}`,
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(9n)],
        data: abiWords(6n, readyAt, 0n, 12_000n, 3_000n)
      });
      indexer.applyLog({
        blockNumber: "0x84",
        transactionHash: `0xsat-queue-${completedQuantity}`,
        logIndex: "0x1",
        topics: [shipQueueTimingSetTopic, topic(7n), topic(9n), topic(readyAt)],
        data: abiWords(startedAt, 6n, 100n, 10n)
      });

      const expectedCount = 44 + completedQuantity;
      const remainingQuantity = 6 - completedQuantity;
      expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(expectedCount);
      expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(expectedCount);
      if (remainingQuantity === 0) {
        expect(indexer.playerQueues(player, planet.planetId).ship).toBeNull();
      } else {
        expect(indexer.playerQueues(player, planet.planetId).ship).toMatchObject({
          itemId: 9,
          quantity: remainingQuantity,
          asOfNow: {
            completedQuantity,
            remainingQuantity
          }
        });
      }

      const energy = deriveInfrastructureFields(
        planet,
        [],
        indexer.shipRows(planet.planetId),
        {}
      ).energyBalance;
      const sources = energy?.sources;
      if (!sources) throw new Error("Expected Solar Satellite energy sources");
      expect(sources.solarSatelliteCount).toBe(expectedCount);
      expect(Number(sources.solarSatellites)).toBe(
        expectedCount * Number(sources.solarSatelliteEnergy)
      );
    }
  });

  test("does not double-count a projected Solar Satellite when its completion event arrives", () => {
    const now = Math.floor(Date.now() / 1_000);
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xsat-count",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(9n)],
      data: abiWords(44n)
    });
    const startedAt = BigInt(now - 10);
    const readyAt = startedAt + 60n;
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xsat-queue",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(9n)],
      data: abiWords(6n, readyAt, 0n, 12_000n, 3_000n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xsat-queue",
      logIndex: "0x1",
      topics: [shipQueueTimingSetTopic, topic(7n), topic(9n), topic(readyAt)],
      data: abiWords(startedAt, 6n, 100n, 10n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(45);
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xsat-completed",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(9n)],
      data: abiWords(1n, 45n)
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(45);
    expect(indexer.playerQueues(player, planet.planetId).ship).toMatchObject({
      quantity: 5,
      asOfNow: { completedQuantity: 1, remainingQuantity: 5 }
    });
  });

  test("indexes moon creation and moon building queues", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon",
      logIndex: "0x0",
      topics: [
        moonCreatedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xparent-ship",
      logIndex: "0x1",
      topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(99n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xparent-defense",
      logIndex: "0x2",
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(2n)],
      data: abiWords(88n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoonresources",
      logIndex: "0x3",
      topics: [moonResourcesSettledTopic, topic(7n)],
      data: abiWords(123n, 456n, 789n, 1770000300n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoonship",
      logIndex: "0x4",
      topics: [moonShipCountChangedTopic, topic(7n), topic(1n)],
      data: abiWords(5n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoondefense",
      logIndex: "0x5",
      topics: [moonDefenseCountChangedTopic, topic(7n), topic(2n)],
      data: abiWords(7n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      blockTimestamp: "0x69800e80",
      transactionHash: "0xmoonbuild",
      logIndex: "0x0",
      topics: [
        moonBuildingStartedTopic,
        topic(7n),
        topic(2n)
      ],
      data: abiWords(1n, 1770001200n, 2_000_000n, 4_000_000n, 2_000_000n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      bodyKind: "moon",
      parentPlanetId: planet.planetId,
      resources: {
        metal: "123",
        crystal: "456",
        deuterium: "789"
      },
      resourcesAsOfNow: {
        metal: "123",
        crystal: "456",
        deuterium: "789"
      },
      ships: expect.arrayContaining([
        expect.objectContaining({ id: 1, count: 5 })
      ]),
      defenses: expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          cost: { metal: "2000", crystal: "0", deuterium: "0" }
        }),
        expect.objectContaining({
          id: 2,
          count: 7,
          cost: { metal: "6000", crystal: "2000", deuterium: "0" }
        })
      ]),
      moon: {
        exists: true,
        planetId: planet.planetId,
        owner: player,
        fields: 12,
        diameterKm: 8777
      },
      queue: {
        kind: "moon-building",
        itemId: 2,
        targetLevel: 1,
        readyAt: "1770001200",
        startedAt: "1770000000"
      }
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(99);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 2)?.count).toBe(88);

    indexer.applyLog({
      blockNumber: "0x89",
      transactionHash: "0xmoonbuilddone",
      logIndex: "0x0",
      topics: [
        moonBuildingCompletedTopic,
        topic(7n),
        topic(2n)
      ],
      data: abiWords(1n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      queue: null,
      buildings: expect.arrayContaining([
        expect.objectContaining({ id: 2, level: 1 })
      ])
    });

    indexer.applyLog({
      blockNumber: "0x8a",
      transactionHash: "0xmoondefense",
      logIndex: "0x0",
      topics: [
        moonDefenseQueuedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(3n, 1770001800n, 6_000n, 0n, 0n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      defenseQueue: {
        kind: "moon-defense",
        itemId: 0,
        quantity: 3,
        readyAt: "1770001800"
      }
    });

    indexer.applyLog({
      blockNumber: "0x8b",
      transactionHash: "0xmoondefensedone",
      logIndex: "0x0",
      topics: [
        moonDefenseCompletedTopic,
        topic(7n),
        topic(0n)
      ],
      data: abiWords(3n, 3n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      defenseQueue: null,
      defenses: expect.arrayContaining([
        expect.objectContaining({ id: 0, count: 3 })
      ])
    });
  });

  test("projects only overdue Moon construction and stays idempotent after completion catches up", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon-projection",
      logIndex: "0x0",
      topics: [moonCreatedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      blockTimestamp: "0x6955b2c0",
      transactionHash: "0xmoon-overdue",
      logIndex: "0x0",
      topics: [moonBuildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, 1767225500n, 20_000n, 40_000n, 20_000n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: { fields: 15 },
      queue: null,
      completionQueue: {
        itemId: 0,
        targetLevel: 1,
        startedAt: "1767224000",
        asOfNow: { complete: true, secondsRemaining: 0 }
      },
      buildings: expect.arrayContaining([
        expect.objectContaining({ id: 0, level: 1, durationSeconds: expect.any(Number) })
      ])
    });

    indexer.applyLog({
      blockNumber: "0x89",
      transactionHash: "0xmoon-overdue-completed",
      logIndex: "0x0",
      topics: [moonBuildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: { fields: 15 },
      queue: null,
      buildings: expect.arrayContaining([expect.objectContaining({ id: 0, level: 1 })])
    });
  });

  test("projects overdue Moon defense production and stays idempotent after completion catches up", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon-defense-projection",
      logIndex: "0x0",
      topics: [moonCreatedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xmoon-defense-baseline",
      logIndex: "0x0",
      topics: [moonDefenseCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(7n)
    });
    indexer.applyLog({
      blockNumber: "0x89",
      blockTimestamp: "0x6955b2c0",
      transactionHash: "0xmoon-defense-overdue",
      logIndex: "0x0",
      topics: [moonDefenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 1767225500n, 6_000n, 0n, 0n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      defenseQueue: null,
      defenses: expect.arrayContaining([
        expect.objectContaining({ id: 0, count: 10 })
      ])
    });

    indexer.applyLog({
      blockNumber: "0x8a",
      transactionHash: "0xmoon-defense-overdue-count",
      logIndex: "0x0",
      topics: [moonDefenseCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(10n)
    });
    indexer.applyLog({
      blockNumber: "0x8a",
      transactionHash: "0xmoon-defense-overdue-count",
      logIndex: "0x1",
      topics: [moonDefenseCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 10n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      defenseQueue: null,
      defenses: expect.arrayContaining([
        expect.objectContaining({ id: 0, count: 10 })
      ])
    });
  });

  test("keeps a not-yet-due Moon queue active without projecting its target level", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon-future",
      logIndex: "0x0",
      topics: [moonCreatedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      blockTimestamp: "0x69800e80",
      transactionHash: "0xmoon-future-queue",
      logIndex: "0x0",
      topics: [moonBuildingStartedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1770001200n, 400n, 120n, 200n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: { fields: 12 },
      queue: { itemId: 1, targetLevel: 1, readyAt: "1770001200", startedAt: "1770000000" },
      buildings: expect.arrayContaining([expect.objectContaining({ id: 1, level: 0 })])
    });
  });

  test("preserves indexed Moon queue startedAt across canonical reconciliation", async () => {
    const canonicalMoon: MoonState = {
      wallet: player,
      bodyKind: "moon",
      homePlanetId: planet.planetId,
      parentPlanetId: planet.planetId,
      moonAvailable: true,
      resources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      resourcesAsOfNow: { metal: "1000", crystal: "1000", deuterium: "1000" },
      ships: [],
      launchableShips: [],
      defenses: [],
      moon: {
        exists: true,
        planetId: planet.planetId,
        owner: player,
        fields: 12,
        diameterKm: 8777,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      fleet: [],
      buildings: [{
        id: 1,
        key: "roboticsFactory",
        label: "Robotics Factory",
        level: 0,
        cost: { metal: "400", crystal: "120", deuterium: "200" },
      }],
      queue: {
        active: true,
        kind: "moon-building",
        itemId: 1,
        targetLevel: 1,
        readyAt: "1770001200",
        cost: { metal: "400", crystal: "120", deuterium: "200" },
      },
      technologyLevels: {},
      defenseQueue: null,
    };
    const canonicalPlanet: CanonicalPlanetChainState = {
      planetId: planet.planetId,
      resources: planet.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows(() => 0),
      ships: deriveShipRows(() => 0),
      queues: { building: null, defense: null, ship: null },
    };
    const indexer = new SettlementIndexer({
      async getBlockNumber() { return 0x88n; },
      async getCanonicalPlanetState() { return canonicalPlanet; },
      async getMoonState() { return canonicalMoon; },
      async listContractLogs() { return []; },
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x88",
      blockTimestamp: "0x69800e80",
      transactionHash: "0xmoon-reconcile",
      logIndex: "0x0",
      topics: [moonBuildingStartedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1770001200n, 400n, 120n, 200n),
    });

    await indexer.seedCurrentCanonicalState({ planetConcurrency: 1 });

    expect(indexer.moonState(player, planet.planetId).queue).toMatchObject({
      itemId: 1,
      readyAt: "1770001200",
      startedAt: "1770000000",
      targetLevel: 1,
    });
  });

  test("indexes independent moon resources and moon fleet counts", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon",
      logIndex: "0x0",
      topics: [
        moonCreatedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xmoonresources",
      logIndex: "0x0",
      topics: [moonResourcesChangedTopic, topic(7n)],
      data: abiWords(123n, 456n, 789n)
    });
    indexer.applyLog({
      blockNumber: "0x89",
      transactionHash: "0xmoonship",
      logIndex: "0x0",
      topics: [moonShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(5n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      resources: {
        metal: "123",
        crystal: "456",
        deuterium: "789"
      },
      fleet: expect.arrayContaining([
        expect.objectContaining({ id: 0, count: 5 })
      ])
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(0);
  });

  test("returns owned moon Jump Gate destinations from indexed moon state", () => {
    const destinationPlanet: SettledPlanetEvent = {
      ...planet,
      transactionHash: "0xabc-destination",
      planetId: "9",
      position: 11
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyEvent(destinationPlanet);

    for (const [planetRef, fields, diameter] of [[planet, 12n, 8777n], [destinationPlanet, 10n, 7120n]] as const) {
      indexer.applyLog({
        blockNumber: "0x87",
        transactionHash: `0xmoon${planetRef.planetId}`,
        logIndex: "0x0",
        topics: [
          moonCreatedTopic,
          addressTopic(player),
          topic(BigInt(planetRef.planetId))
        ],
        data: abiWords(BigInt(planetRef.galaxy), BigInt(planetRef.system), BigInt(planetRef.position), fields, diameter)
      });
      indexer.applyLog({
        blockNumber: "0x88",
        transactionHash: `0xmoongate${planetRef.planetId}`,
        logIndex: "0x0",
        topics: [
          moonBuildingCompletedTopic,
          topic(BigInt(planetRef.planetId)),
          topic(2n)
        ],
        data: abiWords(1n)
      });
    }

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: {
        jumpGateReadyAt: "0"
      },
      jumpGateDestinations: [
        {
          planetId: destinationPlanet.planetId,
          label: "Moon 2:44:11",
          coordinates: "2:44:11",
          jumpGateReadyAt: "0"
        }
      ]
    });

    indexer.applyLog({
      blockNumber: "0x89",
      transactionHash: "0xjumpgate",
      logIndex: "0x0",
      topics: [
        jumpGateJumpedTopic,
        addressTopic(player),
        topic(BigInt(planet.planetId)),
        topic(BigInt(destinationPlanet.planetId))
      ],
      data: abiWords(1770007200n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: {
        jumpGateReadyAt: "1770007200"
      },
      jumpGateDestinations: [
        {
          planetId: destinationPlanet.planetId,
          jumpGateReadyAt: "1770007200"
        }
      ]
    });
  });

  test("includes an owned destination whose Jump Gate queue is overdue", () => {
    const destinationPlanet: SettledPlanetEvent = {
      ...planet,
      transactionHash: "0xabc-overdue-destination",
      planetId: "9",
      position: 11
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyEvent(destinationPlanet);

    for (const planetRef of [planet, destinationPlanet]) {
      indexer.applyLog({
        blockNumber: "0x87",
        transactionHash: `0xmoon-overdue-gate-${planetRef.planetId}`,
        logIndex: "0x0",
        topics: [moonCreatedTopic, addressTopic(player), topic(BigInt(planetRef.planetId))],
        data: abiWords(BigInt(planetRef.galaxy), BigInt(planetRef.system), BigInt(planetRef.position), 12n, 8777n)
      });
    }
    indexer.applyLog({
      blockNumber: "0x88",
      blockTimestamp: "0x6955b2c0",
      transactionHash: "0xoverdue-jump-gate",
      logIndex: "0x0",
      topics: [moonBuildingStartedTopic, topic(9n), topic(2n)],
      data: abiWords(1n, 1767225500n, 2_000_000n, 4_000_000n, 2_000_000n)
    });

    expect(indexer.moonState(player, planet.planetId).jumpGateDestinations).toEqual([
      {
        planetId: destinationPlanet.planetId,
        label: "Moon 2:44:11",
        coordinates: "2:44:11",
        jumpGateReadyAt: "0"
      }
    ]);
  });

  test("persists every production queue kind from indexed contract events", () => {
    const db = new Database(":memory:");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { database: db });
      indexer.applyEvent(planet);

      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xqueue-building",
        logIndex: "0x0",
        topics: [buildingStartedTopic, topic(7n), topic(4n)],
        data: abiWords(2n, 1770002000n, 1200n, 400n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xqueue-defense",
        logIndex: "0x0",
        topics: [defenseQueuedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 1770002100n, 1000n, 300n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x92",
        transactionHash: "0xqueue-ship",
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 1770002200n, 6000n, 3000n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x93",
        transactionHash: "0xqueue-research",
        logIndex: "0x0",
        topics: [researchQueuedTopic, addressTopic(player), topic(5n)],
        data: abiWords(1n, 1770002300n, 800n, 200n, 100n)
      });
      indexer.applyLog({
        blockNumber: "0x94",
        blockTimestamp: "0x69801650",
        transactionHash: "0xqueue-moon",
        logIndex: "0x0",
        topics: [moonBuildingStartedTopic, topic(7n), topic(2n)],
        data: abiWords(1n, 1770002400n, 2_000_000n, 4_000_000n, 2_000_000n)
      });

      expect(db.query(`
        SELECT queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity, ready_at, metal_cost, crystal_cost, deuterium_cost
        FROM contract_production_queues
        ORDER BY queue_key ASC
      `).all()).toEqual([
        {
          queue_key: "building:7",
          queue_kind: "building",
          planet_id: "7",
          owner: null,
          item_id: 4,
          target_level: 2,
          quantity: null,
          ready_at: "1770002000",
          metal_cost: "1200",
          crystal_cost: "400",
          deuterium_cost: "0"
        },
        {
          queue_key: "defense:7",
          queue_kind: "defense",
          planet_id: "7",
          owner: null,
          item_id: 1,
          target_level: null,
          quantity: 5,
          ready_at: "1770002100",
          metal_cost: "1000",
          crystal_cost: "300",
          deuterium_cost: "0"
        },
        {
          queue_key: "moon-building:7",
          queue_kind: "moon-building",
          planet_id: "7",
          owner: null,
          item_id: 2,
          target_level: 1,
          quantity: null,
          ready_at: "1770002400",
          metal_cost: "2000000",
          crystal_cost: "4000000",
          deuterium_cost: "2000000"
        },
        {
          queue_key: `research:${player}`,
          queue_kind: "research",
          planet_id: null,
          owner: player,
          item_id: 5,
          target_level: 1,
          quantity: null,
          ready_at: "1770002300",
          metal_cost: "800",
          crystal_cost: "200",
          deuterium_cost: "100"
        },
        {
          queue_key: "ship:7",
          queue_kind: "ship",
          planet_id: "7",
          owner: null,
          item_id: 2,
          target_level: null,
          quantity: 3,
          ready_at: "1770002200",
          metal_cost: "6000",
          crystal_cost: "3000",
          deuterium_cost: "0"
        }
      ]);
      expect(db.query(`
        SELECT planet_id, moon_building_id, target_level, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost
        FROM contract_moon_building_queues
      `).get()).toEqual({
        planet_id: "7",
        moon_building_id: 2,
        target_level: 1,
        ready_at: "1770002400",
        started_at: "1770002000",
        metal_cost: "2000000",
        crystal_cost: "4000000",
        deuterium_cost: "2000000"
      });
      expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
        building: { kind: "building", itemId: 4, targetLevel: 2 },
        defense: { kind: "defense", itemId: 1, quantity: 5 },
        ship: { kind: "ship", itemId: 2, quantity: 3 },
        research: { kind: "research", itemId: 5, targetLevel: 1 }
      });
      expect(indexer.moonState(player, planet.planetId).queue).toMatchObject({
        kind: "moon-building",
        itemId: 2,
        targetLevel: 1,
        startedAt: "1770002000"
      });

      indexer.applyLog({
        blockNumber: "0x95",
        transactionHash: "0xcomplete-building",
        logIndex: "0x0",
        topics: [buildingCompletedTopic, topic(7n), topic(4n)],
        data: abiWords(2n)
      });
      indexer.applyLog({
        blockNumber: "0x96",
        transactionHash: "0xcomplete-defense",
        logIndex: "0x0",
        topics: [defenseCompletedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 9n)
      });
      indexer.applyLog({
        blockNumber: "0x97",
        transactionHash: "0xcomplete-ship",
        logIndex: "0x0",
        topics: [shipCompletedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 8n)
      });
      indexer.applyLog({
        blockNumber: "0x98",
        transactionHash: "0xcomplete-research",
        logIndex: "0x0",
        topics: [researchCompletedTopic, addressTopic(player), topic(5n)],
        data: abiWords(1n)
      });
      indexer.applyLog({
        blockNumber: "0x99",
        transactionHash: "0xcomplete-moon",
        logIndex: "0x0",
        topics: [moonBuildingCompletedTopic, topic(7n), topic(2n)],
        data: abiWords(1n)
      });

      expect(db.query("SELECT COUNT(*) AS count FROM contract_production_queues").get()).toEqual({ count: 0 });
      expect(db.query("SELECT COUNT(*) AS count FROM contract_moon_building_queues").get()).toEqual({ count: 0 });
      expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 4)).toMatchObject({ level: 2 });
      expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)).toMatchObject({ count: 9 });
      expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 2)).toMatchObject({ count: 8 });
      expect(indexer.technologyLevels(player)).toMatchObject({ "5": 1 });
      expect(indexer.moonState(player, planet.planetId).buildings).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 2, level: 1 })
      ]));
    } finally {
      db.close();
    }
  });

  test("appends different defense queue events to the indexed backlog", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-light-laser",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, 1770001000n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-light-laser",
      logIndex: "0x1",
      topics: [defenseQueueTimingSetTopic, topic(7n), topic(1n), topic(1770001000n)],
      data: abiWords(1770000000n, 2n, 540_000n, 2500n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-rocket-backlog",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 1770001600n, 200n, 0n, 0n)
    });

    expect(indexer.playerQueues(player, planet.planetId).defense).toMatchObject({
      kind: "defense",
      itemId: 1,
      quantity: 2,
      readyAt: "1770001000",
      startedAt: "1770000000",
      productionTiming: {
        startedAt: "1770000000",
        originalQuantity: 2,
        unitWorkSeconds: "540000",
        rate: "2500"
      },
      cost: { metal: "100", crystal: "50", deuterium: "0" },
      backlog: [
        {
          kind: "defense",
          itemId: 0,
          quantity: 3,
          readyAt: "1770001600",
          cost: { metal: "200", crystal: "0", deuterium: "0" }
        }
      ]
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "4700",
      crystal: "4850",
      deuterium: "4800"
    });
  });

  test("appends same defense queue events behind an existing indexed backlog", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-active-rocket",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 1770001000n, 4000n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-ion-backlog",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(5n)],
      data: abiWords(3n, 1770001600n, 6000n, 18000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa2",
      transactionHash: "0xqueue-rocket-after-ion",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 1770002200n, 8000n, 0n, 0n)
    });

    expect(indexer.playerQueues(player, planet.planetId).defense).toMatchObject({
      kind: "defense",
      itemId: 0,
      quantity: 2,
      readyAt: "1770001000",
      backlog: [
        {
          kind: "defense",
          itemId: 5,
          quantity: 3,
          readyAt: "1770001600",
          cost: { metal: "6000", crystal: "18000", deuterium: "0" }
        },
        {
          kind: "defense",
          itemId: 0,
          quantity: 4,
          readyAt: "1770002200",
          cost: { metal: "8000", crystal: "0", deuterium: "0" }
        }
      ]
    });
  });

  test("deduplicates identical defense queue backlog events", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-light-laser",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, 1770001000n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-rocket-backlog",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 1770001600n, 200n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa2",
      transactionHash: "0xqueue-rocket-backlog-replayed",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 1770001600n, 200n, 0n, 0n)
    });

    expect(indexer.playerQueues(player, planet.planetId).defense?.backlog).toEqual([
      expect.objectContaining({
        kind: "defense",
        itemId: 0,
        quantity: 3,
        readyAt: "1770001600"
      })
    ]);
  });

  test("indexes active and FIFO backlog production timings for different and same ship types", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-small-cargo",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 1770001000n, 4000n, 4000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-small-cargo",
      logIndex: "0x1",
      topics: [shipQueueTimingSetTopic, topic(7n), topic(0n), topic(1770001000n)],
      data: abiWords(1770000000n, 2n, 28_800_000n, 2500n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-light-fighter-backlog",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(3n, 1770002600n, 9000n, 3000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-light-fighter-backlog",
      logIndex: "0x1",
      topics: [shipQueueTimingSetTopic, topic(7n), topic(1n), topic(1770002600n)],
      data: abiWords(1770001000n, 3n, 14_400_000n, 2500n)
    });
    indexer.applyLog({
      blockNumber: "0xa2",
      transactionHash: "0xqueue-small-cargo-more",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 1770003200n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa2",
      transactionHash: "0xqueue-small-cargo-more",
      logIndex: "0x1",
      topics: [shipQueueTimingSetTopic, topic(7n), topic(0n), topic(1770003200n)],
      data: abiWords(1770002600n, 4n, 28_800_000n, 2500n)
    });

    expect(indexer.playerQueues(player, planet.planetId).ship).toMatchObject({
      kind: "ship",
      itemId: 0,
      quantity: 2,
      readyAt: "1770001000",
      startedAt: "1770000000",
      productionTiming: {
        startedAt: "1770000000",
        originalQuantity: 2,
        unitWorkSeconds: "28800000",
        rate: "2500"
      },
      backlog: [
        {
          kind: "ship",
          itemId: 1,
          quantity: 3,
          readyAt: "1770002600",
          startedAt: "1770001000",
          productionTiming: {
            startedAt: "1770001000",
            originalQuantity: 3,
            unitWorkSeconds: "14400000",
            rate: "2500"
          },
          cost: { metal: "9000", crystal: "3000", deuterium: "0" }
        },
        {
          kind: "ship",
          itemId: 0,
          quantity: 4,
          readyAt: "1770003200",
          startedAt: "1770002600",
          productionTiming: {
            startedAt: "1770002600",
            originalQuantity: 4,
            unitWorkSeconds: "28800000",
            rate: "2500"
          }
        }
      ]
    });

    indexer.applyLog({
      blockNumber: "0xa3",
      transactionHash: "0xcomplete-one-small-cargo",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, 1n)
    });

    expect(indexer.playerQueues(player, planet.planetId).ship).toMatchObject({
      itemId: 0,
      quantity: 1,
      readyAt: "1770001000",
      cost: { metal: "2000", crystal: "2000", deuterium: "0" },
      productionTiming: {
        startedAt: "1770000000",
        originalQuantity: 2,
        unitWorkSeconds: "28800000",
        rate: "2500"
      },
      backlog: [
        { itemId: 1, quantity: 3, readyAt: "1770002600" },
        { itemId: 0, quantity: 4, readyAt: "1770003200" }
      ]
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 0)?.count).toBe(1);
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "0",
      crystal: "0",
      deuterium: "4800"
    });
  });

  test("indexes rift deposits and withdrawal lifecycle", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x8a",
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
      blockNumber: "0x8b",
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
    indexer.applyLog({
      blockNumber: "0x8c",
      transactionHash: "0xwithdraw",
      logIndex: "0x0",
      topics: [
        marketResourceWithdrawalRequestedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(250n, 1770500000n)
    });

    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      unlocked: true,
      resources: expect.arrayContaining([
        expect.objectContaining({
          key: "metal",
          inGameBalance: "750",
          lockedBalance: "250"
        })
      ]),
      pendingWithdrawals: [
        expect.objectContaining({
          kind: "legacyMarketWithdrawal",
          planetId: "7",
          amount: "250",
          resource: "metal",
          unlocksAt: "2026-02-07T21:33:20.000Z"
        })
      ]
    });

    indexer.applyLog({
      blockNumber: "0x8d",
      transactionHash: "0xfinishwithdraw",
      logIndex: "0x0",
      topics: [
        marketResourceWithdrawalFinishedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(250n)
    });

    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          key: "metal",
          inGameBalance: "750",
          lockedBalance: "0"
        })
      ]),
      pendingWithdrawals: []
    });
  });

  test("indexes active Rift extractions and reduces their public 100%-raidable balances", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xrift-start-metal",
      logIndex: "0x0",
      topics: [riftExtractionStartedTopic, addressTopic(player), topic(7n), topic(0n)],
      data: abiWords(1_000n, 1_770_000_000n, 1_772_419_200n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xrift-start-crystal",
      logIndex: "0x0",
      topics: [riftExtractionStartedTopic, addressTopic(player), topic(7n), topic(1n)],
      data: abiWords(500n, 1_770_000_000n, 1_772_419_200n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xrift-loot",
      logIndex: "0x0",
      topics: [riftExtractionLootedTopic, addressTopic("0x3333333333333333333333333333333333333333" as Address), topic(7n)],
      data: abiWords(250n, 100n, 0n)
    });

    expect(indexer.riftTargets()).toEqual([
      expect.objectContaining({
        planet: expect.objectContaining({ planetId: "7", owner: player }),
        startedAt: "1770000000",
        unlocksAt: "1772419200",
        resources: { metal: "750", crystal: "400", deuterium: "0" }
      })
    ]);
    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      pendingWithdrawals: expect.arrayContaining([
        expect.objectContaining({
          id: "extraction:7:0",
          kind: "riftExtraction",
          planetId: "7",
          amount: "750",
          resource: "metal",
          requestedAt: "2026-02-02T02:40:00.000Z",
          unlocksAt: "2026-03-02T02:40:00.000Z"
        }),
        expect.objectContaining({
          id: "extraction:7:1",
          amount: "400",
          resource: "crystal"
        })
      ]),
      resources: expect.arrayContaining([
        expect.objectContaining({ key: "metal", lockedBalance: "750" }),
        expect.objectContaining({ key: "crystal", lockedBalance: "400" })
      ])
    });

    indexer.applyLog({
      blockNumber: "0x92a",
      transactionHash: "0xrift-loot-survivor-zero",
      logIndex: "0x0",
      topics: [riftExtractionLootedTopic, addressTopic("0x3333333333333333333333333333333333333333" as Address), topic(7n)],
      data: abiWords(750n, 400n, 0n)
    });
    // A completely raided extraction remains active until its owner explicitly
    // finalizes it, so it must remain visible even when its survivor balance is zero.
    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      pendingWithdrawals: expect.arrayContaining([
        expect.objectContaining({ id: "extraction:7:0", amount: "0", kind: "riftExtraction" }),
        expect.objectContaining({ id: "extraction:7:1", amount: "0", kind: "riftExtraction" })
      ])
    });

    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xrift-finalize-metal",
      logIndex: "0x0",
      topics: [riftExtractionFinalizedTopic, addressTopic(player), topic(7n), topic(0n)],
      data: abiWords(750n)
    });
    expect(indexer.riftTargets()[0]?.resources).toEqual({ metal: "0", crystal: "0", deuterium: "0" });

    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xrift-finalize-crystal",
      logIndex: "0x0",
      topics: [riftExtractionFinalizedTopic, addressTopic(player), topic(7n), topic(1n)],
      data: abiWords(400n)
    });
    expect(indexer.riftTargets()).toEqual([]);
  });

  test("indexes alliance membership, profile, invites, and join requests from event logs", () => {
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const invitee = "0x5555555555555555555555555555555555555555" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
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
      blockTimestamp: "0x69801c83",
      transactionHash: "0xalliance-officer",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xalliance-role",
      logIndex: "0x0",
      topics: [allianceRoleUpdatedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      blockTimestamp: "0x69801c85",
      transactionHash: "0xalliance-invite",
      logIndex: "0x0",
      topics: [allianceInviteCreatedTopic, topic(1n), addressTopic(officer), addressTopic(invitee)],
      data: "0x"
    });
    indexer.applyLog({
      blockNumber: "0x96",
      transactionHash: "0xalliance-request",
      logIndex: "0x0",
      topics: [allianceJoinRequestedTopic, topic(1n), addressTopic(applicant)],
      data: abiWords(1770003000n)
    });

    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        description: "Indexed alliance",
        owner: player,
        memberCount: 2
      },
      members: [
        { address: player, role: "owner", joinedAt: String(0x69801c81) },
        { address: officer, role: "officer", joinedAt: String(0x69801c83) }
      ],
      allianceJoinRequests: [
        { allianceId: "1", requester: applicant, requesterTotalScore: "0", requestedAt: "1770003000" }
      ],
      diplomacy: [],
      activeWars: []
    });
    expect(indexer.allianceState(invitee).pendingInvites).toEqual([
      { allianceId: "1", inviter: officer, inviterDisplayName: null, invitedAt: String(0x69801c85) }
    ]);
    expect(indexer.allianceState(applicant).pendingJoinRequests).toEqual([
      { allianceId: "1", requester: applicant, requesterDisplayName: null, requestedAt: "1770003000" }
    ]);
    expect(indexer.allianceIntelForPlayers([player, applicant])).toEqual(new Map([
      [player, { allianceId: "1", tag: "VEY", name: "Veydrift Command" }]
    ]));
  });

  test("VEY-KANEO-783: removes a dissolved zero-member alliance from canonical directory reads", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xalliance-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
      data: abiStrings("SETO", "Seto")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xalliance-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    expect(indexer.allianceState(player)).toMatchObject({
      membership: { allianceId: "1", role: "owner" },
      directory: [{ allianceId: "1", tag: "SETO", memberCount: 1 }]
    });

    indexer.applyLog({
      blockNumber: "0x92",
      blockTimestamp: "0x69801c82",
      transactionHash: "0xalliance-dissolve",
      logIndex: "0x0",
      topics: [allianceLeftTopic, topic(1n), addressTopic(player)],
      data: "0x"
    });

    expect(indexer.allianceState(player)).toMatchObject({
      membership: { allianceId: "0", role: "none" },
      profile: null,
      directory: []
    });
    expect(indexer.allianceProfile("1")).toBeNull();

    // A later canonical join/create event makes a live roster visible again; zero-member filtering
    // is lifecycle-derived, not a permanent tombstone.
    indexer.applyLog({
      blockNumber: "0x93",
      blockTimestamp: "0x69801c83",
      transactionHash: "0xalliance-rejoin",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    expect(indexer.allianceState(player)).toMatchObject({
      membership: { allianceId: "1", role: "owner" },
      directory: [{ allianceId: "1", tag: "SETO", memberCount: 1 }]
    });
  });

  test("projects one war declaration reciprocally with shared declarer metadata", () => {
    const rival = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listSettledPlanetEvents() { return []; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listAllianceLogs() { return []; }
    }, 100n);

    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xalliance-create-1",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
      data: abiStrings("VEY", "Veydrift Command")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xalliance-owner-1",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      blockTimestamp: "0x69801c82",
      transactionHash: "0xalliance-create-2",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(2n), addressTopic(rival)],
      data: abiStrings("RVL", "Rivals")
    });
    indexer.applyLog({
      blockNumber: "0x93",
      blockTimestamp: "0x69801c83",
      transactionHash: "0xalliance-owner-2",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(2n), addressTopic(rival)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      blockTimestamp: "0x69801c84",
      transactionHash: "0xalliance-diplomacy",
      logIndex: "0x0",
      topics: [allianceDiplomacyUpdatedTopic, topic(2n), topic(1n)],
      data: abiWords(3n)
    });

    expect(indexer.allianceState(player).activeWars).toMatchObject([
      {
        allianceId: "1",
        otherAllianceId: "2",
        status: "war",
        initiatedByAllianceId: "2",
        declaredAt: String(0x69801c84)
      }
    ]);
    expect(indexer.allianceRelationship("1", "2")).toBe("war");
    expect(indexer.allianceState(rival).activeWars).toMatchObject([
      {
        allianceId: "2",
        otherAllianceId: "1",
        status: "war",
        initiatedByAllianceId: "2"
      }
    ]);
    expect(indexer.allianceRelationship("2", "1")).toBe("war");

    indexer.applyLog({
      blockNumber: "0x95",
      blockTimestamp: "0x69801c85",
      transactionHash: "0xalliance-war-ended",
      logIndex: "0x0",
      topics: [allianceDiplomacyUpdatedTopic, topic(2n), topic(1n)],
      data: abiWords(0n)
    });
    expect(indexer.allianceState(player).activeWars).toEqual([]);
    expect(indexer.allianceState(rival).activeWars).toEqual([]);
    expect(indexer.allianceRelationship("1", "2")).toBe("none");
    expect(indexer.allianceRelationship("2", "1")).toBe("none");
  });

  test("transfers alliance ownership to an officer from event logs", () => {
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
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
      blockTimestamp: "0x69801c82",
      transactionHash: "0xalliance-officer",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(2n)
    });

    // transferAllianceOwnership emits two role updates plus the ownership transfer.
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xalliance-transfer",
      logIndex: "0x0",
      topics: [allianceRoleUpdatedTopic, topic(1n), addressTopic(player)],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xalliance-transfer",
      logIndex: "0x1",
      topics: [allianceRoleUpdatedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xalliance-transfer",
      logIndex: "0x2",
      topics: [allianceOwnershipTransferredTopic, topic(1n), addressTopic(player), addressTopic(officer)],
      data: "0x"
    });

    expect(indexer.allianceState(officer)).toMatchObject({
      membership: { allianceId: "1", role: "owner" },
      profile: { owner: officer }
    });
    expect(indexer.allianceState(player).membership).toMatchObject({
      allianceId: "1",
      role: "officer"
    });
  });

  test("rebuild backfills alliance event logs into the indexed read model", async () => {
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
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
          },
          {
            blockNumber: "0x92",
            transactionHash: "0xalliance-profile",
            logIndex: "0x0",
            topics: [allianceProfileUpdatedTopic, topic(1n)],
            data: abiStrings("VEY", "Veydrift Command", "Indexed alliance")
          },
          {
            blockNumber: "0x93",
            blockTimestamp: "0x69801c83",
            transactionHash: "0xalliance-officer",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(1n), addressTopic(officer)],
            data: abiWords(2n)
          }
        ];
      }
    }, 100n);

    await indexer.rebuild();

    expect(indexer.snapshot()).toMatchObject({
      allianceStaleReason: null,
      indexedEventLogs: 4,
      safeToServeAllianceState: true,
      safeToServeIndexedState: true,
      staleReason: null
    });
    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        description: "Indexed alliance",
        owner: player,
        memberCount: 2
      },
      members: [
        { address: player, role: "owner", joinedAt: String(0x69801c81) },
        { address: officer, role: "officer", joinedAt: String(0x69801c83) }
      ]
    });
  });

  test("rebuild overlays imported alliance contract directory snapshots into the DB read model", async () => {
    const owner = "0x3333333333333333333333333333333333333333" as Address;
    const officer = "0x4444444444444444444444444444444444444444" as Address;
    const directory: AllianceState["directory"] = Array.from({ length: 15 }, (_, index) => {
      const allianceId = (index + 1).toString();
      const isImportedAlliance = allianceId === "15";
      return {
        allianceId,
        active: true,
        tag: isImportedAlliance ? "SWTS" : `A${allianceId.padStart(2, "0")}`,
        name: isImportedAlliance ? "Swets Empire" : `Alliance ${allianceId}`,
        description: isImportedAlliance ? "Imported from on-chain snapshot" : "",
        owner: isImportedAlliance ? owner : player,
        createdAt: (1770000000 + index).toString(),
        memberCount: isImportedAlliance ? 2 : 1,
        members: isImportedAlliance
          ? [
            { address: owner, role: "owner", joinedAt: "1770000015" },
            { address: officer, role: "officer", joinedAt: "1770000016" }
          ]
          : [
            { address: player, role: "owner", joinedAt: (1770000000 + index).toString() }
          ]
      };
    });
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async listAllianceLogs() { return []; },
      async listAllianceDirectoryState() {
        return directory;
      }
    }, 100n);

    await indexer.rebuild();

    const state = indexer.allianceState(owner);
    expect(indexer.snapshot()).toMatchObject({
      allianceStaleReason: null,
      safeToServeAllianceState: true
    });
    expect(state.directory.map((alliance) => alliance.allianceId)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"
    ]);
    expect(state).toMatchObject({
      membership: { allianceId: "15", role: "owner", joinedAt: "1770000015" },
      profile: {
        tag: "SWTS",
        name: "Swets Empire",
        description: "Imported from on-chain snapshot",
        owner,
        memberCount: 2
      },
      members: [
        { address: owner, role: "owner", joinedAt: "1770000015" },
        { address: officer, role: "officer", joinedAt: "1770000016" }
      ]
    });
  });

  test("derives alliance profile and directory memberCount from indexed roster rows", async () => {
    const owner = "0x3333333333333333333333333333333333333333" as Address;
    const directory: AllianceState["directory"] = [
      {
        allianceId: "37",
        active: true,
        tag: "ONE",
        name: "One Member",
        description: "Imported profile with stale count",
        owner,
        createdAt: "1770000037",
        memberCount: 0,
        members: [{ address: owner, role: "owner", joinedAt: "1770000037" }]
      }
    ];
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async listAllianceLogs() { return []; },
      async listAllianceDirectoryState() {
        return directory;
      }
    }, 100n);

    await indexer.rebuild();

    const state = indexer.allianceState(owner);
    expect(state.profile).toMatchObject({
      memberCount: 1,
      owner,
      tag: "ONE"
    });
    expect(state.directory.find((alliance) => alliance.allianceId === "37")).toMatchObject({
      memberCount: 1,
      members: [{ address: owner, role: "owner" }]
    });
    expect(indexer.allianceProfile("37")).toMatchObject({
      memberCount: 1,
      members: [{ address: owner, role: "owner" }]
    });
  });

  test("seeds alliance join requests, invites, and diplomacy from contract reads with no backing events", async () => {
    const db = new Database(":memory:");
    const owner = "0x3333333333333333333333333333333333333333" as Address;
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const invitee = "0x5555555555555555555555555555555555555555" as Address;
    const directory: AllianceState["directory"] = [
      {
        allianceId: "1",
        active: true,
        tag: "VEY",
        name: "Veydrift Command",
        description: "Imported",
        owner,
        createdAt: "1770000000",
        memberCount: 1,
        members: [{ address: owner, role: "owner", joinedAt: "1770000000" }]
      },
      {
        allianceId: "2",
        active: true,
        tag: "RVL",
        name: "Rivals",
        description: "Imported",
        owner: player,
        createdAt: "1770000001",
        memberCount: 1,
        members: [{ address: player, role: "owner", joinedAt: "1770000001" }]
      }
    ];
    const indexer = new SettlementIndexer({
      // The seed probes invites against the planet owners; supply applicant + invitee as owned planets.
      async listSettledPlanetEvents() {
        return [
          { ...planet, planetId: "70", owner: applicant },
          { ...planet, planetId: "71", owner: invitee }
        ];
      },
      async getInfrastructureState() { return { resources: { metal: "0", crystal: "0", deuterium: "0" }, buildings: [] } as unknown as InfrastructureState; },
      async getDefenseState() { return { resources: { metal: "0", crystal: "0", deuterium: "0" }, defenses: [] } as unknown as DefenseState; },
      async getShipyardState() { return { resources: { metal: "0", crystal: "0", deuterium: "0" }, ships: [] } as unknown as ShipyardState; },
      async getResearchState() { return { resources: { metal: "0", crystal: "0", deuterium: "0" }, technologies: [] } as unknown as ResearchState; },
      async getPlayerQueues() { return {} as unknown as PlayerQueues; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      // No alliance event logs at all — the migration case.
      async listAllianceLogs() { return []; },
      async listAllianceDirectoryState() { return directory; },
      async listAllianceJoinRequestState() {
        return [{ allianceId: "1", requester: applicant, requestedAt: "1770003000" }];
      },
      async listAllianceInviteState() {
        return [{ allianceId: "1", player: invitee, inviter: owner, invitedAt: "1770004000" }];
      },
      async listAllianceDiplomacyState() {
        return [
          { allianceId: "1", otherAllianceId: "2", statusId: 3 },
          { allianceId: "2", otherAllianceId: "1", statusId: 3 }
        ];
      }
    }, 100n, { database: db });

    await indexer.rebuild();

    expect(indexer.allianceState(applicant).pendingJoinRequests).toEqual([
      { allianceId: "1", requester: applicant, requesterDisplayName: null, requestedAt: "1770003000" }
    ]);
    expect(indexer.allianceState(invitee).pendingInvites).toEqual([
      { allianceId: "1", inviter: owner, inviterDisplayName: null, invitedAt: "1770004000" }
    ]);
    expect(
      db.query("SELECT alliance_id, other_alliance_id, status_id, initiated_by_alliance_id FROM contract_alliance_diplomacy ORDER BY alliance_id, other_alliance_id").all()
    ).toEqual([
      { alliance_id: "1", other_alliance_id: "2", status_id: 3, initiated_by_alliance_id: null },
      { alliance_id: "2", other_alliance_id: "1", status_id: 3, initiated_by_alliance_id: null }
    ]);
    expect(indexer.allianceState(owner).activeWars).toMatchObject([
      {
        allianceId: "1",
        otherAllianceId: "2",
        status: "war",
        initiatedByAllianceId: null,
        alliance: { allianceId: "2", tag: "RVL", name: "Rivals" }
      }
    ]);
  });

  test("keeps event-derived war initiator when chain snapshot mirrors legacy war state", async () => {
    const db = new Database(":memory:");
    const firstOwner = "0x1111111111111111111111111111111111111111" as Address;
    const secondOwner = "0x2222222222222222222222222222222222222222" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async listAllianceLogs() {
        return [
          {
            blockNumber: "0x90",
            blockTimestamp: "0x69801c80",
            transactionHash: "0xalliance-create-1",
            logIndex: "0x0",
            topics: [allianceCreatedTopic, topic(1n), addressTopic(firstOwner)],
            data: abiStrings("VEY", "Veydrift Command")
          },
          {
            blockNumber: "0x91",
            blockTimestamp: "0x69801c81",
            transactionHash: "0xalliance-owner-1",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(1n), addressTopic(firstOwner)],
            data: abiWords(3n)
          },
          {
            blockNumber: "0x92",
            blockTimestamp: "0x69801c82",
            transactionHash: "0xalliance-create-2",
            logIndex: "0x0",
            topics: [allianceCreatedTopic, topic(2n), addressTopic(secondOwner)],
            data: abiStrings("RVL", "Rivals")
          },
          {
            blockNumber: "0x93",
            blockTimestamp: "0x69801c83",
            transactionHash: "0xalliance-owner-2",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(2n), addressTopic(secondOwner)],
            data: abiWords(3n)
          },
          {
            blockNumber: "0x94",
            transactionHash: "0xalliance-diplomacy",
            logIndex: "0x0",
            topics: [allianceDiplomacyUpdatedTopic, topic(2n), topic(1n)],
            data: abiWords(3n)
          }
        ];
      },
      async listAllianceDiplomacyState() {
        return [
          { allianceId: "1", otherAllianceId: "2", statusId: 3 },
          { allianceId: "2", otherAllianceId: "1", statusId: 3 }
        ];
      }
    }, 100n, { database: db });

    await indexer.rebuild();

    expect(indexer.allianceState(firstOwner).activeWars).toMatchObject([
      { allianceId: "1", otherAllianceId: "2", status: "war", initiatedByAllianceId: "2" }
    ]);
    expect(indexer.allianceState(secondOwner).activeWars).toMatchObject([
      { allianceId: "2", otherAllianceId: "1", status: "war", initiatedByAllianceId: "2" }
    ]);
  });

  test("chain seed clears stale event-derived join requests, invites, and diplomacy when chain has none", async () => {
    const db = new Database(":memory:");
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const invitee = "0x5555555555555555555555555555555555555555" as Address;
    // First boot: an event stream creates an invite, a join request, and a diplomacy relation, but the
    // chain reads report none of them (the eventless migration removed them). The seed must win.
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
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
            data: abiWords(1n)
          },
          {
            blockNumber: "0x92",
            blockTimestamp: "0x69801c82",
            transactionHash: "0xalliance-invite",
            logIndex: "0x0",
            topics: [allianceInviteCreatedTopic, topic(1n), addressTopic(officer), addressTopic(invitee)],
            data: "0x"
          },
          {
            blockNumber: "0x93",
            transactionHash: "0xalliance-request",
            logIndex: "0x0",
            topics: [allianceJoinRequestedTopic, topic(1n), addressTopic(applicant)],
            data: abiWords(1770003000n)
          },
          {
            blockNumber: "0x94",
            transactionHash: "0xalliance-diplomacy",
            logIndex: "0x0",
            topics: [allianceDiplomacyUpdatedTopic, topic(1n), topic(2n)],
            data: abiWords(3n)
          }
        ];
      },
      // Chain getters all return empty — these methods exist so the seed runs and clears the tables.
      async listAllianceJoinRequestState() { return []; },
      async listAllianceInviteState() { return []; },
      async listAllianceDiplomacyState() { return []; }
    }, 100n, { database: db });

    await indexer.rebuild();

    expect(indexer.allianceState(applicant).pendingJoinRequests).toEqual([]);
    expect(indexer.allianceState(invitee).pendingInvites).toEqual([]);
    expect(db.query("SELECT COUNT(*) AS n FROM contract_alliance_join_requests").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM contract_alliance_invites").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM contract_alliance_diplomacy").get()).toEqual({ n: 0 });
  });

  test("alliance-only seed repairs stale member counts and reciprocal war protection without planet reads", async () => {
    const db = new Database(":memory:");
    const owner = "0x3333333333333333333333333333333333333333" as Address;
    const rival = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { throw new Error("alliance-only seed must not read debris events"); },
      async listMoonChanceReportEvents() { throw new Error("alliance-only seed must not read moon chance events"); },
      async listSettledPlanetEvents() { throw new Error("alliance-only seed must not read settled planets"); },
      async listAllianceDirectoryState() {
        return [
          {
            allianceId: "3",
            active: true,
            tag: "OLD",
            name: "Old Guard",
            description: "",
            owner: rival,
            createdAt: "1770000003",
            memberCount: 1,
            members: [{ address: rival, role: "owner", joinedAt: "1770000003" }]
          },
          {
            allianceId: "37",
            active: true,
            tag: "ONE",
            name: "One Member",
            description: "",
            owner,
            createdAt: "1770000037",
            memberCount: 0,
            members: [{ address: owner, role: "owner", joinedAt: "1770000037" }]
          }
        ];
      },
      async listAllianceJoinRequestState() {
        return [];
      },
      async listAllianceDiplomacyState() {
        return [{ allianceId: "37", otherAllianceId: "3", statusId: 3 }];
      }
    }, 100n, { database: db });

    db.query(`
      INSERT INTO contract_alliances (
        alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
      )
      VALUES (?, 1, ?, ?, '', lower(?), ?, ?, '{}')
    `).run("37", "ONE", "One Member", owner, "1770000037", 0);
    db.query("INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at) VALUES (?, lower(?), ?, ?)").run("37", owner, 3, "1770000037");
    db.query("INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at) VALUES (?, ?, ?, ?)").run("3", "37", 3, "43615945");

    await expect(indexer.seedCurrentAllianceState()).resolves.toMatchObject({
      allianceStaleReason: null,
      safeToServeAllianceState: true
    });

    expect(db.query("SELECT member_count FROM contract_alliances WHERE alliance_id = ?").get("37")).toEqual({
      member_count: 1
    });
    expect(indexer.allianceProfile("37")).toMatchObject({
      memberCount: 1,
      members: [{ address: owner, role: "owner" }]
    });
    expect(db.query("SELECT alliance_id, other_alliance_id, status_id FROM contract_alliance_diplomacy ORDER BY alliance_id, other_alliance_id").all()).toEqual([
      { alliance_id: "37", other_alliance_id: "3", status_id: 3 }
    ]);
    expect(indexer.allianceRelationship("3", "37")).toBe("war");
    expect(indexer.allianceRelationship("37", "3")).toBe("war");
  });

  test("keeps reconciled alliance state serveable when unrelated indexed state is stale", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
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
    }, 100n);

    await indexer.rebuild();
    indexer.markStale("indexed_state_reconciliation_pending");

    expect(indexer.snapshot()).toMatchObject({
      allianceStaleReason: null,
      safeToServeAllianceState: true,
      safeToServeIndexedState: false,
      staleReason: "indexed_state_reconciliation_pending"
    });
    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        owner: player,
        memberCount: 1
      }
    });
  });

  test("treats previously reconciled DB state as alliance-warm before the explicit marker exists", async () => {
    const db = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
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
    }, 100n, { database: db });

    await indexer.rebuild();
    db.query("DELETE FROM indexer_metadata WHERE key = 'allianceReconciledAt'").run();

    expect(indexer.snapshot()).toMatchObject({
      allianceStaleReason: null,
      safeToServeAllianceState: true
    });
    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      directory: [
        {
          tag: "VEY",
          name: "Veydrift Command",
          owner: player
        }
      ]
    });
  });

  test("indexes attacker and defender fleet mission visibility from mission event logs", () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const attackerPlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "99",
      owner: attacker,
      name: "Spearhead",
      galaxy: 3,
      system: 12,
      position: 4
    };
    indexer.applyEvent(planet);
    indexer.applyEvent(attackerPlanet);
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x0",
      topics: [
        fleetMissionLaunchedTopic,
        topic(44n),
        addressTopic(attacker),
        topic(3n)
      ],
      data: abiWords(99n, 7n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x1",
      topics: [
        fleetMissionCargoTopic,
        topic(44n)
      ],
      data: abiWords(100n, 50n, 0n, 20n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x2",
      topics: [
        fleetMissionShipsTopic,
        topic(44n)
      ],
      data: abiWords(1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x0",
      topics: [
        fleetMissionLaunchedTopic,
        topic(45n),
        addressTopic(player),
        topic(3n)
      ],
      data: abiWords(7n, 99n, 1770001300n, 1770002500n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x1",
      topics: [
        fleetMissionCargoTopic,
        topic(45n)
      ],
      data: abiWords(0n, 0n, 0n, 30n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x2",
      topics: [
        fleetMissionShipsTopic,
        topic(45n)
      ],
      data: abiWords(0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xfleetreturn",
      logIndex: "0x0",
      topics: [
        fleetMissionReturnExposedTopic,
        topic(45n),
        addressTopic(player),
        topic(2n)
      ],
      data: abiWords(7n, 99n, 1770002500n, 100n, 25n, 0n)
    });

    const defenderVisibility = indexer.fleetMissionVisibility(player);
    expect(defenderVisibility.outgoing).toEqual([]);
    expect(defenderVisibility.returning.map((mission) => mission.missionId)).toEqual(["45"]);
    expect(defenderVisibility.incoming[0]).toMatchObject({
      missionId: "44",
      missionType: "Attack",
      owner: attacker,
      originPlanetId: "99",
      targetPlanetId: "7",
      originPlanet: {
        planetId: "99",
        owner: attacker,
        name: "Spearhead",
        galaxy: 3,
        system: 12,
        position: 4,
        coordinates: "3:12:4"
      },
      targetPlanet: {
        planetId: "7",
        owner: player,
        name: null,
        galaxy: 2,
        system: 44,
        position: 9,
        coordinates: "2:44:9"
      },
      ships: {
        smallCargo: "1",
        lightFighter: "2"
      }
    });

    // VEY-403: mission planet references carry the real planet archetype (derived from the indexed
    // temperature) so Mission Control can render the same planet art the Galaxy view uses.
    const knownArchetypes = [
      "frozen-ice", "cold-tundra", "temperate-ocean", "lush-temperate", "warm-terracotta", "hot-desert", "scorching-molten",
    ];
    const incomingMission = defenderVisibility.incoming[0]!;
    expect(knownArchetypes).toContain(incomingMission.originPlanet!.archetype);
    expect(knownArchetypes).toContain(incomingMission.targetPlanet!.archetype);

    const attackerVisibility = indexer.fleetMissionVisibility(attacker);
    expect(attackerVisibility.outgoing.map((mission) => mission.missionId)).toEqual(["44"]);
    expect(attackerVisibility.incoming).toEqual([
      expect.objectContaining({
        missionId: "45",
        missionType: "Attack",
        owner: player,
        status: "Returning",
        targetPlanetId: "99"
      })
    ]);
    expect(attackerVisibility.returning).toEqual([]);
  });

  test("surfaces authorized friendly inbound missions without exposing missions targeting other wallets", () => {
    const friendly = "0x3333333333333333333333333333333333333333" as Address;
    const otherOwner = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyEvent({ ...planet, planetId: "98", owner: otherOwner, name: "Other target" });
    indexer.applyEvent({ ...planet, planetId: "99", owner: friendly, name: "Friendly origin" });

    for (const [missionId, targetPlanetId] of [[46n, 7n], [47n, 98n]] as const) {
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: `0xtransport-${missionId}`,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(friendly), topic(0n)],
        data: abiWords(99n, targetPlanetId, 4_000_000_000n, 4_000_001_200n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: `0xtransport-${missionId}`,
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(missionId)],
        data: abiWords(100n, 50n, 25n, 20n)
      });
      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: `0xtransport-${missionId}`,
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(missionId)],
        data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
      });
    }

    const visibility = indexer.fleetMissionVisibility(player);
    expect(visibility.incoming).toEqual([
      expect.objectContaining({
        missionId: "46",
        missionType: "Transport",
        owner: friendly,
        originPlanetId: "99",
        targetPlanetId: "7",
        status: "Outbound"
      })
    ]);
    expect(visibility.incoming.some((mission) => mission.missionId === "47")).toBe(false);
    expect(visibility.outgoing).toEqual([]);
    expect(visibility.returning).toEqual([]);

    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xtransport-46-return",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topic(46n), addressTopic(friendly), topic(2n)],
      data: abiWords(99n, 7n, 4_000_001_200n, 0n, 0n, 0n)
    });
    expect(indexer.fleetMissionVisibility(player).incoming).toEqual([
      expect.objectContaining({ missionId: "46", status: "Returning" })
    ]);

    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xtransport-46-returned",
      logIndex: "0x0",
      topics: [fleetMissionReturnedTopic, topic(46n), addressTopic(friendly), topic(99n)],
      data: "0x"
    });
    expect(indexer.fleetMissionVisibility(player).incoming).toEqual([]);
  });

  // VEY-KANEO-456: an incoming attack must expose its stationed allied defenders with full per-defender
  // detail (identity, ship composition, hold-until, the defended planet's Alliance Depot level) so the
  // Stationed defenses panel can render them — and the resolution must lazily reconcile as-of-now, so a
  // defender whose hold has already elapsed drops out without a settlement event landing first.
  test("resolves an incoming attack's stationed defenders and drops elapsed holds as-of-now", () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const defender = "0x4444444444444444444444444444444444444444" as Address;
    const expiredDefender = "0x5555555555555555555555555555555555555555" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyEvent({ ...planet, planetId: "99", owner: attacker, name: "Spearhead", galaxy: 3, system: 12, position: 4 });
    for (const [technologyId, level] of [[5n, 4n], [6n, 3n], [7n, 2n]] as const) {
      indexer.applyLog({
        blockNumber: "0x8f",
        transactionHash: `0xcombat-tech-${technologyId}`,
        logIndex: `0x${technologyId.toString(16)}`,
        topics: [researchCompletedTopic, addressTopic(defender), topic(technologyId)],
        data: abiWords(level)
      });
    }
    // Alliance Depot (building id 13) level 2 on the defended planet funds the holding-fuel upkeep.
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xdepot",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(13n)],
      data: abiWords(2n)
    });
    // Hostile attack #60 on the player's planet 7.
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xattack",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(60n), addressTopic(attacker), topic(3n)],
      data: abiWords(99n, 7n, 4000000000n, 4000001200n, 0n)
    });
    // Active AcsDefend #61 stationed against #60, holding well into the future (still stationed now).
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xdefend-active",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(61n), addressTopic(defender), topic(5n)],
      data: abiWords(12n, 7n, 4000000000n, 4000001200n, 60n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xdefend-active",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(61n)],
      data: abiWords(2n, 5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    // AcsDefend #62 stationed against #60 but whose hold elapsed in the past — still Outbound (no resolve
    // event yet), so only the as-of-now reconciliation can drop it.
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xdefend-expired",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(62n), addressTopic(expiredDefender), topic(5n)],
      data: abiWords(13n, 7n, 1000n, 2000n, 60n)
    });
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xdefend-expired",
      logIndex: "0x1",
      topics: [fleetMissionShipsTopic, topic(62n)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    const visibility = indexer.fleetMissionVisibility(player);
    const attack = visibility.incoming.find((mission) => mission.missionId === "60");
    expect(attack).toBeDefined();
    // Both defenders remain linked by id (raw on-chain links are not reconciled away)...
    expect(new Set(attack!.counterplayDefenderMissionIds)).toEqual(new Set(["61", "62"]));
    // ...but only the still-holding defender survives the as-of-now stationed-defense reconciliation.
    expect(attack!.stationedDefenders).toHaveLength(1);
    const surviving = attack!.stationedDefenders![0]!;
    expect(surviving).toMatchObject({
      missionId: "61",
      defender,
      defenderDisplayName: null,
      combatTechnology: { weapons: 4, shielding: 3, armor: 2 },
      holdUntil: "4000000000",
      allianceDepotLevel: 2
    });
    expect(surviving.ships).toMatchObject({ smallCargo: "2", lightFighter: "5" });
  });

  test("keeps an arrived DefenseHold recallable in outgoing visibility until its hold expires", () => {
    const originalDateNow = Date.now;
    Date.now = () => 4_000_000_000_000;
    try {
      const ally = "0x4444444444444444444444444444444444444444" as Address;
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n);
      indexer.applyEvent(planet);
      indexer.applyEvent({ ...planet, planetId: "12", owner: ally, name: "Ally Base", galaxy: 3, system: 12, position: 4 });
      indexer.applyLog({
        blockNumber: "0x94",
        transactionHash: "0xdefense-hold",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(6115n), addressTopic(ally), topic(9n)],
        data: abiWords(12n, 7n, 3999996400n, 4000010800n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x94",
        transactionHash: "0xdefense-hold",
        logIndex: "0x1",
        topics: [defenseHoldStationedTopic, topic(6115n), addressTopic(ally), topic(7n)],
        data: abiWords(12n, 3999996400n, 4000007200n, 4000010800n)
      });
      indexer.applyLog({
        blockNumber: "0x94",
        transactionHash: "0xdefense-hold",
        logIndex: "0x2",
        topics: [fleetMissionCargoTopic, topic(6115n)],
        data: abiWords(0n, 0n, 0n, 100n)
      });
      indexer.applyLog({
        blockNumber: "0x94",
        transactionHash: "0xdefense-hold",
        logIndex: "0x3",
        topics: [fleetMissionShipsTopic, topic(6115n)],
        data: abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n)
      });

      const visibility = indexer.fleetMissionVisibility(ally);
      const stationed = visibility.outgoing.find((mission) => mission.missionId === "6115");
      expect(stationed).toMatchObject({
        missionId: "6115",
        missionType: "DefenseHold",
        status: "Outbound",
        defenseHoldUntil: "4000007200",
        needsResolution: false,
        recallCost: "25"
      });
      expect(stationed?.asOfNow?.arrived).toBe(true);
      expect(stationed?.asOfNow?.returned).toBe(false);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("exposes exact active and fail-closed scheduled DefenseHold timing for solo attack previews", () => {
    const ally = "0x4444444444444444444444444444444444444444" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyEvent({ ...planet, planetId: "12", owner: ally, name: "Ally Base", galaxy: 3, system: 12, position: 4 });

    const launchDefenseHold = (
      missionId: bigint,
      arrivalAt: bigint,
      returnAt: bigint,
      blockNumber: string
    ) => {
      indexer.applyLog({
        blockNumber,
        transactionHash: `0xdefense-hold-${missionId}`,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(ally), topic(9n)],
        data: abiWords(12n, 7n, arrivalAt, returnAt, 0n)
      });
      indexer.applyLog({
        blockNumber,
        transactionHash: `0xdefense-hold-ships-${missionId}`,
        logIndex: "0x1",
        topics: [fleetMissionShipsTopic, topic(missionId)],
        data: abiWords(0n, 5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
      });
    };

    launchDefenseHold(6116n, 3_999_999_900n, 4_000_007_200n, "0x94");
    indexer.applyLog({
      blockNumber: "0x95",
      transactionHash: "0xstation-6116",
      logIndex: "0x0",
      topics: [defenseHoldStationedTopic, topic(6116n), addressTopic(ally), topic(7n)],
      data: abiWords(12n, 3_999_999_900n, 4_000_003_600n, 4_000_007_200n)
    });
    // This future arrival has no DefenseHoldStationed event yet. Its returnAt is only a conservative
    // upper bound for hold expiry, and its eventual stationed-storage lane is not knowable yet.
    launchDefenseHold(6117n, 4_000_000_300n, 4_000_007_500n, "0x96");

    expect(indexer.stationedDefendersForPlanet("7", 4_000_000_000)).toEqual([
      expect.objectContaining({
        missionId: "6116",
        arrivalAt: "3999999900",
        holdUntil: "4000003600",
        battleWindowComplete: true,
        laneGroup: 0
      })
    ]);
    expect(indexer.stationedDefenderForecastTimelineForPlanet("7", 4_000_000_000)).toEqual([
      expect.objectContaining({
        missionId: "6116",
        arrivalAt: "3999999900",
        holdUntil: "4000003600",
        battleWindowComplete: true,
        laneGroup: 0
      }),
      expect.objectContaining({
        missionId: "6117",
        arrivalAt: "4000000300",
        holdUntil: "4000007500",
        battleWindowComplete: false,
        laneGroup: null
      })
    ]);
  });

  // VEY-KANEO-471: the QA staging harness injects one fully-populated synthetic incoming attack so the
  // Stationed defenses panel can be verified without a real multi-wallet on-chain ACS Defend scenario.
  // It must (a) be absent unless the flag is on, (b) when on, expose two stationed defenders with
  // identity + ships + future hold-until + Alliance Depot level, and (c) target a planet the wallet
  // actually owns (never fabricate ownership).
  test("injects a synthetic populated stationed-defense attack only when the QA flag is enabled", () => {
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    };

    // Flag off (default): no synthetic incoming.
    const offIndexer = new SettlementIndexer(reader, 100n);
    offIndexer.applyEvent(planet); // player owns planet "7"
    expect(offIndexer.fleetMissionVisibility(player).incoming).toEqual([]);

    // Flag on, but the wallet owns no planet: still nothing to target, so nothing injected.
    const orphanIndexer = new SettlementIndexer(reader, 100n, { qaSyntheticStationedDefenders: true });
    expect(orphanIndexer.fleetMissionVisibility(player).incoming).toEqual([]);

    // Flag on with an owned planet: one synthetic populated attack appears.
    const onIndexer = new SettlementIndexer(reader, 100n, { qaSyntheticStationedDefenders: true });
    onIndexer.applyEvent(planet);
    const incoming = onIndexer.fleetMissionVisibility(player).incoming;
    expect(incoming).toHaveLength(1);
    const synthetic = incoming[0]!;
    expect(synthetic.missionId).toBe("qa-synthetic-attack");
    expect(synthetic.targetPlanetId).toBe("7");
    expect(synthetic.targetPlanet?.planetId).toBe("7");
    expect(synthetic.stationedDefenders).toHaveLength(2);
    const [first, second] = synthetic.stationedDefenders!;
    expect(first).toMatchObject({ missionId: "qa-synthetic-defender-1", defenderDisplayName: "QA Ally Alpha" });
    expect(Number(first!.holdUntil)).toBeGreaterThan(Math.floor(Date.now() / 1_000));
    expect(first!.ships.lightFighter).toBe("12");
    expect(first!.allianceDepotLevel).toBeGreaterThanOrEqual(0);
    expect(second!.missionId).toBe("qa-synthetic-defender-2");
    // The derived as-of-now timing is populated like any served mission.
    expect(synthetic.asOfNow).toBeDefined();
  });

  // VEY-KANEO-415: reproduce/confirm "active Colonize missions not visible in Mission Control".
  // This exercises the indexed (production) visibility path that backs the live Mission Control feed.
  // A colonize launch emits the same FleetMissionLaunched/Cargo/Ships events as any mission, with
  // missionType=Colonize (2) and a flag-encoded unsettled target id; the `outgoing` filter keys only
  // on owner + Outbound status, so the active colonize fleet is surfaced for its owner.
  test("indexes an active colonize mission into the owner's outgoing visibility feed", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet); // player owns home planet "7" at 2:44:9
    // _encodeColonyTarget(galaxy=2, system=44, position=10): (1 << 255) | (g << 24) | (s << 8) | p.
    const colonizeTargetId = (1n << 255n) | (2n << 24n) | (44n << 8n) | 10n;
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x0",
      topics: [
        fleetMissionLaunchedTopic,
        topic(50n),
        addressTopic(player),
        topic(2n) // Colonize
      ],
      data: abiWords(7n, colonizeTargetId, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(50n)],
      data: abiWords(0n, 0n, 0n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xcolonize",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(50n)],
      // One colony ship (4th ship slot), nothing else.
      data: abiWords(0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    const visibility = indexer.fleetMissionVisibility(player);
    const outgoing = visibility.outgoing.find((mission) => mission.missionId === "50");
    expect(outgoing).toMatchObject({
      missionId: "50",
      missionType: "Colonize",
      status: "Outbound",
      owner: player,
      originPlanetId: "7",
      targetPlanetId: colonizeTargetId.toString(),
      ships: { colonyShip: "1" }
    });
    expect(visibility.incoming).toEqual([]);
    expect(visibility.joinableAttacks).toEqual([]);
  });

  test("serves joinable attack participants with owner tech and exact interleaved lane groups", () => {
    const leadOwner = "0x3333333333333333333333333333333333333333" as Address;
    const defenderOwner = "0x4444444444444444444444444444444444444444" as Address;
    const joinedOwner = "0x5555555555555555555555555555555555555555" as Address;
    const holdOwner = "0x6666666666666666666666666666666666666666" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    const applyFleetLog = (
      missionId: bigint,
      owner: Address,
      missionType: bigint,
      originPlanetId: bigint,
      targetPlanetId: bigint,
      linkedAttackMissionId: bigint,
      blockNumber: string
    ) => {
      indexer.applyLog({
        blockNumber,
        transactionHash: `0xlaunch${missionId}`,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(missionType)],
        data: abiWords(originPlanetId, targetPlanetId, 1_900_000_000n, 1_900_000_600n, linkedAttackMissionId)
      });
    };
    const applyShips = (missionId: bigint, owner: Address, counts: bigint[]) => {
      indexer.applyLog({
        blockNumber: "0x95",
        transactionHash: `0xships${missionId}`,
        logIndex: "0x1",
        topics: [fleetMissionShipsTopic, topic(missionId), addressTopic(owner)],
        data: abiWords(...counts)
      });
    };

    applyFleetLog(70n, leadOwner, 3n, 10n, 99n, 700n, "0x90");
    applyShips(70n, leadOwner, [0n, 0n, 0n, 0n, 0n, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    // Link index 0 belongs to a defender, so the first joined attack must use lane group 2.
    applyFleetLog(71n, defenderOwner, 5n, 11n, 99n, 70n, "0x91");
    applyShips(71n, defenderOwner, [0n, 5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xjoin72",
      logIndex: "0x0",
      topics: [attackMissionJoinedTopic, topic(70n), topic(72n), addressTopic(joinedOwner)],
      data: abiWords(12n, 99n)
    });
    applyFleetLog(72n, joinedOwner, 8n, 12n, 99n, 70n, "0x92");
    applyShips(72n, joinedOwner, [0n, 0n, 0n, 0n, 0n, 0n, 12n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    // Link index 2 belongs to another defender. Defender lanes are the exact zero-based link indices,
    // while the joined attacker uses i + 1, so both legitimately expose lane group 2 in separate domains.
    applyFleetLog(73n, defenderOwner, 5n, 13n, 99n, 70n, "0x93");
    applyShips(73n, defenderOwner, [0n, 0n, 0n, 0n, 0n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);

    const stationDefenseHold = (missionId: bigint, blockNumber: string, holdUntil: bigint) => {
      applyFleetLog(missionId, holdOwner, 9n, missionId + 100n, 99n, 0n, blockNumber);
      applyShips(missionId, holdOwner, [0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
      indexer.applyLog({
        blockNumber,
        transactionHash: `0xstation${missionId}`,
        logIndex: "0x2",
        topics: [defenseHoldStationedTopic, topic(missionId), addressTopic(holdOwner), topic(99n)],
        data: abiWords(missionId + 100n, 1_899_999_900n, holdUntil, holdUntil + 600n)
      });
    };
    stationDefenseHold(80n, "0x94", 1_900_002_000n);
    stationDefenseHold(81n, "0x95", 1_900_003_000n);
    stationDefenseHold(82n, "0x96", 1_900_001_000n);
    // Solidity removes 81 with swap-pop, producing storage order [80, 82]. The UI later sorts by
    // holdUntil as [82, 80], but their simulation lanes must remain 5 and 4 respectively.
    indexer.applyLog({
      blockNumber: "0x97",
      transactionHash: "0xend81",
      logIndex: "0x0",
      topics: [defenseHoldEndedTopic, topic(81n), topic(99n)],
      data: abiWords(5n)
    });

    const joinable = indexer.fleetMissionVisibility(player).joinableAttacks
      .find((mission) => mission.missionId === "70");
    expect(joinable?.attackPreview).toMatchObject({
      selectedAttackerLaneGroup: 4,
      stationedDefenders: [
        {
          missionId: "71",
          defender: defenderOwner,
          laneGroup: 0,
          combatTechnology: { weapons: 0, shielding: 0, armor: 0 }
        },
        {
          missionId: "73",
          defender: defenderOwner,
          laneGroup: 2
        },
        {
          missionId: "82",
          defender: holdOwner,
          laneGroup: 5
        },
        {
          missionId: "80",
          defender: holdOwner,
          laneGroup: 4
        }
      ],
      participants: [
        {
          missionId: "70",
          laneGroup: 0,
          owner: leadOwner,
          ships: { battleship: "3" },
          combatTechnology: { weapons: 0, shielding: 0, armor: 0 }
        },
        {
          missionId: "72",
          laneGroup: 2,
          owner: joinedOwner,
          ships: { cruiser: "12" },
          combatTechnology: { weapons: 0, shielding: 0, armor: 0 }
        }
      ]
    });

    // A legacy/incomplete active hold without its immutable station event cannot be assigned a safe
    // storage-order lane. The public preview must name the gap instead of renumbering the display list.
    applyFleetLog(83n, holdOwner, 9n, 183n, 99n, 0n, "0x98");
    applyShips(83n, holdOwner, [0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    const incomplete = indexer.fleetMissionVisibility(player).joinableAttacks
      .find((mission) => mission.missionId === "70");
    expect(incomplete?.attackPreview).toMatchObject({
      selectedAttackerLaneGroup: null
    });
    expect(incomplete?.attackPreview?.unavailableReason).toContain(
      "DefenseHold #83 is missing from exact stationed-defense storage-order indexing"
    );
  });

  test("removed duplicate log marks reorg health instead of being ignored", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const log = {
      blockNumber: "0x7c",
      transactionHash: "0xabc",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    };

    indexer.applyLog(log);
    expect(indexer.applyLog({ ...log, removed: true })).toMatchObject({
      applied: false,
      duplicate: false,
      removed: true,
      snapshot: {
        indexedEventLogs: 2
      }
    });
    expect(indexer.snapshot().reorgDetectedAt).toBeTruthy();
  });

  test("rebuild applies repeated debris updates in chain order", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return [debris, updatedDebris, clearedDebris, updatedDebris]; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n);

    await expect(indexer.rebuild()).resolves.toMatchObject({
      indexedDebrisFields: 1,
      indexedPlanets: 1
    });
    expect(indexer.debrisFieldsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        planetId: planet.planetId,
        resources: updatedDebris.resources
      })
    ]);
  });

  test("rebuild stores current planet resources instead of settlement-log zero placeholders", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      transactionHash: "0x",
      blockNumber: "0",
      lastSettledAt: "1770000500",
      resources: {
        metal: "9100",
        crystal: "8200",
        deuterium: "7300"
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() {
        return [{
          ...planet,
          lastSettledAt: "0",
          resources: {
            metal: "0",
            crystal: "0",
            deuterium: "0"
          }
        }];
      }
    }, 100n);

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: planet.transactionHash,
      blockNumber: planet.blockNumber,
      lastSettledAt: currentPlanet.lastSettledAt,
      resources: currentPlanet.resources
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });

  test("keeps first-settlement resources when resource log arrives before planet metadata", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xsettle",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(7n)],
      data: abiWords(5000n, 4900n, 4800n, 1770000123n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xsettle",
      logIndex: "0x1",
      topics: [planetStartedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      blockNumber: "144",
      lastSettledAt: "1770000123",
      planetId: "7",
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      },
      transactionHash: "0xsettle"
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedPlanets: 1
    });
  });

  test("rebuild reconciles stale levels and queues from canonical on-chain snapshots", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: currentPlanet.resources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "8900", crystal: "7800", deuterium: "6700" },
      technologyLevels: {},
      buildings: [
        { id: 0, level: 4, cost: { metal: "960", crystal: "240", deuterium: "0" } },
        { id: 3, level: 2, cost: { metal: "150", crystal: "60", deuterium: "0" } }
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 3,
        readyAt: "1770000900",
        startedAt: "1770000300",
        cost: { metal: "150", crystal: "60", deuterium: "0" }
      }
    };
    const liveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: liveInfrastructure.queue,
      defense: {
        active: true,
        kind: "defense",
        itemId: 1,
        quantity: 2,
        readyAt: "1770001000",
        startedAt: "1770000400",
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        backlog: [
          {
            active: true,
            kind: "defense",
            itemId: 0,
            quantity: 3,
            readyAt: "1770001600",
            cost: { metal: "6000", crystal: "0", deuterium: "0" }
          }
        ]
      },
      ship: null,
      research: {
        active: true,
        kind: "research",
        itemId: 4,
        targetLevel: 2,
        readyAt: "1770001200",
        startedAt: "1770000600",
        cost: { metal: "800", crystal: "400", deuterium: "200" }
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; },
      async getPlayerQueues() { return liveQueues; },
      async getResearchState() {
        return {
          wallet: player,
          homePlanetId: planet.planetId,
          researchAvailable: true,
          resources: currentPlanet.resources,
          researchLabLevel: 1,
          researchNetworkLabLevels: [],
          technologyLevels: { "4": 2 },
          technologies: [
            { id: 4, level: 2, cost: { metal: "1600", crystal: "800", deuterium: "400" } }
          ],
          queue: liveQueues.research
        };
      }
    }, 100n);
    indexer.applyEvent({
      ...planet,
      resources: { metal: "1", crystal: "1", deuterium: "1" }
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xstale",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual(currentPlanet.resources);
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)).toMatchObject({
      id: 0,
      level: 4
    });
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 2
    });
    expect(indexer.playerQueues(player, planet.planetId).building).toMatchObject({
      kind: "building",
      itemId: 3,
      targetLevel: 3,
      readyAt: "1770000900"
    });
    expect(indexer.playerQueues(player, planet.planetId).defense).toMatchObject({
      kind: "defense",
      itemId: 1,
      quantity: 2,
      readyAt: "1770001000",
      backlog: [
        {
          kind: "defense",
          itemId: 0,
          quantity: 3,
          readyAt: "1770001600"
        }
      ]
    });
    expect(indexer.playerQueues(player, planet.planetId).research).toMatchObject({
      kind: "research",
      itemId: 4,
      targetLevel: 2,
      readyAt: "1770001200",
      startedAt: "1770000600"
    });
    expect(indexer.technologyLevels(player)).toMatchObject({
      "4": 2
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });

  // Canonical-mirror rework (replaces the removed verifyCanonicalState / per-planet self-heal,
  // VEY-KANEO-452): explicit rebuild is the canonical chain read, and it OVERWRITES
  // the stored canonical state with the contract values on every run — both upward and DOWNWARD — so any
  // on-chain drift the indexer never observed via events (the contract mutates resources/ships/defenses/
  // buildings for some actions without a replayable event) is corrected only when an operator runs it.
  test("explicit rebuild overwrites stored canonical state with contract values", async () => {
    let liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      productionPerHour: { metal: "0", crystal: "0", deuterium: "0" },
      energyBalance: { produced: "0", required: "0", scaleBps: "10000" },
      storageCaps: { metal: "1000000", crystal: "1000000", deuterium: "1000000" },
      protectedResources: { metal: "0", crystal: "0", deuterium: "0" },
      raidableResources: { metal: "0", crystal: "0", deuterium: "0" },
      technologyLevels: {},
      buildings: deriveBuildingRows((id) => (id === 0 ? 5 : 0)),
      queue: null
    };
    let liveShipyard: ShipyardState = {
      wallet: player,
      homePlanetId: planet.planetId,
      planetId: planet.planetId,
      productionAvailable: true,
      resources: null,
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 0,
      naniteLevel: 0,
      technologyLevels: {},
      ships: deriveShipRows((id) => (id === 1 ? 10 : 0)),
      queue: null
    };
    let liveDefense: DefenseState = {
      wallet: player,
      homePlanetId: planet.planetId,
      productionAvailable: true,
      resources: null,
      shipyardLevel: 0,
      naniteLevel: 0,
      missileSiloLevel: 0,
      technologyLevels: {},
      defenses: deriveDefenseRows((id) => (id === 2 ? 4 : 0)),
      queue: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; },
      async getShipyardState() { return liveShipyard; },
      async getDefenseState() { return liveDefense; }
    }, 100n);

    // First explicit rebuild pins the stored canonical mirror to the v1 on-chain state.
    await indexer.rebuild();
    expect(indexer.infrastructureRows(planet.planetId).find((row) => row.id === 0)?.level).toBe(5);
    expect(indexer.shipRows(planet.planetId).find((row) => row.id === 1)?.count).toBe(10);
    expect(indexer.defenseRows(planet.planetId).find((row) => row.id === 2)?.count).toBe(4);

    // Simulate on-chain moves the indexer never observed via events: a building downgrade, fleet losses,
    // a defense built, and resources spent — the kind of drift the contract applies without a replayable
    // event. The contract is canonical and always wins.
    liveInfrastructure = {
      ...liveInfrastructure,
      resources: { metal: "250", crystal: "8000", deuterium: "120" },
      buildings: deriveBuildingRows((id) => (id === 0 ? 3 : 0))
    };
    liveShipyard = { ...liveShipyard, ships: deriveShipRows((id) => (id === 1 ? 2 : 0)) };
    liveDefense = { ...liveDefense, defenses: deriveDefenseRows((id) => (id === 2 ? 7 : 0)) };

    // The next explicit rebuild OVERWRITES the stored canonical rows with the contract values — building
    // and ship counts dropped DOWNWARD, defense raised, resources re-pinned exactly to chain.
    await indexer.rebuild();
    expect(indexer.infrastructureRows(planet.planetId).find((row) => row.id === 0)?.level).toBe(3);
    expect(indexer.shipRows(planet.planetId).find((row) => row.id === 1)?.count).toBe(2);
    expect(indexer.defenseRows(planet.planetId).find((row) => row.id === 2)?.count).toBe(7);
    expect(indexer.planet(planet.planetId)?.resources).toEqual({ metal: "250", crystal: "8000", deuterium: "120" });
  });

  test("explicit rebuild seeds canonical active fleet missions missing from event logs", async () => {
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCanonicalFleetMissions() {
        return [{
          missionId: "90",
          statusId: 1,
          missionTypeId: 0,
          status: "Outbound",
          missionType: "Transport",
          owner: player,
          originPlanetId: planet.planetId,
          targetPlanetId: "8",
          departureAt: "1799999900",
          arrivalAt: "1800000000",
          returnAt: "1800000300",
          fuelCost: "4",
          cargo: { metal: "10", crystal: "20", deuterium: "30" },
          randomnessRequestId: null
        }];
      }
    }, 100n);

    await indexer.rebuild();

    expect(indexer.allActiveFleetMissions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missionId: "90",
          status: "Outbound",
          missionType: "Transport",
          owner: player,
          originPlanetId: planet.planetId,
          targetPlanetId: "8",
          cargo: { metal: "10", crystal: "20", deuterium: "30" }
        })
      ])
    );
  });

  test("startup replay repairs missing fleet mission rows from indexed mission logs under a stale canonical baseline", async () => {
    const database = new Database(":memory:");
    const reader = {
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return [moonChance]; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCanonicalFleetMissions() { return []; }
    };
    const writer = new SettlementIndexer(reader, 100n, { database });

    await writer.rebuild();
    expect(writer.snapshot().lastReconciledBlock).toBe("125");
    database.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES ('lastFleetMissionsReconciledAt', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run("2026-01-01T00:00:00.000Z");

    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xtransport1448",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(1448n), addressTopic(player), topic(0n)],
      data: abiWords(BigInt(planet.planetId), 188n, 1800000000n, 1800000300n)
    });
    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xtransport1448",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(1448n)],
      data: abiWords(10n, 20n, 30n, 4n)
    });
    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xtransport1448",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(1448n)],
      data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
    });

    expect(writer.fleetMission("1448")).toMatchObject({
      missionId: "1448",
      status: "Outbound",
      missionType: "Transport",
      owner: player,
      originPlanetId: planet.planetId,
      targetPlanetId: "188",
      transactionHash: "0xtransport1448"
    });

    database.query("DELETE FROM contract_fleet_missions WHERE mission_id = ?").run("1448");
    const readerRestart = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: false });
    expect(readerRestart.fleetMission("1448")).toBeNull();

    const restart = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: true });
    const row = database.query(`
      SELECT mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id, event_json
      FROM contract_fleet_missions
      WHERE mission_id = ?
    `).get("1448") as {
      mission_id: string;
      status_id: number;
      mission_type_id: number;
      owner: string;
      origin_planet_id: string;
      target_planet_id: string;
      event_json: string;
    } | null;
    expect(row).toMatchObject({
      mission_id: "1448",
      status_id: 1,
      mission_type_id: 0,
      owner: player,
      origin_planet_id: planet.planetId,
      target_planet_id: "188"
    });
    expect(JSON.parse(row!.event_json)).toMatchObject({ source: "indexed_mission_event_logs" });
    database.query(`
      UPDATE contract_fleet_missions
      SET fuel_cost = '0'
      WHERE mission_id = ?
    `).run("1448");

    expect(restart.fleetMission("1448")).toMatchObject({
      missionId: "1448",
      status: "Outbound",
      missionType: "Transport",
      fuelCost: "4",
      recallCost: "1",
      transactionHash: "0xtransport1448"
    });
  });

  test("archive reads recover recall provenance from stored logs when the canonical row predates provenance", async () => {
    const database = new Database(":memory:");
    const reader = {
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return [moonChance]; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCanonicalFleetMissions() { return []; }
    };
    const writer = new SettlementIndexer(reader, 100n, { database });
    await writer.rebuild();

    const missionId = 755n;
    const arrivalAt = 1_800_000_000n;
    const lateRecallReturnAt = arrivalAt + 600n;
    writer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xrecall755-launch",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(player), topic(3n)],
      data: abiWords(BigInt(planet.planetId), 188n, arrivalAt, arrivalAt + 1_200n, 0n)
    });
    writer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xrecall755-launch",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(missionId)],
      data: abiWords(0n, 0n, 0n, 200n)
    });
    writer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xrecall755-launch",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(missionId)],
      data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
    });
    writer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xrecall755",
      logIndex: "0x0",
      topics: [fleetMissionRecalledTopic, topic(missionId), addressTopic(player)],
      data: abiWords(lateRecallReturnAt, 50n)
    });
    writer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xrecall755-returned",
      logIndex: "0x0",
      topics: [fleetMissionReturnedTopic, topic(missionId), addressTopic(player), topic(BigInt(planet.planetId))],
      data: "0x"
    });

    expect(writer.fleetMission("755")).toMatchObject({
      missionId: "755",
      missionType: "Attack",
      status: "Returned",
      arrivalAt: arrivalAt.toString(),
      returnAt: lateRecallReturnAt.toString(),
      recallProvenance: "FleetMissionRecalled"
    });

    const storedRow = database.query(`
      SELECT event_json
      FROM contract_fleet_missions
      WHERE mission_id = ?
    `).get("755") as { event_json: string };
    const staleEvent = JSON.parse(storedRow.event_json) as {
      mission?: { recallProvenance?: string };
      recallProvenance?: string;
      source?: string;
    };
    delete staleEvent.recallProvenance;
    if (staleEvent.mission) delete staleEvent.mission.recallProvenance;
    staleEvent.source = "contract_snapshot";
    database.query(`
      UPDATE contract_fleet_missions
      SET event_json = ?
      WHERE mission_id = ?
    `).run(JSON.stringify(staleEvent), "755");
    database.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES ('lastReconciledBlock', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run("1000");

    const restart = new SettlementIndexer(reader, 100n, { database, runStartupBackfill: true });
    expect(restart.fleetMission("755")).toMatchObject({
      missionId: "755",
      missionType: "Attack",
      status: "Returned",
      recallProvenance: "FleetMissionRecalled"
    });
    expect(restart.fleetMissionArchive(player).completedMissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missionId: "755", recallProvenance: "FleetMissionRecalled" })
      ])
    );
    expect(restart.fleetMissionArchivePage(player, { page: 1, pageSize: 25 }).completedMissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missionId: "755", recallProvenance: "FleetMissionRecalled" })
      ])
    );
    expect(restart.globalFleetMissionArchivePage({ page: 1, pageSize: 25 }).completedMissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missionId: "755", recallProvenance: "FleetMissionRecalled" })
      ])
    );
    expect(restart.completedFleetMissionsFromCanonicalRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missionId: "755", recallProvenance: "FleetMissionRecalled" })
      ])
    );
  });

  test("applies live fleet mission events incrementally without full mission-log replay", async () => {
    const database = new Database(":memory:");
    const writer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return [moonChance]; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCanonicalFleetMissions() { return []; }
    }, 100n, { database });

    await writer.rebuild();
    const guardedWriter = writer as unknown as { replayFleetMissionRowsFromEventLogs: () => void };
    guardedWriter.replayFleetMissionRowsFromEventLogs = () => {
      throw new Error("live fleet events must not replay the full mission log table");
    };

    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xincremental-launch-2448",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(2448n), addressTopic(player), topic(0n)],
      data: abiWords(BigInt(planet.planetId), 188n, 1800000000n, 1800000300n)
    });
    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xincremental-launch-2448",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(2448n)],
      data: abiWords(10n, 20n, 30n, 4n)
    });
    writer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xincremental-launch-2448",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(2448n)],
      data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
    });

    expect(writer.fleetMission("2448")).toMatchObject({
      missionId: "2448",
      status: "Outbound",
      missionType: "Transport",
      cargo: { metal: "10", crystal: "20", deuterium: "30" },
      ships: expect.objectContaining({ smallCargo: "1" }),
      fuelCost: "4"
    });

    writer.applyLog({
      blockNumber: "0x71",
      transactionHash: "0xincremental-resolve-2448",
      logIndex: "0x0",
      topics: [fleetMissionResolvedTopic, topic(2448n)],
      data: abiWords(1800000300n)
    });
    writer.applyLog({
      blockNumber: "0x71",
      transactionHash: "0xincremental-resolve-2448",
      logIndex: "0x1",
      topics: [fleetMissionReturnExposedTopic, topic(2448n), addressTopic(player), topic(2n)],
      data: abiWords(BigInt(planet.planetId), 188n, 1800000300n, 10n, 20n, 30n)
    });

    expect(writer.fleetMission("2448")).toMatchObject({
      missionId: "2448",
      status: "Returning",
      cargo: { metal: "10", crystal: "20", deuterium: "30" },
      returnCargo: { metal: "10", crystal: "20", deuterium: "30" },
      ships: expect.objectContaining({ smallCargo: "1" }),
      fuelCost: "4"
    });

    writer.applyLog({
      blockNumber: "0x72",
      transactionHash: "0xincremental-return-2448",
      logIndex: "0x0",
      topics: [fleetMissionReturnedTopic, topic(2448n), addressTopic(player), topic(BigInt(planet.planetId))],
      data: "0x"
    });

    expect(writer.fleetMission("2448")).toMatchObject({
      missionId: "2448",
      status: "Returned",
      cargo: { metal: "10", crystal: "20", deuterium: "30" },
      returnCargo: { metal: "10", crystal: "20", deuterium: "30" },
      ships: expect.objectContaining({ smallCargo: "1" }),
      fuelCost: "4"
    });
  });

  test("reader mission caches refresh after another process indexes resolved attack logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(1776n), addressTopic(player), topic(3n)],
        data: abiWords(BigInt(planet.planetId), 8n, 1770001200n, 1770002400n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(1776n)],
        data: abiWords(0n, 0n, 0n, 4n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(1776n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x3",
        topics: [fleetMissionBodiesTopic, topic(1776n)],
        data: abiWords(0n, 1n)
      });

      const reader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(reader.fleetMission("1776")).toMatchObject({
        missionId: "1776",
        status: "Outbound"
      });
      expect(reader.allActiveFleetMissions().map((mission) => mission.missionId)).toContain("1776");
      expect(reader.battleReport("1776")).toBeNull();

      writer.applyLog({
        blockNumber: "0x80",
        transactionHash: "0xresolve1776",
        logIndex: "0x0",
        topics: [attackBattleResolvedTopic, topic(1776n), addressTopic(player), topic(8n)],
        data: abiWords(1n, 2n, 12345n, 3098n, 1448n, 454n)
      });
      writer.applyLog({
        blockNumber: "0x80",
        transactionHash: "0xresolve1776",
        logIndex: "0x1",
        topics: [combatLossesTopic, topic(1776n)],
        data: abiWords(0n, 0n, 0n, 0n, 0n, 0n)
      });
      writer.materializeBattleReportReadModelsForWorker(["1776"], "ingest");
      expect(writer.battleReportMaterializationStatus("1776")).toMatchObject({
        status: "ready",
        error: null
      });
      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xreturn1776",
        logIndex: "0x0",
        topics: [fleetMissionReturnExposedTopic, topic(1776n), addressTopic(player), topic(4n)],
        data: abiWords(BigInt(planet.planetId), 8n, 1770002400n, 3098n, 1448n, 454n)
      });
      writer.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xreturn1776",
        logIndex: "0x1",
        topics: [fleetMissionReturnedTopic, topic(1776n), addressTopic(player), topic(BigInt(planet.planetId))],
        data: "0x"
      });

      expect(reader.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("1776");
      expect(reader.allCompletedFleetMissions().map((mission) => mission.missionId)).toContain("1776");
      expect(reader.fleetMission("1776")).toMatchObject({
        missionId: "1776",
        status: "Returned",
        returnCargo: { metal: "3098", crystal: "1448", deuterium: "454" },
        transactionHash: "0xreturn1776",
        blockNumber: "145"
      });
      expect(reader.battleReport("1776")).toMatchObject({
        missionId: "1776",
        originIsMoon: false,
        targetIsMoon: true,
        loot: { metal: "3098", crystal: "1448", deuterium: "454" },
        attackerLosses: { metal: "0", crystal: "0", deuterium: "0" },
        defenderLosses: { metal: "0", crystal: "0", deuterium: "0" }
      });
      expect(reader.battleReportMaterializationStatus("1776")).toMatchObject({
        status: "ready",
        error: null
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("battle reports materialize an empty defender snapshot when a zero-round win proves no units without prior history", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5678",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5678n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 8n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5678",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5678n)],
      data: abiWords(0n, 0n, 0n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5678",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5678n)],
      data: abiWords(3n, ...Array.from({ length: 13 }, () => 0n))
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5678",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(5678n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 0n, 12345n, 2430n, 1364n, 375n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["5678"], "ingest");
    expect(indexer.battleReport("5678")).toMatchObject({
      defenderSnapshot: {
        fleet: [],
        defenses: []
      },
      defenderLossBreakdown: {
        planetFleet: {
          units: [],
          destroyedResources: { metal: "0", crystal: "0", deuterium: "0" }
        },
        stationedFleet: {
          destroyedResources: { metal: "0", crystal: "0", deuterium: "0" }
        },
        staticDefenses: {
          units: [],
          destroyedResources: { metal: "0", crystal: "0", deuterium: "0" },
          restoredResources: { metal: "0", crystal: "0", deuterium: "0" },
          netLostResources: { metal: "0", crystal: "0", deuterium: "0" }
        },
        fleetLossesReconciled: true
      }
    });
  });

  test("zero-round wins keep missing history unknown when the resolution changes an unhistoried target unit", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5679",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5679n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 8n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5679",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5679n)],
      data: abiWords(0n, 0n, 0n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5679",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5679n)],
      data: abiWords(3n, ...Array.from({ length: 13 }, () => 0n))
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5679",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(8n), topic(9n)],
      data: abiWords(0n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5679",
      logIndex: "0x1",
      topics: [attackBattleResolvedTopic, topic(5679n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 0n, 12345n, 2430n, 1364n, 375n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["5679"], "ingest");
    expect(indexer.battleReport("5679")).toMatchObject({
      defenderSnapshot: null,
      defenderLossBreakdown: null
    });
  });

  test("materializes destroyed, restored, and net static-defense losses from the battle transaction", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5682",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5682n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 8n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5682",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5682n)],
      data: abiWords(0n, 0n, 0n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5682",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5682n)],
      data: abiWords(3n, ...Array.from({ length: 13 }, () => 0n))
    });
    indexer.applyLog({
      blockNumber: "0x7f",
      transactionHash: "0xdefenses-before-5682",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
      data: abiWords(4n)
    });
    for (const [logIndex, total] of [2n, 1n, 0n, 2n].entries()) {
      indexer.applyLog({
        blockNumber: "0x80",
        transactionHash: "0xresolve5682",
        logIndex: `0x${logIndex.toString(16)}`,
        topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
        data: abiWords(total)
      });
    }
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5682",
      logIndex: "0x4",
      topics: [attackBattleResolvedTopic, topic(5682n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 3n, 12345n, 2430n, 1364n, 375n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5682",
      logIndex: "0x5",
      topics: [combatLossesTopic, topic(5682n)],
      data: abiWords(0n, 0n, 0n, 0n, 0n, 0n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["5682"], "ingest");
    expect(indexer.battleReport("5682")).toMatchObject({
      defenderSnapshot: {
        fleet: [],
        defenses: [{ id: 0, count: 4 }]
      },
      defenderLosses: { metal: "0", crystal: "0", deuterium: "0" },
      defenderLossBreakdown: {
        planetFleet: {
          units: [],
          destroyedResources: { metal: "0", crystal: "0", deuterium: "0" }
        },
        stationedFleet: {
          destroyedResources: { metal: "0", crystal: "0", deuterium: "0" }
        },
        staticDefenses: {
          units: [{
            id: 0,
            destroyed: 4,
            restored: 2,
            netLost: 2,
            remaining: 2
          }],
          destroyedResources: { metal: "8000", crystal: "0", deuterium: "0" },
          restoredResources: { metal: "4000", crystal: "0", deuterium: "0" },
          netLostResources: { metal: "4000", crystal: "0", deuterium: "0" }
        },
        fleetLossesReconciled: true
      }
    });
  });

  test("battle reports keep defender snapshots when all defenders die in the battle transaction", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5680",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5680n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 8n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5680",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5680n)],
      data: abiWords(0n, 0n, 0n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5680",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5680n)],
      data: abiWords(3n, ...Array.from({ length: 13 }, () => 0n))
    });
    indexer.applyLog({
      blockNumber: "0x7f",
      transactionHash: "0xdefender-before-battle",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
      data: abiWords(37n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5680",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
      data: abiWords(0n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5680",
      logIndex: "0x1",
      topics: [attackBattleResolvedTopic, topic(5680n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 37n, 12345n, 2430n, 1364n, 375n)
    });

    indexer.materializeBattleReportReadModelsForWorker(["5680"], "ingest");
    expect(indexer.battleReport("5680")).toMatchObject({
      defenderSnapshot: {
        fleet: [],
        defenses: [{ id: 0, count: 37 }]
      },
      defenderLossBreakdown: {
        staticDefenses: {
          units: [{
            id: 0,
            destroyed: 37,
            restored: 0,
            netLost: 37,
            remaining: 0
          }],
          destroyedResources: { metal: "74000", crystal: "0", deuterium: "0" },
          restoredResources: { metal: "0", crystal: "0", deuterium: "0" },
          netLostResources: { metal: "74000", crystal: "0", deuterium: "0" }
        }
      }
    });
  });

  test("mission report reads reuse persisted defender snapshots instead of rebuilding them", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5681",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5681n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 8n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5681",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5681n)],
      data: abiWords(0n, 0n, 0n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x70",
      transactionHash: "0xlaunch5681",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5681n)],
      data: abiWords(3n, ...Array.from({ length: 13 }, () => 0n))
    });
    indexer.applyLog({
      blockNumber: "0x7f",
      transactionHash: "0xpersisted-defender-before-battle",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
      data: abiWords(11n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5681",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(8n), topic(0n)],
      data: abiWords(0n)
    });
    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xresolve5681",
      logIndex: "0x1",
      topics: [attackBattleResolvedTopic, topic(5681n), addressTopic(player), topic(8n)],
      data: abiWords(1n, 11n, 12345n, 2430n, 1364n, 375n)
    });
    (indexer as unknown as { indexedFleetMissionReferenceIndex: () => never }).indexedFleetMissionReferenceIndex = () => {
      throw new Error("single-mission report reads must not build the full mission reference index");
    };

    expect(indexer.fleetMission("5681")).toMatchObject({ missionId: "5681" });
    indexer.materializeBattleReportReadModelsForWorker(["5681"], "ingest");

    (indexer as unknown as { battleTimeDefenderStates: () => never }).battleTimeDefenderStates = () => {
      throw new Error("mission detail must not rebuild defender snapshots after materialization");
    };

    expect(indexer.battleReport("5681")?.defenderSnapshot).toEqual({
      fleet: [],
      defenses: [{ id: 0, count: 11 }]
    });
  });

  test("materializes single and batched reports below 300ms without replaying 33k fleet logs", async () => {
    const database = new Database(":memory:");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n, { database });
    await indexer.rebuild();
    const defender = "0x4444444444444444444444444444444444444444" as Address;

    const applyFleetLog = (args: {
      blockNumber: string;
      transactionHash: string;
      logIndex: string;
      topics: string[];
      data: string;
    }) => indexer.applyLog({ ...args, removed: false });

    applyFleetLog({
      blockNumber: "0x60",
      transactionHash: "0xhold5500",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(5500n), addressTopic(defender), topic(9n)],
      data: abiWords(12n, 83n, 1_770_001_000n, 1_770_003_000n, 0n)
    });
    applyFleetLog({
      blockNumber: "0x60",
      transactionHash: "0xhold5500",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(5500n)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    applyFleetLog({
      blockNumber: "0x60",
      transactionHash: "0xhold5500",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(5500n)],
      data: abiWords(0n, 15n, ...Array.from({ length: 12 }, () => 0n))
    });
    applyFleetLog({
      blockNumber: "0x60",
      transactionHash: "0xhold5500",
      logIndex: "0x3",
      topics: [defenseHoldStationedTopic, topic(5500n), addressTopic(defender), topic(83n)],
      data: abiWords(12n, 1_770_001_000n, 1_770_002_000n, 1_770_003_000n)
    });

    const attackMissionIds = [5399n, 5400n, 5401n, 5402n, 5403n];
    for (const [index, missionId] of attackMissionIds.entries()) {
      const arrivalAt = 1_770_001_200n + BigInt(index);
      applyFleetLog({
        blockNumber: `0x${(0x70 + index).toString(16)}`,
        transactionHash: `0xattack${missionId}`,
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(player), topic(3n)],
        data: abiWords(7n, 83n, arrivalAt, arrivalAt + 300n, 0n)
      });
      applyFleetLog({
        blockNumber: `0x${(0x70 + index).toString(16)}`,
        transactionHash: `0xattack${missionId}`,
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(missionId)],
        data: abiWords(0n, 0n, 0n, 1n)
      });
      applyFleetLog({
        blockNumber: `0x${(0x70 + index).toString(16)}`,
        transactionHash: `0xattack${missionId}`,
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(missionId)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });
      applyFleetLog({
        blockNumber: `0x${(0x80 + index).toString(16)}`,
        transactionHash: `0xresolved${missionId}`,
        logIndex: "0x0",
        topics: [attackBattleResolvedTopic, topic(missionId), addressTopic(player), topic(83n)],
        data: abiWords(1n, 1n, 12345n, 0n, 0n, 0n)
      });
    }

    const insertFleetLog = database.query(`
      INSERT INTO indexed_mission_event_logs (event_id, event_kind, block_number, event_json)
      VALUES (?, 'fleet', ?, ?)
    `);
    const unrelatedLog = JSON.stringify({
      blockNumber: "0x1",
      transactionHash: "0xunrelated",
      logIndex: "0x0",
      removed: false,
      topics: [fleetMissionLaunchedTopic, topic(999_999n), addressTopic(player), topic(0n)],
      data: abiWords(7n, 999n, 1_700_000_000n, 1_700_000_300n, 0n)
    });
    database.transaction(() => {
      for (let index = 0; index < 33_000; index += 1) {
        insertFleetLog.run(`production-fleet-log-${index}`, String(index + 1), unrelatedLog);
      }
    })();

    (indexer as unknown as { decodedMissionLogs: () => never }).decodedMissionLogs = () => {
      throw new Error("battle report materialization must not replay the global fleet-log history");
    };

    const singleStartedAt = performance.now();
    expect(indexer.materializeBattleReportReadModelsForWorker(["5399"], "ingest")).toBe(1);
    const singleDuration = performance.now() - singleStartedAt;
    expect(singleDuration).toBeLessThan(300);

    const batchStartedAt = performance.now();
    expect(indexer.materializeBattleReportReadModelsForWorker(["5400", "5401", "5402", "5403"], "ingest")).toBe(4);
    const batchDuration = performance.now() - batchStartedAt;
    expect(batchDuration).toBeLessThan(300);

    for (const missionId of attackMissionIds) {
      expect(indexer.battleReport(missionId.toString())?.stationedDefenders).toEqual([
        expect.objectContaining({
          missionId: "5500",
          defender,
          ships: expect.objectContaining({ lightFighter: "15" }),
          holdUntil: "1770002000"
        })
      ]);
    }
    expect(database.query(`
      SELECT defender_mission_id, battle_mission_id
      FROM indexed_battle_report_stationed_defenders
      ORDER BY CAST(battle_mission_id AS INTEGER) ASC
    `).all()).toEqual(attackMissionIds.map((missionId) => ({
      defender_mission_id: "5500",
      battle_mission_id: missionId.toString()
    })));
    const queryPlan = database.query(`
      EXPLAIN QUERY PLAN
      SELECT *
      FROM contract_fleet_missions
      WHERE target_planet_id = ?
        AND mission_type_id = 9
        AND CAST(arrival_at AS INTEGER) <= CAST(? AS INTEGER)
        AND CAST(return_at AS INTEGER) >= CAST(? AS INTEGER)
    `).all("83", 1_770_001_200, 1_770_001_200) as Array<{ detail: string }>;
    expect(queryPlan.map((row) => row.detail).join(" "))
      .toContain("contract_fleet_missions_target_type_window_idx");
    database.close();
  });

  test("incomplete battle report logs fail materialization instead of starving newer pending reports", async () => {
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(chainReader, 100n);
    await indexer.rebuild();

    indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xincomplete-battle-report",
      logIndex: "0x0",
      topics: [combatLossesTopic, topic(700n)],
      data: abiWords(0n, 0n, 0n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xcomplete-battle-report",
      logIndex: "0x0",
      topics: [attackBattleResolvedTopic, topic(701n), addressTopic(player), topic(7n)],
      data: abiWords(1n, 1n, 12345n, 50n, 25n, 0n)
    });

    expect(indexer.pendingBattleReportMaterializationMissionIds(2)).toEqual(["700", "701"]);
    expect(indexer.materializeBattleReportReadModelsForWorker(["700"], "ingest")).toBe(0);
    expect(indexer.battleReportMaterializationStatus("700")).toMatchObject({
      status: "failed",
      attempts: 1,
      error: "Battle report logs are incomplete or missing for mission 700."
    });
    expect(indexer.pendingBattleReportMaterializationMissionIds(1)).toEqual(["701"]);

    expect(indexer.materializeBattleReportReadModelsForWorker(["701"], "ingest")).toBe(1);
    expect(indexer.battleReportMaterializationStatus("701")).toMatchObject({
      status: "ready",
      attempts: 1,
      error: null
    });
  });

  test("canonical fleet mission sync is a no-op; terminal rows must come from event logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    let canonicalMissions: CanonicalFleetMissionSnapshot[] = [];
    let canonicalReads = 0;
    const chainReader = {
      async listCanonicalFleetMissions() {
        canonicalReads += 1;
        return canonicalMissions;
      },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(4749n), addressTopic(player), topic(0n)],
        data: abiWords(BigInt(planet.planetId), 40n, 1767225000n, 1767225500n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(4749n)],
        data: abiWords(385n, 210n, 14n, 70n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(4749n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });

      const reader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(reader.allActiveFleetMissions().map((mission) => mission.missionId)).toContain("4749");
      expect(reader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Outbound",
        needsResolution: true
      });

      canonicalMissions = [{
        missionId: "4749",
        statusId: 4,
        missionTypeId: 0,
        status: "Returned",
        missionType: "Transport",
        owner: player,
        originPlanetId: planet.planetId,
        targetPlanetId: "40",
        departureAt: "43000000",
        arrivalAt: "1767225000",
        returnAt: "1767225500",
        fuelCost: "70",
        cargo: { metal: "385", crystal: "210", deuterium: "14" },
        randomnessRequestId: null
      }];

      const syncSnapshot = await writer.syncCanonicalFleetMissions("test");

      expect(canonicalReads).toBe(0);
      expect(syncSnapshot.lastCanonicalFleetMissionSyncRows).toBeNull();
      expect(syncSnapshot.lastCanonicalFleetMissionSyncUpdatedRows).toBeNull();
      expect(syncSnapshot.lastCanonicalFleetMissionSyncError).toBeNull();
      expect(reader.allActiveFleetMissions().map((mission) => mission.missionId)).toContain("4749");
      expect(reader.allCompletedFleetMissions().map((mission) => mission.missionId)).not.toContain("4749");
      expect(reader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Outbound",
        needsResolution: true
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("one-time fleet mission state heal repairs launch-only stale active rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    let canonicalReads = 0;
    let failNextCanonicalRead = true;
    const chainReader = {
      async getCanonicalFleetMission(missionId: bigint) {
        canonicalReads += 1;
        if (failNextCanonicalRead) {
          failNextCanonicalRead = false;
          throw new Error("temporary canonical read failure");
        }
        if (missionId !== 4749n) return null;
        return {
          missionId: "4749",
          statusId: 4,
          missionTypeId: 0,
          status: "Returned",
          missionType: "Transport",
          owner: player,
          originPlanetId: planet.planetId,
          targetPlanetId: "40",
          departureAt: "43000000",
          arrivalAt: "1767225000",
          returnAt: "1767225500",
          fuelCost: "70",
          cargo: { metal: "385", crystal: "210", deuterium: "14" },
          randomnessRequestId: null
        } satisfies CanonicalFleetMissionSnapshot;
      },
      async listCanonicalFleetMissions() {
        throw new Error("one-time active mission heal must not enumerate all fleet missions");
      },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(4749n), addressTopic(player), topic(0n)],
        data: abiWords(BigInt(planet.planetId), 40n, 1767225000n, 1767225500n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(4749n)],
        data: abiWords(385n, 210n, 14n, 70n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(4749n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });

      expect(writer.allActiveFleetMissions().map((mission) => mission.missionId)).toContain("4749");

      await expect(writer.startFleetMissionStateHealOnce("test-fleet-heal")).rejects.toThrow("temporary canonical read failure");
      expect(canonicalReads).toBe(1);
      expect(writer.snapshot()).toMatchObject({
        currentStateOneTimeHealCompletedAt: null,
        lastCurrentStateHealRunId: "test-fleet-heal"
      });

      const snapshot = await writer.startFleetMissionStateHealOnce("test-fleet-heal");
      expect(canonicalReads).toBe(2);
      expect(snapshot).toMatchObject({
        currentStateOneTimeHealCompletedAt: expect.any(String),
        lastCurrentStateHealRunId: "test-fleet-heal",
        lastCanonicalFleetMissionSyncRows: 1,
        lastCanonicalFleetMissionSyncUpdatedRows: expect.any(Number),
        lastCanonicalFleetMissionSyncError: null
      });

      const reader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(reader.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("4749");
      expect(reader.allCompletedFleetMissions().map((mission) => mission.missionId)).toContain("4749");
      expect(reader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Returned",
        needsResolution: false
      });

      const replayReader = new SettlementIndexer(chainReader, 100n, { databasePath });
      expect(replayReader.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("4749");
      expect(replayReader.allCompletedFleetMissions().map((mission) => mission.missionId)).toContain("4749");
      expect(replayReader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Returned",
        needsResolution: false
      });

      await writer.startFleetMissionStateHealOnce("test-fleet-heal");
      expect(canonicalReads).toBe(2);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("startup mission-event backfill fills missing rows from raw indexed logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(4749n), addressTopic(player), topic(0n)],
        data: abiWords(BigInt(planet.planetId), 40n, 1767225000n, 1767225500n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(4749n)],
        data: abiWords(385n, 210n, 14n, 70n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(4749n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });
      expect(writer.fleetMission("4749")).toMatchObject({ status: "Outbound" });

      const returnedLog = {
        blockNumber: "0x80",
        transactionHash: "0xreturn4749",
        logIndex: "0x0",
        topics: [fleetMissionReturnedTopic, topic(4749n), addressTopic(player), topic(BigInt(planet.planetId))],
        data: "0x"
      };
      const db = new Database(databasePath);
      db.query(`
        INSERT INTO indexed_event_logs (
          event_id, transaction_hash, log_index, block_number, removed, event_json, received_at
        )
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(
        "0xreturn4749:0x0",
        returnedLog.transactionHash,
        returnedLog.logIndex,
        "128",
        JSON.stringify(returnedLog),
        new Date().toISOString()
      );
      db.close();

      const replayReader = new SettlementIndexer(chainReader, 100n, { databasePath });
      expect(replayReader.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("4749");
      expect(replayReader.allCompletedFleetMissions().map((mission) => mission.missionId)).toContain("4749");
      expect(replayReader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Returned",
        needsResolution: false
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("duplicate fleet log repairs missing mission-event row", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(4749n), addressTopic(player), topic(0n)],
        data: abiWords(BigInt(planet.planetId), 40n, 1767225000n, 1767225500n, 0n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(4749n)],
        data: abiWords(385n, 210n, 14n, 70n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xtransport4749",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(4749n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });

      const returnedLog = {
        blockNumber: "0x80",
        transactionHash: "0xreturn4749",
        logIndex: "0x0",
        topics: [fleetMissionReturnedTopic, topic(4749n), addressTopic(player), topic(BigInt(planet.planetId))],
        data: "0x"
      };
      const db = new Database(databasePath);
      db.query(`
        INSERT INTO indexed_event_logs (
          event_id, transaction_hash, log_index, block_number, removed, event_json, received_at
        )
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(
        "0xreturn4749:0x0",
        returnedLog.transactionHash,
        returnedLog.logIndex,
        "128",
        JSON.stringify(returnedLog),
        new Date().toISOString()
      );
      db.close();

      const replayReader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(replayReader.applyLog(returnedLog)).toMatchObject({ applied: true, duplicate: true });
      expect(replayReader.fleetMission("4749")).toMatchObject({
        missionId: "4749",
        status: "Returned",
        needsResolution: false
      });

      const repairedDb = new Database(databasePath);
      expect(repairedDb.query("SELECT count(*) as count FROM indexed_mission_event_logs WHERE event_id = ?").get("0xreturn4749:0x0")).toMatchObject({ count: 1 });
      repairedDb.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("repairs stale ship projections from the latest journaled absolute-count event", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const absoluteShipCount = {
      blockNumber: "0x90",
      transactionHash: "0xabsolute-ship-count",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(BigInt(planet.planetId)), topic(4n)],
      data: abiWords(9n)
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog(absoluteShipCount);

      // Simulate the legacy failure mode: the immutable event journal survives but its mutable
      // ship-count rows were lost after a process interruption.
      const db = new Database(databasePath);
      for (const table of ["indexed_ship_counts", "contract_ship_counts"]) {
        db.query(`UPDATE ${table} SET count = 2 WHERE planet_id = ? AND ship_id = ?`).run(planet.planetId, 4);
      }
      db.close();

      expect(writer.applyLog(absoluteShipCount)).toMatchObject({ applied: true, duplicate: true });
      expect(writer.shipRows(planet.planetId).find((ship) => ship.id === 4)?.count).toBe(9);

      // The startup repair also handles a stale journal-only row even when no websocket duplicate
      // happens to arrive after a restart.
      const staleDb = new Database(databasePath);
      for (const table of ["indexed_ship_counts", "contract_ship_counts"]) {
        staleDb.query(`UPDATE ${table} SET count = 1 WHERE planet_id = ? AND ship_id = ?`).run(planet.planetId, 4);
      }
      staleDb.close();

      const restarted = new SettlementIndexer(chainReader, 100n, { databasePath });
      expect(restarted.shipRows(planet.planetId).find((ship) => ship.id === 4)?.count).toBe(9);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("canonical mission event_json supplies terminal return fields when decoded mission logs are launch-era", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      writer.applyEvent(planet);
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x0",
        topics: [fleetMissionLaunchedTopic, topic(1776n), addressTopic(player), topic(3n)],
        data: abiWords(BigInt(planet.planetId), 8n, 1770001200n, 1770002400n, 1503n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x1",
        topics: [fleetMissionCargoTopic, topic(1776n)],
        data: abiWords(0n, 0n, 0n, 24n)
      });
      writer.applyLog({
        blockNumber: "0x70",
        transactionHash: "0xlaunch1776",
        logIndex: "0x2",
        topics: [fleetMissionShipsTopic, topic(1776n)],
        data: abiWords(1n, ...Array.from({ length: 13 }, () => 0n))
      });
      writer.applyLog({
        blockNumber: "0x80",
        transactionHash: "0xresolve1776",
        logIndex: "0x0",
        topics: [attackBattleResolvedTopic, topic(1776n), addressTopic(player), topic(8n)],
        data: abiWords(1n, 2n, 12345n, 3098n, 1448n, 454n)
      });
      writer.applyLog({
        blockNumber: "0x80",
        transactionHash: "0xresolve1776",
        logIndex: "0x1",
        topics: [combatLossesTopic, topic(1776n)],
        data: abiWords(0n, 0n, 0n, 0n, 0n, 0n)
      });

      const db = new Database(databasePath);
      const returnedMission = {
        missionId: "1776",
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        returnCargo: { metal: "3098", crystal: "1448", deuterium: "454" },
        ships: {
          smallCargo: "1",
          lightFighter: "0",
          recycler: "0",
          colonyShip: "0",
          largeCargo: "0",
          heavyFighter: "0",
          cruiser: "0",
          battleship: "0",
          bomber: "0",
          destroyer: "0",
          deathstar: "0",
          battlecruiser: "0",
          reaper: "0",
          pathfinder: "0"
        },
        fuelCost: "24",
        recallCost: null,
        attackGroupId: null,
        joinedAttackMissionIds: [],
        defendsMissionId: null,
        counterplayDefenderMissionIds: [],
        needsResolution: false,
        transactionHash: "0xreturn1776",
        blockNumber: "43026481",
        launchBlockNumber: "43024663",
        owner: player,
        missionType: "Attack",
        status: "Returned",
        originPlanetId: planet.planetId,
        targetPlanetId: "8",
        arrivalAt: "1770001200",
        returnAt: "1770002400",
        randomnessRequestId: "1503"
      };
      db.query(`
        UPDATE contract_fleet_missions
        SET status_id = 4,
          fuel_cost = '0',
          event_json = ?
        WHERE mission_id = ?
      `).run(JSON.stringify({ source: "indexed_mission_event_logs", mission: returnedMission }), "1776");
      db.close();

      const reader = new SettlementIndexer(chainReader, 100n, { databasePath, runStartupBackfill: false });
      expect(reader.fleetMission("1776")).toMatchObject({
        missionId: "1776",
        status: "Returned",
        fuelCost: "24",
        returnCargo: { metal: "3098", crystal: "1448", deuterium: "454" },
        transactionHash: "0xreturn1776",
        blockNumber: "43026481",
        launchBlockNumber: "43024663",
        randomnessRequestId: "1503"
      });
      reader.materializeBattleReportReadModelsForWorker(["1776"], "ingest");
      expect(reader.battleReport("1776")).toMatchObject({
        missionId: "1776",
        loot: { metal: "3098", crystal: "1448", deuterium: "454" }
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("explicit rebuild uses canonical fleet mission status to repair active mission counts", async () => {
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async listCanonicalFleetMissions() {
        return [{
          missionId: "91",
          statusId: 4,
          missionTypeId: 0,
          status: "Returned",
          missionType: "Transport",
          owner: player,
          originPlanetId: planet.planetId,
          targetPlanetId: "8",
          departureAt: "1799999900",
          arrivalAt: "1800000000",
          returnAt: "1800000300",
          fuelCost: "4",
          cargo: { metal: "10", crystal: "20", deuterium: "30" },
          randomnessRequestId: null
        }];
      }
    }, 100n);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xmission91",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(91n), addressTopic(player), topic(0n)],
      data: abiWords(BigInt(planet.planetId), 8n, 1800000000n, 1800000300n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xmission91",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(91n)],
      data: abiWords(10n, 20n, 30n, 4n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xmission91",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(91n)],
      data: abiWords(2n, ...Array.from({ length: 13 }, () => 0n))
    });
    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).toContain("91");

    await indexer.rebuild();

    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("91");
    expect(indexer.allCompletedFleetMissions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missionId: "91",
          status: "Returned",
          ships: expect.objectContaining({ smallCargo: "2" })
        })
      ])
    );
  });

  test("explicit canonical sync replays logs then runs the one-time raw current-state heal", async () => {
    let fetchedLogs = 0;
    let readCanonicalInfrastructure = 0;
    let rawCanonicalReads = 0;
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: { metal: "777", crystal: "888", deuterium: "999" },
      productionPerHour: { metal: "0", crystal: "0", deuterium: "0" },
      energyBalance: { produced: "0", required: "0", scaleBps: "10000" },
      storageCaps: { metal: "1000000", crystal: "1000000", deuterium: "1000000" },
      protectedResources: { metal: "0", crystal: "0", deuterium: "0" },
      raidableResources: { metal: "0", crystal: "0", deuterium: "0" },
      technologyLevels: {},
      buildings: deriveBuildingRows((id) => (id === 0 ? 2 : 0)),
      queue: null
    };
    const liveShipyard: ShipyardState = {
      wallet: player,
      homePlanetId: planet.planetId,
      planetId: planet.planetId,
      productionAvailable: true,
      resources: null,
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 0,
      naniteLevel: 0,
      technologyLevels: {},
      ships: deriveShipRows((id) => (id === 1 ? 0 : 0)),
      queue: null
    };
    const liveDefense: DefenseState = {
      wallet: player,
      homePlanetId: planet.planetId,
      productionAvailable: true,
      resources: null,
      shipyardLevel: 0,
      naniteLevel: 0,
      missileSiloLevel: 0,
      technologyLevels: {},
      defenses: deriveDefenseRows((id) => (id === 2 ? 5 : 0)),
      queue: null
    };
    const indexer = new SettlementIndexer({
      async listContractLogs() {
        fetchedLogs += 1;
        return [
          {
            blockNumber: "0x91",
            transactionHash: "0xstale-ship",
            logIndex: "0x0",
            topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
            data: abiWords(12n)
          },
          {
            blockNumber: "0x90",
            transactionHash: "0xplanet",
            logIndex: "0x0",
            topics: [planetStartedTopic, addressTopic(player), topic(7n)],
            data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
          }
        ];
      },
      async listCurrentPlanets() { return [planet]; },
      async getCanonicalPlanetState(planetId) {
        rawCanonicalReads += 1;
        return {
          planetId: planetId.toString(),
          resources: liveInfrastructure.resources!,
          buildings: liveInfrastructure.buildings,
          defenses: liveDefense.defenses,
          ships: liveShipyard.ships,
          queues: {
            building: null,
            defense: null,
            ship: null
          }
        };
      },
      async getBlockNumber() { return 0x91n; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() {
        readCanonicalInfrastructure += 1;
        return liveInfrastructure;
      },
      async getShipyardState() { return liveShipyard; },
      async getDefenseState() { return liveDefense; },
      async getPlayerQueues() {
        return {
          wallet: player,
          homePlanetId: planet.planetId,
          building: null,
          defense: null,
          ship: null,
          research: null
        };
      }
    }, 100n);

    const result = await indexer.syncCanonicalState(100n, 0x91n);

    expect(fetchedLogs).toBe(1);
    expect(readCanonicalInfrastructure).toBe(0);
    expect(rawCanonicalReads).toBe(1);
    expect(result.replay.indexedEventLogs).toBeGreaterThan(0);
    expect(result.rebuild.lastReconciliationError).toBeNull();
    expect(result.rebuild.currentStateOneTimeHealCompletedAt).not.toBeNull();
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(2);
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(0);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 2)?.count).toBe(5);
    expect(indexer.planet(planet.planetId)?.resources).toEqual({ metal: "777", crystal: "888", deuterium: "999" });
  });

  test("current-state seed uses raw canonical rows and replays overlap logs", async () => {
    const stalePlanet = {
      ...planet,
      resources: {
        metal: "1",
        crystal: "1",
        deuterium: "1"
      }
    };
    const rawState: CanonicalPlanetChainState = {
      planetId: planet.planetId,
      resources: {
        metal: "321",
        crystal: "654",
        deuterium: "987"
      },
      buildings: deriveBuildingRows((id) => (id === 0 ? 4 : 0)),
      defenses: deriveDefenseRows((id) => (id === 2 ? 6 : 0)),
      ships: deriveShipRows((id) => (id === 1 ? 8 : 0)),
      queues: {
        building: null,
        defense: null,
        ship: null
      }
    };
    let rawReads = 0;
    const overlapArgs: Array<{ fromBlock: unknown; toBlock: unknown }> = [];
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [stalePlanet]; },
      async getCanonicalPlanetState(planetId) {
        rawReads += 1;
        expect(planetId).toBe(BigInt(planet.planetId));
        return rawState;
      },
      async getBlockNumber() { return 0x123n; },
      async listDebrisFieldEvents() { throw new Error("event backfill should not run"); },
      async listMoonChanceReportEvents() { throw new Error("event backfill should not run"); },
      async listSettledPlanetEvents() { throw new Error("settled event scan should not run"); },
      async listContractLogs(fromBlock, toBlock) {
        overlapArgs.push({ fromBlock, toBlock });
        return [
          {
            blockNumber: "0x121",
            transactionHash: "0xabc",
            logIndex: "0x0",
            topics: [planetShipCountChangedTopic, topic(BigInt(planet.planetId)), topic(1n)],
            data: abiWords(10n)
          },
          {
            blockNumber: "0x122",
            transactionHash: "0xdef",
            logIndex: "0x0",
            topics: [fleetMissionReturnedTopic, topic(70n), addressTopic(player), topic(BigInt(planet.planetId))],
            data: "0x"
          }
        ];
      },
      async getInfrastructureState() { throw new Error("high-level infrastructure reader should not run"); },
      async getShipyardState() { throw new Error("high-level shipyard reader should not run"); },
      async getDefenseState() { throw new Error("high-level defense reader should not run"); },
      async getPlayerQueues() { throw new Error("high-level queue reader should not run"); }
    }, 100n);
    indexer.applyLog({
      blockNumber: "0x120",
      transactionHash: "0x999",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(99n), topic(2n)],
      data: abiWords(3n)
    });

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastReconciledBlock: "291",
      lastReconciliationError: null
    });

    expect(rawReads).toBe(1);
    expect(overlapArgs).toEqual([{ fromBlock: 0x121n, toBlock: 0x123n }]);
    expect(indexer.planet(planet.planetId)?.resources).toEqual(rawState.resources);
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)?.level).toBe(4);
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 1)?.count).toBe(10);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 2)?.count).toBe(6);
    expect(indexer.shipRows("99").find((ship) => ship.id === 2)?.count).toBe(3);
  });

  test("current-state seed detects and heals stale ship counts from canonical rows (VEY-KANEO-605)", async () => {
    const zionOwner = "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee" as Address;
    const zionPlanet: SettledPlanetEvent = {
      ...planet,
      owner: zionOwner,
      planetId: "1",
      name: "New Zion",
      galaxy: 6,
      system: 9,
      position: 1
    };
    const rawState: CanonicalPlanetChainState = {
      planetId: "1",
      resources: zionPlanet.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows(() => 0),
      ships: deriveShipRows((id) => {
        if (id === 0) return 9;
        if (id === 1) return 16;
        if (id === 2) return 1;
        if (id === 5) return 10;
        if (id === 9) return 2;
        return 0;
      }),
      queues: {
        building: null,
        defense: null,
        ship: null
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [zionPlanet]; },
      async getCanonicalPlanetState(planetId) {
        expect(planetId).toBe(1n);
        return rawState;
      },
      async getBlockNumber() { return 0x200n; },
      async listContractLogs() { return []; },
      async listDebrisFieldEvents() { throw new Error("event backfill should not run"); },
      async listMoonChanceReportEvents() { throw new Error("event backfill should not run"); },
      async listSettledPlanetEvents() { throw new Error("settled event scan should not run"); }
    }, 100n);

    indexer.applyEvent(zionPlanet);
    indexer.applyLog({
      blockNumber: "0x1f0",
      transactionHash: "0xstale-small-cargo",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(1n), topic(0n)],
      data: abiWords(23n)
    });
    indexer.applyLog({
      blockNumber: "0x1f1",
      transactionHash: "0xstale-light-fighter",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(1n), topic(1n)],
      data: abiWords(18n)
    });

    expect(indexer.shipRows("1").find((ship) => ship.id === 0)?.count).toBe(23);
    expect(indexer.shipRows("1").find((ship) => ship.id === 1)?.count).toBe(18);

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastCurrentStateHealPlanetsScanned: 1,
      lastCurrentStateHealShipMismatches: 5,
      lastReconciledBlock: "512",
      lastReconciliationError: null
    });

    expect(indexer.shipRows("1").find((ship) => ship.id === 0)?.count).toBe(9);
    expect(indexer.availableShipRows("1").find((ship) => ship.id === 0)?.count).toBe(9);
    expect(indexer.shipRows("1").find((ship) => ship.id === 1)?.count).toBe(16);
    expect(indexer.shipRows("1").filter((ship) => ship.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 9 },
      { id: 1, count: 16 },
      { id: 2, count: 1 },
      { id: 5, count: 10 },
      { id: 9, count: 2 }
    ]);
  });

  test("current-state seed preserves newer exact deploy-return ship count logs over stale canonical rows (VEY-KANEO-670)", async () => {
    const rawState: CanonicalPlanetChainState = {
      planetId: planet.planetId,
      resources: planet.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows(() => 0),
      ships: deriveShipRows(() => 0),
      queues: {
        building: null,
        defense: null,
        ship: null
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async getCanonicalPlanetState(planetId) {
        expect(planetId).toBe(BigInt(planet.planetId));
        return rawState;
      },
      async getBlockNumber() { return 0x91n; },
      async listContractLogs() { return []; },
      async listDebrisFieldEvents() { throw new Error("event backfill should not run"); },
      async listMoonChanceReportEvents() { throw new Error("event backfill should not run"); },
      async listSettledPlanetEvents() { throw new Error("settled event scan should not run"); }
    }, 100n);
    indexer.applyEvent(planet);

    // Large Cargo (ship id 4) is present, deploys away, then a later deploy/return credits it back.
    // The current-state snapshot was read at block 0x91 and still says 0, so the stored exact block-0x92
    // PlanetShipCountChanged event must win for the served/API-facing roster.
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xlarge-cargo-initial",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(BigInt(planet.planetId)), topic(4n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlarge-cargo-deploy-away",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(BigInt(planet.planetId)), topic(4n)],
      data: abiWords(0n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xlarge-cargo-deploy-back",
      logIndex: "0x38",
      topics: [planetShipCountChangedTopic, topic(BigInt(planet.planetId)), topic(4n)],
      data: abiWords(1n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 4)?.count).toBe(1);

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastCurrentStateHealPlanetsScanned: 1,
      lastCurrentStateHealShipMismatches: 1,
      lastReconciledBlock: "145",
      lastReconciliationError: null
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 4)?.count).toBe(1);
    expect(indexer.availableShipRows(planet.planetId).find((ship) => ship.id === 4)?.count).toBe(1);
  });

  test("stored planet events do not overwrite canonical current-state identity", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const canonicalPlanet: SettledPlanetEvent = {
      ...planet,
      transactionHash: "0x",
      blockNumber: "0",
      fields: 190,
      temperature: -95,
      metalMultiplierBps: 10000,
      crystalMultiplierBps: 10000,
      deuteriumMultiplierBps: 14700
    };

    indexer.applyEvent(canonicalPlanet);
    indexer.applyEvent({
      ...planet,
      transactionHash: "0xolder-start-event",
      blockNumber: "999",
      fields: 211,
      temperature: -8,
      metalMultiplierBps: 12000,
      crystalMultiplierBps: 12500,
      deuteriumMultiplierBps: 10584
    });

    expect(indexer.planet(planet.planetId)).toMatchObject({
      fields: 190,
      temperature: -95,
      metalMultiplierBps: 10000,
      crystalMultiplierBps: 10000,
      deuteriumMultiplierBps: 14700
    });
  });

  test("explicit contract-log replay stays event-only and does not run targeted canonical heals", async () => {
    let canonicalReads = 0;
    const indexer = new SettlementIndexer({
      async getCanonicalPlanetState() {
        canonicalReads += 1;
        throw new Error("replay must not read canonical state");
      },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async listContractLogs() {
        return [{
          blockNumber: "0x95",
          transactionHash: "0xbattle",
          logIndex: "0x0",
          topics: [attackBattleResolvedTopic, topic(70n), addressTopic(player), topic(BigInt(planet.planetId))],
          data: abiWords(1n, 0n, 123n, 0n, 0n, 0n)
        }];
      }
    }, 100n);

    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x93",
      transactionHash: "0xstale-defense",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(BigInt(planet.planetId)), topic(1n)],
      data: abiWords(5n)
    });

    expect(indexer.defenseRows(planet.planetId).find((row) => row.id === 1)?.count).toBe(5);

    await indexer.replayContractLogs(0x94n, 0x95n);

    expect(canonicalReads).toBe(0);
    expect(indexer.defenseRows(planet.planetId).find((row) => row.id === 1)?.count).toBe(5);
  });

  test("current-state seed keeps unit rows contract-aligned while ignoring older replayed rows", async () => {
    const rawState: CanonicalPlanetChainState = {
      planetId: planet.planetId,
      resources: planet.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows((id) => {
        if (id === 0) return 9;
        if (id === 1) return 12;
        return 0;
      }),
      ships: deriveShipRows(() => 0),
      queues: {
        building: null,
        defense: {
          active: true,
          kind: "defense",
          itemId: 2,
          quantity: 2,
          readyAt: "1767225500",
          cost: { metal: "12000", crystal: "4000", deuterium: "0" }
        },
        ship: null
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async getCanonicalPlanetState(planetId) {
        expect(planetId).toBe(BigInt(planet.planetId));
        return rawState;
      },
      async getBlockNumber() { return 0x123n; },
      async listContractLogs() {
        return [
          {
            blockNumber: "0x121",
            transactionHash: "0xold-rocket-backlog",
            logIndex: "0x0",
            topics: [defenseQueuedTopic, topic(7n), topic(0n)],
            data: abiWords(668n, 1767225400n, 1n, 0n, 0n)
          },
          {
            blockNumber: "0x122",
            transactionHash: "0xold-light-laser-backlog",
            logIndex: "0x0",
            topics: [defenseQueuedTopic, topic(7n), topic(1n)],
            data: abiWords(2880n, 1767225450n, 1n, 0n, 0n)
          }
        ];
      },
      async listDebrisFieldEvents() { throw new Error("event backfill should not run"); },
      async listMoonChanceReportEvents() { throw new Error("event backfill should not run"); },
      async listSettledPlanetEvents() { throw new Error("settled event scan should not run"); },
      async getInfrastructureState() { throw new Error("high-level infrastructure reader should not run"); },
      async getShipyardState() { throw new Error("high-level shipyard reader should not run"); },
      async getDefenseState() { throw new Error("high-level defense reader should not run"); },
      async getPlayerQueues() { throw new Error("high-level queue reader should not run"); }
    }, 100n);

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastReconciledBlock: "291",
      lastReconciliationError: null
    });

    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 0)?.count).toBe(9);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)?.count).toBe(12);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 2)?.count).toBe(0);
    expect(indexer.playerQueues(player, planet.planetId).defense).toBeNull();

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastReconciledBlock: "291",
      lastReconciliationError: null
    });
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 0)?.count).toBe(9);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)?.count).toBe(12);
    expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 2)?.count).toBe(0);
  });

  test("serves only future deduplicated defense backlog entries behind the active queue", async () => {
    const planetOne: SettledPlanetEvent = {
      ...planet,
      planetId: "1",
      owner: player,
      galaxy: 6,
      system: 9,
      position: 1
    };
    const rawState: CanonicalPlanetChainState = {
      planetId: "1",
      resources: planetOne.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows((id) => {
        if (id === 0) return 12;
        if (id === 1) return 38;
        if (id === 6) return 7;
        return 0;
      }),
      ships: deriveShipRows(() => 0),
      queues: {
        building: null,
        defense: {
          active: true,
          kind: "defense",
          itemId: 2,
          quantity: 2,
          readyAt: "1781725842",
          cost: { metal: "4000", crystal: "12000", deuterium: "0" },
          backlog: [
            {
              active: true,
              kind: "defense",
              itemId: 1,
              quantity: 2,
              readyAt: "1781726802",
              cost: { metal: "1", crystal: "0", deuterium: "0" }
            },
            {
              active: true,
              kind: "defense",
              itemId: 0,
              quantity: 4,
              readyAt: "1781728722",
              cost: { metal: "1", crystal: "0", deuterium: "0" }
            }
          ]
        },
        ship: null
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planetOne]; },
      async getCanonicalPlanetState(planetId) {
        expect(planetId).toBe(1n);
        return rawState;
      },
      async getBlockNumber() { return 0x301n; },
      async listContractLogs() { return []; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { throw new Error("settled event scan should not run"); },
      async getInfrastructureState() { throw new Error("high-level infrastructure reader should not run"); },
      async getShipyardState() { throw new Error("high-level shipyard reader should not run"); },
      async getDefenseState() { throw new Error("high-level defense reader should not run"); },
      async getPlayerQueues() { throw new Error("high-level queue reader should not run"); }
    }, 100n);

    await expect(indexer.seedCurrentCanonicalState({ planetConcurrency: 25 })).resolves.toMatchObject({
      indexedPlanets: 1,
      lastReconciledBlock: "769",
      lastReconciliationError: null
    });

    for (const [index, defenseId, quantity, readyAt, startedAt] of [
      [1n, 0n, 3n, 1781577132n],
      [2n, 1n, 3n, 1781671566n],
      [3n, 0n, 1n, 1781672046n],
      [4n, 0n, 1n, 1781672046n],
      [5n, 1n, 2n, 1781726802n, 1781722014n],
      [6n, 0n, 4n, 1781728722n, 1781722034n]
    ] as const) {
      indexer.applyLog({
        blockNumber: "0x302",
        ...(startedAt ? { blockTimestamp: `0x${startedAt.toString(16)}` } : {}),
        transactionHash: `0xdefense-backlog-${index}`,
        logIndex: `0x${index.toString(16)}`,
        topics: [defenseQueuedTopic, topic(1n), topic(defenseId)],
        data: abiWords(quantity, readyAt, 1n, 0n, 0n)
      });
    }

    const defenseQueue = indexer.playerQueues(player, "1").defense;
    expect(defenseQueue).toMatchObject({
      kind: "defense",
      itemId: 2,
      quantity: 2,
      readyAt: "1781725842"
    });
    expect(defenseQueue?.backlog?.map(({ itemId, quantity, readyAt, startedAt }) => ({ itemId, quantity, readyAt, startedAt }))).toEqual([
      { itemId: 1, quantity: 2, readyAt: "1781726802", startedAt: "1781722014" },
      { itemId: 0, quantity: 4, readyAt: "1781728722", startedAt: "1781722034" }
    ]);
    expect(indexer.defenseRows("1").filter((defense) => defense.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 12 },
      { id: 1, count: 38 },
      { id: 6, count: 7 }
    ]);
  });

  test("keeps elapsed ship and defense queues out of canonical unit rows", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    const now = Math.floor(Date.now() / 1_000);

    indexer.applyLog({
      blockNumber: "0x300",
      transactionHash: "0xbase-ships",
      logIndex: "0x0",
      topics: [planetShipCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(4n)
    });
    indexer.applyLog({
      blockNumber: "0x301",
      transactionHash: "0xship-active-ready",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(2n)],
      data: abiWords(1n, BigInt(now - 120), 100n, 100n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x302",
      transactionHash: "0xship-backlog-ready",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, BigInt(now - 60), 1n, 0n, 0n)
    });

    indexer.applyLog({
      blockNumber: "0x303",
      transactionHash: "0xbase-defenses",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(7n), topic(0n)],
      data: abiWords(10n)
    });
    indexer.applyLog({
      blockNumber: "0x304",
      transactionHash: "0xdefense-active-ready",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, BigInt(now - 120), 100n, 100n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x305",
      transactionHash: "0xdefense-backlog-ready",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(5n, BigInt(now - 60), 1n, 0n, 0n)
    });

    expect(indexer.shipRows("7").filter((ship) => ship.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 4 }
    ]);
    expect(indexer.availableShipRows("7").filter((ship) => ship.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 7 },
      { id: 2, count: 1 }
    ]);
    expect(indexer.defenseRows("7").filter((defense) => defense.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 10 }
    ]);
    expect(indexer.playerQueues(player, "7")).toMatchObject({
      ship: null,
      defense: null
    });
  });

  test("unit rows stay canonical while launchable ships and highscores ignore queue artifacts", () => {
    const shalex = "0x4065de123cf18e9c4ab7da18db21518285ea164e" as Address;
    const noseals = "0x01bf1238aadc0f32d7881b90dc3c57247dff9ba9" as Address;
    const shipPlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "24",
      owner: shalex,
      galaxy: 2,
      system: 80,
      position: 4
    };
    const defensePlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "146",
      owner: noseals,
      galaxy: 2,
      system: 106,
      position: 6
    };
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(shipPlanet);
    indexer.applyEvent(defensePlanet);

    for (const [shipId, count] of [[0n, 5n], [1n, 3n], [5n, 2n], [9n, 4n]] as const) {
      indexer.applyLog({
        blockNumber: "0x200",
        transactionHash: `0xship-count-${shipId}`,
        logIndex: `0x${shipId.toString(16)}`,
        topics: [planetShipCountChangedTopic, topic(24n), topic(shipId)],
        data: abiWords(count)
      });
    }
    indexer.applyLog({
      blockNumber: "0x201",
      transactionHash: "0xship-active",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(24n), topic(3n)],
      data: abiWords(1n, 1767225500n, 100n, 100n, 0n)
    });
    for (const [index, shipId, quantity] of [
      [1n, 0n, 241n],
      [2n, 1n, 48n],
      [3n, 5n, 98n],
      [4n, 9n, 195n],
      [5n, 0n, 241n]
    ] as const) {
      indexer.applyLog({
        blockNumber: "0x202",
        transactionHash: `0xship-backlog-${index}`,
        logIndex: `0x${index.toString(16)}`,
        topics: [shipQueuedTopic, topic(24n), topic(shipId)],
        data: abiWords(quantity, 1767225400n + index, 1n, 0n, 0n)
      });
    }

    indexer.applyLog({
      blockNumber: "0x210",
      transactionHash: "0xdefense-count",
      logIndex: "0x0",
      topics: [planetDefenseCountChangedTopic, topic(146n), topic(0n)],
      data: abiWords(17n)
    });
    indexer.applyLog({
      blockNumber: "0x211",
      transactionHash: "0xdefense-active",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(146n), topic(1n)],
      data: abiWords(10n, 1767225500n, 100n, 100n, 0n)
    });
    for (const [index, quantity] of [[1n, 926n], [2n, 926n]] as const) {
      indexer.applyLog({
        blockNumber: "0x212",
        transactionHash: `0xdefense-backlog-${index}`,
        logIndex: `0x${index.toString(16)}`,
        topics: [defenseQueuedTopic, topic(146n), topic(0n)],
        data: abiWords(quantity, 1767225400n + index, 1n, 0n, 0n)
      });
    }

    expect(indexer.shipRows("24").filter((ship) => ship.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 5 },
      { id: 1, count: 3 },
      { id: 5, count: 2 },
      { id: 9, count: 4 }
    ]);
    expect(indexer.defenseRows("146").filter((defense) => defense.count > 0).map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 0, count: 17 }
    ]);

    const shalexScore = indexer.highscoreForWallet(shalex);
    expect(shalexScore.score.fleetCount).toBe("14");
    expect(shalexScore.score.fleet).toBe("62");
    const nosealsScore = indexer.highscoreForWallet(noseals);
    expect(nosealsScore.score.defense).toBe("34");

    const leaderboard = indexer.highscoreLeaderboard().entries;
    expect(leaderboard.find((entry) => entry.wallet === shalex)?.score).toMatchObject({
      fleet: "62",
      fleetCount: "14"
    });
    expect(leaderboard.find((entry) => entry.wallet === noseals)?.score.defense).toBe("34");
  });

  test("newer fleet mission events win over seeded canonical mission rows", async () => {
    const rawState: CanonicalPlanetChainState = {
      planetId: planet.planetId,
      resources: planet.resources,
      buildings: deriveBuildingRows(() => 0),
      defenses: deriveDefenseRows(() => 0),
      ships: deriveShipRows(() => 0),
      queues: {
        building: null,
        defense: null,
        ship: null
      }
    };
    const seededMission: CanonicalFleetMissionSnapshot = {
      missionId: "70",
      statusId: 1,
      missionTypeId: 3,
      status: "Outbound",
      missionType: "Attack",
      owner: player,
      originPlanetId: planet.planetId,
      targetPlanetId: "99",
      departureAt: "1770000000",
      arrivalAt: "1770001200",
      returnAt: "1770002400",
      fuelCost: "1",
      cargo: { metal: "0", crystal: "0", deuterium: "0" },
      randomnessRequestId: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [planet]; },
      async getCanonicalPlanetState() { return rawState; },
      async getBlockNumber() { return 0x123n; },
      async listCanonicalFleetMissions() { return [seededMission]; },
      async listContractLogs() { return []; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-70",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(70n), addressTopic(player), topic(3n)],
      data: abiWords(BigInt(planet.planetId), 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-70",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(70n)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xlaunch-70",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(70n)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    await indexer.seedCurrentCanonicalState({ planetConcurrency: 25 });
    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).toEqual(["70"]);

    indexer.applyLog({
      blockNumber: "0x124",
      transactionHash: "0xreturn-70",
      logIndex: "0x0",
      topics: [fleetMissionReturnedTopic, topic(70n), addressTopic(player), topic(BigInt(planet.planetId))],
      data: "0x"
    });

    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).toEqual([]);
    expect(indexer.allCompletedFleetMissions().map((mission) => mission.missionId)).toEqual(["70"]);
  });

  test("overdue attacks awaiting randomness do not pollute active mission feeds", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n, { randomnessEngineConfigured: true });
    indexer.applyEvent(planet);

    const missionId = 1947n;
    const attacker = "0x1c458243217468a52fe6389c57370b6ac075e166" as Address;
    indexer.applyLog({
      blockNumber: "0x290d14f",
      transactionHash: "0xlaunch-1947",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(attacker), topic(3n)],
      data: abiWords(35n, BigInt(planet.planetId), 1767225000n, 1767225300n, 1648n)
    });
    indexer.applyLog({
      blockNumber: "0x290d14f",
      transactionHash: "0xlaunch-1947",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(missionId)],
      data: abiWords(0n, 0n, 0n, 24n)
    });
    indexer.applyLog({
      blockNumber: "0x290d14f",
      transactionHash: "0xlaunch-1947",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(missionId)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });

    expect(indexer.fleetMission("1947")).toMatchObject({
      missionId: "1947",
      status: "Outbound",
      needsResolution: false,
      resolutionBlocker: "randomness_pending"
    });
    expect(indexer.allActiveFleetMissions().map((mission) => mission.missionId)).not.toContain("1947");
    expect(indexer.activeFleetMissionsForTarget(planet.planetId).map((mission) => mission.missionId)).not.toContain("1947");
    expect(indexer.dueUnresolvedFleetMissionsForPlanet(planet.planetId).map((mission) => mission.missionId)).toContain("1947");
  });

  test("explicit canonical sync is not aborted by the normal cold rebuild deadline", async () => {
    const reader = {
      async listContractLogs() {
        return [
          {
            blockNumber: "0x90",
            transactionHash: "0xplanet",
            logIndex: "0x0",
            topics: [planetStartedTopic, addressTopic(player), topic(7n)],
            data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
          }
        ];
      },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() {
        await wait(30);
        return [planet];
      }
    };

    await expect(new SettlementIndexer(reader, 100n, { rebuildDeadlineMs: 10 }).rebuild())
      .rejects.toThrow(/exceeded 10ms deadline/);

    const operatorSync = new SettlementIndexer(reader, 100n, { rebuildDeadlineMs: 10 });
    await expect(operatorSync.syncCanonicalState(100n, 0x90n)).resolves.toMatchObject({
      rebuild: {
        indexedPlanets: 1,
        lastReconciliationError: null
      }
    });
    expect(operatorSync.snapshot()).toMatchObject({
      indexedPlanets: 1,
      lastReconciliationError: null
    });
  });

  test("records reconciliation failures for health/debug visibility", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { throw new Error("RPC HTTP 429"); }
    }, 100n);

    await expect(indexer.rebuild()).rejects.toThrow("RPC HTTP 429");
    expect(indexer.snapshot()).toMatchObject({
      indexedPlanets: 0,
      lastReconciliationError: "RPC HTTP 429",
      reconciliationInProgress: false
    });
  });

  test("explicit contract-log replay applies events without canonical state reads", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { throw new Error("debris canonical read must not run"); },
      async listMoonChanceReportEvents() { throw new Error("moon canonical read must not run"); },
      async listSettledPlanetEvents() { throw new Error("settlement canonical read must not run"); },
      async getInfrastructureState() { throw new Error("infrastructure eth_call must not run"); },
      async getShipyardState() { throw new Error("shipyard eth_call must not run"); },
      async getDefenseState() { throw new Error("defense eth_call must not run"); },
      async getPlayerQueues() { throw new Error("queue eth_call must not run"); },
      async listContractLogs() {
        return [
          {
            blockNumber: "0x91",
            transactionHash: "0xship-count",
            logIndex: "0x0",
            topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
            data: abiWords(3n)
          },
          {
            blockNumber: "0x90",
            transactionHash: "0xplanet",
            logIndex: "0x0",
            topics: [planetStartedTopic, addressTopic(player), topic(7n)],
            data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
          }
        ];
      }
    }, 100n);

    await indexer.replayContractLogs(100n, 0x91n);

    expect(indexer.snapshot()).toMatchObject({
      indexedPlanets: 1,
      latestIndexedBlock: "145"
    });
    expect(indexer.shipRows("7").find((ship) => ship.id === 1)?.count).toBe(3);
  });

  test("explicit contract-log replay rebuilds stale materialized state from stored logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const invitee = "0x5555555555555555555555555555555555555555" as Address;
    const staleWallet = "0x6666666666666666666666666666666666666666" as Address;
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xsettled",
        logIndex: "0x0",
        topics: [planetSettledTopic, topic(7n)],
        data: abiWords(1200n, 800n, 400n, 1770000300n)
      });
      first.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xbuilding",
        logIndex: "0x0",
        topics: [buildingCompletedTopic, topic(7n), topic(3n)],
        data: abiWords(2n)
      });
      first.applyLog({
        blockNumber: "0x92",
        transactionHash: "0xship",
        logIndex: "0x10",
        topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
        data: abiWords(4n)
      });
      first.applyLog({
        blockNumber: "0x92",
        transactionHash: "0xship-earlier",
        logIndex: "0x2",
        topics: [planetShipCountChangedTopic, topic(7n), topic(1n)],
        data: abiWords(2n)
      });
      first.applyLog({
        blockNumber: "0x93",
        transactionHash: "0xdefense",
        logIndex: "0x0",
        topics: [planetDefenseCountChangedTopic, topic(7n), topic(2n)],
        data: abiWords(6n)
      });
      first.applyLog({
        blockNumber: "0x94",
        blockTimestamp: "0x69801c80",
        transactionHash: "0xalliance-create",
        logIndex: "0x0",
        topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
        data: abiStrings("VEY", "Veydrift Command")
      });
      first.applyLog({
        blockNumber: "0x95",
        blockTimestamp: "0x69801c81",
        transactionHash: "0xalliance-owner",
        logIndex: "0x0",
        topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
        data: abiWords(3n)
      });
      first.applyLog({
        blockNumber: "0x96",
        blockTimestamp: "0x69801c82",
        transactionHash: "0xalliance-invite",
        logIndex: "0x0",
        topics: [allianceInviteCreatedTopic, topic(1n), addressTopic(officer), addressTopic(invitee)],
        data: "0x"
      });
      first.applyLog({
        blockNumber: "0x97",
        transactionHash: "0xalliance-request",
        logIndex: "0x0",
        topics: [allianceJoinRequestedTopic, topic(1n), addressTopic(applicant)],
        data: abiWords(1770003000n)
      });
      first.applyLog({
        blockNumber: "0x98",
        transactionHash: "0xalliance-diplomacy",
        logIndex: "0x0",
        topics: [allianceDiplomacyUpdatedTopic, topic(1n), topic(2n)],
        data: abiWords(3n)
      });

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("UPDATE contract_planet_resources SET metal = '999999', crystal = '999999', deuterium = '999999' WHERE planet_id = ?").run("7");
        staleDb.query("UPDATE contract_building_levels SET level = 10 WHERE planet_id = ? AND building_id = ?").run("7", 3);
        staleDb.query("UPDATE contract_ship_counts SET count = 99 WHERE planet_id = ? AND ship_id = ?").run("7", 1);
        staleDb.query("UPDATE contract_defense_counts SET count = 99 WHERE planet_id = ? AND defense_id = ?").run("7", 2);
        staleDb.query("INSERT INTO contract_ship_counts (planet_id, ship_id, count) VALUES (?, ?, ?)").run("7", 5, 77);
        staleDb.query("INSERT INTO contract_defense_counts (planet_id, defense_id, count) VALUES (?, ?, ?)").run("7", 5, 88);
        staleDb.query(`
          INSERT INTO contract_alliances (
            alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
          )
          VALUES (?, 1, ?, ?, '', lower(?), ?, ?, '{}')
        `).run("9", "OLD", "Stale Alliance", staleWallet, "1770000000", 1);
        staleDb.query("INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at) VALUES (?, lower(?), ?, ?)").run("1", staleWallet, 1, "1770000000");
        staleDb.query("INSERT INTO contract_alliance_invites (alliance_id, player, inviter, invited_at) VALUES (?, lower(?), lower(?), ?)").run("1", staleWallet, player, "1770000000");
        staleDb.query("INSERT INTO contract_alliance_join_requests (alliance_id, requester, requested_at) VALUES (?, lower(?), ?)").run("1", staleWallet, "1770000000");
        staleDb.query("INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at) VALUES (?, ?, ?, ?)").run("9", "1", 2, "1770000000");
      } finally {
        staleDb.close();
      }

      let fetchedLogs = 0;
      const replayed = new SettlementIndexer({
        async listDebrisFieldEvents() { throw new Error("debris canonical read must not run"); },
        async listMoonChanceReportEvents() { throw new Error("moon canonical read must not run"); },
        async listSettledPlanetEvents() { throw new Error("settlement canonical read must not run"); },
        async getInfrastructureState() { throw new Error("infrastructure eth_call must not run"); },
        async getShipyardState() { throw new Error("shipyard eth_call must not run"); },
        async getDefenseState() { throw new Error("defense eth_call must not run"); },
        async getPlayerQueues() { throw new Error("queue eth_call must not run"); },
        async listContractLogs() {
          fetchedLogs += 1;
          return [];
        }
      }, 100n, { databasePath });

      await replayed.replayContractLogs(0x94n, 0x94n);

      expect(fetchedLogs).toBe(1);
      const repairedDb = new Database(databasePath, { readonly: true });
      try {
        expect(repairedDb.query("SELECT metal, crystal, deuterium FROM contract_planet_resources WHERE planet_id = ?").get("7")).toEqual({
          metal: "1200",
          crystal: "800",
          deuterium: "400"
        });
        expect(repairedDb.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get("7", 3)).toEqual({
          level: 2
        });
        expect(repairedDb.query("SELECT count FROM contract_ship_counts WHERE planet_id = ? AND ship_id = ?").get("7", 1)).toEqual({
          count: 4
        });
        expect(repairedDb.query("SELECT count FROM contract_defense_counts WHERE planet_id = ? AND defense_id = ?").get("7", 2)).toEqual({
          count: 6
        });
        expect(repairedDb.query("SELECT count FROM contract_ship_counts WHERE planet_id = ? AND ship_id = ?").get("7", 5)).toBeNull();
        expect(repairedDb.query("SELECT count FROM contract_defense_counts WHERE planet_id = ? AND defense_id = ?").get("7", 5)).toBeNull();
        expect(repairedDb.query("SELECT alliance_id FROM contract_alliances ORDER BY alliance_id").all()).toEqual([
          { alliance_id: "1" }
        ]);
        expect(repairedDb.query("SELECT member_count FROM contract_alliances WHERE alliance_id = ?").get("1")).toEqual({
          member_count: 1
        });
        expect(repairedDb.query("SELECT wallet, role_id FROM contract_alliance_members WHERE alliance_id = ? ORDER BY wallet").all("1")).toEqual([
          { wallet: player, role_id: 3 }
        ]);
        expect(repairedDb.query("SELECT player, inviter FROM contract_alliance_invites WHERE alliance_id = ? ORDER BY player").all("1")).toEqual([
          { player: invitee, inviter: officer }
        ]);
        expect(repairedDb.query("SELECT requester, requested_at FROM contract_alliance_join_requests WHERE alliance_id = ? ORDER BY requester").all("1")).toEqual([
          { requester: applicant, requested_at: "1770003000" }
        ]);
        expect(repairedDb.query("SELECT alliance_id, other_alliance_id, status_id FROM contract_alliance_diplomacy ORDER BY alliance_id, other_alliance_id").all()).toEqual([
          { alliance_id: "1", other_alliance_id: "2", status_id: 3 },
          { alliance_id: "2", other_alliance_id: "1", status_id: 3 }
        ]);
      } finally {
        repairedDb.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("explicit contract-log replay leaves materialized state intact when no stored ledger exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; },
        async listContractLogs() { return []; }
      }, 100n, { databasePath });
      indexer.applyEvent(planet);

      const db = new Database(databasePath);
      try {
        db.query("INSERT INTO contract_building_levels (planet_id, building_id, level) VALUES (?, ?, ?)").run("7", 0, 5);
      } finally {
        db.close();
      }

      expect(indexer.infrastructureRows("7").find((building) => building.id === 0)?.level).toBe(5);

      await indexer.replayContractLogs(200n, 200n);

      expect(indexer.infrastructureRows("7").find((building) => building.id === 0)?.level).toBe(5);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a failed reconcile never takes a previously reconciled index out of service (VEY-KANEO-461)", async () => {
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(reader, 100n);

    // A baseline reconciliation succeeds: the websocket-synced read model is now authoritative.
    await indexer.rebuild();
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      safeToServeAllianceState: true,
      lastReconciliationError: null
    });

    // A later background reconcile hits a transient truncated/empty RPC body and throws.
    reader.listSettledPlanetEvents = async () => {
      throw new Error("Unexpected end of JSON input");
    };
    await expect(indexer.reconcile("periodic self-heal")).rejects.toThrow("Unexpected end of JSON input");

    // The flaky reconcile must NOT take the service down: the indexed state stays serveable, the
    // error is surfaced for visibility, and the reconcile simply retries in the background.
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      safeToServeAllianceState: true,
      lastReconciliationError: "Unexpected end of JSON input",
      staleReason: null
    });
  });

  test("keeps a previously reconciled index serveable while background reconciliation runs", async () => {
    let releaseRebuild = () => {};
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(reader, 100n);

    await indexer.rebuild();
    reader.listSettledPlanetEvents = async () => {
      await new Promise<void>((resolve) => {
        releaseRebuild = resolve;
      });
      return [planet];
    };

    const rebuilding = indexer.rebuild();

    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      reconciliationInProgress: true,
      safeToServeIndexedState: true,
      staleReason: "reconciliation_in_progress"
    });

    releaseRebuild();
    await rebuilding;
  });

  for (const reason of ["planet_resources_pending:127", "planet_identity_pending:124"]) {
    test(`keeps a previously reconciled index serveable while resolving ${reason}`, async () => {
      let releaseRebuild = () => {};
      const reader = {
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return [planet]; }
      };
      const indexer = new SettlementIndexer(reader, 100n);

      await indexer.rebuild();
      reader.listSettledPlanetEvents = async () => {
        await new Promise<void>((resolve) => {
          releaseRebuild = resolve;
        });
        return [planet];
      };

      const rebuilding = indexer.reconcile(reason);

      expect(indexer.snapshot()).toMatchObject({
        indexedState: "healthy",
        pendingReconciliationReason: reason,
        reconciliationInProgress: true,
        safeToServeIndexedState: true,
        staleReason: "reconciliation_in_progress"
      });

      releaseRebuild();
      await rebuilding;
    });
  }

  test("rebuild preserves newer queues but never infers a research spend from its player-scoped event", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const emptyLiveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: null,
      defense: null,
      ship: null,
      research: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getPlayerQueues() { return emptyLiveQueues; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x390",
      transactionHash: "0xrebuild-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(6n)],
      data: abiWords(2n, 1770002000n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x391",
      transactionHash: "0xrebuild-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
    });
    indexer.applyLog({
      blockNumber: "0x392",
      transactionHash: "0xrebuild-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(2n)],
      data: abiWords(3n, 1770002200n, 60n, 30n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x393",
      transactionHash: "0xrebuild-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 1770002300n, 40n, 20n, 0n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "9700",
      crystal: "8700",
      deuterium: "7700"
    });
    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: { kind: "building", itemId: 6, targetLevel: 2, readyAt: "1770002000" },
      research: { kind: "research", itemId: 4, targetLevel: 2, readyAt: "1770002100" },
      ship: { kind: "ship", itemId: 2, quantity: 3, readyAt: "1770002200" },
      defense: { kind: "defense", itemId: 1, quantity: 5, readyAt: "1770002300" }
    });
  });

  test("rebuild uses live canonical resources without subtracting active queue costs again", async () => {
    const previewResources = {
      metal: "1888",
      crystal: "579",
      deuterium: "2261"
    };
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "14831",
        crystal: "6519",
        deuterium: "2263"
      }
    };
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: previewResources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "888", crystal: "0", deuterium: "1261" },
      technologyLevels: {},
      buildings: [],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 12,
        readyAt: "1770002000",
        cost: { metal: "6487", crystal: "2594", deuterium: "0" }
      }
    };
    const liveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: liveInfrastructure.queue,
      defense: {
        active: true,
        kind: "defense",
        itemId: 0,
        quantity: 1,
        readyAt: "1770002100",
        cost: { metal: "2000", crystal: "0", deuterium: "0" }
      },
      ship: {
        active: true,
        kind: "ship",
        itemId: 1,
        quantity: 1,
        readyAt: "1770002200",
        cost: { metal: "3000", crystal: "1000", deuterium: "0" }
      },
      research: {
        active: true,
        kind: "research",
        itemId: 9,
        targetLevel: 1,
        readyAt: "1770002300",
        cost: { metal: "2000", crystal: "4000", deuterium: "600" }
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; },
      async getPlayerQueues() { return liveQueues; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x390",
      transactionHash: "0xrebuild-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(12n, 1770002000n, 6487n, 2594n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x391",
      transactionHash: "0xrebuild-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, 1770002100n, 2000n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x392",
      transactionHash: "0xrebuild-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1770002200n, 3000n, 1000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x393",
      transactionHash: "0xrebuild-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(9n)],
      data: abiWords(1n, 1770002300n, 2000n, 4000n, 600n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual(previewResources);
    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: { kind: "building", itemId: 3, targetLevel: 12 },
      defense: { kind: "defense", itemId: 0, quantity: 1 },
      ship: { kind: "ship", itemId: 1, quantity: 1 },
      research: { kind: "research", itemId: 9, targetLevel: 1 }
    });
  });

  test("rebuild drops event-derived queues that canonical levels prove completed", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const completedInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: currentPlanet.resources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "8900", crystal: "7800", deuterium: "6700" },
      technologyLevels: { "4": 2 },
      buildings: [
        { id: 3, level: 5, cost: { metal: "569", crystal: "227", deuterium: "0" } },
        { id: 6, level: 1, cost: { metal: "800", crystal: "400", deuterium: "200" } }
      ],
      queue: null
    };
    const completedResearch: ResearchState = {
      wallet: player,
      homePlanetId: planet.planetId,
      researchAvailable: true,
      resources: currentPlanet.resources,
      researchLabLevel: 1,
      researchNetworkLabLevels: [],
      technologyLevels: { "4": 2 },
      technologies: [
        { id: 4, level: 2, cost: { metal: "1600", crystal: "800", deuterium: "400" } }
      ],
      queue: null
    };
    const emptyLiveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: null,
      defense: null,
      ship: null,
      research: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return completedInfrastructure; },
      async getPlayerQueues() { return emptyLiveQueues; },
      async getResearchState() { return completedResearch; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x3a0",
      transactionHash: "0xcompleted-building-without-log",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(5n, 1770002000n, 379n, 151n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x3a1",
      transactionHash: "0xcompleted-research-without-log",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
    });

    await indexer.rebuild();

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: null,
      research: null
    });
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 5
    });
    expect(indexer.technologyLevels(player)).toMatchObject({ "4": 2 });
  });

  test("rebuild does not resurrect event-derived building queues that canonical infrastructure verified empty", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: currentPlanet.resources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "8900", crystal: "7800", deuterium: "6700" },
      technologyLevels: {},
      buildings: [
        { id: 0, level: 5, cost: { metal: "960", crystal: "240", deuterium: "0" } },
        { id: 3, level: 6, cost: { metal: "150", crystal: "60", deuterium: "0" } }
      ],
      queue: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x3a0",
      transactionHash: "0xstale-solar",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(6n, 1770002000n, 100n, 50n, 0n)
    });

    await indexer.rebuild();

    expect(indexer.playerQueues(player, planet.planetId).building).toBeNull();
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 6
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });

  test("memoizes the highscore leaderboard against the state version and invalidates on mutation (VEY-KANEO-467)", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xlevel",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(5n)
    });

    const versionBefore = indexer.stateVersion();
    const first = indexer.highscoreLeaderboard();
    const second = indexer.highscoreLeaderboard();
    // Repeated reads between block integrations return the SAME memoized object (no recompute).
    expect(second).toBe(first);
    expect(indexer.stateVersion()).toBe(versionBefore);
    // The memoized entries match a direct, un-cached computation.
    expect(first.entries).toEqual(indexer.highscoreEntriesForOwners(indexer.settledPlanetsByOwner()));
    expect(first.entries.length).toBe(1);

    // Integrating another event bumps the state version and invalidates the cache.
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xlevel2",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(7n)
    });
    expect(indexer.stateVersion()).toBeGreaterThan(versionBefore);
    const third = indexer.highscoreLeaderboard();
    expect(third).not.toBe(first);
    expect(third.entries).toEqual(indexer.highscoreEntriesForOwners(indexer.settledPlanetsByOwner()));
  });

  test("reader highscore leaderboard cache observes writer resource updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-highscore-cache-"));
    const databasePath = join(dir, "contract-state.sqlite");
    const chainReader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };

    try {
      const writer = new SettlementIndexer(chainReader, 100n, { databasePath });
      await writer.rebuild();
      const reader = new SettlementIndexer(chainReader, 100n, {
        databasePath,
        runStartupBackfill: false
      });

      const before = reader.highscoreLeaderboard();
      expect(before.planetsByOwner.get(player)?.[0]?.resources.metal).toBe("5000");

      const now = Math.floor(Date.now() / 1000);
      writer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xraid-spend",
        logIndex: "0x0",
        topics: [planetSettledTopic, topic(BigInt(planet.planetId))],
        data: abiWords(1234n, 567n, 89n, BigInt(now))
      });

      const after = reader.highscoreLeaderboard();
      expect(after).not.toBe(before);
      expect(after.planetsByOwner.get(player)?.[0]?.resources).toEqual({
        metal: "1234",
        crystal: "567",
        deuterium: "89"
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("keeps the indexed highscore cache version stable for mission-only events", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    const indexedVersionBefore = indexer.indexedStateCacheVersion();
    const responseVersionBefore = indexer.responseCacheVersion();

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xmission-only",
      logIndex: "0x0",
      topics: [fleetMissionReturnExposedTopic, topic(50n), addressTopic(player), topic(3n)],
      data: abiWords(7n, 100n, 300n, 0n, 0n, 0n)
    });

    expect(indexer.indexedStateCacheVersion()).toBe(indexedVersionBefore);
    expect(indexer.responseCacheVersion()).not.toBe(responseVersionBefore);
  });

  test("keeps projected elapsed building and research queues out of bulk highscore leaderboard scores", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    const elapsedReadyAt = 1_767_000_100n;

    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xqueued-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, elapsedReadyAt, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xqueued-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, elapsedReadyAt, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xqueued-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, elapsedReadyAt, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xqueued-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(1n, elapsedReadyAt, 0n, 0n, 0n)
    });

    const leaderboardEntry = indexer.highscoreLeaderboard().entries[0]!;
    const directWalletEntry = indexer.highscoreForWallet(player);

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: null,
      defense: null,
      ship: null,
      research: null
    });
    expect(leaderboardEntry.score).toEqual(directWalletEntry.score);
    expect(leaderboardEntry.totalUserScore).toBe(directWalletEntry.totalUserScore);
    expect(leaderboardEntry.score.total).toBe("0");
  });

  test("keeps cached highscore leaderboard stable when a queue merely becomes due as of now", () => {
    const originalNow = new Date("2026-01-01T00:00:00Z");
    setSystemTime(originalNow);
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n);
      indexer.applyEvent(planet);
      const readyAt = BigInt(Math.floor(originalNow.getTime() / 1_000) + 10);
      indexer.applyLog({
        blockNumber: "0x81",
        transactionHash: "0xqueued-building",
        logIndex: "0x0",
        topics: [buildingStartedTopic, topic(7n), topic(11n)],
        data: abiWords(1n, readyAt, 0n, 0n, 0n)
      });

      const before = indexer.highscoreLeaderboard();
      expect(indexer.highscoreLeaderboard()).toBe(before);
      expect(before.entries[0]?.score.economy).toBe("0");

      setSystemTime(new Date(Number(readyAt + 1n) * 1_000));

      const after = indexer.highscoreLeaderboard();
      expect(after).toBe(before);
      expect(after.entries[0]?.score).toEqual(indexer.highscoreForWallet(player).score);
      expect(after.entries[0]?.score.economy).toBe("0");
    } finally {
      setSystemTime(new Date("2026-01-01T00:00:00Z"));
    }
  });

  test("memoizes attack launch timestamps for highscore protection scans until indexed state changes", () => {
    const attacker = "0x9999999999999999999999999999999999999999" as Address;
    const otherAttacker = "0x8888888888888888888888888888888888888888" as Address;
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { database });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x64",
      transactionHash: "0xattack-cache-1",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(50n), addressTopic(attacker), topic(3n)],
      data: abiWords(7n, 99n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x96",
      transactionHash: "0xother-attack",
      logIndex: "0x1",
      topics: [fleetMissionLaunchedTopic, topic(52n), addressTopic(otherAttacker), topic(3n)],
      data: abiWords(7n, 101n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0xaf",
      transactionHash: "0xattacker-transport",
      logIndex: "0x2",
      topics: [fleetMissionLaunchedTopic, topic(53n), addressTopic(attacker), topic(0n)],
      data: abiWords(7n, 102n, 1770001200n, 1770002400n, 0n)
    });

    const first = indexer.attackLaunchSecondsByTarget(attacker);
    const second = indexer.attackLaunchSecondsByTarget(attacker);

    expect(second).toBe(first);
    expect(first.get("99")).toEqual([100]);
    expect(first.has("101")).toBe(false);
    expect(first.has("102")).toBe(false);

    const queryPlan = database.query(`
      EXPLAIN QUERY PLAN
      SELECT event_json
      FROM indexed_mission_event_logs
      WHERE event_kind = 'fleet'
        AND lower(json_extract(event_json, '$.topics[0]')) = lower(?)
        AND lower(json_extract(event_json, '$.topics[2]')) = ?
        AND json_extract(event_json, '$.topics[3]') = ?
      ORDER BY CAST(block_number AS INTEGER) ASC
    `).all(
      fleetMissionLaunchedTopic,
      addressTopic(attacker).toLowerCase(),
      topic(3n)
    ) as Array<{ detail: string }>;
    expect(queryPlan.some((step) => step.detail.includes("indexed_mission_event_logs_attack_launch_attacker_idx"))).toBe(true);

    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0xc8",
      transactionHash: "0xattack-cache-2",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(51n), addressTopic(attacker), topic(3n)],
      data: abiWords(7n, 99n, 1770001300n, 1770002500n, 0n)
    });

    const third = indexer.attackLaunchSecondsByTarget(attacker);
    expect(third).not.toBe(first);
    expect(third.get("99")).toEqual([100, 200]);
  });
  test("batches player profile hydration without per-wallet lookups", () => {
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { database });
    const wallets = Array.from({ length: 40 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as Address);
    const insert = database.query("INSERT INTO player_profiles (wallet, display_name, description, updated_at) VALUES (?, ?, NULL, ?)");
    wallets.forEach((wallet, index) => insert.run(wallet, `Commander ${index}`, "2026-07-20T00:00:00.000Z"));
    indexer.playerProfile = (() => {
      throw new Error("batched profile hydration must not call playerProfile");
    }) as SettlementIndexer["playerProfile"];

    const profiles = indexer.playerProfiles(wallets);

    expect(profiles.size).toBe(wallets.length);
    expect(profiles.get(wallets[17]!)?.displayName).toBe("Commander 17");
    database.close();
  });

  test("paginates a production-sized completed mission archive before hydrating rows", async () => {
    const database = new Database(":memory:");
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n, { database });
    await indexer.rebuild();
    const insert = database.query(`
      INSERT INTO contract_fleet_missions (
        mission_id, status_id, mission_type_id, owner, origin_planet_id, target_planet_id,
        departure_at, arrival_at, return_at, fuel_cost,
        metal_cargo, crystal_cargo, deuterium_cargo, ships_json, randomness_request_id, event_json
      ) VALUES (?, 3, 0, ?, ?, ?, ?, ?, ?, '0', '0', '0', '0', '{}', NULL, NULL)
    `);
    database.transaction(() => {
      for (let missionId = 1; missionId <= 10_000; missionId += 1) {
        const timestamp = String(1_770_000_000 + missionId);
        insert.run(String(missionId), player, planet.planetId, planet.planetId, timestamp, timestamp, timestamp);
      }
    })();

    const startedAt = performance.now();
    const archive = indexer.fleetMissionArchivePage(player, { page: 1, pageSize: 25 });
    const durationMs = performance.now() - startedAt;

    expect(archive.totalEntries).toBe(10_000);
    expect(archive.completedMissions).toHaveLength(25);
    expect(archive.completedMissions[0]?.missionId).toBe("10000");
    expect(archive.completedMissions.at(-1)?.missionId).toBe("9976");
    expect(durationMs).toBeLessThan(300);
    const queryPlan = database.query(`
      EXPLAIN QUERY PLAN
      SELECT COUNT(*)
      FROM contract_fleet_missions
      WHERE status_id IN (3, 4) AND (owner = ? OR target_planet_id = ?)
    `).all(player, planet.planetId) as Array<{ detail: string }>;
    const queryPlanDetail = queryPlan.map((row) => row.detail).join(" ");
    expect(queryPlanDetail).toContain("USING INDEX contract_fleet_missions_");
    expect(queryPlanDetail).not.toContain("SCAN contract_fleet_missions");
    database.close();
  });
});

describe("attack needsResolution is gated on battle randomness (VEY-KANEO-479)", () => {
  const attacker = "0x00000000000000000000000000000000000a77ac" as Address;
  // An arrived (past-dated) Attack carrying its battle randomness request id in launched word 4.
  function applyArrivedAttack(indexer: SettlementIndexer, missionId: bigint, requestId: bigint): void {
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xattack",
      logIndex: "0x0",
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(attacker), topic(3n)],
      data: abiWords(99n, 7n, 1700000000n, 1800000300n, requestId)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xattack",
      logIndex: "0x1",
      topics: [fleetMissionCargoTopic, topic(missionId)],
      data: abiWords(0n, 0n, 0n, 1n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xattack",
      logIndex: "0x2",
      topics: [fleetMissionShipsTopic, topic(missionId)],
      data: abiWords(1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
  }

  function applyRandomnessFulfilled(indexer: SettlementIndexer, requestId: bigint): void {
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfulfill",
      logIndex: "0x0",
      topics: [randomnessFulfilledTopic, topic(requestId), addressTopic(attacker), topic(0n)],
      data: abiWords(1700000100n, 123n)
    });
  }

  function newIndexer(randomnessEngineConfigured: boolean): SettlementIndexer {
    return new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n, { randomnessEngineConfigured });
  }

  function activeAttack(indexer: SettlementIndexer, missionId: string) {
    return indexer.allActiveFleetMissions().find((mission) => mission.missionId === missionId);
  }

  test("leaves an arrived attack not-ready until its randomness is fulfilled", () => {
    const indexer = newIndexer(true);
    applyArrivedAttack(indexer, 70n, 42n);
    expect(activeAttack(indexer, "70")?.needsResolution).toBe(false);

    applyRandomnessFulfilled(indexer, 42n);
    expect(activeAttack(indexer, "70")?.needsResolution).toBe(true);
  });

  test("a different request's fulfillment does not unlock the attack", () => {
    const indexer = newIndexer(true);
    applyArrivedAttack(indexer, 71n, 42n);
    applyRandomnessFulfilled(indexer, 99n);
    expect(activeAttack(indexer, "71")?.needsResolution).toBe(false);
  });

  test("without a randomness engine, an arrived attack is ready on arrival (no gating)", () => {
    const indexer = newIndexer(false);
    applyArrivedAttack(indexer, 72n, 42n);
    expect(activeAttack(indexer, "72")?.needsResolution).toBe(true);
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function signedWord(value: bigint): bigint {
  return value >= 0n ? value : (1n << 256n) + value;
}

function abiString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const data = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${[
    (32n).toString(16).padStart(64, "0"),
    BigInt(bytes.length).toString(16).padStart(64, "0"),
    data.padEnd(Math.ceil(data.length / 64) * 64, "0")
  ].join("")}`;
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
