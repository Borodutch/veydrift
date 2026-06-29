import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import type { Coordinates } from "../src/types";
import type { GalaxyAction } from "../src/galaxyActions";
import {
  primaryRankingEntries,
  rankingsColumnLabels,
  rankingsPageSize,
  rankingsPaginationLabel,
  rankingsRefreshButtonState,
  RankingsCurrentPlayerIndicator,
  RankingsPagination,
  RankingsPageHeader,
  RankingsTable,
  shouldShowRankingsInitialLoader,
} from "../src/components/RankingsPage";
// The per-planet mission subtext helpers live in their own module (unit-tested in
// planetMissionSubtext.test.ts); the Rankings tests only need the planet-keyed grouping here.
import { activeMissionsByPlanetId } from "../src/planetMissionSubtext";
import type { FleetMissionSummary, HighscoreEntry, HighscoreResponse } from "../src/walletFlow";

describe("RankingsPage", () => {
  test("uses one ranking table with the active category score and total context", () => {
    expect([...rankingsColumnLabels]).toEqual(["Rank", "Commander", "Score"]);
  });

  test("renders the rankings title without the old highscores eyebrow", () => {
    const header = RankingsPageHeader({ loading: false, onRefresh: () => undefined });
    const text = visibleText(header);

    expect(text).toContain("Rankings");
    expect(text).toContain("Refresh");
    expect(text).not.toContain("Public Highscores");
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
      label: "Moon attack",
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
    const inspect = buttonWithTitle(table, "Inspect moon");
    const attack = buttonWithTitle(table, "Moon attack");

    expect(visibleText(table)).toContain("Moon Inspect Moon attack");
    expect(inspect).toBeTruthy();
    expect(attack).toBeTruthy();
    inspect?.props?.onClick?.();
    attack?.props?.onClick?.();

    expect(selectedMoons).toEqual([{ galaxy: 2, system: 44, position: 9 }]);
    expect(launched).toEqual([{ action: moonAction, planetId: "7", wallet: entry.wallet }]);
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
    const protectedEntry = rankingEntry({
      attackProtection: {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked: target is protected by newbie or score-ratio protection.",
        scoreComparison: {
          scoreType: "contract_total_user_score",
          attackerScore: "25437",
          defenderScore: "7340",
          attackerVisibleScore: "7539",
          defenderVisibleScore: "278",
          protected: false,
        },
      },
    });
    const table = RankingsTable({
      entries: [protectedEntry],
      loading: false,
    });
    const row = rowWithWallet(table, protectedEntry.wallet);

    expect(row?.props?.className).toContain("bg-red-300");
    expect(visibleText(row)).toContain("Protected");
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

function rowWithWallet(node: ComponentChildren, wallet: string): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.["data-ranking-wallet"] === wallet.toLowerCase());
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
