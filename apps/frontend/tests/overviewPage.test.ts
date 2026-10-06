import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { productionQueueViewModel } from "../src/components/ProductionCatalog";
import {
  isOverviewResearchReadyToFinish,
  compactOverviewLevelLabel,
  compactOverviewResearchLabel,
} from "../src/components/OverviewPage";
import type { ConstructionProgress, ConstructionQueueKind } from "../src/constructionProgress";
import {
  defenseQueuePreview,
  overviewPlanetEffects,
  queueProgressBarState,
  queueProgressFillState,
  shipQueuePreview,
} from "../src/overviewData";
import {
  createInitialPlayableState,
  defenseCatalog,
  queueProgressPercent,
  researchCatalog,
  shipCatalog,
} from "../src/playableMvp";
import { timestampToMs } from "../src/timestampFormat";
import type { Planet } from "../src/types";

const overviewSource = await Bun.file(new URL("../src/components/OverviewPage.tsx", import.meta.url)).text();
const buildingCompletionWalletPrompt =
  "Building completion: confirm the game-state update in your wallet; token balance changes are not expected.";

const homePlanet: Planet = {
  alliance: null,
  diameter: 12_000,
  fields: 180,
  galaxy: 1,
  hasMoon: false,
  id: "planet-1",
  image: "/assets/game/style-pass/generated/planets/cold-tundra.webp",
  name: "Vey Prime",
  occupiedBy: null,
  owner: "0x1111111111111111111111111111111111111111",
  ownerId: "0x1111111111111111111111111111111111111111",
  position: 7,
  resources: {
    crystal: 50,
    deuterium: 10,
    energy: 0,
    metal: 100,
  },
  system: 42,
  temperature: {
    max: 8,
    min: -32,
  },
  type: "cold-tundra",
};

