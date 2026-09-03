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

export function hasUsableSupplyCargoFleet(ships: Partial<MissionShips>): boolean {
  return cargoShipKeys.some(({ key }) => safeAmount(ships[key]) > 0);
}

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

export function supplyResourceShortfall(
  resources: Partial<SupplyResources> | null | undefined,
  cost: Partial<SupplyResources> | null | undefined,
): SupplyResources | undefined {
  if (!resources || !cost) return undefined;
  const resourceKeys = ["metal", "crystal", "deuterium"] as const;
  if (resourceKeys.some((key) => !isKnownResourceAmount(resources[key]) || !isKnownResourceAmount(cost[key]))) {
    return undefined;
  }

  const missing = {
    metal: resourceDeficit(resources.metal, cost.metal),
    crystal: resourceDeficit(resources.crystal, cost.crystal),
    deuterium: resourceDeficit(resources.deuterium, cost.deuterium),
  };
  return resourceTotal(missing) > 0 ? missing : undefined;
}

export function buildBatchSupplyPlan({
  targetCoordinates,
  requested,
  selectedPlanetIds,
  sourceCargoOverrides = {},
  sources,
  maxOrders = Number.MAX_SAFE_INTEGER,
}: {
  targetCoordinates: Coordinates;
  requested: Partial<SupplyResources>;
  selectedPlanetIds: ReadonlySet<string>;
  /** Exact per-source cargo chosen in the Supply modal. Sources without an override keep automatic allocation. */
  sourceCargoOverrides?: Readonly<Record<string, Partial<SupplyResources>>>;
  sources: readonly BatchSupplySource[];
  maxOrders?: number;
}): BatchSupplyPlan {
  const normalizedRequested = normalizeSupplyResources(requested);
  const remaining = { ...normalizedRequested };
  const delivered = emptySupplyResources();
  const orders: BatchSupplyOrder[] = [];
  const blockedSources: BatchSupplyPlan["blockedSources"] = [];
  // Prefer the shortest routes by default: they consume less fuel and arrive sooner. The UI still
  // shows every allocation and lets the player deselect any source before submitting.
  const selected = sources
    .filter((source) => selectedPlanetIds.has(source.planetId))
    // Apply player-edited shipments first, then use nearby sources to automatically fill the balance.
    .sort((left, right) => {
      const leftManual = sourceCargoOverrides[left.planetId] === undefined ? 0 : 1;
      const rightManual = sourceCargoOverrides[right.planetId] === undefined ? 0 : 1;
      if (leftManual !== rightManual) return rightManual - leftManual;
      return fleetMissionDistance(left.coordinates, targetCoordinates) - fleetMissionDistance(right.coordinates, targetCoordinates);
    });
  const boundedMaxOrders = Math.max(0, Math.trunc(maxOrders));
  const sourceLimitReached = selected.length > boundedMaxOrders;

  for (const source of selected.slice(0, boundedMaxOrders)) {
    if (source.unavailableReason) {
      blockedSources.push({ planetId: source.planetId, reason: source.unavailableReason });
      continue;
    }
    const manualCargo = sourceCargoOverrides[source.planetId];
    if (resourceTotal(remaining) === 0 && manualCargo === undefined) continue;

    const requestedFromSource = manualCargo === undefined
      ? {
        metal: Math.min(remaining.metal, safeAmount(source.resources.metal)),
        crystal: Math.min(remaining.crystal, safeAmount(source.resources.crystal)),
        deuterium: Math.min(remaining.deuterium, safeAmount(source.resources.deuterium)),
      }
      : {
        metal: Math.min(safeAmount(manualCargo.metal), safeAmount(source.resources.metal)),
        crystal: Math.min(safeAmount(manualCargo.crystal), safeAmount(source.resources.crystal)),
        deuterium: Math.min(safeAmount(manualCargo.deuterium), safeAmount(source.resources.deuterium)),
      };
    // A selected source with an explicit zero allocation does not need to launch. Check before
    // capacity capping so a real shipment with no usable cargo fleet still reaches the blocker path.
    if (resourceTotal(requestedFromSource) === 0) continue;
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
    delivered.metal += loadout.cargo.metal;
    delivered.crystal += loadout.cargo.crystal;
    delivered.deuterium += loadout.cargo.deuterium;
    remaining.metal = Math.max(0, remaining.metal - loadout.cargo.metal);
    remaining.crystal = Math.max(0, remaining.crystal - loadout.cargo.crystal);
    remaining.deuterium = Math.max(0, remaining.deuterium - loadout.cargo.deuterium);
  }

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

function resourceTotal(resources: SupplyResources): number {
  return resources.metal + resources.crystal + resources.deuterium;
}

function resourceDeficit(available: number | undefined, required: number | undefined): number {
  return Math.max(0, Math.ceil((required ?? 0) - (available ?? 0)));
}

function isKnownResourceAmount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeAmount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value ?? 0)));
}
