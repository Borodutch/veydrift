import { describe, expect, test } from "bun:test";
import { prepareMissionBattleForecast } from "./components/MissionBattleForecastPanel";
import { preparePublicTargetBattleForecast, resolveVerifiedPublicTargetBattleForecast } from "./components/MissionCreationPage";
import { emptyMissionShips } from "./galaxyActions";
import type { MissionDetailResponse, MissionBattleForecast } from "./walletFlow";

const now = 1_790_000_000_000;
const tech = { weapons: 2, shielding: 3, armor: 4 };
function preview(): MissionBattleForecast {
  return { leaderMissionId: "94880", arrivalAt: String(now / 1000 + 600), asOf: String(now / 1000), targetIsMoon: false,
    participants: [{ missionId: "94880", label: "Lead", owner: "0xabc", laneGroup: 0, ships: { cruiser: "3" }, combatTechnology: tech }],
    stationedDefenders: [],
    target: { id: "812", name: "Target", owner: "0xdef", publicState: { fleet: [{ id: 1, count: 2 }], defenses: [], research: [], stationedDefenderForecastTimeline: [], stationedDefenderTimelineComplete: true } },
  };
}
function detail(battleForecast = preview()): MissionDetailResponse {
  return { mission: { missionId: "94880", status: "Outbound", missionType: "Attack", owner: "0xabc", originPlanetId: "1", targetPlanetId: "812", arrivalAt: battleForecast.arrivalAt, returnAt: "1790001200", fuelCost: "0", recallCost: null, attackGroupId: null, joinedAttackMissionIds: [], ships: { cruiser: "3" }, cargo: { metal: "0", crystal: "0", deuterium: "0" }, transactionHash: "0x1", blockNumber: "1" }, battleReport: null, battleForecast };
}
function input(value: MissionDetailResponse) {
  const prepared = prepareMissionBattleForecast(value, now);
  expect(prepared?.status).toBe("simulate");
  if (prepared?.status !== "simulate") throw new Error("Expected complete forecast inputs");
  return prepared.input;
}
function uncertain(value: MissionDetailResponse, time = now) {
  const prepared = prepareMissionBattleForecast(value, time);
  expect(prepared?.status).toBe("complete");
  if (prepared?.status !== "complete") throw new Error("Expected uncertainty");
  expect(prepared.forecast.kind).toBe("uncertain");
  return prepared.forecast.detail;
}