describe("overview queue progress display", () => {
  test("uses compact level labels inside overview queue cards", () => {
    expect(compactOverviewLevelLabel("Shipyard Level 9")).toBe("Shipyard 9");
    expect(compactOverviewLevelLabel("Plasma Technology level 7")).toBe("Plasma Technology 7");
    expect(compactOverviewLevelLabel("Rift Stabilizer")).toBe("Rift Stabilizer");
  });

  test("uses concise technology names only inside Overview research queue cards", () => {
    expect(compactOverviewResearchLabel("Hyperspace Technology 6")).toBe("Hyperspace 6");

    for (const research of researchCatalog) {
      const expected = research.label.endsWith(" Technology")
        ? research.label.slice(0, -" Technology".length)
        : research.label;
      expect(compactOverviewResearchLabel(research.label)).toBe(expected);
    }

    expect(compactOverviewResearchLabel("Hyperspace Drive 4")).toBe("Hyperspace Drive 4");
    expect(compactOverviewResearchLabel("Intergalactic Research Network 3")).toBe("Intergalactic Research Network 3");
    expect(compactOverviewResearchLabel("Research Lab 9")).toBe("Research Lab 9");
  });

  test("renders compact planet stats and effects behind the info control", () => {
    expect(overviewSource).toContain('aria-label="Show planet stats and effects"');
    expect(overviewSource).toContain('aria-controls="overview-planet-effects"');
    expect(overviewSource).toContain('aria-haspopup="dialog"');
    expect(overviewSource).toContain("<PlanetEffectsPanel");
    expect(overviewSource).not.toContain(">Planet stats<");
    expect(overviewSource).not.toContain("<StatPip");
    expect(overviewSource).not.toContain('label="Status"');
    expect(overviewSource).toContain("Fields are the planet development budget");
    expect(overviewSource).toContain("Temperature changes deuterium production and Solar Satellite energy output");
    expect(overviewSource).toContain('label="Fields"');
    expect(overviewSource).toContain('label="Temperature"');
    expect(overviewSource).toContain('label="Diameter"');
    expect(overviewSource).toContain('label="Terraformer"');
    expect(overviewSource).toContain('label="Deuterium multiplier"');
    expect(overviewSource).toContain('label="Solar Satellite"');
    expect(overviewSource).not.toContain('label="Fields used"');
    expect(overviewSource).not.toContain('label="Fields available"');
    expect(overviewSource).not.toContain('label="Field pressure"');
    expect(overviewSource).not.toContain('label="Deuterium output"');
    expect(overviewSource).not.toContain('label="Deuterium capacity"');
    expect(overviewSource).not.toContain('label="Mine power"');
    expect(overviewSource).not.toContain("Temperature changes implemented production math");
    expect(overviewSource).toContain('aria-label="Close planet effects"');
  });

  test("opens planet info and rename in viewport modals like the commander editor", () => {
    expect(overviewSource).toContain('id="overview-planet-name-editor"');
    expect(overviewSource).toContain('aria-labelledby="overview-planet-name-editor-title"');
    expect(overviewSource).toContain('aria-modal="true"');
    expect(overviewSource.match(/role="dialog"/g)?.length).toBe(2);
    expect(overviewSource.match(/modal-backdrop-enter fixed inset-0 z-50/g)?.length).toBe(2);
    expect(overviewSource.match(/modal-panel-enter grid max-h-\[calc\(100dvh-1\.5rem\)\]/g)?.length).toBe(2);
    expect(overviewSource).toContain("event.target === event.currentTarget");
    expect(overviewSource).toContain('event.key !== "Escape"');
    expect(overviewSource).not.toContain('className="grid gap-2 rounded border border-white/10 bg-black/25 p-3"');
  });

  test("renders the Solar Satellite effect energy in the compact non-wrapping form", () => {
    // The verbose "NN energy each" value wrapped on the Overview planet effects panel.
    // Use the established "NN E" energy unit and keep the value on one line.
    expect(overviewSource).toContain("} E each`}");
    expect(overviewSource).not.toContain("energy each`}");
    expect(overviewSource).toMatch(/label="Solar Satellite"\s+nowrap/);
  });

  test("derives selected planet effect values from canonical production helpers", () => {
    const state = createInitialPlayableState(1_700_000_000_000);
    state.buildings.deuteriumSynthesizer = 3;
    state.buildings.solarPlant = 4;
    state.buildings.fusionReactor = 1;
    state.buildings.terraformer = 2;
    state.research.energy = 2;
    state.ships.solarSatellite = 2;

    const effects = overviewPlanetEffects({
      buildings: state.buildings,
      energyTechnologyLevel: state.research.energy,
      settlement: {
        wallet: "0x1111111111111111111111111111111111111111",
        hasFirstPlanet: true,
        homePlanetId: "7",
        planet: {
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          name: "Vey Prime",
          galaxy: 1,
          system: 42,
          position: 7,
          fields: 220,
          temperature: 40,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 9_800,
          lastSettledAt: "1700000000",
          resources: { metal: "0", crystal: "0", deuterium: "0" },
        },
      },
      solarSatelliteCount: state.ships.solarSatellite,
      usedFields: 12,
    });

    expect(effects.fields).toBe("12 / 220");
    expect(effects.availableFields).toBe(208);
    expect(effects.fieldPressurePercent).toBeCloseTo(5.45, 2);
    expect(effects.temperature).toBe("20°C to 60°C");
    expect(effects.deuteriumMultiplier).toBe("98%");
    expect(effects.deuteriumCapacityPerHour).toBe(38);
    expect(effects.liveDeuteriumPerHour).toBe(27);
    expect(effects.minePower).toBe("100%");
    expect(effects.solarSatelliteEnergy).toBe(30);
    expect(effects.terraformer).toBe("+10 now, +5 next level");
  });

  test("matches Defense page label, asset, and progress for the same queue snapshot", () => {
    const queue = {
      active: true,
      cost: { metal: "4000", crystal: "0", deuterium: "0" },
      itemId: 0,
      kind: "defense",
      quantity: 2,
      readyAt: "1700000120",
      startedAt: "1700000000",
    };
    const now = 1_700_000_060_000;
    const overview = defenseQueuePreview(queue);
    const detail = productionQueueViewModel(queue, defenseCatalog);

    expect(detail).toBeDefined();
    expect(overview).toEqual({
      asset: detail?.asset,
      label: `${detail?.label} x${detail?.quantity}`,
    });
    expect(queueProgressFillState({
      now,
      readyAt: timestampToMs(queue.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(queue.startedAt),
    }).progress).toBe(queueProgressFillState({
      now,
      readyAt: timestampToMs(detail?.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(detail?.startedAt),
    }).progress);
  });

  test("matches Shipyard page concrete label, asset, and progress for the same queue snapshot", () => {
    const queue = {
      active: true,
      cost: { metal: "4000", crystal: "4000", deuterium: "0" },
      itemId: 0,
      kind: "ship",
      quantity: 1,
      readyAt: "1700000120",
      startedAt: "1700000000",
    };
    const now = 1_700_000_060_000;
    const overview = shipQueuePreview(queue);
    const detail = productionQueueViewModel(queue, shipCatalog);

    expect(detail).toBeDefined();
    expect(overview).toEqual({
      asset: detail?.asset,
      label: `${detail?.label} x${detail?.quantity}`,
    });
    expect(overview.label).toBe("Small Cargo x1");
    expect(overview.label).not.toBe("Ship x1");
    expect(queueProgressFillState({
      now,
      readyAt: timestampToMs(queue.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(queue.startedAt),
    }).progress).toBe(queueProgressFillState({
      now,
      readyAt: timestampToMs(detail?.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(detail?.startedAt),
    }).progress);
  });

  test("renders ready queues as complete even when the source payload was indeterminate", () => {
    expect(queueProgressBarState({
      indeterminate: true,
      remaining: "Ready",
    })).toEqual({
      indeterminate: false,
      progress: 1,
    });
  });

  test("keeps pending unknown-duration queues indeterminate", () => {
    expect(queueProgressBarState({
      indeterminate: true,
      remaining: "Pending",
    })).toEqual({
      indeterminate: true,
      progress: 0,
    });
  });

  test("clamps determinate queue progress", () => {
    expect(queueProgressBarState({
      progress: 1.25,
      remaining: "12s",
    })).toEqual({
      indeterminate: false,
      progress: 1,
    });
  });

  test("derives live fill progress from the canonical queue timeline", () => {
    expect(queueProgressFillState({
      now: 1_700_000_500_000,
      progress: 0,
      readyAt: 1_700_001_000_000,
      remaining: "8m 20s",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 500_000,
      progress: 0.5,
    });
  });

  test("starts live queue progress at the beginning of a canonical timeline", () => {
    expect(queueProgressFillState({
      now: 1_700_000_000_000,
      progress: 0,
      readyAt: 1_700_001_000_000,
      remaining: "16m 40s",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 0,
      progress: 0,
    });
  });

  test("prefers canonical rounded timeline progress over a stale caller progress value", () => {
    expect(queueProgressFillState({
      now: 1_700_000_755_000,
      progress: 0.1,
      readyAt: 1_700_001_000_000,
      remaining: "4m 10s",
      startedAt: 1_700_000_000_000,
    })).toMatchObject({
      animated: false,
      progress: 0.76,
    });
  });

  test("matches infrastructure rounded progress for the same queue and clock", () => {
    const queue = {
      readyAt: 1_700_001_000_000,
      startedAt: 1_700_000_000_000,
    };
    const now = 1_700_000_755_000;
    const infrastructurePercent = queueProgressPercent(queue, now);
    const overviewFill = queueProgressFillState({
      now,
      progress: 0,
      readyAt: queue.readyAt,
      remaining: "4m 5s",
      startedAt: queue.startedAt,
    });

    expect(overviewFill).toMatchObject({
      animated: false,
      progress: infrastructurePercent / 100,
    });
    expect(overviewFill.progress * 100).toBe(infrastructurePercent);
  });

  test("renders ready live queues as complete without continuing animation", () => {
    expect(queueProgressFillState({
      now: 1_700_001_000_000,
      progress: 1,
      readyAt: 1_700_001_000_000,
      remaining: "Ready",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 1_000_000,
      progress: 1,
    });
  });

  test("stops canonical queue animation once elapsed time reaches readyAt", () => {
    expect(queueProgressFillState({
      now: 1_700_001_010_000,
      progress: 0.95,
      readyAt: 1_700_001_000_000,
      remaining: "Ready",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 1_000_000,
      progress: 1,
    });
  });

  test("resolves active Shipyard queues to catalog names and thumbnails", () => {
    const preview = shipQueuePreview({
      active: true,
      cost: { metal: "3000", crystal: "1000", deuterium: "0" },
      itemId: 1,
      kind: "ship",
      quantity: 2,
      readyAt: "1700000600",
    });

    expect(preview.label).toBe("Light Fighter x2");
    expect(preview.asset).toContain("light-fighter");
  });

  test("flags a research queue whose ready time has passed as ready to settle (VEY-KANEO-468)", () => {
    const queue = {
      active: true,
      cost: { metal: "800", crystal: "400", deuterium: "0" },
      itemId: 0,
      kind: "research" as const,
      readyAt: "1700000000",
      targetLevel: 2,
    };

    // Completion is now lazy on-chain, so this predicate only drives the read-model "ready" badge.
    expect(isOverviewResearchReadyToFinish(queue, 1_700_000_000_000)).toBe(true);
    expect(isOverviewResearchReadyToFinish(queue, 1_699_999_000_000)).toBe(false);
  });
});

function completedProgress(kind: ConstructionQueueKind): ConstructionProgress {
  return {
    active: false,
    bodyKind: "planet",
    complete: true,
    indeterminate: false,
    kind,
    planetId: "7",
    progress: 1,
    queue: null,
    remaining: "Idle",
  };
}

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textParts);
  return textParts((node as VNode).props?.children);
}
