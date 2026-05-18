import { describe, expect, test } from "bun:test";
import { infrastructurePlayableState } from "./chainState";
import { progress } from "./playableMvp";

describe("chainState", () => {
  test("derives stable building queue progress from readyAt and upgrade duration", () => {
    const readyAtSeconds = 1_700_000_060;
    const halfway = (readyAtSeconds - 30) * 1_000;
    const state = infrastructurePlayableState({
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      resources: { metal: "0", crystal: "0", deuterium: "0" },
      productionPerHour: null,
      storageCaps: null,
      buildings: [],
      queue: {
        active: true,
        kind: "building",
        itemId: 0,
        targetLevel: 1,
        readyAt: readyAtSeconds.toString(),
        cost: { metal: "60", crystal: "15", deuterium: "0" },
      },
    }, halfway);

    expect(state.queue).toMatchObject({
      kind: "building",
      key: "metalMine",
      label: "Metal Mine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - 60) * 1_000,
    });
    expect(progress(state.queue, halfway)).toBe(0.5);
  });
});
