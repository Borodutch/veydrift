import type { FleetMissionVisibilityResponse, OrbitBodyKind } from "./walletFlow";

const OFFENSIVE_MISSION_TYPES = new Set(["Attack", "AcsAttack", "MissileAttack"]);

export type PlanetPickerAttackHighlights = {
  moonParentPlanetIds: ReadonlySet<string>;
  planetIds: ReadonlySet<string>;
  status: "loading" | "ready";
};

export function derivePlanetPickerAttackHighlights({
  account,
  fleetVisibility,
  hydrated,
  planetIds,
}: {
  account: string | null | undefined;
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  hydrated: boolean;
  planetIds: readonly string[];
}): PlanetPickerAttackHighlights {
  const wallet = normalizedWallet(account);
  const visibilityWallet = normalizedWallet(fleetVisibility?.wallet);
  if (!hydrated || !wallet || wallet !== visibilityWallet || !fleetVisibility) {
    return neutralPlanetPickerAttackHighlights();
  }

  const ownedPlanetIds = new Set(planetIds);
  const highlightedPlanets = new Set<string>();
  const highlightedMoons = new Set<string>();
  for (const mission of fleetVisibility.incoming) {
    if (
      mission.status !== "Outbound"
      || !OFFENSIVE_MISSION_TYPES.has(mission.missionType)
      || normalizedWallet(mission.owner) === wallet
      || !ownedPlanetIds.has(mission.targetPlanetId)
    ) {
      continue;
    }

    (mission.targetIsMoon ? highlightedMoons : highlightedPlanets).add(mission.targetPlanetId);
  }

  return {
    moonParentPlanetIds: highlightedMoons,
    planetIds: highlightedPlanets,
    status: "ready",
  };
}

export function planetPickerHasIncomingAttack(
  highlights: PlanetPickerAttackHighlights,
  planetId: string,
  bodyKind: OrbitBodyKind,
): boolean {
  if (highlights.status !== "ready") return false;
  return bodyKind === "moon"
    ? highlights.moonParentPlanetIds.has(planetId)
    : highlights.planetIds.has(planetId);
}

function neutralPlanetPickerAttackHighlights(): PlanetPickerAttackHighlights {
  return {
    moonParentPlanetIds: new Set(),
    planetIds: new Set(),
    status: "loading",
  };
}

function normalizedWallet(wallet: string | null | undefined): string {
  return wallet?.trim().toLowerCase() ?? "";
}
