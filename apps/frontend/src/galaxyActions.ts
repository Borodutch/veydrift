import type { Planet } from "./types";
import type { ChainDefenseState, ChainShipyardState } from "./walletFlow";

export type GalaxyActionKind =
  | "attack"
  | "transport"
  | "deploy"
  | "colonize"
  | "harvest"
  | "acsDefend"
  | "missileAttack";

export type GalaxyMissionKind = Exclude<GalaxyActionKind, "colonize" | "missileAttack">;

export type GalaxyAttackProtectionStatus = {
  allowed: boolean;
  blockedReason: "none" | "bashing_limit" | "score_protection" | "same_alliance";
  blockedReasonLabel: string | null;
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

  if (!isOccupied) {
    return [
      enabledOrDisabled({
        blocker: commonBlocker ?? shipRequirementBlocker(shipyardState, "colonyShip", "Requires a colony ship on your home planet."),
        enabled: {
          enabled: true,
          kind: "colonize",
          label: "Colonize",
          mode: "colonize",
          ships: singleShip("colonyShip"),
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
    if (isOrigin) {
      return [];
    }

    const cargoBlocker = commonBlocker ?? firstAvailableCargoShipBlocker(shipyardState);
    const cargoShips = firstAvailableCargoShips(shipyardState);

    return [
      enabledOrDisabled({
        blocker: cargoBlocker,
        enabled: {
          enabled: true,
          kind: "transport",
          label: "Transport",
          mode: "mission",
          mission: "transport",
          ships: cargoShips,
        },
        disabled: {
          kind: "transport",
          label: "Transport",
          mode: "mission",
          mission: "transport",
        },
      }),
      enabledOrDisabled({
        blocker: cargoBlocker,
        enabled: {
          enabled: true,
          kind: "deploy",
          label: "Deploy",
          mode: "mission",
          mission: "deploy",
          ships: cargoShips,
        },
        disabled: {
          kind: "deploy",
          label: "Deploy",
          mode: "mission",
          mission: "deploy",
        },
      }),
    ];
  }

  const attackBlocker = commonBlocker ?? attackProtectionBlocker(attackProtection) ?? firstAvailableFleetShipBlocker(shipyardState);
  const missileBlocker = commonBlocker ?? interplanetaryMissileBlocker(defenseState);

  return [
    enabledOrDisabled({
      blocker: attackBlocker,
      enabled: {
        enabled: true,
        kind: "attack",
        label: "Attack",
        mode: "mission",
        mission: "attack",
        ships: firstAvailableFleetShips(shipyardState),
      },
      disabled: {
        kind: "attack",
        label: "Attack",
        mode: "mission",
        mission: "attack",
      },
    }),
    enabledOrDisabled({
      blocker: commonBlocker ?? debrisFieldBlocker(planet) ?? shipRequirementBlocker(shipyardState, "recycler", "Requires a recycler on your home planet."),
      enabled: {
        enabled: true,
        kind: "harvest",
        label: "Harvest",
        mode: "mission",
        mission: "harvest",
        ships: singleShip("recycler"),
      },
      disabled: {
        kind: "harvest",
        label: "Harvest",
        mode: "mission",
        mission: "harvest",
      },
    }),
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
  }
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

function firstAvailableCargoShips(shipyardState: ChainShipyardState | null): MissionShips {
  const ship = firstAvailableCargoShip(shipyardState);
  return ship ? singleShip(ship) : emptyMissionShips();
}

function firstAvailableFleetShips(shipyardState: ChainShipyardState | null): MissionShips {
  const ship = firstAvailableFleetShip(shipyardState);
  return ship ? singleShip(ship) : emptyMissionShips();
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

function singleShip(ship: MissionShipKey): MissionShips {
  return {
    ...emptyMissionShips(),
    [ship]: 1,
  };
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
