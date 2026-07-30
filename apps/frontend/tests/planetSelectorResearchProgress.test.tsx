import { describe, expect, test } from "bun:test";
import {
  researchQueueForPlanet,
  researchQueueWithPlanetAttribution,
} from "../src/PlayableMvpApp";
import type { QueueStateResponse } from "../src/walletFlow";

describe("right-sidebar planet selector research progress", () => {
  test("shows research only on the planet that owns the queue", () => {
    const queue = activeResearchQueue({ planetId: "new-zion" });

    expect(researchQueueForPlanet(queue, "new-zion")).toBe(queue);
    expect(researchQueueForPlanet(queue, "astro")).toBeNull();
  });

  test("attributes an older in-flight queue without a planet id to the active planet", () => {
    const queue = activeResearchQueue();
    const attributed = researchQueueWithPlanetAttribution(queue, "new-zion");

    expect(attributed?.planetId).toBe("new-zion");
    expect(researchQueueForPlanet(attributed, "new-zion")).toBe(attributed);
    expect(researchQueueForPlanet(attributed, "astro")).toBeNull();
  });

  test("prefers the authoritative indexed planet id over the compatibility fallback", () => {
    const queue = activeResearchQueue({ planetId: "astro" });

    expect(researchQueueWithPlanetAttribution(queue, "new-zion")?.planetId).toBe("astro");
  });

  test("does not attribute an inactive queue", () => {
    expect(researchQueueWithPlanetAttribution(null, "new-zion")).toBeNull();
  });
});

function activeResearchQueue(
  overrides: Partial<QueueStateResponse> = {},
): QueueStateResponse {
  const now = 1_700_000_000;
  return {
    active: true,
    asOfNow: { complete: false, secondsRemaining: 60 },
    cost: { crystal: "400000", deuterium: "160000", metal: "240000" },
    itemId: 13,
    kind: "research",
    readyAt: String(now + 60),
    startedAt: String(now - 60),
    targetLevel: 9,
    ...overrides,
  };
}
