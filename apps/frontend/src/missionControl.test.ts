import { describe, expect, test } from "bun:test";

import { MissionDetailPage } from "./components/MissionDetailPage";
import { EMPTY_MISSION_CONTROL_FILTERS, MissionControlPage, StationedDefenseSection, activeMissionRowMatchesFilters, allActiveMissionRows, applyMissionFilterSelectInput, buildMissionControlViewQuery, initializeMissionRowDisclosure, missionControlActiveFilterCount, missionIdMatchesMissionNumberSearch, missionPlanetCoordinateKey, missionReport, missionRowsDisclosureState, missionStatusPill, normalizeMissionControlFilters, normalizeMissionNumberSearch, parseMissionControlViewParams, persistMissionControlView, resolveMissionControlView, setMissionRowsExpanded, partitionActiveMissionRows, type ActiveMissionRow, type MissionControlFilters, type MissionControlView } from "./components/MissionControlPage";
import { MissionRouteCell, missionEndpoint, type MissionPlanetIdentity } from "./components/missionRoute";
import { planetImageForType, planetTypeFromCoordinates } from "./data/mockUniverse";
import { buildInspectPath, parseInspectPath, parseInspectRoute } from "./inspectRoutes";
import type { Coordinates } from "./types";
import { fetchBattleReports, fetchFleetMissionArchive, fetchGlobalMissionArchive, fetchMission, type BattleReport, type FleetMissionPlanetReference, type FleetMissionSummary, type FleetMissionVisibilityResponse } from "./walletFlow";

const missionRouteSource = await Bun.file(new URL("./components/missionRoute.tsx", import.meta.url)).text();
const missionControlSource = await Bun.file(new URL("./components/MissionControlPage.tsx", import.meta.url)).text();

