import { describe, expect, test } from "bun:test";

import { FleetsSummary, summarizeFleets } from "./components/OverviewPage";
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
      "Attack → 1517 [5:407:4] · arrives in 13m",
      "Transport returning from Outpost [6:12:3] · lands in 5m",
    ]);

    const text = collectText(FleetsSummary({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");

    expect(text).not.toContain("2 active");
    expect(text).toContain("Attack → 1517 [5:407:4] · arrives in 13m");
    expect(text).toContain("Open Mission Control");
    // No per-panel splitting labels on Overview anymore.
    expect(text).not.toContain("Incoming");
    expect(text).not.toContain("Outbound");
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

  test("caps the visible list and offers a Mission Control overflow link", () => {
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
    expect(summary.lines.length).toBe(4);
    expect(summary.hiddenCount).toBe(2);

    const text = collectText(FleetsSummary({
      fleetVisibility: visibility({ outgoing }),
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");
    expect(text).toContain("+2 more — open Mission Control");
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
    expect(summary.lines[0]?.text).toBe("Deploy → Planet #77 · arrives in 1m");
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
