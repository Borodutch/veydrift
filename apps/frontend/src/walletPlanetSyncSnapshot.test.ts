import { describe, expect, test } from "bun:test";

import { loadWalletPlanetSyncSnapshot } from "./PlayableMvpApp";

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
  test("hydrates critical planet state when the overview fast path and fleet visibility stall", async () => {
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
    expect(result.fleetVisibility).toMatchObject({
      wallet,
      homePlanetId: "7",
      incoming: [],
      outgoing: [],
      returning: [],
    });
  });
});
