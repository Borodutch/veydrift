import { describe, expect, test } from "bun:test";
import { calculateHighscore } from "./highscores";
import type { Address } from "./evm";

describe("highscore formulas", () => {
  test("scores representative canonical state by category", () => {
    const entry = calculateHighscore({
      wallet: "0x1111111111111111111111111111111111111111" as Address,
      homePlanetId: "7",
      planetCount: 1,
      planets: [
        {
          buildings: [
            { id: 0, level: 2 },
            { id: 1, level: 1 },
            { id: 5, level: 1 },
          ],
          defenses: [
            { id: 0, count: 3 },
            { id: 3, count: 1 },
          ],
          ships: [
            { id: 0, count: 2 },
            { id: 2, count: 1 },
          ],
        },
      ],
      technologies: [
        { id: 0, level: 1 },
        { id: 5, level: 2 },
        { id: 12, level: 2 },
      ],
    });

    expect(entry.score).toEqual({
      total: "100",
      economy: "0",
      research: "48",
      researchLevels: "5",
      military: "52",
      fleet: "26",
      fleetCount: "3",
      defense: "26",
    });
  });

  test("accumulates economy across multiple planets and moons", () => {
    const entry = calculateHighscore({
      wallet: "0x2222222222222222222222222222222222222222" as Address,
      homePlanetId: "1",
      planetCount: 2,
      planets: [
        {
          buildings: [{ id: 11, level: 1 }],
          moonBuildings: [
            { id: 0, level: 2 },
            { id: 1, level: 1 },
          ],
          defenses: [],
          ships: [],
        },
        {
          buildings: [{ id: 14, level: 1 }],
          defenses: [],
          ships: [],
        },
      ],
      technologies: [],
    });

    expect(entry.score.economy).toBe("1881");
    expect(entry.score.total).toBe("1881");
  });

  test("drops current military and fleet-count points when units are gone", () => {
    const fullFleet = calculateHighscore({
      wallet: "0x3333333333333333333333333333333333333333" as Address,
      homePlanetId: "3",
      planetCount: 1,
      planets: [
        {
          buildings: [],
          defenses: [{ id: 0, count: 5 }],
          ships: [{ id: 0, count: 5 }],
        },
      ],
      technologies: [],
    });
    const afterLosses = calculateHighscore({
      wallet: "0x3333333333333333333333333333333333333333" as Address,
      homePlanetId: "3",
      planetCount: 1,
      planets: [
        {
          buildings: [],
          defenses: [{ id: 0, count: 2 }],
          ships: [{ id: 0, count: 1 }],
        },
      ],
      technologies: [],
    });

    expect(fullFleet.score).toMatchObject({
      total: "30",
      military: "30",
      fleet: "20",
      fleetCount: "5",
      defense: "10",
    });
    expect(afterLosses.score).toMatchObject({
      total: "8",
      military: "8",
      fleet: "4",
      fleetCount: "1",
      defense: "4",
    });
  });

  test("totalUserScore mirrors the contract _totalUserScore weights (not the resource category total)", () => {
    // Contract VeydriftGameStorage._totalUserScore: tech (id+1)*15, +1000 per planet,
    // building (id+1)*10, defense (id+1)*2, ship (id+1)*4. Moon buildings excluded.
    const entry = calculateHighscore({
      wallet: "0x2222222222222222222222222222222222222222" as Address,
      homePlanetId: "1",
      planetCount: 1,
      planets: [
        {
          buildings: [{ id: 0, level: 2 }], // 2 * 1 * 10 = 20
          moonBuildings: [{ id: 0, level: 9 }], // excluded from totalUserScore
          defenses: [{ id: 1, count: 3 }], // 3 * 2 * 2 = 12
          ships: [{ id: 2, count: 1 }], // 1 * 3 * 4 = 12
        },
      ],
      technologies: [{ id: 0, level: 1 }], // 1 * 1 * 15 = 15
    });
    // 15 + (1000 + 20 + 12 + 12) = 1059. Distinct from the resource-based score.total.
    expect(entry.totalUserScore).toBe("1059");
    expect(entry.totalUserScore).not.toBe(entry.score.total);
  });

  test("keeps moon-stationed and in-flight non-combat ships in fleet and contract-parity scores", () => {
    const entry = calculateHighscore({
      wallet: "0x4444444444444444444444444444444444444444" as Address,
      homePlanetId: "1",
      planetCount: 1,
      planets: [{
        buildings: [],
        defenses: [],
        // Planet and moon inventories are combined by the indexer before scoring.
        ships: [
          { id: 0, count: 1 },
          { id: 4, count: 2 },
        ],
      }],
      inFlightShips: [{ id: 10, count: 3 }],
      technologies: [],
    });

    expect(entry.score.fleetCount).toBe("6");
    expect(entry.totalUserScore).toBe("1176");
  });
});
