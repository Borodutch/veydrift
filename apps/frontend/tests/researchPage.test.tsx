import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  ActiveResearchQueueDetail,
  formatCost,
  formatResearchRequirements,
  getResearchRequirementStates,
  ResearchLoadErrorPanel,
  researchCompletionButtonState,
  shouldHideResearchValues,
} from "../src/components/ResearchPage";
import { RequirementFlairs } from "../src/components/RequirementFlairs";
import { createInitialPlayableState } from "../src/playableMvp";

describe("Research page load-error display", () => {
  test("formats cumulative costs and requirements with commas", () => {
    expect(formatCost({ metal: 2_000, crystal: 4_000, deuterium: 600 })).toBe("Metal 2,000, Crystal 4,000, Deut. 600");
    expect(formatResearchRequirements([
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "energy", level: 5 },
    ])).toBe("Research Lab 4, Laser Technology 10, Energy Technology 5");
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
  return textParts(vnode.props?.children);
}

function researchState() {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    resources: { metal: "1000", crystal: "1000", deuterium: "1000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: {},
    technologies: [],
    queue: null,
  };
}
