import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MissionDetailPage, type MissionDetailActionState } from "../src/components/MissionDetailPage";
import type { BattleReport, DefenderPlanetState, FleetMissionSummary, FleetMissionVisibilityResponse, MissionDetailResponse } from "../src/walletFlow";

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

// Mirrors the backend's wallet-scoped fleet-visibility classification the detail page now reuses:
// an Outbound fleet you own is "outgoing", a Returning/Recalled one is "returning". A mission left
// out of every list models a viewer with no relationship to the fleet (a stranger / shared link),
// who must get no orders. By default the rendered mission is slotted by its own status so the
// owner-centric tests below see the same classification Mission Control would compute.
function visibilityFor(mission: FleetMissionSummary): FleetMissionVisibilityResponse {
  const empty: FleetMissionVisibilityResponse = {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "1",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };
  if (mission.status === "Outbound") return { ...empty, outgoing: [mission] };
  if (mission.status === "Returning" || mission.status === "Recalled") return { ...empty, returning: [mission] };
  return empty;
}

function renderDetailText(detail: MissionDetailResponse, fleetVisibility = visibilityFor(detail.mission)): string {
  const noop = () => {};
  const actionState: MissionDetailActionState = { status: "idle" };
  const page = MissionDetailPage({
    actionState,
    canTransact: false,
    detail,
    error: undefined,
    fleetVisibility,
    loading: false,
    missionId: detail.mission.missionId,
    now: 1_770_001_000_000,
    onBack: noop,
    onCompleteReturn: noop,
    onShareReport: noop,
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

describe("MissionDetailPage ACS attack group (VEY-KANEO-432)", () => {
  const mainAttacker = "0x2222222222222222222222222222222222222222";
  const joinerA = "0x3333333333333333333333333333333333333333";
  const joinerB = "0x4444444444444444444444444444444444444444";

  function groupedReport(): BattleReport {
    return battleReport({
      attacker: mainAttacker,
      loot: { metal: "1000", crystal: "0", deuterium: "0" },
      attackGroupId: "1",
      participants: [
        { missionId: "1", address: mainAttacker, isMainAttacker: true, ships: { lightFighter: "10" }, loot: { metal: "1000", crystal: "0", deuterium: "0" } },
        { missionId: "2", address: joinerA, isMainAttacker: false, ships: { largeCargo: "5" }, loot: { metal: "600", crystal: "0", deuterium: "0" } },
        { missionId: "3", address: joinerB, isMainAttacker: false, ships: { cruiser: "2" }, loot: { metal: "400", crystal: "0", deuterium: "0" } },
      ],
    });
  }

  test("renders the Attack group panel with every participant and their individual loot share", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: groupedReport(), defenderPlanetState: null });

    expect(text).toContain("Attack group");
    expect(text).toContain("3 participants");
    expect(text).toContain("Main attacker");
    expect(text).toContain("Joined");
    // Each joiner's individual loot share is shown (proportional to capacity on-chain).
    expect(text).toContain("Loot share");
    expect(text).toContain("600 metal");
    expect(text).toContain("400 metal");
    // The shortened joiner commanders appear in the breakdown.
    expect(text).toContain("0x3333...3333");
    expect(text).toContain("0x4444...4444");
  });

  test("shows the combined group total loot, not just the main attacker's share", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: groupedReport(), defenderPlanetState: null });

    // 1000 (main) + 600 + 400 = 2000 hauled by the group; the Attacker panel reports the total.
    expect(text).toContain("Loot grabbed (total)");
    expect(text).toContain("2,000 metal");
    expect(text).toContain("Total group loot");
    expect(text).toContain("Combat ships (combined)");
  });

  test("scales to an arbitrary number of joiners", () => {
    const participants = [
      { missionId: "1", address: mainAttacker, isMainAttacker: true, ships: {}, loot: { metal: "100", crystal: "0", deuterium: "0" } },
      ...Array.from({ length: 8 }, (_, index) => ({
        missionId: String(index + 2),
        address: `0x${String(index + 1).repeat(40).slice(0, 40)}`,
        isMainAttacker: false,
        ships: {},
        loot: { metal: "10", crystal: "0", deuterium: "0" },
      })),
    ];
    const text = renderDetailText({
      mission: combatMission(),
      battleReport: battleReport({ attacker: mainAttacker, participants }),
      defenderPlanetState: null,
    });

    expect(text).toContain("9 participants");
  });

  test("a solo (non-grouped) attack does not render the Attack group panel", () => {
    const text = renderDetailText({ mission: combatMission(), battleReport: battleReport(), defenderPlanetState: null });

    expect(text).not.toContain("Attack group");
    expect(text).not.toContain("Loot grabbed (total)");
    expect(text).toContain("Loot grabbed");
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

  test("keeps the recall cost row for an in-flight outbound mission still within the recall window", () => {
    // arrival far in the future (well before the 60s cutoff) so the fleet is still recallable.
    const text = renderDetailText({ mission: transportMission({ status: "Outbound", recallCost: "50", arrivalAt: "1770005000", returnAt: "1770006000" }) });

    expect(text).toContain("Recall cost");
    expect(text).toContain("50 deuterium");
  });

  // VEY-KANEO-424 acceptance #2: past the 60s recall cutoff (but before arrival) the fleet can no
  // longer be recalled, so the row must read "Not recallable" even though the backend still carries a
  // projected cost — keeping Mission Detail consistent with the (now-disabled) Mission Control button.
  test("shows Not recallable for an outbound fleet past the 60s recall cutoff", () => {
    // renderDetailText fixes now at 1_770_001_000_000 ms (1_770_001_000 s); arrival 30s later is
    // inside the 60s cutoff window, so recall is no longer possible.
    const text = renderDetailText({ mission: transportMission({ status: "Outbound", recallCost: "50", arrivalAt: "1770001030", returnAt: "1770001330" }) });

    expect(text).toContain("Recall cost");
    expect(text).toContain("Not recallable");
    expect(text).not.toContain("50 deuterium");
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

// VEY-KANEO-424 rework: the detail page must authorize orders exactly like the Mission Control list,
// which derives them from the backend's wallet-scoped fleet-visibility. The pre-rework detail code
// re-derived the viewer's role from a bare `owner === account` check, so it (a) only matched the
// owner's Recall by luck and (b) fabricated an "incoming" defender role for ANY viewer of someone
// else's attack, wrongly rendering Group defend / Intercept to strangers. QA hit case (b): on an
// outbound attack they did not own, Available Orders showed Group defend / Intercept and no Recall.
describe("MissionDetailPage order authorization (matches Mission Control)", () => {
  function outboundAttack(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
    // Far-future arrival so the fleet is still in flight (not yet due) under renderDetailText's now.
    return combatMission({
      status: "Outbound",
      missionType: "Attack",
      arrivalAt: "1770002000",
      returnAt: "1770003000",
      recallCost: "50",
      ...overrides,
    });
  }

  const emptyVisibility: FleetMissionVisibilityResponse = {
    wallet: "0x9999999999999999999999999999999999999999",
    homePlanetId: "1",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };

  test("offers no orders to a viewer with no visibility relationship to the fleet", () => {
    // Stranger / shared link: the fleet is in none of their visibility lists.
    const text = renderDetailText({ mission: outboundAttack() }, emptyVisibility);

    expect(text).not.toContain("Available Orders");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("Group defend");
    expect(text).not.toContain("Intercept");
  });

  test("offers Group defend only to the actual defender (incoming attack)", () => {
    const mission = outboundAttack();
    const text = renderDetailText({ mission }, { ...emptyVisibility, incoming: [mission] });

    expect(text).toContain("Available Orders");
    expect(text).toContain("Group defend");
    // VEY-KANEO-439: Intercept removed from the frontend; only Group defend (AcsDefend) remains.
    expect(text).not.toContain("Intercept");
    expect(text).not.toContain("Recall fleet");
    // VEY-KANEO-424 rework: the defender has no Recall button, so they must not see a recall-cost
    // row either — QA bounced the ticket twice reading "RECALL COST: N deuterium" with no button as
    // a missing button. The cost is wallet-scoped to the owner now.
    expect(text).not.toContain("Recall cost");
    expect(text).not.toContain("50 deuterium");
  });

  test("offers Recall to the fleet owner (outgoing) and not the defender's counterplay", () => {
    const mission = outboundAttack();
    const text = renderDetailText({ mission }, { ...emptyVisibility, outgoing: [mission] });

    expect(text).toContain("Recall fleet");
    expect(text).not.toContain("Group defend");
    expect(text).not.toContain("Intercept");
  });
});

// VEY-KANEO-339: the battle-report header Share button must be a real button (not a link) wired to
// open the in-app share dialog, so clicking it can never navigate the viewer away from the report.
// These tests assert the rendered control's wiring directly.
describe("MissionDetailPage Share control", () => {
  function renderShareButton(onShareReport: () => void) {
    const noop = () => {};
    const page = MissionDetailPage({
      actionState: { status: "idle" },
      canTransact: false,
      detail: { mission: combatMission(), battleReport: battleReport(), defenderPlanetState: null },
      error: undefined,
      fleetVisibility: visibilityFor(combatMission()),
      loading: false,
      missionId: "1",
      now: 1_770_001_000_000,
      onBack: noop,
      onCompleteReturn: noop,
      onShareReport,
      onCounterplay: noop,
      onRecall: noop,
      onResolve: noop,
      onRetry: noop,
      onSelectCoordinates: noop,
      onSelectPlayer: noop,
    });
    const buttons = findElements(page, "button");
    // The share control is the only button carrying the "Share battle report" accessible label.
    return buttons.find((button) => String(button.props?.title ?? "") === "Share battle report");
  }

  test("renders the share control as a button (never an anchor) so clicking it cannot navigate", () => {
    const shareButton = renderShareButton(() => {});
    expect(shareButton).toBeDefined();
    expect(shareButton?.type).toBe("button");
    expect(shareButton?.props?.type).toBe("button");
    // A bare onClick handler with no href means there is no navigation target at all.
    expect(shareButton?.props?.href).toBeUndefined();
  });

  test("opens the share dialog (and suppresses default/propagation) when clicked", () => {
    let shared = 0;
    let prevented = 0;
    let stopped = 0;
    const shareButton = renderShareButton(() => {
      shared += 1;
    });
    const onClick = shareButton?.props?.onClick as ((event: unknown) => void) | undefined;
    onClick?.({ preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
    expect(shared).toBe(1);
    // Hardened against any ancestor navigation handler (the QA symptom was dropping to the overview).
    expect(prevented).toBe(1);
    expect(stopped).toBe(1);
  });

  test("labels the control as Share battle report", () => {
    expect(String(renderShareButton(() => {})?.props?.title)).toBe("Share battle report");
    expect(String(renderShareButton(() => {})?.props?.["aria-label"])).toBe("Share battle report");
  });
});

type FoundElement = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function findElements(node: unknown, tag: string): FoundElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, tag));
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) return [];
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    return findElements(render({ ...(vnode.props ?? {}) }), tag);
  }
  const self = vnode.type === tag ? [vnode] : [];
  return self.concat(findElements(vnode.props?.children, tag));
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
    return textParts((vnode.type as (props: unknown) => ComponentChildren)(vnode.props));
  }
  if ((vnode.props as { hidden?: boolean } | undefined)?.hidden) {
    return [];
  }
  return textParts(vnode.props?.children as ComponentChildren);
}
