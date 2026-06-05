import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import type { Coordinates } from "../src/types";
import {
  primaryRankingEntries,
  rankingsColumnLabels,
  rankingsPaginationLabel,
  RankingsPagination,
  RankingsTable,
  shouldShowRankingsInitialLoader,
} from "../src/components/RankingsPage";
import type { HighscoreEntry, HighscoreResponse } from "../src/walletFlow";

describe("RankingsPage", () => {
  test("uses one ranking table with the active category score and total context", () => {
    expect([...rankingsColumnLabels]).toEqual(["Rank", "Commander", "Planets", "Score", "Total"]);
  });

  test("renders rank, commander, planet count, canonical score, and public home coordinates", () => {
    const table = RankingsTable({ entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("Rank");
    expect(text).toContain("Commander");
    expect(text).toContain("Planets");
    expect(text).toContain("Score");
    expect(text).toContain("# 1");
    expect(text).toContain("[2:44:9]");
    expect(text).toContain("3");
    expect(text).toContain("1,500");
    expect(text).not.toContain("Planet 7");
    expect(text).toContain("Total");
  });

  test("renders the selected category score while keeping total visible", () => {
    const table = RankingsTable({ active: "fleetCount", entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("42");
    expect(text).toContain("1,500");
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

  test("uses a softer same-alliance treatment without overriding the current player highlight", () => {
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
    });

    expect(rowWithWallet(table, self.wallet)?.props?.className).toContain("bg-cyan-300");
    expect(rowWithWallet(table, ally.wallet)?.props?.className).toContain("bg-emerald-300");
    expect(rowWithWallet(table, other.wallet)?.props?.className).toContain("border-white/5");
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
  });

  test("renders compact pagination controls from highscore metadata", () => {
    const visited: string[] = [];
    const pagination = {
      page: 2,
      pageSize: 25,
      totalEntries: 60,
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

    expect(rankingsPaginationLabel(pagination)).toBe("Page 2 of 3");
    expect(text).toContain("Page 2 of 3 26 - 50 of 60 # 42");
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
      currentPlayerPage: { rank: 87, page: 4 },
      loading: false,
      onCurrentPlayer: () => visited.push(4),
      onNext: () => undefined,
      onPrevious: () => undefined,
      pagination: {
        page: 1,
        pageSize: 25,
        totalEntries: 100,
        totalPages: 4,
        hasPreviousPage: false,
        hasNextPage: true,
      },
    });
    const current = buttonWithTitle(controls, "Go to your rank");

    expect(visibleText(controls)).toContain("# 87");
    expect(current?.props?.disabled).toBe(false);
    current?.props?.onClick?.();
    expect(visited).toEqual([4]);
  });

  test("disables unavailable pagination directions", () => {
    const controls = RankingsPagination({
      loading: false,
      onNext: () => undefined,
      onPrevious: () => undefined,
      pagination: {
        page: 1,
        pageSize: 25,
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
