import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RAID_TARGET_FILTERS,
  DEFAULT_RAID_TARGET_SORT,
  buildRaidTargets,
  filterRaidTargets,
  floatActiveMissionTargetsFirst,
  inboundFleetsByTarget,
  incomingThreats,
  prepareRaidTargets,
  raidTargetTotals,
  sortRaidTargets,
  type RaidTarget,
} from "./raidTargetFinder";
import type {
  FleetMissionSummary,
  FleetMissionVisibilityResponse,
  HighscoreEntry,
  HighscorePlanet,
} from "./walletFlow";
import type { Coordinates } from "./types";

const ORIGIN: Coordinates = { galaxy: 1, system: 1, position: 1 };

function planet(overrides: Partial<HighscorePlanet> & { planetId: string }): HighscorePlanet {
  return {
    name: null,
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    tactical: {
      raidableResources: { metal: "1000", crystal: "500", deuterium: "100" },
      raidableResourceTotal: "1600",
      ships: { count: 2, power: "300" },
      defenses: { count: 1, power: "200" },
      combatPower: "500",
    },
    ...overrides,
  };
}

function entry(overrides: Partial<HighscoreEntry> & { wallet: string }): HighscoreEntry {
  return {
    rank: 1,
    alliance: null,
    attackProtection: { allowed: true, blockedReason: "none", blockedReasonLabel: null },
    displayName: null,
    homePlanetId: null,
    homePlanet: null,
    planets: [],
    planetCount: 0,
    score: {
      total: "0",
      economy: "0",
      research: "0",
      researchLevels: "0",
      military: "0",
      fleet: "0",
      fleetCount: "0",
      defense: "0",
    },
    ...overrides,
  };
}

function mission(overrides: Partial<FleetMissionSummary> & { missionId: string }): FleetMissionSummary {
  return {
    status: "Outbound",
    missionType: "Attack",
    owner: "0xattacker",
    originPlanetId: "1",
    targetPlanetId: "9",
    arrivalAt: "1000",
    returnAt: "2000",
    fuelCost: "0",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {},
    transactionHash: "0x",
    blockNumber: "1",
    ...overrides,
  };
}

function visibility(overrides: Partial<FleetMissionVisibilityResponse> = {}): FleetMissionVisibilityResponse {
  return {
    wallet: "0xme",
    homePlanetId: null,
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
    ...overrides,
  };
}

describe("buildRaidTargets", () => {
  test("flattens every occupied planet across players", () => {
    const targets = buildRaidTargets({
      entries: [
        entry({ wallet: "0xa", planets: [planet({ planetId: "1" }), planet({ planetId: "2" })] }),
        entry({ wallet: "0xb", planets: [planet({ planetId: "3" })] }),
      ],
      origin: ORIGIN,
    });
    expect(targets.map((target) => target.planetId)).toEqual(["1", "2", "3"]);
  });

  test("excludes the viewer's own planets case-insensitively", () => {
    const targets = buildRaidTargets({
      entries: [
        entry({ wallet: "0xAbC", planets: [planet({ planetId: "mine" })] }),
        entry({ wallet: "0xb", planets: [planet({ planetId: "theirs" })] }),
      ],
      currentWallet: "0xabc",
      origin: ORIGIN,
    });
    expect(targets.map((target) => target.planetId)).toEqual(["theirs"]);
  });

  test("falls back to home planet when no planets array is present", () => {
    const targets = buildRaidTargets({
      entries: [
        entry({ wallet: "0xa", planets: [], homePlanet: planet({ planetId: "home" }) }),
      ],
      origin: ORIGIN,
    });
    expect(targets.map((target) => target.planetId)).toEqual(["home"]);
  });

  test("computes loot, combat, defense and distance from tactical intel", () => {
    const target = buildRaidTargets({
      entries: [entry({ wallet: "0xa", planets: [planet({ planetId: "1", coordinates: { galaxy: 1, system: 1, position: 5 } })] })],
      origin: ORIGIN,
    })[0]!;
    expect(target.loot).toBe(1600);
    expect(target.combatPower).toBe(500);
    expect(target.shipPower).toBe(300);
    expect(target.defensePower).toBe(200);
    expect(target.distance).toBeGreaterThan(0);
  });

  test("distance is null when there is no origin", () => {
    const target = buildRaidTargets({
      entries: [entry({ wallet: "0xa", planets: [planet({ planetId: "1" })] })],
    })[0]!;
    expect(target.distance).toBeNull();
  });

  test("classifies score protection and same-alliance relationships", () => {
    const targets = buildRaidTargets({
      entries: [
        entry({
          wallet: "0xprotected",
          planets: [planet({ planetId: "p" })],
          attackProtection: { allowed: false, blockedReason: "score_protection", blockedReasonLabel: "Too strong" },
        }),
        entry({
          wallet: "0xally",
          planets: [planet({ planetId: "a" })],
          attackProtection: { allowed: false, blockedReason: "same_alliance", blockedReasonLabel: "Ally" },
        }),
        entry({
          wallet: "0xopen",
          planets: [planet({ planetId: "o" })],
        }),
      ],
    });
    const [protectedTarget, ally, open] = targets as [RaidTarget, RaidTarget, RaidTarget];
    expect(protectedTarget.protection.isProtected).toBe(true);
    expect(protectedTarget.protection.isSameAlliance).toBe(false);
    expect(ally.protection.isSameAlliance).toBe(true);
    expect(ally.protection.isProtected).toBe(false);
    expect(open.protection.isProtected).toBe(false);
    expect(open.protection.isSameAlliance).toBe(false);
  });

  test("marks targets with the viewer's inbound fleets", () => {
    const target = buildRaidTargets({
      entries: [entry({ wallet: "0xa", planets: [planet({ planetId: "9" })] })],
      fleetVisibility: visibility({
        outgoing: [mission({ missionId: "m1", targetPlanetId: "9", arrivalAt: "1500" })],
        joinableAttacks: [mission({ missionId: "m2", targetPlanetId: "9", arrivalAt: "1200" })],
      }),
    })[0]!;
    expect(target.inbound.count).toBe(2);
    expect(target.inbound.nextArrivalAtMs).toBe(1200 * 1000);
  });
});

