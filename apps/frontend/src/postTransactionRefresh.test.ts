import { describe, expect, test } from "bun:test";
import {
  isTransientGameStateReadFailure,
  isFinishedBuildingStateVisible,
  isFinishedResearchStateVisible,
  isAllianceApplicationCleared,
  isAllianceProfileUpdated,
  isAllianceCreated,
  isStartedBuildingStateVisible,
  isStartedDefenseProductionVisible,
  isStartedShipProductionVisible,
  isStartedResearchStateVisible,
  isMissionLaunchStateVisible,
  isFleetVisibilityIndexedThrough,
  missionLaunchMissionsForTransaction,
  expectedMissionLaunch,
  waitForFinishedResearchState,
  waitForStartedBuildingState,
  waitForStartedResearchState,
  waitForStartedDefenseProductionState,
  waitForStartedShipProductionState,
  waitForHydratedWalletPlanet,
  waitForFinishedBuildingState,
  waitForAllianceApplicationCleared,
  waitForAllianceProfileState,
  waitForAllianceCreationState,
  waitForMissionLaunchState,
  waitForFleetVisibilityIndexedThrough,
  waitForIndexedResourceState,
  waitForRenamedWalletPlanet,
  type FinishedResearchSnapshot,
  type MissionLaunchSnapshot,
  type StartedBuildingSnapshot,
  type StartedDefenseProductionSnapshot,
  type StartedShipProductionSnapshot,
  type StartedResearchSnapshot,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingSnapshot,
} from "./postTransactionRefresh";
import type { ChainAllianceState, FleetMissionSummary, WalletPlanetsResponse } from "./walletFlow";

const wallet = "0x2222222222222222222222222222222222222222";

