import type { Planet } from "./types";
import { DEFENSE_HOLD_MISSION_TYPE, type ChainDefenseState, type ChainShipyardState } from "./walletFlow";

export type GalaxyActionKind =
  | "attack"
  | "transport"
  | "deploy"
  | "colonize"
  | "harvest"
  | "acsDefend"
  // VEY-KANEO-440: proactive ACS Defend — station a fleet at an own/ally planet for a chosen hold
  // window. Unlike "acsDefend" (reactive counterplay tied to a hostile mission), this targets a
  // planet and is launched via launchDefenseHold.
  | "defenseHold"
  | "missileAttack";

export type GalaxyMissionKind = Exclude<GalaxyActionKind, "colonize" | "missileAttack">;

export type GalaxyAttackProtectionStatus = {
  allowed: boolean;
  blockedReason: "none" | "bashing_limit" | "score_protection" | "same_alliance";
  blockedReasonLabel: string | null;
  scoreComparison?: {
    attackerScore: string;
    defenderScore: string;
  };
  atWar?: boolean;
  transportAllowed?: boolean;
  transportBlockReason?: "none" | "own_planet" | "same_alliance" | "not_allied";
  transportBlockReasonLabel?: string | null;
};

export type MissionShipKey =
  | "smallCargo"
  | "lightFighter"
  | "recycler"
  | "colonyShip"
  | "largeCargo"
  | "heavyFighter"
  | "cruiser"
  | "battleship"
  | "bomber"
  | "destroyer"
  | "deathstar"
  | "battlecruiser"
  | "reaper"
  | "pathfinder";

export type MissionShips = Record<MissionShipKey, number>;

export type GalaxyAction =
  | {
      enabled: true;
      kind: GalaxyActionKind;
      label: string;
      mode: "mission";
      mission: GalaxyMissionKind;
      ships: MissionShips;
      defaultOriginIsMoon?: boolean | undefined;
      defaultTargetIsMoon?: boolean | undefined;
      reason?: undefined;
    }
  | {
      enabled: true;
      kind: "missileAttack";
      label: string;
      mode: "missile";
      primaryTargetId: number;
      quantity: number;
      reason?: undefined;
    }
  | {
      enabled: true;
      kind: "colonize";
      label: string;
      mode: "colonize";
      ships: MissionShips;
      reason?: undefined;
    }
  | {
      enabled: false;
      kind: GalaxyActionKind;
      label: string;
      mode: "mission" | "colonize" | "missile" | "future";
      reason: string;
      ships?: MissionShips | undefined;
      mission?: GalaxyMissionKind | undefined;
    };

export const emptyMissionShips = (): MissionShips => ({
  smallCargo: 0,
  lightFighter: 0,
  recycler: 0,
  colonyShip: 0,
  largeCargo: 0,
  heavyFighter: 0,
  cruiser: 0,
  battleship: 0,
  bomber: 0,
  destroyer: 0,
  deathstar: 0,
  battlecruiser: 0,
  reaper: 0,
  pathfinder: 0,
});

