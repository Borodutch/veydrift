import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  ActiveResearchQueueDetail,
  formatCost,
  formatResearchRequirements,
  getResearchRequirementStates,
  ResearchEffectsSection,
  ResearchLevelInfoButton,
  ResearchLevelInfoModal,
  ResearchLoadErrorPanel,
  ResearchStatusPanel,
  researchCatalogStatusText,
  researchCatalogTitleTone,
  researchDetailBadge,
  researchLevelInfoRows,
  researchRefreshErrorLabel,
  researchActionStatus,
  researchRefreshButtonState,
  shouldHideResearchValues,
} from "../src/components/ResearchPage";
import { RequirementFlairs } from "../src/components/RequirementFlairs";
import { createInitialPlayableState, researchEffectRows, researchUnlockRows } from "../src/playableMvp";
import type { ChainResearchState } from "../src/walletFlow";

describe("Research status panel surfaces only failures", () => {
  test("does not render success or pending action banners", () => {
    for (const status of ["success", "pending"] as const) {
      const panel = ResearchStatusPanel({
        actionState: { status, label: `Research ${status} banner` },
        error: undefined,
        loading: false,
        researchState: researchState(),
      });
      expect(visibleText(panel)).toBe("");
    }
  });

  test("does not render the queued/ready queue-status banner", () => {
    const panel = ResearchStatusPanel({
      actionState: { status: "idle" },
      error: undefined,
      loading: false,
      researchState: researchState({
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "10000",
          cost: { metal: "0", crystal: "0", deuterium: "0" },
        },
      }),
    });
    expect(visibleText(panel)).toBe("");
  });

  test("still renders error action banners, including during a refresh", () => {
    const loaded = ResearchStatusPanel({
      actionState: { status: "error", label: "Research failed" },
      error: undefined,
      loading: false,
      researchState: researchState(),
    });
    expect(visibleText(loaded)).toContain("Research failed");

    const refreshing = ResearchStatusPanel({
      actionState: { status: "error", label: "Research failed" },
      error: undefined,
      loading: true,
      researchState: researchState(),
    });
    expect(visibleText(refreshing)).toContain("Research failed");
  });
});

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
    expect(researchRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(researchRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });
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

  test("keeps advanced research prerequisites unmet until actual levels reach the requirement", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        researchLab: 6,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        energy: 3,
        shielding: 4,
      },
    };

    expect(getResearchRequirementStates(state, "hyperspace")).toEqual([
      { label: "Research Lab 7", met: false, target: { kind: "building", key: "researchLab" } },
      { label: "Energy Technology 5", met: false, target: { kind: "research", key: "energy" } },
      { label: "Shielding Technology 5", met: false, target: { kind: "research", key: "shielding" } },
    ]);
  });

  test("renders unmet and met requirement chips with distinct tone classes", () => {
    const flairs = RequirementFlairs({
      requirements: [
        { label: "Energy Technology 5", met: false, target: { kind: "research", key: "energy" } },
        { label: "Research Lab 7", met: true, target: { kind: "building", key: "researchLab" } },
      ],
    }) as VNode;
    const children = flairs.props.children as VNode[];
    const unmetChip = (children[0]!.type as (props: Record<string, unknown>) => VNode)(children[0]!.props);
    const metChip = (children[1]!.type as (props: Record<string, unknown>) => VNode)(children[1]!.props);

    expect(unmetChip.props.className).toContain("bg-amber-300/10");
    expect(metChip.props.className).toContain("bg-emerald-300/10");
  });

  test("routes energy production requirements to Solar Satellite production", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        researchLab: 12,
      },
    };

    expect(getResearchRequirementStates(state, "graviton")).toEqual([
      { label: "Research Lab 12", met: true, target: { kind: "building", key: "researchLab" } },
      { label: "Energy production 300,000", met: false, target: { kind: "ship", key: "solarSatellite" } },
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

  test("shows Energy Technology impact on Fusion Reactor output", () => {
    const base = createInitialPlayableState(10_000);
    const state = {
      ...base,
      buildings: {
        ...base.buildings,
        fusionReactor: 3,
      },
      research: {
        ...base.research,
        energy: 2,
      },
    };

    expect(researchEffectRows(state, "energy")).toEqual([
      {
        current: "110 produced",
        delta: "+3",
        next: "113 produced",
        target: "Fusion Reactor output",
      },
    ]);
  });

  test("shows non-energy combat research as current and next-level scaling", () => {
    const base = createInitialPlayableState(10_000);
    const state = {
      ...base,
      research: {
        ...base.research,
        weapons: 4,
      },
    };

    expect(researchEffectRows(state, "weapons")).toEqual([
      {
        current: "+40%",
        delta: "+10%",
        next: "+50%",
        target: "Ship and defense attack",
      },
    ]);
  });

  test("renders unlock-only research impact without fake numeric values", () => {
    const unlockRows = researchUnlockRows("laser");
    const section = ResearchEffectsSection({
      effectRows: [],
      unlockRows,
    });
    const text = visibleText(section);

    expect(text).toContain("Effects");
    expect(text).toContain("Plasma Technology at Level 10");
    expect(text).toContain("Battlecruiser at Level 12");
    expect(text).not.toContain("Current Next");
  });

  test("builds research level info rows with costs, requirements, and effects", () => {
    const base = createInitialPlayableState(10_000);
    const state = {
      ...base,
      buildings: {
        ...base.buildings,
        researchLab: 1,
      },
      research: {
        ...base.research,
        energy: 1,
      },
    };

    const rows = researchLevelInfoRows(state, "energy", { maxLevel: 3 });

    expect(rows).toMatchObject([
      {
        cost: { metal: 0, crystal: 800, deuterium: 400 },
        current: true,
        effect: "Fusion Reactor output: 0 produced; unlocks Light Laser, Combustion Drive, Impulse Drive",
        level: 1,
        next: false,
        requirementStatus: "Met",
      },
      {
        cost: { metal: 0, crystal: 1_600, deuterium: 800 },
        current: false,
        effect: "Fusion Reactor output: 0 produced; unlocks Laser Technology",
        level: 2,
        next: true,
        requirementStatus: "Met",
      },
      {
        cost: { metal: 0, crystal: 3_200, deuterium: 1_600 },
        current: false,
        level: 3,
        next: false,
        requirementStatus: "Met",
      },
    ]);
    // VEY-KANEO-472: the per-level reference table restores a client-computed research time
    // for rows whose prerequisites are met (this catalogue already derives cost/effect
    // client-side). Locked rows leave it undefined.
    expect(rows.every((row) => typeof row.durationSeconds === "number" && row.durationSeconds > 0)).toBe(true);
  });

  test("marks locked research level rows with unmet prerequisites", () => {
    const state = createInitialPlayableState(10_000);

    expect(researchLevelInfoRows(state, "laser", { maxLevel: 1 })[0]).toMatchObject({
      requirementStatus: "Requires Research Lab 1, Requires Energy Technology 2",
    });
  });

  test("renders research level info button and modal with accessible labels", () => {
    const button = ResearchLevelInfoButton({
      onClick: () => undefined,
      researchLabel: "Energy Technology",
    }) as VNode;
    expect(button.props["aria-label"]).toBe("Research level details");
    expect(button.props.title).toBe("Energy Technology level details");

    const modal = ResearchLevelInfoModal({
      currentLevel: 1,
      onClose: () => undefined,
      researchLabel: "Energy Technology",
      rows: researchLevelInfoRows({
        ...createInitialPlayableState(10_000),
        buildings: {
          ...createInitialPlayableState(10_000).buildings,
          researchLab: 1,
        },
      }, "energy", { maxLevel: 2 }),
    });
    const text = visibleText(modal);

    expect(text).toContain("Energy Technology levels");
    expect(text).toContain("Current Level 1");
    expect(text).toContain("Research cost");
    // VEY-KANEO-472: the per-level research time column is restored.
    expect(text).toContain("Research time");
    expect(text).toContain("Requirements");
    expect(text).toContain("Effect");
    expect(text).toContain("Level 1");
    expect(text).toContain("Level 2");
    expect(text).toContain("Current");
    expect(text).toContain("Next");
    expect(text).toContain("Crystal 800, Deut. 400");
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
      disabled: true,
      reason: "Research to Level 2 in progress",
      tileStatus: "Active",
    });
  });

  test("keeps active research disabled when display queue normalization is incomplete", () => {
    const state = createInitialPlayableState(10_000);
    const status = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 400, crystal: 800, deuterium: 200 },
      error: undefined,
      key: "impulseDrive",
      loading: false,
      now: 1_700_003_000_000,
      researchState: researchState({
        technologyLevels: { "9": 0 },
        technologies: [
          { id: 9, level: 0, cost: { metal: "400", crystal: "800", deuterium: "200" } },
        ],
        queue: {
          active: true,
          kind: "research",
          itemId: 9,
          targetLevel: 1,
          readyAt: "1700004320",
          startedAt: null,
          cost: null,
        },
      }),
      state: {
        ...state,
        buildings: {
          ...state.buildings,
          researchLab: 1,
        },
        research: {
          ...state.research,
          impulseDrive: 0,
        },
        researchQueue: undefined,
      },
    });

    expect(status).toMatchObject({
      actionLabel: "In progress",
      badge: "In progress",
      disabled: true,
      reason: "Research to Level 1 in progress",
      targetLevel: 1,
      tileStatus: "Active",
    });
  });

  test("shows a ready-but-unsettled research level as completing, not manually actionable (VEY-KANEO-468)", () => {
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

    // The level is past its ready time but not yet settled on-chain. Completion now happens
    // automatically (lazy reconcile), so the tile reflects an in-progress "Completing" state and
    // exposes no manual completion action.
    expect(status).toMatchObject({
      actionLabel: "In progress",
      badge: "In progress",
      disabled: true,
      reason: "Completing Level 2",
      targetLevel: 2,
      tileStatus: "Active",
    });
  });

  test("fades unavailable research titles without generic ready/locked tile text (VEY-KANEO-576)", () => {
    const base = createInitialPlayableState(10_000);
    const state = {
      ...base,
      buildings: {
        ...base.buildings,
        researchLab: 1,
      },
      resources: { metal: 1_000, crystal: 1_000, deuterium: 1_000 },
    };
    const ready = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 0, crystal: 800, deuterium: 400 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState(),
      state,
    });
    const locked = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 800, deuterium: 0 },
      error: undefined,
      key: "laser",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState(),
      state,
    });
    const active = researchActionStatus({
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
    const insufficientResources = researchActionStatus({
      actionPending: false,
      canTransact: true,
      chainCost: { metal: 1_600, crystal: 800, deuterium: 0 },
      error: undefined,
      key: "energy",
      loading: false,
      now: 1_700_000_000_000,
      researchState: researchState({
        resources: { metal: "700", crystal: "1000", deuterium: "1000" },
      }),
      state: {
        ...state,
        resources: { metal: 700, crystal: 1_000, deuterium: 1_000 },
      },
    });

    expect(ready).toMatchObject({
      tileStatus: "Ready",
    });
    expect(researchCatalogTitleTone(ready)).toBe("normal");
    expect(researchCatalogStatusText(ready)).toBe("");
    expect(researchDetailBadge(ready)).toBeUndefined();

    expect(locked).toMatchObject({
      disabled: true,
      reason: "Locked by unmet prerequisites",
      tileStatus: "Locked",
    });
    expect(researchCatalogTitleTone(locked)).toBe("muted");
    expect(researchCatalogStatusText(locked)).toBe("");
    expect(researchDetailBadge(locked)).toBeUndefined();

    expect(researchCatalogTitleTone(active)).toBe("normal");
    expect(researchCatalogStatusText(active)).toBe("Active");
    expect(researchDetailBadge(active)).toBe("In progress");

    expect(insufficientResources).toMatchObject({
      disabled: true,
      reason: "Requires 900 more Metal",
      tileStatus: "Locked",
    });
    expect(researchCatalogTitleTone(insufficientResources)).toBe("muted");
    expect(researchCatalogStatusText(insufficientResources)).toBe("");
    expect(researchDetailBadge(insufficientResources)).toBeUndefined();
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

  test("omits the affordable-in ETA from research copy when no production rate is supplied", () => {
    // Live-read payloads without a backend production rate keep the plain missing-resource copy.
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
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      state,
    });

    expect(status).toMatchObject({
      disabled: true,
      reason: "Requires 900 more Metal, 300 more Crystal",
    });
  });

  test("appends the backend-sourced affordable-in ETA to research copy when production rates are supplied (VEY-KANEO-481)", () => {
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
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      // Metal 900 short @ 900/h = 1h; Crystal 300 short @ 600/h = 30m. Max wait = 1h.
      productionRates: { metal: 900, crystal: 600, deuterium: 0 },
      state,
    });

    expect(status).toMatchObject({
      disabled: true,
      reason: "Requires 900 more Metal, 300 more Crystal (affordable in 1h)",
    });
  });

  test("uses spendable accrued resources for research affordability", () => {
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
      researchState: researchState({
        resources: { metal: "700", crystal: "2000", deuterium: "1000" },
      }),
      spendableResources: { metal: 1_000, crystal: 2_250, deuterium: 1_000 },
      state,
    })).toMatchObject({
      disabled: true,
      reason: "Requires 600 more Metal, 50 more Crystal",
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