describe("post-transaction refresh reconciliation", () => {
  test("waits for the exact indexed resource transaction before promoting state", async () => {
    const snapshots = [
      { resourceSnapshot: { planetId: "7", transactionHash: "0xold", blockNumber: "10", lastSettledAt: "100", resources: { metal: "10", crystal: "20", deuterium: "30" } } },
      { resourceSnapshot: { planetId: "7", transactionHash: "0xcredit", blockNumber: "11", lastSettledAt: "101", resources: { metal: "110", crystal: "220", deuterium: "330" } } },
    ];

    const result = await waitForIndexedResourceState(
      async () => snapshots.shift() ?? snapshots[0]!,
      { transactionHash: "0xcredit", receiptBlockNumber: "11" },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    );

    expect(result.resourceSnapshot?.transactionHash).toBe("0xcredit");
  });

  test("polls until a launched mission appears in mission state by transaction hash", async () => {
    const txHash = "0xlaunch";
    const launched = mission("51", { transactionHash: txHash });
    const snapshots = [
      missionLaunchSnapshot(),
      missionLaunchSnapshot({ outgoing: [launched], allActiveMissions: [launched] }),
    ];
    const loads: MissionLaunchSnapshot[] = [];

    const result = await waitForMissionLaunchState(
      async () => {
        const snapshot = snapshots.shift() ?? missionLaunchSnapshot({ outgoing: [launched], allActiveMissions: [launched] });
        loads.push(snapshot);
        return snapshot;
      },
      txHash,
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(missionLaunchMissionsForTransaction(result, txHash).map((entry) => entry.missionId)).toEqual(["51"]);
  });

  test("accepts a launch visible in the wallet list while the global active feed is still stale", () => {
    const txHash = "0xlaunch";
    const launched = mission("52", { transactionHash: txHash });
    const snapshot = missionLaunchSnapshot({ outgoing: [launched], allActiveMissions: [] });

    expect(isMissionLaunchStateVisible(snapshot, txHash.toUpperCase())).toBe(true);
    expect(missionLaunchMissionsForTransaction(snapshot, txHash)).toEqual([launched]);
  });

  test("accepts a visible launched mission with placeholder transaction metadata when launch details match", async () => {
    const txHash = "0xlaunch";
    const expected = expectedMissionLaunch({
      txHash,
      owner: wallet,
      originPlanetId: "7",
      targetPlanetId: "9",
      missionType: "Transport",
      ships: { smallCargo: 2 },
      cargo: { metal: 6000, crystal: 1000, deuterium: 0 },
      submittedAtMs: 1_770_000_000_000,
      travelSeconds: 300,
    });
    const visible = mission("1473", {
      transactionHash: "0x",
      blockNumber: "0",
      missionType: "Transport",
      ships: { smallCargo: "2" },
      cargo: { metal: "6000", crystal: "1000", deuterium: "0" },
      arrivalAt: "1770000305",
      returnAt: "1770000605",
    });
    const snapshot = missionLaunchSnapshot({ outgoing: [visible], allActiveMissions: [visible] });

    expect(isMissionLaunchStateVisible(snapshot, txHash, expected)).toBe(true);
    expect(missionLaunchMissionsForTransaction(snapshot, txHash, expected).map((entry) => entry.missionId)).toEqual(["1473"]);

    const result = await waitForMissionLaunchState(
      async () => snapshot,
      txHash,
      { attempts: 1, intervalMs: 1, delay: async () => undefined, expectedMission: expected },
    );
    expect(result.fleetVisibility.outgoing.map((entry) => entry.missionId)).toEqual(["1473"]);
  });

  test("does not clear a mission launch sync error for a different placeholder-hash mission", async () => {
    const txHash = "0xlaunch";
    const expected = expectedMissionLaunch({
      txHash,
      owner: wallet,
      originPlanetId: "7",
      targetPlanetId: "9",
      missionType: "Transport",
      ships: { smallCargo: 2 },
      cargo: { metal: 6000, crystal: 1000, deuterium: 0 },
      submittedAtMs: 1_770_000_000_000,
      travelSeconds: 300,
    });
    const differentMission = mission("1474", {
      transactionHash: "0x",
      missionType: "Transport",
      ships: { smallCargo: "1" },
      cargo: { metal: "6000", crystal: "1000", deuterium: "0" },
      arrivalAt: "1770000305",
      returnAt: "1770000605",
    });
    const snapshot = missionLaunchSnapshot({ outgoing: [differentMission], allActiveMissions: [differentMission] });

    expect(isMissionLaunchStateVisible(snapshot, txHash, expected)).toBe(false);
    await expect(waitForMissionLaunchState(
      async () => snapshot,
      txHash,
      { attempts: 1, intervalMs: 1, delay: async () => undefined, expectedMission: expected },
    )).rejects.toThrow("launched mission is still syncing");
  });

  test("does not match a placeholder-hash planet mission for an otherwise identical moon launch", () => {
    const txHash = "0xmoonlaunch";
    const expected = expectedMissionLaunch({
      txHash,
      owner: wallet,
      originPlanetId: "7",
      targetPlanetId: "9",
      originIsMoon: true,
      targetIsMoon: true,
      missionType: "Attack",
      ships: { smallCargo: 2 },
      submittedAtMs: 1_770_000_000_000,
      travelSeconds: 300,
    });
    const wrongBodies = mission("1475", {
      transactionHash: "0x",
      blockNumber: "0",
      missionType: "Attack",
      originIsMoon: false,
      targetIsMoon: false,
      ships: { smallCargo: "2" },
      arrivalAt: "1770000305",
      returnAt: "1770000605",
    });
    const correctBodies = mission("1476", {
      ...wrongBodies,
      missionId: "1476",
      originIsMoon: true,
      targetIsMoon: true,
    });

    expect(isMissionLaunchStateVisible(
      missionLaunchSnapshot({ outgoing: [wrongBodies], allActiveMissions: [wrongBodies] }),
      txHash,
      expected,
    )).toBe(false);
    expect(missionLaunchMissionsForTransaction(
      missionLaunchSnapshot({ outgoing: [correctBodies], allActiveMissions: [correctBodies] }),
      txHash,
      expected,
    ).map((entry) => entry.missionId)).toEqual(["1476"]);
  });

  test("waits for Mission Control to reach the transaction receipt block", async () => {
    const stale = { ...emptyFleetVisibility(), indexedBlock: "100", indexedRevision: "1:0" };
    const current = { ...emptyFleetVisibility(), indexedBlock: "101", indexedRevision: "1:1" };
    const snapshots = [stale, current];

    expect(isFleetVisibilityIndexedThrough(stale, 101n)).toBe(false);
    const result = await waitForFleetVisibilityIndexedThrough(
      async () => snapshots.shift() ?? current,
      101n,
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    );
    expect(result).toBe(current);
  });

  test("does not accept a stale finished-building snapshot with an active queue", () => {
    expect(isFinishedBuildingStateVisible(staleSolarPlantSnapshot(), {
      itemId: 3,
      targetLevel: 2,
    })).toBe(false);
  });

  test("accepts the finished snapshot once queue clears and the target level is visible", () => {
    expect(isFinishedBuildingStateVisible(finishedSolarPlantSnapshot(), {
      itemId: 3,
      targetLevel: 2,
    })).toBe(true);
  });

  test("polls past a stale first response after finishing Solar Plant", async () => {
    const snapshots = [
      staleSolarPlantSnapshot(),
      finishedSolarPlantSnapshot(),
    ];
    const loads: FinishedBuildingSnapshot[] = [];

    const result = await waitForFinishedBuildingState(
      async () => {
        const snapshot = snapshots.shift() ?? finishedSolarPlantSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.infrastructure.queue).toBeNull();
    expect(result.queues.building).toBeNull();
    expect(result.infrastructure.buildings.find((building) => building.id === 3)?.level).toBe(2);
    expect(result.infrastructure.productionPerHour).toEqual({
      metal: "60",
      crystal: "30",
      deuterium: "0",
    });
  });

  test("polls past stale alliance applications after dismiss confirmation", async () => {
    const snapshots = [
      allianceStateWithApplication(),
      allianceStateWithApplication({ allianceJoinRequests: [] }),
    ];
    const loads: ChainAllianceState[] = [];

    const result = await waitForAllianceApplicationCleared(
      async () => {
        const snapshot = snapshots.shift() ?? allianceStateWithApplication({ allianceJoinRequests: [] });
        loads.push(snapshot);
        return snapshot;
      },
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
      },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(isAllianceApplicationCleared(result, {
      allianceId: "7",
      requester: "0x3333333333333333333333333333333333333333",
    })).toBe(true);
  });

  test("explains alliance application sync timeout after confirmation", async () => {
    await expect(waitForAllianceApplicationCleared(
      async () => allianceStateWithApplication(),
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
      },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("Alliance application transaction confirmed, but the pending application is still syncing in the game API.");
  });

  test("polls past stale alliance profile state after profile update confirmation", async () => {
    const updatedProfile = {
      allianceId: "7",
      tag: "VDFT",
      name: "Veydrift Union",
      description: "Updated public charter",
    };
    const snapshots = [
      allianceStateWithApplication(),
      allianceStateWithProfile(updatedProfile),
    ];
    const loads: ChainAllianceState[] = [];

    const result = await waitForAllianceProfileState(
      async () => {
        const snapshot = snapshots.shift() ?? allianceStateWithProfile(updatedProfile);
        loads.push(snapshot);
        return snapshot;
      },
      updatedProfile,
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(isAllianceProfileUpdated(result, updatedProfile)).toBe(true);
  });

  test("waits for creation to expose the exact indexed public description", async () => {
    const expected = {
      tag: "VDFT",
      name: "Veydrift Union",
      description: "Public charter",
    };
    const snapshots = [
      allianceStateWithApplication(),
      allianceStateWithProfile({ allianceId: "7", ...expected }),
    ];

    const result = await waitForAllianceCreationState(
      async () => snapshots.shift() ?? allianceStateWithProfile({ allianceId: "7", ...expected }),
      expected,
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(isAllianceCreated(result, expected)).toBe(true);
    expect(result.profile?.description).toBe("Public charter");
  });

  test("explains alliance profile sync timeout when the description remains stale", async () => {
    await expect(waitForAllianceProfileState(
      async () => allianceStateWithApplication(),
      {
        allianceId: "7",
        tag: "VDFT",
        name: "Veydrift Union",
        description: "Updated public charter",
      },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("Alliance profile transaction confirmed, but the updated description is still syncing in the game API.");
  });

  test("recovers from a transient post-finish game-state read failure", async () => {
    let attempts = 0;

    const result = await waitForFinishedBuildingState(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Failed to fetch");
        }
        return finishedSolarPlantSnapshot();
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(attempts).toBe(2);
    expect(result.infrastructure.queue).toBeNull();
    expect(result.infrastructure.buildings.find((building) => building.id === 3)?.level).toBe(2);
  });

  test("reports transient backend recovery instead of wallet/network blame when post-finish reads stay down", async () => {
    await expect(waitForFinishedBuildingState(
      async () => {
        throw new Error("Infrastructure API is temporarily unavailable (503: RPC HTTP 503).");
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("Servers are unavailable. Retrying in 10 seconds.");
  });

  test("does not report success when every post-finish snapshot is still stale", async () => {
    await expect(waitForFinishedBuildingState(
      async () => staleSolarPlantSnapshot(),
      { itemId: 3, targetLevel: 2 },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("completed building queue is still syncing");
  });

  test("polls until started defense production is visible on Defense or Overview state", async () => {
    expect(isStartedDefenseProductionVisible(staleDefenseProductionSnapshot(), {
      itemId: 0,
      planetId: "7",
      quantity: 2,
    })).toBe(false);

    const snapshots = [
      staleDefenseProductionSnapshot(),
      startedDefenseProductionSnapshot(),
    ];
    const loads: StartedDefenseProductionSnapshot[] = [];

    const result = await waitForStartedDefenseProductionState(
      async () => {
        const snapshot = snapshots.shift() ?? startedDefenseProductionSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 0, planetId: "7", quantity: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.defense.queue?.itemId).toBe(0);
    expect(result.defense.queue?.quantity).toBe(2);
    expect(result.queues.defense?.itemId).toBe(0);
    expect(result.queues.defense?.quantity).toBe(2);
  });

  test("accepts started defense production while the Overview queue endpoint catches up", () => {
    const snapshot = startedDefenseProductionSnapshot();

    expect(isStartedDefenseProductionVisible({
      ...snapshot,
      queues: {
        ...snapshot.queues,
        defense: null,
      },
    }, {
      itemId: 0,
      planetId: "7",
      quantity: 2,
    })).toBe(true);
  });

  test("accepts started defense production while the Defense page endpoint catches up", () => {
    const snapshot = startedDefenseProductionSnapshot();

    expect(isStartedDefenseProductionVisible({
      ...snapshot,
      defense: {
        ...snapshot.defense,
        queue: null,
      },
    }, {
      itemId: 0,
      planetId: "7",
      quantity: 2,
    })).toBe(true);
  });

  test("keeps defense production indexing while the queue is visible but resources are stale", () => {
    const baseline = resourceSnapshot("7", "0xold", "0x10", { metal: "10000", crystal: "10000", deuterium: "10000" });
    const stale = startedDefenseProductionSnapshot(baseline);

    expect(isStartedDefenseProductionVisible(stale, {
      itemId: 0,
      planetId: "7",
      quantity: 2,
      resourceIndexing: {
        baseline,
        receiptBlockNumber: "0x20",
        transactionHash: "0xdefense",
      },
    })).toBe(false);

    expect(isStartedDefenseProductionVisible(startedDefenseProductionSnapshot(
      resourceSnapshot("7", "0xdefense", "0x20", { metal: "9000", crystal: "9500", deuterium: "10000" }),
    ), {
      itemId: 0,
      planetId: "7",
      quantity: 2,
      resourceIndexing: {
        baseline,
        receiptBlockNumber: "0x20",
        transactionHash: "0xdefense",
      },
    })).toBe(true);
  });

  test("accepts started defense production when the expected item is in the backlog", () => {
    expect(isStartedDefenseProductionVisible(startedDefenseBacklogProductionSnapshot(), {
      itemId: 1,
      planetId: "7",
      quantity: 1,
    })).toBe(true);
  });

  test("polls until started ship production is visible on Shipyard or Overview state", async () => {
    expect(isStartedShipProductionVisible(staleShipProductionSnapshot(), {
      itemId: 0,
      planetId: "7",
      quantity: 3,
    })).toBe(false);

    const snapshots = [
      staleShipProductionSnapshot(),
      startedShipProductionSnapshot(),
    ];
    const loads: StartedShipProductionSnapshot[] = [];

    const result = await waitForStartedShipProductionState(
      async () => {
        const snapshot = snapshots.shift() ?? startedShipProductionSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 0, planetId: "7", quantity: 3 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.shipyard.queue?.itemId).toBe(0);
    expect(result.shipyard.queue?.quantity).toBe(3);
    expect(result.queues.ship?.itemId).toBe(0);
    expect(result.queues.ship?.quantity).toBe(3);
  });

  test("accepts started ship production while the Overview queue endpoint catches up", () => {
    const snapshot = startedShipProductionSnapshot();

    expect(isStartedShipProductionVisible({
      ...snapshot,
      queues: {
        ...snapshot.queues,
        ship: null,
      },
    }, {
      itemId: 0,
      planetId: "7",
      quantity: 3,
    })).toBe(true);
  });

  test("accepts started ship production while the Shipyard page endpoint catches up", () => {
    const snapshot = startedShipProductionSnapshot();

    expect(isStartedShipProductionVisible({
      ...snapshot,
      shipyard: {
        ...snapshot.shipyard,
        queue: null,
      },
    }, {
      itemId: 0,
      planetId: "7",
      quantity: 3,
    })).toBe(true);
  });

  test("accepts started ship production when the expected item is in the backlog", () => {
    expect(isStartedShipProductionVisible(startedShipBacklogProductionSnapshot(), {
      itemId: 1,
      planetId: "7",
      quantity: 2,
    })).toBe(true);
  });

  test("keeps ship production indexing while the queue is visible but resources are stale", () => {
    const baseline = resourceSnapshot("7", "0xold", "0x10", { metal: "10000", crystal: "10000", deuterium: "10000" });

    expect(isStartedShipProductionVisible(startedShipProductionSnapshot(baseline), {
      itemId: 0,
      planetId: "7",
      quantity: 3,
      resourceIndexing: {
        baseline,
        receiptBlockNumber: "0x20",
        transactionHash: "0xship",
      },
    })).toBe(false);

    expect(isStartedShipProductionVisible(startedShipProductionSnapshot(
      resourceSnapshot("7", "0xship", "0x20", { metal: "4000", crystal: "4000", deuterium: "10000" }),
    ), {
      itemId: 0,
      planetId: "7",
      quantity: 3,
      resourceIndexing: {
        baseline,
        receiptBlockNumber: "0x20",
        transactionHash: "0xship",
      },
    })).toBe(true);
  });

  test("does not accept a stale building snapshot without the started upgrade", () => {
    expect(isStartedBuildingStateVisible(staleStartedBuildingSnapshot(), {
      itemId: 3,
      planetId: "7",
      targetLevel: 2,
    })).toBe(false);
  });

  test("accepts the started building snapshot once the queue reflects the upgrade", () => {
    expect(isStartedBuildingStateVisible(startedBuildingSnapshot(), {
      itemId: 3,
      planetId: "7",
      targetLevel: 2,
    })).toBe(true);
  });

  test("accepts started building while the Infrastructure page endpoint catches up", () => {
    const snapshot = startedBuildingSnapshot();

    expect(isStartedBuildingStateVisible({
      ...snapshot,
      infrastructure: {
        ...snapshot.infrastructure,
        queue: null,
      },
    }, {
      itemId: 3,
      planetId: "7",
      targetLevel: 2,
    })).toBe(true);
  });

  test("accepts started building from wallet planets while infrastructure and queue endpoints catch up", () => {
    const walletPlanetsOnly = {
      ...startedBuildingSnapshot(),
      infrastructure: {
        ...startedBuildingSnapshot().infrastructure,
        queue: null,
      },
      planetsResponse: startedBuildingWalletPlanetsResponse(),
      queues: {
        ...startedBuildingSnapshot().queues,
        building: null,
      },
    };

    expect(isStartedBuildingStateVisible(walletPlanetsOnly, {
      itemId: 3,
      planetId: "7",
      targetLevel: 2,
    })).toBe(true);
  });

  test("does not accept another planet's building queue from wallet planets", () => {
    expect(isStartedBuildingStateVisible({
      ...staleStartedBuildingSnapshot(),
      planetsResponse: startedBuildingWalletPlanetsResponse("8"),
    }, {
      itemId: 3,
      planetId: "7",
      targetLevel: 2,
    })).toBe(false);
  });

  test("polls past a stale response until wallet planets expose the started building queue", async () => {
    const walletPlanetsOnly = {
      ...startedBuildingSnapshot(),
      infrastructure: {
        ...startedBuildingSnapshot().infrastructure,
        queue: null,
      },
      planetsResponse: startedBuildingWalletPlanetsResponse(),
      queues: {
        ...startedBuildingSnapshot().queues,
        building: null,
      },
    };
    const snapshots = [
      staleStartedBuildingSnapshot(),
      walletPlanetsOnly,
    ];
    const loads: StartedBuildingSnapshot[] = [];

    const result = await waitForStartedBuildingState(
      async () => {
        const snapshot = snapshots.shift() ?? startedBuildingSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 3, planetId: "7", targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.planetsResponse?.planets[0]?.queues.building?.itemId).toBe(3);
    expect(result.planetsResponse?.planets[0]?.queues.building?.targetLevel).toBe(2);
  });

  test("polls past a stale first response after starting a building upgrade", async () => {
    const snapshots = [
      staleStartedBuildingSnapshot(),
      startedBuildingSnapshot(),
    ];
    const loads: StartedBuildingSnapshot[] = [];

    const result = await waitForStartedBuildingState(
      async () => {
        const snapshot = snapshots.shift() ?? startedBuildingSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 3, planetId: "7", targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.infrastructure.queue?.itemId).toBe(3);
    expect(result.infrastructure.queue?.targetLevel).toBe(2);
    expect(result.queues.building?.itemId).toBe(3);
    expect(result.queues.building?.targetLevel).toBe(2);
  });

  test("times out with a syncing message when the started building queue never appears", async () => {
    await expect(
      waitForStartedBuildingState(
        async () => staleStartedBuildingSnapshot(),
        { itemId: 3, planetId: "7", targetLevel: 2 },
        { attempts: 2, intervalMs: 1, delay: async () => undefined },
      ),
    ).rejects.toThrow(/indexed building queue state is still syncing/);
  });

  test("polls past a transient backend reload after starting a building upgrade", async () => {
    const responses: Array<() => StartedBuildingSnapshot> = [
      () => { throw new Error("api failed: 503"); },
      () => startedBuildingSnapshot(),
    ];
    const attempts: string[] = [];

    const result = await waitForStartedBuildingState(
      async () => {
        const next = responses.shift();
        if (!next) return startedBuildingSnapshot();
        try {
          const snapshot = next();
          attempts.push("ok");
          return snapshot;
        } catch (error) {
          attempts.push("throw");
          throw error;
        }
      },
      { itemId: 3, planetId: "7", targetLevel: 2 },
      { attempts: 4, intervalMs: 1, delay: async () => undefined },
    );

    expect(attempts).toEqual(["throw", "ok"]);
    expect(result.infrastructure.queue?.itemId).toBe(3);
  });

  test("reports a retryable syncing status when the backend stays in reload", async () => {
    await expect(
      waitForStartedBuildingState(
        async () => { throw new Error("api failed: 502"); },
        { itemId: 3, planetId: "7", targetLevel: 2 },
        { attempts: 2, intervalMs: 1, delay: async () => undefined },
      ),
    ).rejects.toThrow("Servers are unavailable. Retrying in 10 seconds.");
  });

  test("polls until started research is visible on Research and Overview state", async () => {
    expect(isStartedResearchStateVisible(staleStartedResearchSnapshot(), {
      itemId: 4,
      targetLevel: 2,
    })).toBe(false);

    const snapshots = [
      staleStartedResearchSnapshot(),
      startedResearchSnapshot(),
    ];
    const loads: StartedResearchSnapshot[] = [];

    const result = await waitForStartedResearchState(
      async () => {
        const snapshot = snapshots.shift() ?? startedResearchSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 4, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.research.queue?.itemId).toBe(4);
    expect(result.research.queue?.targetLevel).toBe(2);
    expect(result.queues.research?.itemId).toBe(4);
    expect(result.queues.research?.targetLevel).toBe(2);
  });

  test("polls until finished research is visible on Research and Overview state", async () => {
    expect(isFinishedResearchStateVisible(staleFinishedResearchSnapshot(), {
      itemId: 4,
      targetLevel: 2,
    })).toBe(false);

    const snapshots = [
      staleFinishedResearchSnapshot(),
      finishedResearchSnapshot(),
    ];
    const loads: FinishedResearchSnapshot[] = [];

    const result = await waitForFinishedResearchState(
      async () => {
        const snapshot = snapshots.shift() ?? finishedResearchSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 4, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.research.queue).toBeNull();
    expect(result.queues.research).toBeNull();
    expect(result.research.technologyLevels["4"]).toBe(2);
  });

  test("polls until a confirmed settlement has hydrated planet resources", async () => {
    const snapshots = [
      unhydratedWalletPlanetSnapshot(),
      hydratedWalletPlanetSyncSnapshot(),
    ];
    const loads: WalletPlanetSyncSnapshot[] = [];

    const result = await waitForHydratedWalletPlanet(
      async () => {
        const snapshot = snapshots.shift() ?? hydratedWalletPlanetSyncSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      undefined,
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.selectedPlanet.planetId).toBe("7");
    expect(result.selectedPlanet.resources.metal).toBe("5000");
  });

  test("recovers when the first post-settlement API fetch fails", async () => {
    let attempts = 0;

    const result = await waitForHydratedWalletPlanet(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Failed to fetch");
        }
        return hydratedWalletPlanetSyncSnapshot();
      },
      "7",
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(attempts).toBe(2);
    expect(result.selectedPlanet.planetId).toBe("7");
  });

  test("classifies browser/backend transport failures as transient game-state read failures", () => {
    expect(isTransientGameStateReadFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientGameStateReadFailure(new Error("Infrastructure API failed: 503"))).toBe(true);
    expect(isTransientGameStateReadFailure(new Error("Internal JSON-RPC error."))).toBe(false);
  });

  test("polls past hydrated but stale planet names after rename confirmation", async () => {
    const snapshots = [
      hydratedWalletPlanetSyncSnapshot(),
      renamedWalletPlanetSyncSnapshot("New Eos"),
    ];
    const loads: WalletPlanetSyncSnapshot[] = [];

    const result = await waitForRenamedWalletPlanet(
      async () => {
        const snapshot = snapshots.shift() ?? renamedWalletPlanetSyncSnapshot("New Eos");
        loads.push(snapshot);
        return snapshot;
      },
      { planetId: "7", name: "New Eos" },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.selectedPlanet.name).toBe("New Eos");
  });

  test("reports a retryable status when a confirmed rename stays stale", async () => {
    await expect(waitForRenamedWalletPlanet(
      async () => hydratedWalletPlanetSyncSnapshot(),
      { planetId: "7", name: "New Eos" },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("did not show \"New Eos\"");
  });

  test("reports a specific retryable status when hydration times out", async () => {
    await expect(waitForHydratedWalletPlanet(
      async () => unhydratedWalletPlanetSnapshot(),
      "7",
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("game API did not hydrate a complete planet");
  });
});

function staleStartedBuildingSnapshot(): StartedBuildingSnapshot {
  return {
    infrastructure: {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
      productionPerHour: { metal: "30", crystal: "15", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 1, cost: { metal: "150", crystal: "60", deuterium: "0" } },
      ],
      queue: null,
    },
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
  };
}

function startedBuildingSnapshot(): StartedBuildingSnapshot {
  return {
    infrastructure: {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "4850", crystal: "4840", deuterium: "4800" },
      productionPerHour: { metal: "30", crystal: "15", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 1, cost: { metal: "150", crystal: "60", deuterium: "0" } },
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
    },
    queues: {
      wallet,
      homePlanetId: "7",
      building: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
      defense: null,
      ship: null,
      research: null,
    },
  };
}

function startedBuildingWalletPlanetsResponse(planetId = "7"): WalletPlanetsResponse {
  const snapshot = startedBuildingSnapshot();
  return {
    wallet,
    homePlanetId: "7",
    planets: [
      {
        ...snapshot.infrastructure,
        coordinates: "6:9:1",
        fields: 163,
        fieldsCapacity: 163,
        fieldsUsed: 12,
        galaxy: 6,
        isHomePlanet: planetId === "7",
        keyLevels: {
          metalMine: 1,
          crystalMine: 0,
          deuteriumSynthesizer: 0,
          solarPlant: 0,
          roboticsFactory: 1,
          shipyard: 0,
          researchLab: 0,
          terraformer: 0,
        },
        lastSettledAt: "1770000000",
        metalMultiplierBps: 10000,
        crystalMultiplierBps: 10000,
        deuteriumMultiplierBps: 10000,
        moon: null,
        name: "New Zion",
        owner: wallet,
        planetId,
        position: 1,
        queues: {
          building: snapshot.infrastructure.queue,
          defense: null,
          ship: null,
        },
        resources: snapshot.infrastructure.resources ?? { metal: "0", crystal: "0", deuterium: "0" },
        resourcesAsOfNow: snapshot.infrastructure.resourcesAsOfNow
          ?? snapshot.infrastructure.resources
          ?? { metal: "0", crystal: "0", deuterium: "0" },
        system: 9,
        tactical: {
          raidableResources: { metal: "0", crystal: "0", deuterium: "0" },
          raidableResourceTotal: "0",
          ships: { count: 0, power: "0" },
          defenses: { count: 0, power: "0" },
          combatPower: "0",
        },
        temperature: 42,
      },
    ],
  };
}

function staleSolarPlantSnapshot(): FinishedBuildingSnapshot {
  return {
    settlement: settlementSnapshot(),
    queues: {
      wallet,
      homePlanetId: "7",
      building: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
      defense: null,
      ship: null,
      research: null,
    },
    infrastructure: {
      wallet,
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
      productionPerHour: { metal: "30", crystal: "15", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 1, cost: { metal: "150", crystal: "60", deuterium: "0" } },
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
    },
  };
}

function staleDefenseProductionSnapshot(): StartedDefenseProductionSnapshot {
  return {
    defense: {
      wallet,
      homePlanetId: "7",
      productionAvailable: true,
      resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
      shipyardLevel: 1,
      naniteLevel: 0,
      missileSiloLevel: 0,
      technologyLevels: {},
      defenses: [
        { id: 0, count: 0, cost: { metal: "2000", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    },
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
  };
}

function startedDefenseProductionSnapshot(resourceSnapshotMetadata = resourceSnapshot("7", "0xdefense", "0x20", { metal: "1000", crystal: "5000", deuterium: "5000" })): StartedDefenseProductionSnapshot {
  const defenseQueue = {
    active: true,
    kind: "defense" as const,
    itemId: 0,
    quantity: 2,
    readyAt: "1770000060",
    cost: { metal: "4000", crystal: "0", deuterium: "0" },
  };

  return {
    defense: {
      ...staleDefenseProductionSnapshot().defense,
      resourceSnapshot: resourceSnapshotMetadata,
      queue: defenseQueue,
    },
    queues: {
      ...staleDefenseProductionSnapshot().queues,
      defense: defenseQueue,
    },
  };
}

function startedDefenseBacklogProductionSnapshot(): StartedDefenseProductionSnapshot {
  const activeDefenseQueue = {
    active: true,
    kind: "defense" as const,
    itemId: 0,
    quantity: 2,
    readyAt: "1770000060",
    cost: { metal: "4000", crystal: "0", deuterium: "0" },
    backlog: [
      {
        active: true,
        kind: "defense" as const,
        itemId: 1,
        quantity: 1,
        readyAt: "1770000120",
        cost: { metal: "1500", crystal: "500", deuterium: "0" },
      },
    ],
  };

  return {
    defense: {
      ...staleDefenseProductionSnapshot().defense,
      queue: activeDefenseQueue,
    },
    queues: {
      ...staleDefenseProductionSnapshot().queues,
      defense: activeDefenseQueue,
    },
  };
}

function staleShipProductionSnapshot(): StartedShipProductionSnapshot {
  return {
    shipyard: {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      productionAvailable: true,
      resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" } },
      ],
      queue: null,
    },
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
  };
}

function startedShipProductionSnapshot(resourceSnapshotMetadata = resourceSnapshot("7", "0xship", "0x20", { metal: "1000", crystal: "1000", deuterium: "5000" })): StartedShipProductionSnapshot {
  const shipQueue = {
    active: true,
    kind: "ship" as const,
    itemId: 0,
    quantity: 3,
    readyAt: "1770000060",
    cost: { metal: "6000", crystal: "6000", deuterium: "0" },
  };

  return {
    shipyard: {
      ...staleShipProductionSnapshot().shipyard,
      resourceSnapshot: resourceSnapshotMetadata,
      queue: shipQueue,
    },
    queues: {
      ...staleShipProductionSnapshot().queues,
      ship: shipQueue,
    },
  };
}

function startedShipBacklogProductionSnapshot(): StartedShipProductionSnapshot {
  const activeShipQueue = {
    active: true,
    kind: "ship" as const,
    itemId: 0,
    quantity: 3,
    readyAt: "1770000060",
    cost: { metal: "6000", crystal: "6000", deuterium: "0" },
    backlog: [
      {
        active: true,
        kind: "ship" as const,
        itemId: 1,
        quantity: 2,
        readyAt: "1770000120",
        cost: { metal: "6000", crystal: "2000", deuterium: "0" },
      },
    ],
  };

  return {
    shipyard: {
      ...staleShipProductionSnapshot().shipyard,
      queue: activeShipQueue,
    },
    queues: {
      ...staleShipProductionSnapshot().queues,
      ship: activeShipQueue,
    },
  };
}

function staleStartedResearchSnapshot(): StartedResearchSnapshot {
  return {
    research: baseResearchState(),
    queues: emptyQueues(),
  };
}

function startedResearchSnapshot(): StartedResearchSnapshot {
  const researchQueue = {
    active: true,
    kind: "research" as const,
    itemId: 4,
    targetLevel: 2,
    readyAt: "1770000060",
    startedAt: "1770000000",
    cost: { metal: "800", crystal: "400", deuterium: "200" },
  };

  return {
    research: {
      ...baseResearchState(),
      queue: researchQueue,
    },
    queues: {
      ...emptyQueues(),
      research: researchQueue,
    },
  };
}

function staleFinishedResearchSnapshot(): FinishedResearchSnapshot {
  return startedResearchSnapshot();
}

function finishedResearchSnapshot(): FinishedResearchSnapshot {
  return {
    research: {
      ...baseResearchState(),
      technologyLevels: { "4": 2 },
      technologies: [
        { id: 4, level: 2, cost: { metal: "1600", crystal: "800", deuterium: "400" } },
      ],
      queue: null,
    },
    queues: emptyQueues(),
  };
}

function baseResearchState() {
  return {
    wallet,
    homePlanetId: "7",
    researchAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: { "4": 1 },
    technologies: [
      { id: 4, level: 1, cost: { metal: "800", crystal: "400", deuterium: "200" } },
    ],
    queue: null,
  };
}

function finishedSolarPlantSnapshot(): FinishedBuildingSnapshot {
  return {
    settlement: settlementSnapshot(),
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
    infrastructure: {
      wallet,
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
      productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 2, cost: { metal: "300", crystal: "120", deuterium: "0" } },
      ],
      queue: null,
    },
  };
}

function settlementSnapshot() {
  return {
    wallet,
    hasFirstPlanet: true,
    homePlanetId: "7",
    planet: {
      planetId: "7",
      owner: wallet,
      name: null,
      galaxy: 2,
      system: 44,
      position: 9,
      fields: 211,
      temperature: -8,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      lastSettledAt: "1770000000",
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
    },
  };
}

function unhydratedWalletPlanetSnapshot(): WalletPlanetSyncSnapshot {
  return {
    settlement: {
      ...settlementSnapshot(),
      planet: null,
    },
    planetsResponse: {
      wallet,
      homePlanetId: "7",
      planets: [],
    },
    queues: emptyQueues(),
    fleetVisibility: emptyFleetVisibility(),
  };
}

function hydratedWalletPlanetSyncSnapshot(): WalletPlanetSyncSnapshot {
  const settlement = settlementSnapshot();
  const planet = settlement.planet;
  if (!planet) throw new Error("test settlement missing planet");

  return {
    settlement,
    planetsResponse: {
      wallet,
      homePlanetId: "7",
      planets: [
        {
          ...planet,
          coordinates: "2:44:9",
          fieldsUsed: 2,
          fieldsCapacity: 211,
          isHomePlanet: true,
          keyLevels: {
            metalMine: 1,
            crystalMine: 1,
            deuteriumSynthesizer: 0,
            solarPlant: 1,
            roboticsFactory: 0,
            shipyard: 0,
            researchLab: 0,
            terraformer: 0,
          },
          moon: null,
          queues: {
            building: null,
            defense: null,
            ship: null,
          },
        },
      ],
    },
    queues: emptyQueues(),
    fleetVisibility: emptyFleetVisibility(),
  };
}

function renamedWalletPlanetSyncSnapshot(name: string): WalletPlanetSyncSnapshot {
  const snapshot = hydratedWalletPlanetSyncSnapshot();
  const renamedPlanet = {
    ...snapshot.planetsResponse.planets[0]!,
    name,
  };
  return {
    ...snapshot,
    settlement: {
      ...snapshot.settlement,
      planet: {
        ...snapshot.settlement.planet!,
        name,
      },
    },
    planetsResponse: {
      ...snapshot.planetsResponse,
      planets: [renamedPlanet],
    },
  };
}

function allianceStateWithApplication(overrides: Partial<ChainAllianceState> = {}): ChainAllianceState {
  return {
    wallet,
    allianceAvailable: true,
    membership: {
      allianceId: "7",
      role: "officer",
      joinedAt: "1770000000",
    },
    profile: {
      active: true,
      createdAt: "1770000000",
      description: "Union",
      memberCount: 2,
      name: "Veydrift Union",
      owner: wallet,
      tag: "VDFT",
    },
    directory: [],
    pendingInvites: [],
    pendingJoinRequests: [],
    diplomacy: [],
    activeWars: [],
    allianceJoinRequests: [
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
        requestedAt: "1770000010",
      },
    ],
    members: [
      {
        address: wallet,
        role: "officer",
        joinedAt: "1770000000",
      },
    ],
    ...overrides,
  };
}

function allianceStateWithProfile(profile: {
  allianceId: string;
  tag: string;
  name: string;
  description: string;
}): ChainAllianceState {
  return allianceStateWithApplication({
    membership: {
      allianceId: profile.allianceId,
      role: "owner",
      joinedAt: "1770000000",
    },
    profile: {
      active: true,
      createdAt: "1770000000",
      description: profile.description,
      memberCount: 1,
      name: profile.name,
      owner: wallet,
      tag: profile.tag,
    },
  });
}

function missionLaunchSnapshot(overrides: {
  allActiveMissions?: FleetMissionSummary[];
  incoming?: FleetMissionSummary[];
  joinableAttacks?: FleetMissionSummary[];
  outgoing?: FleetMissionSummary[];
  returning?: FleetMissionSummary[];
} = {}): MissionLaunchSnapshot {
  return {
    allActiveMissions: overrides.allActiveMissions ?? [],
    fleetVisibility: {
      ...emptyFleetVisibility(),
      incoming: overrides.incoming ?? [],
      outgoing: overrides.outgoing ?? [],
      returning: overrides.returning ?? [],
      joinableAttacks: overrides.joinableAttacks ?? [],
    },
  };
}

function mission(missionId: string, overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId,
    status: "Outbound",
    missionType: "Attack",
    owner: wallet,
    originPlanetId: "7",
    targetPlanetId: "9",
    arrivalAt: "1770000300",
    returnAt: "1770000600",
    fuelCost: "100",
    recallCost: "50",
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    returnCargo: null,
    ships: { smallCargo: "1" },
    transactionHash: "0xabc",
    blockNumber: "123",
    ...overrides,
  };
}

function emptyQueues() {
  return {
    wallet,
    homePlanetId: "7",
    building: null,
    defense: null,
    ship: null,
    research: null,
  };
}

function resourceSnapshot(
  planetId: string,
  transactionHash: string,
  blockNumber: string,
  resources: { metal: string; crystal: string; deuterium: string },
) {
  return {
    planetId,
    transactionHash,
    blockNumber,
    lastSettledAt: String(1_770_000_000 + Number(BigInt(blockNumber))),
    resources,
  };
}

function emptyFleetVisibility() {
  return {
    wallet,
    homePlanetId: "7",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };
}
