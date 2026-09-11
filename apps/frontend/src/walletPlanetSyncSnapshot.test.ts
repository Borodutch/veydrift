import { describe, expect, test } from "bun:test";

import { batchSupplySourceForPlanet,  } from "./PlayableMvpApp";

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


describe("batch Supply source snapshots", () => {
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




});
