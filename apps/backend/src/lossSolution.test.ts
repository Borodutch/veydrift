import { describe, expect, test } from "bun:test";
import { uniqueLossSolution } from "./indexer";

const ship = (itemId: number, max: number, metal: number, crystal: number, deuterium: number) => ({
  kind: "ship" as const,
  planetId: "824",
  itemId,
  max,
  cost: { metal: String(metal), crystal: String(crystal), deuterium: String(deuterium) }
});

describe("uniqueLossSolution", () => {
  test("still finds a small unique decomposition", () => {
    const solution = uniqueLossSolution(
      [ship(1, 10, 3000, 1000, 0), ship(7, 5, 45000, 15000, 0)],
      { metal: "51000", crystal: "17000", deuterium: "0" } as never
    );
    expect(solution?.map(pick => [pick.candidate.itemId, pick.destroyed])).toEqual([[1, 2], [7, 1]]);
  });

  test("gives up on mission 115414's ACS fleet instead of freezing the writer", () => {
    // Mission 115414 (2026-11-14): its group report's losses have no exact split over this fleet.
    const fleet = [
      ship(1, 1001, 3000, 1000, 0), ship(5, 213, 6000, 4000, 0), ship(6, 94, 20000, 7000, 2000),
      ship(7, 10, 45000, 15000, 0), ship(8, 81, 50000, 25000, 15000), ship(9, 18, 60000, 50000, 15000),
      ship(11, 32, 30000, 40000, 15000), ship(12, 161, 85000, 55000, 20000)
    ];
    // Without the step budget this never returns (bun's per-test timeout fails it).
    expect(uniqueLossSolution(fleet, { metal: "29722000", crystal: "14138000", deuterium: "4116000" } as never)).toBeNull();
  });
});