describe("Mission Control battle reports", () => {
  test("builds shareable report list and detail routes", () => {
    expect(parseInspectRoute("#/battle-reports")).toEqual({ kind: "page", page: "battle-reports" });
    expect(buildInspectPath({ kind: "page", page: "battle-reports" })).toBe("/battle-reports");
    // Legacy single-report deep links now redirect to the unified mission detail page,
    // which is itself the shareable public report.
    expect(parseInspectRoute("#/battle-report/42")).toEqual({ kind: "mission", missionId: "42" });
    expect(parseInspectRoute("#/mission/42")).toEqual({ kind: "mission", missionId: "42" });
    expect(buildInspectPath({ kind: "mission", missionId: "42" })).toBe("/mission/42");
    expect(parseInspectRoute("#/moon/6/9/1")).toEqual({ kind: "moon", coords: { galaxy: 6, system: 9, position: 1 } });
    expect(parseInspectPath("/moon/6/9/1")).toEqual({ kind: "moon", coords: { galaxy: 6, system: 9, position: 1 } });
    expect(buildInspectPath({ kind: "moon", coords: { galaxy: 6, system: 9, position: 1 } })).toBe("/moon/6/9/1");
    expect(parseInspectPath("/invite")).toEqual({ kind: "page", page: "alliance-invites" });
    expect(parseInspectPath("/alliance-invites")).toEqual({ kind: "page", page: "alliance-invites" });
    expect(buildInspectPath({ kind: "page", page: "alliance-invites" })).toBe("/invite");
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

  test("fetches wallet incoming attack archive with server-side pagination", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const wallet = "0x1111111111111111111111111111111111111111";

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        wallet,
        homePlanetId: "7",
        rows: [],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await fetchFleetMissionArchive("https://api.example.test/", wallet, { filter: "incomingAttacks", page: 1, pageSize: 25 });
      expect(requestedUrls).toEqual([
        `https://api.example.test/wallet/${wallet}/missions?status=completed&filter=incomingAttacks&page=1&pageSize=25`,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches wallet and global mission archives with composable server-side filters", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const wallet = "0x1111111111111111111111111111111111111111";

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        wallet,
        homePlanetId: "7",
        rows: [{ kind: "mission", mission: mission("1473") }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      const filters = { missionNumber: "147", missionType: "Harvest", page: 1, pageSize: 25, planetId: "9" };
      await fetchFleetMissionArchive("https://api.example.test/", wallet, filters);
      await fetchGlobalMissionArchive("https://api.example.test/", filters);
      await fetchGlobalMissionArchive("https://api.example.test/", { ...filters, pageSize: 1, summaryOnly: true });
      expect(requestedUrls).toEqual([
        `https://api.example.test/wallet/${wallet}/missions?status=completed&missionNumber=147&missionType=Harvest&planetId=9&page=1&pageSize=25`,
        "https://api.example.test/missions?status=completed&missionNumber=147&missionType=Harvest&planetId=9&page=1&pageSize=25",
        "https://api.example.test/missions?status=completed&missionNumber=147&missionType=Harvest&planetId=9&summaryOnly=true&page=1&pageSize=1",
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
      now,      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
    })).join(" ");

    expect(text).not.toContain("Mission Control");
    expect(text).not.toContain("Watch inbound attacks");
    // "Hostile inbound" persists as the active-row direction label, not as a summary stat card.
    expect(text).toContain("Hostile inbound");
    // The top summary stat-card row (Active missions / Due resolvers / Hostile inbound / Returns) is removed.
    expect(text).not.toContain("Due resolvers");
    // Section header labels are dropped; grouping is conveyed by the tables themselves.
    expect(text).not.toContain("Fleet movement");
    expect(text).toContain("Past missions");
    // VEY-397#7: commander shown as clickable subtext under each endpoint (wallet fallback) — but
    // only for OTHER players; the connected wallet's own name under its own planets is suppressed.
    expect(text).toContain("0x2222...2222");
    expect(text).not.toContain("0x1111...1111");
    // Endpoints render bare (planet + commander); the single column-header row labels the route
    // column once, so rows carry no per-row Origin/Destination captions.
    expect(text).toContain("Planet #8");
    expect(text).toContain("Planet #7");
    expect(text).toContain("Route");
    expect(text).not.toContain("Origin");
    expect(text).not.toContain("Destination");
    expect(text).not.toContain("Target Planet #7");
    // VEY-397#9: fleet column shows ship icons with xN counts (ship name is in the hover title).
    expect(text).toContain("x3");
    expect(text).toContain("Defend planet");
    // VEY-KANEO-439: Intercept removed from the frontend; only Defend planet (AcsDefend) remains.
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
      now,      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
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

  test("renders mission 9445 exactly once from outbound through defender return and archive handoff", () => {
    const now = Date.parse("2026-07-30T16:40:00.000Z");
    const attacker = "0x2222222222222222222222222222222222222222";
    const outbound = mission("9445", "Attack", "Outbound", attacker, "9", "7", now + 60_000);
    const returning = {
      ...outbound,
      status: "Returning",
      arrivalAt: Math.floor((now - 60_000) / 1_000).toString(),
      returnAt: Math.floor((now + 594_000) / 1_000).toString(),
    };
    const returned = { ...returning, status: "Returned" };
    const report = battleReport("9445");
    const archive = (archivedMission: FleetMissionSummary) => ({
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      rows: [{ kind: "mission" as const, mission: archivedMission, report }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalEntries: 1,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const render = (
      incoming: FleetMissionSummary[],
      battleReports: BattleReport[],
      missionArchive?: ReturnType<typeof archive>,
    ) => MissionControlPage({
      ...missionControlProps(now, { incoming }),
      fleetVisibility: {
        ...missionControlProps(now, { incoming }).fleetVisibility!,
        battleReports,
      },
      missionArchive,
    });

    const outboundText = collectText(render([outbound], [])).join(" ");
    expect(countOccurrences(outboundText, "#9445")).toBe(1);
    expect(outboundText).toContain("Hostile inbound");

    // The backend supplies the returning mission in both active visibility and the archive. The
    // archive copy is a standby for an atomic handoff, not a second rendered row (VEY-KANEO-434).
    const returningText = collectText(render([returning], [report], archive(returning))).join(" ");
    expect(countOccurrences(returningText, "#9445")).toBe(1);
    expect(returningText).toContain("Combat resolved · attacker returning");
    expect(returningText).toContain("Returning");
    expect(returningText).toContain("Loot");
    expect(returningText).toContain("Attacker losses");
    expect(returningText).toContain("Defender losses");

    const returnedText = collectText(render([], [], archive(returned))).join(" ");
    expect(countOccurrences(returnedText, "#9445")).toBe(1);
    expect(returnedText).toContain("Returned");
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

  test("labels early and late recalled Attacks from indexed provenance and omits target arrival", () => {
    const now = Date.parse("2026-06-08T23:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const arrivalAt = now - 7_200_000;
    const recalls = [
      { missionId: "754", returnAt: arrivalAt - 1_800_000 },
      // A valid recall after the outbound midpoint returns home after the original target ETA.
      { missionId: "755", returnAt: arrivalAt + 1_800_000 },
    ];

    for (const recall of recalls) {
      const recalledAttack = {
        ...mission(recall.missionId, "Attack", "Returned", owner, "7", "9", arrivalAt),
        recallProvenance: "FleetMissionRecalled" as const,
        returnAt: Math.floor(recall.returnAt / 1_000).toString(),
      };
      const tree = MissionControlPage({
        ...missionControlProps(now, {}),
        missionArchive: {
          wallet: owner,
          homePlanetId: "7",
          // Provenance remains authoritative even if a stale/colliding report row is present.
          rows: [{ kind: "mission", mission: recalledAttack, report: battleReport(recall.missionId) }],
          pagination: { page: 1, pageSize: 25, totalEntries: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
        },
      });
      const text = collectText(tree).join(" ");

      expect(text).toContain("Recalled");
      expect(text).toContain("Recalled — returned");
      expect(text).not.toContain("Arrived");
    }
  });

  test("does not infer recall from timestamps or stored recall cost on normal terminal missions", () => {
    const now = Date.parse("2026-06-08T23:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const arrivalAt = now - 7_200_000;

    for (const missionType of ["Attack", "Deploy", "Colonize", "DefenseHold"]) {
      const completed = {
        ...mission(`755-${missionType}`, missionType, "Returned", owner, "7", "9", arrivalAt),
        // Projected recallCost may survive in older summaries; it is not event provenance.
        recallCost: "50",
      };
      const tree = MissionControlPage({
        ...missionControlProps(now, {}),
        missionArchive: {
          wallet: owner,
          homePlanetId: "7",
          rows: [{ kind: "mission", mission: completed }],
          pagination: { page: 1, pageSize: 25, totalEntries: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
        },
      });
      const text = collectText(tree).join(" ");

      expect(text).not.toContain("Recalled");
      expect(text).toContain("Returned");
      expect(text).toContain("Arrived");
    }
  });

  test("Past Missions All rows show returned attack outcome, loot, losses, cargo, and debris (VEY-KANEO-668)", () => {
    const now = Date.parse("2026-06-29T22:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const completed: FleetMissionSummary = {
      ...mission("668", "Attack", "Returned", owner, "7", "9", now - 7_200_000),
      cargo: { metal: "400", crystal: "120", deuterium: "30" },
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4"),
    };
    const report: BattleReport = {
      ...battleReport("668"),
      loot: { metal: "900", crystal: "450", deuterium: "75" },
      attackerLosses: { metal: "100", crystal: "50", deuterium: "0" },
      defenderLosses: { metal: "1200", crystal: "300", deuterium: "0" },
      debris: { metal: "390", crystal: "105" },
    };
    const tree = MissionControlPage({
      ...missionControlProps(now, {}),
      globalMissionArchive: {
        rows: [{ kind: "mission", mission: completed, report }],
        pagination: { page: 1, pageSize: 25, totalEntries: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      initialView: { activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "all" },
    });
    const allPanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "all");
    const text = collectText(allPanel).join(" ");

    expect(allPanel).toBeDefined();
    expect(text).toMatch(/Outcome\s+Attacker win/);
    expect(text).toMatch(/Loot\s+900 M \/ 450 C \/ 75 D/);
    expect(text).toMatch(/Attacker losses\s+100 M \/ 50 C/);
    expect(text).toMatch(/Defender losses\s+1,200 M \/ 300 C/);
    expect(text).toMatch(/Cargo\s+400 M \/ 120 C \/ 30 D/);
    expect(text).toMatch(/Debris field\s+390 M \/ 105 C/);
  });

  test("renders the Incoming attacks past mission filter as a restored tab (VEY-KANEO-564)", () => {
    const now = Date.parse("2026-06-08T23:00:00.000Z");
    const wallet = "0x1111111111111111111111111111111111111111";
    const attacker = "0x3333333333333333333333333333333333333333";
    const incomingAttack: FleetMissionSummary = {
      ...mission("80", "Attack", "Returned", attacker, "9", "7", now - 7_200_000),
      originPlanet: planetReference("9", attacker, "Raider", "1:2:3"),
      targetPlanet: planetReference("7", wallet, "New Zion", "6:9:1"),
    };
    const outgoingAttack: FleetMissionSummary = {
      ...mission("81", "Attack", "Returned", wallet, "7", "9", now - 7_100_000),
      originPlanet: planetReference("7", wallet, "New Zion", "6:9:1"),
      targetPlanet: planetReference("9", attacker, "Borealis", "5:407:4"),
    };
    const tree = MissionControlPage({
      ...missionControlProps(now, {}),
      incomingAttackArchive: {
        wallet,
        homePlanetId: "7",
        rows: [{ kind: "mission", mission: incomingAttack }],
        pagination: { page: 1, pageSize: 25, totalEntries: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      initialView: { activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "incomingAttacks" },
      missionArchive: {
        wallet,
        homePlanetId: "7",
        rows: [{ kind: "mission", mission: incomingAttack }, { kind: "mission", mission: outgoingAttack }],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
    });

    const section = findElements(tree, "section").find((node) => node.props?.["data-past-tab"] !== undefined);
    expect(section?.props?.["data-past-tab"]).toBe("incomingAttacks");
    const incomingButton = findElements(tree, "button").find((node) => node.props?.["data-past-tab-button"] === "incomingAttacks");
    expect(incomingButton?.props?.["aria-selected"]).toBe(true);
    expect(collectText(incomingButton).join(" ")).toContain("Incoming attacks (1)");

    const incomingPanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "incomingAttacks");
    const incomingText = collectText(incomingPanel).join(" ");
    expect(incomingPanel).toBeDefined();
    expect(incomingText).toContain("Incoming attack");
    expect(incomingText).toContain("Raider");
    expect(incomingText).not.toContain("Borealis");
  });

  test("keeps Incoming attacks route endpoints wide enough for normal player names", () => {
    expect(missionRouteSource).toContain("max-w-[7.5rem]");
    expect(missionRouteSource).toContain("sm:max-w-[11rem]");
    expect(missionRouteSource).not.toContain("max-w-[7rem]");
  });

  test("VEY-KANEO-440: stationed-defense panel lists own defending fleets and allied defenders at your planets", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const attacker = "0x2222222222222222222222222222222222222222";
    // The player has an ACS Defend fleet stationed at an ally planet, holding until the defended attack.
    const stationed: FleetMissionSummary = {
      ...mission("90", "AcsDefend", "Outbound", owner, "7", "9", now + 120_000),
      defendsMissionId: "55",
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", attacker, "Borealis", "5:407:4", "frozen-ice"),
    };
    // An incoming attack on the player's own planet already has two allied defenders stationed.
    const attackOnMe: FleetMissionSummary = {
      ...mission("55", "Attack", "Outbound", attacker, "8", "7", now + 90_000),
      counterplayDefenderMissionIds: ["90", "91"],
      originPlanet: planetReference("8", attacker, "Hostis", "9:1:2", "hot-desert"),
      targetPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
    };
    const text = collectText(MissionControlPage(missionControlProps(now, {
      incoming: [attackOnMe],
      outgoing: [stationed],
    }))).join(" ");

    expect(text).toContain("Stationed defenses");
    // Own stationed fleet card: violet "Defending" badge + "Holds" countdown.
    expect(text).toContain("Defending");
    expect(text).toContain("Holds");
    // Allied defenders at the player's planet are summarised by count.
    expect(text).toContain("2 allied fleets stationed in defense");
  });

  test("VEY-KANEO-440: stationed-defense section renders from embedded planet refs without a lookup (Defenses-page reuse)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const attacker = "0x2222222222222222222222222222222222222222";
    const stationed: FleetMissionSummary = {
      ...mission("90", "AcsDefend", "Outbound", owner, "7", "9", now + 120_000),
      defendsMissionId: "55",
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", attacker, "Borealis", "5:407:4", "frozen-ice"),
    };
    // Callers without a prebuilt planet lookup still resolve endpoints from each summary's embedded
    // origin/target planet references.
    const text = collectText(StationedDefenseSection({
      incoming: [],
      now,
      onOpenReport: () => undefined,
      outgoing: [stationed],
    })).join(" ");

    expect(text).toContain("Stationed defenses");
    expect(text).toContain("Defending");
    expect(text).toContain("Borealis");
    expect(text).toContain("New Zion");
  });

  test("VEY-KANEO-455: Mission Control hides the Stationed defenses section until allied defenses are stationed", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
    }))).join(" ");

    // With no stationed defenses, Mission Control omits the section entirely (VEY-KANEO-455).
    expect(text).not.toContain("Stationed defenses");
    expect(text).not.toContain("No fleets are stationed in defense");
    // A Transport mission must never be mistaken for a stationed defense.
    expect(text).not.toContain("allied fleets stationed in defense");
  });

  test("VEY-KANEO-455: Defenses-style reuse (no hideWhenEmpty) still shows the discoverable empty state", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(StationedDefenseSection({
      incoming: [],
      now,
      outgoing: [],
      onOpenReport: () => undefined,
    })).join(" ");

    expect(text).toContain("Stationed defenses");
    expect(text).toContain("No fleets are stationed in defense");
    // The empty state must point players to the proactive Defend entry point (Galaxy → own colony /
    // ally planet → Defend) and explain the prerequisite, so the feature is discoverable rather than
    // reading as missing — the repeated QA "no Defend button anywhere" rework cause (VEY-KANEO-440).
    expect(text).toContain("Defend");
    expect(text).toContain("requires a second colony or an alliance member's planet");
  });

  test("VEY-KANEO-440: stationed-defense panel renders a clickable Defend-a-planet CTA wired to navigation", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    let defendOpened = 0;
    // The Defend launch lives on a planet's Defend action, but players/QA look for it on this panel
    // (the empty state literally tells them to "choose Defend"). The CTA must be present and invoke the
    // open-my-planet callback so the entry point is discoverable from the screen that describes it —
    // this is the recurring "no Defend button anywhere" QA rework cause.
    const tree = StationedDefenseSection({
      incoming: [],
      now,
      outgoing: [],
      onOpenReport: () => undefined,
      onDefendPlanet: () => {
        defendOpened += 1;
      },
    });
    const text = collectText(tree).join(" ");
    expect(text).toContain("Defend a planet");

    const button = findElement(tree, (node) =>
      node.type === "button"
      && collectText(node.props?.children).join(" ").includes("Defend a planet"));
    expect(button).toBeTruthy();
    (button?.props as { onClick: () => void }).onClick();
    expect(defendOpened).toBe(1);

    // Without the callback the CTA is omitted (e.g. contexts that cannot navigate).
    const noCta = collectText(StationedDefenseSection({
      incoming: [],
      now,
      outgoing: [],
      onOpenReport: () => undefined,
    })).join(" ");
    expect(noCta).not.toContain("Defend a planet");
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

  test("labels non-offensive inbound missions as friendly in Mission Control", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage(missionControlProps(now, {
      incoming: [
        mission(
          "35",
          "Transport",
          "Outbound",
          "0x2222222222222222222222222222222222222222",
          "8",
          "7",
          now + 60_000,
        ),
      ],
    }))).join(" ");

    expect(text).toContain("Friendly inbound");
    expect(text).toContain("Incoming transport");
    expect(text).not.toContain("Hostile inbound");
  });

  test("hides the disabled Join action and renders no manual Resolve order (VEY-KANEO-468)", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // Own outbound attack already arrived: arrival now reconciles lazily on-chain, so there is no
    // manual "Resolve" order anymore. A joinable alliance attack that already arrived -> Join is
    // disabled, so it is hidden.
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000)],
      joinableAttacks: [mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now - 60_000)],
    }))).join(" ");

    expect(text).not.toContain("Resolve");
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
    const text = collectText(MissionControlPage({ ...missionControlProps(now, {
      incoming: [mission("31", "Attack", "Outbound", "0x2222222222222222222222222222222222222222", "8", "7", now + 60_000)],
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      returning: [mission("33", "Deploy", "Returning", "0x1111111111111111111111111111111111111111", "9", "7", now - 60_000)],
      joinableAttacks: [mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now + 180_000)],
    }), initialView: { activePage: 0, activeTab: "alliance", pastPage: 0, pastTab: "mine" } })).join(" ");

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
    const joinCalls: Array<[FleetMissionSummary, { galaxy: number; system: number; position: number } | null]> = [];
    const tree = MissionControlPage({
      ...missionControlProps(now, { joinableAttacks: [joinable] }),
      onJoinAttack: (mission, targetCoords) => {
        joinCalls.push([mission, targetCoords]);
      },
      initialView: { activePage: 0, activeTab: "alliance", pastPage: 0, pastTab: "mine" },
    });

    const joinButton = findElements(tree, "button").find(
      (element) => element.props?.title === "Join this alliance attack",
    );
    expect(joinButton).toBeDefined();
    (joinButton?.props?.onClick as (() => void) | undefined)?.();

    // The click no longer sends a default fleet immediately; it hands the mission
    // full lead mission and resolved target coordinates up so the parent can
    // open the same fleet picker with every indexed attack participant.
    expect(joinCalls).toEqual([[joinable, { galaxy: 4, system: 5, position: 6 }]]);
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
      initialView: { activePage: 0, activeTab: "all", pastPage: 0, pastTab: "mine" },
    })).join(" ");

    expect(text).toContain("My missions (1)");
    expect(text).toContain("All (2)");
    // The other player's mission appears on the universe-wide All tab...
    expect(text).toContain("#90");
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
      initialView: { activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "all" },
    })).join(" ");

    // The past panel gains a scope tab control; My missions is empty here, All carries the universe count.
    expect(text).toContain("Past missions");
    expect(text).toContain("All (26)");
    // Server-side pagination range proves the 25-per-page split (26 rows -> first page shows 1-25).
    expect(text).toContain("1-25 of 26");
  });

  test("shows the eager universe archive total before the hidden All tab loads", () => {
    const now = Date.parse("2026-08-04T05:00:00.000Z");
    const tree = MissionControlPage({
      ...missionControlProps(now, {}),
      globalMissionArchiveTotalEntries: 12_881,
      initialView: { activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" },
    });
    const text = collectText(tree).join(" ");
    const allPanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "all");

    expect(text).toContain("All (12881)");
    expect(allPanel).toBeUndefined();
  });

  test("does not claim the hidden All archive has zero missions while its eager total loads", () => {
    const tree = MissionControlPage({
      ...missionControlProps(Date.parse("2026-08-04T05:00:00.000Z"), {}),
      initialView: { activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" },
    });
    const allPastButton = findElements(tree, "button").find((node) => node.props?.["data-past-tab-button"] === "all");
    const text = collectText(allPastButton).join(" ");

    expect(text).toBe("All (…)");
  });

  test("filters Mission Control active and past rows by mission number and clears back to the full list", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const filtered = collectText(MissionControlPage({
      ...missionControlProps(now, {
        incoming: [mission("123", "Attack", "Outbound", "0x2222222222222222222222222222222222222222", "8", "7", now + 60_000)],
        outgoing: [mission("45", "Transport", "Outbound", owner, "7", "9", now + 120_000)],
      }),
      missionArchive: {
        wallet: owner,
        homePlanetId: "7",
        rows: [
          { kind: "mission", mission: mission("9123", "Transport", "Returned", owner) },
          { kind: "mission", mission: mission("77", "Transport", "Returned", owner) },
        ],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      missionNumberSearch: "#123",
    })).join(" ");

    expect(filtered).toContain("Mission #");
    expect(filtered).toContain("#123");
    expect(filtered).toContain("#9123");
    expect(filtered).not.toContain("#45");
    expect(filtered).not.toContain("#77");

    const cleared = collectText(MissionControlPage({
      ...missionControlProps(now, {
        incoming: [mission("123", "Attack", "Outbound", "0x2222222222222222222222222222222222222222", "8", "7", now + 60_000)],
        outgoing: [mission("45", "Transport", "Outbound", owner, "7", "9", now + 120_000)],
      }),
      missionArchive: {
        wallet: owner,
        homePlanetId: "7",
        rows: [
          { kind: "mission", mission: mission("9123", "Transport", "Returned", owner) },
          { kind: "mission", mission: mission("77", "Transport", "Returned", owner) },
        ],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      missionNumberSearch: "",
    })).join(" ");

    expect(cleared).toContain("#123");
    expect(cleared).toContain("#45");
    expect(cleared).toContain("#9123");
    expect(cleared).toContain("#77");
  });

  test("shows a compact empty state when mission-number search has no visible matches", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage({
      ...missionControlProps(now, {
        outgoing: [mission("45", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      }),
      missionNumberSearch: "999",
    })).join(" ");

    expect(text).toContain("No missions match #999.");
    expect(text).not.toContain("#45");
  });

  test("normalizes mission-number search and supports numeric partial matching", () => {
    expect(normalizeMissionNumberSearch(" #14-73 ")).toBe("1473");
    expect(missionIdMatchesMissionNumberSearch("1473", "47")).toBe(true);
    expect(missionIdMatchesMissionNumberSearch("1473", "#999")).toBe(false);
    expect(missionIdMatchesMissionNumberSearch("1473", "")).toBe(true);
  });

  test("normalizes every filter and reports the active-filter count", () => {
    expect(normalizeMissionControlFilters({
      direction: "returning",
      missionNumber: " #14-73 ",
      missionType: " Harvest ",
      planetId: "Planet #009",
    })).toEqual({
      direction: "returning",
      missionNumber: "1473",
      missionType: "Harvest",
      planetId: "9",
    });
    expect(missionControlActiveFilterCount(EMPTY_MISSION_CONTROL_FILTERS)).toBe(0);
    expect(missionControlActiveFilterCount({
      direction: "returning",
      missionNumber: "1473",
      missionType: "Harvest",
      planetId: "9",
    })).toBe(4);
  });

  test("filters Harvest missions across active and past lists", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const text = collectText(MissionControlPage({
      ...missionControlProps(now, {
        outgoing: [
          mission("75301", "Harvest", "Outbound", owner, "7", "9", now + 60_000),
          mission("75302", "Transport", "Outbound", owner, "7", "10", now + 120_000),
          mission("75305", "DefenseHold", "Outbound", owner, "7", "9", now + 180_000),
        ],
      }),
      missionArchive: {
        wallet: owner,
        homePlanetId: "7",
        rows: [
          { kind: "mission", mission: mission("75303", "Harvest", "Returned", owner, "9", "7") },
          { kind: "mission", mission: mission("75304", "Attack", "Returned", owner, "8", "7") },
        ],
        pagination: { page: 1, pageSize: 25, totalEntries: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
      missionFilters: { missionType: "Harvest" },
    })).join(" ");

    expect(text).toContain("#75301");
    expect(text).toContain("#75303");
    expect(text).not.toContain("#75302");
    expect(text).not.toContain("#75304");
    expect(text).not.toContain("#75305");
    expect(text).not.toContain("Stationed defenses");
  });

  test("filters returning fleets and composes mission number, type, direction, and planet ID", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const returningMatch = mission("75311", "Harvest", "Returning", owner, "7", "9", now - 60_000);
    const wrongPlanet = mission("75312", "Harvest", "Returning", owner, "7", "10", now - 60_000);
    const wrongType = mission("75313", "Attack", "Returning", owner, "7", "9", now - 60_000);
    const outbound = mission("75314", "Harvest", "Outbound", owner, "7", "9", now + 60_000);
    const filters: MissionControlFilters = {
      direction: "returning",
      missionNumber: "7531",
      missionType: "Harvest",
      planetId: "9",
    };
    const text = collectText(MissionControlPage({
      ...missionControlProps(now, {
        outgoing: [outbound],
        returning: [returningMatch, wrongPlanet, wrongType],
      }),
      missionFilters: filters,
    })).join(" ");

    expect(text).toContain("#75311");
    expect(text).not.toContain("#75312");
    expect(text).not.toContain("#75313");
    expect(text).not.toContain("#75314");
    expect(activeMissionRowMatchesFilters({ context: "returning", direction: "Returning", mission: returningMatch }, filters)).toBe(true);
    expect(activeMissionRowMatchesFilters({ context: "outgoing", direction: "Outbound", mission: outbound }, filters)).toBe(false);
  });

  test("renders a compact accessible popover with active trigger state and Clear all", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const changes: MissionControlFilters[] = [];
    const tree = MissionControlPage({
      ...missionControlProps(now, {}),
      missionFilters: {
        direction: "returning",
        missionNumber: "753",
        missionType: "Harvest",
        planetId: "9",
      },
      onMissionFiltersChange: (filters) => changes.push(filters),
    });
    const filterDetails = findElements(tree, "details").find((node) => node.props?.["data-mission-filters"] === true);
    const trigger = findElements(filterDetails, "summary")[0];
    const filterCount = findElements(trigger, "span").find((node) => node.props?.["data-mission-filter-count"] === true);
    const dialog = findElements(filterDetails, "div").find((node) => node.props?.role === "dialog");
    const clearButton = findElements(filterDetails, "button").find((node) => collectText(node).includes("Clear all"));
    const inputs = findElements(filterDetails, "input");
    const selects = findElements(filterDetails, "select");
    const toolbar = findElements(tree, "div").find((node) => node.props?.["data-mission-toolbar"] === true);

    expect(filterDetails?.props?.["data-active-filter-count"]).toBe(4);
    expect(trigger?.props?.["aria-label"]).toBe("Mission filters, 4 active");
    expect(collectText(filterCount)).toContain("4");
    expect(trigger?.props?.["aria-haspopup"]).toBe("dialog");
    expect(trigger?.props?.["aria-controls"]).toBe("mission-control-filter-popover");
    expect(findElements(toolbar, "details").some((node) => node.props?.["data-mission-filters"] === true)).toBe(true);
    expect(findElements(toolbar, "button").some((node) => node.props?.["data-mission-disclosure-toggle"] === true)).toBe(true);
    expect(dialog?.props?.["aria-label"]).toBe("Mission filters");
    expect(String(dialog?.props?.className)).toContain("calc(100vw-1.5rem)");
    expect(inputs.map((input) => input.props?.["aria-label"])).toEqual([
      "Search missions by number",
      "Filter by origin or destination planet ID",
    ]);
    expect(selects.map((select) => select.props?.["aria-label"])).toEqual([
      "Filter by mission type",
      "Filter by mission direction or state",
    ]);

    let escapePrevented = false;
    let triggerFocused = false;
    const detailsElement = {
      open: true,
      querySelector: () => ({ focus: () => { triggerFocused = true; } }),
    };
    const onKeyDown = filterDetails?.props?.onKeyDown as ((event: {
      currentTarget: typeof detailsElement;
      key: string;
      preventDefault: () => void;
    }) => void) | undefined;
    onKeyDown?.({
      currentTarget: detailsElement,
      key: "Escape",
      preventDefault: () => { escapePrevented = true; },
    });
    expect(detailsElement.open).toBe(false);
    expect(escapePrevented).toBe(true);
    expect(triggerFocused).toBe(true);

    const onClick = clearButton?.props?.onClick as ((event: { currentTarget: { closest: () => null } }) => void) | undefined;
    onClick?.({ currentTarget: { closest: () => null } });
    expect(changes).toEqual([{ ...EMPTY_MISSION_CONTROL_FILTERS }]);

    const neutralTree = MissionControlPage({ ...missionControlProps(now, {}), missionFilters: EMPTY_MISSION_CONTROL_FILTERS });
    const neutralDetails = findElements(neutralTree, "details").find((node) => node.props?.["data-mission-filters"] === true);
    const neutralTrigger = findElements(neutralDetails, "summary")[0];
    expect(neutralDetails?.props?.["data-active-filter-count"]).toBe(0);
    expect(neutralTrigger?.props?.["aria-label"]).toBe("Mission filters");
    expect(findElements(neutralTrigger, "span").some((node) => node.props?.["data-mission-filter-count"] === true)).toBe(false);
  });

  test("applies mission type and flight state from the mobile select input event", () => {
    const changes: MissionControlFilters[] = [];
    const onChange = (filters: MissionControlFilters) => changes.push(filters);
    applyMissionFilterSelectInput(EMPTY_MISSION_CONTROL_FILTERS, "missionType", "Harvest", onChange);
    applyMissionFilterSelectInput(EMPTY_MISSION_CONTROL_FILTERS, "direction", "returning", onChange);

    expect(changes).toEqual([
      { ...EMPTY_MISSION_CONTROL_FILTERS, missionType: "Harvest" },
      { ...EMPTY_MISSION_CONTROL_FILTERS, direction: "returning" },
    ]);
    expect(missionControlSource).toContain('onInput={(event) => applyMissionFilterSelectInput(filters, "missionType"');
    expect(missionControlSource).toContain('onInput={(event) => applyMissionFilterSelectInput(filters, "direction"');
  });

  test("switches Expand all to Collapse all and tracks individual row changes", () => {
    const rows = [{ open: false }, { open: false }, { open: true }];
    expect(missionRowsDisclosureState(rows)).toEqual({
      allExpanded: false,
      label: "Expand all",
      nextOpen: true,
    });

    setMissionRowsExpanded(rows, true);
    expect(rows.every((row) => row.open)).toBe(true);
    expect(missionRowsDisclosureState(rows)).toEqual({
      allExpanded: true,
      label: "Collapse all",
      nextOpen: false,
    });

    rows[1]!.open = false;
    expect(missionRowsDisclosureState(rows).label).toBe("Expand all");
    setMissionRowsExpanded(rows, true);
    setMissionRowsExpanded(rows, missionRowsDisclosureState(rows).nextOpen);
    expect(rows.every((row) => !row.open)).toBe(true);
    expect(missionRowsDisclosureState([])).toEqual({
      allExpanded: false,
      label: "Expand all",
      nextOpen: true,
    });
  });

  test("shows Expand all only when the selected views contain filter-matching cards", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const props = missionControlProps(now, {
      outgoing: [
        mission("75331", "Harvest", "Outbound", owner, "7", "9", now + 60_000),
        mission("75332", "Transport", "Outbound", owner, "7", "10", now + 120_000),
      ],
    });
    const matchingTree = MissionControlPage({
      ...props,
      missionFilters: { missionType: "Harvest" },
    });
    const matchingControl = findElements(matchingTree, "button")
      .find((node) => node.props?.["data-mission-disclosure-toggle"] === true);
    const matchingRows = findElements(matchingTree, "details")
      .filter((node) => node.props?.["data-mission-row"] === true);
    expect(matchingControl?.props?.hidden).toBe(false);
    expect(matchingControl?.props?.["aria-label"]).toBe("Expand all visible mission cards");
    expect(matchingRows.length).toBeGreaterThan(0);
    expect(matchingRows.every((row) => typeof row.props?.onToggle === "function")).toBe(true);

    const noMatchTree = MissionControlPage({
      ...props,
      missionFilters: { missionType: "Deploy" },
    });
    const noMatchControl = findElements(noMatchTree, "button")
      .find((node) => node.props?.["data-mission-disclosure-toggle"] === true);
    expect(noMatchControl?.props?.hidden).toBe(true);

    const hiddenTabTree = MissionControlPage({
      ...props,
      initialView: { activePage: 0, activeTab: "alliance", pastPage: 0, pastTab: "mine" },
      missionFilters: { missionType: "Harvest" },
    });
    const hiddenTabControl = findElements(hiddenTabTree, "button")
      .find((node) => node.props?.["data-mission-disclosure-toggle"] === true);
    expect(hiddenTabControl?.props?.hidden).toBe(true);
  });

  test("shows the Alliance empty state when there are no joinable attacks", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionControlPage({ ...missionControlProps(now, {
      outgoing: [mission("32", "Transport", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 120_000)],
      joinableAttacks: [],
    }), initialView: { activePage: 0, activeTab: "alliance", pastPage: 0, pastTab: "mine" } })).join(" ");

    expect(text).toContain("My missions (1)");
    expect(text).toContain("Alliance (0)");
    expect(text).toContain("No joinable alliance attacks.");
  });

  test("VEY-KANEO-783: canonical membership alone controls Alliance visibility across loss, stale rows, and rejoin", () => {
    const now = Date.parse("2026-07-30T17:30:00.000Z");
    const joinable = mission(
      "783",
      "AcsAttack",
      "Outbound",
      "0x2222222222222222222222222222222222222222",
      "8",
      "9",
      now + 120_000,
    );
    const props = missionControlProps(now, { joinableAttacks: [joinable] });

    const memberTree = MissionControlPage({ ...props, hasAlliance: true });
    const memberAllianceButton = findElements(memberTree, "button")
      .find((node) => node.props?.["data-active-tab-button"] === "alliance");
    expect(memberAllianceButton).toBeDefined();
    // One responsive tab control covers the touch/mobile and desktop layouts.
    expect(String(memberAllianceButton?.props?.className)).toContain("py-2");
    expect(String(memberAllianceButton?.props?.className)).toContain("sm:py-1");

    for (const transition of ["dissolved", "left-or-removed"] as const) {
      const nonmemberTree = MissionControlPage({ ...props, hasAlliance: false });
      expect(
        findElements(nonmemberTree, "button")
          .some((node) => node.props?.["data-active-tab-button"] === "alliance"),
        transition,
      ).toBe(false);
      const nonmemberText = collectText(nonmemberTree).join(" ");
      expect(nonmemberText).not.toContain("Alliance (1)");
      expect(nonmemberText).not.toContain("#783");
    }

    const rejoinedTree = MissionControlPage({ ...props, hasAlliance: true });
    expect(
      findElements(rejoinedTree, "button")
        .some((node) => node.props?.["data-active-tab-button"] === "alliance"),
    ).toBe(true);
  });

  test("VEY-KANEO-783: losing membership repairs a persisted Alliance view back to My missions", () => {
    const now = Date.parse("2026-07-30T17:30:00.000Z");
    persistMissionControlView({ activePage: 3, activeTab: "alliance", pastPage: 2, pastTab: "all" });
    try {
      const tree = MissionControlPage({
        ...missionControlProps(now, {}),
        hasAlliance: false,
      });

      expect(sectionByData(tree, "data-active-tab")?.props?.["data-active-tab"]).toBe("mine");
      expect(resolveMissionControlView()).toEqual({
        activePage: 0,
        activeTab: "mine",
        pastPage: 2,
        pastTab: "all",
      });
    } finally {
      persistMissionControlView({ activePage: 0, activeTab: "mine", pastPage: 0, pastTab: "mine" });
    }
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
    const text = collectText(MissionControlPage({ ...missionControlProps(now, { joinableAttacks }), initialView: { activePage: 0, activeTab: "alliance", pastPage: 0, pastTab: "mine" } })).join(" ");

    expect(text).toContain("Alliance (26)");
    // Pagination range proves the 25-per-page split (26 rows -> first page shows 1-25).
    expect(text).toContain("1-25 of 26");
  });

  test("omits the obsolete needs-orders flair for joinable attacks", () => {
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

  test("omits the obsolete needs-orders flair for the player's own due missions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // One own outbound mission already arrived (due), plus two due joinable alliance attacks that
    // previously fed the removed header flair.
    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [mission("32", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000)],
      joinableAttacks: [
        mission("34", "Attack", "Outbound", "0x3333333333333333333333333333333333333333", "5", "6", now - 60_000),
        mission("35", "Attack", "Outbound", "0x4444444444444444444444444444444444444444", "5", "6", now - 60_000),
      ],
    }))).join(" ").replace(/\s+/g, " ");

    expect(text).not.toContain("Needs orders now");
    expect(text).toContain("Resolving");
  });

  test("renders shareable mission detail stages, actions, and battle report structure", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    })).join(" ");

    expect(text).not.toContain("Mission #42");
    expect(text).not.toContain("Mission Detail");
    // VEY-KANEO-468: arrival/return completions reconcile lazily on-chain, so the former manual
    // "Resolve" order is gone from the detail screen; an arrived outbound attack shows no order.
    expect(text).not.toContain("Resolve");
    // VEY-395 rework: the mission-detail page subtitle was removed.
    expect(text).not.toContain("Shareable mission state");
    // VEY-KANEO-339: the report header control is a share affordance (native share dialog + clipboard
    // fallback), exposed via its accessible label, not the old copy-only "Copy link" button.
    expect(text).toContain("Share battle report");
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
    expect(text).toContain("Loot");
    expect(text).not.toContain("Loot left");
    expect(text).toContain("Battle-time defenders");
    expect(text).not.toContain("Current fleet / defenses");
    expect(text).not.toContain("Current defenses");
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

  test("VEY-KANEO-508: defender-victory report shows stationed defender name without until-ready suffix and marks route defeated", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("721", "Attack", "Returned", "0x1111111111111111111111111111111111111111", "7", "9", now - 120_000),
        originPlanet: planetReference("7", "0x1111111111111111111111111111111111111111", "Attacker", "1:2:3"),
        targetPlanet: planetReference("9", "0x3333333333333333333333333333333333333333", "Defender", "4:5:6"),
      },
      battleReport: {
        ...battleReport("721"),
        outcome: "DefenderWin",
      },
      defenderPlanetState: {
        fleet: [],
        defenses: [],
        stationedDefenders: [
          {
            missionId: "defender-1",
            defender: "0x9999999999999999999999999999999999999999",
            defenderDisplayName: "ILLUSIVE MAN",
            ships: { smallCargo: "2" },
            holdUntil: Math.floor(now / 1_000).toString(),
            allianceDepotLevel: 1,
          },
        ],
      },
    }))).join(" ");

    expect(text).toContain("Defender victory");
    expect(text).toContain("Defeated");
    expect(text).not.toContain("Returned");
    expect(text).toContain("Stationed defenders");
    expect(text).toContain("ILLUSIVE MAN");
    expect(text).not.toContain("ILLUSIVE MAN until");
    expect(text).not.toContain("until Ready");
    expect(text).toContain("Small Cargo ×2");
  });

  test("VEY-KANEO-508: normal returned attacker-win report keeps the returned route label", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("722", "Attack", "Returned", "0x1111111111111111111111111111111111111111", "7", "9", now - 120_000),
      battleReport: battleReport("722"),
      defenderPlanetState: { fleet: [], defenses: [] },
    }))).join(" ");

    expect(text).toContain("Attacker victory");
    expect(text).toContain("Returned");
    expect(text).not.toContain("Defeated");
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
      detail: {
        mission: mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 60_000),
        battleReport: null,
      },
      loading: false,
      missionId: "42",
      now,
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    })).join(" ");

    expect(text).toContain("Available Orders");
    expect(text).toContain("Recall fleet");
    expect(text).not.toContain("Resolve");
  });

  test("VEY-KANEO-424: owner's outbound recallable mission shows the Recall button and the projected cost, not 'Not recallable'", () => {
    // The ticket: for the same outbound mission Mission Control showed a Recall fleet button while
    // Mission Detail showed neither the button nor the cost ("Not recallable") because the single
    // -mission read returned recallCost: null. The fix projects recallCost for outbound fleets and
    // gates the button on the owner's wallet-scoped fleet-visibility (outgoing), not on recallCost.
    // Here the owner (ownerVisibility.outgoing includes "42") views their own outbound Attack that is
    // still more than the 60s cutoff from arrival, so it is genuinely recallable: the detail page must
    // surface both the Recall button and the projected cost, matching Mission Control.
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 600_000),
        recallCost: "50",
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Available Orders");
    expect(text).toContain("Recall fleet");
    expect(text).toContain("Recall cost");
    expect(text).toContain("50 deuterium");
    expect(text).not.toContain("Not recallable");
  });

  test("VEY-KANEO-424: owner's outbound mission past the 60s cutoff reads 'Not recallable', matching Mission Control", () => {
    // Acceptance criterion's second half: past the recall cutoff (within 60s of arrival) the fleet can
    // no longer be recalled, so both screens consistently show it as not recallable. The recall-cost
    // row reads "Not recallable" even though the projected cost is present, keeping the cost row honest
    // about whether recall is actually possible.
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("43", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now + 30_000),
        recallCost: "50",
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Recall cost");
    expect(text).toContain("Not recallable");
    expect(text).not.toContain("50 deuterium");
  });

  test("VEY-KANEO-648: stationed DefenseHold remains recallable on Mission Control after arrival", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const stationed: FleetMissionSummary = {
      ...mission("6115", "DefenseHold", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 3_600_000),
      defenseHoldUntil: Math.floor((now + 2 * 3_600_000) / 1_000).toString(),
      returnAt: Math.floor((now + 3 * 3_600_000) / 1_000).toString(),
      recallCost: "25",
    };

    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [stationed],
    }))).join(" ");

    expect(text).toContain("Stationed");
    expect(text).toContain("Holds");
    expect(text).toContain("Recall fleet");
    expect(text).not.toContain("Resolving");
    expect(text).not.toContain("The recall cutoff has passed");
  });

  test("VEY-KANEO-648: Mission Detail agrees stationed DefenseHold is recallable until hold expiry", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("6115", "DefenseHold", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 3_600_000),
        defenseHoldUntil: Math.floor((now + 2 * 3_600_000) / 1_000).toString(),
        returnAt: Math.floor((now + 3 * 3_600_000) / 1_000).toString(),
        recallCost: "25",
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Available Orders");
    expect(text).toContain("Recall fleet");
    expect(text).toContain("Recall cost");
    expect(text).toContain("25 deuterium");
    expect(text).not.toContain("resolving");
    expect(text).not.toContain("Not recallable");
  });

  test("VEY-KANEO-683: Mission Control hides Recall on arrived Deploy-to-moon missions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const arrivedDeployToMoon: FleetMissionSummary = {
      ...mission("683", "Deploy", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 5_000),
      targetIsMoon: true,
    };

    const text = collectText(MissionControlPage(missionControlProps(now, {
      outgoing: [arrivedDeployToMoon],
    }))).join(" ");

    expect(text).toContain("Deploy");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("The recall cutoff has passed");
    expect(text).toContain("Open");
  });

  test("VEY-KANEO-683: Mission Detail hides Available Orders for arrived Deploy-to-moon missions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("42", "Deploy", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 5_000),
        targetIsMoon: true,
      },
      battleReport: null,
    }))).join(" ");

    expect(text).not.toContain("Available Orders");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("The recall cutoff has passed");
  });

  test("VEY-KANEO-683: terminal Deploy-to-moon detail hides Recall even with a stored recall cost", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("42", "Deploy", "Resolved", "0x1111111111111111111111111111111111111111", "10", "10", now - 300_000),
        originIsMoon: false,
        recallCost: "1",
        targetIsMoon: true,
      },
      battleReport: null,
    }))).join(" ");

    expect(text).not.toContain("Available Orders");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("Recall cost");
    expect(text).not.toContain("1 deuterium");
  });

  test("VEY-KANEO-683: terminal Deploy-to-moon archive cards keep only the Open action", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const resolvedDeployToMoon: FleetMissionSummary = {
      ...mission("11921", "Deploy", "Resolved", "0x1111111111111111111111111111111111111111", "10", "10", now - 300_000),
      originIsMoon: false,
      recallCost: "1",
      targetIsMoon: true,
    };

    const props = missionControlProps(now, {});
    const text = collectText(MissionControlPage({
      ...props,
      fleetVisibility: {
        ...props.fleetVisibility!,
        completedMissions: [resolvedDeployToMoon],
      },
    })).join(" ");

    expect(text).toContain("Deploy");
    expect(text).toContain("Open");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("Recall cost");
  });

  test("renders the round-by-round block only when indexed round snapshots exist", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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
      detail: {
        mission: {
          ...mission("42", "Attack", "Outbound", "0x1111111111111111111111111111111111111111", "7", "9", now - 60_000),
          // A mixed offensive fleet: combat (light fighter) + civil (small cargo).
          ships: { lightFighter: "12", smallCargo: "3" },
          originPlanet: planetReference("7", "0x1111111111111111111111111111111111111111", "Aggressor", "1:2:3"),
          targetPlanet: planetReference("9", "0x3333333333333333333333333333333333333333", "Bastion", "4:5:6"),
        },
        battleReport: {
          ...battleReport("42"),
          defenderSnapshot: {
            fleet: [{ id: 6, count: 2 }],
            defenses: [{ id: 0, count: 5 }],
          },
        },
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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
    // The report renders battle-time defender composition from the report snapshot, not current state.
    expect(text).toContain("Battle-time fleet");
    expect(text).toContain("Battle-time defenses");
    expect(text).not.toContain("Current fleet");
    expect(text).not.toContain("Current defenses");
    expect(text).not.toContain("Current fleet / defenses");

    // The chips render the mapped game art for ships (combat + civil) and defenses, not just text.
    const imageSrcs = findElements(tree, "img").map((node) => String(node.props?.src ?? ""));
    expect(imageSrcs.some((src) => src.includes("/ships/light-fighter"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/ships/small-cargo"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/ships/cruiser"))).toBe(true);
    expect(imageSrcs.some((src) => src.includes("/defenses/rocket-launcher"))).toBe(true);
  });

  test("VEY-KANEO-571: renders exact battle-time defender units and omits current defenses from battle report", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("1240", "Attack", "Resolved", "0x1111111111111111111111111111111111111111", "7", "92", now - 120_000),
        ships: { lightFighter: "16" },
      },
      battleReport: {
        ...battleReport("1240"),
        outcome: "DefenderWin",
        rounds: 4,
        defenderSnapshot: {
          fleet: [],
          defenses: [{ id: 0, count: 37 }],
        },
        attackerLosses: { metal: "62000", crystal: "26000", deuterium: "0" },
        defenderLosses: { metal: "0", crystal: "0", deuterium: "0" },
        roundReports: [
          {
            round: 1,
            attackerUnits: "16",
            defenderUnits: "37",
            attackerLosses: { metal: "12000", crystal: "6000", deuterium: "0" },
            defenderLosses: { metal: "0", crystal: "0", deuterium: "0" },
          },
        ],
      },
      defenderPlanetState: {
        fleet: [],
        defenses: [{ id: 0, count: 4 }],
        stationedDefenders: [],
      },
    }))).join(" ");

    expect(text).toContain("Defender victory");
    expect(text).toContain("Battle-time defenses");
    expect(text).toContain("Rocket Launcher ×37");
    expect(text).not.toContain("37 aggregate units");
    expect(text).not.toContain("Current defenses");
    expect(text).not.toContain("Rocket Launcher ×4");
    expect(text).not.toContain("Current fleet / defenses");
  });

  test("VEY-KANEO-713: renders recalled stationed defenders, exact losses, survivors, and debris basis", () => {
    const now = Date.parse("2026-07-15T22:10:00.000Z");
    const report2840: BattleReport = {
      ...battleReport("2840"),
      targetPlanetId: "236",
      defenderLosses: { metal: "45000", crystal: "27000", deuterium: "0" },
      debris: { metal: "13500", crystal: "8100" },
      defenderSnapshot: { fleet: [{ id: 5, count: 2 }], defenses: [] },
      stationedDefenders: [
        {
          missionId: "2847",
          defender: "0x4444444444444444444444444444444444444444",
          defenderDisplayName: "Holder 2847",
          ships: { lightFighter: "2", heavyFighter: "2" },
          destroyedShips: { lightFighter: "2", heavyFighter: "2" },
          survivingShips: {},
          lifecycleOutcome: "Recalled",
          holdUntil: "1752616800",
          allianceDepotLevel: 0,
        },
        {
          missionId: "2848",
          defender: "0x5555555555555555555555555555555555555555",
          defenderDisplayName: null,
          ships: { lightFighter: "1", heavyFighter: "2" },
          destroyedShips: { lightFighter: "1", heavyFighter: "2" },
          survivingShips: {},
          lifecycleOutcome: "Recalled",
          holdUntil: "1752616801",
          allianceDepotLevel: 0,
        },
      ],
    };
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: mission("2840", "Attack", "Resolved", "0x1111111111111111111111111111111111111111", "7", "236", now - 120_000),
      battleReport: report2840,
      defenderPlanetState: { fleet: [], defenses: [], stationedDefenders: [] },
    }))).join(" ");

    expect(text).toContain("Mission # 2847");
    expect(text).toContain("Holder 2847");
    expect(text).toContain("Recalled");
    expect(text).toContain("Mission # 2848");
    expect(text).toContain("Original fleet");
    expect(text).toContain("Destroyed");
    expect(text).toContain("Survived");
    expect(text).toContain("Light Fighter ×2");
    expect(text).toContain("Heavy Fighter ×2");
    expect(text).toContain("45,000 metal / 27,000 crystal fleet loss → 13,500 metal / 8,100 crystal debris (30%)");
  });

  test("VEY-KANEO-713: recalled DefenseHold detail distinguishes launch fleet from zero survivors", () => {
    const now = Date.parse("2026-07-15T22:10:00.000Z");
    const recalledHold = {
      ...mission("2847", "DefenseHold", "Returned", "0x4444444444444444444444444444444444444444", "36", "236", now - 7_200_000),
      defenseHoldOutcome: "Recalled" as const,
      originalShips: { lightFighter: "2", heavyFighter: "2" },
      destroyedShips: { lightFighter: "2", heavyFighter: "2" },
      survivingShips: {},
      ships: { lightFighter: "2", heavyFighter: "2" },
    };
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: recalledHold,
      battleReport: null,
    }))).join(" ");

    expect(missionStatusPill(recalledHold, now).label).toBe("Recalled");
    expect(text).toContain("Lifecycle Recalled");
    expect(text).toContain("Original stationed fleet");
    expect(text).toContain("Destroyed in combat");
    expect(text).toContain("Surviving return fleet None");
    expect(text).toContain("Light Fighter ×2");
    expect(text).toContain("Heavy Fighter ×2");

    const cardText = collectText(MissionControlPage({
      ...missionControlProps(now, {}),
      missionArchive: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        rows: [{
          kind: "mission",
          mission: { ...recalledHold, owner: "0x1111111111111111111111111111111111111111" },
        }],
        pagination: { page: 1, pageSize: 25, totalEntries: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
      },
    })).join(" ");
    expect(cardText).toContain("Recalled");
    expect(cardText).toMatch(/Stationed\s+Light Fighter x2, Heavy Fighter x2/);
    expect(cardText).toMatch(/Destroyed\s+Light Fighter x2, Heavy Fighter x2/);
    expect(cardText).toMatch(/Survived\s+None/);
  });

  test("VEY-KANEO-407: renders unit art in the standalone Fleet And Cargo panel for non-combat missions", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    // A transport mission has no battle report, so the standalone "Fleet And Cargo" panel renders and
    // its ship listing must show unit art too (per the ticket title's "Fleet And Cargo ships" scope).
    const tree = MissionDetailPage({
      fleetVisibility: ownerVisibility,
      actionState: { status: "idle" },
      canTransact: true,
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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

  test("VEY-KANEO-571: hides the 'no battle report' notice for a returned recalled attack", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("1692", "Attack", "Returned", "0x1111111111111111111111111111111111111111", "7", "9", now + 600_000),
        recallCost: "695",
        recallProvenance: "FleetMissionRecalled",
      },
      battleReport: null,
    }))).join(" ");

    expect(text).not.toContain("No indexed battle report");
    expect(text).not.toContain("Combat is due or resolving");
  });

  test("VEY-KANEO-571: still shows the missing-report notice for a normal returned attack", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("1693", "Attack", "Returned", "0x1111111111111111111111111111111111111111", "7", "9", now - 600_000),
        // A stale projected cost is not evidence that FleetMissionRecalled happened.
        recallCost: "695",
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Report generating, please hold...");
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

    expect(text).toContain("Report generating, please hold...");
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

  test("surfaces the share control and mission action status on the detail page", () => {
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
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
      onRetry: () => undefined,
      onSelectCoordinates: () => undefined,
      onSelectPlayer: () => undefined,
    } as const;

    // VEY-KANEO-339: the share control is now a static "Share battle report" button that opens the
    // in-app share dialog (the copy/social feedback moved into that dialog), so the button label is
    // constant regardless of action state.
    const idle = MissionDetailPage({ ...baseProps, actionState: { status: "idle" } });
    const shareButton = findElements(idle, "button").find((node) => String(node.props?.title ?? "") === "Share battle report");
    expect(shareButton).toBeDefined();
    expect(shareButton?.props?.type).toBe("button");

    const pending = collectText(MissionDetailPage({
      ...baseProps,
      actionState: { status: "pending", label: "Recall mission #42: waiting for wallet confirmation." },
    })).join(" ");
    expect(pending).toContain("waiting for wallet confirmation");

    const failed = collectText(MissionDetailPage({
      ...baseProps,
      actionState: { status: "error", label: "Recall mission #42 transaction failed." },
    })).join(" ");
    expect(failed).toContain("transaction failed");
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
      detail: { mission: detailMission, battleReport: null },
      loading: false,
      missionId: "42",
      now,
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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
      detail: { mission: detailMission, battleReport: null },
      loading: false,
      missionId: "43",
      now,
      onBack: () => undefined,      onShareReport: () => undefined,
      onCounterplay: () => undefined,
      onRecall: () => undefined,
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

  test("renders moon indicators on route endpoint planet art when identity has a moon", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const lookup = new Map<string, MissionPlanetIdentity>([[
      "7",
      {
        archetype: "temperate-ocean",
        coordinates: "1:2:3",
        displayName: "Luna Gate",
        hasMoon: true,
        owner,
        ownerDisplayName: "Vey",
      },
    ]]);
    const routeMission = mission("moon-route", "Attack", "Outbound", owner, "7", "9");
    const tree = MissionRouteCell({
      direction: "outbound",
      origin: missionEndpoint(routeMission, "origin", lookup),
      target: missionEndpoint(routeMission, "target", lookup),
    });

    const indicator = findElements(tree, "a").find((item) => item.props?.["data-planet-moon-indicator"] === "true");
    expect(indicator?.props?.["aria-label"]).toBe("Open moon at 1:2:3");
    expect(indicator?.props?.href).toBe("/moon/1/2/3");
    expect(missionRouteSource).toContain('className="!-right-1 !-top-1 !h-3 !w-3"');
    expect(missionRouteSource).toContain('className="absolute inset-0 overflow-hidden rounded-full');
  });

  test("keeps planet endpoints with moon badges linked to both planet and moon detail paths", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const routeMission: FleetMissionSummary = {
      ...mission("planet-with-moon-route", "Attack", "Outbound", owner, "7", "9"),
      targetPlanet: {
        ...planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
        hasMoon: true,
      },
    };
    const tree = MissionRouteCell({
      direction: "outbound",
      origin: missionEndpoint(routeMission, "origin", new Map()),
      target: missionEndpoint(routeMission, "target", new Map()),
    });

    const links = findElements(tree, "a");
    expect(links.map((link) => link.props?.href)).toContain("/planet/5/407/4");
    expect(links.map((link) => link.props?.href)).toContain("/moon/5/407/4");
  });

  test("links moon mission route endpoints to moon detail paths", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const routeMission: FleetMissionSummary = {
      ...mission("moon-target-route", "Attack", "Outbound", owner, "7", "9"),
      targetIsMoon: true,
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
    };
    const tree = MissionRouteCell({
      direction: "outbound",
      origin: missionEndpoint(routeMission, "origin", new Map()),
      target: missionEndpoint(routeMission, "target", new Map()),
    });

    const links = findElements(tree, "a");
    expect(links.map((link) => link.props?.href)).toContain("/moon/5/407/4");
    expect(links.map((link) => link.props?.href)).not.toContain("/planet/5/407/4");
  });

  test("links moon mission route endpoints to moon detail paths", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const routeMission: FleetMissionSummary = {
      ...mission("moon-target-route", "Attack", "Outbound", owner, "7", "9"),
      targetIsMoon: true,
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
    };
    const tree = MissionRouteCell({
      direction: "outbound",
      origin: missionEndpoint(routeMission, "origin", new Map()),
      target: missionEndpoint(routeMission, "target", new Map()),
    });

    const links = findElements(tree, "a");
    expect(links.map((link) => link.props?.href)).toContain("/moon/5/407/4");
    expect(links.map((link) => link.props?.href)).not.toContain("/planet/5/407/4");
  });

  // Both Mission Control rows and the Mission Detail hero carry the directional progress arrow —
  // Mission Control in its compact form (active rows live/cyan, past rows subdued).
  function routeArrows(tree: unknown): FoundElement[] {
    return findElements(tree, "div").filter((node) => node.props?.["data-route-direction"] !== undefined);
  }

  test("collapsed rows carry priority facts while exact combat detail stays expanded", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const returning = {
      ...mission("85", "Attack", "Returning"),
      cargo: { metal: "10", crystal: "0", deuterium: "0" },
    };
    const base = missionControlProps(now, { returning: [returning] });
    const tree = MissionControlPage({
      ...base,
      fleetVisibility: {
        ...base.fleetVisibility!,
        battleReports: [battleReport("85")],
      },
    });
    const row = findElements(tree, "details").find((node) => node.props?.["data-mission-row"] !== undefined);
    const summary = findElements(row, "summary")[0];
    const summaryText = collectText(summary).join(" ");
    const rowText = collectText(row).join(" ");

    expect(summaryText).toContain("Attack");
    expect(summaryText).toContain("#85");
    expect(summaryText).toContain("Returning");
    // One phase-relevant time on the collapsed row (the return countdown); the full Arrived /
    // Returned pair lives in the expanded panel.
    expect(summaryText).toContain("Returns");
    expect(summaryText).not.toContain("Arrived");
    expect(summaryText).not.toContain("Origin");
    expect(summaryText).not.toContain("Destination");
    // Compact payload values bind number to unit with a non-breaking space (matched by \s) and
    // compact from 1,000 up (1,200 -> 1.2K); the expanded panel keeps exact figures.
    expect(summaryText).toMatch(/Cargo\s+10\sM/);
    expect(summaryText).toMatch(/Loot\s+1\.2K\sM\s·\s300\sC/);
    expect(summaryText).toMatch(/Losses\s+150\s\/\s1\.2K/);
    expect(summaryText).not.toContain("Attacker losses");
    expect(summaryText).not.toContain("Defender losses");
    expect(summaryText).not.toContain("Debris field");
    expect(summaryText).not.toContain(" 0 ");

    // Tense-aware timeline label: this fixture's arrival timestamp is still in the future.
    expect(rowText).toMatch(/Arrive[sd]/);
    expect(rowText).toContain("Small Cargo");
    expect(rowText).toMatch(/Attacker losses\s+100 M \/ 50 C/);
    expect(rowText).toMatch(/Defender losses\s+900 M \/ 250 C/);
    expect(rowText).toMatch(/Debris field\s+600 M \/ 150 C/);
    expect(rowText).toContain("Open");
  });

  test("hostile inbound rows initialize open once and preserve later disclosure changes", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const hostile = mission(
      "86",
      "Attack",
      "Outbound",
      "0x2222222222222222222222222222222222222222",
      "9",
      "7",
      now + 60_000,
    );
    const tree = MissionControlPage(missionControlProps(now, { incoming: [hostile] }));
    const row = findElements(tree, "details").find((node) => node.props?.["data-mission-row"] !== undefined);
    expect(row?.props?.["data-default-open"]).toBe("true");

    const element = { dataset: {}, open: false } as unknown as HTMLDetailsElement;
    initializeMissionRowDisclosure(element, true);
    expect(element.open).toBe(true);
    element.open = false;
    initializeMissionRowDisclosure(element, true);
    expect(element.open).toBe(false);
  });

  test("outbound Mission Control rows carry a live progress arrow and retain real planet art", () => {
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
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.props?.["data-route-direction"]).toBe("outbound");
    expect(arrows[0]!.props?.["data-route-progress"]).toBe("50");
    // Per-row Origin/Destination captions are gone; the single column-header row labels the route.
    const text = collectText(tree).join(" ");
    expect(text).not.toContain("Origin");
    expect(text).not.toContain("Destination");

    // Both endpoints render their real planet art (Galaxy thumbnail assets), keyed by archetype.
    const planetImages = findElements(tree, "img").filter((node) => node.props?.["data-planet-art"] !== undefined);
    const arts = planetImages.map((node) => node.props?.["data-planet-art"]);
    expect(arts).toContain("temperate-ocean");
    expect(arts).toContain("frozen-ice");
    const sources = planetImages.map((node) => node.props?.src);
    expect(sources).toContain(planetImageForType("temperate-ocean"));
    expect(sources).toContain(planetImageForType("frozen-ice"));
  });

  test("uses canonical universe art for mission targets when the mission feed lacks an archetype", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const targetCoords = { galaxy: 5, system: 314, position: 14 };
    const canonicalTargetType = "frozen-ice";
    expect(planetTypeFromCoordinates(targetCoords.galaxy, targetCoords.system, targetCoords.position)).toBe("metal-planetoid");

    const outbound: FleetMissionSummary = {
      ...mission("82", "Attack", "Outbound", owner, "7", "9", now + 30_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: {
        planetId: "9",
        owner: defender,
        ownerDisplayName: "Zane",
        name: "Cryo Gate",
        ...targetCoords,
        coordinates: missionPlanetCoordinateKey(targetCoords),
      },
    };
    const tree = MissionControlPage({
      ...missionControlProps(now, { outgoing: [outbound] }),
      planetArchetypesByCoordinate: new Map([[missionPlanetCoordinateKey(targetCoords), canonicalTargetType]]),
    });

    const planetImages = findElements(tree, "img").filter((node) => node.props?.["data-planet-art"] !== undefined);
    const arts = planetImages.map((node) => node.props?.["data-planet-art"]);
    expect(arts).toContain("temperate-ocean");
    expect(arts).toContain(canonicalTargetType);
    const sources = planetImages.map((node) => node.props?.src);
    expect(sources).toContain(planetImageForType(canonicalTargetType));
    expect(sources).not.toContain(planetImageForType("metal-planetoid"));
  });

  test("returning Mission Control rows point the arrow home and keep the full timings expanded", () => {
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
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.props?.["data-route-direction"]).toBe("returning");
    expect(arrows[0]!.props?.["data-route-progress"]).toBe("50");
    const text = collectText(tree).join(" ");
    // Endpoint order stays origin -> target; the arrow direction carries the "flying home" meaning.
    expect(text.indexOf("New Zion")).toBeLessThan(text.indexOf("Borealis"));
    // Collapsed row: return countdown only; the Arrived timestamp lives in the expanded panel.
    expect(text).toContain("Returns");
    expect(text).toContain("Arrived");
    const summary = findElements(tree, "summary")[0];
    expect(collectText(summary).join(" ")).not.toContain("Arrived");
  });

  test("Mission Detail route treatment retains its progress arrow", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    // arrival already passed: the outbound leg is fully elapsed -> fill at 100%.
    const arrived: FleetMissionSummary = {
      ...mission("82", "Deploy", "Outbound", owner, "7", "9", now - 5_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "warm-terracotta"),
      targetPlanet: planetReference("9", owner, "Outpost", "5:407:4", "cold-tundra"),
    };
    const tree = MissionRouteCell({
      direction: "outbound",
      origin: missionEndpoint(arrived, "origin", new Map()),
      progressPercent: 100,
      target: missionEndpoint(arrived, "target", new Map()),
    });
    const arrow = routeArrows(tree)[0]!;
    expect(arrow.props?.["data-route-direction"]).toBe("outbound");
    expect(arrow.props?.["data-route-progress"]).toBe("100");
  });

  test("card endpoints use the shared route grid with the arrow owning the central span", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z");
    const owner = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const outbound: FleetMissionSummary = {
      ...mission("83", "Attack", "Outbound", owner, "7", "9", now + 30_000),
      originPlanet: planetReference("7", owner, "New Zion", "6:9:1", "temperate-ocean"),
      targetPlanet: planetReference("9", defender, "Borealis", "5:407:4", "frozen-ice"),
    };
    const tree = MissionControlPage(missionControlProps(now, { outgoing: [outbound] }));

    // Endpoint columns size to content (capped by RouteEndpoint max-widths) while the arrow track
    // stretches across the central span; the same fr-based template on every row keeps the columns
    // proportionally aligned down the list.
    const routeRow = findElements(tree, "div").find((node) =>
      String(node.props?.className ?? "").includes("grid-cols-[minmax(0,auto)_minmax(2.5rem,1fr)_minmax(0,auto)]")
    );
    expect(routeRow).toBeDefined();
    expect(routeArrows(tree)).toHaveLength(1);
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

    // The sections advertise the restored tab, the restored tab buttons read selected, and only
    // the restored panels mount. Hidden archive rows must not add initial mobile render work.
    expect(sectionByData(tree, "data-active-tab")?.props?.["data-active-tab"]).toBe("all");
    expect(sectionByData(tree, "data-past-tab")?.props?.["data-past-tab"]).toBe("all");

    const activeAllButton = findElements(tree, "button").find((node) => node.props?.["data-active-tab-button"] === "all");
    expect(activeAllButton?.props?.["aria-selected"]).toBe(true);
    const pastAllButton = findElements(tree, "button").find((node) => node.props?.["data-past-tab-button"] === "all");
    expect(pastAllButton?.props?.["aria-selected"]).toBe(true);

    const activeAllPanel = findElements(tree, "div").find((node) => node.props?.["data-active-tab-panel"] === "all");
    expect(activeAllPanel).toBeDefined();
    const activeMinePanel = findElements(tree, "div").find((node) => node.props?.["data-active-tab-panel"] === "mine");
    expect(activeMinePanel).toBeUndefined();
    const pastAllPanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "all");
    const pastMinePanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "mine");
    const pastIncomingPanel = findElements(tree, "div").find((node) => node.props?.["data-past-tab-panel"] === "incomingAttacks");
    expect(pastAllPanel).toBeDefined();
    expect(pastMinePanel).toBeUndefined();
    expect(pastIncomingPanel).toBeUndefined();
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

  // VEY-412 rework: the view is encoded in the URL query (source of truth — shareable, survives
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
    expect(parseMissionControlViewParams("at=alliance&pt=incomingAttacks&ap=3&pp=2")).toEqual({
      activePage: 3,
      activeTab: "alliance",
      pastPage: 2,
      pastTab: "incomingAttacks",
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
  // default) and the in-app back button lands on a bare path (no query). Without a window in this
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
    now,    onCounterplay: () => undefined,
    onDefendPlanet: () => undefined,
    onJoinAttack: () => undefined,
    onOpenReport: () => undefined,
    onOpenReportList: () => undefined,
    onRecall: () => undefined,
    onRefresh: () => undefined,
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
  outgoing: ["42", "43", "51", "52", "60", "62", "64", "6115"].map((id) => mission(id, "Attack", "Outbound")),
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
    detail,
    loading: false,
    missionId: detail?.mission?.missionId ?? null,
    now,
    onBack: () => undefined,    onShareReport: () => undefined,
    onCounterplay: () => undefined,
    onRecall: () => undefined,
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

type VNode = { type?: unknown; props?: { children?: unknown; onClick?: unknown } & Record<string, unknown> };

// Depth-first search for the first vnode matching a predicate, descending through arrays, children, and
// function-component renders (so a control nested inside a rendered component is still reachable).
function findElement(node: unknown, match: (vnode: VNode) => boolean): VNode | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return undefined;
  }
  const vnode = node as VNode;
  if (match(vnode)) return vnode;
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: { children?: unknown }) => unknown;
    if (render.name === "Icon") return undefined;
    return findElement(render({ ...(vnode.props ?? {}) }), match);
  }
  return findElement(vnode.props?.children, match);
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
    returnCargo: null,
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

