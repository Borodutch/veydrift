import type { Coordinates } from "./types";
import type { MissionShips } from "./galaxyActions";

export const FLEET_RULE_BPS = 10_000;
export const MIN_FLEET_TRAVEL_SECONDS = 300;

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

export function fleetMissionDistance(origin: Coordinates, target: Coordinates): number {
  return Math.abs(origin.galaxy - target.galaxy) * 499 * 15
    + Math.abs(origin.system - target.system) * 15
    + Math.abs(origin.position - target.position);
}

export function fleetMissionTravelSeconds(distance: number): number {
  return MIN_FLEET_TRAVEL_SECONDS + Math.max(0, Math.trunc(distance));
}

export function fleetMissionFuelCost(shipCount: number, distance: number): number {
  const normalizedShipCount = Math.max(0, Math.trunc(shipCount));
  if (normalizedShipCount === 0) return 0;
  const normalizedDistance = Math.max(0, Math.trunc(distance));
  return normalizedShipCount + Math.floor((normalizedShipCount * normalizedDistance) / FLEET_RULE_BPS);
}

export function fleetMissionShipCount(ships: Partial<MissionShips> | undefined): number {
  if (!ships) return 0;
  return missionShipKeys.reduce((total, key) => total + Math.max(0, Math.trunc(ships[key] ?? 0)), 0);
}
