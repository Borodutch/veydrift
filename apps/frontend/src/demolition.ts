import { buildingCatalog, buildingCostFactor, type BuildingKey, type Resources } from "./playableMvp";

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
