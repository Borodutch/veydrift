import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MissionDetailPage, type MissionDetailActionState } from "../src/components/MissionDetailPage";
import type { BattleReport, DefenderPlanetState, FleetMissionSummary, MissionDetailResponse } from "../src/walletFlow";

// VEY-401: the Battle Report defender block must show the defender planet's indexed fleet/defenses
// composition (or "None") instead of the old blanket "not published in the on-chain combat log"
// placeholder. These tests render the page and assert the rendered defender copy for the populated,
// undefended ("None"), and uncharted (precise caveat) cases.

const OLD_PLACEHOLDER = "not published in the on-chain combat log";

function combatMission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Returned",
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
    ships: { lightFighter: "10" },
    transactionHash: "0xabc",
    blockNumber: "1",
    ...overrides,
  };
}

function battleReport(overrides: Partial<BattleReport> = {}): BattleReport {
  return {
    missionId: "1",
    attacker: "0x2222222222222222222222222222222222222222",
    targetPlanetId: "9",
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
    ...overrides,
  };
}

function renderDetailText(detail: MissionDetailResponse): string {
  const noop = () => {};
  const actionState: MissionDetailActionState = { status: "idle" };
  const page = MissionDetailPage({
    account: "0x1111111111111111111111111111111111111111",
    actionState,
    canTransact: false,
    copyState: "idle",
    detail,
    error: undefined,
    loading: false,
    missionId: detail.mission.missionId,
    now: 1_770_001_000_000,
    onBack: noop,
    onCompleteReturn: noop,
    onCopyShareUrl: noop,
    onCounterplay: noop,
    onRecall: noop,
    onResolve: noop,
    onRetry: noop,
    onSelectCoordinates: noop,
    onSelectPlayer: noop,
  });
  return visibleText(page);
}

describe("MissionDetailPage defender Fleet / Defenses block", () => {
  test("shows the defender's indexed fleet and defenses composition", () => {
    const defenderPlanetState: DefenderPlanetState = {
      fleet: [{ id: 1, count: 12 }], // Light Fighter
      defenses: [{ id: 4, count: 3 }], // Gauss Cannon
    };
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState });

    expect(text).toContain("Light Fighter ×12");
    expect(text).toContain("Gauss Cannon ×3");
    expect(text).not.toContain(OLD_PLACEHOLDER);
  });

  test("shows None when the defender planet had no fleet or defenses", () => {
    const defenderPlanetState: DefenderPlanetState = { fleet: [], defenses: [] };
    const text = renderDetailText({
      mission: combatMission(),
      battleReport: battleReport({ rounds: 0, defenderLosses: { metal: "0", crystal: "0", deuterium: "0" } }),
      defenderPlanetState,
    });

    expect(text).toContain("Fleet / defenses None");
    expect(text).not.toContain(OLD_PLACEHOLDER);
  });

  test("keeps a precise caveat (not the old blanket placeholder) when the target planet isn't charted", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState: null });

    expect(text).toContain("isn't charted in the indexed state");
    expect(text).not.toContain(OLD_PLACEHOLDER);
  });

  test("always renders the defender's fleet losses regardless of composition availability", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState: { fleet: [], defenses: [] } });
    expect(text).toContain("Fleet losses");
  });
});

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
    return textParts((vnode.type as (props: unknown) => ComponentChildren)(vnode.props));
  }
  if ((vnode.props as { hidden?: boolean } | undefined)?.hidden) {
    return [];
  }
  return textParts(vnode.props?.children as ComponentChildren);
}