describe("Ready to resolve is gated on randomness for combat missions (VEY-KANEO-479)", () => {
  const planetLookup = new Map();
  // Arrival one minute in the past relative to `now` so the local clock alone would read "due".
  const arrivedMs = Date.parse("2026-06-05T12:00:00.000Z");
  const now = arrivedMs + 60_000;

  test("an arrived attack without confirmed resolution does not read 'Ready to resolve'", () => {
    const attack = { ...mission("90", "Attack", "Outbound", undefined, "7", "9", arrivedMs), needsResolution: false };
    expect(missionReport(attack, now, planetLookup).outcome).not.toBe("Ready to resolve.");
  });

  test("an arrived harvest without confirmed resolution does not read 'Ready to resolve'", () => {
    const harvest = { ...mission("91", "Harvest", "Outbound", undefined, "7", "9", arrivedMs), needsResolution: false };
    expect(missionReport(harvest, now, planetLookup).outcome).not.toBe("Ready to resolve.");
  });

  test("an attack the backend marks resolvable reads 'Ready to resolve'", () => {
    const attack = { ...mission("92", "Attack", "Outbound", undefined, "7", "9", arrivedMs), needsResolution: true };
    expect(missionReport(attack, now, planetLookup).outcome).toBe("Ready to resolve.");
  });

  test("a non-combat arrival still reads 'Ready to resolve' from the clock alone", () => {
    const transport = { ...mission("93", "Transport", "Outbound", undefined, "7", "9", arrivedMs), needsResolution: false };
    expect(missionReport(transport, now, planetLookup).outcome).toBe("Ready to resolve.");
  });
});

