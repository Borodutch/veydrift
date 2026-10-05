import { describe, expect, test } from "bun:test";

import { FleetSummaryRow, overviewPlanetDisplayName, summarizeFleets } from "./components/OverviewPage";
import type { Planet } from "./types";
import type { FleetMissionPlanetReference, FleetMissionSummary, FleetMissionVisibilityResponse } from "./walletFlow";

const PLAYER_WALLET = "0x1111111111111111111111111111111111111111";
const ENEMY_WALLET = "0x2222222222222222222222222222222222222222";

describe("Overview fleets summary", () => {
  test("renders compact structured mission rows with type, direction, lifecycle, and ETA", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const fleetVisibility = visibility({
      outgoing: [
        mission({
          missionId: "1",
          missionType: "Attack",
          status: "Outbound",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "40",
          arrivalMs: now + 13 * 60_000,
          targetPlanet: planetRef("40", ENEMY_WALLET, "1517", 5, 407, 4),
        }),
      ],
      returning: [
        mission({
          missionId: "2",
          missionType: "Transport",
          status: "Returning",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "9",
          arrivalMs: now - 60_000,
          returnMs: now + 5 * 60_000,
          targetPlanet: planetRef("9", ENEMY_WALLET, "Outpost", 6, 12, 3),
        }),
      ],
    });

    const summary = summarizeFleets(fleetVisibility, now);
    expect(summary.activeCount).toBe(2);
    expect(summary.lines.map((line) => line.text)).toEqual([
      "Attack · Outbound to 1517 [5:407:4] · Outbound · ETA 13m",
      "Transport · Returning from Outpost [6:12:3] · Returning · Lands 5m",
    ]);

    const text = collectText(FleetsSummary({
      fleetVisibility,
      now,
    })).join(" ");

    expect(text).not.toContain("2 active");
    expect(text).toContain("Attack Priority Outbound to 1517 [5:407:4] Outbound ETA");
    expect(text).toContain("Transport Returning from Outpost [6:12:3] Returning Lands");
    // Structured cells replace the former repeated sentence punctuation and raw id route.
    expect(text).not.toContain(" · ");
    expect(text).not.toContain("1 -> 40");
  });

  test("sorts hostile inbound attacks by ETA and keeps every attack in the uncapped priority group", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const fleetVisibility = visibility({
      incoming: [
        mission({
          missionId: "10",
          missionType: "Attack",
          status: "Outbound",
          owner: ENEMY_WALLET,
          originPlanetId: "40",
          targetPlanetId: "1",
          arrivalMs: now + 8 * 60_000,
          originPlanet: planetRef("40", ENEMY_WALLET, "Raider", 5, 407, 4),
        }),
        mission({
          missionId: "11",
          missionType: "Attack",
          status: "Outbound",
          owner: ENEMY_WALLET,
          originPlanetId: "41",
          targetPlanetId: "1",
          arrivalMs: now + 3 * 60_000,
          originPlanet: planetRef("41", ENEMY_WALLET, "Reaver", 5, 407, 9),
        }),
      ],
    });

    const summary = summarizeFleets(fleetVisibility, now);
    expect(summary.attackLines.map((line) => line.text)).toEqual([
      "Attack · Inbound from Reaver [5:407:9] · Outbound · ETA 3m",
      "Attack · Inbound from Raider [5:407:4] · Outbound · ETA 8m",
    ]);
    expect(summary.visibleLines).toHaveLength(2);
    expect(summary.hiddenCount).toBe(0);

    const text = collectText(FleetsSummary({
      fleetVisibility,
      now,
    })).join(" ");

    expect(text).toContain("Attack Priority Inbound from Raider [5:407:4]");
    expect(text).toContain("Attack Priority Inbound from Reaver [5:407:9]");
    expect(text).not.toContain("Under attack");
    expect(text).not.toContain("hostile fleets inbound");
  });

  test("shows a returning incoming Harvest as amber and uses its return timing", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const fleetVisibility = visibility({
      incoming: [
        mission({
          missionId: "12",
          missionType: "Harvest",
          status: "Returning",
          owner: ENEMY_WALLET,
          originPlanetId: "40",
          targetPlanetId: "1",
          arrivalMs: now - 2 * 60_000,
          returnMs: now + 5 * 60_000,
          originPlanet: planetRef("40", ENEMY_WALLET, "Recycler Base", 4, 140, 13),
        }),
      ],
    });

    const summary = summarizeFleets(fleetVisibility, now);

    expect(summary.lines[0]).toMatchObject({
      direction: "returning",
      endpointLabel: "Recycler Base [4:140:13]",
      key: "in-12",
      missionType: "Harvest",
      relation: "friendly",
      state: "Returning",
      timingLabel: "Lands",
      timingValue: "5m",
      tone: "harvest",
    });
    expect(collectText(FleetsSummary({
      fleetVisibility,
      now,
    })).join(" ")).not.toContain("arriving now");
  });

  test("distinguishes hostile, friendly, and self inbound rows and deduplicates by mission id", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const hostile = mission({
      missionId: "10",
      missionType: "Attack",
      status: "Outbound",
      owner: ENEMY_WALLET,
      originPlanetId: "40",
      targetPlanetId: "1",
      arrivalMs: now + 8 * 60_000,
      originPlanet: planetRef("40", ENEMY_WALLET, "Raider", 5, 407, 4),
    });
    const friendly = mission({
      missionId: "11",
      missionType: "Transport",
      status: "Outbound",
      owner: ENEMY_WALLET,
      originPlanetId: "41",
      targetPlanetId: "1",
      arrivalMs: now + 6 * 60_000,
      originPlanet: planetRef("41", ENEMY_WALLET, "Ally", 5, 407, 9),
    });
    const selfInbound = mission({
      missionId: "12",
      missionType: "Deploy",
      status: "Outbound",
      owner: PLAYER_WALLET,
      originPlanetId: "2",
      targetPlanetId: "1",
      arrivalMs: now + 4 * 60_000,
      originPlanet: planetRef("2", PLAYER_WALLET, "Colony", 5, 408, 2),
    });
    const fleetVisibility = visibility({
      incoming: [hostile, friendly, selfInbound],
      outgoing: [selfInbound],
    });

    const summary = summarizeFleets(fleetVisibility, now);
    expect(summary.activeCount).toBe(3);
    expect(summary.lines.map((line) => line.text)).toEqual([
      "Attack · Inbound from Raider [5:407:4] · Outbound · ETA 8m",
      "Deploy · Inbound from Colony [5:408:2] · Outbound · ETA 4m",
      "Transport · Inbound from Ally [5:407:9] · Outbound · ETA 6m",
    ]);
    expect(summary.lines.map((line) => line.relation)).toEqual(["hostile", "self", "friendly"]);

    const node = FleetsSummary({
      fleetVisibility,
      now,
    });
    const rows = collectElementsByType(node, "li");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.props?.className)).toEqual([
      expect.stringContaining("grid-cols-[1.75rem_minmax(0,1fr)_auto]"),
      expect.stringContaining("grid-cols-[1.75rem_minmax(0,1fr)_auto]"),
      expect.stringContaining("grid-cols-[1.75rem_minmax(0,1fr)_auto]"),
    ]);
    expect(rows[0]?.props?.["data-attack-priority"]).toBe("true");
  });

  test("caps ETA-sorted non-attacks at four", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const outgoing: FleetMissionSummary[] = Array.from({ length: 6 }, (_unused, index) =>
      mission({
        missionId: `o${index}`,
        missionType: "Transport",
        status: "Outbound",
        owner: PLAYER_WALLET,
        originPlanetId: "1",
        targetPlanetId: `${index}`,
        arrivalMs: now + (index + 1) * 60_000,
        targetPlanet: planetRef(`${index}`, ENEMY_WALLET, `T${index}`, 1, 1, index),
      }),
    );
    const summary = summarizeFleets(visibility({ outgoing }), now);
    expect(summary.activeCount).toBe(6);
    expect(summary.lines.length).toBe(6);
    expect(summary.visibleLines.map((line) => line.key)).toEqual(["out-o0", "out-o1", "out-o2", "out-o3"]);
    expect(summary.hiddenLines.map((line) => line.key)).toEqual(["out-o4", "out-o5"]);
    expect(summary.hiddenCount).toBe(2);

  });

  test("never spends the four-row non-attack allowance on attacks", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const outgoing = [
      ...Array.from({ length: 6 }, (_unused, index) => mission({
        missionId: `attack-${index}`,
        missionType: index % 2 === 0 ? "Attack" : "AcsAttack",
        status: "Outbound",
        owner: PLAYER_WALLET,
        originPlanetId: "1",
        targetPlanetId: `a${index}`,
        arrivalMs: now + (10 + index) * 60_000,
      })),
      ...Array.from({ length: 6 }, (_unused, index) => mission({
        missionId: `transport-${index}`,
        missionType: "Transport",
        status: "Outbound",
        owner: PLAYER_WALLET,
        originPlanetId: "1",
        targetPlanetId: `t${index}`,
        arrivalMs: now + (index + 1) * 60_000,
      })),
    ];

    const summary = summarizeFleets(visibility({ outgoing }), now);
    expect(summary.attackLines).toHaveLength(6);
    expect(summary.visibleLines).toHaveLength(10);
    expect(summary.visibleLines.filter((line) => line.isAttack)).toHaveLength(6);
    expect(summary.visibleLines.filter((line) => !line.isAttack)).toHaveLength(4);
    expect(summary.hiddenCount).toBe(2);
  });

  test("falls back to a coordinate-free planet id when the planet reference is missing", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const summary = summarizeFleets(visibility({
      outgoing: [
        mission({
          missionId: "1",
          missionType: "Deploy",
          status: "Outbound",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "77",
          arrivalMs: now + 60_000,
          targetPlanet: null,
        }),
      ],
    }), now);
    expect(summary.lines[0]?.text).toBe("Deploy · Outbound to Planet #77 · Outbound · ETA 1m");
  });

  test("uses a known planet-roster name when the mission endpoint omits it", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const summary = summarizeFleets(
      visibility({
        outgoing: [
          mission({
            missionId: "1",
            missionType: "Transport",
            status: "Outbound",
            owner: PLAYER_WALLET,
            originPlanetId: "1",
            targetPlanetId: "77",
            arrivalMs: now + 60_000,
            targetPlanet: planetRef("77", PLAYER_WALLET, null, 6, 9, 4),
          }),
        ],
      }),
      now,
      new Map([["id:77", "New London"]]),
    );

    expect(summary.lines[0]?.text).toBe("Transport · Outbound to New London [6:9:4] · Outbound · ETA 1m");
  });

  test("uses the commander identity when an unnamed mission planet has no known roster name", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const originPlanet = {
      ...planetRef("162", ENEMY_WALLET, null, 4, 140, 13),
      ownerDisplayName: "arcturus",
    };
    const summary = summarizeFleets(visibility({
      incoming: [
        mission({
          missionId: "12",
          missionType: "Harvest",
          status: "Returning",
          owner: ENEMY_WALLET,
          originPlanetId: "162",
          targetPlanetId: "1",
          arrivalMs: now - 60_000,
          returnMs: now + 5 * 60_000,
          originPlanet,
        }),
      ],
    }), now);

    expect(summary.lines[0]?.text).toBe("Harvest · Returning to arcturus's planet [4:140:13] · Returning · Lands 5m");
  });

  test("labels stationed DefenseHold missions as holding instead of resolving", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const summary = summarizeFleets(visibility({
      outgoing: [
        mission({
          missionId: "67",
          missionType: "DefenseHold",
          status: "Outbound",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "23",
          arrivalMs: now - 2 * 60_000,
          returnMs: now + 45 * 60_000,
          asOfNow: { secondsUntilArrival: 0, secondsUntilReturn: 45 * 60, arrived: true, returned: false },
          targetPlanet: planetRef("23", PLAYER_WALLET, "Bastion", 7, 14, 2),
        }),
      ],
    }), now);

    expect(summary.lines[0]?.text).toBe("Stationed defense · Outbound to Bastion [7:14:2] · Stationed · Ends 45m");
    expect(summary.lines[0]?.text).not.toContain("Resolving");
  });

  test("updates countdowns locally but lifecycle only from backend fields", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const outbound = mission({
      missionId: "clocked",
      missionType: "Transport",
      status: "Outbound",
      owner: PLAYER_WALLET,
      originPlanetId: "1",
      targetPlanetId: "2",
      arrivalMs: now + 60_000,
    });

    expect(summarizeFleets(visibility({ outgoing: [outbound] }), now).lines[0]).toMatchObject({
      state: "Outbound",
      timingLabel: "ETA",
      timingValue: "1m",
    });
    expect(summarizeFleets(visibility({ outgoing: [outbound] }), now + 2 * 60_000).lines[0]).toMatchObject({
      state: "Outbound",
      timingLabel: "ETA",
      timingValue: "Now",
    });
    expect(summarizeFleets(visibility({ outgoing: [{
      ...outbound,
      needsResolution: true,
      combatResolutionProgress: { roundsCompleted: 4, totalRounds: 6 },
    }] }), now).lines[0]).toMatchObject({
      state: "Battle in progress",
    });

    const returning = { ...outbound, status: "Returning", returnAt: Math.floor((now + 5 * 60_000) / 1_000).toString() };
    expect(summarizeFleets(visibility({ returning: [returning] }), now).lines[0]).toMatchObject({
      direction: "returning",
      routeLabel: "Returning from",
      state: "Returning",
      timingLabel: "Lands",
      timingValue: "5m",
    });
  });

  test("keeps long planet names inside the compact responsive row", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const longName = "The Extremely Long Planet Name That Must Never Overflow";
    const node = FleetsSummary({
      fleetVisibility: visibility({
        outgoing: [mission({
          missionId: "long-name",
          missionType: "Transport",
          status: "Outbound",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "2",
          arrivalMs: now + 60_000,
          targetPlanet: planetRef("2", PLAYER_WALLET, longName, 9, 499, 15),
        })],
      }),
      now,
    });
    const row = collectElementsByType(node, "li")[0];
    const endpoint = collectElementsByType(node, "span").find((element) => element.props?.title === `${longName} [9:499:15]`);

    expect(row?.props?.className).toContain("min-w-0");
    expect(row?.props?.className).toContain("grid-cols-[1.75rem_minmax(0,1fr)_auto]");
    expect(endpoint?.props?.className).toContain("truncate");
  });
});

