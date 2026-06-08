import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ComponentChildren, VNode } from "preact";
import { MissionControlPage, formatMissionTime, missionControlRefreshButtonState, missionLifecycleActions } from "../src/components/MissionControlPage";
import type { BattleReport, FleetMissionSummary, ManagedPlanetResponse } from "../src/walletFlow";

describe("MissionControlPage", () => {
  test("renders mission timing with relative and exact local timestamps", () => {
    const secondsLabel = formatMissionTime("1770000300", 1_770_000_000_000);
    const millisecondsLabel = formatMissionTime("1770000300000", 1_770_000_000_000);

    expect(secondsLabel).toContain("5m");
    expect(secondsLabel).toContain("2026");
    expect(secondsLabel).not.toContain("1770000300");
    expect(millisecondsLabel).toBe(secondsLabel);
  });

  test("enables only playable lifecycle actions for mission timing", () => {
    const now = 1_770_000_100_000;

    expect(missionLifecycleActions({
      canTransact: true,
      context: "outgoing",
      mission: mission({ arrivalAt: "1770000300", missionId: "1", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["resolve", false],
      ["recall", true],
    ]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "due",
      mission: mission({ arrivalAt: "1770000000", missionId: "2", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["resolve", true],
    ]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "returning",
      mission: mission({ missionId: "3", returnAt: "1770000000", status: "Returning" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["completeReturn", true],
    ]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "incoming",
      mission: mission({ arrivalAt: "1770000300", missionId: "4", missionType: "Attack", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["resolve", false],
      ["counterplay", true],
    ]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "joinable",
      mission: mission({ arrivalAt: "1770000300", missionId: "5", missionType: "Attack", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["resolve", false],
      ["joinAttack", true],
    ]);
  });

  test("renders player-facing mission control rows without implementation copy", () => {
    const page = MissionControlPage({
      actionState: { status: "idle" },
      canTransact: true,
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [mission({ missionId: "8", missionType: "Attack", owner: "0x3333333333333333333333333333333333333333" })],
        outgoing: [mission({ missionId: "9", missionType: "Transport" })],
        returning: [mission({ missionId: "10", status: "Returning" })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      loading: false,
      now: 1_770_000_700_000,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
      reportUrlForMission: (missionId) => `#/mission-control/report/${missionId}`,
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Mission Control");
    expect(text).toContain("Watch inbound attacks");
    // The top summary stat-card row was removed; the lists below convey the same counts.
    expect(text).not.toContain("Active missions 3");
    expect(text).not.toContain("Due resolvers");
    expect(text).not.toContain("Returns 1");
    expect(text).toContain("No completed missions are visible for this wallet yet.");
    // The active "Fleet movement" label is dropped; the past missions table keeps its header.
    expect(text).not.toContain("Fleet movement");
    expect(text).toContain("Past missions");
    expect(text).toContain("Countdown Mission Origin -> Target Return Fleet / cargo Orders");
    // Hostile inbound missions read "Incoming attack"; the player's own launches stay bare.
    expect(text).toContain("Incoming attack # 8");
    expect(text).not.toContain("Attack # 8");
    expect(text).toContain("Hostile inbound");
    expect(text).toContain("Origin Planet #7");
    expect(text).toContain("Target Planet #9");
    expect(text).toContain("Transport # 9");
    expect(text).toContain("Land fleet");
    expect(text).toContain("Open mission");
    expect(text).toContain("Copy report");
    expect(text).toContain("New Eos [2:44:9]");
    expect(text).toContain("External coordinates unavailable");
    // Commander identity is kept for the foreign incoming attacker...
    expect(text).toContain("0x3333...3333");
    // ...but dropped for the player's own outgoing/returning fleets (always themselves).
    expect(text).not.toContain("Commander 0x1111...1111");
    expect(text).toContain("Report 0xabc...");
    expect(text).not.toContain("Fleets 3/?");
    expect(text).not.toContain("Reload");
    expect(text).not.toContain("Fleet Operations");
    expect(text).not.toContain("MISSION CONTROL");
    expect(text).not.toContain("Galaxy");
    expect(text).not.toContain("Reports");
    expect(text).not.toContain("Battle reports");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Contract-indexed");
    expect(text).not.toContain("contract-supported");
    expect(text).not.toContain("game contract");
    expect(text).not.toContain("ACS and Intercept");
    expect(text).not.toContain("Harvests and Saves");
    expect(text).not.toContain("Missiles and Moons");
    expect(text).not.toContain("No Spy Reports");
    expect(text).not.toContain("Target intel is public contract state");
    expect(text).not.toContain("Espionage mission");
    expect(text).not.toContain("Scan mission");
    expect(text).not.toContain("Protected storage");
    expect(text).not.toContain("Raid-exposed resources");
    expect(text).not.toContain("Contract raid protection");
  });

  test("uses the shared refresh button treatment", () => {
    expect(missionControlRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(missionControlRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });

    const idlePage = missionControlPage({ loading: false });
    const refreshingPage = missionControlPage({ loading: true });
    const source = readFileSync(new URL("../src/components/MissionControlPage.tsx", import.meta.url), "utf8");

    expect(visibleText(idlePage)).toContain("Refresh");
    expect(visibleText(refreshingPage)).toContain("Refreshing");
    expect(source).toContain("<RefreshButton");
    expect(source).not.toContain("RefreshCw");
  });

  test("renders attacker and defender attack views with side-specific controls", () => {
    const defenderPage = missionControlPage({
      fleetVisibility: {
        wallet: "0x9999999999999999999999999999999999999999",
        homePlanetId: "9",
        incoming: [mission({
          missionId: "77",
          owner: "0x1111111111111111111111111111111111111111",
          originPlanetId: "7",
          targetPlanetId: "9",
          originPlanet: {
            planetId: "7",
            owner: "0x1111111111111111111111111111111111111111",
            ownerDisplayName: "Astra",
            name: "New Eos",
            galaxy: 2,
            system: 44,
            position: 9,
            coordinates: "2:44:9",
          },
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("77")],
      },
      walletPlanets: [managedPlanet({
        planetId: "9",
        owner: "0x9999999999999999999999999999999999999999",
        coordinates: "4:55:11",
        name: "Red Haven",
      })],
    });
    const defenderText = visibleText(defenderPage);

    // "Hostile inbound" persists as the active-row direction label (the stat card is gone).
    expect(defenderText).toContain("Hostile inbound");
    expect(defenderText).toContain("Astra (0x1111...1111)");
    expect(defenderText).toContain("New Eos [2:44:9]");
    expect(defenderText).toContain("Red Haven [4:55:11]");
    expect(defenderText).toContain("Group defend");
    expect(defenderText).toContain("Intercept");
    expect(defenderText).toContain("Battle report");
    expect(defenderText).toContain("Past missions");
    expect(defenderText).not.toContain("Recall fleet");

    const attackerPage = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({
          missionId: "77",
          owner: "0x1111111111111111111111111111111111111111",
          originPlanetId: "7",
          targetPlanetId: "9",
          originPlanet: {
            planetId: "7",
            owner: "0x1111111111111111111111111111111111111111",
            ownerDisplayName: "Astra",
            name: "New Eos",
            galaxy: 2,
            system: 44,
            position: 9,
            coordinates: "2:44:9",
          },
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("77")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const attackerText = visibleText(attackerPage);

    // The summary stat-card row was removed; the active mission still renders below.
    expect(attackerText).not.toContain("Active missions 1");
    expect(attackerText).toContain("Recall fleet");
    expect(attackerText).toContain("Open mission");
    expect(attackerText).toContain("Copy report");
    expect(attackerText).toContain("Battle report");
    expect(attackerText).toContain("Past missions");
    expect(attackerText).not.toContain("Group defend");
    expect(attackerText).not.toContain("Intercept");
  });

  test("renders a shareable battle report detail with operational fields", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({
          attackGroupId: "42",
          missionId: "12",
          missionType: "AcsAttack",
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      reportMissionId: "12",
      reportUrlForMission: (missionId) => `https://test.veydrift.com/#/mission-control/report/${missionId}`,
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Shareable battle report");
    expect(text).toContain("Group attack # 12");
    expect(text).toContain("Battle time");
    expect(text).toContain("Commanders");
    expect(text).toContain("Coordinates");
    expect(text).toContain("Fleets and cargo");
    expect(text).toContain("Losses and debris");
    expect(text).toContain("Public proof");
    expect(text).toContain("New Eos [2:44:9]");
    expect(text).toContain("Red Haven [4:55:11]");
    expect(text).toContain("Orion (0x9999...9999)");
    expect(text).toContain("Group 42");
    expect(text).toContain("https://test.veydrift.com/#/mission-control/report/12");
    expect(text).not.toContain("Alliance Combat System");
    expect(text).not.toContain("ACS");
  });

  test("surfaces due missions as urgent playable orders", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({ arrivalAt: "1770000000", missionId: "12", missionType: "Attack" })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      now: 1_770_000_700_000,
    });
    const text = visibleText(page);

    expect(text).toContain("Needs orders now");
    // Due count now surfaces only via the "Needs orders now" badge (the summary stat card is gone).
    expect(text).not.toContain("Due resolvers");
    expect(text).toContain("Needs orders now 1");
    expect(text).toContain("Resolve battle");
  });

  test("paginates past missions inline without a separate list action", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: Array.from({ length: 26 }, (_, index) => battleReport((index + 1).toString())),
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Past missions");
    // 25 battle-report rows render on the visible first page; the 26th is on the hidden second page.
    // Each row exposes a single "Open mission" button (Details + Report merged in VEY-374).
    expect(text.split("Open mission").length - 1).toBe(25);
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("1-25 of 26");
    // The dedicated "Completed" column header is gone; the compact table keeps the remaining columns.
    expect(text).toContain("Mission Route / target Result Details");
    expect(text).not.toContain("Completed");
    expect(text).not.toContain("Mission #");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Battle reports");
  });

  test("collapses a completed mission and its matching battle report into one archive row", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [mission({ missionId: "77", status: "Returned" })],
        battleReports: [battleReport("77")],
      },
    });
    const text = visibleText(page);

    // VEY-371 restores the "Past missions" header on the compact table.
    expect(text).toContain("Past missions");
    // Mission 77 collapses to a single row; the bare outgoing "Attack" label is kept.
    expect(text).toContain("Attack");
    // Mission-number text is no longer rendered in the compact past rows (VEY-371).
    expect(text).not.toContain("Mission #");
    // A single "Open mission" button replaces the old split "Open details" / "Open report" pair.
    expect(text).toContain("Open mission");
    expect(text.split("Open mission").length - 1).toBe(1);
    expect(text).not.toContain("Open details");
    expect(text).not.toContain("Open report");
    // The standalone battle-report row is collapsed away.
    expect(text).not.toContain("Battle report");
  });

  test("renders a standalone battle report row when no completed mission matches", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("90")],
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Battle report");
    // VEY-371 restores the "Past missions" header and renders the target planet inline.
    expect(text).toContain("Past missions");
    expect(text).toContain("Planet # 7");
    // Mission-number text is no longer rendered in the compact past rows (VEY-371).
    expect(text).not.toContain("Mission #");
    // Standalone battle-report rows also lead to the single unified mission detail screen.
    expect(text).toContain("Open mission");
    expect(text).not.toContain("Open report");
  });

  test("labels past missions by direction and drops the self-commander on outgoing", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [
          mission({
            missionId: "77",
            missionType: "Transport",
            owner: "0x1111111111111111111111111111111111111111",
            originPlanetId: "7",
            targetPlanetId: "9",
            status: "Returned",
          }),
          mission({
            missionId: "88",
            missionType: "Attack",
            owner: "0x3333333333333333333333333333333333333333",
            originPlanetId: "5",
            targetPlanetId: "7",
            status: "Returned",
          }),
        ],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // Outgoing past mission keeps the bare action and hides the always-me commander.
    // (Mission-number text is dropped from the compact past rows per VEY-371.)
    expect(text).toContain("Transport");
    expect(text).not.toContain("Mission #");
    expect(text).not.toContain("Commander 0x1111...1111");
    // Incoming past mission is prefixed and keeps the foreign commander identity.
    expect(text).toContain("Incoming attack");
    expect(text).toContain("Commander 0x3333...3333");
  });

  test("surfaces joinable attacks under the Alliance tab (no stat-card row)", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [mission({
          missionId: "88",
          missionType: "Attack",
          owner: "0x3333333333333333333333333333333333333333",
          originPlanetId: "12",
          targetPlanetId: "99",
        })],
        completedMissions: [],
        battleReports: [],
      },
    });
    const text = visibleText(page);

    // The summary stat-card row was removed; the joinable attack is now surfaced in the
    // Alliance tab (My missions / Alliance split from VEY-375), not a unified list.
    expect(text).not.toContain("Active missions 1");
    expect(text).toContain("My missions (0)");
    expect(text).toContain("Alliance (1)");
  });
});

