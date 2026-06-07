import { describe, expect, test } from "bun:test";

import { MissionDetailPage } from "./components/MissionDetailPage";
import { MissionControlPage } from "./components/MissionControlPage";
import { buildInspectHash, parseInspectRoute } from "./inspectRoutes";
import { fetchBattleReports, fetchMission, type BattleReport, type FleetMissionSummary } from "./walletFlow";

describe("Mission Control battle reports", () => {
  test("builds shareable report list and detail routes", () => {
    expect(parseInspectRoute("#/battle-reports")).toEqual({ kind: "page", page: "battle-reports" });
    expect(buildInspectHash({ kind: "page", page: "battle-reports" })).toBe("#/battle-reports");
    expect(parseInspectRoute("#/battle-report/42")).toEqual({ kind: "battle-report", missionId: "42" });
    expect(buildInspectHash({ kind: "battle-report", missionId: "42" })).toBe("#/battle-report/42");
    expect(parseInspectRoute("#/mission/42")).toEqual({ kind: "mission", missionId: "42" });
    expect(buildInspectHash({ kind: "mission", missionId: "42" })).toBe("#/mission/42");
  });

  test("fetches public battle report lists without wallet scope", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify([battleReport("42")]), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await expect(fetchBattleReports("https://api.example.test/")).resolves.toMatchObject([
        { missionId: "42", outcome: "AttackerWin" },
      ]);
      expect(requestedUrls).toEqual(["https://api.example.test/battle-reports"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches a single mission without wallet scope", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ mission: mission("42"), battleReport: battleReport("42") }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await expect(fetchMission("https://api.example.test/", "42")).resolves.toMatchObject({
        mission: { missionId: "42" },
        battleReport: { missionId: "42" },
      });
      expect(requestedUrls).toEqual(["https://api.example.test/mission/42"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("renders player-facing fleet dashboard copy and report actions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage({
      actionState: { status: "idle" },
      canTransact: true,
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [mission("31", "Attack", "Outbound", "0x2222222222222222222222222222222222222222", "8", "7", now + 60_000)],
        outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
        returning: [mission("33", "Deploy", "Returning", "0x1111111111111111111111111111111111111111", "9", "7", now - 60_000)],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("31")],
      },
      loading: false,
      now,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenBattleReport: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
    })).join(" ");

    expect(text).toContain("Mission Control");
    expect(text).toContain("Watch inbound attacks");
    expect(text).toContain("Fleet movement");
    expect(text).toContain("Hostile inbound");
    expect(text).toContain("Returns");
    expect(text).toContain("Past missions");
    expect(text).toContain("Commander 0x2222...2222");
    expect(text).toContain("Origin Planet #8");
    expect(text).toContain("Target Planet #7");
    expect(text).toContain("Ships Small Cargo x3");
    expect(text).toContain("Group defend");
    expect(text).toContain("Intercept");
    expect(text).toContain("Open report");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Battle reports");
    expect(text).not.toContain("Fleet Operations");
    expect(text).not.toContain("contract-supported");
    expect(text).not.toContain("Contract-indexed");
    expect(text).not.toContain("ACS");
  });

  test("renders shareable mission detail stages, actions, and OGame-style report structure", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage({
      account: "0x1111111111111111111111111111111111111111",
      canTransact: true,
      detail: {
        mission: {
          ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          needsResolution: true,
        },
        battleReport: battleReport("42"),
      },
      loading: false,
      missionId: "42",
      now,
      onBack: () => undefined,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onOpenBattleReport: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      shareUrl: "https://test.veydrift.com/#/mission/42",
    })).join(" ");

    expect(text).toContain("Mission #42");
    expect(text).not.toContain("Mission Detail");
    expect(text).toContain("Needs resolution");
    expect(text).toContain("Resolve battle");
    expect(text).toContain("OGame-Style Battle Report");
    expect(text).toContain("Attacker vs Defender");
    expect(text).toContain("Combat Classes");
    expect(text).toContain("Ships And Defences");
    expect(text).toContain("Debris to recyclers");
  });
});

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [String(node)];
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: { children?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: { children?: unknown }) => unknown;
    if (render.name === "Icon") return [];
    return collectText(render({ ...(vnode.props ?? {}) }));
  }
  return collectText(vnode.props?.children);
}

function mission(
  missionId: string,
  missionType = "Attack",
  status = "Outbound",
  owner = "0x1111111111111111111111111111111111111111",
  originPlanetId = "7",
  targetPlanetId = "9",
  arrivalMs = Date.parse("2026-06-05T12:01:00.000Z"),
): FleetMissionSummary {
  return {
    missionId,
    status,
    missionType,
    owner,
    originPlanetId,
    targetPlanetId,
    arrivalAt: Math.floor(arrivalMs / 1_000).toString(),
    returnAt: Math.floor((arrivalMs + 60_000) / 1_000).toString(),
    fuelCost: "100",
    recallCost: "50",
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "1200", crystal: "300", deuterium: "0" },
    ships: { smallCargo: "3" },
    transactionHash: "0xabc",
    blockNumber: "123",
  };
}

function battleReport(missionId: string): BattleReport {
  return {
    missionId,
    attacker: "0x2222222222222222222222222222222222222222",
    targetPlanetId: "7",
    outcome: "AttackerWin",
    rounds: 2,
    randomSeed: "99",
    loot: { metal: "1200", crystal: "300", deuterium: "0" },
    attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
    defenderLosses: { metal: "900", crystal: "250", deuterium: "0" },
    debris: { metal: "600", crystal: "150" },
    roundReports: [],
    transactionHash: "0xabc",
    blockNumber: "1234",
  };
}
