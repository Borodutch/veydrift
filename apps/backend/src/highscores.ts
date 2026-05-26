import type { Address } from "./evm";

export type ScoreBreakdown = {
  total: string;
  economy: string;
  research: string;
  fleet: string;
  defense: string;
};

export type HighscoreInput = {
  wallet: Address;
  homePlanetId: string | null;
  planetCount: number;
  planets: Array<{
    buildings: Array<{ id: number; level: number }>;
    defenses: Array<{ id: number; count: number }>;
    ships: Array<{ id: number; count: number }>;
  }>;
  technologies: Array<{ id: number; level: number }>;
};

export type HighscoreEntry = {
  wallet: Address;
  homePlanetId: string | null;
  planetCount: number;
  score: ScoreBreakdown;
};

type Cost = readonly [bigint, bigint, bigint];
type CostFactor = readonly [bigint, bigint];

const pointsDivisor = 1_000n;

const buildingBaseCosts: readonly Cost[] = [
  [60n, 15n, 0n],
  [48n, 24n, 0n],
  [225n, 75n, 0n],
  [75n, 30n, 0n],
  [400n, 120n, 200n],
  [400n, 200n, 100n],
  [200n, 400n, 200n],
  [1_000n, 0n, 0n],
  [1_000n, 500n, 0n],
  [1_000n, 1_000n, 0n],
  [900n, 360n, 180n],
  [1_000_000n, 500_000n, 100_000n],
  [0n, 50_000n, 100_000n],
  [20_000n, 40_000n, 0n],
  [20_000n, 20_000n, 1_000n],
  [8_000n, 8_000n, 4_000n],
];

const defenseCosts: readonly Cost[] = [
  [2_000n, 0n, 0n],
  [1_500n, 500n, 0n],
  [6_000n, 2_000n, 0n],
  [10_000n, 10_000n, 0n],
  [20_000n, 15_000n, 2_000n],
  [2_000n, 6_000n, 0n],
  [50_000n, 50_000n, 30_000n],
  [50_000n, 50_000n, 0n],
  [8_000n, 0n, 2_000n],
  [12_500n, 2_500n, 10_000n],
];

const shipCosts: readonly Cost[] = [
  [2_000n, 2_000n, 0n],
  [3_000n, 1_000n, 0n],
  [10_000n, 6_000n, 2_000n],
  [10_000n, 20_000n, 10_000n],
  [6_000n, 6_000n, 0n],
  [6_000n, 4_000n, 0n],
  [20_000n, 7_000n, 2_000n],
  [45_000n, 15_000n, 0n],
  [50_000n, 25_000n, 15_000n],
  [0n, 2_000n, 500n],
  [60_000n, 50_000n, 15_000n],
  [5_000_000n, 4_000_000n, 1_000_000n],
  [30_000n, 40_000n, 15_000n],
  [85_000n, 55_000n, 20_000n],
  [8_000n, 15_000n, 8_000n],
  [2_000n, 2_000n, 1_000n],
];

const researchBaseCosts: readonly Cost[] = [
  [0n, 800n, 400n],
  [200n, 100n, 0n],
  [1_000n, 300n, 100n],
  [400n, 0n, 600n],
  [0n, 400n, 600n],
  [800n, 200n, 0n],
  [200n, 600n, 0n],
  [1_000n, 0n, 0n],
  [0n, 4_000n, 2_000n],
  [2_000n, 4_000n, 600n],
  [10_000n, 20_000n, 6_000n],
  [2_000n, 4_000n, 1_000n],
  [4_000n, 8_000n, 4_000n],
  [240_000n, 400_000n, 160_000n],
  [0n, 0n, 0n],
];

export const highscoreFormula = {
  pointsDivisor: pointsDivisor.toString(),
  summary:
    "Veydrift score uses one point per 1,000 resources of completed canonical owned state: buildings as economy, research globally, current fleet, and current defenses.",
} as const;