function missionControlPage(overrides: Partial<Parameters<typeof MissionControlPage>[0]> = {}): ComponentChildren {
  return MissionControlPage({
    actionState: { status: "idle" },
    canTransact: true,
    fleetVisibility: {
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      incoming: [],
      outgoing: [],
      returning: [],
      joinableAttacks: [],
      completedMissions: [],
      battleReports: [],
    },
    loading: false,
    now: 1_770_000_700_000,
    onCompleteReturn: () => undefined,
    onCounterplay: () => undefined,
    onJoinAttack: () => undefined,
    onOpenReport: () => undefined,
    onOpenReportList: () => undefined,
    onRecall: () => undefined,
    onRefresh: () => undefined,
    onResolve: () => undefined,
    ...overrides,
  });
}

function mission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Outbound",
    missionType: "Attack",
    owner: "0x1111111111111111111111111111111111111111",
    originPlanetId: "7",
    targetPlanetId: "9",
    arrivalAt: "1770000300",
    returnAt: "1770000600",
    fuelCost: "25",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {
      smallCargo: "0",
      lightFighter: "1",
    },
    transactionHash: "0xabc",
    blockNumber: "1",
    ...overrides,
  };
}

function managedPlanet(overrides: Partial<ManagedPlanetResponse> = {}): ManagedPlanetResponse {
  return {
    planetId: "7",
    owner: "0x1111111111111111111111111111111111111111",
    name: null,
    galaxy: 2,
    system: 44,
    position: 9,
    fields: 200,
    temperature: 20,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "1770000000",
    resources: { metal: "0", crystal: "0", deuterium: "0" },
    coordinates: "2:44:9",
    isHomePlanet: true,
    fieldsUsed: 0,
    fieldsCapacity: 200,
    keyLevels: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
    moon: null,
    ...overrides,
  };
}

function battleReport(missionId: string): BattleReport {
  return {
    missionId,
    attacker: "0x2222222222222222222222222222222222222222",
    targetPlanetId: "7",
    outcome: "AttackerWin",
    rounds: 2,
    randomSeed: "99",
    loot: { metal: "1200", crystal: "300", deuterium: "0" },
    attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
    defenderLosses: { metal: "900", crystal: "250", deuterium: "0" },
    debris: { metal: "600", crystal: "150" },
    roundReports: [],
    transactionHash: "0xabc",
    blockNumber: "1234",
  };
}

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return textParts(vnode.type(vnode.props));
  }
  if ((vnode.props as { hidden?: boolean } | undefined)?.hidden) {
    return [];
  }
  return textParts(vnode.props?.children as ComponentChildren);
}
