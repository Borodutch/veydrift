import { describe, expect, test } from "bun:test";

import {
  MISSION_REPORT_PENDING_POLL_INTERVAL_MS,
  nextMissionResolutionEventMs,
  shouldPollPendingMissionReport,
  shouldAutoPollMissionControlForPage,
} from "../src/PlayableMvpApp";
import type { BattleReport, FleetMissionSummary, FleetMissionVisibilityResponse, MissionDetailResponse } from "../src/walletFlow";

function mission(overrides: Partial<FleetMissionSummary>): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Outbound",
    missionType: "Attack",
    owner: "0xowner",
    originPlanetId: "1:1:1",
    targetPlanetId: "2:2:2",
    arrivalAt: "0",
    returnAt: "0",
    fuelCost: "0",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {},
    transactionHash: "0xhash",
    blockNumber: "1",
    ...overrides,
  };
}

function visibility(overrides: Partial<FleetMissionVisibilityResponse>): FleetMissionVisibilityResponse {
  return {
    wallet: "0xwallet",
    homePlanetId: "1:1:1",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
    ...overrides,
  };
}

function report(missionId = "1"): BattleReport {
  return {
    missionId,
    attacker: "0xowner",
    targetPlanetId: "2",
    outcome: "AttackerWin",
    rounds: 1,
    randomSeed: "1",
    loot: { metal: "0", crystal: "0", deuterium: "0" },
    attackerLosses: { metal: "0", crystal: "0", deuterium: "0" },
    defenderLosses: { metal: "0", crystal: "0", deuterium: "0" },
    debris: { metal: "0", crystal: "0" },
    roundReports: [],
    transactionHash: "0xreport",
    blockNumber: "10",
    participants: [],
  };
}

function detail(overrides: Partial<MissionDetailResponse> = {}): MissionDetailResponse {
  return {
    mission: mission({ status: "Returned", arrivalAt: "1700000000", returnAt: "1700000100" }),
    battleReport: null,
    battleReportMaterialization: { status: "pending" },
    ...overrides,
  };
}

const NOW = 1_700_000_000_000; // fixed ms reference, comfortably above the chain-seconds threshold

describe("VEY-KANEO-433 Mission Control auto-poll", () => {
  test("only the Mission Control page opts into the auto-poll", () => {
    expect(shouldAutoPollMissionControlForPage("mission-control")).toBe(true);
    for (const page of ["overview", "galaxy", "planet", "alliance", "rankings", "shipyard"] as const) {
      expect(shouldAutoPollMissionControlForPage(page)).toBe(false);
    }
  });

  test("returns undefined when there is no fleet visibility or no pending resolution", () => {
    expect(nextMissionResolutionEventMs(undefined, NOW)).toBeUndefined();
    expect(nextMissionResolutionEventMs(visibility({}), NOW)).toBeUndefined();
  });

  test("picks the soonest future outbound arrival across active feeds", () => {
    const fleet = visibility({
      outgoing: [mission({ missionId: "a", status: "Outbound", arrivalAt: String(NOW + 60_000) })],
      incoming: [mission({ missionId: "b", status: "Outbound", arrivalAt: String(NOW + 20_000) })],
      joinableAttacks: [mission({ missionId: "c", status: "Outbound", arrivalAt: String(NOW + 90_000) })],
      joinableDefenses: [mission({ missionId: "d", status: "Outbound", arrivalAt: String(NOW + 10_000) })],
    });
    expect(nextMissionResolutionEventMs(fleet, NOW)).toBe(NOW + 10_000);
  });

  test("uses returnAt for returning/recalled fleets and ignores their arrivalAt", () => {
    const fleet = visibility({
      returning: [
        mission({ missionId: "r", status: "Returning", arrivalAt: String(NOW + 5_000), returnAt: String(NOW + 40_000) }),
        mission({ missionId: "k", status: "Recalled", arrivalAt: String(NOW + 5_000), returnAt: String(NOW + 15_000) }),
      ],
    });
    expect(nextMissionResolutionEventMs(fleet, NOW)).toBe(NOW + 15_000);
  });

  test("ignores moments already in the past so a due-but-unresolved mission never busy-loops", () => {
    const fleet = visibility({
      outgoing: [
        mission({ missionId: "due", status: "Outbound", arrivalAt: String(NOW - 30_000) }),
        mission({ missionId: "soon", status: "Outbound", arrivalAt: String(NOW + 12_000) }),
      ],
    });
    expect(nextMissionResolutionEventMs(fleet, NOW)).toBe(NOW + 12_000);

    const allPast = visibility({
      outgoing: [mission({ missionId: "due", status: "Outbound", arrivalAt: String(NOW - 1) })],
    });
    expect(nextMissionResolutionEventMs(allPast, NOW)).toBeUndefined();
  });

  test("ignores non-pending statuses (a resolved/returned mission contributes no event)", () => {
    const fleet = visibility({
      outgoing: [mission({ missionId: "resolved", status: "Returned", arrivalAt: String(NOW + 10_000) })],
      returning: [mission({ missionId: "landed", status: "Resolved", returnAt: String(NOW + 10_000) })],
    });
    expect(nextMissionResolutionEventMs(fleet, NOW)).toBeUndefined();
  });
});

