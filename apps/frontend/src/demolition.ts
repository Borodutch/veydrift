import { formatNumber } from "./buildingDetails";
import {
  buildingCatalog,
  buildingCostFactor,
  buildingDurationEstimate,
  buildingEffectMetrics,
  missileSiloCapacity,
  type BuildingKey,
  type PlanetProductionProfile,
  type Resources,
} from "./playableMvp";

/** Each Ion Technology level takes 4% off a demolition's price; from level 25 it is free. */
export const DEMOLITION_ION_DISCOUNT_PERCENT = 4;

export type DemolitionPrice = {
  /** What the player pays: the previous level's build price less the Ion Technology discount. */
  cost: Resources;
  /** The undiscounted price, which sets the duration (Ion Technology never shortens it). */
  fullCost: Resources;
  discountPercent: number;
};

/**
 * Price of taking a building from `level` (>= 1) to `level - 1`: the build price of level
 * `level - 1` (`base * factor^(level - 2)`, so level 1 costs `base / factor`), less 4% per Ion
 * Technology level, floored once. Mirrors `VeydriftFormulas.demolitionCost` exactly.
 */
export function demolitionPrice(
  baseCost: Resources,
  level: number,
  factor: readonly [number, number],
  ionLevel: number,
): DemolitionPrice {
  const discountPercent = Math.min(100, Math.max(0, ionLevel) * DEMOLITION_ION_DISCOUNT_PERCENT);
  const price = (base: number) => {
    const [numerator, denominator] = factor.map(BigInt) as [bigint, bigint];
    let scaledNumerator = BigInt(base) * denominator;
    let scaledDenominator = numerator;
    if (level >= 2) {
      scaledNumerator = BigInt(base) * numerator ** BigInt(level - 2);
      scaledDenominator = denominator ** BigInt(level - 2);
    }
    const remaining = BigInt(Math.max(0, 25 - Math.max(0, ionLevel)));
    return {
      cost: Number((scaledNumerator * remaining) / (scaledDenominator * 25n)),
      full: Number(scaledNumerator / scaledDenominator),
    };
  };
  const metal = price(baseCost.metal);
  const crystal = price(baseCost.crystal);
  const deuterium = price(baseCost.deuterium);
  return {
    cost: { metal: metal.cost, crystal: crystal.cost, deuterium: deuterium.cost },
    fullCost: { metal: metal.full, crystal: crystal.full, deuterium: deuterium.full },
    discountPercent,
  };
}

export function buildingDemolitionPrice(key: BuildingKey, level: number, ionLevel: number): DemolitionPrice {
  const entry = buildingCatalog.find((item) => item.key === key);
  if (!entry) throw new Error(`Unknown building: ${key}`);
  return demolitionPrice(entry.baseCost, level, buildingCostFactor(key), ionLevel);
}

/** Moon buildings scale by a flat 2x per level. */
export function moonDemolitionPrice(baseCost: Resources, level: number, ionLevel: number): DemolitionPrice {
  return demolitionPrice(baseCost, level, [2, 1], ionLevel);
}

/** Planet demolitions take the normal construction time for the undiscounted price. */
export function buildingDemolitionDurationSeconds(buildings: Record<BuildingKey, number>, fullCost: Resources): number {
  return buildingDurationEstimate(buildings, fullCost);
}

/** Moons only have a Robotics Factory to speed construction up. */
export function moonDemolitionDurationSeconds(moonRoboticsLevel: number, fullCost: Resources): number {
  const buildings = Object.fromEntries(buildingCatalog.map((building) => [building.key, 0])) as Record<BuildingKey, number>;
  return buildingDurationEstimate({ ...buildings, roboticsFactory: moonRoboticsLevel }, fullCost);
}

const resourceNames: Record<keyof Resources, string> = {
  metal: "metal",
  crystal: "crystal",
  deuterium: "deuterium",
};

/** "Not enough deuterium" or "Not enough metal and crystal"; undefined when the price is covered. */
export function demolitionShortfallReason(available: Resources | undefined, cost: Resources): string | undefined {
  if (!available) return undefined;
  const missing = (Object.keys(resourceNames) as Array<keyof Resources>)
    .filter((key) => available[key] < cost[key])
    .map((key) => resourceNames[key]);
  if (missing.length === 0) return undefined;
  const last = missing.pop()!;
  return `Not enough ${missing.length > 0 ? `${missing.join(", ")} and ${last}` : last}`;
}

