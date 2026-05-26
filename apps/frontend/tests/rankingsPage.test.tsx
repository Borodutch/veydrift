import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  primaryRankingEntries,
  rankingsColumnLabels,
  RankingsTable,
} from "../src/components/RankingsPage";
import type { HighscoreEntry, HighscoreResponse } from "../src/walletFlow";

describe("RankingsPage", () => {
  test("uses one clear ranking table instead of category tabs and a duplicate total column", () => {
    expect([...rankingsColumnLabels]).toEqual(["Rank", "Commander", "Planets", "Score"]);
    expect(rankingsColumnLabels).not.toContain("Total");
    expect(rankingsColumnLabels).not.toContain("Economy");
    expect(rankingsColumnLabels).not.toContain("Research");
    expect(rankingsColumnLabels).not.toContain("Fleet");
    expect(rankingsColumnLabels).not.toContain("Defense");
  });

  test("renders rank, player, planet count, and canonical score", () => {
    const table = RankingsTable({ entries: [rankingEntry()], loading: false });
    const text = visibleText(table);

    expect(text).toContain("Rank");
    expect(text).toContain("Commander");
    expect(text).toContain("Planets");
    expect(text).toContain("Score");
    expect(text).toContain("# 1");
    expect(text).toContain("Planet 7");
    expect(text).toContain("3");
    expect(text).toContain("1,500");
    expect(text).not.toContain("Total");
    expect(text).not.toContain("Economy");
    expect(text).not.toContain("Research");
    expect(text).not.toContain("Fleet");
    expect(text).not.toContain("Defense");
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
        fleet: [],
        defense: [],
      },
    };

    expect(primaryRankingEntries(data)).toEqual([entry]);
    expect(primaryRankingEntries(null)).toEqual([]);
  });
});

function rankingEntry(): HighscoreEntry {
  return {
    homePlanetId: "7",
    planetCount: 3,
    rank: 1,
    score: {
      defense: "100",
      economy: "900",
      fleet: "200",
      research: "300",
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