describe("en-route whole-battle forecast", () => {
  test("solo input matches launch composition and tech without an invented joining fleet", () => {
    const value = detail();
    const forecast = input(value);
    const launch = preparePublicTargetBattleForecast({ ...emptyMissionShips(), cruiser: 3 }, { ...value.battleForecast!.target!, occupiedBy: null }, tech, false, undefined, { projectedAttackArrivalAt: now / 1000 + 600 });
    if (launch.status !== "simulate") throw new Error("Expected launch inputs");
    expect(forecast.attackers).toHaveLength(1);
    expect(forecast.attackers[0]?.ships).toEqual(launch.input.attackers[0]?.ships);
    expect(forecast.attackers[0]?.technology).toEqual(tech);
    expect(forecast.defender).toEqual(launch.input.defender);
  });
  test("leader and joined member use the same complete roster, updated on join and recall", () => {
    const value = detail();
    const p = value.battleForecast!;
    p.participants.push({ missionId: "94881", label: "Shalex", owner: "0xaaa", laneGroup: 2, ships: { reaper: "4" }, combatTechnology: { weapons: 9, shielding: 8, armor: 7 } });
    const leader = input(value);
    expect(leader.attackers.map(p => p.id)).toEqual(["94880", "94881"]);
    const member = { ...value, mission: { ...value.mission, missionId: "94881", missionType: "AcsAttack" as const, attackGroupId: "94880" } };
    expect(input(member)).toEqual(leader);
    p.participants.push({ ...p.participants[1]!, missionId: "94911", laneGroup: 3 });
    expect(input(member).attackers).toHaveLength(3);
    p.participants.splice(1, 1);
    expect(input(value).attackers.map(p => p.id)).toEqual(["94880", "94911"]);
  });
  test("eligible supporting defenders keep their own tech and never duplicate target inventory", () => {
    const value = detail();
    value.battleForecast!.stationedDefenders.push({ missionId: "20", defender: "0xaaa", defenderDisplayName: "Ally", ships: { reaper: "5" }, laneGroup: 1, combatTechnology: tech, arrivalAt: "1790000000", holdUntil: "1790000800", battleWindowComplete: true, allianceDepotLevel: 1 });
    const forecast = input(value);
    expect(forecast.defender.ships.reduce((a, b) => a + b, 0)).toBe(2);
    expect(forecast.defender.counterplay).toHaveLength(1);
    expect(forecast.defender.counterplay[0]?.technology).toEqual(tech);
    value.battleForecast!.stationedDefenders = [];
    expect(input(value).defender.counterplay).toHaveLength(0);
  });
  test("moon battle uses moon inventory and its explicitly qualified support, never parent units", () => {
    const value = detail();
    value.battleForecast!.targetIsMoon = true;
    value.battleForecast!.target!.publicMoonState = { fleet: [{ id: 2, count: 1 }], defenses: [] };
    value.battleForecast!.stationedDefenders = [{ missionId: "21", defender: "0xaaa", defenderDisplayName: null, ships: { cruiser: "3" }, combatTechnology: tech, laneGroup: 1, holdUntil: "1790000800", allianceDepotLevel: 0 }];
    const forecast = input(value);
    expect(forecast.defender.id).toBe("moon-812");
    expect(forecast.defender.ships.reduce((a, b) => a + b, 0)).toBe(1);
    expect(forecast.defender.counterplay).toHaveLength(1);
  });
  test("missing tech, public state, timing, stale or scheduled-uncredited data is uncertain", () => {
    const value = detail();
    delete value.battleForecast!.participants[0]!.combatTechnology;
    expect(uncertain(value)).toContain("technology");
    const legacy = detail(); delete legacy.battleForecast;
    expect(uncertain(legacy)).toContain("Whole-battle");
    expect(uncertain(detail(), now + 31_000)).toContain("delayed");
    const arrived = detail(); arrived.battleForecast!.arrivalAt = String(now / 1000);
    expect(uncertain(arrived)).toContain("arrival has passed");
    const pending = detail(); pending.battleForecast!.unavailableReason = "Return #90 scheduled before impact is not credited.";
    expect(uncertain(pending)).toContain("not credited");
    const missing = detail(); missing.battleForecast!.target = null;
    expect(uncertain(missing)).toContain("unavailable");
  });
  test("report, recall, returned and inactive leader suppress active preview", () => {
    for (const status of ["Returning", "Returned", "Recalled", "Destroyed"] as const) {
      const value = detail(); value.mission.status = status;
      expect(prepareMissionBattleForecast(value, now)).toBeNull();
    }
    const recalled = detail(); recalled.mission.recallProvenance = "FleetMissionRecalled";
    expect(prepareMissionBattleForecast(recalled, now)).toBeNull();
    expect(prepareMissionBattleForecast({ ...detail(), battleForecast: null }, now)).toBeNull();
    expect(prepareMissionBattleForecast({ ...detail(), battleReport: {} as NonNullable<MissionDetailResponse["battleReport"]> }, now)).toBeNull();
  });
});


test("both launch and en-route forecasts reject unverified models and previously cached odds", () => {
  const value = detail();
  const mission = prepareMissionBattleForecast(value, now)!;
  const launch = preparePublicTargetBattleForecast({ ...emptyMissionShips(), cruiser: 3 }, { ...value.battleForecast!.target!, occupiedBy: null }, tech, false, undefined, { projectedAttackArrivalAt: now / 1000 + 600 });
  for (const prepared of [mission, launch]) {
    expect(prepared.status).toBe("simulate");
    expect(resolveVerifiedPublicTargetBattleForecast(prepared, false).kind).toBe("uncertain");
    expect(resolveVerifiedPublicTargetBattleForecast(prepared, true).kind).not.toBe("uncertain");
    const downgraded = resolveVerifiedPublicTargetBattleForecast(prepared, false);
    expect(downgraded.kind).toBe("uncertain");
    expect(downgraded.sampleReport).toBeUndefined();
    expect(downgraded.reportInput).toBeUndefined();
  }
});

test("already-started historical battles are never simulated with corrected math", () => {
  const value = detail();
  value.mission.combatResolutionProgress = { roundsCompleted: 0, totalRounds: 6 };
  expect(uncertain(value)).toContain("already in progress");
});
