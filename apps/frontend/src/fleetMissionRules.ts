import type { Coordinates } from "./types";
import type { GalaxyMissionKind, MissionShips } from "./galaxyActions";

export const FLEET_RULE_BPS = 10_000;
export const FULL_SPEED_PERCENT = 100;
export const DEFAULT_FLEET_UNIVERSE_SPEED = 1;
export const DEFAULT_MISSION_SPEED_PERCENT = 100;
// Mirrors VeydriftGameStorage.LOCAL_HARVEST_DISTANCE. Same-planet recyclers still fly a priced,
// non-zero local route instead of receiving a free zero-duration mission.
export const LOCAL_HARVEST_DISTANCE = 5;
export const MISSION_SPEED_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10] as const;

// Exact VeydriftPlanetManagementModule._interplanetaryMissileRange math. Interplanetary
// missiles are immediate contract actions (not fleet missions): same galaxy only, with a
// system-range of Impulse Drive × 5 − 1. Level zero has no range.
export function interplanetaryMissileRange(impulseDrive: number | undefined): number {
  const level = Math.max(0, Math.trunc(impulseDrive ?? 0));
  return level === 0 ? 0 : level * 5 - 1;
}

export function interplanetaryMissileSystemDistance(origin: Coordinates, target: Coordinates): number | null {
  if (origin.galaxy !== target.galaxy) return null;
  return Math.abs(origin.system - target.system);
}

// VEY-KANEO-440: an ACS Defend fleet "holds" at the defended planet from its natural arrival until
// the hostile attack lands, burning holding fuel proportional to the hold time. These mirror the
// on-chain math in VeydriftAllianceSystem._acsHoldingFuelCost / counterplayDefenseFuelContext so the
// compose UX can preview the deuterium cost and Alliance Depot support before the player commits.
export const ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL = 20_000;
const ACS_HOLDING_FUEL_WINDOW_SECONDS = 36_000; // 10 hours, the contract's per-tenth amortization window
const ACS_HOLDING_FUEL_TENTHS_PER_HOUR: Record<(typeof missionShipKeys)[number], number> = {
  smallCargo: 50,
  lightFighter: 20,
  recycler: 300,
  colonyShip: 1_000,
  largeCargo: 50,
  heavyFighter: 75,
  cruiser: 300,
  battleship: 500,
  bomber: 1_000,
  destroyer: 1_000,
  deathstar: 1,
  battlecruiser: 250,
  reaper: 1_000,
  pathfinder: 300,
};

const missionShipKeys = [
  "smallCargo",
  "lightFighter",
  "recycler",
  "colonyShip",
  "largeCargo",
  "heavyFighter",
  "cruiser",
  "battleship",
  "bomber",
  "destroyer",
  "deathstar",
  "battlecruiser",
  "reaper",
  "pathfinder",
] as const satisfies readonly (keyof MissionShips)[];

export type FleetDriveLevels = {
  combustionDrive?: number;
  impulseDrive?: number;
  hyperspaceDrive?: number;
};

type ShipStats = {
  cargo: number;
  fuel: number;
  speed: (drives: Required<FleetDriveLevels>) => number;
};