describe("VEY-KANEO-433 Mission Control auto-poll wiring", () => {
  test("PlayableMvpApp installs the Mission Control auto-poll on the top-bar cadence with a tightened ETA refresh", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    // Periodic poll while the page is open is owned by the shared store, not a
    // page-local timer/callback chain.
    expect(source).toContain("shouldAutoPollMissionControlForPage(page)");
    expect(source).toContain('backendData!.startPolling(\n      "mission-control"');
    expect(source).toContain('"kind:fleet-visibility"');
    expect(source).toContain('"kind:global-mission-archive"');
    const missionPoll = source.slice(
      source.indexOf('backendData!.startPolling(\n      "mission-control"'),
      source.indexOf("\n  }, [account, apiBaseUrl, backendData, page, pageStateHydrationReady]);", source.indexOf('backendData!.startPolling(\n      "mission-control"')),
    );
    expect(missionPoll).not.toContain("wallet:${account.toLowerCase()}");
    expect(source).not.toContain("const pollMissionControl = () =>");
    // VEY-KANEO-783: the shared Mission Control refresher also reloads canonical alliance
    // membership, so dissolve/leave/removal hides Alliance without reconnecting or reloading.
    const refresher = source.slice(
      source.indexOf("const refreshMissionControl = useCallback"),
      source.indexOf("const refreshFinishedBuildingState", source.indexOf("const refreshMissionControl = useCallback")),
    );
    expect(refresher).toContain("refreshAllianceState()");
    // Tightened one-shot refresh around the next resolution ETA.
    expect(source).toContain("nextMissionResolutionEventMs(fleetVisibility, Date.now())");
    expect(source).toContain("MISSION_RESOLUTION_REFRESH_BUFFER_MS");
    // The manual Refresh button stays wired to the same refresher (no regression).
    expect(source).toContain("onRefresh={() => void refreshMissionControl()}");
  });

  test("the open mission-detail report is refreshed silently by the auto-poll (no loading flicker)", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    // VEY-KANEO-433: a viewer sitting on a battle report when the mission resolves must see the new
    // loot/report without a manual Refresh, so the open detail is re-fetched on the same cadence.
    expect(source).toContain("const refreshOpenMissionDetailSilently = useCallback(async () => {");
    // The silent refresher must NOT toggle the loading spinner (that is the manual Refresh's job),
    // The canonical store owns the detail and freshness, so the silent path only refreshes the
    // shared mission key and never toggles a component-local loading or response setter.
    const silentStart = source.indexOf("const refreshOpenMissionDetailSilently");
    const silent = source.slice(silentStart, source.indexOf("\n  useEffect(() =>", silentStart));
    expect(silent).not.toContain("setMissionDetailLoading");
    expect(silent).not.toContain("setMissionDetail(detail)");
    expect(silent).toContain("backendData!.mission(missionDetailId");
    expect(source).toContain("const missionDetailSnapshot = useBackendDataSnapshot<MissionDetailResponse>");
    // The ETA-tightened transaction-priority refresh is also store-owned.
    expect(source).toContain('backendData!.scheduleRefresh(\n      "mission-control-resolution"');
    const resolutionRefresh = source.slice(
      source.indexOf('backendData!.scheduleRefresh(\n      "mission-control-resolution"'),
      source.indexOf("\n  }, [account, apiBaseUrl, backendData, fleetVisibility, page, pageStateHydrationReady]);", source.indexOf('backendData!.scheduleRefresh(\n      "mission-control-resolution"')),
    );
    expect(resolutionRefresh).not.toContain("wallet:${account.toLowerCase()}");
  });
});

describe("VEY-KANEO-653 pending mission report polling", () => {
  test("polls only while a combat mission report is absent", () => {
    expect(MISSION_REPORT_PENDING_POLL_INTERVAL_MS).toBe(3_000);
    expect(shouldPollPendingMissionReport(detail(), 1_700_000_200_000)).toBe(true);
    expect(shouldPollPendingMissionReport(detail({ battleReportMaterialization: { status: "missing" } }), 1_700_000_200_000)).toBe(true);
    expect(shouldPollPendingMissionReport(detail({ battleReport: report() }), 1_700_000_200_000)).toBe(false);
    expect(shouldPollPendingMissionReport(detail({ mission: mission({ missionType: "Transport", status: "Returned" }) }), 1_700_000_200_000)).toBe(false);
    expect(shouldPollPendingMissionReport(detail({ mission: mission({ status: "Outbound", arrivalAt: "1800000000" }) }), 1_700_000_200_000)).toBe(false);
  });

  test("PlayableMvpApp installs a 3s pending-report poll that stops after a report appears", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    expect(source).toContain("`pending-report:${missionDetailId}`");
    expect(source).toContain("MISSION_REPORT_PENDING_POLL_INTERVAL_MS");
    expect(source).toContain('"kind:mission"');
    expect(source).toContain("!shouldPollPendingMissionReport(missionDetail)");
    expect(source).toContain("backendData!.mission(missionDetailId)");
  });
});
