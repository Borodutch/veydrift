import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  overviewHeroImage,
} from "../src/overviewHeroImage";
import { productionQueueViewModel } from "../src/components/ProductionCatalog";
import { planetMoonIndicatorSizeClasses } from "../src/components/PlanetMoonIndicator";
import {
  isOverviewResearchReadyToFinish,
  compactOverviewLevelLabel,
  compactOverviewResearchLabel,
  EmptyQueue,
  OverviewQueueFallback,
  overviewBuildingActionNoticeFor,
  overviewResearchActionNoticeFor,
} from "../src/components/OverviewPage";
import type { ConstructionProgress, ConstructionQueueKind } from "../src/constructionProgress";
import {
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
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

describe("overview planet hero image", () => {
  test("makes only the desktop Overview moon 150% larger while preserving mobile sizing", () => {
    expect(planetMoonIndicatorSizeClasses({ overviewHero: true })).toBe(
      "h-11 w-11 xl:h-[30px] xl:w-[30px]",
    );
    expect(planetMoonIndicatorSizeClasses()).toBe("h-11 w-11 xl:h-5 xl:w-5");
    expect(30 / 20).toBe(1.5);
    expect(overviewSource).toContain("<PlanetMoonIndicator");
    expect(overviewSource).toContain("overviewHero");
    expect(overviewSource).toContain('className="right-3 top-3"');
    expect(overviewSource).toContain("onSelectMoon({ galaxy: homePlanet.galaxy, system: homePlanet.system, position: homePlanet.position })");
  });

  test("does not render commander identity in the Overview banner", () => {
    const commanderIndex = overviewSource.indexOf(">Commander<");
    const planetHeroIndex = overviewSource.indexOf("Planet hero");
    const fleetsSummaryIndex = overviewSource.indexOf("<FleetsSummary");

    expect(commanderIndex).toBe(-1);
    expect(planetHeroIndex).toBeGreaterThanOrEqual(0);
    expect(fleetsSummaryIndex).toBeGreaterThanOrEqual(0);
    expect(planetHeroIndex).toBeLessThan(fleetsSummaryIndex);
  });

  test("renders the planet art as a compact banner background with primary planet identity", () => {
    expect(overviewSource).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.82fr)]");
    expect(overviewSource).toContain("const shouldShowFleetsSummary = Boolean(isWalletConnected && fleetVisibility)");
    expect(overviewSource).toContain("relative min-h-[8.75rem]");
    expect(overviewSource).toContain('alt="Planet hero background"');
    expect(overviewSource).toContain("object-cover object-center");
    expect(overviewSource).toContain("opacity-95");
    expect(overviewSource).toContain("bg-gradient-to-r from-[#101624]/80 via-[#101624]/45 to-[#101624]/10");
    expect(overviewSource).toContain("text-2xl font-semibold leading-none text-white drop-shadow sm:text-3xl");
    expect(overviewSource).toContain("lg:items-stretch");
    expect(overviewSource).toContain('className="flex h-full min-w-0 flex-col rounded-lg border border-white/10 bg-white/[0.04] p-3 sm:p-4"');
    expect(overviewSource).not.toContain("fleetVisibility && hasActiveFleets");
    expect(overviewSource).not.toContain("fleetVisibility && !hasActiveFleets");
    expect(overviewSource).not.toContain("grid-cols-[5.75rem_minmax(0,1fr)]");
    expect(overviewSource).not.toContain("relative aspect-square");
    expect(overviewSource).not.toContain('sizes="hero"');
  });

  test("never fabricates a planet hero image without real planet data", () => {
    // Disconnected / pre-load must not invent a planet image; the caller renders a
    // skeleton/connect-wallet state instead (VEY-KANEO-458).
    expect(overviewHeroImage(undefined, undefined, undefined)).toBeUndefined();
    expect(overviewHeroImage(undefined, undefined, "1:42:7")).toBeUndefined();
  });

  test("keeps a real connected home image during rehydration", () => {
    expect(overviewHeroImage(homePlanet, undefined, "1:42:7")).toBe(homePlanet.image);
    expect(overviewHeroImage(
      undefined,
      { image: homePlanet.image, planetKey: "1:42:7" },
      "1:42:7"
    )).toBe(homePlanet.image);
  });

  test("does not reuse a last-known image for a different current planet", () => {
    expect(overviewHeroImage(
      undefined,
      { image: homePlanet.image, planetKey: "1:42:7" },
      "1:42:8"
    )).toBeUndefined();
  });

  test("does not render a fabricated planet identity; disconnected shows a connect-wallet state", () => {
    // Guard for VEY-KANEO-458: the Overview must never hardcode a fake planet name/image, and the
    // disconnected state must prompt to connect a wallet rather than showing a fake home planet.
    expect(overviewSource).not.toContain("Eos Relay");
    expect(overviewSource).toContain("Connect your wallet");
  });
});

