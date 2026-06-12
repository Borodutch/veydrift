import { describe, expect, test } from "bun:test";
import { researchViewState } from "../src/components/ResearchPage";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainResearchState } from "../src/walletFlow";

function researchState(overrides: Partial<ChainResearchState> = {}): ChainResearchState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    resources: { metal: "1000", crystal: "1000", deuterium: "1000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: {},
    technologies: [],
    queue: null,
    ...overrides,
  };
}

describe("researchViewState resource source (VEY-KANEO-473)", () => {
  test("uses the accrued settled-to-now balance (resourcesAsOfNow), matching the top bar", () => {
    // The top bar reads the backend's accrued `resourcesAsOfNow`. The research affordability gate
    // falls back to `state.resources` when `spendableResources` is absent, so that fallback must read
    // the SAME accrued field — otherwise the bar shows one number while the panel says "Requires more".
    const state = researchViewState(
      createInitialPlayableState(1_000),
      researchState({
        resources: { metal: "1000", crystal: "1000", deuterium: "1000" },
        resourcesAsOfNow: { metal: "5678", crystal: "999", deuterium: "120" },
      }),
      false,
      1_000,
    );

    expect(state.resources).toEqual({ metal: 5678, crystal: 999, deuterium: 120 });
  });

  test("falls back to the settled snapshot when the accrued field is absent", () => {
    // Older deploy / planet still warming: no `resourcesAsOfNow` — keep rendering the raw settled
    // `resources` rather than zeroing the panel.
    const state = researchViewState(
      createInitialPlayableState(1_000),
      researchState({ resources: { metal: "1234", crystal: "567", deuterium: "89" } }),
      false,
      1_000,
    );

    expect(state.resources).toEqual({ metal: 1234, crystal: 567, deuterium: 89 });
  });
});