describe("Harvest mission reports (VEY-KANEO-538)", () => {
  const planetLookup = new Map();
  const now = Date.parse("2026-06-05T12:03:00.000Z");

  test("reports harvested debris from return cargo instead of battle loot copy", () => {
    const harvest = {
      ...mission("1284", "Harvest", "Returned", undefined, "41", "179"),
      cargo: { metal: "0", crystal: "0", deuterium: "0" },
      returnCargo: { metal: "3300", crystal: "2700", deuterium: "0" },
      ships: { recycler: "1" },
    };

    const report = missionReport(harvest, now, planetLookup);
    expect(report.debris).toBe("3,300 M / 2,700 C / 0 D");
    expect(report.debris).not.toContain("Not reported");
  });

  test("keeps legacy harvests honest when the return-cargo event is missing", () => {
    const harvest = {
      ...mission("1293", "Harvest", "Returned", undefined, "41", "34"),
      returnCargo: null,
    };

    expect(missionReport(harvest, now, planetLookup).debris).toBe("Unavailable for legacy harvest reports.");
  });

  test("mission detail shows collected debris separately from carried cargo", () => {
    const text = collectText(MissionDetailPage(missionDetailProps(now, {
      mission: {
        ...mission("1284", "Harvest", "Returned", undefined, "41", "179"),
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        returnCargo: { metal: "3300", crystal: "2700", deuterium: "0" },
        ships: { recycler: "1" },
      },
      battleReport: null,
    }))).join(" ");

    expect(text).toContain("Debris collected");
    expect(text).toContain("3,300 metal / 2,700 crystal / 0 deuterium");
  });
});
