import { calculateHighscore, type HighscoreEntry, type HighscoreInput } from "./highscores";
import type {
  DefenseState,
  InfrastructureState,
  PlanetState,
  ResearchState,
  Resources,
  RiftRequirement,
  RiftResourceState,
  ShipyardState
} from "./evm";

type NumericResources = {
  metal: number;
  crystal: number;
  deuterium: number;
};

type BuildingKey =
  | "metalMine"
  | "crystalMine"
  | "deuteriumSynthesizer"
  | "solarPlant"
  | "roboticsFactory"
  | "shipyard"
  | "researchLab"
  | "metalStorage"
  | "crystalStorage"
  | "deuteriumTank"
  | "fusionReactor"
  | "naniteFactory"
  | "terraformer"
  | "allianceDepot"
  | "missileSilo"
  | "interdimensionalRiftStabilizer";

const BPS = 10_000;
const RAID_PROTECTED_STORAGE_BPS = 0;
// Share of (unprotected) resources an attacker can actually haul away in a raid.
// Mirrors the on-chain default plunder rate (plunderBps = 5000 = 50%, see
// VeydriftClient.getAttackProtectionStatus in evm.ts). Without this, raidable loot
// shown on Rankings/Raid Finder reported 100% of resources — ~2x the real haul (VEY-451).
const RAID_PLUNDER_BPS = 5000;

export const buildingCount = 16;
export const defenseCount = 10;
export const supportedShipIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const supportedTechnologyIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

// Ships with no meaningful combat role: they carry a build cost but deal no (or
// negligible) damage, so they must not count toward the COMBAT / fighting-strength
// figure that the Raid Finder and Rankings surface. Excluding them keeps satellite-only
// or logistics-only planets reading as soft targets. (VEY-KANEO-450)
//   0  Small Cargo      (logistics)
//   2  Recycler         (debris salvage)
//   3  Colony Ship      (settlement)
//   4  Large Cargo      (logistics)
//   9  Solar Satellite  (stationary energy platform)
//   15 Crawler          (stationary mining support)
// Combat-capable hulls — fighters, cruisers, battleships, bombers, destroyers,
// battlecruisers, reapers, Dreadstar, and the attack-bearing Pathfinder — still count.
export const nonCombatShipIds: ReadonlySet<number> = new Set([0, 2, 3, 4, 9, 15]);

export function isCombatShipId(id: number): boolean {
  return !nonCombatShipIds.has(id);
}

export const riftResourceCatalog: Array<Pick<RiftResourceState, "key" | "label" | "resourceId">> = [
  { key: "metal", label: "Metal", resourceId: 0 },
  { key: "crystal", label: "Crystal", resourceId: 1 },
  { key: "deuterium", label: "Deuterium", resourceId: 2 }
];

const buildingKeys: readonly BuildingKey[] = [
  "metalMine",
  "crystalMine",
  "deuteriumSynthesizer",
  "solarPlant",
  "roboticsFactory",
  "shipyard",
  "researchLab",
  "metalStorage",
  "crystalStorage",
  "deuteriumTank",
  "fusionReactor",
  "naniteFactory",
  "terraformer",
  "allianceDepot",
  "missileSilo",
  "interdimensionalRiftStabilizer"
];

const buildingBaseCosts: readonly NumericResources[] = [
  { metal: 60, crystal: 15, deuterium: 0 },
  { metal: 48, crystal: 24, deuterium: 0 },
  { metal: 225, crystal: 75, deuterium: 0 },
  { metal: 75, crystal: 30, deuterium: 0 },
  { metal: 400, crystal: 120, deuterium: 200 },
  { metal: 400, crystal: 200, deuterium: 100 },
  { metal: 200, crystal: 400, deuterium: 200 },
  { metal: 1_000, crystal: 0, deuterium: 0 },
  { metal: 1_000, crystal: 500, deuterium: 0 },
  { metal: 1_000, crystal: 1_000, deuterium: 0 },
  { metal: 900, crystal: 360, deuterium: 180 },
  { metal: 1_000_000, crystal: 500_000, deuterium: 100_000 },
  { metal: 0, crystal: 50_000, deuterium: 100_000 },
  { metal: 20_000, crystal: 40_000, deuterium: 0 },
  { metal: 20_000, crystal: 20_000, deuterium: 1_000 },
  { metal: 8_000, crystal: 8_000, deuterium: 4_000 }
];

