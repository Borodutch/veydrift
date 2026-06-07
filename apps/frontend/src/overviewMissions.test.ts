import { describe, expect, test } from "bun:test";

import { FleetMissionsSection } from "./components/OverviewPage";
import type { FleetMissionPlanetReference, FleetMissionSummary, FleetMissionVisibilityResponse } from "./walletFlow";

const PLAYER_WALLET = "0x1111111111111111111111111111111111111111";
const ENEMY_WALLET = "0x2222222222222222222222222222222222222222";

describe("Overview fleet mission cards", () => {
  test("renders origin/target names + coordinates instead of raw planet ids, with a Mission Control link", () => {
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
          originPlanet: planetRef("1", PLAYER_WALLET, "New Zion", 6, 9, 1, "Nikita"),
          targetPlanet: planetRef("40", ENEMY_WALLET, "1517", 5, 407, 4, "Rival"),
        }),
      ],
    });

    const text = collectText(FleetMissionsSection({
      fleetVisibility,
      now,
      onCounterplay: () => undefined,
      onJoinAttack: () => undefined,
      onOpenMissionControl: () => undefined,
      onRecall: () => undefined,
      onResolveMission: () => undefined,
    })).join(" ");

    // Clear origin -> target with names + coordinates (not bare ids).
    expect(text).toContain("New Zion [6:9:1]");
    expect(text).toContain("1517 [5:407:4]");
    // The old "1 -> 40" raw-id rendering must be gone.
    expect(text).not.toContain("1 -> 40");
    // "You" marks the player's own planet (origin here).
    expect(text).toContain("You");
    // Concise timing line for outbound.
    expect(text).toContain("Arrival in 13m");
    // Mission Control entry point present.
    expect(text).toContain("Open Mission Control");
  });

  test("surfaces Recall fleet for an own outbound mission that has not arrived", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const fleetVisibility = visibility({
      outgoing: [
        mission({
          missionId: "2",
          missionType: "Attack",
          status: "Outbound",
          owner: PLAYER_WALLET,
          originPlanetId: "1",
          targetPlanetId: "40",
          arrivalMs: now + 5 * 60_000,
          recallCost: "25",
          originPlanet: planetRef("1", PLAYER_WALLET, "New Zion", 6, 9, 1, "Nikita"),
          targetPlanet: planetRef("40", ENEMY_WALLET, "1517", 5, 407, 4, "Rival"),
        }),
      ],
    });

    const text = collectText(FleetMissionsSection({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
      onRecall: () => undefined,
    })).join(" ");

    expect(text).toContain("Recall fleet");
  });

  test("falls back to a coordinate-free planet id when the planet reference is missing", () => {
    const now = Date.parse("2026-06-07T22:00:00.000Z");
    const fleetVisibility = visibility({
      returning: [
        mission({
          missionId: "3",
          missionType: "Transport",
          status: "Returning",
          owner: PLAYER_WALLET,
          originPlanetId: "7",
          targetPlanetId: "12",
          arrivalMs: now - 60_000,
          returnMs: now + 4 * 60_000,
          originPlanet: null,
          targetPlanet: null,
        }),
      ],
    });

    const text = collectText(FleetMissionsSection({
      fleetVisibility,
      now,
      onOpenMissionControl: () => undefined,
    })).join(" ");

    expect(text).toContain("Planet #7");
    expect(text).toContain("Planet #12");
    expect(text).toContain("Returns in 4m");
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

function visibility(overrides: Partial<FleetMissionVisibilityResponse>): FleetMissionVisibilityResponse {
  return {
    wallet: PLAYER_WALLET,
    homePlanetId: "1",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
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
  ownerDisplayName?: string | null,
): FleetMissionPlanetReference {
  return {
    planetId,
    owner,
    ownerDisplayName: ownerDisplayName ?? null,
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
  recallCost?: string | null;
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
    recallCost: input.recallCost ?? null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: { smallCargo: "1" },
    transactionHash: "0xabc",
    blockNumber: "1",
  };
}