export function galaxyActionsForSlot({
  account,
  homePlanetId,
  isOrigin = false,
  planet,
  defenseState,
  shipyardState,
  attackProtection,
}: {
  account: string | undefined;
  homePlanetId: string | null | undefined;
  isOrigin?: boolean | undefined;
  planet: Planet | undefined;
  defenseState?: ChainDefenseState | null | undefined;
  shipyardState: ChainShipyardState | null;
  attackProtection?: GalaxyAttackProtectionStatus | null | undefined;
}): GalaxyAction[] {
  const commonBlocker = baseActionBlocker(account, homePlanetId, shipyardState);
  const owner = planet?.occupiedBy?.owner?.toLowerCase() ?? planet?.ownerId?.toLowerCase() ?? null;
  const accountLower = account?.toLowerCase();
  const isOwnTarget = Boolean(owner && accountLower && owner === accountLower);
  const isOccupied = Boolean(owner);
  const isMigrationReserved = Boolean(planet?.migrationReservation);
  // VEY-KANEO-440: a same-alliance member's planet is a valid proactive-defense target. The backend
  // already surfaces this through the attack guard (you cannot attack an ally), so reuse that signal
  // rather than re-deriving alliance membership here.
  const isAllyTarget = attackProtection?.blockedReason === "same_alliance";

  if (!planet) {
    return [];
  }

  if (!isOccupied) {
    if (isMigrationReserved) {
      return [{
        enabled: false,
        kind: "colonize",
        label: "Quantum locked",
        mode: "colonize",
        reason: "This testnet migration planet is quantum-unstable until its commander claims it on mainnet.",
      }];
    }
    return [
      enabledOrDisabled({
        blocker: commonBlocker ?? shipRequirementBlocker(shipyardState, "colonyShip", "Requires a colony ship on your home planet."),
        enabled: {
          enabled: true,
          kind: "colonize",
          label: "Colonize",
          mode: "colonize",
          ships: emptyMissionShips(),
        },
        disabled: {
          kind: "colonize",
          label: "Colonize",
          mode: "colonize",
        },
      }),
    ];
  }

  if (isOwnTarget) {
    const ownHarvest = harvestAction(commonBlocker, planet, shipyardState);
    const eligibleOwnHarvest = ownHarvest.enabled ? [ownHarvest] : [];
    if (isOrigin) {
      // The home/launch planet is where every wallet starts and the slot players inspect first, so the
      // proactive Defend action is surfaced here (disabled) rather than hidden — otherwise a player with
      // a single colony and no alliance sees no Defend affordance anywhere and the feature reads as
      // missing. launchDefenseHold reverts with SamePlanet when origin == target, so the reason explains
      // the prerequisite (a second colony or an alliance member's planet to station the fleet at).
      return [
        ...eligibleOwnHarvest,
        defenseHoldAction(
          commonBlocker,
          shipyardState,
          "You can't station a defending fleet at the planet it launches from. Open another colony or an alliance member's planet to defend it.",
        ),
      ];
    }

    const cargoBlocker = commonBlocker ?? firstAvailableCargoShipBlocker(shipyardState);
    const deployBlocker = commonBlocker ?? firstAvailableDeployShipBlocker(shipyardState);

    return [
      enabledOrDisabled({
        blocker: cargoBlocker,
        enabled: transportAction(),
        disabled: transportDisabledAction(),
      }),
      enabledOrDisabled({
        blocker: deployBlocker,
        enabled: {
          enabled: true,
          kind: "deploy",
          label: "Deploy",
          mode: "mission",
          mission: "deploy",
          ships: emptyMissionShips(),
        },
        disabled: {
          kind: "deploy",
          label: "Deploy",
          mode: "mission",
          mission: "deploy",
        },
      }),
      ...eligibleOwnHarvest,
      defenseHoldAction(commonBlocker, shipyardState),
    ];
  }

  const attackBlocker = commonBlocker ?? attackProtectionBlocker(attackProtection) ?? firstAvailableFleetShipBlocker(shipyardState);
  const missileBlocker = commonBlocker ?? interplanetaryMissileBlocker(defenseState);

  return [
    ...(isAllyTarget ? [defenseHoldAction(commonBlocker, shipyardState)] : []),
    enabledOrDisabled({
      blocker: attackBlocker,
      enabled: {
        enabled: true,
        kind: "attack",
        label: "Attack",
        mode: "mission",
        mission: "attack",
        ships: emptyMissionShips(),
      },
      disabled: {
        kind: "attack",
        label: "Attack",
        mode: "mission",
        mission: "attack",
      },
    }),
    harvestAction(commonBlocker, planet, shipyardState),
    {
      ...enabledOrDisabled({
        blocker: missileBlocker,
        enabled: {
          enabled: true,
          kind: "missileAttack",
          label: "Missile",
          mode: "missile",
          primaryTargetId: 0,
          quantity: 1,
        },
        disabled: {
          kind: "missileAttack",
          label: "Missile",
          mode: "missile",
        },
      }),
    },
  ];
}