const defenseCosts: readonly NumericResources[] = [
  { metal: 2_000, crystal: 0, deuterium: 0 },
  { metal: 1_500, crystal: 500, deuterium: 0 },
  { metal: 6_000, crystal: 2_000, deuterium: 0 },
  { metal: 10_000, crystal: 10_000, deuterium: 0 },
  { metal: 20_000, crystal: 15_000, deuterium: 2_000 },
  { metal: 2_000, crystal: 6_000, deuterium: 0 },
  { metal: 50_000, crystal: 50_000, deuterium: 30_000 },
  { metal: 50_000, crystal: 50_000, deuterium: 0 },
  { metal: 8_000, crystal: 0, deuterium: 2_000 },
  { metal: 12_500, crystal: 2_500, deuterium: 10_000 }
];

const shipCosts: readonly NumericResources[] = [
  { metal: 2_000, crystal: 2_000, deuterium: 0 },
  { metal: 3_000, crystal: 1_000, deuterium: 0 },
  { metal: 10_000, crystal: 6_000, deuterium: 2_000 },
  { metal: 10_000, crystal: 20_000, deuterium: 10_000 },
  { metal: 6_000, crystal: 6_000, deuterium: 0 },
  { metal: 6_000, crystal: 4_000, deuterium: 0 },
  { metal: 20_000, crystal: 7_000, deuterium: 2_000 },
  { metal: 45_000, crystal: 15_000, deuterium: 0 },
  { metal: 50_000, crystal: 25_000, deuterium: 15_000 },
  { metal: 0, crystal: 2_000, deuterium: 500 },
  { metal: 60_000, crystal: 50_000, deuterium: 15_000 },
  { metal: 5_000_000, crystal: 4_000_000, deuterium: 1_000_000 },
  { metal: 30_000, crystal: 40_000, deuterium: 15_000 },
  { metal: 85_000, crystal: 55_000, deuterium: 20_000 },
  { metal: 8_000, crystal: 15_000, deuterium: 8_000 },
  { metal: 2_000, crystal: 2_000, deuterium: 1_000 }
];

const researchBaseCosts: readonly NumericResources[] = [
  { metal: 0, crystal: 800, deuterium: 400 },
  { metal: 200, crystal: 100, deuterium: 0 },
  { metal: 1_000, crystal: 300, deuterium: 100 },
  { metal: 400, crystal: 0, deuterium: 600 },
  { metal: 0, crystal: 400, deuterium: 600 },
  { metal: 800, crystal: 200, deuterium: 0 },
  { metal: 200, crystal: 600, deuterium: 0 },
  { metal: 1_000, crystal: 0, deuterium: 0 },
  { metal: 0, crystal: 4_000, deuterium: 2_000 },
  { metal: 2_000, crystal: 4_000, deuterium: 600 },
  { metal: 10_000, crystal: 20_000, deuterium: 6_000 },
  { metal: 2_000, crystal: 4_000, deuterium: 1_000 },
  { metal: 4_000, crystal: 8_000, deuterium: 4_000 },
  { metal: 240_000, crystal: 400_000, deuterium: 160_000 },
  { metal: 0, crystal: 0, deuterium: 0 }
];

const storageCapsByLevel = [
  10_000, 20_000, 40_000, 75_000, 140_000, 255_000, 470_000, 865_000, 1_590_000, 2_920_000,
  5_355_000, 9_820_000, 18_005_000, 33_005_000, 60_510_000, 110_925_000, 203_350_000, 372_785_000,
  683_385_000, 1_252_785_000, 2_296_600_000, 4_210_115_000, 7_717_970_000, 14_148_545_000,
  25_937_050_000, 47_547_690_000, 87_164_210_000, 159_789_040_000, 292_924_545_000,
  536_987_950_000, 984_403_885_000, 1_804_604_750_000, 3_308_193_270_000, 6_064_564_940_000,
  11_117_533_015_000, 20_380_611_235_000, 37_361_644_330_000, 68_491_197_375_000,
  125_557_753_210_000, 230_171_905_210_000, 421_950_095_435_000, 773_517_006_225_000,
  1_418_007_876_745_000, 2_599_485_625_175_000, 4_765_365_289_085_000, 8_735_846_091_420_000,
  16_014_513_537_450_000, 29_357_733_773_850_000, 53_818_464_752_040_000, 98_659_766_131_065_000,
  180_862_636_975_685_000
];

