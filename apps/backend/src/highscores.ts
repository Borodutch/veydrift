import type { Address } from "./evm";

export type ScoreBreakdown = {
  total: string;
  economy: string;
  research: string;
  researchLevels: string;
  military: string;
  fleet: string;
  fleetCount: string;
  defense: string;
};

export const highscoreCategories: readonly (keyof ScoreBreakdown)[] = [
  "total",
  "economy",
  "research",
  "researchLevels",
  "military",
  "fleet",
  "fleetCount",
  "defense",
];

export type HighscoreInput = {
  wallet: Address;
  homePlanetId: string | null;
  planetCount: number;
  planets: Array<{
    buildings: Array<{ id: number; level: number }>;
    moonBuildings?: Array<{ id: number; level: number }> | undefined;
    defenses: Array<{ id: number; count: number }>;
    ships: Array<{ id: number; count: number }>;
  }>;
  inFlightShips?: Array<{ id: number; count: number }> | undefined;
  technologies: Array<{ id: number; level: number }>;
};

export type HighscoreEntry = {
  wallet: Address;
  homePlanetId: string | null;
  planetCount: number;
  score: ScoreBreakdown;
  // Mirror of the contract's VeydriftGameStorage._totalUserScore (building/tech/ship/defense LEVELS
  // weighted by enum id), which is what the on-chain attack-protection gate and player-facing Score use.
  // DISTINCT from score.total (the resource-based category breakdown). Attack-protection must compare
  // on this scale, otherwise the 50k/500k newbie
  // thresholds make every player read as a newbie (VEY-KANEO-489 follow-up).
  totalUserScore: string;
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

const moonBuildingBaseCosts: readonly Cost[] = [
  [20_000n, 40_000n, 20_000n],
  [400n, 120n, 200n],
  [2_000_000n, 4_000_000n, 2_000_000n],
  [400n, 200n, 100n],
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
  target:
    "Contract-parity player score plus classic non-lifeform category breakdowns: economy, research points, research levels, current military points, current fleet points, ship count, and defense points.",
  summary:
    "Veydrift Score uses the contract-parity totalUserScore formula: technology levels, owned planets, building levels, owned ships across planets, moons, and active non-combat missions, and current defenses. Category breakdowns still use completed canonical owned state: planet and moon buildings as economy, research globally, current military, current fleet, and current defenses.",
  excludedCategories: [
    "Military built, military destroyed, military lost, and honor rankings are intentionally excluded until Veydrift exposes per-wallet historical combat and honor ledgers.",
  ],
} as const;

export function calculateHighscore(input: HighscoreInput): HighscoreEntry {
  let economyValue = 0n;
  let fleetValue = 0n;
  let defenseValue = 0n;

  for (const planet of input.planets) {
    for (const building of planet.buildings) {
      economyValue += completedLevelValue(buildingBaseCosts[building.id], building.level, buildingFactor(building.id));
    }
    for (const building of planet.moonBuildings ?? []) {
      economyValue += completedLevelValue(moonBuildingBaseCosts[building.id], building.level, [2n, 1n]);
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
  for (const ship of input.inFlightShips ?? []) {
    const cost = shipCosts[ship.id];
    if (cost) {
      fleetValue += unitValue(cost) * BigInt(Math.max(0, ship.count));
    }
  }

  let researchValue = 0n;
  let researchLevelCount = 0n;
  for (const technology of input.technologies) {
    researchValue += completedResearchValue(technology.id, technology.level);
    researchLevelCount += BigInt(Math.max(0, technology.level));
  }

  const economy = points(economyValue);
  const research = points(researchValue);
  const fleet = points(fleetValue);
  const defense = points(defenseValue);
  const military = fleet + defense;
  const fleetCount = input.planets.reduce((sum, planet) => (
    sum + planet.ships.reduce((planetSum, ship) => planetSum + BigInt(Math.max(0, ship.count)), 0n)
  ), 0n) + (input.inFlightShips ?? []).reduce(
    (sum, ship) => sum + BigInt(Math.max(0, ship.count)),
    0n
  );
  const total = economy + research + military;

  // Contract-parity Score (VeydriftGameStorage._totalUserScore): NOT resource-based.
  // Weights mirror the contract exactly — tech (id+1)*15, +1000 per owned planet, building (id+1)*10,
  // defense (id+1)*2, ship (id+1)*4. The indexer combines planet, moon, and active non-combat
  // mission ship inventories before scoring so moving an owned fleet does not change score. Moon
  // buildings are intentionally excluded (the contract's _totalUserScore loops the Building enum
  // on _ownedPlanetIds only).
  let totalUserScore = 0n;
  for (const technology of input.technologies) {
    totalUserScore += BigInt(Math.max(0, technology.level)) * BigInt(technology.id + 1) * 15n;
  }
  for (const planet of input.planets) {
    totalUserScore += 1_000n;
    for (const building of planet.buildings) {
      totalUserScore += BigInt(Math.max(0, building.level)) * BigInt(building.id + 1) * 10n;
    }
    for (const defense of planet.defenses) {
      totalUserScore += BigInt(Math.max(0, defense.count)) * BigInt(defense.id + 1) * 2n;
    }
    for (const ship of planet.ships) {
      totalUserScore += BigInt(Math.max(0, ship.count)) * BigInt(ship.id + 1) * 4n;
    }
  }
  for (const ship of input.inFlightShips ?? []) {
    totalUserScore += BigInt(Math.max(0, ship.count)) * BigInt(ship.id + 1) * 4n;
  }

  return {
    wallet: input.wallet,
    homePlanetId: input.homePlanetId,
    planetCount: input.planetCount,
    totalUserScore: totalUserScore.toString(),
    score: {
      total: total.toString(),
      economy: economy.toString(),
      research: research.toString(),
      researchLevels: researchLevelCount.toString(),
      military: military.toString(),
      fleet: fleet.toString(),
      fleetCount: fleetCount.toString(),
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
