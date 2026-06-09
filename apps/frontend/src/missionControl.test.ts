import { describe, expect, test } from "bun:test";

import { MissionDetailPage } from "./components/MissionDetailPage";
import { MissionControlPage, partitionActiveMissionRows, type ActiveMissionRow } from "./components/MissionControlPage";
import { buildInspectHash, parseInspectRoute } from "./inspectRoutes";
import type { Coordinates } from "./types";
import { fetchBattleReports, fetchFleetMissionArchive, fetchMission, type BattleReport, type FleetMissionPlanetReference, type FleetMissionSummary } from "./walletFlow";

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
    expect(text).toContain("Intercept");
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
    // VEY-399#1: the header count reflects the de-duplicated rows (two raw rows collapse to one).
    expect(text.join(" ")).toContain("Past missions 1");
    expect(text.join(" ")).not.toContain("Past missions 2");
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

    // VEY-399#1: the count matches the single de-duplicated row, not the two raw archive rows.
    expect(text).toContain("Past missions 1");
    expect(text).not.toContain("Past missions 2");
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

  test("active mission cards drop the column-header row entirely (VEY-KANEO-400)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
    }))).join(" ");

    // Cards are self-describing, so neither the old "Route"/"Origin -> Target" column header nor the
    // full table header row is rendered; the per-card timing labels carry the meaning instead.
    expect(text).not.toContain("Origin -> Target");
    expect(text).not.toContain("Mission Route Fleet Orders");
    expect(text).toContain("Transport # 32");
    expect(text).toContain("Arrival");
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
    const openedPlayers: string[] = [];
    const text = collectText(MissionDetailPage({
      account: "0x1111111111111111111111111111111111111111",
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
      onOpenPlayer: (wallet) => openedPlayers.push(wallet),
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
    // VEY-KANEO-396: commander names are present for both sides, link to their profiles, and carry
    // their home planet/coordinates (classic combat report header).
    expect(text).toContain("Aggressor");
    expect(text).toContain("Bastion");
    expect(text).toContain("Open Aggressor (0x22222222...222222) profile");
    expect(text).toContain("Open Bastion (0x33333333...333333) profile");
    expect(text).toContain("from Aggressor [1:2:3]");
    expect(text).toContain("from Bastion [4:5:6]");
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

  test("renders the round-by-round block only when indexed round snapshots exist", () => {
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
    expect(text).toContain("Attacker firepower / losses");
    expect(text).toContain("Defender firepower / losses");
    expect(text).not.toContain("No round-by-round snapshots were indexed");
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
      ...mission("42", "Attack", "Outbound", owner, "7", "9", now - 60_000),
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
      account: owner,
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

function planetReference(planetId: string, owner: string, ownerDisplayName: string, coordinates: string): FleetMissionPlanetReference {
  const [galaxy, system, position] = coordinates.split(":").map((part) => Number(part));
  return { planetId, owner, ownerDisplayName, name: ownerDisplayName, galaxy: galaxy ?? 0, system: system ?? 0, position: position ?? 0, coordinates };
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
