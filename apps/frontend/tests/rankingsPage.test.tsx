import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import type { Coordinates } from "../src/types";
import {
  primaryRankingEntries,
  rankingsColumnLabels,
  rankingsPageSize,
  rankingsPaginationLabel,
  rankingsRefreshButtonState,
  RankingsPagination,
  RankingsTable,
  shouldShowRankingsInitialLoader,
} from "../src/components/RankingsPage";
import type { HighscoreEntry, HighscoreResponse } from "../src/walletFlow";

describe("RankingsPage", () => {
  test("uses one ranking table with the active category score and total context", () => {
    expect([...rankingsColumnLabels]).toEqual(["Rank", "Commander", "Score"]);
  });

  test("renders rank, commander, planet icons, and the active score without duplicate totals", () => {
    const table = RankingsTable({ entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("Rank");
    expect(text).toContain("Commander");
    expect(text).toContain("Score");
    expect(text).toContain("# 1");
    expect(text).toContain("1,500");
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

    expect(visibleText(table)).toContain("Unnamed planet 2890ss 4.5K 20K");
    expect(tacticalButton?.props?.title).toBe("Open [2:44:9]");
    tacticalButton?.props?.onClick?.();
    expect(selected).toEqual([{ galaxy: 2, system: 44, position: 9 }]);

    const sameOriginTable = RankingsTable({
      entries: [rankingEntry({ planets: [tacticalPlanet] })],
      loading: false,
      originCoordinates: { galaxy: 2, system: 44, position: 9 },
    });
    expect(visibleText(sameOriginTable)).toContain("Unnamed planet 0ss 4.5K 20K");
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
  });

  test("tints score-protected ranking rows red", () => {
    const protectedEntry = rankingEntry({
      attackProtection: {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked: target is protected by newbie or score-ratio protection.",
      },
    });
    const table = RankingsTable({
      entries: [protectedEntry],
      loading: false,
    });
    const row = rowWithWallet(table, protectedEntry.wallet);

    expect(row?.props?.className).toContain("bg-red-300");
    expect(visibleText(row)).toContain("Protected");
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
