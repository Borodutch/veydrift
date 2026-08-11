import type { Coordinates } from "./types";
import { emptyMissionShips, type MissionShips, type MissionShipKey } from "./galaxyActions";
import {
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionTravelSeconds,
  type FleetDriveLevels,
} from "./fleetMissionRules";

export type SupplyResources = {
  metal: number;
  crystal: number;
  deuterium: number;
};

export type BatchSupplySource = {
  planetId: string;
  label: string;
  coordinates: Coordinates;
  resources: SupplyResources;
  ships: Partial<MissionShips>;
  driveLevels: FleetDriveLevels;
  unavailableReason?: string;
};

export type BatchSupplyOrder = {
  originPlanetId: string;
  originLabel: string;
  cargo: SupplyResources;
  ships: MissionShips;
  fuelCost: number;
  travelSeconds: number;
};

export type BatchSupplyPlan = {
  orders: BatchSupplyOrder[];
  requested: SupplyResources;
  delivered: SupplyResources;
  missing: SupplyResources;
  fuelCost: number;
  blockedSources: Array<{ planetId: string; reason: string }>;
  sourceLimitReached: boolean;
};

const cargoShipKeys: Array<{ id: number; key: MissionShipKey }> = [
  { id: 4, key: "largeCargo" },
  { id: 0, key: "smallCargo" },
  { id: 2, key: "recycler" },
  { id: 3, key: "colonyShip" },
];

export function emptySupplyResources(): SupplyResources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

export function normalizeSupplyResources(resources: Partial<SupplyResources>): SupplyResources {
  return {
    metal: safeAmount(resources.metal),
    crystal: safeAmount(resources.crystal),
    deuterium: safeAmount(resources.deuterium),
  };
}

export function buildBatchSupplyPlan({
  targetCoordinates,
  requested,
  selectedPlanetIds,
  sources,
  maxOrders = Number.MAX_SAFE_INTEGER,
}: {
  targetCoordinates: Coordinates;
  requested: Partial<SupplyResources>;
  selectedPlanetIds: ReadonlySet<string>;
  sources: readonly BatchSupplySource[];
  maxOrders?: number;
}): BatchSupplyPlan {
  const normalizedRequested = normalizeSupplyResources(requested);
  const remaining = { ...normalizedRequested };
  const orders: BatchSupplyOrder[] = [];
  const blockedSources: BatchSupplyPlan["blockedSources"] = [];
  // Prefer the shortest routes by default: they consume less fuel and arrive sooner. The UI still
  // shows every allocation and lets the player deselect any source before submitting.
  const selected = sources
    .filter((source) => selectedPlanetIds.has(source.planetId))
    .sort((left, right) => fleetMissionDistance(left.coordinates, targetCoordinates) - fleetMissionDistance(right.coordinates, targetCoordinates));
  const boundedMaxOrders = Math.max(0, Math.trunc(maxOrders));
  const sourceLimitReached = selected.length > boundedMaxOrders;

  for (const source of selected.slice(0, boundedMaxOrders)) {
    if (source.unavailableReason) {
      blockedSources.push({ planetId: source.planetId, reason: source.unavailableReason });
      continue;
    }
    if (resourceTotal(remaining) === 0) break;

    const requestedFromSource = {
      metal: Math.min(remaining.metal, safeAmount(source.resources.metal)),
      crystal: Math.min(remaining.crystal, safeAmount(source.resources.crystal)),
      deuterium: Math.min(remaining.deuterium, safeAmount(source.resources.deuterium)),
    };
    // A colony should contribute what it can carry, rather than being skipped just because the
    // remaining total is larger than its entire cargo fleet. Keep the allocation deterministic so
    // the preview exactly matches the generated child missions.
    const cargo = capCargoToCapacity(
      requestedFromSource,
      maximumCargoCapacity(source.ships, targetCoordinates, source.coordinates, source.driveLevels),
    );
    const loadout = transportLoadoutForCargo({ cargo, source, targetCoordinates });
    if (!loadout) {
      blockedSources.push({ planetId: source.planetId, reason: "No cargo fleet with enough deuterium for this route." });
      continue;
    }

    orders.push({
      originPlanetId: source.planetId,
      originLabel: source.label,
      cargo: loadout.cargo,
      ships: loadout.ships,
      fuelCost: loadout.fuelCost,
      travelSeconds: loadout.travelSeconds,
    });
    remaining.metal -= loadout.cargo.metal;
    remaining.crystal -= loadout.cargo.crystal;
    remaining.deuterium -= loadout.cargo.deuterium;
  }

  const delivered = subtractResources(normalizedRequested, remaining);
  return {
    orders,
    requested: normalizedRequested,
    delivered,
    missing: remaining,
    fuelCost: orders.reduce((total, order) => total + order.fuelCost, 0),
    blockedSources,
    sourceLimitReached,
  };
}

