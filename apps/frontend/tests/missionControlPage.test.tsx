import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ComponentChildren, VNode } from "preact";
import { MissionControlPage, StationedDefenseSection, classifyAllianceCooperativeMissions, formatMissionTime, isFleetRecallable, manualMissionResolutionKind, missionControlRefreshButtonState, missionDisplayStatusLabel, missionLifecycleActions, missionStatusPill, returnPhaseHarvestedResources, returnPhaseLoot, returnPhaseLosses } from "../src/components/MissionControlPage";
import { encodeColonizationTargetId } from "../src/walletFlow";
import type { BattleReport, FleetMissionSummary, ManagedPlanetResponse } from "../src/walletFlow";

describe("MissionControlPage", () => {
  test("does not flash an empty missile-strike section during background polling", () => {
    const page = missionControlPage({
      missileAttackArchiveLoading: true,
    });

    expect(visibleText(page)).not.toContain("Immediate combat");
    expect(visibleText(page)).not.toContain("Missile strikes");
  });

  test("renders timed one-way missile payload without a recall action", () => {
    const now = 1_770_000_100_000;
    const missile = mission({
      arrivalAt: "1770000300",
      returnAt: "1770000300",
      missionId: "901",
      missionType: "MissileAttack",
      missilePrimaryTargetId: 4,
      missileQuantity: 12,
      ships: {},
    });
    const text = visibleText(missionControlPage({
      fleetVisibility: {
        wallet: missile.owner,
        homePlanetId: missile.originPlanetId,
        incoming: [],
        outgoing: [missile],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      now,
    }));

    expect(text).toContain("12 interplanetary missiles");
    expect(text).toContain("Gauss Cannon");
    expect(text).toContain("Arrives");
    expect(text).not.toContain("Recall");
    expect(isFleetRecallable(missile, now)).toBe(false);
  });

  test("renders mission timing with relative and exact local timestamps", () => {
    const secondsLabel = formatMissionTime("1770000300", 1_770_000_000_000);
    const millisecondsLabel = formatMissionTime("1770000300000", 1_770_000_000_000);

    expect(secondsLabel).toContain("5m");
    expect(secondsLabel).toContain("2026");
    expect(secondsLabel).not.toContain("1770000300");
    expect(millisecondsLabel).toBe(secondsLabel);
  });

  test("enables only playable lifecycle actions for mission timing", () => {
    const now = 1_770_000_100_000;

    // VEY-KANEO-468: arrival/return completions reconcile lazily on-chain (and via the backend
    // resolver), so there is no manual "Resolve" lifecycle action anymore — only recall/counterplay/join.
    expect(missionLifecycleActions({
      canTransact: true,
      context: "outgoing",
      mission: mission({ arrivalAt: "1770000300", missionId: "1", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["recall", true],
    ]);

    // A due outbound mission no longer exposes any manual order; it settles on the next interaction.
    expect(missionLifecycleActions({
      canTransact: true,
      context: "due",
      mission: mission({ arrivalAt: "1770000000", missionId: "2", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([]);

    // VEY-KANEO-465: returns reconcile automatically via the backend resolver, so a
    // returning fleet exposes no manual "Land fleet" action.
    expect(missionLifecycleActions({
      canTransact: true,
      context: "returning",
      mission: mission({ missionId: "3", returnAt: "1770000000", status: "Returning" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "incoming",
      mission: mission({ arrivalAt: "1770000700", missionId: "4", missionType: "Attack", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["counterplay", true],
    ]);

    expect(missionLifecycleActions({
      activePlanetId: "9",
      canTransact: true,
      context: "incoming",
      mission: mission({
        arrivalAt: "1770000300",
        missionId: "4",
        missionType: "Attack",
        status: "Outbound",
        targetPlanetId: "9",
      }),
      now,
    })).toEqual([]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "joinable",
      mission: mission({ arrivalAt: "1770000700", missionId: "5", missionType: "Attack", status: "Outbound" }),
      now,
    }).map((action) => [action.kind, action.enabled])).toEqual([
      ["joinAttack", true],
    ]);
  });

  test("uses transaction sync copy for disabled mission lifecycle actions", () => {
    const actions = missionLifecycleActions({
      canTransact: false,
      context: "incoming",
      mission: mission({ arrivalAt: "1770000700", missionId: "6", missionType: "Attack", status: "Outbound" }),
      now: 1_770_000_100_000,
      transactionUnavailableReason: "Ship production: syncing indexed state...",
    });

    expect(actions).toEqual([{
      enabled: false,
      kind: "counterplay",
      label: "Counterplay",
      reason: "Ship production: syncing indexed state...",
    }]);
  });

  test("gates cooperative actions at the five-minute cutoff and without a selected fleet", () => {
    const now = 1_770_000_100_000;
    const atCutoff = missionLifecycleActions({
      canTransact: true,
      context: "joinAttack",
      mission: mission({ arrivalAt: "1770000400", missionId: "cutoff", missionType: "Attack", status: "Outbound" }),
      now,
    });
    expect(atCutoff).toEqual([{
      enabled: false,
      kind: "joinAttack",
      label: "Join Attack",
      reason: "The cooperative join cutoff has passed.",
    }]);

    const noFleet = missionLifecycleActions({
      canTransact: true,
      context: "joinDefense",
      hasAvailableMissionFleet: false,
      mission: mission({ arrivalAt: "1770000700", missionId: "fleet", missionType: "Attack", status: "Outbound" }),
      now,
    });
    expect(noFleet).toEqual([{
      enabled: false,
      kind: "joinDefense",
      label: "Join Defense",
      reason: "No ships are available on the selected origin planet.",
    }]);

    expect(missionLifecycleActions({
      canTransact: true,
      context: "joinDefense",
      mission: mission({ arrivalAt: "1770000700", missionId: "terminal", missionType: "Attack", status: "Returning" }),
      now,
    })).toEqual([]);
  });

  test("classifies only live same-alliance attack and defense candidates", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const ally = "0x2222222222222222222222222222222222222222";
    const enemy = "0x3333333333333333333333333333333333333333";
    const outsider = "0x4444444444444444444444444444444444444444";
    const targetPlanet = (planetId: string, owner: string) => ({
      allianceDepotLevel: 0,
      coordinates: `1:1:${planetId}`,
      galaxy: 1,
      name: `Planet ${planetId}`,
      owner,
      ownerDisplayName: null,
      planetId,
      position: Number(planetId),
      system: 1,
    });
    const allyAttack = mission({ missionId: "attack", owner: ally, targetPlanet: targetPlanet("9", enemy) });
    const allyDefense = mission({ missionId: "defense", owner: enemy, targetPlanet: targetPlanet("10", ally) });
    const nonAlliance = mission({ missionId: "other", owner: enemy, targetPlanet: targetPlanet("11", outsider) });
    const returning = mission({ missionId: "returning", owner: ally, status: "Returning", targetPlanet: targetPlanet("12", enemy) });

    expect(classifyAllianceCooperativeMissions({
      allianceMemberAddresses: [wallet, ally],
      candidates: [allyAttack, allyDefense, nonAlliance, returning],
      wallet,
    })).toEqual({
      joinAttacks: [allyAttack],
      joinDefenses: [allyDefense],
    });

    expect(classifyAllianceCooperativeMissions({
      allianceMemberAddresses: [],
      candidates: [allyAttack, allyDefense],
      wallet,
    })).toEqual({ joinAttacks: [], joinDefenses: [] });
  });

  test("hides Recall once an outbound fleet is within the 60s recall cutoff", () => {
    const now = 1_770_000_100_000;

    // 200s before arrival: comfortably outside the cutoff, so recall is enabled.
    expect(missionLifecycleActions({
      canTransact: true,
      context: "outgoing",
      mission: mission({ arrivalAt: "1770000300", missionId: "1", status: "Outbound" }),
      now,
    }).find((action) => action.kind === "recall")?.enabled).toBe(true);

    // 30s before arrival: inside the 60s cutoff, so the dead-end action and cutoff warning are absent.
    const recall = missionLifecycleActions({
      canTransact: true,
      context: "outgoing",
      mission: mission({ arrivalAt: "1770000130", missionId: "2", status: "Outbound" }),
      now,
    }).find((action) => action.kind === "recall");
    expect(recall).toBeUndefined();
  });

  test("renders an expired-recall mission card without the dead-end action or cutoff warning", () => {
    const now = 1_770_000_100_000;
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({ arrivalAt: "1770000130", missionId: "759", status: "Outbound" })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      now,
    });
    const text = visibleText(page);

    expect(text).toContain("Attack #759");
    expect(text).toContain("Open");
    expect(text).not.toContain("Recall fleet");
    expect(text).not.toContain("recall cutoff");
  });

  // VEY-KANEO-456: the Stationed defenses panel must show, per stationed allied defender, which player
  // owns it, the exact fleet (ship counts), a live hold countdown, and the deuterium upkeep the
  // defended planet's Alliance Depot covers — not just a defender count.
  test("renders each stationed defender's player, fleet, hold countdown, and Alliance Depot upkeep", () => {
    const now = 1_770_000_000_000;
    const attack = mission({
      missionId: "70",
      missionType: "Attack",
      owner: "0x3333333333333333333333333333333333333333",
      targetPlanetId: "7",
      arrivalAt: "1770000900",
      counterplayDefenderMissionIds: ["71"],
      stationedDefenders: [
        {
          missionId: "71",
          defender: "0x4444444444444444444444444444444444444444",
          defenderDisplayName: "Aegis",
          ships: { battleship: "2", lightFighter: "5" },
          holdUntil: "1770000900",
          allianceDepotLevel: 2,
        },
      ],
    });
    const text = visibleText(
      StationedDefenseSection({ incoming: [attack], outgoing: [], now, onOpenReport: () => undefined }),
    );

    expect(text).toContain("Defended");
    // Defender player identity (profile name, falling back to a shortened address when absent).
    expect(text).toContain("Aegis");
    // Full ship composition with counts (icons render the art; the count travels as text).
    expect(text).toContain("x2");
    expect(text).toContain("x5");
    // Live hold countdown.
    expect(text).toContain("Holds");
    // Deuterium upkeep rate: 2 battleships (1000 tenths/h) + 5 light fighters (100) = 1100 => 110 deut/h.
    expect(text).toContain("Upkeep 110 deut/h");
    // Alliance Depot upkeep coverage.
    expect(text).toContain("Alliance Depot Lv 2");
    expect(text).toContain("covers the full hold");
  });

  // VEY-KANEO-456: when an attack's stationed defenders all withdrew (reconciled to empty), the panel
  // must not show a stale "Defended" card; on Mission Control the whole section hides when nothing holds.
  test("hides a Defended card whose stationed defenders have all withdrawn", () => {
    const attack = mission({
      missionId: "72",
      missionType: "Attack",
      targetPlanetId: "7",
      counterplayDefenderMissionIds: ["73"],
      stationedDefenders: [],
    });
    const withdrawn = visibleText(
      StationedDefenseSection({ incoming: [attack], outgoing: [], now: 1_770_000_000_000, onOpenReport: () => undefined }),
    );
    expect(withdrawn).not.toContain("Defended");
    expect(
      StationedDefenseSection({
        incoming: [attack],
        outgoing: [],
        now: 1_770_000_000_000,
        onOpenReport: () => undefined,
        hideWhenEmpty: true,
      }),
    ).toBeNull();
  });

  test("renders player-facing mission control rows without implementation copy", () => {
    const page = MissionControlPage({
      actionState: { status: "idle" },
      canTransact: true,
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [mission({ missionId: "8", missionType: "Attack", owner: "0x3333333333333333333333333333333333333333" })],
        outgoing: [mission({ missionId: "9", missionType: "Transport", needsResolution: true })],
        returning: [mission({ missionId: "10", status: "Returning", asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 0, arrived: true, returned: true } })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      allActiveMissions: [
        mission({ missionId: "8", missionType: "Attack", owner: "0x3333333333333333333333333333333333333333" }),
        mission({ missionId: "9", missionType: "Transport", needsResolution: true }),
        mission({ missionId: "10", status: "Returning", asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 0, arrived: true, returned: true } }),
      ],
      initialView: { activePage: 0, activeTab: "all", pastPage: 0, pastTab: "mine" },
      loading: false,
      now: 1_770_000_700_000,
      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenReport: () => undefined,
      onOpenReportList: () => undefined,
      onRecall: () => undefined,
      onRefresh: () => undefined,
      onResolve: () => undefined,
      reportUrlForMission: (missionId) => `/mission/${missionId}`,
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).not.toContain("Mission Control");
    expect(text).not.toContain("Watch inbound attacks");
    // The top summary stat-card row was removed; the lists below convey the same counts.
    expect(text).not.toContain("Active missions 3");
    expect(text).not.toContain("Due resolvers");
    expect(text).not.toContain("Returns 1");
    expect(text).toContain("No completed missions are visible for this wallet yet.");
    // The active "Fleet movement" label is dropped; the past missions table keeps its header.
    expect(text).not.toContain("Fleet movement");
    expect(text).toContain("Past missions");
    // VEY-400: cards drop the MISSION / ROUTE / FLEET / Orders table headers entirely.
    expect(text).not.toContain("Mission Route Fleet");
    expect(text).not.toContain("Origin -> Target");
    // Status comes from the backend lifecycle fields; the browser clock only renders countdowns.
    expect(text).toContain("Resolving");
    // One phase-relevant time per collapsed row (ETA outbound / Returns returning); the full
    // Arrived/Returned pair renders in the expanded panel.
    expect(text).toContain("ETA");
    expect(text).toContain("Returns");
    // Hostile inbound missions read "Incoming attack"; the player's own launches stay bare.
    expect(text).toContain("Incoming attack #8");
    expect(text).not.toContain("Attack #8");
    expect(text).toContain("Hostile inbound");
    // Route endpoints render as clickable planet names (coords live in the link title).
    expect(text).toContain("New Eos");
    expect(text).toContain("Planet #9");
    expect(text).toContain("Transport #9");
    // VEY-KANEO-465: the manual "Land fleet" action is gone; returns land automatically.
    expect(text).not.toContain("Land fleet");
    // Every card exposes the single shared "Open" action into the mission detail screen.
    expect(text).toContain("Open");
    // Zero-total cargo is omitted rather than rendered as an empty placeholder.
    expect(text).not.toContain("Cargo Empty");
    // The connected wallet's own name never repeats under its own planets; other commanders
    // render as bare clickable addresses — never prefixed with "Commander".
    expect(text).not.toContain("0x1111...1111");
    expect(text).not.toContain("Commander 0x3333...3333");
    expect(text).not.toContain("Fleets 3/?");
    expect(text).not.toContain("Reload");
    expect(text).not.toContain("Fleet Operations");
    expect(text).not.toContain("MISSION CONTROL");
    expect(text).not.toContain("Galaxy");
    expect(text).not.toContain("Reports");
    expect(text).not.toContain("Battle reports");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Contract-indexed");
    expect(text).not.toContain("contract-supported");
    expect(text).not.toContain("game contract");
    expect(text).not.toContain("ACS and Intercept");
    expect(text).not.toContain("Harvests and Saves");
    expect(text).not.toContain("Missiles and Moons");
    expect(text).not.toContain("No Spy Reports");
    expect(text).not.toContain("Target intel is public contract state");
    expect(text).not.toContain("Espionage mission");
    expect(text).not.toContain("Scan mission");
    expect(text).not.toContain("Protected storage");
    expect(text).not.toContain("Raid-exposed resources");
    expect(text).not.toContain("Contract raid protection");
  });

  test("omits the redundant manual refresh control", () => {
    expect(missionControlRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(missionControlRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });

    const idlePage = missionControlPage({ loading: false });
    const refreshingPage = missionControlPage({ loading: true });
    const source = readFileSync(new URL("../src/components/MissionControlPage.tsx", import.meta.url), "utf8");

    expect(visibleText(idlePage)).not.toContain("Refresh");
    expect(visibleText(refreshingPage)).not.toContain("Refreshing");
    expect(source).not.toContain("<RefreshButton");
    expect(source).not.toContain("RefreshCw");
  });

  test("resolves colonize-mission target coordinates instead of an unavailable fallback", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({
          missionId: "42",
          missionType: "Colonize",
          originPlanetId: "7",
          targetPlanetId: encodeColonizationTargetId(2, 44, 10),
        })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // The colonize target resolves to its real coordinates, rendered as a clickable Galaxy link
    // (the card route shows the coordinate string rather than the old "Uncharted [coords]" text).
    expect(text).toContain("2:44:10");
    expect(text).not.toContain("External coordinates unavailable");
  });

  test("resolves past-archive mission target coordinates that are absent from the live feed", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "6:9:1", name: "New Zion" })],
      missionArchive: {
        wallet,
        homePlanetId: "7",
        rows: [{
          kind: "mission",
          mission: mission({
            missionId: "1",
            missionType: "Attack",
            status: "Returned",
            originPlanetId: "7",
            targetPlanetId: "40",
            originPlanet: {
              planetId: "7",
              owner: wallet,
              ownerDisplayName: "borodutch",
              name: "New Zion",
              galaxy: 6,
              system: 9,
              position: 1,
              coordinates: "6:9:1",
            },
            targetPlanet: {
              planetId: "40",
              owner: "0xa278b3943c7c58eb0d26be397507285adf6490ed",
              ownerDisplayName: null,
              name: "1517",
              galaxy: 5,
              system: 407,
              position: 4,
              coordinates: "5:407:4",
            },
          }),
        }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
    const text = visibleText(page);

    // VEY-399#2: the shared row renders the resolved planet name as a clickable Galaxy link
    // (coords live in the link title), rather than the old "name [coords]" text.
    expect(text).toContain("1517");
    expect(text).not.toContain("External coordinates unavailable");
  });

  test("renders attacker and defender attack views with side-specific controls", () => {
    const defenderPage = missionControlPage({
      fleetVisibility: {
        wallet: "0x9999999999999999999999999999999999999999",
        homePlanetId: "9",
        incoming: [mission({
          missionId: "77",
          owner: "0x1111111111111111111111111111111111111111",
          originPlanetId: "7",
          targetPlanetId: "9",
          originPlanet: {
            planetId: "7",
            owner: "0x1111111111111111111111111111111111111111",
            ownerDisplayName: "Astra",
            name: "New Eos",
            galaxy: 2,
            system: 44,
            position: 9,
            coordinates: "2:44:9",
          },
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        // A past battle report for a *different*, already-landed mission (not the active incoming
        // one) still renders in Past Missions alongside the live active card.
        battleReports: [battleReport("78")],
      },
      walletPlanets: [managedPlanet({
        planetId: "9",
        owner: "0x9999999999999999999999999999999999999999",
        coordinates: "4:55:11",
        name: "Red Haven",
      })],
      initialView: { activePage: 0, activeTab: "incoming", pastPage: 0, pastTab: "mine" },
    });
    const defenderText = visibleText(defenderPage);

    // "Hostile inbound" persists as the active-card direction label (the stat card is gone).
    expect(defenderText).toContain("Hostile inbound");
    // The commander renders as a bare clickable name now (VEY-395 dropped the "(0x…)" caption).
    expect(defenderText).toContain("Astra");
    expect(defenderText).toContain("New Eos");
    expect(defenderText).toContain("Red Haven");
    expect(defenderText).toContain("Defend planet");
    // Intercept was removed from the frontend (VEY-KANEO-439); only Defend planet remains for the defender.
    expect(defenderText).not.toContain("Intercept");
    expect(defenderText).toContain("Battle report");
    expect(defenderText).toContain("Past missions");
    expect(defenderText).not.toContain("Recall fleet");

    const attackerPage = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({
          arrivalAt: "1770001000",
          missionId: "77",
          owner: "0x1111111111111111111111111111111111111111",
          originPlanetId: "7",
          targetPlanetId: "9",
          originPlanet: {
            planetId: "7",
            owner: "0x1111111111111111111111111111111111111111",
            ownerDisplayName: "Astra",
            name: "New Eos",
            galaxy: 2,
            system: 44,
            position: 9,
            coordinates: "2:44:9",
          },
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        // A past battle report for a *different*, already-landed mission (not the active outgoing
        // one) still renders in Past Missions alongside the live active card.
        battleReports: [battleReport("78")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const attackerText = visibleText(attackerPage);

    // The summary stat-card row was removed; the active mission still renders below.
    expect(attackerText).not.toContain("Active missions 1");
    expect(attackerText).toContain("Recall fleet");
    expect(attackerText).toContain("Open");
    expect(attackerText).toContain("Battle report");
    expect(attackerText).toContain("Past missions");
    expect(attackerText).not.toContain("Defend planet");
    expect(attackerText).not.toContain("Intercept");
  });

  test("renders a shareable battle report detail with operational fields", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({
          attackGroupId: "42",
          missionId: "12",
          missionType: "AcsAttack",
          targetPlanet: {
            planetId: "9",
            owner: "0x9999999999999999999999999999999999999999",
            ownerDisplayName: "Orion",
            name: "Red Haven",
            galaxy: 4,
            system: 55,
            position: 11,
            coordinates: "4:55:11",
          },
        })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      reportMissionId: "12",
      reportUrlForMission: (missionId) => `https://test.veydrift.com/mission/${missionId}`,
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Shareable mission report");
    expect(text).toContain("Group attack #12");
    expect(text).toContain("Battle time");
    expect(text).toContain("Commanders");
    expect(text).toContain("Coordinates");
    expect(text).toContain("Fleets and cargo");
    expect(text).toContain("Losses and debris");
    expect(text).toContain("Public proof");
    expect(text).toContain("New Eos [2:44:9]");
    expect(text).toContain("Red Haven [4:55:11]");
    expect(text).toContain("Orion (0x9999...9999)");
    expect(text).toContain("Group 42");
    expect(text).toContain("https://test.veydrift.com/mission/12");
    expect(text).not.toContain("Alliance Combat System");
    expect(text).not.toContain("ACS");
  });

  test("renders due missions without the obsolete needs-orders flair", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({ arrivalAt: "1770000000", missionId: "12", missionType: "Attack", needsResolution: true })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      now: 1_770_000_700_000,
    });
    const text = visibleText(page);

    expect(text).not.toContain("Due resolvers");
    expect(text).not.toContain("Needs orders now");
    expect(text).toContain("Resolving");
    // The funded resolver missed the one-minute grace period, so the permissionless fallback appears.
    expect(text).toContain("Resolve");
  });

  test("keeps overdue mission resolution available despite legacy maintenance telemetry", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        gameMaintenance: {
          paused: true,
          observedAt: "2026-08-20T17:33:29.000Z",
          pausedSince: "2026-08-20T17:33:29.000Z",
          pauseAgeSeconds: 120
        },
        incoming: [],
        outgoing: [mission({ arrivalAt: "1770000000", missionId: "27543", missionType: "Transport", needsResolution: true })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      canTransact: true,
      now: 1_770_000_700_000,
    });

    expect(visibleText(page)).not.toContain("Game maintenance is active");
    expect(visibleAttributeValues(page, "data-mission-status")).toEqual(["Resolving"]);
    expect(visibleAttributeValues(page, "data-mission-status-action")).toEqual(["resolve"]);
  });

  test("stacks the overdue Resolve action below Resolving without changing disabled or terminal states", () => {
    const overdue = mission({ arrivalAt: "1770000000", missionId: "12", missionType: "Transport", needsResolution: true });
    const visibility = {
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      incoming: [],
      outgoing: [overdue],
      returning: [],
      joinableAttacks: [],
      completedMissions: [],
      battleReports: [],
    };
    const enabledPage = missionControlPage({
      fleetVisibility: visibility,
      now: 1_770_000_700_000,
    });

    expect(visibleAttributeValues(enabledPage, "data-mission-status")).toEqual(["Resolving"]);
    expect(visibleAttributeValues(enabledPage, "data-mission-status-layout")).toEqual(["stacked"]);
    expect(visibleAttributeValues(enabledPage, "data-mission-status-action")).toEqual(["resolve"]);
    expect(visibleAttributeValues(enabledPage, "title")).toContain("Resolve this overdue mission");

    const unavailableReason = "Wallet transaction is already indexing.";
    const disabledPage = missionControlPage({
      canTransact: false,
      fleetVisibility: visibility,
      now: 1_770_000_700_000,
      transactionUnavailableReason: unavailableReason,
    });

    expect(visibleAttributeValues(disabledPage, "data-mission-status-layout")).toEqual(["stacked"]);
    expect(visibleAttributeValues(disabledPage, "title")).toContain(unavailableReason);

    const resolvedPage = missionControlPage({
      fleetVisibility: {
        ...visibility,
        completedMissions: [mission({ ...overdue, status: "Resolved" })],
        outgoing: [],
      },
      now: 1_770_000_700_000,
    });

    expect(visibleAttributeValues(resolvedPage, "data-mission-status-layout")).toEqual(["status-only"]);
    expect(visibleAttributeValues(resolvedPage, "data-mission-status-action")).toEqual([]);
    expect(visibleAttributeValues(resolvedPage, "title")).not.toContain("Resolve this overdue mission");
  });

  test("paginates past missions inline without a separate list action", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: Array.from({ length: 26 }, (_, index) => battleReport((index + 1).toString())),
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Past missions");
    // 25 battle-report rows render on the visible first page; the 26th is on the hidden second page.
    // Each row exposes a single "Open" button (Details + Report merged in VEY-374; label shortened
    // to "Open" in the shared row, VEY-399#8).
    expect(text.split("Open").length - 1).toBe(25);
    expect(text).not.toContain("Open mission");
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("1-25 of 26");
    // VEY-400: past missions render as cards, so the table headers are gone entirely.
    expect(text).not.toContain("Mission Route Fleet");
    expect(text).not.toContain("Route / target");
    expect(text).not.toContain("Mission Route Result Details");
    expect(text).not.toContain("Completed");
    expect(text).not.toContain("Mission #1");
    expect(text).not.toContain("Open list");
    expect(text).not.toContain("Battle reports");
  });

  test("collapses a completed mission and its matching battle report into one archive row", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [mission({ missionId: "77", status: "Returned" })],
        battleReports: [battleReport("77")],
      },
    });
    const text = visibleText(page);

    // VEY-371 restores the "Past missions" header on the compact table.
    expect(text).toContain("Past missions");
    // Mission 77 collapses to a single row; the bare outgoing "Attack" label is kept.
    expect(text).toContain("Attack");
    // The old table-column mission-number wording is gone; card ids render compactly as "#77".
    expect(text).not.toContain("Mission #77");
    // A single "Open" button replaces the old split "Open details" / "Open report" pair (VEY-399#8).
    expect(text).toContain("Open");
    expect(text).not.toContain("Open mission");
    expect(text.split("Open").length - 1).toBe(1);
    expect(text).not.toContain("Open details");
    expect(text).not.toContain("Open report");
    // The standalone battle-report row is collapsed away.
    expect(text).not.toContain("Battle report");
  });

  // VEY-KANEO-495: the past/completed mission card (PastMissionSummaryRow) renders losses through a
  // different component path than the active card, so assert the Losses line surfaces there too once a
  // completed mission collapses with its battle report into one archive row.
  test("shows fleet losses on a completed mission's past archive card", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [mission({ missionId: "77", missionType: "Attack", status: "Returned" })],
        battleReports: [battleReport("77")],
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Past missions");
    expect(text).toContain("Outcome Attacker win");
    expect(text).toContain("Attacker losses 100 M / 50 C");
    expect(text).toContain("Defender losses 900 M / 250 C");
    expect(text).toContain("Debris field 600 M / 150 C");
  });

  test("shows outcome and loot on a returned attack archive card when the report is embedded in the mission row", () => {
    const page = missionControlPage({
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
        rows: [{
          kind: "mission",
          mission: mission({ missionId: "77", missionType: "Attack", status: "Returned" }),
          report: battleReport("77"),
        }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Past missions");
    expect(text).toContain("Loot 1,200 M / 300 C");
    expect(text).toContain("Outcome Attacker win");
    expect(text).toContain("Attacker losses 100 M / 50 C");
    expect(text).toContain("Defender losses 900 M / 250 C");
  });

  test("shows returned attack outcome and loot without a losses line when no ships were lost", () => {
    const page = missionControlPage({
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
        rows: [{
          kind: "mission",
          mission: mission({ missionId: "177", missionType: "Attack", status: "Returned" }),
          report: {
            ...battleReport("177"),
            attackerLosses: { metal: "0", crystal: "0", deuterium: "0" },
            defenderLosses: { metal: "0", crystal: "0", deuterium: "0" },
            debris: { metal: "0", crystal: "0" },
          },
        }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Attack #177");
    expect(text).toContain("Returned");
    expect(text).toContain("Outcome Attacker win");
    expect(text).toContain("Loot 1,200 M / 300 C");
    expect(text).not.toContain("Attacker losses");
    expect(text).not.toContain("Defender losses");
  });

  // A fleet that landed home BEFORE its scheduled arrival was recalled mid-flight and never fought;
  // the backend's terminal status collapses that to "Returned". The archive row must read "Recalled"
  // (the honest reason an attack has no win/loss outcome) and skip the bogus "Arrived" timeline row.
  test("labels an attack recalled mid-flight as Recalled, not a bare Returned", () => {
    const page = missionControlPage({
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
        rows: [{
          kind: "mission",
          // VEY-755: recall is explicit indexed provenance (timestamps alone are not a safe signal).
          mission: mission({ missionId: "7663", missionType: "Attack", status: "Returned", arrivalAt: "1770000841", returnAt: "1770000695", recallProvenance: "FleetMissionRecalled" }),
        }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Attack #7663");
    expect(text).toContain("Recalled");
    expect(text).not.toContain("Arrived");
    expect(text).toContain("Recalled — returned");
  });

  // The Alliance active tab only ever holds joinable alliance attacks; a player with no alliance
  // sees a permanent "(0)", so the tab hides entirely (and reappears the moment alliance rows or
  // membership exist).
  test("hides the Alliance active tab for players without an alliance", () => {
    const base = {
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [mission({ missionId: "9", missionType: "Transport" })],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
    };
    const withoutAlliance = visibleText(missionControlPage({ ...base, hasAlliance: false }));
    expect(withoutAlliance).not.toContain("Alliance (");

    const withAlliance = visibleText(missionControlPage({ ...base, hasAlliance: true }));
    expect(withAlliance).toContain("Alliance (0)");
  });

  test("renders returned moon-target missions distinctly in the completed archive", () => {
    const page = missionControlPage({
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
        rows: [{
          kind: "mission",
          mission: mission({
            missionId: "92",
            missionType: "Attack",
            status: "Returned",
            targetPlanet: {
              planetId: "9",
              owner: "0x9999999999999999999999999999999999999999",
              ownerDisplayName: "Orion",
              name: "Red Haven",
              galaxy: 4,
              system: 55,
              position: 11,
              coordinates: "4:55:11",
              hasMoon: true,
            },
            targetIsMoon: true,
          }),
          report: { ...battleReport("92"), targetIsMoon: true },
        }],
        pagination: {
          page: 1,
          pageSize: 25,
          totalEntries: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Past missions");
    expect(text).toContain("Moon of Red Haven");
    expect(text).not.toContain(" Moon at planet #9");
  });

  test("renders a standalone battle report row when no completed mission matches", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("90")],
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Battle report");
    // VEY-371 restores the "Past missions" header and renders the target planet inline.
    expect(text).toContain("Past missions");
    expect(text).toContain("Planet #7");
    // Standalone battle-report rows also lead to the single unified mission detail screen,
    // via the shared "Open" action (VEY-399#8).
    expect(text).toContain("Open");
    expect(text).not.toContain("Open mission");
    expect(text).not.toContain("Open report");
  });

  test.each([
    {
      label: "outgoing attacker win",
      report: { ...battleReport("201"), attacker: "0x1111111111111111111111111111111111111111", targetPlanetId: "9", outcome: "AttackerWin" as const },
      walletPlanets: [],
      expected: "Won",
    },
    {
      label: "outgoing attacker loss",
      report: { ...battleReport("202"), attacker: "0x1111111111111111111111111111111111111111", targetPlanetId: "9", outcome: "DefenderWin" as const },
      walletPlanets: [],
      expected: "Attack failed",
    },
    {
      label: "incoming defender win",
      report: { ...battleReport("203"), targetPlanetId: "7", outcome: "DefenderWin" as const },
      walletPlanets: [managedPlanet()],
      expected: "Defended",
    },
    {
      label: "incoming defender loss",
      report: { ...battleReport("204"), targetPlanetId: "7", outcome: "AttackerWin" as const },
      walletPlanets: [managedPlanet()],
      expected: "Raided",
    },
    {
      label: "observer draw",
      report: { ...battleReport("205"), targetPlanetId: "9", outcome: "Draw" as const },
      walletPlanets: [],
      expected: "Draw",
    },
    {
      // Neutral/observer rows deliberately use the attacker's perspective vocabulary.
      label: "observer attacker loss",
      report: { ...battleReport("206"), targetPlanetId: "9", outcome: "DefenderWin" as const },
      walletPlanets: [],
      expected: "Attack failed",
    },
  ])("renders $label in a standalone report's collapsed status cell", ({ expected, report, walletPlanets }) => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [report],
      },
      walletPlanets,
    });

    expect(visibleAttributeValues(page, "data-mission-status")).toEqual([expected]);
    // The expanded Battle group stays factual and preserves the raw combat result.
    expect(visibleText(page)).toContain(`Outcome ${report.outcome === "AttackerWin" ? "Attacker win" : report.outcome === "DefenderWin" ? "Defender win" : "Draw"}`);
  });

  test("renders standalone moon-target battle reports distinctly from parent-planet reports", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [{ ...battleReport("91"), targetIsMoon: true }],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Battle report");
    expect(text).toContain("Moon of New Eos");
    expect(text).not.toContain(" Moon of Planet #7");
  });

  test("keeps active missions' battle reports out of Past Missions until the fleet lands (VEY-KANEO-434)", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        // Both an en-route attack (Outbound) and a fleet flying home (Returning) are still ACTIVE
        // missions. While active they belong only in the active section — a matching battle report
        // must not be duplicated into Past Missions for the same in-flight mission (VEY-KANEO-434).
        outgoing: [mission({ missionId: "44", missionType: "Attack", status: "Outbound" })],
        returning: [mission({ missionId: "55", missionType: "Attack", status: "Returning" })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("44"), battleReport("55")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // The missions still render in the active section.
    expect(text).toContain("Returning");
    // Neither active mission's report leaks into the archive while the mission is in flight.
    expect(text).not.toContain("Battle report");
    expect(text).toContain("No completed missions are visible for this wallet yet.");
  });

  test("labels past missions by direction and drops the self-commander on outgoing", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [
          mission({
            missionId: "77",
            missionType: "Transport",
            owner: "0x1111111111111111111111111111111111111111",
            originPlanetId: "7",
            targetPlanetId: "9",
            status: "Returned",
          }),
          mission({
            missionId: "88",
            missionType: "Attack",
            owner: "0x3333333333333333333333333333333333333333",
            originPlanetId: "5",
            targetPlanetId: "7",
            status: "Resolved",
          }),
        ],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // Outgoing past mission keeps the bare action label. The shared row no longer prefixes the
    // commander with the word "Commander" — it renders the address as a clickable subtext (VEY-399).
    expect(text).toContain("Transport");
    expect(text).not.toContain("Commander 0x1111...1111");
    // Incoming past mission is prefixed and keeps the foreign commander identity on the route.
    expect(text).toContain("Incoming attack");
    expect(text).toContain("0x3333...3333");
    expect(text).not.toContain("Commander 0x3333...3333");
    // VEY-400: the terminal status reads as a header pill ("Returned"), with no raw timestamp —
    // folding in the VEY-399 rework intent now that cards have no MISSION column.
    expect(text).toContain("Returned");
    expect(text).not.toContain("Returned · ");
    // No usable battle report exists for either completed combat row, so the collapsed status cell
    // must retain the muted terminal fallback instead of fabricating a player-facing outcome.
    expect(visibleAttributeValues(page, "data-mission-status")).toEqual(["Returned", "Resolved"]);
  });

  test("shows outbound cargo and return-leg loot as separate lines on the mission card", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        // A returning attack carries home both its outbound cargo and the loot it grabbed; its
        // battle report supplies the loot (VEY-404).
        outgoing: [],
        returning: [mission({
          missionId: "55",
          missionType: "Attack",
          status: "Returning",
          cargo: { metal: "10", crystal: "0", deuterium: "0" },
        })],
        joinableAttacks: [],
        // An en-route outbound attack must stay cargo-only even when a report id collides — the
        // haul is not carried until the fleet turns back.
        completedMissions: [],
        battleReports: [battleReport("55")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // Both the outbound cargo and the looted haul render, on their own labeled lines.
    expect(text).toContain("Cargo 10 M");
    expect(text).toContain("Loot 1,200 M / 300 C");
  });

  test("shows harvested debris from return cargo on a returning harvest mission card", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [mission({
          missionId: "56",
          missionType: "Harvest",
          status: "Returning",
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          returnCargo: { metal: "1200", crystal: "300", deuterium: "0" },
          ships: { recycler: "1" },
        })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).not.toContain("Cargo Empty");
    expect(text).toContain("Debris collected 1,200 M / 300 C");
    expect(text).not.toContain("Loot 1,200 M / 300 C");
  });

  test("shows harvested debris on completed harvest mission cards", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [],
        completedMissions: [mission({
          missionId: "57",
          missionType: "Harvest",
          status: "Returned",
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          returnCargo: { metal: "400", crystal: "50", deuterium: "0" },
          ships: { recycler: "1" },
        })],
        battleReports: [],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Harvest");
    expect(text).toContain("Returned");
    expect(text).toContain("Debris collected 400 M / 50 C");
    expect(text).not.toContain("Outcome");
    expect(text).not.toContain("Losses");
  });

  test("shows a joined attack participant's grabbed loot on the returning mission card", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [mission({
          missionId: "78",
          missionType: "AcsAttack",
          status: "Returning",
          attackGroupId: "77",
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
        })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [{
          ...battleReport("77"),
          attackGroupId: "77",
          participants: [
            {
              missionId: "77",
              address: "0x2222222222222222222222222222222222222222",
              isMainAttacker: true,
              ships: { smallCargo: "1" },
              loot: { metal: "1200", crystal: "300", deuterium: "0" },
            },
            {
              missionId: "78",
              address: wallet,
              isMainAttacker: false,
              ships: { smallCargo: "1" },
              loot: { metal: "30", crystal: "5", deuterium: "0" },
            },
          ],
        }],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).not.toContain("Cargo Empty");
    expect(text).toContain("Loot 30 M / 5 C");
    expect(text).not.toContain("Loot 1,200 M / 300 C");
  });

  test("omits zero cargo and zero loot on a resolved returning attack", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [mission({
          missionId: "60",
          missionType: "Attack",
          status: "Returning",
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
        })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [{
          ...battleReport("60"),
          loot: { metal: "0", crystal: "0", deuterium: "0" },
        }],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).not.toContain("Cargo Empty");
    expect(text).not.toContain("Loot Empty");
    expect(text).not.toContain("Loot 1,200");
  });

  test("withholds loot from a mission card until the fleet leaves its outbound leg", () => {
    const loot = { metal: "1200", crystal: "300", deuterium: "0" };
    const lootByMissionId = new Map([["55", loot]]);

    // En-route outbound/incoming cards stay cargo-only even when a matching report id exists: the
    // haul is not carried (or not the player's) until the fleet turns back.
    expect(returnPhaseLoot(mission({ missionId: "55", status: "Outbound" }), lootByMissionId)).toBeUndefined();
    // Once a fleet is returning/returned, its matching loot is surfaced for the card's Loot line.
    expect(returnPhaseLoot(mission({ missionId: "55", status: "Returning" }), lootByMissionId)).toBe(loot);
    expect(returnPhaseLoot(mission({ missionId: "55", status: "Returned" }), lootByMissionId)).toBe(loot);
    // No matching report -> no loot line at all (e.g. a returning transport).
    expect(returnPhaseLoot(mission({ missionId: "999", status: "Returned" }), lootByMissionId)).toBeUndefined();
  });

  test("withholds harvested debris until a harvest fleet leaves its outbound leg", () => {
    const harvested = { metal: "1200", crystal: "300", deuterium: "0" };

    expect(returnPhaseHarvestedResources(mission({
      missionId: "56",
      missionType: "Harvest",
      status: "Outbound",
      returnCargo: harvested,
    }))).toBeUndefined();
    expect(returnPhaseHarvestedResources(mission({
      missionId: "56",
      missionType: "Harvest",
      status: "Returning",
      returnCargo: harvested,
    }))).toBe(harvested);
    expect(returnPhaseHarvestedResources(mission({
      missionId: "56",
      missionType: "Harvest",
      status: "Returned",
      returnCargo: harvested,
    }))).toBe(harvested);
    expect(returnPhaseHarvestedResources(mission({
      missionId: "56",
      missionType: "Transport",
      status: "Returned",
      returnCargo: harvested,
    }))).toBeUndefined();
  });

  // VEY-KANEO-495: a resolved attack must show what it cost on its own card. Before this the card
  // showed the committed fleet + loot only, so a failed attack read as if the fleet came home intact.
  test("shows attacker and defender fleet losses on a resolved attack's mission card", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [mission({
          missionId: "55",
          missionType: "Attack",
          status: "Returning",
          cargo: { metal: "10", crystal: "0", deuterium: "0" },
        })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [battleReport("55")],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // Each non-zero combat fact has its own exact label; zero resource components are quiet.
    expect(text).toContain("Outcome Attacker win");
    expect(text).toContain("Attacker losses 100 M / 50 C");
    expect(text).toContain("Defender losses 900 M / 250 C");
    expect(text).toContain("Debris field 600 M / 150 C");
    expect(text).not.toContain("Attack failed");
  });

  test("surfaces a failed attack's fleet losses on its mission card", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        // A defender-win battle where the attacker took heavy losses and grabbed no loot. The card
        // must surface those losses rather than only the committed fleet it launched with.
        returning: [mission({ missionId: "60", missionType: "Attack", status: "Returning" })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [{
          ...battleReport("60"),
          outcome: "DefenderWin",
          loot: { metal: "0", crystal: "0", deuterium: "0" },
          attackerLosses: { metal: "5000", crystal: "3000", deuterium: "0" },
          defenderLosses: { metal: "200", crystal: "100", deuterium: "0" },
        }],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    // The defender-win outcome is stated explicitly so a wiped-out attack reads as a failure, not
    // just heavy losses next to the launch fleet: the row's status cell reads "Attack failed"
    // (VEY-KANEO-495 criterion 2), and the debris created by the battle is surfaced for follow-up
    // harvest (criterion 3).
    expect(text).toContain("Attack failed");
    expect(text).toContain("Outcome Defender win");
    expect(text).toContain("Attacker losses 5,000 M / 3,000 C");
    expect(text).toContain("Defender losses 200 M / 100 C");
    expect(text).toContain("Debris field 600 M / 150 C");
  });

  test("does not flag a winning raid as a failed attack, and still shows debris", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const page = missionControlPage({
      fleetVisibility: {
        wallet,
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        // A successful raid (AttackerWin) with zero attacker losses must read as a win, never as a
        // failed attack (VEY-KANEO-495 acceptance criterion: no false loss flag on a winning raid).
        returning: [mission({ missionId: "61", missionType: "Attack", status: "Returning" })],
        joinableAttacks: [],
        completedMissions: [],
        battleReports: [{
          ...battleReport("61"),
          outcome: "AttackerWin",
          attackerLosses: { metal: "0", crystal: "0", deuterium: "0" },
        }],
      },
      walletPlanets: [managedPlanet({ planetId: "7", coordinates: "2:44:9", name: "New Eos" })],
    });
    const text = visibleText(page);

    expect(text).toContain("Outcome Attacker win");
    expect(text).not.toContain("Attack failed");
    expect(text).toContain("Debris field 600 M / 150 C");
  });

  test("withholds fleet losses from a mission card until the fleet leaves its outbound leg", () => {
    const losses = { outcome: "AttackerWin" as const, attacker: { metal: "100", crystal: "50", deuterium: "0" }, defender: { metal: "900", crystal: "250", deuterium: "0" }, debris: { metal: "600", crystal: "150" } };
    const lossesByMissionId = new Map([["55", losses]]);

    // An en-route outbound fleet has fought nothing yet — no losses line even if a report id collides.
    expect(returnPhaseLosses(mission({ missionId: "55", status: "Outbound" }), lossesByMissionId)).toBeUndefined();
    // Once the fleet is returning/returned, the battle's losses are surfaced for the card's Losses line.
    expect(returnPhaseLosses(mission({ missionId: "55", status: "Returning" }), lossesByMissionId)).toBe(losses);
    expect(returnPhaseLosses(mission({ missionId: "55", status: "Returned" }), lossesByMissionId)).toBe(losses);
    // No matching report -> no losses line at all (e.g. a returning transport).
    expect(returnPhaseLosses(mission({ missionId: "999", status: "Returned" }), lossesByMissionId)).toBeUndefined();
  });

  test("surfaces joinable attacks under the Alliance tab (no stat-card row)", () => {
    const page = missionControlPage({
      fleetVisibility: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        incoming: [],
        outgoing: [],
        returning: [],
        joinableAttacks: [mission({
          missionId: "88",
          missionType: "Attack",
          owner: "0x3333333333333333333333333333333333333333",
          originPlanetId: "12",
          targetPlanetId: "99",
        })],
        completedMissions: [],
        battleReports: [],
      },
    });
    const text = visibleText(page);

    // The summary stat-card row was removed; the joinable attack is now surfaced in the
    // Alliance tab (My missions / Alliance split from VEY-375), not a unified list.
    expect(text).not.toContain("Active missions 1");
    expect(text).toContain("My missions (0)");
    expect(text).toContain("Alliance (1)");
  });
});