function harvestAction(
  commonBlocker: string | undefined,
  planet: Planet,
  shipyardState: ChainShipyardState | null,
): GalaxyAction {
  return enabledOrDisabled({
    blocker: commonBlocker
      ?? debrisFieldBlocker(planet)
      ?? shipRequirementBlocker(shipyardState, "recycler", "Requires a recycler on your home planet."),
    enabled: {
      enabled: true,
      kind: "harvest",
      label: "Harvest",
      mode: "mission",
      mission: "harvest",
      ships: emptyMissionShips(),
    },
    disabled: {
      kind: "harvest",
      label: "Harvest",
      mode: "mission",
      mission: "harvest",
    },
  });
}

function transportAction(): Extract<GalaxyAction, { enabled: true }> {
  return {
    enabled: true,
    kind: "transport",
    label: "Transport",
    mode: "mission",
    mission: "transport",
    ships: emptyMissionShips(),
  };
}

function transportDisabledAction(): Omit<Extract<GalaxyAction, { enabled: false }>, "enabled" | "reason"> {
  return {
    kind: "transport",
    label: "Transport",
    mode: "mission",
    mission: "transport",
  };
}

export function missionTypeId(mission: GalaxyMissionKind): number {
  switch (mission) {
    case "transport":
      return 0;
    case "deploy":
      return 1;
    case "attack":
      return 3;
    case "harvest":
      return 4;
    case "acsDefend":
      return 5;
    case "defenseHold":
      // Indexed FleetMissionType for a DefenseHold mission. Proactive defense launches via
      // launchDefenseHold (a type-specific selector), so this value is not passed to a
      // launchFleetMission call — it keeps the mapping exhaustive and aligned with the chain enum.
      return DEFENSE_HOLD_MISSION_TYPE;
  }
}

// VEY-KANEO-440: proactive "Defend" action — station a fleet at an own/ally planet. Enabled once the
// active planet has a movable ship; the planet-eligibility check (own/ally) is enforced by the call
// sites that emit this action and re-validated on-chain by launchDefenseHold. A call site may pass an
// `eligibilityBlocker` to surface the action in a disabled+explained state (e.g. on the launch planet
// itself, where launchDefenseHold reverts with SamePlanet) so the feature stays discoverable and the
// "explain when not coordinatable" acceptance criterion is met instead of the action silently vanishing.
function defenseHoldAction(
  commonBlocker: string | undefined,
  shipyardState: ChainShipyardState | null,
  eligibilityBlocker?: string
): GalaxyAction {
  return enabledOrDisabled({
    blocker: eligibilityBlocker ?? commonBlocker ?? firstAvailableFleetShipBlocker(shipyardState),
    enabled: {
      enabled: true,
      kind: "defenseHold",
      label: "Defend",
      mode: "mission",
      mission: "defenseHold",
      ships: emptyMissionShips(),
    },
    disabled: {
      kind: "defenseHold",
      label: "Defend",
      mode: "mission",
      mission: "defenseHold",
    },
  });
}

function enabledOrDisabled<T extends Extract<GalaxyAction, { enabled: true }>>({
  blocker,
  enabled,
  disabled,
}: {
  blocker: string | undefined;
  enabled: T;
  disabled: Omit<Extract<GalaxyAction, { enabled: false }>, "enabled" | "reason">;
}): GalaxyAction {
  if (!blocker) return enabled;

  return {
    ...disabled,
    enabled: false,
    reason: blocker,
  };
}

function baseActionBlocker(
  account: string | undefined,
  homePlanetId: string | null | undefined,
  shipyardState: ChainShipyardState | null
): string | undefined {
  if (!account) return "Connect a wallet to launch contract missions.";
  if (!homePlanetId) return "No home planet is loaded for this wallet.";
  if (!shipyardState) return "Shipyard state is still loading.";
  if (shipyardState.productionAvailable === false) {
    return shipyardState.unavailableReason ?? "Fleet actions are unavailable on this deployment.";
  }
  if (shipyardState.fleetLaunchAvailable === false) {
    return shipyardState.fleetLaunchUnavailableReason ?? shipyardState.unavailableReason ?? "Fleet slot state is still syncing.";
  }
  return undefined;
}