describe("Overview planet display name", () => {
  test("uses a trimmed real planet name when one is loaded", () => {
    expect(overviewPlanetDisplayName(planet({ name: "  New Eos  " }), undefined)).toBe("New Eos");
  });

  test("falls back to hydrated coordinates when the loaded planet name is blank", () => {
    expect(overviewPlanetDisplayName(planet({ name: "   ", galaxy: 3, system: 12, position: 4 }), undefined)).toBe("Planet 3:12:4");
  });

  test("falls back to settlement summary coordinates while the planet identity hydrates", () => {
    expect(overviewPlanetDisplayName(undefined, {
      label: "Home planet",
      coordinates: " 2:44:9 ",
      source: "chain",
    })).toBe("Planet 2:44:9");
  });
});

function FleetsSummary({ fleetVisibility, now }: { fleetVisibility: FleetMissionVisibilityResponse; now: number }) {
  return summarizeFleets(fleetVisibility, now).lines.map((line) => FleetSummaryRow({ line }));
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

function collectElementsByType(node: unknown, type: string): Array<{
  key?: string | number | null;
  props?: { children?: unknown; className?: string; [key: string]: unknown };
  type?: unknown;
}> {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElementsByType(child, type));

  const vnode = node as {
    key?: string | number | null;
    type?: unknown;
    props?: { children?: unknown; className?: string; [key: string]: unknown };
  };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: { children?: unknown; [key: string]: unknown }) => unknown;
    if (render.name === "Icon") return [];
    return collectElementsByType(render({ ...(vnode.props ?? {}) }), type);
  }
  const current = vnode.type === type ? [vnode] : [];
  return [...current, ...collectElementsByType(vnode.props?.children, type)];
}

