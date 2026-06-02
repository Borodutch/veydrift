import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MissionControlPage, deriveRaidExposedResources, formatMissionTime, missionLifecycleActions } from "../src/components/MissionControlPage";
import type { FleetMissionSummary } from "../src/walletFlow";

describe("MissionControlPage", () => {
  test("renders mission timing with relative and exact local timestamps", () => {
    const secondsLabel = formatMissionTime("1770000300", 1_770_000_000_000);
    const millisecondsLabel = formatMissionTime("1770000300000", 1_770_000_000_000);

    expect(secondsLabel).toContain("5m");
    expect(secondsLabel).toContain("2026");
    expect(secondsLabel).not.toContain("1770000300");
    expect(millisecondsLabel).toBe(secondsLabel);
  });

  test("enables only contract-supported lifecycle actions for mission timing", () => {
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

  test("renders fleet operations from visibility data with explicit espionage exclusion copy", () => {
    const page = MissionControlPage({
      actionState: { status: "idle" },
      canTransact: true,
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [mission({ missionId: "8", missionType: "Attack", owner: "0x3333333333333333333333333333333333333333" })],
        outgoing: [mission({ missionId: "9", missionType: "Transport" })],
        returning: [mission({ missionId: "10", status: "Returning" })],
      },
      loading: false,
      now: 1_770_000_700_000,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onNavigateGalaxy: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
    });
    const text = visibleText(page);

    expect(text).toContain("Fleet Operations");
    expect(text).toContain("Active missions 3");
    expect(text).toContain("Attack # 8");
    expect(text).toContain("Transport # 9");
    expect(text).toContain("Complete return");
    expect(text).toContain("No Spy Reports");
    expect(text).toContain("Target intel is public contract state");
    expect(text).not.toContain("Espionage mission");
    expect(text).not.toContain("Scan mission");
  });

  test("explains zero protected storage while reconciling raid-exposed resources from current resources", () => {
    const page = missionControlPage({
      currentResources: { metal: "44", crystal: "907", deuterium: "326" },
      protectedResources: { metal: "0", crystal: "0", deuterium: "0" },
      raidableResources: { metal: "999", crystal: "999", deuterium: "999" },
    });
    const text = visibleText(page);

    expect(text).toContain("Protected storage 0 Metal 0 Crystal 0 Deut.");
    expect(text).toContain("Raid-exposed resources 44 Metal 907 Crystal 326 Deut.");
    expect(text).toContain("Contract raid protection is currently 0%");
  });

  test("renders partial protected storage as current resources minus protected amounts", () => {
    const page = missionControlPage({
      currentResources: { metal: "12000", crystal: "8000", deuterium: "3000" },
      protectedResources: { metal: "1000", crystal: "2500", deuterium: "500" },
      raidableResources: { metal: "0", crystal: "0", deuterium: "0" },
    });
    const text = visibleText(page);

    expect(text).toContain("Protected storage 1,000 Metal 2,500 Crystal 500 Deut.");
    expect(text).toContain("Raid-exposed resources 11,000 Metal 5,500 Crystal 2,500 Deut.");
    expect(text).toContain("floored at zero");
  });

  test("caps raid-exposed resources at zero when protection exceeds current resources", () => {
    expect(deriveRaidExposedResources(
      { metal: "500", crystal: "250", deuterium: "0" },
      { metal: "1000", crystal: "250", deuterium: "1" },
    )).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
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
    },
    loading: false,
    now: 1_770_000_700_000,
    onCompleteReturn: () => undefined,
    onCounterplay: () => undefined,
    onNavigateGalaxy: () => undefined,
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
  return textParts(vnode.props?.children as ComponentChildren);
}