export function zeroResources(): Resources {
  return { metal: "0", crystal: "0", deuterium: "0" };
}

export function deriveBuildingRows(levelFor: (id: number) => number): InfrastructureState["buildings"] {
  return Array.from({ length: buildingCount }, (_, id) => ({
    id,
    level: levelFor(id),
    cost: toResources(buildingCost(id, levelFor(id)))
  }));
}

export function deriveShipRows(countFor: (id: number) => number, maxTemperature?: number): ShipyardState["ships"] {
  const solarSatelliteEnergyPerUnit = maxTemperature === undefined ? undefined : solarSatelliteEnergy(maxTemperature).toString();

  return supportedShipIds.map((id) => ({
    id,
    count: countFor(id),
    cost: toResources(shipCosts[id] ?? zeroNumericResources()),
    ...(id === 9 && solarSatelliteEnergyPerUnit ? { energyPerUnit: solarSatelliteEnergyPerUnit } : {})
  }));
}

export function deriveDefenseRows(countFor: (id: number) => number): DefenseState["defenses"] {
  return Array.from({ length: defenseCount }, (_, id) => ({
    id,
    count: countFor(id),
    cost: toResources(defenseCosts[id] ?? zeroNumericResources())
  }));
}

export function deriveTechnologyRows(levelFor: (id: number) => number): ResearchState["technologies"] {
  return supportedTechnologyIds.map((id) => ({
    id,
    level: levelFor(id),
    cost: toResources(researchCost(id, levelFor(id)))
  }));
}

export function usedFieldsFromBuildingRows(
  buildings: ReadonlyArray<Pick<InfrastructureState["buildings"][number], "level">>
): number {
  return buildings.reduce((sum, building) => sum + Math.max(0, Math.floor(building.level)), 0);
}

export function deriveInfrastructureFields(
  planet: PlanetState,
  buildings: InfrastructureState["buildings"],
  ships: ShipyardState["ships"],
  technologyLevels: Record<string, number>
): Pick<InfrastructureState, "energyBalance" | "productionPerHour" | "protectedResources" | "raidableResources" | "storageCaps"> {
  const levels = buildingLevels(buildings);
  const solarSatelliteCount = ships.find((ship) => ship.id === 9)?.count ?? 0;
  const energy = energyBalance(levels, solarSatelliteCount, planet.temperature, technologyLevels["0"] ?? 0);
  const caps = storageCaps(levels);
  const protectedResources = scaleResources(caps, RAID_PROTECTED_STORAGE_BPS);

  return {
    energyBalance: {
      produced: energy.produced.toString(),
      required: energy.required.toString(),
      scaleBps: energy.scaleBps.toString(),
      sources: {
        solarPlant: energy.sources.solarPlant.toString(),
        fusionReactor: energy.sources.fusionReactor.toString(),
        fusionReactorDeuteriumConsumed: energy.deuteriumConsumed.toString(),
        solarSatellites: energy.sources.solarSatellites.toString(),
        solarSatelliteCount,
        solarSatelliteEnergy: energy.sources.solarSatelliteEnergy.toString()
      }
    },
    productionPerHour: productionPerHour(levels, planet, energy),
    protectedResources,
    raidableResources: scaleResources(
      subtractResources(planet.resources, protectedResources),
      RAID_PLUNDER_BPS
    ),
    storageCaps: caps
  };
}

