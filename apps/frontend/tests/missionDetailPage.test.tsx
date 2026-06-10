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

describe("MissionDetailPage Route timing copy", () => {
  // VEY-405: a completed leg should collapse to a single past-tense word — "Returned"
  // for the origin, "Arrived" for the target — dropping the RETURN/ARRIVAL caption, the
  // timestamp, and the generic building-queue "(Ready)" suffix entirely.
  test("collapses a completed leg to just Returned/Arrived", () => {
    // combatMission's arrivalAt/returnAt are both before the fixed `now` in renderDetailText.
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState: null });

    expect(text).toContain("Arrived");
    expect(text).toContain("Returned");
    expect(text).not.toContain("(Ready)");
    // The RETURN/ARRIVAL captions are dropped for completed legs, so "Return Returned"
    // / "Arrival Arrived" must NOT appear.
    expect(text).not.toContain("Return Returned");
    expect(text).not.toContain("Arrival Arrived");
  });

  // VEY-411: complements VEY-405 — the collapsed "Returned"/"Arrived" word keeps its
  // single-word headline but now carries the moment it happened as a compact, muted
  // subtext (short month + day + time, e.g. "Feb 1, 6:50 PM"), not the old verbose
  // inline string with a "(Ready)" suffix.
  test("shows the completed return/arrival moment as a compact subtext", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState: null });

    // returnAt/arrivalAt are both before the fixed `now`, so both legs are completed and
    // each renders a "Mon D, H:MM AM/PM" stamp beneath its past-tense word.
    const compactStamp = /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}[\s ][AP]M/g;
    const stamps = text.match(compactStamp) ?? [];
    expect(stamps.length).toBeGreaterThanOrEqual(2);
    // Still no "(Ready)" suffix and still collapsed to the single past-tense word.
    expect(text).toContain("Returned");
    expect(text).toContain("Arrived");
    expect(text).not.toContain("(Ready)");
  });

  test("keeps the caption, absolute time, and countdown for an in-flight leg", () => {
    const text = renderDetailText({
      mission: combatMission({ status: "Outbound", arrivalAt: "1770002000", returnAt: "1770003000" }),
      battleReport: battleReport(),
      defenderPlanetState: null,
    });

    expect(text).not.toContain("Arrived");
    expect(text).not.toContain("Returned");
    // In-flight legs still render their caption plus the relative countdown in parentheses.
    expect(text).toMatch(/Arrival .+\(/);
    expect(text).toMatch(/Return .+\(/);
  });
});

// VEY-KANEO-409: the "Recall cost" row in the Fleet And Cargo panel is only meaningful while a fleet
// is still in flight. For a finished (non-recalled) mission it would only read "Not recallable", so
// the row is hidden. (These cases render the standalone facts panel by omitting the battle report.)
describe("MissionDetailPage recall cost row", () => {
  function transportMission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
    return combatMission({ missionType: "Transport", ships: { smallCargo: "3" }, ...overrides });
  }

  test("hides the recall cost row for a finished (non-recalled) mission", () => {
    const text = renderDetailText({ mission: transportMission({ status: "Returned" }) });

    expect(text).toContain("Fleet And Cargo");
    expect(text).toContain("Fuel cost");
    expect(text).not.toContain("Recall cost");
    expect(text).not.toContain("Not recallable");
  });

  test("keeps the recall cost row for an in-flight outbound mission", () => {
    const text = renderDetailText({ mission: transportMission({ status: "Outbound", recallCost: "50" }) });

    expect(text).toContain("Recall cost");
    expect(text).toContain("50 deuterium");
  });

  test("keeps the recall cost row for a recalled fleet still heading home", () => {
    const text = renderDetailText({ mission: transportMission({ status: "Recalled", recallCost: null }) });

    expect(text).toContain("Recall cost");
    expect(text).toContain("Not recallable");
  });
});

// VEY-KANEO-424: the Recall button must appear for an owner's still-in-flight Outbound fleet, the
// same as the Mission Control list. It must not be gated on mission.recallCost — that field is only
// emitted on recall, so an outbound fleet carries a null cost and the button used to disappear here.
describe("MissionDetailPage Recall action", () => {
  function transportMission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
    // arrival/return in the far future so the fleet is still in flight (not yet due) under the
    // fixed `now` used by renderDetailText.
    return combatMission({
      missionType: "Transport",
      ships: { smallCargo: "3" },
      status: "Outbound",
      arrivalAt: "1770002000",
      returnAt: "1770003000",
      ...overrides,
    });
  }

  test("shows the Recall button for an owner's outbound fleet even when recallCost is null", () => {
    const text = renderDetailText({ mission: transportMission({ recallCost: null }) });

    expect(text).toContain("Available Orders");
    expect(text).toContain("Recall fleet");
  });

  test("still shows the Recall button when the backend projected a recall cost", () => {
    const text = renderDetailText({ mission: transportMission({ recallCost: "50" }) });

    expect(text).toContain("Recall fleet");
    expect(text).toContain("50 deuterium");
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