export type PlanetDemolitionContext = {
  actionUnavailableReason?: string | undefined;
  buildingQueueBusy: boolean;
  /** Stored plus queued missile slots on this planet. */
  missileSlotsUsed: number;
  /** Ship or defense production is running on this planet. */
  productionActive: boolean;
  researchActive: boolean;
  resources?: Resources | undefined;
};

/** Why `key` can't be taken down a level right now, matching the contract's guards. */
export function planetDemolitionUnavailableReason(
  key: BuildingKey,
  level: number,
  cost: Resources,
  context: PlanetDemolitionContext,
): string | undefined {
  const label = buildingCatalog.find((building) => building.key === key)?.label ?? "This building";
  if (key === "terraformer") return `${label} can't be demolished`;
  if (level <= 0) return `${label} isn't built`;
  if (context.buildingQueueBusy) return "Building queue busy";
  if ((key === "shipyard" || key === "naniteFactory") && context.productionActive) return `${label} in use`;
  if (key === "researchLab" && context.researchActive) return `${label} in use`;
  if (key === "missileSilo" && context.missileSlotsUsed > missileSiloCapacity(level - 1)) return `${label} is too full`;
  if (context.actionUnavailableReason) return context.actionUnavailableReason;
  return demolitionShortfallReason(context.resources, cost);
}

const MISSILE_SLOTS_BY_DEFENSE_ID: Record<number, number> = {
  8: 1, // Anti-Ballistic Missile
  9: 2, // Interplanetary Missile
};

type MissileQueue = { active: boolean; itemId?: number | undefined; quantity?: number | undefined; backlog?: MissileQueue[] | undefined };

/** Silo slots held by stored missiles plus missiles still queued for production. */
export function missileSlotsUsed(
  defenses: ReadonlyArray<{ id: number; count: number }> | undefined,
  queue: MissileQueue | null | undefined,
): number {
  const slotsFor = (id: number | undefined, count: number | undefined) => (MISSILE_SLOTS_BY_DEFENSE_ID[id ?? -1] ?? 0) * (count ?? 0);
  const stored = (defenses ?? []).reduce((sum, defense) => sum + slotsFor(defense.id, defense.count), 0);
  if (!queue?.active) return stored;
  return [queue, ...(queue.backlog ?? [])].reduce((sum, entry) => sum + slotsFor(entry.itemId, entry.quantity), stored);
}

const capitalizedResourceNames: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deuterium",
};

/** What a planet loses when `key` drops from its current level to the one below. */
export function buildingDemolitionConsequences(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  profile?: PlanetProductionProfile | undefined,
  energyTechnologyLevel = 0,
): string[] {
  const level = buildings[key];
  if (level <= 0) return [];
  const lowerLevel = level - 1;
  // Measured from the lower level, the "next" values are what the planet has today.
  const effect = buildingEffectMetrics({ ...buildings, [key]: lowerLevel }, key, profile, energyTechnologyLevel);
  switch (effect.kind) {
    case "production":
      return effect.deltaPerHour > 0 ? [`${capitalizedResourceNames[effect.resource]} production −${formatNumber(effect.deltaPerHour)}/h`] : [];
    case "energy":
      return effect.deltaProduced > 0 ? [`Energy output −${formatNumber(effect.deltaProduced)}`] : [];
    case "storage":
      return [`${capitalizedResourceNames[effect.resource]} storage −${formatNumber(effect.deltaCapacity)} (stock above the cap is kept)`];
    case "missileSilo":
      return [`Missile capacity −${formatNumber(effect.deltaSlots)} slots`];
    case "allianceDepot":
      return [`Group-defense fuel support −${formatNumber(effect.deltaSupport)} deuterium`];
    case "constructionSpeed":
      return [`Construction speed x${formatNumber(effect.nextFactor)} → x${formatNumber(effect.currentFactor)}`];
    case "shipyard":
      return lowerLevel === 0
        ? ["Ships and defenses can't be built here until it's rebuilt"]
        : [`Ship production speed x${formatNumber(effect.nextFactor)} → x${formatNumber(effect.currentFactor)}`];
    case "researchSpeed":
      return lowerLevel === 0
        ? ["Research can't start here until it's rebuilt"]
        : [`Research speed x${formatNumber(effect.nextFactor)} → x${formatNumber(effect.currentFactor)}`];
    case "facility":
      return key === "interdimensionalRiftStabilizer" ? ["Rift transfers from this planet stop"] : [];
    default:
      return [];
  }
}