export function deriveRiftRequirements(
  bridgeBuilt: boolean | null,
  roboticsLevel: number,
  researchLabLevel: number,
  technologyLevels: Record<string, number>
): RiftRequirement[] {
  return [
    {
      kind: "building",
      key: "interdimensionalRiftStabilizer",
      label: "Interdimensional Rift Stabilizer",
      currentLevel: bridgeBuilt === null ? null : bridgeBuilt ? 1 : 0,
      requiredLevel: 1,
      binary: true,
      built: bridgeBuilt
    },
    {
      kind: "building",
      key: "roboticsFactory",
      label: "Robotics Factory",
      currentLevel: roboticsLevel,
      requiredLevel: 4
    },
    {
      kind: "building",
      key: "researchLab",
      label: "Research Lab",
      currentLevel: researchLabLevel,
      requiredLevel: 2
    },
    {
      kind: "technology",
      key: "energy",
      label: "Energy Technology",
      currentLevel: technologyLevels["0"] ?? 0,
      requiredLevel: 5
    },
    {
      kind: "technology",
      key: "hyperspace",
      label: "Hyperspace Technology",
      currentLevel: technologyLevels["8"] ?? 0,
      requiredLevel: 1
    }
  ];
}

export function deriveRiftResources(resources: Resources | null): RiftResourceState[] {
  return riftResourceCatalog.map((resource) => ({
    ...resource,
    tokenAddress: null,
    walletBalance: null,
    allowance: null,
    inGameBalance: resources?.[resource.key] ?? "0",
    lockedBalance: "0"
  }));
}

export function calculateIndexedHighscore(input: HighscoreInput): HighscoreEntry {
  return calculateHighscore(input);
}

function buildingCost(id: number, currentLevel: number): NumericResources {
  const key = buildingKeys[id];
  const baseCost = buildingBaseCosts[id];
  if (!key || !baseCost) return zeroNumericResources();
  if (key === "interdimensionalRiftStabilizer") return baseCost;

  const [numerator, denominator] = buildingCostFactor(key);
  return {
    metal: scaleByFactor(baseCost.metal, currentLevel, numerator, denominator),
    crystal: scaleByFactor(baseCost.crystal, currentLevel, numerator, denominator),
    deuterium: scaleByFactor(baseCost.deuterium, currentLevel, numerator, denominator)
  };
}

function researchCost(id: number, currentLevel: number): NumericResources {
  const baseCost = researchBaseCosts[id];
  if (!baseCost || id === 14) return zeroNumericResources();
  if (id === 12) {
    return {
      metal: roundToNearestHundred(baseCost.metal * (1.75 ** currentLevel)),
      crystal: roundToNearestHundred(baseCost.crystal * (1.75 ** currentLevel)),
      deuterium: roundToNearestHundred(baseCost.deuterium * (1.75 ** currentLevel))
    };
  }

  return multiplyResources(baseCost, 2 ** currentLevel);
}

function productionPerHour(
  buildings: Record<BuildingKey, number>,
  planet: PlanetState,
  energy: { deuteriumConsumed: number; scaleBps: number }
): Resources {
  const metal = scaleByBps(scaledLevelValue(30, buildings.metalMine), planet.metalMultiplierBps);
  const crystal = scaleByBps(scaledLevelValue(20, buildings.crystalMine), planet.crystalMultiplierBps);
  const deuteriumCapacity = scaleByBps(scaledLevelValue(10, buildings.deuteriumSynthesizer), planet.deuteriumMultiplierBps);
  const deuterium = Math.max(0, deuteriumCapacity - energy.deuteriumConsumed);

  return toResources({
    metal: scaleByBps(metal, energy.scaleBps),
    crystal: scaleByBps(crystal, energy.scaleBps),
    deuterium: scaleByBps(deuterium, energy.scaleBps)
  });
}