describe("backend-authoritative mission status", () => {
  // arrivalAt 1770000300 (ms 1_770_000_300_000), returnAt 1770000600 (ms 1_770_000_600_000).
  const beforeArrival = 1_770_000_200_000;
  const afterArrival = 1_770_000_400_000;
  const afterReturn = 1_770_000_700_000;

  test("does not manufacture an Outbound transition from the browser clock", () => {
    const fleet = mission({ status: "Outbound" });
    expect(missionStatusPill(fleet, beforeArrival).label).toBe("En route");
    expect(missionStatusPill(fleet, afterArrival).label).toBe("En route");
    expect(missionStatusPill(mission({ status: "Outbound", needsResolution: true }), beforeArrival).label).toBe("Resolving");
  });

  test("uses backend return freshness instead of the browser clock", () => {
    const returning = mission({ status: "Returning" });
    const recalled = mission({ status: "Recalled" });
    expect(missionStatusPill(returning, afterArrival).label).toBe("Returning");
    expect(missionStatusPill(returning, afterReturn).label).toBe("Returning");
    expect(missionStatusPill(recalled, afterArrival).label).toBe("Recalled");
    expect(missionStatusPill(recalled, afterReturn).label).toBe("Recalled");
    expect(missionStatusPill(mission({ status: "Returning", asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 0, arrived: true, returned: true } }), beforeArrival).label).toBe("Resolving");
  });

  test("terminal backend statuses pass through unchanged", () => {
    expect(missionStatusPill(mission({ status: "Returned" }), afterReturn).label).toBe("Returned");
    expect(missionStatusPill(mission({ status: "Resolved" }), afterReturn).label).toBe("Resolved");
  });

  test("the text label mirrors the pill for the report card and shared report", () => {
    const fleet = mission({ status: "Outbound" });
    expect(missionDisplayStatusLabel(fleet, beforeArrival)).toBe("en route");
    expect(missionDisplayStatusLabel(fleet, afterArrival)).toBe("en route");
    expect(missionDisplayStatusLabel(mission({ status: "Outbound", needsResolution: true }), beforeArrival)).toBe("resolving");
    expect(missionDisplayStatusLabel(mission({ status: "Returning", asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 0, arrived: true, returned: true } }), beforeArrival)).toBe("resolving");
  });
});