describe("overview queue progress display", () => {
  test("renders empty queue states when completed centralized progress outlives stale Overview fallbacks", () => {
    expect(overviewSource.match(/<OverviewQueueFallback/g)?.length).toBe(3);
    expect(overviewSource).toContain("progressState={constructionProgress?.building}");
    expect(overviewSource).toContain("progressState={constructionProgress?.research}");
    expect(overviewSource).toContain("progressState={constructionProgress?.ship}");

    const cases = [
      {
        actionLabel: "Build",
        emptyLabel: "No active construction.",
        kind: "building" as const,
        staleLabel: "Metal Mine 12",
      },
      {
        actionLabel: "Research",
        emptyLabel: "No active research.",
        kind: "research" as const,
        staleLabel: "Energy Technology 9",
      },
      {
        actionLabel: "Shipyard",
        emptyLabel: "No active ship production.",
        kind: "ship" as const,
        staleLabel: "Small Cargo",
      },
    ];

    for (const queueCase of cases) {
      const rendered = OverviewQueueFallback({
        progressState: completedProgress(queueCase.kind),
        queue: { label: queueCase.staleLabel },
        renderEmpty: () => EmptyQueue({
          actionLabel: queueCase.actionLabel,
          children: queueCase.emptyLabel,
          onAction: () => undefined,
        }),
        renderQueue: (queue) => queue.label,
      });
      const text = visibleText(rendered);

      expect(text).toContain(queueCase.emptyLabel);
      expect(text).toContain(queueCase.actionLabel);
      expect(text).not.toContain(queueCase.staleLabel);
    }
  });

  test("retains local queue fallbacks when centralized progress is absent", () => {
    const rendered = OverviewQueueFallback({
      progressState: undefined,
      queue: { label: "Local Metal Mine 2" },
      renderEmpty: () => "No active construction.",
      renderQueue: (queue) => queue.label,
    });

    expect(visibleText(rendered)).toBe("Local Metal Mine 2");
  });

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

  test("allows long active building names to wrap beside queue metadata", () => {
    expect(overviewQueueItemLabelClassName).not.toContain("truncate");
    expect(overviewQueueItemLabelClassName).toContain("break-words");
    expect(overviewQueueItemRemainingClassName).not.toContain("shrink-0");
  });

  test("uses the shared anchored action layout for production queue cards", () => {
    for (const actionLabel of ["Build", "Defenses", "Research", "Shipyard"]) {
      expect(overviewSource).toContain(`actionLabel="${actionLabel}"`);
    }

    expect(overviewSource.match(/<QueuePanelContent>/g)?.length).toBeGreaterThanOrEqual(8);
    expect(overviewSource).toContain("function QueuePanelContent");
    expect(overviewSource).toContain("flex min-h-0 flex-1 flex-col gap-2");
    expect(overviewSource).toContain("mt-auto flex min-h-9 w-full min-w-0");
    expect(overviewSource).toContain("<ArrowRight");
    expect(overviewSource).not.toContain("max-w-[calc(100vw-1.5rem)]");
  });

  test("reuses the compact production queue rail for Overview defense and shipyard queues", () => {
    expect(overviewSource).toContain("productionQueueViewModel(onChainQueues?.defense, defenseCatalog)");
    expect(overviewSource).toContain("productionQueueViewModel(onChainQueues?.ship, shipCatalog)");
    expect(overviewSource.match(/<ProductionQueuePanel/g)?.length).toBe(2);
    expect(overviewSource.match(/<ProductionQueuePanel\s+embedded/g)?.length).toBe(2);
    expect(overviewSource).toContain("queue={onChainDefenseQueue}");
    expect(overviewSource).toContain("queue={onChainShipQueue}");
    expect(overviewSource).not.toContain("Queued next");
    expect(overviewSource).not.toContain('tag={onChainQueues?.defense?.active ? "Active" : undefined}');
    expect(overviewSource).not.toContain('tag={onChainQueues?.ship?.active ? "Active" : undefined}');
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

  test("passes catalog thumbnails into active research queues", () => {
    expect(overviewSource).toContain("researchCatalog");
    expect(overviewSource).toContain("thumbnailSrc={onChainResearchAsset}");
    expect(overviewSource).toContain("thumbnailSrc={settledResearchAsset}");
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

  test("shows building finish action notices for the active overview queue", () => {
    const notice = {
      buildingKey: "shipyard" as const,
      label: "Can't check game state right now.",
      tone: "error" as const,
    };

    expect(overviewBuildingActionNoticeFor(notice, "shipyard")).toBe(notice);
    expect(overviewBuildingActionNoticeFor(notice, "metalMine")).toBeUndefined();
    expect(overviewBuildingActionNoticeFor(notice, undefined)).toBe(notice);
  });

  test("keeps research completion success copy out of the compact Overview card", () => {
    expect(overviewResearchActionNoticeFor({
      status: "success",
      label: "Research completion confirmed.",
    })).toBeUndefined();

    expect(overviewResearchActionNoticeFor({
      status: "pending",
      label: "Research completion: awaiting wallet",
    })).toEqual({
      label: "Research completion: awaiting wallet",
      tone: "pending",
    });

    expect(overviewResearchActionNoticeFor({
      status: "error",
      label: "Research completion failed.",
    })).toEqual({
      label: "Research completion failed.",
      tone: "error",
    });
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
