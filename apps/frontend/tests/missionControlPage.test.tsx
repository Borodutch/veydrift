import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MissionControlPage, missionLifecycleActions } from "../src/components/MissionControlPage";
import type { FleetMissionSummary } from "../src/walletFlow";

describe("MissionControlPage", () => {
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
  });

  test("renders fleet operations from visibility data without unsupported fake actions", () => {
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
      protectedResources: { metal: "5000", crystal: "3000", deuterium: "1000" },
      raidableResources: { metal: "1200", crystal: "800", deuterium: "0" },
    });
    const text = visibleText(page);

    expect(text).toContain("Fleet Operations");
    expect(text).toContain("Protected Storage");
    expect(text).toContain("Shielded 5,000 Metal 3,000 Crystal 1,000 Deut.");
    expect(text).toContain("Raid-exposed 1,200 Metal 800 Crystal 0 Deut.");
    expect(text).toContain("Active missions 3");
    expect(text).toContain("Attack # 8");
    expect(text).toContain("Transport # 9");
    expect(text).toContain("Complete return");
    expect(text).not.toContain("Espionage");
    expect(text).not.toContain("Spy");
  });
});

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