export function calculateHighscore(input: HighscoreInput): HighscoreEntry {
  let economyValue = 0n;
  let fleetValue = 0n;
  let defenseValue = 0n;

  for (const planet of input.planets) {
    for (const building of planet.buildings) {
      economyValue += completedLevelValue(buildingBaseCosts[building.id], building.level, buildingFactor(building.id));
    }
    for (const ship of planet.ships) {
      const cost = shipCosts[ship.id];
      if (cost) {
        fleetValue += unitValue(cost) * BigInt(Math.max(0, ship.count));
      }
    }
    for (const defense of planet.defenses) {
      const cost = defenseCosts[defense.id];
      if (cost) {
        defenseValue += unitValue(cost) * BigInt(Math.max(0, defense.count));
      }
    }
  }

  let researchValue = 0n;
  for (const technology of input.technologies) {
    researchValue += completedResearchValue(technology.id, technology.level);
  }

  const economy = points(economyValue);
  const research = points(researchValue);
  const fleet = points(fleetValue);
  const defense = points(defenseValue);
  const total = economy + research + fleet + defense;

  return {
    wallet: input.wallet,
    homePlanetId: input.homePlanetId,
    planetCount: input.planetCount,
    score: {
      total: total.toString(),
      economy: economy.toString(),
      research: research.toString(),
      fleet: fleet.toString(),
      defense: defense.toString(),
    },
  };
}

function completedLevelValue(baseCost: Cost | undefined, level: number, factor: CostFactor): bigint {
  if (!baseCost || level <= 0) return 0n;

  let value = 0n;
  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    value += unitValue(scaleByFactor(baseCost, currentLevel, factor));
  }
  return value;
}

function completedResearchValue(technologyId: number, level: number): bigint {
  const baseCost = researchBaseCosts[technologyId];
  if (!baseCost || level <= 0) return 0n;

  let value = 0n;
  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    value += unitValue(researchCost(technologyId, currentLevel, baseCost));
  }
  return value;
}

function researchCost(technologyId: number, currentLevel: number, baseCost: Cost): Cost {
  if (technologyId === 14) return [0n, 0n, 0n];
  if (technologyId === 12) {
    return [
      scaleAstrophysicsCost(baseCost[0], currentLevel),
      scaleAstrophysicsCost(baseCost[1], currentLevel),
      scaleAstrophysicsCost(baseCost[2], currentLevel),
    ];
  }

  const multiplier = 1n << BigInt(currentLevel);
  return [baseCost[0] * multiplier, baseCost[1] * multiplier, baseCost[2] * multiplier];
}

function buildingFactor(buildingId: number): CostFactor {
  if ([0, 2, 3].includes(buildingId)) return [15n, 10n];
  if (buildingId === 1) return [16n, 10n];
  if (buildingId === 10) return [18n, 10n];
  return [2n, 1n];
}

function scaleByFactor(cost: Cost, exponent: number, [numerator, denominator]: CostFactor): Cost {
  const numeratorPower = numerator ** BigInt(exponent);
  const denominatorPower = denominator ** BigInt(exponent);
  return [
    (cost[0] * numeratorPower) / denominatorPower,
    (cost[1] * numeratorPower) / denominatorPower,
    (cost[2] * numeratorPower) / denominatorPower,
  ];
}

function scaleAstrophysicsCost(baseCost: bigint, currentLevel: number): bigint {
  let numerator = 1n;
  let denominator = 1n;
  for (let index = 0; index < currentLevel; index += 1) {
    numerator *= 175n;
    denominator *= 100n;
  }

  const raw = (baseCost * numerator + (denominator / 2n)) / denominator;
  const roundedHundreds = (raw + 50n) / 100n;
  return roundedHundreds * 100n;
}

function unitValue(cost: Cost): bigint {
  return cost[0] + cost[1] + cost[2];
}

function points(value: bigint): bigint {
  return value / pointsDivisor;
}