describe("inboundFleetsByTarget", () => {
  test("only groups outbound attack-type fleets", () => {
    const grouped = inboundFleetsByTarget(
      visibility({
        outgoing: [
          mission({ missionId: "attack", targetPlanetId: "9", missionType: "Attack" }),
          mission({ missionId: "transport", targetPlanetId: "9", missionType: "Transport" }),
          mission({ missionId: "returning", targetPlanetId: "9", status: "Returning" }),
        ],
        joinableAttacks: [mission({ missionId: "acs", targetPlanetId: "9", missionType: "AcsAttack" })],
      }),
    );
    expect(grouped.get("9")?.map((m) => m.missionId).sort()).toEqual(["acs", "attack"]);
  });

  test("returns an empty map for missing visibility", () => {
    expect(inboundFleetsByTarget(undefined).size).toBe(0);
  });
});

describe("filterRaidTargets", () => {
  const targets = buildRaidTargets({
    entries: [
      entry({ wallet: "0xprotected", planets: [planet({ planetId: "p" })], attackProtection: { allowed: false, blockedReason: "score_protection", blockedReasonLabel: null } }),
      entry({ wallet: "0xally", planets: [planet({ planetId: "a" })], attackProtection: { allowed: false, blockedReason: "same_alliance", blockedReasonLabel: null } }),
      entry({ wallet: "0xrich", planets: [planet({ planetId: "rich", tactical: { raidableResources: { metal: "0", crystal: "0", deuterium: "0" }, raidableResourceTotal: "9000", ships: { count: 0, power: "0" }, defenses: { count: 0, power: "0" }, combatPower: "0" } })] }),
      entry({ wallet: "0xdefended", planets: [planet({ planetId: "def", tactical: { raidableResources: { metal: "0", crystal: "0", deuterium: "0" }, raidableResourceTotal: "10", ships: { count: 0, power: "0" }, defenses: { count: 5, power: "5000" }, combatPower: "5000" } })] }),
    ],
    origin: ORIGIN,
  });

  test("default filters hide protected and same-alliance targets", () => {
    const visible = filterRaidTargets(targets, DEFAULT_RAID_TARGET_FILTERS);
    const ids = visible.map((target) => target.planetId).sort();
    expect(ids).toEqual(["def", "rich"]);
  });

  test("hideDefended removes targets with any defense power", () => {
    const visible = filterRaidTargets(targets, { ...DEFAULT_RAID_TARGET_FILTERS, hideDefended: true });
    expect(visible.map((target) => target.planetId)).toEqual(["rich"]);
  });

  test("minLoot threshold excludes low-value targets", () => {
    const visible = filterRaidTargets(targets, { ...DEFAULT_RAID_TARGET_FILTERS, minLoot: 1000 });
    expect(visible.map((target) => target.planetId)).toEqual(["rich"]);
  });

  test("showing protected targets includes everything", () => {
    const visible = filterRaidTargets(targets, {
      ...DEFAULT_RAID_TARGET_FILTERS,
      hideProtected: false,
      hideSameAlliance: false,
    });
    expect(visible).toHaveLength(4);
  });

  test("maxDistance excludes far targets but keeps unknown-distance ones", () => {
    const base = targets[0]!;
    const withDistances: RaidTarget[] = [
      { ...base, planetId: "near", distance: 100 },
      { ...base, planetId: "far", distance: 50_000 },
      { ...base, planetId: "unknown", distance: null },
    ];
    const visible = filterRaidTargets(withDistances, {
      ...DEFAULT_RAID_TARGET_FILTERS,
      hideProtected: false,
      hideSameAlliance: false,
      maxDistance: 1_000,
    });
    expect(visible.map((target) => target.planetId).sort()).toEqual(["near", "unknown"]);
  });
});

