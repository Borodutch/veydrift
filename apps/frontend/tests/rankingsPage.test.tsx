import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import type { Coordinates } from "../src/types";
import {
  primaryRankingEntries,
  rankingsColumnLabels,
  RankingsTable,
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
});

function rankingEntry(): HighscoreEntry {
  return {
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

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    return elementNodes(vnode.type(vnode.props));
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