const shipStats: Record<(typeof missionShipKeys)[number], ShipStats> = {
  smallCargo: {
    cargo: 5_000,
    fuel: 10,
    speed: (drives) => drives.impulseDrive >= 5
      ? driveSpeed(10_000, drives.impulseDrive, 20)
      : driveSpeed(5_000, drives.combustionDrive, 10),
  },
  lightFighter: {
    cargo: 50,
    fuel: 20,
    speed: (drives) => driveSpeed(12_500, drives.combustionDrive, 10),
  },
  recycler: {
    cargo: 20_000,
    fuel: 300,
    speed: (drives) => driveSpeed(2_000, drives.combustionDrive, 10),
  },
  colonyShip: {
    cargo: 7_500,
    fuel: 1_000,
    speed: (drives) => driveSpeed(2_500, drives.impulseDrive, 20),
  },
  largeCargo: {
    cargo: 25_000,
    fuel: 50,
    speed: (drives) => driveSpeed(7_500, drives.combustionDrive, 10),
  },
  heavyFighter: {
    cargo: 100,
    fuel: 75,
    speed: (drives) => driveSpeed(10_000, drives.impulseDrive, 20),
  },
  cruiser: {
    cargo: 800,
    fuel: 300,
    speed: (drives) => driveSpeed(15_000, drives.impulseDrive, 20),
  },
  battleship: {
    cargo: 1_500,
    fuel: 500,
    speed: (drives) => driveSpeed(10_000, drives.hyperspaceDrive, 30),
  },
  bomber: {
    cargo: 500,
    fuel: 1_000,
    speed: (drives) => drives.hyperspaceDrive >= 8
      ? driveSpeed(5_000, drives.hyperspaceDrive, 30)
      : driveSpeed(4_000, drives.impulseDrive, 20),
  },
  destroyer: {
    cargo: 2_000,
    fuel: 1_000,
    speed: (drives) => driveSpeed(5_000, drives.hyperspaceDrive, 30),
  },
  deathstar: {
    cargo: 1_000_000,
    fuel: 1,
    speed: (drives) => driveSpeed(100, drives.hyperspaceDrive, 30),
  },
  battlecruiser: {
    cargo: 750,
    fuel: 250,
    speed: (drives) => driveSpeed(10_000, drives.hyperspaceDrive, 30),
  },
  reaper: {
    cargo: 7_000,
    fuel: 1_000,
    speed: (drives) => driveSpeed(7_000, drives.hyperspaceDrive, 30),
  },
  pathfinder: {
    cargo: 12_000,
    fuel: 300,
    speed: (drives) => driveSpeed(12_000, drives.hyperspaceDrive, 30),
  },
};

export type FleetMissionBodyDistanceOptions = {
  originIsMoon?: boolean | undefined;
  targetIsMoon?: boolean | undefined;
};

export function fleetMissionDistance(
  origin: Coordinates,
  target: Coordinates,
  body: FleetMissionBodyDistanceOptions = {},
): number {
  const galaxyDistance = Math.abs(origin.galaxy - target.galaxy);
  if (galaxyDistance !== 0) return galaxyDistance * 20_000;

  const systemDistance = Math.abs(origin.system - target.system);
  if (systemDistance !== 0) return 2_700 + systemDistance * 95;

  const positionDistance = Math.abs(origin.position - target.position);
  if (positionDistance !== 0) return 1_000 + positionDistance * 5;

  if (Boolean(body.originIsMoon) !== Boolean(body.targetIsMoon)) return 5;

  return 0;
}

export function fleetMissionDistanceForMission(
  origin: Coordinates,
  target: Coordinates,
  mission: GalaxyMissionKind | "Harvest",
  body: FleetMissionBodyDistanceOptions = {},
): number {
  const distance = fleetMissionDistance(origin, target, body);
  return distance === 0 && (mission === "harvest" || mission === "Harvest")
    ? LOCAL_HARVEST_DISTANCE
    : distance;
}

export function fleetMissionTravelSeconds(
  distance: number,
  ships: Partial<MissionShips> | undefined,
  drives: FleetDriveLevels = {},
  speedPercent = DEFAULT_MISSION_SPEED_PERCENT,
  universeSpeed = DEFAULT_FLEET_UNIVERSE_SPEED,
): number {
  const slowestSpeed = fleetMissionSlowestSpeed(ships, drives);
  if (slowestSpeed <= 0) return 0;
  const normalizedDistance = Math.max(0, Math.trunc(distance));
  const speed = normalizeMissionSpeedPercent(speedPercent);
  const speedFactor = Math.max(1, Math.trunc(universeSpeed));
  const variableSeconds = Math.floor(350 * Math.sqrt((normalizedDistance * 10) / slowestSpeed));
  return 10 + Math.floor((variableSeconds * FULL_SPEED_PERCENT) / (speed * speedFactor));
}