describe("sortRaidTargets", () => {
  function targetWith(partial: Partial<RaidTarget> & { planetId: string }): RaidTarget {
    return {
      name: null,
      coordinates: { galaxy: 1, system: 1, position: 1 },
      archetype: "temperate-ocean",
      owner: "0xa",
      ownerDisplayName: null,
      alliance: null,
      distance: 0,
      loot: 0,
      raidableResources: null,
      combatPower: 0,
      shipPower: 0,
      shipCount: 0,
      defensePower: 0,
      defenseCount: 0,
      protection: { isProtected: false, isSameAlliance: false, blockedReason: "none", blockedReasonLabel: null },
      inbound: { count: 0, nextArrivalAtMs: null },
      ...partial,
    };
  }

  test("loot descending is the default order", () => {
    const sorted = sortRaidTargets(
      [targetWith({ planetId: "low", loot: 10 }), targetWith({ planetId: "high", loot: 100 })],
      DEFAULT_RAID_TARGET_SORT,
    );
    expect(sorted.map((target) => target.planetId)).toEqual(["high", "low"]);
  });

  test("distance ascending puts the closest target first", () => {
    const sorted = sortRaidTargets(
      [targetWith({ planetId: "far", distance: 500 }), targetWith({ planetId: "near", distance: 50 })],
      { key: "distance", direction: "asc" },
    );
    expect(sorted.map((target) => target.planetId)).toEqual(["near", "far"]);
  });

  test("unknown distance always sinks to the bottom regardless of direction", () => {
    const ascending = sortRaidTargets(
      [targetWith({ planetId: "unknown", distance: null }), targetWith({ planetId: "near", distance: 50 })],
      { key: "distance", direction: "asc" },
    );
    expect(ascending.map((target) => target.planetId)).toEqual(["near", "unknown"]);

    const descending = sortRaidTargets(
      [targetWith({ planetId: "unknown", distance: null }), targetWith({ planetId: "near", distance: 50 })],
      { key: "distance", direction: "desc" },
    );
    expect(descending.map((target) => target.planetId)).toEqual(["near", "unknown"]);
  });

  test("does not mutate the input array", () => {
    const input = [targetWith({ planetId: "a", loot: 1 }), targetWith({ planetId: "b", loot: 2 })];
    const snapshot = input.map((target) => target.planetId);
    sortRaidTargets(input, DEFAULT_RAID_TARGET_SORT);
    expect(input.map((target) => target.planetId)).toEqual(snapshot);
  });
});