describe("manual mission resolution fallback", () => {
  test("appears only after a backend-confirmed mission leg has exceeded the grace period", () => {
    const outbound = mission({ arrivalAt: "1770000300", missionType: "Transport", needsResolution: true, status: "Outbound" });
    const returning = mission({ asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 0, arrived: true, returned: true }, returnAt: "1770000600", status: "Returning" });

    expect(manualMissionResolutionKind(outbound, 1_770_000_479_999)).toBeUndefined();
    expect(manualMissionResolutionKind(outbound, 1_770_000_480_000)).toBe("arrival");
    expect(manualMissionResolutionKind(returning, 1_770_000_779_999)).toBeUndefined();
    expect(manualMissionResolutionKind(returning, 1_770_000_780_000)).toBe("return");
  });

  test("stays hidden while combat randomness is pending and after terminal settlement", () => {
    expect(manualMissionResolutionKind(
      mission({ arrivalAt: "1770000300", needsResolution: true, resolutionBlocker: "randomness_pending", status: "Outbound" }),
      1_770_001_000_000,
    )).toBeUndefined();
    expect(manualMissionResolutionKind(
      mission({ arrivalAt: "1770000300", status: "Returned" }),
      1_770_001_000_000,
    )).toBeUndefined();
  });
});

function missionControlPage(overrides: Partial<Parameters<typeof MissionControlPage>[0]> = {}): ComponentChildren {
  return MissionControlPage({
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
    loading: false,
    now: 1_770_000_700_000,
    onCounterplay: () => undefined,
    onJoinAttack: () => undefined,
    onOpenReport: () => undefined,
    onOpenReportList: () => undefined,
    onRecall: () => undefined,
    onRefresh: () => undefined,
    onResolve: () => undefined,
    ...overrides,
  });
}

