import { describe, expect, test } from "bun:test";

import { FleetsSummary, overviewPlanetDisplayName, summarizeFleets } from "./components/OverviewPage";
import type { Planet } from "./types";
import type { FleetMissionPlanetReference, FleetMissionSummary, FleetMissionVisibilityResponse } from "./walletFlow";

const PLAYER_WALLET = "0x1111111111111111111111111111111111111111";
const ENEMY_WALLET = "0x2222222222222222222222222222222222222222";

describe("Overview fleets summary", () => {
  test("summarizes active counts and a one-line description per mission (type + direction + ETA)", () => {
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
    expect(summary.underAttack).toBeNull();
    expect(summary.lines.map((line) => line.text)).toEqual([
      "Outbound · Attack to 1517 [5:407:4] · Outbound · arrives in 13m",
      "Returning · Transport from Outpost [6:12:3] · Returning · lands in 5m",
    ]);

    const text = collectText(FleetsSummary({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");

    expect(text).not.toContain("2 active");
    expect(text).toContain("Outbound · Attack to 1517 [5:407:4] · Outbound · arrives in 13m");
    expect(text).toContain("Open Mission Control");
    // Rows carry their direction inline instead of splitting the compact panel into sub-panels.
    expect(text).not.toContain("Joinable");
    // No raw "1 -> 40" id rendering.
    expect(text).not.toContain("1 -> 40");
  });

  test("raises a prominent under-attack alert for hostile inbound attacks with the soonest ETA", () => {
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
    expect(summary.underAttack).toEqual({ count: 2, soonestLabel: "in 3m" });

    const text = collectText(FleetsSummary({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");

    expect(text).toContain("Under attack");
    expect(text).toContain("2 hostile fleets inbound");
    expect(text).toContain("soonest in 3m");
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
      "Hostile inbound · Attack from Raider [5:407:4] · Outbound · arrives in 8m",
      "Friendly inbound · Transport from Ally [5:407:9] · Outbound · arrives in 6m",
      "Self inbound · Deploy from Colony [5:408:2] · Outbound · arrives in 4m",
    ]);
    expect(summary.lines.map((line) => line.relation)).toEqual(["hostile", "friendly", "self"]);

    const node = FleetsSummary({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
    });
    const rows = collectElementsByType(node, "li");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.props?.className)).toEqual([
      expect.stringContaining("break-words"),
      expect.stringContaining("break-words"),
      expect.stringContaining("break-words"),
    ]);
  });

  test("shows all active fleet rows without a Mission Control overflow truncation", () => {
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

    const text = collectText(FleetsSummary({
      fleetVisibility: visibility({ outgoing }),
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");
    expect(text).toContain("Outbound · Transport to T0 [1:1:0] · Outbound · arrives in 1m");
    expect(text).toContain("Outbound · Transport to T5 [1:1:5] · Outbound · arrives in 6m");
    expect(text).toContain("Open Mission Control");
    expect(text).not.toContain("+2 more");
    expect(text).not.toContain("open Mission Control");
  });

  test("does not render the redundant active-count header pill", () => {
    const node = FleetsSummary({
      fleetVisibility: visibility({}),
      now: Date.parse("2026-06-07T22:00:00.000Z"),
      onOpenMissionControl: () => undefined,
    });
    const heading = collectElementsByType(node, "h2").find((element) => collectText(element).join(" ") === "Fleets");
    const activeBadge = collectElementsByType(node, "span").find((element) => /active$/.test(collectText(element).join(" ")));

    expect(heading?.props?.className).toContain("inline-flex h-5");
    expect(heading?.props?.className).toContain("items-center");
    expect(heading?.props?.className).toContain("leading-none");
    expect(activeBadge).toBeUndefined();
  });

  test("renders the selected-planet empty state in the responsive fleets panel", () => {
    const node = FleetsSummary({
      fleetVisibility: visibility({}),
      now: Date.parse("2026-06-07T22:00:00.000Z"),
      onOpenMissionControl: () => undefined,
    });
    const section = collectElementsByType(node, "section")[0];
    const text = collectText(node).join(" ");

    expect(text).toContain("No active fleets for this planet.");
    expect(section?.props?.className).toContain("min-w-0");
    expect(section?.props?.className).toContain("sm:p-4");
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
    expect(summary.lines[0]?.text).toBe("Outbound · Deploy to Planet #77 · Outbound · arrives in 1m");
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
          targetPlanet: planetRef("23", PLAYER_WALLET, "Bastion", 7, 14, 2),
        }),
      ],
    }), now);

    expect(summary.lines[0]?.text).toBe("Outbound · Stationed defense to Bastion [7:14:2] · Stationed · holding for 45m");
    expect(summary.lines[0]?.text).not.toContain("resolving");
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

function collectElementsByType(node: unknown, type: string): Array<{ props?: { children?: unknown; className?: string }; type?: unknown }> {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElementsByType(child, type));

  const vnode = node as { type?: unknown; props?: { children?: unknown; className?: string } };
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
