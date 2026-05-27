import type { Coordinates } from "./types";
import type { MissionShips } from "./galaxyActions";

export const FLEET_RULE_BPS = 10_000;
export const FULL_SPEED_PERCENT = 100;
export const DEFAULT_FLEET_UNIVERSE_SPEED = 1;
export const DEFAULT_MISSION_SPEED_PERCENT = 100;
export const MISSION_SPEED_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10] as const;

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

export function fleetMissionDistance(origin: Coordinates, target: Coordinates): number {
  const galaxyDistance = Math.abs(origin.galaxy - target.galaxy);
  if (galaxyDistance !== 0) return galaxyDistance * 20_000;

  const systemDistance = Math.abs(origin.system - target.system);
  if (systemDistance !== 0) return 2_700 + systemDistance * 95;

  const positionDistance = Math.abs(origin.position - target.position);
  if (positionDistance !== 0) return 1_000 + positionDistance * 5;

  return 0;
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
  const speedMultiplier = speed + FULL_SPEED_PERCENT;
  const consumption = missionShipKeys.reduce((total, key) => {
    const quantity = Math.max(0, Math.trunc(ships?.[key] ?? 0));
    return total + quantity * shipFuelConsumption(key, normalizedDrives);
  }, 0);
  const denominator = 35_000 * FULL_SPEED_PERCENT * FULL_SPEED_PERCENT;
  return 1 + Math.floor(((consumption * normalizedDistance * speedMultiplier * speedMultiplier) + Math.floor(denominator / 2)) / denominator);
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