function visibility(overrides: Partial<FleetMissionVisibilityResponse>): FleetMissionVisibilityResponse {
  return {
    wallet: PLAYER_WALLET,
    homePlanetId: "1",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
    ...overrides,
  };
}

function planetRef(
  planetId: string,
  owner: string,
  name: string | null,
  galaxy: number,
  system: number,
  position: number,
): FleetMissionPlanetReference {
  return {
    planetId,
    owner,
    ownerDisplayName: null,
    name,
    galaxy,
    system,
    position,
    coordinates: `${galaxy}:${system}:${position}`,
  };
}

function planet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: "planet-7",
    name: "New Eos",
    type: "temperate-ocean",
    image: "/assets/game/style-pass/generated/planets/temperate-ocean.webp",
    position: 9,
    galaxy: 2,
    system: 44,
    owner: PLAYER_WALLET,
    ownerId: PLAYER_WALLET,
    alliance: null,
    occupiedBy: null,
    debrisField: null,
    moonChance: null,
    resources: {
      metal: 500,
      crystal: 500,
      deuterium: 0,
      energy: 0,
    },
    temperature: { min: -32, max: 8 },
    diameter: 14_353,
    fields: 206,
    hasMoon: false,
    ...overrides,
  };
}

function mission(input: {
  missionId: string;
  missionType: string;
  status: string;
  owner: string;
  originPlanetId: string;
  targetPlanetId: string;
  arrivalMs: number;
  returnMs?: number;
  originPlanet?: FleetMissionPlanetReference | null;
  targetPlanet?: FleetMissionPlanetReference | null;
  asOfNow?: FleetMissionSummary["asOfNow"];
  needsResolution?: boolean;
}): FleetMissionSummary {
  return {
    missionId: input.missionId,
    status: input.status,
    missionType: input.missionType,
    owner: input.owner,
    originPlanetId: input.originPlanetId,
    targetPlanetId: input.targetPlanetId,
    originPlanet: input.originPlanet ?? null,
    targetPlanet: input.targetPlanet ?? null,
    ...(input.asOfNow === undefined ? {} : { asOfNow: input.asOfNow }),
    ...(input.needsResolution === undefined ? {} : { needsResolution: input.needsResolution }),
    arrivalAt: Math.floor(input.arrivalMs / 1_000).toString(),
    returnAt: Math.floor((input.returnMs ?? input.arrivalMs + 60_000) / 1_000).toString(),
    fuelCost: "100",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: { smallCargo: "1" },
    transactionHash: "0xabc",
    blockNumber: "1",
  };
}
