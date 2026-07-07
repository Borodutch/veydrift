import { describe, expect, test } from "bun:test";
import { buildMigrationPlayerStates, encodeMigrationPlayerState } from "./migrationSnapshot";
import type { Address, CanonicalPlanetChainState, MoonState, ResearchState, SettledPlanetEvent } from "./evm";

const owner = "0x1111111111111111111111111111111111111111" as Address;

describe("migration snapshot state builder", () => {
  test("cancels active planet-origin missions by returning ships, cargo, and fuel", () => {
    const states = buildMigrationPlayerStates({
      planets: [planet()],
      canonicalByPlanetId: new Map([["1", canonicalPlanet({
        resources: { metal: "100", crystal: "200", deuterium: "300" },
        ships: [{ id: 0, count: 5, cost: zeroResources() }]
      })]]),
      researchByOwner: new Map([[owner.toLowerCase(), research()]]),
      moonsByPlanetId: new Map([["1", noMoon()]]),
      missions: [{
        missionId: "7",
        status: "Outbound",
        owner,
        originPlanetId: "1",
        cargo: { metal: "11", crystal: "12", deuterium: "13" },
        fuelCost: "3",
        ships: { smallCargo: "2", recycler: "1" },
        originIsMoon: false
      }],
      cutoffUnix: 123n
    });

    const migrated = states[0]!.planets[0]!;
    expect(migrated.resources).toEqual({ metal: 111n, crystal: 212n, deuterium: 316n });
    expect(migrated.shipCounts[0]).toBe(7);
    expect(migrated.shipCounts[2]).toBe(1);
    expect(migrated.lastSettledAt).toBe(123n);
  });

  test("cancels active moon-origin missions back onto the moon", () => {
    const states = buildMigrationPlayerStates({
      planets: [planet()],
      canonicalByPlanetId: new Map([["1", canonicalPlanet({})]]),
      researchByOwner: new Map([[owner.toLowerCase(), research()]]),
      moonsByPlanetId: new Map([["1", moon()]]),
      missions: [{
        missionId: "8",
        status: "Returning",
        owner,
        originPlanetId: "1",
        cargo: { metal: "1", crystal: "1", deuterium: "1" },
        returnCargo: { metal: "5", crystal: "6", deuterium: "7" },
        fuelCost: "4",
        ships: { recycler: "2" },
        originIsMoon: true
      }],
      cutoffUnix: 123n
    });

    const migratedMoon = states[0]!.planets[0]!.moon;
    expect(migratedMoon.resources).toEqual({ metal: 15n, crystal: 26n, deuterium: 41n });
    expect(migratedMoon.shipCounts[2]).toBe(3);
  });

  test("encodes migration payloads as ABI bytes", () => {
    const state = buildMigrationPlayerStates({
      planets: [planet()],
      canonicalByPlanetId: new Map([["1", canonicalPlanet({})]]),
      researchByOwner: new Map([[owner.toLowerCase(), research()]]),
      moonsByPlanetId: new Map([["1", noMoon()]]),
      missions: [],
      cutoffUnix: 123n
    })[0]!;

    expect(encodeMigrationPlayerState(state)).toMatch(/^0x[0-9a-f]+$/);
  });
});

function planet(): SettledPlanetEvent {
  return {
    eventName: "PlanetStarted",
    transactionHash: "0x",
    blockNumber: "0",
    owner,
    planetId: "1",
    name: "New Zion",
    galaxy: 1,
    system: 2,
    position: 3,
    fields: 188,
    temperature: 32,
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000,
    lastSettledAt: "1",
    resources: zeroResources()
  };
}

function canonicalPlanet(overrides: Partial<CanonicalPlanetChainState>): CanonicalPlanetChainState {
  return {
    planetId: "1",
    resources: zeroResources(),
    buildings: [],
    defenses: [],
    ships: [],
    queues: { building: null, defense: null, ship: null },
    ...overrides
  };
}

function research(): ResearchState {
  return {
    wallet: owner,
    homePlanetId: "1",
    researchAvailable: true,
    resources: zeroResources(),
    researchLabLevel: 0,
    researchNetworkLabLevels: [],
    technologyLevels: {},
    technologies: [{ id: 0, level: 3, cost: zeroResources() }],
    queue: null
  };
}

function noMoon(): MoonState {
  return {
    wallet: owner,
    bodyKind: "moon",
    homePlanetId: "1",
    parentPlanetId: "1",
    moonAvailable: true,
    resources: zeroResources(),
    ships: [],
    defenses: [],
    moon: null,
    fleet: [],
    buildings: [],
    queue: null,
    technologyLevels: {},
    defenseQueue: null
  };
}

function moon(): MoonState {
  return {
    ...noMoon(),
    resources: { metal: "10", crystal: "20", deuterium: "30" },
    ships: [{ id: 2, count: 1, cost: zeroResources() }],
    moon: {
      exists: true,
      planetId: "1",
      owner,
      fields: 42,
      diameterKm: 8774,
      createdAt: "10",
      jumpGateReadyAt: "0"
    }
  };
}

function zeroResources() {
  return { metal: "0", crystal: "0", deuterium: "0" };
}
