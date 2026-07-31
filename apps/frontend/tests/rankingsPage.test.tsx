import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import type { Coordinates } from "../src/types";
import type { GalaxyAction } from "../src/galaxyActions";
import {
  primaryRankingEntries,
  rankingsCategories,
  rankingsColumnLabels,
  rankingsCurrentPlayerRowSelector,
  rankingsErrorPresentation,
  rankingsPageSize,
  rankingsPaginationLabel,
  rankingsRefreshButtonState,
  RankingsCurrentPlayerIndicator,
  RankingsPagination,
  RankingsTable,
  scrollRankingsCurrentPlayerRow,
  shouldShowRankingsInitialLoader,
} from "../src/components/RankingsPage";
// The per-planet mission subtext helpers live in their own module (unit-tested in
// planetMissionSubtext.test.ts); the Rankings tests only need the planet-keyed grouping here.
import { activeMissionsByPlanetId } from "../src/planetMissionSubtext";
import type { FleetMissionSummary, HighscoreEntry, HighscoreResponse } from "../src/walletFlow";

describe("RankingsPage", () => {
  test("uses calm stale-state copy and actionable blocking copy without raw errors", () => {
    expect(rankingsErrorPresentation({
      error: "RPC HTTP 429 from internal-provider.example",
      hasLoadedData: true,
    })).toEqual({
      blocking: false,
      message: "Showing the latest loaded rankings. Refresh to try again.",
      title: "Rankings refresh delayed",
    });
    expect(rankingsErrorPresentation({
      error: "RPC HTTP 429 from internal-provider.example",
      hasLoadedData: false,
    })).toEqual({
      blocking: true,
      message: "Refresh to try again. If the problem continues, check back shortly.",
      title: "Rankings unavailable",
    });
  });

  test("uses one ranking table with the active category score and total context", () => {
    expect([...rankingsColumnLabels]).toEqual(["Rank", "Commander", "Score"]);
  });

  test("keeps one score-based filter for research and fleet rankings", () => {
    expect(rankingsCategories.map(({ key, label }) => [key, label])).toEqual([
      ["total", "Total"],
      ["economy", "Economy"],
      ["research", "Research"],
      ["military", "Military"],
      ["fleet", "Fleet value"],
      ["defense", "Defense"],
    ]);
  });

  test("collapses player bodies by default and toggles each commander independently", () => {
    const entry = rankingEntry();
    const toggled: string[] = [];
    const collapsed = RankingsTable({
      entries: [entry],
      expandedWallets: new Set(),
      loading: false,
      onTogglePlayerBodies: (wallet) => toggled.push(wallet),
    });
    const collapsedRow = rowWithWallet(collapsed, entry.wallet);
    const toggle = buttonWithTitle(collapsedRow, "Show 1 body");

    expect(toggle?.props?.["aria-expanded"]).toBe(false);
    expect(planetRowWithPlanetId(collapsedRow, entry.homePlanet!.planetId)).toBeUndefined();
    toggle?.props?.onClick?.();
    expect(toggled).toEqual([entry.wallet.toLowerCase()]);

    const expanded = RankingsTable({
      entries: [entry],
      expandedWallets: new Set([entry.wallet.toLowerCase()]),
      loading: false,
      onTogglePlayerBodies: () => undefined,
    });
    const expandedRow = rowWithWallet(expanded, entry.wallet);

    expect(buttonWithTitle(expandedRow, "Hide 1 body")?.props?.["aria-expanded"]).toBe(true);
    expect(planetRowWithPlanetId(expandedRow, entry.homePlanet!.planetId)).toBeTruthy();
  });

  test("renders rank, commander, planet icons, and the active score without duplicate totals", () => {
    const table = RankingsTable({ entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("Rank");
    expect(text).toContain("Commander");
    expect(text).toContain("Score");
    expect(text).toContain("# 1");
    expect(text).toContain("25,437");
    expect(text).not.toContain("1,500");
    expect(text).not.toContain("Planet 7");
    expect(text).not.toContain("Total");
    expect(buttonWithTitle(table, "Open [2:44:9]")).toBeTruthy();
  });

  test("renders only the selected category score", () => {
    const table = RankingsTable({ active: "fleetCount", entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("42");
    expect(text).not.toContain("1,500");
  });

  test("highlights the current wallet row with a non-color-only marker", () => {
    const table = RankingsTable({
      currentWallet: "0x1111111111111111111111111111111111111111".toUpperCase(),
      entries: [rankingEntry({ displayName: "Renamed Commander" })],
      loading: false,
    });
    const row = rowWithWallet(table, "0x1111111111111111111111111111111111111111");

    expect(row?.props?.["aria-current"]).toBe("true");
    expect(row?.props?.className).toContain("bg-cyan-300");
    expect(row?.props?.tabIndex).toBe(-1);
    expect(visibleText(row)).toContain("You");
  });

  test("renders canonical alliance tags before commander names and opens alliance details", () => {
    const selectedAlliances: string[] = [];
    const table = RankingsTable({
      entries: [rankingEntry({
        alliance: {
          allianceId: "3",
          name: "Veydrift Union",
          tag: "VDFT",
        },
        displayName: "Nova Prime",
      })],
      loading: false,
      onSelectAlliance: (allianceId) => selectedAlliances.push(allianceId),
    });
    const text = visibleText(table);
    const allianceButton = buttonWithTitle(table, "Open alliance VDFT");

    expect(text).toContain("[VDFT] Nova Prime");
    expect(allianceButton).toBeTruthy();
    allianceButton?.props?.onClick?.();
    expect(selectedAlliances).toEqual(["3"]);
  });

  test("uses a blue same-alliance treatment without overriding the current player highlight", () => {
    const selectedAlliances: string[] = [];
    const self = rankingEntry({
      alliance: { allianceId: "3", name: "Veydrift Union", tag: "VDFT" },
      wallet: "0x1111111111111111111111111111111111111111",
    });
    const ally = rankingEntry({
      alliance: { allianceId: "3", name: "Veydrift Union", tag: "VDFT" },
      rank: 2,
      wallet: "0x2222222222222222222222222222222222222222",
    });
    const other = rankingEntry({
      alliance: { allianceId: "4", name: "Other Union", tag: "OTHR" },
      rank: 3,
      wallet: "0x3333333333333333333333333333333333333333",
    });
    const table = RankingsTable({
      currentAllianceId: "3",
      currentWallet: self.wallet,
      entries: [self, ally, other],
      loading: false,
      onSelectAlliance: (allianceId) => selectedAlliances.push(allianceId),
    });

    expect(rowWithWallet(table, self.wallet)?.props?.className).toContain("bg-cyan-300");
    expect(rowWithWallet(table, ally.wallet)?.props?.className).toContain("bg-sky-300");
    expect(visibleText(rowWithWallet(table, ally.wallet))).toContain("[VDFT]");
    expect(visibleText(rowWithWallet(table, ally.wallet))).not.toContain("Protected");
    expect(rowWithWallet(table, other.wallet)?.props?.className).toContain("border-white/5");
    expect(visibleText(rowWithWallet(table, other.wallet))).toContain("[OTHR]");
    const allyTag = buttonWithTitle(rowWithWallet(table, ally.wallet), "Open alliance VDFT");
    const otherTag = buttonWithTitle(rowWithWallet(table, other.wallet), "Open alliance OTHR");
    expect(allyTag?.props?.className).toContain("bg-sky-400");
    expect(otherTag?.props?.className).toContain("bg-cyan-300");
    expect(allyTag?.props?.className).not.toBe(otherTag?.props?.className);
    buttonWithTitle(rowWithWallet(table, ally.wallet), "Open alliance VDFT")?.props?.onClick?.();
    buttonWithTitle(rowWithWallet(table, other.wallet), "Open alliance OTHR")?.props?.onClick?.();
    expect(selectedAlliances).toEqual(["3", "4"]);
  });

  test("opens the ranked commander's public home planet when available", () => {
    const selected: Coordinates[] = [];
    const table = RankingsTable({
      entries: [rankingEntry()],
      loading: false,
      onSelectPlanet: (coords) => selected.push(coords),
    });
    const homeButton = buttonWithTitle(table, "Open [2:44:9]");

    expect(homeButton).toBeTruthy();
    homeButton?.props?.onClick?.();

    expect(selected).toEqual([{ galaxy: 2, system: 44, position: 9 }]);
  });

  test("shows ranked home coordinates on hover even for named planets", () => {
    const table = RankingsTable({
      entries: [rankingEntry({
        homePlanet: {
          ...rankingEntry().homePlanet!,
          name: "Eos",
        },
      })],
      loading: false,
    });
    const homeButton = buttonWithTitle(table, "Open Eos [2:44:9]");

    expect(homeButton).toBeTruthy();
    expect(visibleText(table)).toContain("Eos");
    expect(visibleText(table)).not.toContain("[2:44:9]");
  });

  test("renders multiple planet icons with coordinate hover affordances", () => {
    const selected: Coordinates[] = [];
    const table = RankingsTable({
      entries: [rankingEntry({
        planets: [
          rankingEntry().homePlanet!,
          {
            archetype: "frozen-ice",
            coordinates: { galaxy: 3, system: 12, position: 4 },
            name: "Borealis",
            planetId: "8",
          },
        ],
      })],
      loading: false,
      onSelectPlanet: (coords) => selected.push(coords),
    });

    const homeButton = buttonWithTitle(table, "Open [2:44:9]");
    const colonyButton = buttonWithTitle(table, "Open Borealis [3:12:4]");

    expect(homeButton).toBeTruthy();
    expect(colonyButton).toBeTruthy();
    expect(visibleText(table)).not.toContain("[3:12:4]");
    colonyButton?.props?.onClick?.();
    expect(selected).toEqual([{ galaxy: 3, system: 12, position: 4 }]);
  });

  test("renders ranked moon action rows and launches moon-targeted actions", () => {
    const selectedMoons: Coordinates[] = [];
    const launched: Array<{ action: GalaxyAction; planetId: string; wallet: string }> = [];
    const moonAction: GalaxyAction = {
      enabled: true,
      kind: "attack",
      label: "Attack",
      mode: "mission",
      mission: "attack",
      defaultTargetIsMoon: true,
      ships: {
        smallCargo: 0,
        lightFighter: 1,
        recycler: 0,
        colonyShip: 0,
        largeCargo: 0,
        heavyFighter: 0,
        cruiser: 0,
        battleship: 0,
        bomber: 0,
        destroyer: 0,
        deathstar: 0,
        battlecruiser: 0,
        reaper: 0,
        pathfinder: 0,
      },
    };
    const entry = rankingEntry({
      homePlanet: {
        ...rankingEntry().homePlanet!,
        hasMoon: true,
      },
    });
    const table = RankingsTable({
      entries: [entry],
      loading: false,
      moonActionsForPlanet: () => [moonAction],
      onMoonAction: (action, planet, rankingEntry) => launched.push({ action, planetId: planet.planetId, wallet: rankingEntry.wallet }),
      onSelectMoon: (coords) => selectedMoons.push(coords),
    });
    const moonRow = elementWithTitle(table, "Open moon at [2:44:9]");
    const attack = buttonWithTitle(table, "Attack");

    expect(visibleText(table)).not.toContain("Moon Attack");
    expect(attack?.props?.["aria-label"]).toBe("Attack");
    expect(buttonWithTitle(table, "Inspect moon")).toBeUndefined();
    expect(moonRow).toBeTruthy();
    expect(attack).toBeTruthy();
    moonRow?.props?.onClick?.(clickEvent());
    attack?.props?.onClick?.(clickEvent());

    expect(selectedMoons).toEqual([{ galaxy: 2, system: 44, position: 9 }]);
    expect(launched).toEqual([{ action: moonAction, planetId: "7", wallet: entry.wallet }]);
  });

  test("keeps ranked moon rows inside the rankings row width", () => {
    const moonAction: GalaxyAction = {
      enabled: true,
      kind: "attack",
      label: "Attack",
      mode: "mission",
      mission: "attack",
      defaultTargetIsMoon: true,
      ships: {
        smallCargo: 0,
        lightFighter: 1,
        recycler: 0,
        colonyShip: 0,
        largeCargo: 0,
        heavyFighter: 0,
        cruiser: 0,
        battleship: 0,
        bomber: 0,
        destroyer: 0,
        deathstar: 0,
        battlecruiser: 0,
        reaper: 0,
        pathfinder: 0,
      },
    };
    const table = RankingsTable({
      entries: [rankingEntry({
        homePlanet: {
          ...rankingEntry().homePlanet!,
          hasMoon: true,
        },
      })],
      loading: false,
      moonActionsForPlanet: () => [moonAction],
      onMoonAction: () => undefined,
      onSelectMoon: () => undefined,
    });
    const nodes = elementNodes(table);
    const moonRowWrapper = nodes.find((item) => item.props?.["data-ranking-moon-row"] === "full-width");
    const moonSubsection = nodes.find((item) => item.props?.["data-planet-moon-subsection"] === "true");
    const actionWrapper = nodes.find((item) => (
      item.type === "span"
      && String(item.props?.className ?? "").includes("justify-end")
      && String(item.props?.className ?? "").includes("min-w-0")
    ));

    expect(moonRowWrapper?.props?.className).toContain("min-w-0 pl-4");
    expect(moonRowWrapper?.props?.className).not.toContain("ml-");
    expect(moonSubsection?.props?.className).toContain("min-w-0");
    expect(moonSubsection?.props?.className).not.toContain("ml-");
    expect(actionWrapper).toBeTruthy();
  });

  test("renders ranked planet action rows and launches planet-targeted actions", () => {
    const launched: Array<{ action: GalaxyAction; planetId: string; wallet: string }> = [];
    const planetAction: GalaxyAction = {
      enabled: true,
      kind: "transport",
      label: "Transport",
      mode: "mission",
      mission: "transport",
      ships: {
        smallCargo: 1,
        lightFighter: 0,
        recycler: 0,
        colonyShip: 0,
        largeCargo: 0,
        heavyFighter: 0,
        cruiser: 0,
        battleship: 0,
        bomber: 0,
        destroyer: 0,
        deathstar: 0,
        battlecruiser: 0,
        reaper: 0,
        pathfinder: 0,
      },
    };
    const entry = rankingEntry();
    const table = RankingsTable({
      entries: [entry],
      loading: false,
      onPlanetAction: (action, planet, rankingEntry) => launched.push({ action, planetId: planet.planetId, wallet: rankingEntry.wallet }),
      planetActionsForPlanet: () => [planetAction],
    });
    const transport = buttonWithTitle(table, "Transport");
    const planetRow = planetRowWithPlanetId(table, "7");

    expect(visibleText(table)).not.toContain("Transport");
    expect(visibleText(planetRow)).not.toContain("Transport");
    expect(buttonWithTitle(planetRow, "Transport")).toBeTruthy();
    expect(transport).toBeTruthy();
    transport?.props?.onClick?.(clickEvent());

    expect(launched).toEqual([{ action: planetAction, planetId: "7", wallet: entry.wallet }]);
  });

  test("keeps the primary attack affordance visible while it is unavailable", () => {
    const planetAction: GalaxyAction = {
      enabled: false,
      kind: "attack",
      label: "Attack",
      mode: "mission",
      mission: "attack",
      reason: "Attack unavailable.",
    };
    const table = RankingsTable({
      entries: [rankingEntry()],
      loading: false,
      planetActionsForPlanet: () => [planetAction],
    });
    const planetRow = planetRowWithPlanetId(table, "7");

    expect(planetRow).toBeTruthy();
    expect(visibleText(planetRow)).not.toContain("Attack");
    expect(buttonWithTitle(planetRow, "Attack: Attack unavailable.")?.props?.disabled).toBe(true);
  });

  test("marks the home planet inside the planet list instead of commander subtext", () => {
    const entry = rankingEntry({
      homePlanet: {
        ...rankingEntry().homePlanet!,
        name: "Eos",
      },
      planets: [
        {
          ...rankingEntry().homePlanet!,
          name: "Eos",
        },
        {
          archetype: "frozen-ice",
          coordinates: { galaxy: 3, system: 12, position: 4 },
          name: "Borealis",
          planetId: "8",
        },
      ],
    });
    const table = RankingsTable({ entries: [entry], loading: false });
    const row = rowWithWallet(table, entry.wallet);
    const homeButton = buttonWithTitle(row, "Open Eos [2:44:9]");
    const colonyButton = buttonWithTitle(row, "Open Borealis [3:12:4]");
    const commanderSubline = elementNodes(row).find(
      (item) => item.type === "span" && item.props?.title === "Eos [2:44:9]"
    );

    expect(commanderSubline).toBeUndefined();
    expect(visibleText(homeButton)).toContain("[HOME] Eos");
    expect(visibleText(colonyButton)).toContain("Borealis");
    expect(visibleText(colonyButton)).not.toContain("[HOME]");
  });

  test("renders compact tactical planet sub-lists from indexed payload fields", () => {
    const selected: Coordinates[] = [];
    const tacticalPlanet = {
      ...rankingEntry().homePlanet!,
      tactical: {
        raidableResources: {
          metal: "1500",
          crystal: "2500",
          deuterium: "500",
        },
        raidableResourceTotal: "4500",
        ships: {
          count: 3,
          power: "12000",
        },
        defenses: {
          count: 2,
          power: "8000",
        },
        combatPower: "20000",
      },
    };
    const table = RankingsTable({
      entries: [rankingEntry({ planets: [tacticalPlanet] })],
      loading: false,
      onSelectPlanet: (coords) => selected.push(coords),
      originCoordinates: { galaxy: 2, system: 42, position: 9 },
    });
    const tacticalButton = buttonWithTitle(table, "Open [2:44:9]");
    const planetHeader = elementNodes(table).find((item) => item.type === "span" && visibleText(item) === "Planet");

    expect(visibleText(table)).toContain("[2:44:9] Dist 2,890 ss Loot 4.5K Combat 20K");
    expect(visibleText(table)).toContain("2,890 ss 4.5K 20K");
    expect(visibleText(table)).not.toContain("2890ss");
    expect(visibleText(table)).not.toContain("Unnamed planet");
    expect(planetHeader?.props?.className).toContain("col-span-2");
    expect(tacticalButton?.props?.title).toBe("Open [2:44:9]");
    tacticalButton?.props?.onClick?.();
    expect(selected).toEqual([{ galaxy: 2, system: 44, position: 9 }]);

    const sameOriginTable = RankingsTable({
      entries: [rankingEntry({ planets: [tacticalPlanet] })],
      loading: false,
      originCoordinates: { galaxy: 2, system: 44, position: 9 },
    });
    expect(visibleText(sameOriginTable)).toContain("[2:44:9] Dist 0 ss Loot 4.5K Combat 20K");

    const longDistanceTable = RankingsTable({
      entries: [rankingEntry({ planets: [tacticalPlanet] })],
      loading: false,
      originCoordinates: { galaxy: 7, system: 44, position: 9 },
    });
    expect(visibleText(longDistanceTable)).toContain("[2:44:9] Dist 100K ss Loot 4.5K Combat 20K");
    expect(visibleText(longDistanceTable)).not.toContain("100000ss");
  });

  test("renders same-alliance blocking as ally styling instead of protected styling", () => {
    const allyEntry = rankingEntry({
      alliance: { allianceId: "3", name: "Veydrift Union", tag: "VDFT" },
      attackProtection: {
        allowed: false,
        blockedReason: "same_alliance",
        blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
      },
    });
    const table = RankingsTable({
      currentAllianceId: "3",
      currentWallet: "0x2222222222222222222222222222222222222222",
      entries: [allyEntry],
      loading: false,
    });
    const row = rowWithWallet(table, allyEntry.wallet);

    expect(row?.props?.className).toContain("bg-sky-300");
    expect(row?.props?.className).not.toContain("bg-red-300");
    expect(visibleText(row)).toContain("[VDFT]");
    expect(visibleText(row)).not.toContain("Protected");
    expect(visibleText(row)).toContain("Ally [VDFT]");
  });

  test("tints score-protected ranking rows red without rendering numeric protection scores", () => {
    const blockedReasonLabel = "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.";
    const protectedEntry = rankingEntry({
      attackProtection: {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel,
        scoreComparison: {
          scoreType: "contract_total_user_score",
          attackerScore: "25437",
          defenderScore: "7340",
          attackerVisibleScore: "7539",
          defenderVisibleScore: "278",
          protected: true,
        },
      },
    });
    const table = RankingsTable({
      entries: [protectedEntry],
      loading: false,
      onPlanetAction: () => {
        throw new Error("a disabled protected action must not fire");
      },
      planetActionsForPlanet: () => [{
        enabled: false,
        kind: "attack",
        label: "Attack",
        mission: "attack",
        mode: "mission",
        reason: blockedReasonLabel,
      }],
    });
    const row = rowWithWallet(table, protectedEntry.wallet);
    const protectedAction = buttonWithTitle(row, `Protected: ${blockedReasonLabel}`);

    expect(row?.props?.className).toContain("bg-red-300");
    expect(visibleText(row)).toContain("Score protected");
    const protectionBadge = elementNodes(row).find((item) => item.props?.title === blockedReasonLabel);
    expect(visibleText(protectionBadge)).toContain("Score protected");
    expect(protectedAction?.props?.disabled).toBe(true);
    expect(visibleText(protectedAction)).toBe("");
    expect(visibleText(row)).toContain("25,437");
    expect(visibleText(row)).not.toContain("Score 25,437 vs 7,340");
    expect(visibleText(row)).not.toContain("7,340");
    expect(visibleText(row)).not.toContain("Protection score");
  });

  test("renders an AFK flair for inactive ranking defenders", () => {
    const inactiveEntry = rankingEntry({
      attackProtection: {
        allowed: true,
        blockedReason: "none",
        blockedReasonLabel: null,
        defenderInactive: true,
      },
    });
    const table = RankingsTable({
      entries: [inactiveEntry],
      loading: false,
    });
    const row = rowWithWallet(table, inactiveEntry.wallet);

    expect(visibleText(row)).toContain("AFK");
    expect(visibleText(row)).not.toContain("Protected");
  });

  test("opens the ranked commander inspect page from the commander label", () => {
    const selectedPlayers: string[] = [];
    const table = RankingsTable({
      entries: [rankingEntry({ displayName: "Nova Prime" })],
      loading: false,
      onSelectPlayer: (wallet) => selectedPlayers.push(wallet),
    });
    const playerButton = buttonWithTitle(table, "Open player Nova Prime");

    expect(playerButton).toBeTruthy();
    playerButton?.props?.onClick?.();
    expect(selectedPlayers).toEqual(["0x1111111111111111111111111111111111111111"]);
  });

  test("serves ranked home planet thumbnails through responsive variants", () => {
    const table = RankingsTable({ entries: [rankingEntry()], loading: false });
    const image = elementNodes(table).find((item) => item.type === "img" && item.props?.alt === "");

    expect(image?.props?.src).toBe("/assets/game/style-pass/generated/planets/temperate-ocean.webp");
    expect(image?.props?.sizes).toBe("40px");
    expect(image?.props?.srcSet).toContain("/assets/game/sizes/64/style-pass/generated/planets/temperate-ocean.webp 64w");
    expect(image?.props?.srcSet).toContain("/assets/game/style-pass/generated/planets/temperate-ocean.webp 1024w");
  });

  test("reads the canonical total ranking from the existing highscore payload", () => {
    const entry = rankingEntry();
    const data: HighscoreResponse = {
      generatedAt: "2026-05-26T00:00:00.000Z",
      formula: {
        pointsDivisor: "1000",
        summary: "Veydrift score",
      },
      rankings: {
        total: [entry],
        economy: [],
        research: [],
        researchLevels: [],
        military: [],
        fleet: [],
        fleetCount: [],
        defense: [],
      },
    };

    expect(primaryRankingEntries(data)).toEqual([entry]);
    expect(primaryRankingEntries(null)).toEqual([]);
  });

  test("keeps an empty loaded ranking category visible during background refresh", () => {
    expect(shouldShowRankingsInitialLoader({
      hasLoadedData: false,
      loading: true,
    })).toBe(true);
    expect(shouldShowRankingsInitialLoader({
      hasLoadedData: true,
      loading: true,
    })).toBe(false);
    expect(shouldShowRankingsInitialLoader({
      hasLoadedData: true,
      loading: true,
      viewTransitioning: true,
    })).toBe(true);

    const table = RankingsTable({
      entries: [],
      hasLoadedData: true,
      loading: true,
    });
    const text = visibleText(table);

    expect(text).toContain("No settled commanders indexed yet");
    expect(text).not.toContain("Loading rankings");
    expect(text).not.toContain("Refreshing rankings");
  });

  test("shows row skeletons while changing ranking filters or pages", () => {
    const table = RankingsTable({
      entries: [rankingEntry()],
      hasLoadedData: true,
      loading: true,
      viewTransitioning: true,
    });
    const text = visibleText(table);

    expect(text).toContain("Loading rankings");
    expect(text).not.toContain("Commander One");
  });

  test("uses the refresh button as the rankings background refresh indicator", () => {
    expect(rankingsRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(rankingsRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });
  });

  test("renders a top current-player rank indicator with the visible active-category score", () => {
    const visited: string[] = [];
    const indicator = RankingsCurrentPlayerIndicator({
      currentPlayerPage: { rank: 42, page: 2 },
      currentScore: "1500",
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: false,
      onCurrentPlayer: () => visited.push("current"),
    });
    const button = buttonWithTitle(indicator, "Go to your rank");

    expect(visibleText(indicator)).toContain("Your rank: # 42 1,500");
    expect(visibleText(indicator)).toContain("Jump to your row");
    expect(button?.props?.["aria-label"]).toBe("Your rank is 42");
    expect(button?.props?.disabled).toBe(false);
    button?.props?.onClick?.();
    expect(visited).toEqual(["current"]);
  });

  test("omits the jump affordance when the current player has no rank to jump to", () => {
    const indicator = RankingsCurrentPlayerIndicator({
      currentPlayerPage: null,
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: false,
      onCurrentPlayer: () => undefined,
    });

    expect(visibleText(indicator)).toContain("Your rank: Unranked");
    expect(visibleText(indicator)).not.toContain("Jump to your row");
  });

  test("shows a rank skeleton during initial loads and ranking view changes", () => {
    const transitioning = RankingsCurrentPlayerIndicator({
      currentPlayerPage: null,
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: true,
      viewTransitioning: true,
    });
    const initial = RankingsCurrentPlayerIndicator({
      currentPlayerPage: null,
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: false,
      loading: true,
    });

    expect(visibleText(transitioning)).toContain("Loading your rank");
    expect(visibleText(transitioning)).not.toContain("Unranked");
    expect(visibleText(initial)).toContain("Loading your rank");
  });

  test("updates the current-player rank indicator from the selected category payload", () => {
    const totalIndicator = RankingsCurrentPlayerIndicator({
      currentPlayerPage: { rank: 9, page: 1 },
      currentScore: "1500",
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: false,
      onCurrentPlayer: () => undefined,
    });
    const fleetIndicator = RankingsCurrentPlayerIndicator({
      currentPlayerPage: { rank: 3, page: 1 },
      currentScore: "200",
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: false,
      onCurrentPlayer: () => undefined,
    });

    expect(visibleText(totalIndicator)).toContain("Your rank: # 9 1,500");
    expect(visibleText(fleetIndicator)).toContain("Your rank: # 3 200");
  });

  test("handles unranked and no-wallet current-player indicator states", () => {
    const unranked = RankingsCurrentPlayerIndicator({
      currentPlayerPage: null,
      currentWallet: "0x1111111111111111111111111111111111111111",
      hasLoadedData: true,
      loading: false,
      onCurrentPlayer: () => undefined,
    });

    expect(visibleText(unranked)).toContain("Your rank: Unranked");
    expect(buttonWithTitle(unranked, "Your rank is unavailable")?.props?.disabled).toBe(true);
    expect(RankingsCurrentPlayerIndicator({
      currentPlayerPage: { rank: 1, page: 1 },
      currentWallet: undefined,
      hasLoadedData: true,
      loading: false,
    })).toBeNull();
  });

  test("scrolls and focuses the current player's ranking row", () => {
    const selectors: string[] = [];
    const calls: string[] = [];
    const wallet = "0x1111111111111111111111111111111111111111";
    const row = {
      focus: (options?: FocusOptions) => calls.push(`focus:${String(options?.preventScroll)}`),
      scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(`scroll:${options?.block}:${options?.inline}:${options?.behavior}`),
    };
    const container = {
      querySelector: (selector: string) => {
        selectors.push(selector);
        return row;
      },
    };

    expect(rankingsCurrentPlayerRowSelector(wallet.toUpperCase())).toBe(`[data-ranking-wallet="${wallet}"]`);
    expect(scrollRankingsCurrentPlayerRow(container, wallet.toUpperCase())).toBe(true);
    expect(selectors).toEqual([`[data-ranking-wallet="${wallet}"]`]);
    expect(calls).toEqual(["scroll:center:nearest:smooth", "focus:true"]);
  });

  test("reports unavailable current-player rows without scrolling", () => {
    const selectors: string[] = [];
    const container = {
      querySelector: (selector: string) => {
        selectors.push(selector);
        return null;
      },
    };

    expect(scrollRankingsCurrentPlayerRow(container, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(scrollRankingsCurrentPlayerRow(container, undefined)).toBe(false);
    expect(selectors).toEqual(["[data-ranking-wallet=\"0x1111111111111111111111111111111111111111\"]"]);
  });

  test("renders compact pagination controls from highscore metadata", () => {
    const visited: string[] = [];
    const pagination = {
      page: 2,
      pageSize: rankingsPageSize,
      totalEntries: 125,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    };
    const controls = RankingsPagination({
      currentPlayerPage: { rank: 42, page: 2 },
      loading: false,
      onCurrentPlayer: () => visited.push("current"),
      onNext: () => visited.push("next"),
      onPrevious: () => visited.push("previous"),
      pagination,
    });
    const text = visibleText(controls);
    const current = buttonWithTitle(controls, "Go to your rank");
    const previous = buttonWithTitle(controls, "Previous page");
    const next = buttonWithTitle(controls, "Next page");

    expect(rankingsPageSize).toBe(50);
    expect(rankingsPaginationLabel(pagination)).toBe("Page 2 of 3");
    expect(text).toContain("Page 2 of 3 51 - 100 of 125 # 42");
    expect(current?.props?.disabled).toBe(true);
    expect(previous?.props?.disabled).toBe(false);
    expect(next?.props?.disabled).toBe(false);
    previous?.props?.onClick?.();
    next?.props?.onClick?.();
    expect(visited).toEqual(["previous", "next"]);
  });

  test("jumps directly to the current player's ranking page when available", () => {
    const visited: number[] = [];
    const controls = RankingsPagination({
      currentPlayerPage: { rank: 87, page: 2 },
      loading: false,
      onCurrentPlayer: () => visited.push(2),
      onNext: () => undefined,
      onPrevious: () => undefined,
      pagination: {
        page: 1,
        pageSize: rankingsPageSize,
        totalEntries: 100,
        totalPages: 2,
        hasPreviousPage: false,
        hasNextPage: true,
      },
    });
    const current = buttonWithTitle(controls, "Go to your rank");

    expect(visibleText(controls)).toContain("# 87");
    expect(current?.props?.disabled).toBe(false);
    current?.props?.onClick?.();
    expect(visited).toEqual([2]);
  });

  test("disables unavailable pagination directions", () => {
    const controls = RankingsPagination({
      loading: false,
      onNext: () => undefined,
      onPrevious: () => undefined,
      pagination: {
        page: 1,
        pageSize: rankingsPageSize,
        totalEntries: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });

    expect(buttonWithTitle(controls, "Previous page")?.props?.disabled).toBe(true);
    expect(buttonWithTitle(controls, "Next page")?.props?.disabled).toBe(true);
    expect(visibleText(controls)).toContain("0 - 0 of 0");
  });
});

describe("RankingsPage active mission subtext", () => {
  const NOW_MS = 1_700_000_000_000;
  const NOW_SECONDS = Math.floor(NOW_MS / 1_000);

  test("files each active mission under both its origin and target planet", () => {
    const mission = activeMission({ originPlanetId: "10", targetPlanetId: "7" });
    const byPlanet = activeMissionsByPlanetId([mission]);

    expect(byPlanet.get("10")).toEqual([mission]);
    expect(byPlanet.get("7")).toEqual([mission]);
  });

  test("files a self-targeting mission once", () => {
    const mission = activeMission({ originPlanetId: "5", targetPlanetId: "5" });
    const byPlanet = activeMissionsByPlanetId([mission]);

    expect(byPlanet.get("5")).toEqual([mission]);
  });

  // Per-planet mission line labeling, owner/third-party classification, colonize-coordinate decoding,
  // and sorting/overflow are unit-tested directly against the helper in planetMissionSubtext.test.ts
  // (and decodeColonizationTargetId in walletFlow.test.ts). The Rankings tests below cover only the
  // component-level rendering of that subtext.

  test("renders the planet mission subtext under the planet row for every commander (full transparency)", () => {
    const entry = rankingEntry();
    const missionsByPlanetId = activeMissionsByPlanetId([
      activeMission({ arrivalAt: String(NOW_SECONDS + 720), missionType: "Attack", originPlanetId: "10", targetPlanetId: "7" }),
    ]);
    const table = RankingsTable({
      entries: [entry],
      loading: false,
      missionsByPlanetId,
      now: NOW_MS,
    });
    const list = elementNodes(table).find((item) => item.props?.["data-planet-missions"] === "7");

    expect(list).toBeTruthy();
    // The mission owner (0x9999…) differs from the ranked commander (0x1111…), so it reads as a
    // third-party incoming attack that names the attacker (owner/third-party classification rework).
    expect(visibleText(list)).toContain("Incoming Attack from 0x9999...9999 · 12m");
  });

  test("shows no mission subtext for a planet with no active missions", () => {
    const table = RankingsTable({
      entries: [rankingEntry()],
      loading: false,
      missionsByPlanetId: activeMissionsByPlanetId([]),
      now: NOW_MS,
    });

    expect(elementNodes(table).some((item) => item.props?.["data-planet-missions"])).toBe(false);
  });
});

function activeMission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    arrivalAt: "1700000720",
    attackGroupId: null,
    blockNumber: "1",
    cargo: { crystal: "0", deuterium: "0", metal: "0" },
    fuelCost: "0",
    joinedAttackMissionIds: [],
    missionId: "1",
    missionType: "Attack",
    originPlanet: planetRef("10", "1:2:3"),
    originPlanetId: "10",
    owner: "0x9999999999999999999999999999999999999999",
    recallCost: null,
    returnAt: "1700003600",
    ships: {},
    status: "Outbound",
    targetPlanet: planetRef("7", "2:44:9"),
    targetPlanetId: "7",
    transactionHash: "0xabc",
    ...overrides,
  };
}

function planetRef(planetId: string, coordinates: string): FleetMissionSummary["originPlanet"] {
  const [galaxy, system, position] = coordinates.split(":").map((part) => Number(part));
  return {
    archetype: "temperate-ocean",
    coordinates,
    galaxy: galaxy ?? 1,
    name: null,
    owner: "0x9999999999999999999999999999999999999999",
    ownerDisplayName: null,
    planetId,
    position: position ?? 1,
    system: system ?? 1,
  };
}

function rankingEntry(overrides: Partial<HighscoreEntry> = {}): HighscoreEntry {
  return {
    alliance: null,
    homePlanet: {
      archetype: "temperate-ocean",
      coordinates: {
        galaxy: 2,
        system: 44,
        position: 9,
      },
      name: null,
      planetId: "7",
    },
    homePlanetId: "7",
    planetCount: 3,
    rank: 1,
    score: {
      defense: "100",
      economy: "900",
      fleet: "200",
      fleetCount: "42",
      military: "300",
      research: "300",
      researchLevels: "12",
      total: "1500",
    },
    totalUserScore: "25437",
    wallet: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}

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
  return textParts(vnode.props?.children as ComponentChildren);
}

function buttonWithTitle(node: ComponentChildren, title: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "button" && item.props?.title === title);
}

function elementWithTitle(node: ComponentChildren, title: string): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.title === title);
}

function clickEvent(): MouseEvent {
  return {
    currentTarget: null,
    stopPropagation: () => undefined,
    target: null,
  } as unknown as MouseEvent;
}

function rowWithWallet(node: ComponentChildren, wallet: string): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.["data-ranking-wallet"] === wallet.toLowerCase());
}

function planetRowWithPlanetId(node: ComponentChildren, planetId: string): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.["data-ranking-planet-row"] === planetId);
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return elementNodes(vnode.type(vnode.props));
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