export function fleetMissionFuelCost(
  ships: Partial<MissionShips> | undefined,
  distance: number,
  drives: FleetDriveLevels = {},
  speedPercent = DEFAULT_MISSION_SPEED_PERCENT,
): number {
  if (fleetMissionShipCount(ships) === 0) return 0;
  const normalizedDistance = Math.max(0, Math.trunc(distance));
  const normalizedDrives = normalizeDriveLevels(drives);
  const speed = normalizeMissionSpeedPercent(speedPercent);
  const slowestSpeed = fleetMissionSlowestSpeed(ships, normalizedDrives);
  if (slowestSpeed <= 0) return 0;
  const consumption = missionShipKeys.reduce((total, key) => {
    const quantity = Math.max(0, Math.trunc(ships?.[key] ?? 0));
    if (quantity === 0) return total;
    const shipFuel = shipFuelConsumption(key, normalizedDrives);
    if (shipFuel === 0) return total;
    const shipSpeed = shipStats[key].speed(normalizedDrives);
    if (shipSpeed <= 0) return total;
    const effectiveSpeed = speed * Math.sqrt(slowestSpeed / shipSpeed);
    const speedMultiplier = 1 + effectiveSpeed / FULL_SPEED_PERCENT;
    return total + quantity * shipFuel * normalizedDistance * speedMultiplier * speedMultiplier;
  }, 0);
  if (consumption <= 0) return 0;
  return 1 + Math.floor((consumption / 35_000) + 0.5);
}

export function fleetMissionCargoCapacity(ships: Partial<MissionShips> | undefined): number {
  if (!ships) return 0;
  return missionShipKeys.reduce((total, key) => {
    const quantity = Math.max(0, Math.trunc(ships[key] ?? 0));
    return total + quantity * shipStats[key].cargo;
  }, 0);
}

export function fleetMissionAvailableCargoCapacity(
  ships: Partial<MissionShips> | undefined,
  distance: number,
  drives: FleetDriveLevels = {},
  speedPercent = DEFAULT_MISSION_SPEED_PERCENT,
): number {
  return Math.max(0, fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, drives, speedPercent));
}

export function fleetMissionShipCount(ships: Partial<MissionShips> | undefined): number {
  if (!ships) return 0;
  return missionShipKeys.reduce((total, key) => total + Math.max(0, Math.trunc(ships[key] ?? 0)), 0);
}

function fleetMissionSlowestSpeed(
  ships: Partial<MissionShips> | undefined,
  driveLevels: FleetDriveLevels,
): number {
  const drives = normalizeDriveLevels(driveLevels);
  return missionShipKeys.reduce((slowest, key) => {
    const quantity = Math.max(0, Math.trunc(ships?.[key] ?? 0));
    if (quantity === 0) return slowest;
    const speed = shipStats[key].speed(drives);
    return slowest === 0 || speed < slowest ? speed : slowest;
  }, 0);
}

function normalizeDriveLevels(drives: FleetDriveLevels): Required<FleetDriveLevels> {
  return {
    combustionDrive: Math.max(0, Math.trunc(drives.combustionDrive ?? 0)),
    impulseDrive: Math.max(0, Math.trunc(drives.impulseDrive ?? 0)),
    hyperspaceDrive: Math.max(0, Math.trunc(drives.hyperspaceDrive ?? 0)),
  };
}

function normalizeMissionSpeedPercent(speedPercent: number): number {
  const speed = Math.trunc(speedPercent);
  return MISSION_SPEED_OPTIONS.includes(speed as (typeof MISSION_SPEED_OPTIONS)[number])
    ? speed
    : DEFAULT_MISSION_SPEED_PERCENT;
}

function shipFuelConsumption(
  ship: (typeof missionShipKeys)[number],
  drives: Required<FleetDriveLevels>,
): number {
  if (ship === "smallCargo" && drives.impulseDrive >= 5) return 20;
  return shipStats[ship].fuel;
}

