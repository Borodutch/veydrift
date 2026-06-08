import { describe, expect, test } from "bun:test";

import { MissionDetailPage } from "./components/MissionDetailPage";
import { MissionControlPage, partitionActiveMissionRows, type ActiveMissionRow } from "./components/MissionControlPage";
import { buildInspectHash, parseInspectRoute } from "./inspectRoutes";
import { fetchBattleReports, fetchFleetMissionArchive, fetchMission, type BattleReport, type FleetMissionSummary } from "./walletFlow";

describe("Mission Control battle reports", () => {
  test("builds shareable report list and detail routes", () => {
    expect(parseInspectRoute("#/battle-reports")).toEqual({ kind: "page", page: "battle-reports" });
    expect(buildInspectHash({ kind: "page", page: "battle-reports" })).toBe("#/battle-reports");
    // Legacy single-report deep links now redirect to the unified mission detail page,
    // which is itself the shareable public report.
    expect(parseInspectRoute("#/battle-report/42")).toEqual({ kind: "mission", missionId: "42" });
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

  test("fetches wallet mission archive with server-side pagination", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const wallet = "0x1111111111111111111111111111111111111111";

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        wallet,
        homePlanetId: "7",
        rows: [{ kind: "battleReport", report: battleReport("42") }],
        pagination: {
          page: 2,
          pageSize: 25,
          totalEntries: 26,
          totalPages: 2,
          hasPreviousPage: true,
          hasNextPage: false,
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await expect(fetchFleetMissionArchive("https://api.example.test/", wallet, { page: 2, pageSize: 25 })).resolves.toMatchObject({
        rows: [{ kind: "battleReport", report: { missionId: "42" } }],
        pagination: { page: 2, pageSize: 25 },
      });
      expect(requestedUrls).toEqual([
        `https://api.example.test/wallet/${wallet}/missions?status=completed&page=2&pageSize=25`,
      ]);
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
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
    })).join(" ");

    expect(text).toContain("Mission Control");
    expect(text).toContain("Watch inbound attacks");
    // "Hostile inbound" persists as the active-row direction label, not as a summary stat card.
    expect(text).toContain("Hostile inbound");
    // The top summary stat-card row (Active missions / Due resolvers / Hostile inbound / Returns) is removed.
    expect(text).not.toContain("Due resolvers");
    // Section header labels are dropped; grouping is conveyed by the tables themselves.
    expect(text).not.toContain("Fleet movement");
    expect(text).toContain("Past missions");
    expect(text).toContain("Commander 0x2222...2222");
    expect(text).toContain("Origin Planet #8");
    expect(text).toContain("Target Planet #7");
    expect(text).toContain("Ships Small Cargo x3");
    expect(text).toContain("Group defend");
    expect(text).toContain("Intercept");
    expect(text).toContain("Open mission");
    expect(text).not.toContain("Open report");
    expect(text).not.toContain("Open details");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Battle reports");
    expect(text).not.toContain("Fleet Operations");
    expect(text).not.toContain("contract-supported");
    expect(text).not.toContain("Contract-indexed");
    expect(text).not.toContain("ACS");
  });

  test("dedupes duplicate server archive rows from polling or re-renders", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const duplicateRow = { kind: "battleReport" as const, report: battleReport("61") };
    const text = collectText(MissionControlPage({
      actionState: { status: "idle" },
      canTransact: true,
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      missionArchive: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        rows: [duplicateRow, duplicateRow],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      loading: false,
      now,
      onCompleteReturn: () => undefined,
      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
    }));

    // Mission numbers are no longer rendered in past rows; a single deduped battle-report
    // row exposes exactly one "Open mission" action (Details + Report merged in VEY-374).
    expect(countOccurrences(text.join(""), "Open mission")).toBe(1);
  });

  test("partitions active rows into My missions (own fleets) and Alliance (joinable attacks)", () => {
    const rows: ActiveMissionRow[] = [
      { context: "incoming", direction: "Hostile inbound", mission: mission("1") },
      { context: "outgoing", direction: "Outbound", mission: mission("2") },
      { context: "returning", direction: "Returning", mission: mission("3") },
      { context: "joinable", direction: "Joinable attack", mission: mission("4") },
      { context: "joinable", direction: "Joinable attack", mission: mission("5") },
    ];

    const { alliance, mine } = partitionActiveMissionRows(rows);

    expect(mine.map((row) => row.mission.missionId)).toEqual(["1", "2", "3"]);
    expect(mine.every((row) => row.context !== "joinable")).toBe(true);
    expect(alliance.map((row) => row.mission.missionId)).toEqual(["4", "5"]);
    expect(alliance.every((row) => row.context === "joinable")).toBe(true);
  });

  test("renders My missions / Alliance tabs with counts, join action, and per-tab empty state", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      incoming: [mission("31", "Attack", "Outbound", "0x2222222222222222222222222222222222222222", "8", "7", now + 60_000)],
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      returning: [mission("33", "Deploy", "Returning", "0x1111111111111111111111111111111111111111", "9", "7", now - 60_000)],
      joinableAttacks: [mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now + 180_000)],
    }))).join(" ");

    expect(text).toContain("My missions (3)");
    expect(text).toContain("Alliance (1)");
    // Join actions stay available on the Alliance tab.
    expect(text).toContain("Join attack");
  });

  test("shows the Alliance empty state when there are no joinable attacks", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      joinableAttacks: [],
    }))).join(" ");

    expect(text).toContain("My missions (1)");
    expect(text).toContain("Alliance (0)");
    expect(text).toContain("No joinable alliance attacks.");
  });

  test("paginates the My missions tab at 25 rows per page", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const outgoing = Array.from({ length: 26 }, (_unused, index) =>
      mission(String(100 + index), "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + (index + 1) * 60_000));
    const text = collectText(MissionControlPage(missionControlProps(now, { outgoing }))).join(" ");

    expect(text).toContain("My missions (26)");
    // Pagination range proves the 25-per-page split (26 rows -> first page shows 1-25).
    expect(text).toContain("1-25 of 26");
  });

  test("paginates the Alliance tab at 25 rows per page", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const joinableAttacks = Array.from({ length: 26 }, (_unused, index) =>
      mission(String(200 + index), "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now + (index + 1) * 60_000));
    const text = collectText(MissionControlPage(missionControlProps(now, { joinableAttacks }))).join(" ");

    expect(text).toContain("Alliance (26)");
    expect(text).toContain("No active missions.");
    // Pagination range proves the 25-per-page split (26 rows -> first page shows 1-25).
    expect(text).toContain("1-25 of 26");
  });

  test("excludes Alliance joinable attacks from the \"Needs orders now\" count", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // A joinable alliance attack that has already arrived (would be "due" on its own), but the
    // player has no own missions needing action. Joining is opt-in, never an obligation.
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      joinableAttacks: [mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now - 60_000)],
    }))).join(" ");

    expect(text).toContain("Alliance (1)");
    expect(text).not.toContain("Needs orders now");
  });

  test("counts only the player's own due missions in \"Needs orders now\"", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // One own outbound mission already arrived (due), plus two due joinable alliance attacks that
    // must not inflate the count.
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000)],
      joinableAttacks: [
        mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now - 60_000),
        mission("35", "Attack", "Outbound", "0x4444444444444444444444444444444444444444", "5", "6", now - 60_000),
      ],
    }))).join(" ").replace(/\s+/g, " ");

    expect(text).toContain("Needs orders now 1");
  });

  test("renders shareable mission detail stages, actions, and battle report structure", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage({
      account: "0x1111111111111111111111111111111111111111",
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
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
      onCopyShareUrl: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      shareUrl: "https://test.veydrift.com/#/mission/42",
    })).join(" ");

    expect(text).toContain("Mission #42");
    expect(text).not.toContain("Mission Detail");
    expect(text).toContain("Needs resolution");
    expect(text).toContain("Resolve battle");
    expect(text).toContain("Copy link");
    expect(text).toContain("Battle Report");
    expect(text).toContain("Attacker victory");
    expect(text).toContain("Combatants");
    expect(text).toContain("Attacker Fleet");
    expect(text).toContain("Fleet Losses");
    expect(text).toContain("Plunder And Debris");
    expect(text).toContain("Recyclers to clear debris");
    expect(text).toContain("Round-by-round combat");
    // The on-chain log does not expose these fields, so they must not be rendered as empty cells.
    expect(text).not.toContain("Not indexed yet");
    // VEY-389: no "OGame" anywhere in rendered copy.
    expect(text).not.toContain("OGame");
    // VEY-387/386: combat-proof and chain-proof blocks were removed from the page.
    expect(text).not.toContain("Combat Proof");
    expect(text).not.toContain("Chain Proof");
    // VEY-390: the mission detail page is itself the public report, no separate button.
    expect(text).not.toContain("Public report");
    // VEY-388: descriptive ship-class subtext was removed.
    expect(text).not.toContain("Ship classes");
  });

  test("surfaces share-link copy feedback and mission action status on the detail page", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const baseProps = {
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
      onCopyShareUrl: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      shareUrl: "https://test.veydrift.com/#/mission/42",
    } as const;

    const copied = collectText(MissionDetailPage({
      ...baseProps,
      actionState: { status: "idle" },
      copyState: "copied",
    })).join(" ");
    expect(copied).toContain("Copied!");
    expect(copied).not.toContain("Copy link");

    const pending = collectText(MissionDetailPage({
      ...baseProps,
      actionState: { status: "pending", label: "Resolve mission #42: waiting for wallet confirmation." },
      copyState: "idle",
    })).join(" ");
    expect(pending).toContain("waiting for wallet confirmation");

    const failed = collectText(MissionDetailPage({
      ...baseProps,
      actionState: { status: "error", label: "Resolve mission #42 transaction failed." },
      copyState: "error",
    })).join(" ");
    expect(failed).toContain("transaction failed");
    expect(failed).toContain("Copy failed");
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function missionControlProps(
  now: number,
  visibility: Partial<{
    incoming: FleetMissionSummary[];
    outgoing: FleetMissionSummary[];
    returning: FleetMissionSummary[];
    joinableAttacks: FleetMissionSummary[];
  }>,
): Parameters<typeof MissionControlPage>[0] {
  return {
    actionState: { status: "idle" },
    canTransact: true,
    fleetVisibility: {
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      incoming: visibility.incoming ?? [],
      outgoing: visibility.outgoing ?? [],
      returning: visibility.returning ?? [],
      joinableAttacks: visibility.joinableAttacks ?? [],
      completedMissions: [],
      battleReports: [],
    },
    loading: false,
    now,
    onCompleteReturn: () => undefined,
    onCounterplay: () => undefined,
    onJoinAttack: () => undefined,
    onOpenReport: () => undefined,
    onOpenReportList: () => undefined,
    onRecall: () => undefined,
    onRefresh: () => undefined,
    onResolve: () => undefined,
  };
}

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
