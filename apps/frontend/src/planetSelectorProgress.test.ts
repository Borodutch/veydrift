import { describe, expect, test } from "bun:test";

import type { ConstructionProgress } from "./constructionProgress";
import { planetSelectorResearchProgressFor } from "./planetSelectorProgress";

const researchProgress: ConstructionProgress = {
  active: true,
  bodyKind: "planet",
  complete: false,
  indeterminate: false,
  kind: "research",
  planetId: "wallet",
  progress: 0.5,
  queue: {
    active: true,
    kind: "research",
    itemId: 0,
    readyAt: "1770003600",
    startedAt: "1770000000",
    cost: { metal: "0", crystal: "0", deuterium: "0" },
  },
  readyAtMs: 1_770_003_600_000,
  remaining: "59m",
  startedAtMs: 1_770_000_000_000,
};

describe("planet selector progress", () => {
  test("shows the wallet-global research bar only on its home planet", () => {
    expect(planetSelectorResearchProgressFor("8", "7", researchProgress)).toBeUndefined();
    const homeResearch = planetSelectorResearchProgressFor("7", "7", researchProgress);
    expect(homeResearch).toBe(researchProgress);

    expect(homeResearch).toMatchObject({ active: true, kind: "research" });
  });
});