function mission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Outbound",
    missionType: "Attack",
    owner: "0x1111111111111111111111111111111111111111",
    originPlanetId: "7",
    targetPlanetId: "9",
    arrivalAt: "1770000300",
    returnAt: "1770000600",
    fuelCost: "25",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {
      smallCargo: "0",
      lightFighter: "1",
    },
    transactionHash: "0xabc",
    blockNumber: "1",
    ...overrides,
  };
}

function managedPlanet(overrides: Partial<ManagedPlanetResponse> = {}): ManagedPlanetResponse {
  return {
    planetId: "7",
    owner: "0x1111111111111111111111111111111111111111",
    name: null,
    galaxy: 2,
    system: 44,
    position: 9,
    fields: 200,
    temperature: 20,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "1770000000",
    resources: { metal: "0", crystal: "0", deuterium: "0" },
    coordinates: "2:44:9",
    isHomePlanet: true,
    fieldsUsed: 0,
    fieldsCapacity: 200,
    keyLevels: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
    moon: null,
    ...overrides,
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

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function visibleAttributeValues(node: ComponentChildren, attribute: string): string[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => visibleAttributeValues(child, attribute));
  }
  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return visibleAttributeValues(vnode.type(vnode.props), attribute);
  }
  if ((vnode.props as { hidden?: boolean } | undefined)?.hidden) {
    return [];
  }
  const value = (vnode.props as Record<string, unknown> | undefined)?.[attribute];
  const current = typeof value === "string" ? [value] : [];
  return [...current, ...visibleAttributeValues(vnode.props?.children as ComponentChildren, attribute)];
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
  if ((vnode.props as { hidden?: boolean } | undefined)?.hidden) {
    return [];
  }
  return textParts(vnode.props?.children as ComponentChildren);
}