function driveSpeed(baseSpeed: number, driveLevel: number, bpsPerLevel: number): number {
  return Math.floor((baseSpeed * (100 + driveLevel * bpsPerLevel)) / 100);
}

// Gross holding-fuel deuterium an ACS Defend fleet burns while holding for `holdSeconds`, before any
// Alliance Depot support. Mirrors VeydriftAllianceSystem._acsHoldingFuelCost (ceil division by the
// 10-hour window).
export function acsHoldingFuelCost(
  ships: Partial<MissionShips> | undefined,
  holdSeconds: number,
): number {
  const seconds = Math.max(0, Math.trunc(holdSeconds));
  if (seconds === 0) return 0;
  const tenthsPerHour = acsHoldingFuelTenthsPerHour(ships);
  if (tenthsPerHour === 0) return 0;
  return Math.ceil((tenthsPerHour * seconds) / ACS_HOLDING_FUEL_WINDOW_SECONDS);
}

function acsHoldingFuelTenthsPerHour(ships: Partial<MissionShips> | undefined): number {
  return missionShipKeys.reduce((total, key) => {
    const quantity = Math.max(0, Math.trunc(ships?.[key] ?? 0));
    return total + quantity * ACS_HOLDING_FUEL_TENTHS_PER_HOUR[key];
  }, 0);
}

// VEY-KANEO-456: the deuterium-per-hour upkeep an ACS Defend fleet burns while holding — the same fuel
// the Alliance Depot subsidizes, expressed as a rate for the Stationed defenses panel. Equals the
// holding fuel for one hour, so it stays consistent with acsHoldingFuelCost / the on-chain ceil window.
export function acsHoldingFuelRatePerHour(ships: Partial<MissionShips> | undefined): number {
  return acsHoldingFuelCost(ships, 3_600);
}

// VEY-KANEO-456: how many seconds the defended planet's Alliance Depot (level * 20_000 deuterium) can
// fully cover this fleet's holding fuel — the inverse of acsHoldingFuelCost's ceil window. Returns
// Infinity when the fleet burns no holding fuel (depot is never the constraint). Used to show "depot
// sustains for N" / "covers the full hold" as-of-now, with no chain read.
export function allianceDepotSustainSeconds(
  ships: Partial<MissionShips> | undefined,
  depotLevel: number,
): number {
  const tenthsPerHour = acsHoldingFuelTenthsPerHour(ships);
  if (tenthsPerHour === 0) return Number.POSITIVE_INFINITY;
  const capacity = Math.max(0, Math.trunc(depotLevel)) * ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL;
  return Math.floor((capacity * ACS_HOLDING_FUEL_WINDOW_SECONDS) / tenthsPerHour);
}

export type AcsDefendFuelBreakdown = {
  holdSeconds: number;
  holdingFuel: number;
  depotSupport: number;
  netHoldingFuel: number;
};

// Full ACS Defend holding-fuel breakdown including Alliance Depot support drawn from the defended
// planet. Mirrors VeydriftAllianceSystem.counterplayDefenseFuelContext: depot covers up to
// level * 20_000 deuterium of the holding fuel; the remainder is paid by the defending fleet.
export function acsDefendHoldingFuel(
  ships: Partial<MissionShips> | undefined,
  holdSeconds: number,
  depotLevel = 0,
): AcsDefendFuelBreakdown {
  const seconds = Math.max(0, Math.trunc(holdSeconds));
  const holdingFuel = acsHoldingFuelCost(ships, seconds);
  const supportCapacity = Math.max(0, Math.trunc(depotLevel)) * ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL;
  const depotSupport = Math.min(holdingFuel, supportCapacity);
  return {
    holdSeconds: seconds,
    holdingFuel,
    depotSupport,
    netHoldingFuel: holdingFuel - depotSupport,
  };
}