function maximumCargoCapacity(
  availableShips: Partial<MissionShips>,
  targetCoordinates: Coordinates,
  originCoordinates: Coordinates,
  driveLevels: FleetDriveLevels,
): number {
  const ships = emptyMissionShips();
  for (const candidate of cargoShipKeys) {
    ships[candidate.key] = Math.max(0, Math.trunc(availableShips[candidate.key] ?? 0));
  }
  return fleetMissionAvailableCargoCapacity(
    ships,
    fleetMissionDistance(originCoordinates, targetCoordinates),
    driveLevels,
  );
}

function capCargoToCapacity(cargo: SupplyResources, capacity: number): SupplyResources {
  let remainingCapacity = Math.max(0, Math.trunc(capacity));
  const limited = emptySupplyResources();
  for (const resource of ["metal", "crystal", "deuterium"] as const) {
    const amount = Math.min(Math.max(0, Math.trunc(cargo[resource])), remainingCapacity);
    limited[resource] = amount;
    remainingCapacity -= amount;
  }
  return limited;
}

function transportLoadoutForCargo({
  cargo: initialCargo,
  source,
  targetCoordinates,
}: {
  cargo: SupplyResources;
  source: BatchSupplySource;
  targetCoordinates: Coordinates;
}): { cargo: SupplyResources; ships: MissionShips; fuelCost: number; travelSeconds: number } | null {
  const cargo = { ...initialCargo };
  const distance = fleetMissionDistance(source.coordinates, targetCoordinates);

  // Fuel is paid from the source's deuterium reserve. Recalculate the smallest practical cargo
  // fleet after reducing deuterium cargo; this lets a metal/crystal shipment proceed even when the
  // player asked to transfer more deuterium than the origin can spare for fuel.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ships = minimumCargoFleet(source.ships, resourceTotal(cargo), distance, source.driveLevels);
    if (!ships) return null;
    const fuelCost = fleetMissionFuelCost(ships, distance, source.driveLevels);
    const availableDeuterium = safeAmount(source.resources.deuterium);
    const maxCargoDeuterium = Math.max(0, availableDeuterium - fuelCost);
    if (cargo.deuterium > maxCargoDeuterium) {
      cargo.deuterium = maxCargoDeuterium;
      continue;
    }
    if (resourceTotal(cargo) === 0 || availableDeuterium < fuelCost) return null;
    return {
      cargo,
      ships,
      fuelCost,
      travelSeconds: fleetMissionTravelSeconds(distance, ships, source.driveLevels),
    };
  }
  return null;
}

function minimumCargoFleet(
  availableShips: Partial<MissionShips>,
  cargoTotal: number,
  distance: number,
  driveLevels: FleetDriveLevels,
): MissionShips | null {
  if (cargoTotal <= 0) return null;
  const ships = emptyMissionShips();
  for (const candidate of cargoShipKeys) {
    const available = Math.max(0, Math.trunc(availableShips[candidate.key] ?? 0));
    if (available === 0) continue;
    const requiredBefore = Math.max(0, cargoTotal - fleetMissionAvailableCargoCapacity(ships, distance, driveLevels));
    if (requiredBefore <= 0) return ships;

    // Start with the capacity-only estimate, then add single ships until the exact fuel-adjusted
    // capacity matches the contract formula. This remains bounded by the selected source inventory.
    const assumedUnitCapacity = candidate.key === "largeCargo" ? 25_000
      : candidate.key === "smallCargo" ? 5_000
        : candidate.key === "recycler" ? 20_000
          : 7_500;
    ships[candidate.key] = Math.min(available, Math.max(1, Math.ceil(requiredBefore / assumedUnitCapacity)));
    while (
      ships[candidate.key] < available
      && fleetMissionAvailableCargoCapacity(ships, distance, driveLevels) < cargoTotal
    ) {
      ships[candidate.key] += 1;
    }
    if (fleetMissionAvailableCargoCapacity(ships, distance, driveLevels) >= cargoTotal) return ships;
  }
  return fleetMissionAvailableCargoCapacity(ships, distance, driveLevels) >= cargoTotal ? ships : null;
}

function subtractResources(left: SupplyResources, right: SupplyResources): SupplyResources {
  return {
    metal: Math.max(0, left.metal - right.metal),
    crystal: Math.max(0, left.crystal - right.crystal),
    deuterium: Math.max(0, left.deuterium - right.deuterium),
  };
}

function resourceTotal(resources: SupplyResources): number {
  return resources.metal + resources.crystal + resources.deuterium;
}

function safeAmount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value ?? 0)));
}
