import { describe, expect, test } from "bun:test";

import { MissionDetailPage } from "./components/MissionDetailPage";
import { MissionControlPage, allActiveMissionRows, buildMissionControlViewQuery, parseMissionControlViewParams, persistMissionControlView, resolveMissionControlView, partitionActiveMissionRows, type ActiveMissionRow, type MissionControlView } from "./components/MissionControlPage";
import { planetImageForType, planetTypeFromCoordinates } from "./data/mockUniverse";
import { buildInspectHash, parseInspectRoute } from "./inspectRoutes";
import type { Coordinates } from "./types";
import { fetchBattleReports, fetchFleetMissionArchive, fetchMission, type BattleReport, type FleetMissionPlanetReference, type FleetMissionSummary, type FleetMissionVisibilityResponse } from "./walletFlow";

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
    // VEY-397#7: commander shown as clickable subtext under each endpoint (wallet fallback).
    expect(text).toContain("0x2222...2222");
    // VEY-397#5/#6: endpoints show planet names (coords fallback), no "Origin/Target planet #" prefix.
    expect(text).toContain("Planet #8");
    expect(text).toContain("Planet #7");
    expect(text).not.toContain("Origin Planet #8");
    expect(text).not.toContain("Target Planet #7");
    // VEY-397#9: fleet column shows ship icons with xN counts (ship name is in the hover title).
    expect(text).toContain("x3");
    expect(text).toContain("Group defend");
    // VEY-KANEO-439: the Intercept counterplay was removed; only Group defend (AcsDefend) remains.
    expect(text).not.toContain("Intercept");
    // VEY-397#12: the active-row action is "Open" (the past-report row keeps "Open mission").
    expect(text).toContain("Open");
    // VEY-397#1/#8: the Countdown and Return columns were removed.
    expect(text).not.toContain("Countdown");
    // VEY-397#10: the per-row "Copy report" control was removed.
    expect(text).not.toContain("Copy report");
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

    // A single deduped battle-report row exposes exactly one row "Open" action (Details + Report
    // merged in VEY-374; label shortened to "Open" in the shared row, VEY-399#8).
    expect(countOccurrences(text.join(""), "Open the full mission detail screen")).toBe(1);
    expect(text.join("")).not.toContain("Open mission");
    // VEY-399#1 / VEY-KANEO-402: the past "My missions" tab count reflects the de-duplicated rows
    // (two raw rows collapse to one) now that the past panel carries My missions / All scope tabs.
    expect(text.join(" ")).toContain("My missions (1)");
    expect(text.join(" ")).not.toContain("My missions (2)");
  });

  test("past missions reuse the shared row: clickable origin+target, returned subtext, Open label, deduped count (VEY-399#1/#2/#8/#9)", () => {
    const now = Date.parse("2026-06-08T23:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const completed: FleetMissionSummary = {
      ...mission("70", "Attack", "Returned", owner, "7", "9", now - 7_200_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4"),
    };
    const tree = MissionControlPage({
      ...missionControlProps(now, {}),
      missionArchive: {
        wallet: owner,
        homePlanetId: "7",
        // The archive returns the mission AND its battle report; the shared row collapses them to one.
        rows: [{ kind: "mission", mission: completed }, { kind: "battleReport", report: battleReport("70") }],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
    });
    const text = collectText(tree).join(" ");

    // VEY-399#1: the count matches the single de-duplicated row, not the two raw archive rows. The
    // past panel now surfaces this in the "My missions" scope tab (VEY-KANEO-402).
    expect(text).toContain("My missions (1)");
    expect(text).not.toContain("My missions (2)");
    // VEY-399#8: the row action reads "Open", never "Open mission".
    expect(text).not.toContain("Open mission");
    expect(text).toContain("Open");
    // VEY-399 rework (#9636): the status word renders as MISSION-column subtext, with no date/time.
    expect(text).toContain("Returned");
    expect(text).not.toContain(", 2026");
    // VEY-399#2: both origin AND target route endpoints are clickable Galaxy links.
    const links = findElements(tree, "a");
    expect(links.some((link) => String(link.props?.title ?? "").includes("6:9:1"))).toBe(true);
    expect(links.some((link) => String(link.props?.title ?? "").includes("5:407:4"))).toBe(true);
    expect(text).toContain("New Zion");
    expect(text).toContain("Borealis");
  });

  test("active missions render as cards with no table column headers (VEY-400)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
    }))).join(" ");

    // Cards drop the MISSION / ROUTE / FLEET / Orders headers; the mission still renders with its
    // type badge and the "En route" status pill in the card header line.
    expect(text).toContain("Transport");
    expect(text).toContain("En route");
    expect(text).not.toContain("Origin -> Target");
    expect(text).not.toContain("Mission Route Fleet");
  });

  test("hides Join when disabled and labels the resolve action 'Resolve' (VEY-399#6/#7)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // Own outbound mission already arrived -> Resolve is enabled and labeled "Resolve".
    // A joinable alliance attack that already arrived -> Join is disabled, so it is hidden.
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000)],
      joinableAttacks: [mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now - 60_000)],
    }))).join(" ");

    expect(text).toContain("Resolve");
    expect(text).not.toContain("Resolve battle");
    expect(text).not.toContain("Join");
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
    // VEY-397#13: join actions stay available on the Alliance tab, now labelled "Join".
    expect(text).toContain("Join");
    expect(text).not.toContain("Join attack");
  });

  test("VEY-KANEO-431: Join forwards the target coordinates so it can open the Attack fleet picker", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const joinable = {
      ...mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now + 180_000),
      targetPlanet: planetReference("6", "0x3333333333333333333333333333333333333333", "Bastion", "4:5:6"),
    };
    const joinCalls: Array<[string, string, { galaxy: number; system: number; position: number } | null]> = [];
    const tree = MissionControlPage({
      ...missionControlProps(now, { joinableAttacks: [joinable] }),
      onJoinAttack: (missionId, targetPlanetId, targetCoords) => {
        joinCalls.push([missionId, targetPlanetId, targetCoords]);
      },
    });

    const joinButton = findElements(tree, "button").find(
      (element) => element.props?.title === "Join this alliance attack",
    );
    expect(joinButton).toBeDefined();
    (joinButton?.props?.onClick as (() => void) | undefined)?.();

    // The click no longer sends a default fleet immediately; it hands the mission
    // id, target planet id, and resolved target coordinates up so the parent can
    // open the same fleet picker the Attack action uses.
    expect(joinCalls).toEqual([["34", "6", { galaxy: 4, system: 5, position: 6 }]]);
  });

  test("allActiveMissionRows keeps the player's classification and renders other players as observers (VEY-KANEO-402)", () => {
    const classified: ActiveMissionRow[] = [
      { context: "outgoing", direction: "Outbound", mission: mission("1") },
    ];
    const other = mission("2", "Attack", "Outbound", "0x9999999999999999999999999999999999999999", "5", "6");
    const rows = allActiveMissionRows([mission("1"), other], classified);

    const contextById = Object.fromEntries(rows.map((row) => [row.mission.missionId, row.context]));
    expect(rows).toHaveLength(2);
    expect(contextById["1"]).toBe("outgoing");
    expect(contextById["2"]).toBe("observer");
  });

  test("adds an All active tab listing universe-wide active missions; other players' rows are read-only (VEY-KANEO-402)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const mine = mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000);
    // Another player's attack that has already arrived (would be "due" -> Resolve if it were mine).
    const other = mission("90", "Attack", "Outbound", "0x9999999999999999999999999999999999999999", "5", "6", now - 60_000);
    const text = collectText(MissionControlPage({
      ...missionControlProps(now, { outgoing: [mine] }),
      allActiveMissions: [mine, other],
    })).join(" ");

    expect(text).toContain("My missions (1)");
    expect(text).toContain("All (2)");
    // The other player's mission appears on the universe-wide All tab...
    expect(text).toContain("# 90");
    // ...but observer rows never expose the Resolve lifecycle action even when the mission is due,
    // and neither of these missions is a due mission the player can resolve.
    expect(text).not.toContain("Resolve");
  });

  test("adds My missions / All past tabs; All lists the paginated universe-wide completed archive (VEY-KANEO-402)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const rows = Array.from({ length: 26 }, (_unused, index) => ({
      kind: "battleReport" as const,
      report: battleReport(String(500 + index)),
    }));
    const text = collectText(MissionControlPage({
      ...missionControlProps(now, {}),
      globalMissionArchive: {
        rows: rows.slice(0, 25),
        pagination: { page: 1, pageSize: 25, totalEntries: 26, totalPages: 2, hasPreviousPage: false, hasNextPage: true },
      },
    })).join(" ");

    // The past panel gains a scope tab control; My missions is empty here, All carries the universe count.
    expect(text).toContain("Past missions");
    expect(text).toContain("All (26)");
    // Server-side pagination range proves the 25-per-page split (26 rows -> first page shows 1-25).
    expect(text).toContain("1-25 of 26");
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
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: {
          ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          needsResolution: true,
          originPlanet: planetReference("7", "0x1111111111111111111111111111111111111111", "Aggressor", "1:2:3"),
          targetPlanet: planetReference("9", "0x3333333333333333333333333333333333333333", "Bastion", "4:5:6"),
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
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    })).join(" ");

    expect(text).toContain("Mission #42");
    expect(text).not.toContain("Mission Detail");
    // VEY-399#7: the resolve action label is "Resolve" (shared across the control + detail screens).
    expect(text).toContain("Resolve");
    expect(text).not.toContain("Resolve battle");
    // VEY-395 rework: the mission-detail page subtitle was removed.
    expect(text).not.toContain("Shareable mission state");
    expect(text).toContain("Copy link");
    expect(text).toContain("Battle Report");
    expect(text).toContain("Attacker victory");
    // VEY-KANEO-396 rework (#9636): the "Reconstructed from the on-chain combat log" subtext and the
    // internal "Needs resolution" jargon were removed from the page.
    expect(text).not.toContain("Reconstructed");
    expect(text).not.toContain("Needs resolution");
    // VEY-KANEO-396: two-sided report split into attacker | defender columns plus a debris panel.
    expect(text).toContain("Attacker");
    expect(text).toContain("Defender");
    expect(text).toContain("Debris Field");
    expect(text).toContain("Debris created");
    // VEY-KANEO-396 rework (#9636): recyclers needed is shown compactly inside the debris panel,
    // not as a separate verbose section.
    expect(text).toContain("Recyclers needed");
    // VEY-KANEO-396 rework (#9636): the attacker's fleet + cargo are folded into the report, so the
    // standalone "Fleet And Cargo" facts panel is suppressed when a battle report renders.
    expect(text).not.toContain("Fleet And Cargo");
    expect(text).toContain("Cargo carried");
    // VEY-KANEO-396: loot is the attacker's "Loot grabbed"; the on-chain log does not expose loot
    // retained by the defender, so there is no fabricated "Loot left" row.
    expect(text).toContain("Loot grabbed");
    expect(text).not.toContain("Loot left");
    expect(text).toContain("Fleet / defenses");
    // VEY-KANEO-406: the redundant per-side "Commander" rows were removed from the battle report —
    // origin/target commanders already render in the Route hero, which still links to each profile.
    expect(text).toContain("Aggressor");
    expect(text).toContain("Bastion");
    expect(text).toContain("Inspect Aggressor");
    expect(text).toContain("Inspect Bastion");
    expect(text).not.toContain("Open Aggressor (0x22222222...222222) profile");
    expect(text).not.toContain("Open Bastion (0x33333333...333333) profile");
    expect(text).not.toContain("from Aggressor [1:2:3]");
    expect(text).not.toContain("from Bastion [4:5:6]");
    // VEY-KANEO-396: the verbose recyclers-to-clear-debris section stays removed.
    expect(text).not.toContain("Recyclers to clear debris");
    expect(text).not.toContain("Loot plundered");
    // The legacy single-list panels were replaced by the two-sided layout.
    expect(text).not.toContain("Combatants");
    expect(text).not.toContain("Attacker Fleet");
    expect(text).not.toContain("Plunder And Debris");
    // VEY-KANEO-396: with no indexed round snapshots, the round-by-round block is hidden entirely.
    expect(text).not.toContain("Round-by-round combat");
    expect(text).not.toContain("No round-by-round snapshots were indexed");
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
    // VEY-380: the page URL is the shareable public URL, so the redundant "Share URL" field is dropped.
    expect(text).not.toContain("Share URL");
  });

  test("VEY-KANEO-427: hides the disabled Resolve order while an outbound mission is still in flight", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // Own outbound mission that has not arrived yet: Resolve is not actionable (disabled),
    // while Recall is still available. The Available Orders section must surface Recall but
    // suppress the disabled Resolve button rather than rendering it greyed out.
    const text = collectText(MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
        battleReport: null,
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
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    })).join(" ");

    expect(text).toContain("Available Orders");
    expect(text).toContain("Recall fleet");
    expect(text).not.toContain("Resolve");
  });

  test("renders the round-by-round block only when indexed round snapshots exist", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: {
          ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          needsResolution: true,
        },
        battleReport: {
          ...battleReport("42"),
          roundReports: [
            {
              round: 1,
              attackerUnits: "1000",
              defenderUnits: "800",
              attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
              defenderLosses: { metal: "400", crystal: "200", deuterium: "0" },
            },
          ],
        },
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
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    })).join(" ");

    expect(text).toContain("Round-by-round combat");
    expect(text).toContain("Attacker units / losses");
    expect(text).toContain("Defender units / losses");
    expect(text).toContain("1,000 units remaining");
    expect(text).toContain("800 units remaining");
    expect(text).not.toContain("units fired");
    expect(text).not.toContain("No round-by-round snapshots were indexed");
  });

  test("VEY-KANEO-407: renders unit art for attacker combat/civil ships and the defender's surviving fleet/defenses", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const tree = MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: {
          ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          // A mixed offensive fleet: combat (light fighter) + civil (small cargo).
          ships: { lightFighter: "12", smallCargo: "3" },
          originPlanet: planetReference("7", "0x1111111111111111111111111111111111111111", "Aggressor", "1:2:3"),
          targetPlanet: planetReference("9", "0x3333333333333333333333333333333333333333", "Bastion", "4:5:6"),
        },
        battleReport: battleReport("42"),
        // Indexed surviving composition for the defender planet (catalog-id keyed): cruiser (id 6) and
        // a rocket launcher (id 0).
        defenderPlanetState: {
          fleet: [{ id: 6, count: 2 }],
          defenses: [{ id: 0, count: 5 }],
        },
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
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    });

    const text = collectText(tree).join(" ");
    // Each unit chip exposes its name + count via title, alongside the generated art.
    expect(text).toContain("Light Fighter ×12");
    expect(text).toContain("Small Cargo ×3");
    expect(text).toContain("Cruiser ×2");
    expect(text).toContain("Rocket Launcher ×5");
    // With the defender planet charted, the combined "Fleet / defenses" caveat is replaced by the
    // per-row icon lists.
    expect(text).not.toContain("Fleet / defenses");

    // The chips render the mapped game art for ships (combat + civil) and defenses, not just text.
    const imageSrcs = findElements(tree, "img").map((node) => String(node.props?.src ?? ""));
    expect(imageSrcs.some((src) => src.includes("/ships/light-fighter"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/ships/small-cargo"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/ships/cruiser"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/defenses/rocket-launcher"))).toBe(true);
  });

  test("VEY-KANEO-407: renders unit art in the standalone Fleet And Cargo panel for non-combat missions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // A transport mission has no battle report, so the standalone "Fleet And Cargo" panel renders and
    // its ship listing must show unit art too (per the ticket title's "Fleet And Cargo ships" scope).
    const tree = MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: {
          ...mission("51", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
          ships: { largeCargo: "4" },
        },
        battleReport: null,
      },
      loading: false,
      missionId: "51",
      now,
      onBack: () => undefined,
      onCompleteReturn: () => undefined,
      onCopyShareUrl: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    });

    const text = collectText(tree).join(" ");
    expect(text).toContain("Fleet And Cargo");
    expect(text).toContain("Large Cargo ×4");
    const imageSrcs = findElements(tree, "img").map((node) => String(node.props?.src ?? ""));
    expect(imageSrcs.some((src) => src.includes("/ships/large-cargo"))).toBe(true);
  });

  test("VEY-KANEO-407: keeps 'None' for empty unit listings in the Battle Report", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // Attacker fielded only civil ships and the charted defender had no surviving fleet/defenses, so
    // the empty listings must still read "None" rather than render an empty icon row.
    const tree = MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: {
        mission: {
          ...mission("52", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          ships: { smallCargo: "2" },
        },
        battleReport: battleReport("52"),
        defenderPlanetState: { fleet: [], defenses: [] },
      },
      loading: false,
      missionId: "52",
      now,
      onBack: () => undefined,
      onCompleteReturn: () => undefined,
      onCopyShareUrl: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    });

    const text = collectText(tree).join(" ");
    // Civil ships present as art; combat ships empty -> "None"; defender empty -> combined "None".
    expect(text).toContain("Small Cargo ×2");
    expect(text).toContain("None");
    const imageSrcs = findElements(tree, "img").map((node) => String(node.props?.src ?? ""));
    expect(imageSrcs.some((src) => src.includes("/ships/small-cargo"))).toBe(true);
  });

  test("VEY-KANEO-425: hides the 'no battle report' notice for an outbound combat fleet still en route", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // An attack fleet still flying out: arrival is in the future, no report, combat not yet due.
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("60", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
      battleReport: null,
    }))).join(" ");

    // The fleet has not reached its target, so there is nothing to fight: the notice must be hidden.
    expect(text).not.toContain("No indexed battle report");
    expect(text).not.toContain("Combat is due or resolving");
    expect(text).not.toContain("Battle Report");
  });

  test("VEY-KANEO-425: hides the 'no battle report' notice for a recalled combat fleet that never fought", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // A recalled attack fleet turned back before arrival, so it never fought and has no report.
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("61", "Attack", "Recalled", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
      battleReport: null,
    }))).join(" ");

    expect(text).not.toContain("No indexed battle report");
    expect(text).not.toContain("Combat is due or resolving");
  });

  test("VEY-KANEO-425: still shows the due/resolving notice for an outbound combat fleet whose arrival has passed", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("62", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
        needsResolution: true,
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Combat is due or resolving");
    expect(text).not.toContain("No indexed battle report");
  });

  test("VEY-KANEO-425: still shows the 'no battle report' notice for a returning combat fleet that fought without an indexed report", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // A fleet that fought and is heading home should have a report; its absence is genuinely
    // notable, so the notice stays.
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("63", "Attack", "Returning", "0x1111111111111111111111111111111111111111", "7", "9", now - 120_000),
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("No indexed battle report is available for this combat mission yet.");
  });

  test("VEY-KANEO-425: keeps a non-combat outbound mission free of any battle-report notice", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("64", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
      battleReport: null,
    }))).join(" ");

    expect(text).not.toContain("No indexed battle report");
    expect(text).not.toContain("Battle Report");
  });

  test("surfaces share-link copy feedback and mission action status on the detail page", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const baseProps = {
      fleetVisibility: ownerVisibility,
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
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
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

  test("renders the route as origin -> target with clickable coordinates and commanders", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const selectedCoords: Coordinates[] = [];
    const selectedPlayers: string[] = [];
    const detailMission: FleetMissionSummary = {
      // Outbound mission still in flight: arrival/return are in the future, so the
      // route shows the "Arrival"/"Return" captions with their ETAs (VEY-KANEO-405:
      // only completed legs collapse to a captionless "Arrived"/"Returned").
      ...mission("42", "Attack", "Outbound", owner, "7", "9", now + 60_000),
      originPlanet: {
        planetId: "7", owner, ownerDisplayName: "Aria", name: "Helios",
        galaxy: 1, system: 2, position: 3, coordinates: "1:2:3",
      },
      targetPlanet: {
        planetId: "9", owner: defender, ownerDisplayName: "Zane", name: "Borealis",
        galaxy: 4, system: 5, position: 6, coordinates: "4:5:6",
      },
    };
    const props = {
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" } as const,
      canTransact: true,
      copyState: "idle" as const,
      detail: { mission: detailMission, battleReport: null },
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
      onSelectCoordinates: (coords: Coordinates) => { selectedCoords.push(coords); },
      onSelectPlayer: (wallet: string) => { selectedPlayers.push(wallet); },
    };

    const tree = MissionDetailPage(props);
    const text = collectText(tree).join(" ");
    expect(text).toContain("Route");
    expect(text).toContain("Origin");
    expect(text).toContain("Target");
    // VEY-395 rework: the "Commander" caption was dropped; just the clickable name remains.
    expect(text).not.toContain("Commander");
    // Planet names, coordinates, and resolved commander names all surface on the route.
    expect(text).toContain("Helios");
    expect(text).toContain("Borealis");
    expect(text).toContain("1:2:3");
    expect(text).toContain("4:5:6");
    expect(text).toContain("Aria");
    expect(text).toContain("Zane");
    // Timing folds beside each endpoint (return near origin, arrival near target).
    expect(text).toContain("Arrival");
    expect(text).toContain("Return");
    // VEY-395 / VEY-KANEO-396 rework: the internal "Needs resolution" route flag was removed entirely.
    expect(text).not.toContain("Needs resolution");
    // The Mission ID field is dropped from the route (requirement 1); it lives in the header.
    expect(text).not.toContain("Mission id");

    const buttons = findElements(tree, "button");
    const originCoordButton = buttons.find((node) => collectText(node).join("").includes("1:2:3"));
    expect(originCoordButton).toBeDefined();
    (originCoordButton?.props?.onClick as () => void)();
    expect(selectedCoords).toEqual([{ galaxy: 1, system: 2, position: 3 }]);

    const targetCommanderButton = buttons.find((node) => collectText(node).join("").includes("Zane"));
    expect(targetCommanderButton).toBeDefined();
    (targetCommanderButton?.props?.onClick as () => void)();
    expect(selectedPlayers).toEqual([defender]);
  });

  test("renders real planet art for both detail Route endpoints, sharing the card asset selection (VEY-403)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const detailMission: FleetMissionSummary = {
      ...mission("43", "Attack", "Outbound", owner, "7", "9", now + 60_000),
      // Origin carries an indexed archetype; target has none, so the Route falls back to the
      // deterministic coordinate-derived planet type — never a generic icon.
      originPlanet: planetReference("7", owner, "Helios", "1:2:3", "temperate-ocean"),
      targetPlanet: { planetId: "9", owner: defender, ownerDisplayName: "Zane", name: "Borealis", galaxy: 4, system: 5, position: 6, coordinates: "4:5:6" },
    };
    const tree = MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
      copyState: "idle",
      detail: { mission: detailMission, battleReport: null },
      loading: false,
      missionId: "43",
      now,
      onBack: () => undefined,
      onCompleteReturn: () => undefined,
      onCopyShareUrl: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onResolve: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    });

    const planetImages = findElements(tree, "img").filter((node) => node.props?.["data-planet-art"] !== undefined);
    const arts = planetImages.map((node) => node.props?.["data-planet-art"]);
    // Origin uses its indexed archetype; target falls back to the coordinate-derived type.
    const targetType = planetTypeFromCoordinates(4, 5, 6);
    expect(arts).toContain("temperate-ocean");
    expect(arts).toContain(targetType);
    const sources = planetImages.map((node) => node.props?.src);
    expect(sources).toContain(planetImageForType("temperate-ocean"));
    expect(sources).toContain(planetImageForType(targetType));
  });

  // VEY-403: the mission card route is a directional, progress-filled arrow plus real planet art for
  // both endpoints. These cover the three behaviours the ticket calls out: direction, fill, assets.
  function routeArrows(tree: unknown): FoundElement[] {
    return findElements(tree, "div").filter((node) => node.props?.["data-route-direction"] !== undefined);
  }

  test("outbound mission renders a right-pointing route arrow filled to progress, with real planet art for both endpoints (VEY-403)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    // arrival 30s out; the mission fixture's return is 60s after arrival, so the outbound leg is
    // exactly half elapsed -> 50% progress along origin -> target.
    const outbound: FleetMissionSummary = {
      ...mission("80", "Attack", "Outbound", owner, "7", "9", now + 30_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
    };
    const tree = MissionControlPage(missionControlProps(now, { outgoing: [outbound] }));

    const arrows = routeArrows(tree);
    expect(arrows.length).toBe(1);
    const arrow = arrows[0]!;
    // Direction follows the active leg: outbound points toward the target.
    expect(arrow.props?.["data-route-direction"]).toBe("outbound");
    expect(arrow.props?.["data-route-progress"]).toBe("50");

    // The cyan fill is proportional to progress (half of the available track).
    const fill = findElements(tree, "span").find((node) => node.props?.["data-route-fill"] !== undefined);
    expect(fill).toBeDefined();
    expect(fill?.props?.["data-route-progress"]).toBe("50");
    expect(String((fill?.props?.style as { width?: string } | undefined)?.width ?? "")).toContain("* 0.5");

    // Both endpoints render their real planet art (Galaxy thumbnail assets), keyed by archetype.
    const planetImages = findElements(tree, "img").filter((node) => node.props?.["data-planet-art"] !== undefined);
    const arts = planetImages.map((node) => node.props?.["data-planet-art"]);
    expect(arts).toContain("temperate-ocean");
    expect(arts).toContain("frozen-ice");
    const sources = planetImages.map((node) => node.props?.src);
    expect(sources).toContain(planetImageForType("temperate-ocean"));
    expect(sources).toContain(planetImageForType("frozen-ice"));
  });

  test("returning mission points the route arrow back toward home and fills on the return leg (VEY-403)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    // arrival 30s ago; return 60s after arrival -> return leg is half elapsed -> 50% of the way home.
    const returning: FleetMissionSummary = {
      ...mission("81", "Transport", "Returning", owner, "7", "9", now - 30_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "lush-temperate"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "hot-desert"),
    };
    const tree = MissionControlPage(missionControlProps(now, { returning: [returning] }));

    const arrows = routeArrows(tree);
    expect(arrows.length).toBe(1);
    const arrow = arrows[0]!;
    // Returning fleets fly target -> origin, so the arrow points back toward home (origin).
    expect(arrow.props?.["data-route-direction"]).toBe("returning");
    expect(arrow.props?.["data-route-progress"]).toBe("50");
    // The accessible label describes the homeward direction.
    expect(String(arrow.props?.["aria-label"] ?? "")).toContain("Returning home");
  });

  test("route arrow fill reaches 100% at arrival (VEY-403)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    // arrival already passed: the outbound leg is fully elapsed -> fill at 100%.
    const arrived: FleetMissionSummary = {
      ...mission("82", "Deploy", "Outbound", owner, "7", "9", now - 5_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "warm-terracotta"),
      targetPlanet: planetReference("9", owner, "Outpost", "5:407:4", "cold-tundra"),
    };
    const tree = MissionControlPage(missionControlProps(now, { outgoing: [arrived] }));

    const arrow = routeArrows(tree)[0]!;
    expect(arrow.props?.["data-route-direction"]).toBe("outbound");
    expect(arrow.props?.["data-route-progress"]).toBe("100");
  });

  test("card route pins origin left and target right with the arrow spanning the full gap (VEY-403 rework)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const outbound: FleetMissionSummary = {
      ...mission("83", "Attack", "Outbound", owner, "7", "9", now + 30_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
    };
    const tree = MissionControlPage(missionControlProps(now, { outgoing: [outbound] }));

    // The route row uses an edge-pinned grid: auto-sized endpoint columns on the outer edges and a
    // central 1fr column the arrow fills, so origin hugs the left and target hugs the right.
    const routeRow = findElements(tree, "div").find((node) => {
      const className = String(node.props?.className ?? "");
      return className.includes("grid-cols-[minmax(0,auto)_minmax(2.5rem,1fr)_minmax(0,auto)]")
        && findElements(node, "div").some((child) => child.props?.["data-route-direction"] !== undefined);
    });
    expect(routeRow).toBeDefined();
  });

  // VEY-412: Mission Control remembers the selected tabs + past page across the mission-detail
  // round-trip. The view is rendered from a persisted value (sessionStorage in the browser); here we
  // pass it explicitly to assert the selection is reflected directly in the markup.
  function sectionByData(tree: unknown, attribute: string): FoundElement | undefined {
    return findElements(tree, "section").find((node) => node.props?.[attribute] !== undefined);
  }

  test("defaults to the My missions tabs on a fresh render (VEY-412)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const tree = MissionControlPage(missionControlProps(now, { outgoing: [mission("11")] }));

    expect(sectionByData(tree, "data-active-tab")?.props?.["data-active-tab"]).toBe("mine");
    expect(sectionByData(tree, "data-past-tab")?.props?.["data-past-tab"]).toBe("mine");
  });

  test("restores the persisted active + past tab selection (VEY-412)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const view: MissionControlView = { activePage: 0, activeTab: "all", pastPage: 0, pastTab: "all" };
    const tree = MissionControlPage({ ...missionControlProps(now, { outgoing: [mission("11")] }), initialView: view });

    // The sections advertise the restored tab, the restored tab buttons read selected, and the
    // restored panels are the visible (non-hidden) ones.
    expect(sectionByData(tree, "data-active-tab")?.props?.["data-active-tab"]).toBe("all");
    expect(sectionByData(tree, "data-past-tab")?.props?.["data-past-tab"]).toBe("all");

    const activeAllButton = findElements(tree, "button").find((node) => node.props?.["data-active-tab-button"] === "all");
    expect(activeAllButton?.props?.["aria-selected"]).toBe(true);
    const pastAllButton = findElements(tree, "button").find((node) => node.props?.["data-past-tab-button"] === "all");
    expect(pastAllButton?.props?.["aria-selected"]).toBe(true);

    const activeAllPanel = findElements(tree, "div").find((node) => node.props?.["data-active-tab-panel"] === "all");
    expect(activeAllPanel?.props?.hidden).toBe(false);
    const activeMinePanel = findElements(tree, "div").find((node) => node.props?.["data-active-tab-panel"] === "mine");
    expect(activeMinePanel?.props?.hidden).toBe(true);
  });

  test("restores the persisted active-missions pagination page (VEY-412)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // 30 own outbound missions => two client pages in the "My missions" panel (25 per page).
    const outgoing = Array.from({ length: 30 }, (_unused, index) => mission(`page-${index}`));
    const view: MissionControlView = { activePage: 1, activeTab: "mine", pastPage: 0, pastTab: "mine" };
    const tree = MissionControlPage({ ...missionControlProps(now, { outgoing }), initialView: view });

    // The visible "mine" panel is the only one with rendered rows, so it owns the single page marker.
    const pageHolder = findElements(tree, "div").find((node) => node.props?.["data-past-page-current"] !== undefined);
    expect(pageHolder?.props?.["data-past-page-current"]).toBe("1");

    const pagePanels = findElements(tree, "div").filter((node) => node.props?.["data-past-page"] !== undefined);
    const firstPage = pagePanels.find((node) => node.props?.["data-past-page"] === 0);
    const secondPage = pagePanels.find((node) => node.props?.["data-past-page"] === 1);
    // Page 2 (index 1) is shown; page 1 (index 0) is hidden — the remembered page, not page 1.
    expect(firstPage?.props?.hidden).toBe(true);
    expect(secondPage?.props?.hidden).toBe(false);
  });

  // VEY-412 rework: the view is encoded in the URL hash query (source of truth — shareable, survives
  // browser back + hard reload). These cover the pure encoder/decoder round-trip.
  test("encodes only non-default view fields into the URL query (VEY-412)", () => {
    // A fresh/default view yields a clean URL with no query noise.
    expect(buildMissionControlViewQuery({ activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" })).toBe("");

    const query = buildMissionControlViewQuery({ activePage: 2, activeTab: "alliance", pastPage: 1, pastTab: "all" });
    const params = new URLSearchParams(query);
    expect(params.get("at")).toBe("alliance");
    expect(params.get("pt")).toBe("all");
    expect(params.get("ap")).toBe("2");
    expect(params.get("pp")).toBe("1");
  });

  test("parses a URL query back into a partial view, ignoring junk (VEY-412)", () => {
    expect(parseMissionControlViewParams("at=alliance&pt=all&ap=3&pp=2")).toEqual({
      activePage: 3,
      activeTab: "alliance",
      pastPage: 2,
      pastTab: "all",
    });

    // Unknown tab keys and negative/garbage pages are dropped rather than restoring a broken view.
    expect(parseMissionControlViewParams("at=bogus&ap=-1&pp=NaN")).toEqual({ activePage: 0, pastPage: 0 });
    expect(parseMissionControlViewParams("")).toEqual({});
  });

  test("round-trips a selected view through query encode/decode (VEY-412)", () => {
    const view: MissionControlView = { activePage: 1, activeTab: "all", pastPage: 4, pastTab: "all" };
    const restored = { ...view, ...parseMissionControlViewParams(buildMissionControlViewQuery(view)) };
    expect(restored).toEqual(view);
  });

  // VEY-412 rework: inside the Farcaster Mini App iframe sessionStorage is blocked (reads back as the
  // default) and the in-app back button lands on a bare hash (no query). Without a window in this
  // test env both the URL and storage paths are unavailable — exactly the iframe in-app-back case —
  // so the in-memory mirror set by the last selection must be what resolve() restores.
  test("restores the last selection from the in-memory mirror when URL + storage are unavailable (VEY-412)", () => {
    // Fresh state defaults to My missions.
    persistMissionControlView({ activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" });
    expect(resolveMissionControlView()).toEqual({ activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" });

    // Selecting Alliance + a past page must survive the (simulated) remount via the in-memory mirror.
    persistMissionControlView({ activeTab: "alliance", pastPage: 2, pastTab: "all" });
    expect(resolveMissionControlView()).toEqual({ activePage: 0, activeTab: "alliance", pastPage: 2, pastTab: "all" });

    // Switching back to the defaults clears the remembered selection too.
    persistMissionControlView({ activeTab: "mine", pastPage: 0, pastTab: "mine" });
    expect(resolveMissionControlView()).toEqual({ activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" });
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

// VEY-KANEO-424: the detail page authorizes orders from the same wallet-scoped fleet-visibility the
// Mission Control list uses, matching by mission id. These tests all render the owner's own fleets, so
// one shared visibility classifies each id the way the backend would: Outbound -> outgoing,
// Returning/Recalled -> returning. (The page looks up by id, so the summaries only need the right id
// and list placement.) A mission absent from every list models a stranger and gets no orders.
const ownerVisibility: FleetMissionVisibilityResponse = {
  wallet: "0x1111111111111111111111111111111111111111",
  homePlanetId: "7",
  incoming: [],
  outgoing: ["42", "43", "51", "52", "60", "62", "64"].map((id) => mission(id, "Attack", "Outbound")),
  returning: ["61", "63"].map((id) => mission(id, "Attack", "Returning")),
  joinableAttacks: [],
  completedMissions: [],
  battleReports: [],
};

function missionDetailProps(
  now: number,
  detail: Parameters<typeof MissionDetailPage>[0]["detail"],
): Parameters<typeof MissionDetailPage>[0] {
  return {
    fleetVisibility: ownerVisibility,
    actionState: { status: "idle" },
    canTransact: true,
    copyState: "idle",
    detail,
    loading: false,
    missionId: detail?.mission?.missionId ?? null,
    now,
    onBack: () => undefined,
    onCompleteReturn: () => undefined,
    onCopyShareUrl: () => undefined,
    onCounterplay: () => undefined,
    onRecall: () => undefined,
    onResolve: () => undefined,
    onRetry: () => undefined,
    onSelectCoordinates: () => undefined,
    onSelectPlayer: () => undefined,
  };
}

type FoundElement = { props?: Record<string, unknown> & { children?: unknown }; type?: unknown };

// Walks the rendered tree (expanding function components) and returns every host element
// matching `tag`, so a test can read its text or invoke its onClick handler.
function findElements(node: unknown, tag: string): FoundElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, tag));
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    if (render.name === "Icon") return [];
    return findElements(render({ ...(vnode.props ?? {}) }), tag);
  }
  const self = vnode.type === tag ? [vnode] : [];
  return self.concat(findElements(vnode.props?.children, tag));
}

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [String(node)];
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: { children?: unknown; "aria-label"?: unknown; title?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: { children?: unknown }) => unknown;
    if (render.name === "Icon") return [];
    return collectText(render({ ...(vnode.props ?? {}) }));
  }
  // For intrinsic DOM nodes (string types), include the accessible label so icon-only controls
  // that expose their state via aria-label/title (e.g. the share button) are visible to assertions.
  const labels = typeof vnode.type === "string"
    ? [vnode.props?.["aria-label"], vnode.props?.title].filter((value): value is string => typeof value === "string")
    : [];
  return [...labels, ...collectText(vnode.props?.children)];
}

function planetReference(
  planetId: string,
  owner: string,
  ownerDisplayName: string,
  coordinates: string,
  archetype?: FleetMissionPlanetReference["archetype"],
): FleetMissionPlanetReference {
  const [galaxy, system, position] = coordinates.split(":").map((part) => Number(part));
  return {
    planetId,
    owner,
    ownerDisplayName,
    name: ownerDisplayName,
    galaxy: galaxy ?? 0,
    system: system ?? 0,
    position: position ?? 0,
    coordinates,
    ...(archetype ? { archetype } : {}),
  };
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
