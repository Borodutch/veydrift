import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RAID_TARGET_FILTERS,
  DEFAULT_RAID_TARGET_SORT,
  buildRaidTargets,
  buildDebrisTargets,
  filterRaidTargets,
  hasActiveAlliance,
  inboundFleetsByTarget,
  incomingThreats,
  normalizeRaidTargetFilters,
  normalizeRaidTargetSort,
  prepareRaidTargets,
  raidTargetTotals,
  sortDebrisTargets,
  sortRaidTargets,
  type DebrisFinderTarget,
  type RaidTarget,
} from "./raidTargetFinder";
import type {
  ChainShipyardState,
  DebrisTargetResponse,
  FleetMissionSummary,
  FleetMissionVisibilityResponse,
  HighscoreEntry,
  HighscorePlanet,
} from "./walletFlow";
import type { Coordinates } from "./types";

const ORIGIN: Coordinates = { galaxy: 1, system: 1, position: 1 };

describe("persisted raid target settings", () => {
  test("normalizes saved filters and keeps them scoped to the known Raid Finder shape", () => {
    const filters = normalizeRaidTargetFilters({
      hideProtected: false,
      hideSameAlliance: false,
      hideDefended: true,
      hideActiveFleet: true,
      minLoot: 1234.9,
      maxDistance: 987.6,
      unrelated: "ignored",
    });

    expect(filters).toEqual({
      hideProtected: false,
      hideSameAlliance: false,
      hideDefended: true,
      hideActiveFleet: true,
      minLoot: 1234,
      maxDistance: 987,
    });
  });

  test("falls back safely for corrupt persisted filters", () => {
    expect(normalizeRaidTargetFilters({ minLoot: -10, maxDistance: Number.NaN })).toEqual({
      ...DEFAULT_RAID_TARGET_FILTERS,
      minLoot: 0,
    });
    expect(normalizeRaidTargetFilters("bad")).toEqual(DEFAULT_RAID_TARGET_FILTERS);
  });

  test("normalizes saved sort preferences and falls back safely for corrupt values", () => {
    expect(normalizeRaidTargetSort({ key: "distance", direction: "asc", unrelated: true })).toEqual({
      key: "distance",
      direction: "asc",
    });
    expect(normalizeRaidTargetSort({ key: "owner", direction: "sideways" })).toEqual(DEFAULT_RAID_TARGET_SORT);
    expect(normalizeRaidTargetSort("bad")).toEqual(DEFAULT_RAID_TARGET_SORT);
  });

  test("detects whether the viewer has an active alliance for control visibility", () => {
    expect(hasActiveAlliance(undefined)).toBe(false);
    expect(hasActiveAlliance(null)).toBe(false);
    expect(hasActiveAlliance("0")).toBe(false);
    expect(hasActiveAlliance("7")).toBe(true);
  });
});

