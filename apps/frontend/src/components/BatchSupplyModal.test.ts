import { describe, expect, test } from "bun:test";
import { emptyMissionShips } from "../galaxyActions";
import type { BatchSupplyOrder, BatchSupplySource } from "../batchSupplyPlanner";
import {
  batchSupplyFleetPresentation,
  batchSupplySourceLimitReason,
} from "./BatchSupplyModal";

function source(ships: BatchSupplySource["ships"]): BatchSupplySource {
  return {
    planetId: "188",
    label: "Astro",
    coordinates: { galaxy: 6, system: 9, position: 13 },
    resources: { metal: 0, crystal: 0, deuterium: 3_730 },
    ships,
    driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 },
  };
}

function order(ships: BatchSupplyOrder["ships"]): BatchSupplyOrder {
  return {
    originPlanetId: "188",
    originLabel: "Astro",
    cargo: { metal: 1_000, crystal: 0, deuterium: 0 },
    ships,
    fuelCost: 10,
    travelSeconds: 60,
  };
}

describe("Batch Supply source row presentation", () => {
  test("shows the canonical remaining cargo fleet for an unplanned partially committed source", () => {
    const astro = source({ smallCargo: 4, largeCargo: 1 });

    expect(batchSupplyFleetPresentation(astro, undefined)).toEqual({
      label: "Available cargo fleet",
      ships: { smallCargo: 4, largeCargo: 1 },
    });
  });

  test("uses Planned fleet only after the planner creates an order", () => {
    const plannedShips = { ...emptyMissionShips(), largeCargo: 1 };

    expect(batchSupplyFleetPresentation(source({ smallCargo: 4, largeCargo: 1 }), order(plannedShips))).toEqual({
      label: "Planned fleet",
      ships: plannedShips,
    });
  });

  test("explains source-limit disabling without replacing a real unavailable reason", () => {
    expect(batchSupplySourceLimitReason({
      checked: false,
      maxSources: 4,
      selectedSourceCount: 4,
    })).toBe("Deselect another source to use this planet (4 fleet slots available).");

    expect(batchSupplySourceLimitReason({
      checked: false,
      maxSources: 4,
      selectedSourceCount: 4,
      unavailableReason: "No usable cargo ships are available on this planet.",
    })).toBeUndefined();
  });

  test("keeps zero available cargo visible as an empty available fleet", () => {
    expect(batchSupplyFleetPresentation(source({}), undefined)).toEqual({
      label: "Available cargo fleet",
      ships: {},
    });
  });
});
