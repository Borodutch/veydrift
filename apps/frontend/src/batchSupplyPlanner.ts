import type { Coordinates } from "./types";
import { emptyMissionShips, type MissionShips } from "./galaxyActions";
import {
  fleetMissionAvailableCargoCapacity,
  fleetMissionCargoCapacity,
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

export type SupplyMission = "transport" | "deploy";

export type BatchSupplyOrder = {
  originPlanetId: string;
  originLabel: string;
  cargo: SupplyResources;
  ships: MissionShips;
  fuelCost: number;
  travelSeconds: number;
};

export type BatchSupplyPlan = {
  mission: SupplyMission;
  /** Normal completion: Transport returns empty; Deploy stations ships at the target. */
  shipsReturn: boolean;
  orders: BatchSupplyOrder[];
  requested: SupplyResources;
  delivered: SupplyResources;
  missing: SupplyResources;
  fuelCost: number;
  blockedSources: Array<{ planetId: string; reason: string }>;
  sourceLimitReached: boolean;
};

export type SupplyShipKey = keyof MissionShips;

export type SupplyFleetModesBySource = Readonly<Record<string, "auto" | "all">>;

/** Only mobile mission ships; solar satellites and probes are not mission manifests. */
export const supplyShipKeys = Object.keys(emptyMissionShips()) as SupplyShipKey[];

export type SupplyShipTypesBySource = Readonly<Record<string, readonly SupplyShipKey[]>>;

export const defaultSupplyShipTypes: readonly SupplyShipKey[] = ["largeCargo", "smallCargo", "colonyShip"];

const cargoShipKeys: Array<{ id: number; key: SupplyShipKey }> = [
  { id: 4, key: "largeCargo" },
  { id: 0, key: "smallCargo" },
  { id: 2, key: "recycler" },
  { id: 3, key: "colonyShip" },
];

export function hasUsableSupplyFleet(ships: Partial<MissionShips>): boolean {
  return supplyShipKeys.some((key) => safeAmount(ships[key]) > 0);
}

/** Filter once, before capacity, fuel and fallback fleet calculations. Never mutate inventory. */
export function allowedSupplyShips(ships: Partial<MissionShips>, allowedShipTypes: readonly SupplyShipKey[]): MissionShips {
  const allowed = emptyMissionShips();
  for (const key of supplyShipKeys) {
    if (allowedShipTypes.includes(key)) allowed[key] = safeAmount(ships[key]);
  }
  return allowed;
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

/**
 * Max is a total, not an extra shipment. Search the actual preview planner without
 * changing its allocation order or the player's manual shipments. Feasibility is
 * not monotone: increasing cargo can move another resource to a different source.
 *
 * Each evaluation also gives an interval of requests with the same fleet choices
 * and affine cargo allocation. Skip that entire interval, rather than binary
 * searching feasibility (or scanning every resource unit). This finds the largest
 * total the existing greedy planner can deliver, not a different fleet optimizer.
 */
export function maximumBatchSupplyResource(
  options: BatchSupplyOptions,
  resource: keyof SupplyResources,
): number {
  const requested = normalizeSupplyResources(options.requested);
  const baseline = buildBatchSupplyPlan(options);
  const otherResources = (["metal", "crystal", "deuterium"] as const).filter(key => key !== resource);
  // A different Max must never hide an existing shortfall or displace its cargo.
  // The clicked field itself may be oversized and is intentionally replaced.
  const missionLimit = options.targetIsMoon ? 1 : 15;
  if (baseline.sourceLimitReached || otherResources.some(key => baseline.missing[key] > 0)) return requested[resource];

  let upper = Math.min(Number.MAX_SAFE_INTEGER, options.sources.reduce((total, source) =>
    total + (options.selectedPlanetIds.has(source.planetId) && !source.unavailableReason
      ? safeAmount(source.resources[resource]) : 0), 0));
  // Work scales with planner branch/fleet-count boundaries, not stock units.
  // UI callers must run this exact search in batchSupplyMax.worker, not render/events.
  while (upper >= 0) {
    const range = new SupplyMaxRange(upper);
    const plan = planBatchSupply({ ...options, requested: { ...requested, [resource]: upper } }, { resource, range });
    // Within this traced interval every delivered amount is affine in the
    // requested total. Intersect those inequalities and keep its largest value.
    let lower = range.lower;
    let maximum = upper;
    // Match Launch eligibility: satisfying cargo must not hide a blocked explicit fleet.
    if (plan.orders.length > 0 && plan.orders.length <= missionLimit && !plan.sourceLimitReached && plan.blockedSources.length === 0) {
      for (const key of ["metal", "crystal", "deuterium"] as const) {
        const delivered = range.delivered[key];
        const deficit = (key === resource ? upper : requested[key]) - delivered.value;
        const slope = (key === resource ? 1 : 0) - delivered.slope;
        if (slope > 0) maximum = Math.min(maximum, upper + Math.floor(-deficit / slope));
        else if (slope < 0) lower = Math.max(lower, upper + Math.ceil(-deficit / slope));
        else if (deficit > 0) maximum = -1;
      }
      if (maximum >= lower) return maximum;
    }
    upper = range.lower - 1;
  }
  return requested[resource];
}

type SupplyAmount = { value: number; slope: number };

/**
 * An amount at x is value + slope * (x - upper). Every branch narrows [lower,
 * upper] so its outcome and chosen fleet stay constant as x decreases. Branches
 * involving cargo must retain these bounds when changing the planner.
 */
class SupplyMaxRange {
  lower = 0;
  delivered = { metal: { value: 0, slope: 0 }, crystal: { value: 0, slope: 0 }, deuterium: { value: 0, slope: 0 } };
  constructor(readonly upper: number) {}

  // Only positive slopes can cross a lower bound when x decreases.
  atLeast(amount: SupplyAmount, minimum: number) {
    if (amount.slope > 0) this.lower = Math.max(this.lower, this.upper + Math.ceil((minimum - amount.value) / amount.slope));
  }

  atMost(amount: SupplyAmount, maximum: number) {
    if (amount.slope < 0) this.lower = Math.max(this.lower, this.upper + Math.ceil((maximum - amount.value) / amount.slope));
  }

  min(left: SupplyAmount, right: SupplyAmount): SupplyAmount {
    const difference = { value: left.value - right.value, slope: left.slope - right.slope };
    if (left.value <= right.value) {
      this.atMost(difference, 0);
      return left;
    }
    this.atLeast(difference, 1);
    return right;
  }

  positive(amount: SupplyAmount): boolean {
    if (amount.value > 0) { this.atLeast(amount, 1); return true; }
    this.atMost(amount, 0);
    return false;
  }
}

export function buildBatchSupplyPlan(options: BatchSupplyOptions): BatchSupplyPlan {
  return planBatchSupply(options);
}

/** Evaluate every single origin, nearest-first, and largest-contribution-first.
 * ponytail: bounded O(n²) candidate heuristic, not a global fleet optimizer.
 * Freeze the chosen source set in the modal; Max keeps its exact existing search.
 */
export function suggestBatchSupplySourceIds(options: Omit<BatchSupplyOptions, "selectedPlanetIds">): Set<string> {
  const eligible = options.sources.filter(source => !source.unavailableReason
    && hasUsableSupplyFleet(allowedSupplyShips(source.ships, options.shipTypesBySource?.[source.planetId] ?? defaultSupplyShipTypes)));
  const distance = (source: BatchSupplySource) => fleetMissionDistance(source.coordinates, options.targetCoordinates, { targetIsMoon: options.targetIsMoon ?? false });
  const nearest = [...eligible].sort((a, b) => distance(a) - distance(b) || a.planetId.localeCompare(b.planetId));
  const limit = Math.max(0, Math.min(options.maxOrders ?? 15, options.targetIsMoon ? 1 : 15));
  const evaluate = (sources: readonly BatchSupplySource[]) => planBatchSupply({ ...options, sources, selectedPlanetIds: new Set(sources.map(s => s.planetId)), maxOrders: limit });
  if (resourceTotal(normalizeSupplyResources(options.requested)) === 0) return new Set(nearest.slice(0, limit).map(s => s.planetId));
  const singles = nearest.map(source => ({ source, plan: evaluate([source]) }));
  const largest = [...singles].sort((a, b) => resourceTotal(b.plan.delivered) - resourceTotal(a.plan.delivered) || distance(a.source) - distance(b.source) || a.source.planetId.localeCompare(b.source.planetId)).map(item => item.source);
  const candidates = [...singles.map(item => item.plan), evaluate(nearest.slice(0, limit)), evaluate(largest.slice(0, limit))];
  // Add the origin which fills the current residual, rather than repeatedly
  // ranking overlapping inventories against the original request (A metal,
  // B metal, C crystal must choose A+C when only two slots are available).
  const residualSources: BatchSupplySource[] = [];
  let residual = evaluate(residualSources);
  while (residualSources.length < limit && resourceTotal(residual.missing) > 0) {
    const next = nearest.filter(source => !residualSources.includes(source))
      .map(source => ({ source, plan: evaluate([...residualSources, source]) }))
      .sort((a, b) => resourceTotal(a.plan.missing) - resourceTotal(b.plan.missing)
        || a.plan.blockedSources.length - b.plan.blockedSources.length
        || distance(a.source) - distance(b.source) || a.source.planetId.localeCompare(b.source.planetId))[0];
    if (!next || resourceTotal(next.plan.missing) >= resourceTotal(residual.missing)) break;
    residualSources.push(next.source);
    residual = next.plan;
    candidates.push(residual);
  }
  // The ordinary planner is nearest-first. Candidate pruning evaluates progressively
  // smaller sets so a complete plan never retains empty/fuel-starved origins.
  for (const ordering of [nearest, largest]) {
    let ids = ordering.slice(0, limit);
    for (const source of [...ids].reverse()) {
      const reduced = ids.filter(item => item.planetId !== source.planetId);
      const plan = evaluate(reduced);
      candidates.push(plan);
      if (resourceTotal(plan.missing) === 0 && plan.blockedSources.length === 0) ids = reduced;
    }
  }
  candidates.sort((a, b) => resourceTotal(a.missing) - resourceTotal(b.missing)
    || a.blockedSources.length - b.blockedSources.length
    || a.orders.length - b.orders.length
    || Math.max(0, ...a.orders.map(o => o.travelSeconds)) - Math.max(0, ...b.orders.map(o => o.travelSeconds))
    || a.fuelCost - b.fuelCost
    || a.orders.map(o => o.originPlanetId).join(",").localeCompare(b.orders.map(o => o.originPlanetId).join(",")));
  const best = candidates[0];
  return new Set(best?.orders.length ? best.orders.map(order => order.originPlanetId) : nearest.slice(0, limit).map(s => s.planetId));
}

type BatchSupplyOptions = {
  mission?: SupplyMission;
  targetCoordinates: Coordinates;
  targetIsMoon?: boolean;
  requested: Partial<SupplyResources>;
  selectedPlanetIds: ReadonlySet<string>;
  /** Exact per-source cargo chosen in the Supply modal. Sources without an override keep automatic allocation. */
  sourceCargoOverrides?: Readonly<Record<string, Partial<SupplyResources>>>;
  sources: readonly BatchSupplySource[];
  /** Per-source eligibility. Missing sources use defaults; empty arrays exclude every type. */
  shipTypesBySource?: SupplyShipTypesBySource;
  /** Auto minimizes cargo ships, but always sends all explicitly enabled combat ships.
   * All sends every available ship of each selected type, even without resource cargo. */
  fleetModesBySource?: SupplyFleetModesBySource;
  maxOrders?: number;
};

function planBatchSupply({
  mission = "transport",
  targetCoordinates,
  targetIsMoon = false,
  requested,
  selectedPlanetIds,
  sourceCargoOverrides = {},
  shipTypesBySource = {},
  fleetModesBySource = {},
  sources,
  maxOrders = Number.MAX_SAFE_INTEGER,
}: BatchSupplyOptions, maxTrace?: { resource: keyof SupplyResources; range: SupplyMaxRange }): BatchSupplyPlan {
  const normalizedRequested = normalizeSupplyResources(requested);
  const remaining = { ...normalizedRequested };
  const delivered = emptySupplyResources();
  const trace = maxTrace?.range;
  const slopes = emptySupplyResources();
  if (maxTrace) slopes[maxTrace.resource] = 1;
  const amount = (key: keyof SupplyResources): SupplyAmount => ({ value: remaining[key], slope: slopes[key] });
  const orders: BatchSupplyOrder[] = [];
  const blockedSources: BatchSupplyPlan["blockedSources"] = [];
  // Prefer the shortest routes by default: they consume less fuel and arrive sooner. The UI still
  // shows every allocation and lets the player deselect any source before submitting.
  const selected = sources
    .filter((source) => selectedPlanetIds.has(source.planetId))
    .map((source) => ({ ...source, ships: allowedSupplyShips(source.ships, shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes) }))
    // Apply player-edited shipments first, then use nearby sources to automatically fill the balance.
    .sort((left, right) => {
      const leftManual = sourceCargoOverrides[left.planetId] === undefined ? 0 : 1;
      const rightManual = sourceCargoOverrides[right.planetId] === undefined ? 0 : 1;
      if (leftManual !== rightManual) return rightManual - leftManual;
      return fleetMissionDistance(left.coordinates, targetCoordinates, { targetIsMoon }) - fleetMissionDistance(right.coordinates, targetCoordinates, { targetIsMoon });
    });
  const boundedMaxOrders = Math.max(0, Math.trunc(maxOrders));
  const sourceLimitReached = selected.length > boundedMaxOrders;

  for (const source of selected.slice(0, boundedMaxOrders)) {
    if (source.unavailableReason) {
      blockedSources.push({ planetId: source.planetId, reason: source.unavailableReason });
      continue;
    }
    const manualCargo = sourceCargoOverrides[source.planetId];
    const fixedShips = allowedSupplyShips(source.ships, fleetModesBySource[source.planetId] === "all"
      ? supplyShipKeys : supplyShipKeys.filter(key => !cargoShipKeys.some(candidate => candidate.key === key)));
    const hasFixedFleet = hasUsableSupplyFleet(fixedShips);
    const hasRemaining = trace
      ? trace.positive({ value: resourceTotal(remaining), slope: resourceTotal(slopes) })
      : resourceTotal(remaining) > 0;
    if (!hasRemaining && manualCargo === undefined && !hasFixedFleet) continue;

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
    const cargoSlopes = emptySupplyResources();
    if (trace && manualCargo === undefined) {
      for (const key of ["metal", "crystal", "deuterium"] as const) {
        cargoSlopes[key] = trace.min(amount(key), { value: safeAmount(source.resources[key]), slope: 0 }).slope;
      }
    }
    // Zero cargo skips automatic sources, but never cancels explicit fleet movement.
    // Check before capping so a real shipment without a fleet still reports a blocker.
    const hasRequestedCargo = trace
      ? trace.positive({ value: resourceTotal(requestedFromSource), slope: resourceTotal(cargoSlopes) })
      : resourceTotal(requestedFromSource) > 0;
    if (!hasRequestedCargo && !hasFixedFleet) continue;
    // A colony should contribute what it can carry, rather than being skipped just because the
    // remaining total is larger than its entire cargo fleet. Keep the allocation deterministic so
    // the preview exactly matches the generated child missions.
    const cargo = capCargoToCapacity(
      requestedFromSource,
      maximumCargoCapacity(source.ships, targetCoordinates, source.coordinates, source.driveLevels, targetIsMoon),
      trace, cargoSlopes,
    );
    const loadout = supplyLoadoutForCargo({ cargo, source, targetCoordinates, targetIsMoon, trace, cargoSlopes, fixedShips });
    if (!loadout) {
      blockedSources.push({ planetId: source.planetId, reason: "Selected fleet cannot carry its fuel and cargo with the available deuterium." });
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
    for (const key of ["metal", "crystal", "deuterium"] as const) {
      if (trace) {
        trace.delivered[key].value += loadout.cargo[key];
        trace.delivered[key].slope += cargoSlopes[key];
        const difference = { value: loadout.cargo[key] - remaining[key], slope: cargoSlopes[key] - slopes[key] };
        slopes[key] = -trace.min(difference, { value: 0, slope: 0 }).slope;
      }
      remaining[key] = Math.max(0, remaining[key] - loadout.cargo[key]);
    }
  }

  return {
    mission,
    shipsReturn: mission === "transport",
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
  targetIsMoon: boolean,
): number {
  const ships = allowedSupplyShips(availableShips, supplyShipKeys);
  return fleetMissionAvailableCargoCapacity(
    ships,
    fleetMissionDistance(originCoordinates, targetCoordinates, { targetIsMoon }),
    driveLevels,
  );
}

function capCargoToCapacity(cargo: SupplyResources, capacity: number, trace?: SupplyMaxRange, slopes = emptySupplyResources()): SupplyResources {
  let remainingCapacity = Math.max(0, Math.trunc(capacity));
  const limited = emptySupplyResources();
  let capacitySlope = 0;
  for (const resource of ["metal", "crystal", "deuterium"] as const) {
    const amount = Math.min(Math.max(0, Math.trunc(cargo[resource])), remainingCapacity);
    if (trace) {
      slopes[resource] = trace.min({ value: cargo[resource], slope: slopes[resource] }, { value: remainingCapacity, slope: capacitySlope }).slope;
      capacitySlope -= slopes[resource];
    }
    limited[resource] = amount;
    remainingCapacity -= amount;
  }
  return limited;
}

function supplyLoadoutForCargo({
  cargo: initialCargo,
  fixedShips,
  source,
  targetCoordinates,
  targetIsMoon,
  trace,
  cargoSlopes = emptySupplyResources(),
}: {
  trace?: SupplyMaxRange | undefined;
  cargoSlopes?: SupplyResources;
  cargo: SupplyResources;
  fixedShips: MissionShips;
  source: BatchSupplySource;
  targetCoordinates: Coordinates;
  targetIsMoon: boolean;
}): { cargo: SupplyResources; ships: MissionShips; fuelCost: number; travelSeconds: number } | null {
  const cargo = { ...initialCargo };
  const distance = fleetMissionDistance(source.coordinates, targetCoordinates, { targetIsMoon });

  // Fuel is paid from the source's deuterium reserve. Recalculate the smallest practical cargo
  // fleet after reducing deuterium cargo; this lets a metal/crystal shipment proceed even when the
  // player asked to transfer more deuterium than the origin can spare for fuel.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ships = minimumCargoFleet(source.ships, resourceTotal(cargo), distance, source.driveLevels, trace, resourceTotal(cargoSlopes), fixedShips);
    if (!ships) return null;
    // The contract charges the same dispatch fuel for Transport and Deploy.
    // Deploy has no normal return leg, but does not halve fuel or refund it at arrival.
    const fuelCost = fleetMissionFuelCost(ships, distance, source.driveLevels);
    const availableDeuterium = safeAmount(source.resources.deuterium);
    const maxCargoDeuterium = Math.max(0, availableDeuterium - fuelCost);
    if (cargo.deuterium > maxCargoDeuterium) {
      trace?.atLeast({ value: cargo.deuterium, slope: cargoSlopes.deuterium }, maxCargoDeuterium + 1);
      cargo.deuterium = maxCargoDeuterium;
      cargoSlopes.deuterium = 0;
      continue;
    }
    trace?.atMost({ value: cargo.deuterium, slope: cargoSlopes.deuterium }, maxCargoDeuterium);
    const hasCargo = trace ? trace.positive({ value: resourceTotal(cargo), slope: resourceTotal(cargoSlopes) }) : resourceTotal(cargo) > 0;
    if ((!hasCargo && !hasUsableSupplyFleet(fixedShips)) || availableDeuterium < fuelCost
      || resourceTotal(cargo) + fuelCost > fleetMissionCargoCapacity(ships)) return null;
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
  trace?: SupplyMaxRange,
  slope = 0,
  fixedShips = emptyMissionShips(),
): MissionShips | null {
  const total = { value: cargoTotal, slope };
  const hasCargo = trace ? trace.positive(total) : cargoTotal > 0;
  if (!hasCargo && !hasUsableSupplyFleet(fixedShips)) return null;
  const ships = { ...fixedShips };
  const fixedCapacity = fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, driveLevels);
  if (hasUsableSupplyFleet(ships) && fixedCapacity >= cargoTotal) {
    trace?.atMost(total, fixedCapacity);
    return ships;
  }
  if (hasUsableSupplyFleet(ships)) trace?.atLeast(total, fixedCapacity + 1);
  for (const candidate of cargoShipKeys) {
    const available = Math.max(0, Math.trunc(availableShips[candidate.key] ?? 0));
    if (available === 0 || fixedShips[candidate.key] > 0) continue;
    const capacityBefore = fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, driveLevels);
    const requiredBefore = Math.max(0, cargoTotal - capacityBefore);
    if (requiredBefore <= 0) { trace?.atMost(total, capacityBefore); return ships; }
    trace?.atLeast(total, capacityBefore + 1);

    // Start with the capacity-only estimate, then add single ships until the exact fuel-adjusted
    // capacity matches the contract formula. This remains bounded by the selected source inventory.
    const assumedUnitCapacity = candidate.key === "largeCargo" ? 25_000
      : candidate.key === "smallCargo" ? 5_000
        : candidate.key === "recycler" ? 20_000
          : 7_500;
    ships[candidate.key] = Math.min(available, Math.max(1, Math.ceil(requiredBefore / assumedUnitCapacity)));
    // Keep the capacity-only initial estimate constant as well as every exact
    // fuel-adjusted comparison; mixed fleets can change fuel discontinuously.
    trace?.atLeast(total, capacityBefore + (ships[candidate.key] - 1) * assumedUnitCapacity + 1);
    if (ships[candidate.key] < available) trace?.atMost(total, capacityBefore + ships[candidate.key] * assumedUnitCapacity);
    while (
      ships[candidate.key] < available
      && fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, driveLevels) < cargoTotal
    ) {
      trace?.atLeast(total, fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, driveLevels) + 1);
      ships[candidate.key] += 1;
    }
    const capacity = fleetMissionCargoCapacity(ships) - fleetMissionFuelCost(ships, distance, driveLevels);
    if (capacity >= cargoTotal) { trace?.atMost(total, capacity); return ships; }
    trace?.atLeast(total, capacity + 1);
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
