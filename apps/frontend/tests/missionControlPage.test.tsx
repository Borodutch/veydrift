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
        battleReports: [],
      },
      loading: false,
      now: 1_770_000_700_000,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onOpenBattleReport: () => undefined,
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
    expect(text).toContain("Active missions 3");
    expect(text).toContain("Incoming attacks 1");
    expect(text).toContain("Outgoing fleets 1");
    expect(text).toContain("Returning fleets 1");
    expect(text).toContain("Resolved battle reports 0");
    expect(text).toContain("Attack # 8");
    expect(text).toContain("Origin Planet #7");
    expect(text).toContain("Target Planet #9");
    expect(text).toContain("Transport # 9");
    expect(text).toContain("Land fleet");
    expect(text).toContain("View report");
    expect(text).toContain("Copy report");
    expect(text).toContain("New Eos [2:44:9]");
    expect(text).toContain("External coordinates unavailable");
    expect(text).toContain("0x3333...3333");
    expect(text).toContain("Report 0xabc...");
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
    expect(source).toContain("h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200");
    expect(source).not.toContain("RefreshCw");
    expect(source).not.toContain("inline-flex h-9 items-center justify-center gap-2");
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

    expect(defenderText).toContain("Incoming attacks 1");
    expect(defenderText).toContain("Astra (0x1111...1111)");
    expect(defenderText).toContain("New Eos [2:44:9] -> Red Haven [4:55:11]");
    expect(defenderText).toContain("Group defend");
    expect(defenderText).toContain("Intercept");
    expect(defenderText).toContain("Resolved battle reports 1");
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
        battleReports: [battleReport("77")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const attackerText = visibleText(attackerPage);

    expect(attackerText).toContain("Outgoing fleets 1");
    expect(attackerText).toContain("Recall fleet");
    expect(attackerText).toContain("View report");
    expect(attackerText).toContain("Copy report");
    expect(attackerText).toContain("Resolved battle reports 1");
    expect(attackerText).not.toContain("Group defend");
    expect(attackerText).not.toContain("Intercept");
  });

  test("renders a shareable battle report detail with OGame-style operational fields", () => {
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
        battleReports: [],
      },
      now: 1_770_000_700_000,
    });
    const text = visibleText(page);

    expect(text).toContain("Needs orders now");
    expect(text).toContain("Resolve battles or land fleets");
    expect(text).toContain("Ready to resolve 1");
    expect(text).toContain("Resolve battle");
  });

  test("paginates resolved battle reports inline without a separate list action", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        battleReports: Array.from({ length: 7 }, (_, index) => battleReport((index + 1).toString())),
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Resolved battle reports 7");
    expect(text).toContain("Mission # 1");
    expect(text).toContain("Mission # 6");
    expect(text).not.toContain("Mission # 7");
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("Previous");
    expect(text).toContain("Next");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Battle reports");
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
      battleReports: [],
    },
    loading: false,
    now: 1_770_000_700_000,
    onCompleteReturn: () => undefined,
    onCounterplay: () => undefined,
    onOpenBattleReport: () => undefined,
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
