import { describe, expect, test } from "bun:test";
import { emptyMissionShips } from "../galaxyActions";
import type { BatchSupplyOrder, BatchSupplySource } from "../batchSupplyPlanner";
import {
  batchSupplyFleetPresentation,
  batchSupplySourceLimitReason,
  supplyResourceInputValues,
} from "./BatchSupplyModal";

const batchSupplyModalSource = await Bun.file(new URL("./BatchSupplyModal.tsx", import.meta.url)).text();

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
  test("prefills only the missing resources supplied by an action", () => {
    expect(supplyResourceInputValues({
      metal: 197_455,
      crystal: 48_857,
      deuterium: 0,
    })).toEqual({
      metal: "197455",
      crystal: "48857",
      deuterium: "",
    });
  });

  test("vertically centers the Supply title with its header icon", () => {
    expect(batchSupplyModalSource).toContain('<h2 className="flex h-5 items-center gap-2 text-lg font-semibold leading-none text-cyan-100">');
    expect(batchSupplyModalSource).toContain('<span className="flex size-5 items-center justify-center">');
    expect(batchSupplyModalSource).toContain('<span className="flex h-5 items-center">Supply {targetLabel}</span>');
    expect(batchSupplyModalSource).not.toContain('top-[2px]');
  });

  test("does not misreport unreadable fleet capacity as every slot being occupied", () => {
    expect(batchSupplyModalSource).toContain("fleetSlotsKnown && maxSources === 0");
  });

  test("keeps a hash-bearing Supply transaction in the canonical submitted state", () => {
    expect(batchSupplyModalSource).toContain('transactionState?.outcome === "submitted" || transactionState?.outcome === "confirmed"');
    expect(batchSupplyModalSource).toContain('transactionState?.outcome === "not-submitted" || transactionState?.outcome === "reverted"');
    expect(batchSupplyModalSource).toContain("Supply submitted — syncing indexed missions.");
    expect(batchSupplyModalSource).not.toContain("simulated Supply transaction was not sent");
  });

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
      maxSources: 0,
      selectedSourceCount: 0,
    })).toBe("No fleet slots are available for another transport.");

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
