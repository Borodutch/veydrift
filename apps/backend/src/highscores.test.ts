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
      fleet: "26",
      defense: "26",
    });
  });

  test("accumulates economy across multiple planets", () => {
    const entry = calculateHighscore({
      wallet: "0x2222222222222222222222222222222222222222" as Address,
      homePlanetId: "1",
      planetCount: 2,
      planets: [
        {
          buildings: [{ id: 11, level: 1 }],
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

    expect(entry.score.economy).toBe("1641");
    expect(entry.score.total).toBe("1641");
  });
});
