import { describe, expect, test } from "bun:test";

import { batchSupplySourceForPlanet, loadWalletPlanetSyncSnapshot } from "./PlayableMvpApp";

const wallet = "0x2222222222222222222222222222222222222222";

function planet() {
  return {
    planetId: "7",
    owner: wallet,
    name: "Eos",
    galaxy: 2,
    system: 44,
    position: 9,
    fields: 163,
    temperature: 20,
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000,
    lastSettledAt: "1770000000",
    resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
    resourcesAsOfNow: { metal: "5000", crystal: "4900", deuterium: "4800" },
    coordinates: "2:44:9",
    isHomePlanet: true,
    fieldsUsed: 1,
    fieldsCapacity: 163,
    keyLevels: {
      metalMine: 1,
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
  };
}

function queues() {
  return {
    wallet,
    homePlanetId: "7",
    building: null,
    defense: null,
    ship: null,
    research: null,
  };
}

describe("loadWalletPlanetSyncSnapshot", () => {
  test("uses the fresh shipyard resource snapshot for Supply origins", () => {
    const stalePlanet = planet();
    stalePlanet.resourcesAsOfNow = { metal: "5000", crystal: "4900", deuterium: "4800" };

    const source = batchSupplySourceForPlanet(stalePlanet as any, {
      wallet,
      homePlanetId: "7",
      resources: { metal: "1000", crystal: "900", deuterium: "800" },
      resourcesAsOfNow: { metal: "420", crystal: "69", deuterium: "17" },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [],
      queue: null,
    });

    expect(source.resources).toEqual({ metal: 420, crystal: 69, deuterium: 17 });
  });

  test("keeps a failed Supply source explicitly unavailable instead of treating it as an empty fleet", () => {
    const unavailable = batchSupplySourceForPlanet(planet() as any, undefined, "Could not read this source's cargo fleet. Refresh and try again.");

    expect(unavailable.unavailableReason).toBe("Could not read this source's cargo fleet. Refresh and try again.");
  });

  test("uses the overview fast path before an active planet is known", async () => {
    let overviewCalled = false;
    const result = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined, {}, {
      fetchWalletOverviewSnapshot: async () => {
        overviewCalled = true;
        return {
          fleetVisibility: {
            wallet,
            homePlanetId: "7",
            incoming: [],
            outgoing: [],
            returning: [],
            joinableAttacks: [],
            completedMissions: [],
            battleReports: [],
          },
          planetsResponse: {
            wallet,
            homePlanetId: "7",
            planets: [planet()],
          },
          queues: queues() as any,
          settlement: {
            wallet,
            hasFirstPlanet: true,
            homePlanetId: "7",
            planet: planet(),
          },
        } as any;
      },
      fetchWalletPlanets: async () => ({
        wallet,
        homePlanetId: "7",
        planets: [planet()],
      } as any),
      fetchWalletQueues: async () => queues() as any,
      fetchFleetMissionVisibility: async () => ({
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      } as any),
    });

    expect(overviewCalled).toBe(true);
    expect(result.settlement.homePlanetId).toBe("7");
    expect(result.planetsResponse.planets).toHaveLength(1);
  });

  test("falls back to indexed planet reads when the overview fast path is incomplete", async () => {
    let overviewCalls = 0;
    let planetsCalled = false;
    const result = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined, {}, {
      fetchWalletOverviewSnapshot: async () => {
        overviewCalls += 1;
        return {
          fleetVisibility: undefined,
          planetsResponse: {
            wallet,
            homePlanetId: "7",
            planets: [],
          },
          queues: queues(),
          settlement: {
            wallet,
            hasFirstPlanet: true,
            homePlanetId: "7",
            planet: null,
          },
        } as any;
      },
      fetchWalletPlanets: async () => {
        planetsCalled = true;
        return {
          wallet,
          homePlanetId: "7",
          planets: [planet()],
        } as any;
      },
      fetchWalletQueues: async () => queues() as any,
      fetchFleetMissionVisibility: async () => ({
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      } as any),
      fetchWalletSettlement: async () => ({
        wallet,
        hasFirstPlanet: true,
        homePlanetId: "7",
        planet: planet(),
      } as any),
    });

    expect(overviewCalls).toBe(1);
    expect(planetsCalled).toBe(true);
    expect(result.settlement.planet?.planetId).toBe("7");
    expect(result.planetsResponse.planets).toHaveLength(1);
  });

  test("forces wallet planet roster reads for settled-planet chain events", async () => {
    let overviewCalled = false;
    let planetsCalled = false;
    const result = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, "7", { forceWalletPlanets: true }, {
      fetchWalletOverviewSnapshot: async () => {
        overviewCalled = true;
        throw new Error("overview should not be called");
      },
      fetchWalletPlanets: async () => {
        planetsCalled = true;
        return {
          wallet,
          homePlanetId: "7",
          planets: [planet(), { ...planet(), planetId: "8", isHomePlanet: false, coordinates: "2:44:10", position: 10 }],
        } as any;
      },
      fetchWalletQueues: async () => queues() as any,
      fetchFleetMissionVisibility: async () => ({
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      } as any),
    });

    expect(overviewCalled).toBe(false);
    expect(planetsCalled).toBe(true);
    expect(result.planetsResponse.planets.map((entry) => entry.planetId)).toEqual(["7", "8"]);
  });

  test("hydrates critical planet state without replacing mission visibility after a transient stall", async () => {
    const result = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, "7", {}, {
      fetchWalletOverviewSnapshot: async (_apiUrl, _account, _planetId, options) => {
        expect(options?.timeoutMs).toBeLessThan(10_000);
        throw new Error("Timed out reading overview snapshot from the game API after 3 seconds.");
      },
      fetchWalletPlanets: async () => ({
        wallet,
        homePlanetId: "7",
        planets: [planet()],
      } as any),
      fetchWalletQueues: async () => queues() as any,
      fetchFleetMissionVisibility: async (_apiUrl, _account, options) => {
        expect(options?.timeoutMs).toBeLessThan(10_000);
        throw new Error("Timed out reading fleet visibility from the game API after 1 seconds.");
      },
    });

    expect(result.settlement.homePlanetId).toBe("7");
    expect(result.settlement.planet?.planetId).toBe("7");
    expect(result.planetsResponse.planets).toHaveLength(1);
    expect(result.queues).toEqual(queues());
    // A failed visibility read is intentionally absent, not synthesized as a fake empty mission
    // response. The app retains the last successful missions and retries on its next poll.
    expect(result.fleetVisibility).toBeUndefined();
  });
});