function energyBalance(
  buildings: Record<BuildingKey, number>,
  solarSatelliteCount: number,
  maxTemperature: number,
  energyTechnologyLevel: number
): {
  deuteriumConsumed: number;
  produced: number;
  required: number;
  scaleBps: number;
  sources: {
    solarPlant: number;
    fusionReactor: number;
    solarSatellites: number;
    solarSatelliteEnergy: number;
  };
} {
  const required = scaledLevelValue(10, buildings.metalMine)
    + scaledLevelValue(10, buildings.crystalMine)
    + scaledLevelValue(20, buildings.deuteriumSynthesizer);
  const solarPlant = scaledLevelValue(20, buildings.solarPlant);
  const fusionReactor = fusionReactorEnergyProduction(buildings.fusionReactor, energyTechnologyLevel);
  const solarSatelliteEnergyPerUnit = solarSatelliteEnergy(maxTemperature);
  const solarSatellites = solarSatelliteEnergyPerUnit * solarSatelliteCount;
  const produced = solarPlant + fusionReactor + solarSatellites;

  return {
    deuteriumConsumed: fusionReactorDeuteriumConsumption(buildings.fusionReactor),
    produced,
    required,
    scaleBps: required === 0 || produced >= required ? BPS : Math.floor((produced * BPS) / required),
    sources: {
      solarPlant,
      fusionReactor,
      solarSatellites,
      solarSatelliteEnergy: solarSatelliteEnergyPerUnit
    }
  };
}

function storageCaps(buildings: Record<BuildingKey, number>): Resources {
  return toResources({
    metal: storageCap(buildings.metalStorage),
    crystal: storageCap(buildings.crystalStorage),
    deuterium: storageCap(buildings.deuteriumTank)
  });
}

function buildingLevels(rows: InfrastructureState["buildings"]): Record<BuildingKey, number> {
  return Object.fromEntries(buildingKeys.map((key, id) => [key, rows.find((row) => row.id === id)?.level ?? 0])) as Record<BuildingKey, number>;
}

function buildingCostFactor(key: BuildingKey): [number, number] {
  if (key === "metalMine" || key === "deuteriumSynthesizer" || key === "solarPlant") return [15, 10];
  if (key === "crystalMine") return [16, 10];
  if (key === "fusionReactor") return [18, 10];
  return [2, 1];
}

function scaledLevelValue(base: number, level: number): number {
  if (level === 0) return 0;
  return Math.floor((base * level * (11 ** level)) / (10 ** level));
}

function fusionReactorEnergyProduction(level: number, energyTechnologyLevel: number): number {
  if (level === 0) return 0;
  return Math.floor((30 * level * ((105 + energyTechnologyLevel) ** level)) / (100 ** level));
}

function fusionReactorDeuteriumConsumption(level: number): number {
  if (level === 0) return 0;
  return Math.ceil((10 * level * (11 ** level)) / (10 ** level));
}

function solarSatelliteEnergy(maxTemperature: number): number {
  return Math.max(1, Math.min(65, Math.floor((maxTemperature + 140) / 6)));
}

function storageCap(level: number): number {
  return storageCapsByLevel[level] ?? storageCapsByLevel[storageCapsByLevel.length - 1]!;
}

function scaleByFactor(value: number, exponent: number, numerator: number, denominator: number): number {
  return Math.floor((value * (numerator ** exponent)) / (denominator ** exponent));
}

function scaleByBps(value: number, bps: number): number {
  return Math.floor((value * bps) / BPS);
}

function scaleResources(resources: Resources, bps: number): Resources {
  return toResources({
    metal: scaleByBps(Number(resources.metal), bps),
    crystal: scaleByBps(Number(resources.crystal), bps),
    deuterium: scaleByBps(Number(resources.deuterium), bps)
  });
}

function subtractResources(left: Resources, right: Resources): Resources {
  return toResources({
    metal: Math.max(0, Number(left.metal) - Number(right.metal)),
    crystal: Math.max(0, Number(left.crystal) - Number(right.crystal)),
    deuterium: Math.max(0, Number(left.deuterium) - Number(right.deuterium))
  });
}

function multiplyResources(resources: NumericResources, multiplier: number): NumericResources {
  return {
    metal: resources.metal * multiplier,
    crystal: resources.crystal * multiplier,
    deuterium: resources.deuterium * multiplier
  };
}

function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

function toResources(resources: NumericResources): Resources {
  return {
    metal: Math.floor(resources.metal).toString(),
    crystal: Math.floor(resources.crystal).toString(),
    deuterium: Math.floor(resources.deuterium).toString()
  };
}

function zeroNumericResources(): NumericResources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}