function planet(overrides: Partial<HighscorePlanet> & { planetId: string }): HighscorePlanet {
  return {
    name: null,
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    tactical: {
      raidableResources: { metal: "1000", crystal: "500", deuterium: "100" },
      raidableResourceTotal: "1600",
      grossResourceTotal: "3200",
      ships: { count: 2, power: "300" },
      defenses: { count: 1, power: "200" },
      combatShips: { count: 1, power: "200", units: [{ id: 1, count: 1, power: "4000" }] },
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

  test("computes loot, combat, defense, unit breakdowns, and distance from tactical intel", () => {
    const target = buildRaidTargets({
      entries: [entry({ wallet: "0xa", planets: [planet({
        planetId: "1",
        coordinates: { galaxy: 1, system: 1, position: 5 },
        hasMoon: true,
        moon: {
          exists: true,
          resources: { metal: "7000", crystal: "2000", deuterium: "1000" },
          resourcesAsOfNow: { metal: "7386", crystal: "2472", deuterium: "1335" },
        },
        tactical: {
          raidableResources: { metal: "1000", crystal: "500", deuterium: "100" },
          raidableResourceTotal: "1600",
          currentResources: { metal: "2200", crystal: "900", deuterium: "300" },
          grossResourceTotal: "3200",
          productionPerHour: { metal: "120", crystal: "60", deuterium: "24" },
          storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
          ships: { count: 2, power: "6500", units: [{ id: 1, count: 1, power: "4000" }, { id: 9, count: 1, power: "2500" }] },
          defenses: { count: 1, power: "2000", units: [{ id: 0, count: 1, power: "2000" }] },
          combatShips: { count: 1, power: "4000", units: [{ id: 1, count: 1, power: "4000" }] },
          combatPower: "6000",
        },
      })] })],
      origin: ORIGIN,
    })[0]!;
    expect(target.loot).toBe(1600);
    // LOOT is the ~50% plunder of the planet's full accrued public resources (VEY-KANEO-454).
    expect(target.grossLoot).toBe(3200);
    expect(target.currentResources).toEqual({ metal: "2200", crystal: "900", deuterium: "300" });
    expect(target.moonResources).toEqual({ metal: "7386", crystal: "2472", deuterium: "1335" });
    expect(target.productionPerHour).toEqual({ metal: "120", crystal: "60", deuterium: "24" });
    expect(target.storageCaps).toEqual({ metal: "10000", crystal: "10000", deuterium: "10000" });
    expect(target.combatPower).toBe(6000);
    expect(target.shipPower).toBe(6500);
    expect(target.defensePower).toBe(2000);
    expect(target.shipUnits.map((unit) => unit.id)).toEqual([1, 9]);
    expect(target.combatShipUnits.map((unit) => unit.id)).toEqual([1]);
    expect(target.defenseUnits).toEqual([{ id: 0, count: 1, power: 2000 }]);
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
          attackProtection: {
            allowed: false,
            blockedReason: "score_protection",
            blockedReasonLabel: "Too strong",
            scoreComparison: {
              scoreType: "contract_total_user_score",
              attackerScore: "25437",
              defenderScore: "7340",
              attackerVisibleScore: "7539",
              defenderVisibleScore: "278",
              protected: false,
            },
          },
        }),
        entry({
          wallet: "0xally",
          planets: [planet({ planetId: "a" })],
          attackProtection: { allowed: false, blockedReason: "same_alliance", blockedReasonLabel: "Ally" },
        }),
        entry({
          wallet: "0xopen",
          planets: [planet({ planetId: "o" })],
          attackProtection: { allowed: true, blockedReason: "none", blockedReasonLabel: null, defenderInactive: true },
        }),
      ],
    });
    const [protectedTarget, ally, open] = targets as [RaidTarget, RaidTarget, RaidTarget];
    expect(protectedTarget.protection.isProtected).toBe(true);
    expect(protectedTarget.protection.isSameAlliance).toBe(false);
    expect(protectedTarget.protection.scoreComparison).toEqual({ attackerScore: "25437", defenderScore: "7340" });
    expect(ally.protection.isSameAlliance).toBe(true);
    expect(ally.protection.isProtected).toBe(false);
    expect(open.protection.isProtected).toBe(false);
    expect(open.protection.isSameAlliance).toBe(false);
    expect(open.protection.defenderInactive).toBe(true);
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
      entry({ wallet: "0xcombatfleet", planets: [planet({ planetId: "fleet", tactical: { raidableResources: { metal: "0", crystal: "0", deuterium: "0" }, raidableResourceTotal: "20", ships: { count: 1, power: "4000" }, defenses: { count: 0, power: "0" }, combatShips: { count: 1, power: "4000", units: [{ id: 1, count: 1, power: "4000" }] }, combatPower: "4000" } })] }),
    ],
    origin: ORIGIN,
  });

  test("default filters hide protected and same-alliance targets", () => {
    const visible = filterRaidTargets(targets, DEFAULT_RAID_TARGET_FILTERS);
    const ids = visible.map((target) => target.planetId).sort();
    expect(ids).toEqual(["def", "fleet", "rich"]);
  });

  test("hideDefended removes targets with any displayed combat threat", () => {
    const visible = filterRaidTargets(targets, { ...DEFAULT_RAID_TARGET_FILTERS, hideDefended: true });
    expect(visible.map((target) => target.planetId)).toEqual(["rich"]);
  });

  test("hideActiveFleet removes targets with active mission subtext without changing the remaining sort order", () => {
    const visible = sortRaidTargets(
      filterRaidTargets(targets, { ...DEFAULT_RAID_TARGET_FILTERS, hideActiveFleet: true }, {
        hasActiveFleetActivity: (target) => target.planetId === "fleet",
      }),
      DEFAULT_RAID_TARGET_SORT,
    );
    expect(visible.map((target) => target.planetId)).toEqual(["rich", "def"]);
  });

  test("hideActiveFleet removes targets that already have fleets inbound", () => {
    const visible = filterRaidTargets(
      [
        { ...targets[2]!, planetId: "already-inbound", inbound: { count: 1, nextArrivalAtMs: 1_200_000 } },
        { ...targets[2]!, planetId: "open", inbound: { count: 0, nextArrivalAtMs: null } },
      ],
      { ...DEFAULT_RAID_TARGET_FILTERS, hideActiveFleet: true },
    );

    expect(visible.map((target) => target.planetId)).toEqual(["open"]);
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
    expect(visible).toHaveLength(5);
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
      hasMoon: false,
      moonResources: null,
      distance: 0,
      loot: 0,
      grossLoot: 0,
      currentResources: null,
      raidableResources: null,
      productionPerHour: null,
      storageCaps: null,
      combatPower: 0,
      combatTechLevels: null,
      shipPower: 0,
      shipCount: 0,
      defensePower: 0,
      defenseCount: 0,
      shipUnits: [],
      combatShipUnits: [],
      defenseUnits: [],
      protection: {
        isProtected: false,
        isSameAlliance: false,
        isAtWar: false,
        blockedReason: "none",
        blockedReasonLabel: null,
        scoreComparison: null,
        defenderInactive: false,
      },
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

function debrisTarget(overrides: Partial<DebrisTargetResponse> = {}): DebrisTargetResponse {
  return {
    planetId: "7",
    name: "Scrap Yard",
    owner: "0xabc",
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    debris: { metal: "40000", crystal: "10000" },
    updatedAtBlock: "123",
    transactionHash: "0xdeb",
    ...overrides,
  };
}

function shipyard(overrides: Partial<ChainShipyardState> = {}): ChainShipyardState {
  return {
    wallet: "0xme",
    homePlanetId: "1",
    resources: { metal: "0", crystal: "0", deuterium: "1000000" },
    fleetSlots: { active: 0, limit: 2 },
    shipyardLevel: 2,
    naniteLevel: 0,
    technologyLevels: {},
    ships: [{ id: 2, count: 3, cost: { metal: "10000", crystal: "6000", deuterium: "2000" } }],
    queue: null,
    ...overrides,
  };
}

describe("debris target finder", () => {
  test("builds debris-only rows with distance, recycler need, ETA, fuel, and zero-debris filtering", () => {
    const rows = buildDebrisTargets({
      targets: [
        debrisTarget({ planetId: "rich", debris: { metal: "40000", crystal: "10000" } }),
        debrisTarget({ planetId: "empty", debris: { metal: "0", crystal: "0" } }),
      ],
      origin: ORIGIN,
      shipyardState: shipyard(),
    });

    expect(rows.map((row) => row.planetId)).toEqual(["rich"]);
    expect(rows[0]).toMatchObject({
      metal: 40000,
      crystal: 10000,
      total: 50000,
      recyclersNeeded: 3,
      recyclerCapacity: 60000,
      harvestDisabledReason: null,
    });
    expect(rows[0]!.distance).toBeGreaterThan(0);
    expect(rows[0]!.etaSeconds).toBeGreaterThan(0);
    expect(rows[0]!.fuelCost).toBeGreaterThan(0);
  });

  test("surfaces recycler, fleet-slot, and fuel blockers for debris harvest rows", () => {
    expect(buildDebrisTargets({
      targets: [debrisTarget()],
      origin: ORIGIN,
      shipyardState: shipyard({ ships: [] }),
    })[0]!.harvestDisabledReason).toBe("Requires a recycler on your active planet.");

    expect(buildDebrisTargets({
      targets: [debrisTarget()],
      origin: ORIGIN,
      shipyardState: shipyard({ fleetSlots: { active: 1, limit: 1 } }),
    })[0]!.harvestDisabledReason).toBe("Fleet slots full (1/1).");

    expect(buildDebrisTargets({
      targets: [debrisTarget()],
      origin: ORIGIN,
      shipyardState: shipyard({
        fleetLaunchAvailable: false,
        fleetLaunchUnavailableReason: "Fleet slot state is waiting for mission settlement.",
      }),
    })[0]!.harvestDisabledReason).toBe("Fleet slot state is waiting for mission settlement.");

    expect(buildDebrisTargets({
      targets: [debrisTarget()],
      origin: ORIGIN,
      shipyardState: shipyard({ resources: { metal: "0", crystal: "0", deuterium: "0" } }),
    })[0]!.harvestDisabledReason).toContain("deuterium");
  });

  test("sorts debris targets by total by default and keeps unknown distance last", () => {
    const base: DebrisFinderTarget = {
      planetId: "base",
      name: null,
      coordinates: { galaxy: 1, system: 1, position: 1 },
      archetype: "temperate-ocean",
      owner: "0xa",
      hasMoon: false,
      metal: 0,
      crystal: 0,
      total: 0,
      distance: 0,
      etaSeconds: 0,
      fuelCost: 0,
      recyclersNeeded: 0,
      recyclerCapacity: 0,
      harvestDisabledReason: null,
    };
    expect(sortDebrisTargets([
      { ...base, planetId: "low", total: 10 },
      { ...base, planetId: "high", total: 100 },
    ], { key: "total", direction: "desc" }).map((row) => row.planetId)).toEqual(["high", "low"]);
    expect(sortDebrisTargets([
      { ...base, planetId: "unknown", distance: null },
      { ...base, planetId: "near", distance: 10 },
    ], { key: "distance", direction: "asc" }).map((row) => row.planetId)).toEqual(["near", "unknown"]);
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