function shipRequirementBlocker(
  shipyardState: ChainShipyardState | null,
  shipKey: MissionShipKey,
  message: string
): string | undefined {
  return shipCount(shipyardState, shipKey) > 0 ? undefined : message;
}

function firstAvailableCargoShipBlocker(shipyardState: ChainShipyardState | null): string | undefined {
  return firstAvailableCargoShip(shipyardState) ? undefined : "Requires a cargo-capable ship on your home planet.";
}

function firstAvailableFleetShipBlocker(shipyardState: ChainShipyardState | null): string | undefined {
  return firstAvailableFleetShip(shipyardState) ? undefined : "Requires at least one movable ship on your home planet.";
}

function firstAvailableDeployShipBlocker(shipyardState: ChainShipyardState | null): string | undefined {
  return firstAvailableDeployShip(shipyardState) ? undefined : "Requires at least one movable ship on the active origin.";
}

function interplanetaryMissileBlocker(defenseState: ChainDefenseState | null | undefined): string | undefined {
  if (!defenseState) return "Defense state is still loading.";
  if (defenseState.productionAvailable === false) {
    return defenseState.unavailableReason ?? "Missile actions are unavailable on this deployment.";
  }

  const interplanetaryMissiles = defenseState.defenses.find((defense) => defense.id === 9)?.count ?? 0;
  return interplanetaryMissiles > 0 ? undefined : "Requires an interplanetary missile on your active planet.";
}

function debrisFieldBlocker(planet: Planet | undefined): string | undefined {
  const debris = planet?.debrisField;
  if (!debris || debris.metal + debris.crystal <= 0) {
    return "No debris field at this coordinate.";
  }
  return undefined;
}

function attackProtectionBlocker(status: GalaxyAttackProtectionStatus | null | undefined): string | undefined {
  if (!status || status.allowed || status.blockedReason === "none") return undefined;
  if (status.blockedReasonLabel) return status.blockedReasonLabel;
  if (status.blockedReason === "bashing_limit") return "Attack blocked by bashing limit.";
  if (status.blockedReason === "score_protection") return "Attack blocked by newbie or score-ratio protection.";
  if (status.blockedReason === "same_alliance") return "Attack blocked: target belongs to your alliance.";
  return "Attack blocked.";
}

function firstAvailableCargoShip(shipyardState: ChainShipyardState | null): MissionShipKey | undefined {
  const candidates: MissionShipKey[] = ["smallCargo", "largeCargo", "pathfinder", "recycler", "colonyShip"];
  return candidates.find((ship) => shipCount(shipyardState, ship) > 0);
}

function firstAvailableFleetShip(shipyardState: ChainShipyardState | null): MissionShipKey | undefined {
  const candidates: MissionShipKey[] = [
    "lightFighter",
    "heavyFighter",
    "cruiser",
    "battleship",
    "battlecruiser",
    "bomber",
    "destroyer",
    "deathstar",
    "reaper",
    "pathfinder",
    "smallCargo",
    "largeCargo",
    "recycler",
  ];
  return candidates.find((ship) => shipCount(shipyardState, ship) > 0);
}

function firstAvailableDeployShip(shipyardState: ChainShipyardState | null): MissionShipKey | undefined {
  return firstAvailableFleetShip(shipyardState) ?? firstAvailableCargoShip(shipyardState);
}

function shipCount(shipyardState: ChainShipyardState | null, shipKey: MissionShipKey): number {
  if (!shipyardState) return 0;
  const ship = shipyardState.ships.find((item) => item.id === shipContractIds[shipKey]);
  return ship?.count ?? 0;
}

const shipContractIds: Record<MissionShipKey, number> = {
  smallCargo: 0,
  lightFighter: 1,
  recycler: 2,
  colonyShip: 3,
  largeCargo: 4,
  heavyFighter: 5,
  cruiser: 6,
  battleship: 7,
  bomber: 8,
  destroyer: 10,
  deathstar: 11,
  battlecruiser: 12,
  reaper: 13,
  pathfinder: 14,
};
