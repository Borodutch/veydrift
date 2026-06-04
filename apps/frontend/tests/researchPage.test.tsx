import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  ActiveResearchQueueDetail,
  formatCost,
  formatResearchRequirements,
  getResearchRequirementStates,
  ResearchLoadErrorPanel,
  researchRefreshErrorLabel,
  researchActionStatus,
  researchCompletionButtonState,
  researchImpactRows,
  shouldHideResearchValues,
} from "../src/components/ResearchPage";
import { RequirementFlairs } from "../src/components/RequirementFlairs";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainResearchState } from "../src/walletFlow";

describe("Research page load-error display", () => {
  test("formats cumulative costs and requirements with commas", () => {
    expect(formatCost({ metal: 2_000, crystal: 4_000, deuterium: 600 })).toBe("Metal 2,000, Crystal 4,000, Deut. 600");
    expect(formatResearchRequirements([
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "energy", level: 5 },
    ])).toBe("Research Lab 4, Laser Technology 10, Energy Technology 5");
  });

  test("shows concrete current and next-level research impact rows", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        fusionReactor: 2,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        computer: 3,
        energy: 3,
        weapons: 2,
      },
    };

    expect(researchImpactRows(state, "energy")).toContainEqual({
      delta: "+2 energy",
      label: "Fusion Reactor output",
      next: "71 energy",
      tone: "positive",
      value: "69 energy",
    });
    expect(researchImpactRows(state, "computer")).toContainEqual({
      delta: "+1 fleet slot",
      label: "Fleet slots",
      next: "5 simultaneous missions",
      value: "4 simultaneous missions",
    });
    expect(researchImpactRows(state, "weapons")).toContainEqual({
      delta: "+10% battle stat",
      label: "Attack multiplier",
      next: "x1.3",
      value: "x1.2",
    });
  });

  test("shows next-level unlock impact from existing catalog requirements", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      research: {
        ...createInitialPlayableState(1_000).research,
        laser: 2,
      },
    };

    expect(researchImpactRows(state, "laser")).toContainEqual({
      delta: "Adds Light Laser",
      label: "Unlock impact",
      next: "Light Laser",
      tone: "positive",
      value: "No catalog unlocks yet",
    });
  });

  test("shows research-network next-level lab link details when backend levels are available", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      research: {
        ...createInitialPlayableState(1_000).research,
        intergalacticResearchNetwork: 1,
      },
    };

    expect(researchImpactRows(state, "intergalacticResearchNetwork", [8, 5, 3])).toContainEqual({
      delta: "+1 eligible lab counted for future research durations.",
      label: "Known lab network",
      next: "Lab 8, Lab 5",
      value: "Lab 8",
    });
  });

  test("hides live research values after backend load errors", () => {
    expect(shouldHideResearchValues({
      error: "Research request failed with 503",
      loading: false,
      researchState: null,
      useLocalStateFallback: false,
    })).toBe(true);
  });

  test("keeps loaded research values visible during background refreshes and refresh errors", () => {
    expect(shouldHideResearchValues({
      error: undefined,
      loading: true,
      researchState: researchState(),
      useLocalStateFallback: false,
    })).toBe(false);
    expect(shouldHideResearchValues({
      error: "Research request failed with 503",
      loading: false,
      researchState: researchState(),
      useLocalStateFallback: false,
    })).toBe(false);
  });

  test("labels refresh errors as stale-data notices when research state remains loaded", () => {
    expect(researchRefreshErrorLabel({
      error: "Research request failed with 503",
      researchState: researchState(),
    })).toBe("Refreshing research state: Research request failed with 503");
    expect(researchRefreshErrorLabel({
      error: "Research request failed with 503",
      researchState: null,
    })).toBeUndefined();
  });

  test("keeps disconnected local research fallback explicit", () => {
    expect(shouldHideResearchValues({
      error: undefined,
      loading: false,
      researchState: null,
      useLocalStateFallback: true,
    })).toBe(false);
  });

  test("renders load errors without zeroed research values", () => {
    const panel = ResearchLoadErrorPanel({
      loading: false,
      reason: "Research request failed with 503",
    });
    const text = visibleText(panel);

    expect(text).toContain("Research state could not be loaded");
    expect(text).toContain("Research request failed with 503");
    expect(text).toContain("Levels, costs, resources, queue state, and requirement-derived values are unavailable");
    expect(text).not.toMatch(/\bLevel 0\b|Research Level 1|Research Lab 1 is required|No resource cost/);
  });

  test("returns visible met and unmet research requirement states", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        researchLab: 1,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        energy: 1,
      },
    };

    expect(getResearchRequirementStates(state, "laser")).toEqual([
      { label: "Research Lab 1", met: true, target: { kind: "building", key: "researchLab" } },
      { label: "Energy Technology 2", met: false, target: { kind: "research", key: "energy" } },
    ]);
  });

  test("renders concrete requirement states as accessible navigation buttons", () => {
    const flairs = RequirementFlairs({
      onOpenRequirement: () => undefined,
      requirements: [
        { label: "Energy Technology 2", met: false, target: { kind: "research", key: "energy" } },
        { label: "Energy production 300,000", met: false },
      ],
    }) as VNode;
    const children = flairs.props.children as VNode[];
    const clickableChip = (children[0]!.type as (props: Record<string, unknown>) => VNode)(children[0]!.props);
    const infoChip = (children[1]!.type as (props: Record<string, unknown>) => VNode)(children[1]!.props);

    expect(clickableChip.type).toBe("button");
    expect(clickableChip.props["aria-label"]).toBe("Open Energy Technology 2 requirement");
    expect(infoChip.type).toBe("span");
  });

  test("renders active research progress with the shared single-item queue pattern", () => {
    const panel = ActiveResearchQueueDetail({
      isSelectedResearch: true,
      now: 1_700_000_060_000,
      queue: {
        kind: "research",
        key: "energy",
        label: "Energy Technology",
        readyAt: 1_700_000_120_000,
        startedAt: 1_700_000_000_000,
        targetLevel: 1,
      },
    });
    const text = visibleText(panel);

    expect(text).toContain("Research in progress");
    expect(text).toContain("Energy Technology Level 1 is researching");
    expect(text).toContain("50 %");
    expect(text).toContain("Time remaining");
    expect(text).toContain("Ready at");
  });

  test("enables research completion from the app clock once the queue is ready", () => {
    const queue = {
      kind: "research",
      key: "energy",
      label: "Energy Technology",
      readyAt: 1_700_000_120_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 1,
    } as const;

    expect(researchCompletionButtonState({
      actionPending: false,
      canTransact: true,
      now: 1_700_000_119_000,
      queue,
    })).toMatchObject({
      disabled: true,
      label: expect.stringContaining("Ready in 1s"),
    });

    expect(researchCompletionButtonState({
      actionPending: false,
      canTransact: true,
      now: 1_700_000_120_000,
      queue,
    })).toEqual({
      disabled: false,
      label: "Complete research",
    });
  });

  test("keeps selected queued research disabled before the authoritative ready time", () => {
    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 0, crystal: 1_600, deuterium: 800 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_119_000,
      researchState: researchState({
        technologyLevels: { "0": 1 },
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000120",
          startedAt: "1700000000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
      state: researchViewState({
        readyAt: 1_700_000_120_000,
      }),
    });

    expect(status).toMatchObject({
      actionLabel: "In progress",
      badge: "In progress",
      completionReady: false,
      disabled: true,
      reason: "Research to Level 2 in progress",
      tileStatus: "Active",
    });
  });

  test("lets selected queued research complete once authoritative ready time has passed", () => {
    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 0, crystal: 1_600, deuterium: 800 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_120_000,
      researchState: researchState({
        technologyLevels: { "0": 1 },
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000120",
          startedAt: "1700000000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
      state: researchViewState({
        readyAt: 1_700_000_120_000,
      }),
    });

    expect(status).toMatchObject({
      actionLabel: "Complete research",
      badge: "Ready",
      completionReady: true,
      disabled: false,
      reason: "Ready to complete Level 2",
      targetLevel: 2,
      tileStatus: "Ready",
    });
  });

  test("reports the exact single resource missing for research actions", () => {
    const state = {
      ...createInitialPlayableState(10_000),
      buildings: {
        ...createInitialPlayableState(10_000).buildings,
        researchLab: 1,
      },
      resources: { metal: 707, crystal: 2_169, deuterium: 1_139 },
    };

    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 800, deuterium: 0 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState({
        resources: { metal: "707", crystal: "2169", deuterium: "1139" },
      }),
      state,
    });

    expect(status).toMatchObject({
      disabled: true,
      reason: "Requires 893 more Metal",
    });
  });

  test("shows time to afford for research actions when production rates are available", () => {
    const state = {
      ...createInitialPlayableState(10_000),
      buildings: {
        ...createInitialPlayableState(10_000).buildings,
        researchLab: 1,
      },
      resources: { metal: 700, crystal: 2_000, deuterium: 1_000 },
    };

    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 2_300, deuterium: 1_000 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      productionRates: { metal: 300, crystal: 600, deuterium: 0 },
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      state,
    });

    expect(status).toMatchObject({
      disabled: true,
      reason: "Requires 900 more Metal, 300 more Crystal (affordable in 3h)",
    });
  });

  test("uses spendable accrued resources for research affordability and ETA", () => {
    const state = {
      ...createInitialPlayableState(10_000),
      buildings: {
        ...createInitialPlayableState(10_000).buildings,
        researchLab: 1,
      },
      resources: { metal: 700, crystal: 2_000, deuterium: 1_000 },
    };

    expect(researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 900, crystal: 2_100, deuterium: 1_000 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      spendableResources: { metal: 900, crystal: 2_100, deuterium: 1_000 },
      state,
    })).toMatchObject({
      disabled: false,
      reason: "Ready for Level 1",
    });

    expect(researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 2_300, deuterium: 1_000 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      productionRates: { metal: 300, crystal: 600, deuterium: 0 },
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      spendableResources: { metal: 1_000, crystal: 2_250, deuterium: 1_000 },
      state,
    })).toMatchObject({
      disabled: true,
      reason: "Requires 600 more Metal, 50 more Crystal (affordable in 2h)",
    });
  });

  test("reports every missing resource for research actions", () => {
    const state = {
      ...createInitialPlayableState(10_000),
      buildings: {
        ...createInitialPlayableState(10_000).buildings,
        researchLab: 1,
      },
      resources: { metal: 707, crystal: 2_169, deuterium: 1_139 },
    };

    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 3_000, deuterium: 2_000 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState({
        resources: { metal: "707", crystal: "2169", deuterium: "1139" },
      }),
      state,
    });

    expect(status).toMatchObject({
      disabled: true,
      reason: "Requires 893 more Metal, 831 more Crystal, 861 more Deuterium",
    });
  });
});

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return textParts(vnode.type(vnode.props));
  }
  return textParts(vnode.props?.children);
}

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

function researchViewState({
  readyAt,
}: {
  readyAt: number;
}) {
  const state = createInitialPlayableState(10_000);
  return {
    ...state,
    buildings: {
      ...state.buildings,
      researchLab: 1,
    },
    research: {
      ...state.research,
      energy: 1,
    },
    researchQueue: {
      kind: "research",
      key: "energy",
      label: "Energy Technology",
      readyAt,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    },
  };
}