describe("prepareRaidTargets", () => {
  test("filters then sorts in one pass", () => {
    const result = prepareRaidTargets({
      entries: [
        entry({ wallet: "0xa", planets: [planet({ planetId: "rich", tactical: { raidableResources: { metal: "0", crystal: "0", deuterium: "0" }, raidableResourceTotal: "5000", ships: { count: 0, power: "0" }, defenses: { count: 0, power: "0" }, combatPower: "0" } })] }),
        entry({ wallet: "0xb", planets: [planet({ planetId: "poor", tactical: { raidableResources: { metal: "0", crystal: "0", deuterium: "0" }, raidableResourceTotal: "50", ships: { count: 0, power: "0" }, defenses: { count: 0, power: "0" }, combatPower: "0" } })] }),
        entry({ wallet: "0xprotected", planets: [planet({ planetId: "blocked" })], attackProtection: { allowed: false, blockedReason: "score_protection", blockedReasonLabel: null } }),
      ],
      origin: ORIGIN,
      filters: DEFAULT_RAID_TARGET_FILTERS,
      sort: DEFAULT_RAID_TARGET_SORT,
    });
    expect(result.map((target) => target.planetId)).toEqual(["rich", "poor"]);
  });
});

describe("raidTargetTotals", () => {
  test("counts protected and same-alliance targets in the full set", () => {
    const all = buildRaidTargets({
      entries: [
        entry({ wallet: "0xa", planets: [planet({ planetId: "1" })] }),
        entry({ wallet: "0xprotected", planets: [planet({ planetId: "2" })], attackProtection: { allowed: false, blockedReason: "score_protection", blockedReasonLabel: null } }),
        entry({ wallet: "0xally", planets: [planet({ planetId: "3" })], attackProtection: { allowed: false, blockedReason: "same_alliance", blockedReasonLabel: null } }),
      ],
    });
    const visible = filterRaidTargets(all, DEFAULT_RAID_TARGET_FILTERS);
    const totals = raidTargetTotals(all, visible);
    expect(totals).toEqual({ total: 3, visible: 1, protected: 1, sameAlliance: 1 });
  });
});

describe("incomingThreats", () => {
  test("lists hostile inbound fleets sorted by soonest arrival", () => {
    const threats = incomingThreats(
      visibility({
        incoming: [
          mission({ missionId: "late", arrivalAt: "3000", originPlanet: { planetId: "1", owner: "0xx", name: null, galaxy: 2, system: 2, position: 2, coordinates: "[2:2:2]" }, targetPlanet: { planetId: "9", owner: "0xme", name: null, galaxy: 1, system: 1, position: 1, coordinates: "[1:1:1]" } }),
          mission({ missionId: "soon", arrivalAt: "1000", originPlanet: { planetId: "3", owner: "0xy", name: null, galaxy: 3, system: 3, position: 3, coordinates: "[3:3:3]" } }),
        ],
      }),
    );
    expect(threats.map((threat) => threat.missionId)).toEqual(["soon", "late"]);
    expect(threats[0]!.arrivalAtMs).toBe(1000 * 1000);
    expect(threats[1]!.originCoordinates).toBe("[2:2:2]");
  });

  test("ignores non-outbound incoming entries and missing visibility", () => {
    expect(incomingThreats(undefined)).toEqual([]);
    const threats = incomingThreats(visibility({ incoming: [mission({ missionId: "done", status: "Resolved" })] }));
    expect(threats).toEqual([]);
  });
});

describe("floatActiveMissionTargetsFirst", () => {
  const targets = buildRaidTargets({
    entries: [
      entry({ wallet: "0xa", planets: [planet({ planetId: "1" })] }),
      entry({ wallet: "0xb", planets: [planet({ planetId: "2" })] }),
      entry({ wallet: "0xc", planets: [planet({ planetId: "3" })] }),
    ],
  });

  test("floats targets with active fleet activity to the top, preserving order within each group", () => {
    const { ordered, activeCount } = floatActiveMissionTargetsFirst(
      targets,
      (target) => target.planetId === "3",
    );
    expect(ordered.map((target) => target.planetId)).toEqual(["3", "1", "2"]);
    expect(activeCount).toBe(1);
  });

  test("keeps the original order and reports zero when nothing is active", () => {
    const { ordered, activeCount } = floatActiveMissionTargetsFirst(targets, () => false);
    expect(ordered.map((target) => target.planetId)).toEqual(["1", "2", "3"]);
    expect(activeCount).toBe(0);
  });

  test("does not drop or duplicate targets when several are active", () => {
    const { ordered, activeCount } = floatActiveMissionTargetsFirst(
      targets,
      (target) => target.planetId !== "1",
    );
    expect(ordered.map((target) => target.planetId)).toEqual(["2", "3", "1"]);
    expect(activeCount).toBe(2);
  });
});
