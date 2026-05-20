import type { BuildingKey, PlayableState, Resources } from "./playableMvp";
import {
  buildingCost,
  buildingDurationEstimate,
  buildingRequirementsFor,
  canAfford,
  energyBalance,
  productionCapacityPerHour,
  storageCaps,
  unmetBuildingRequirement,
  type PlanetProductionProfile,
} from "./playableMvp";
export { formatDuration } from "./durationFormat";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const MAX_BUILDING_LEVEL = 50;

const resourceLabels: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deuterium",
};

const buildingEnergyConsumption: Partial<Record<BuildingKey, number>> = {
  metalMine: 10,
  crystalMine: 12,
  deuteriumSynthesizer: 20,
};

export type BuildingUpgradeStatus = {
  cost: Resources;
  disabled: boolean;
  durationSeconds: number;
  reason: string;
  targetLevel: number;
};

export type BuildingEnergyDetail =
  | {
      kind: "produces";
      current: number;
      next: number;
      delta: number;
    }
  | {
      kind: "requires";
      current: number;
      next: number;
      delta: number;
    }
  | {
      kind: "none";
    };

export type BuildingLevelInfoRow = {
  cost: Resources;
  current: boolean;
  effect?: string;
  energyProduced?: number;
  energyRequired?: number;
  level: number;
  next: boolean;
  production?: {
    resource: keyof Resources;
    perHour: number;
  };
  storage?: {
    resource: keyof Resources;
    capacity: number;
  };
};

export type BuildingLevelInfoColumns = {
  effect: boolean;
  energyProduced: boolean;
  energyRequired: boolean;
  production: boolean;
  storage: boolean;
};

export function buildingUpgradeStatus(
  state: PlayableState,
  key: BuildingKey,
  options: { actionUnavailableReason?: string | undefined; chainCost?: Resources | undefined } = {},
): BuildingUpgradeStatus {
  const cost = options.chainCost ?? buildingCost(state.buildings, key);
  const targetLevel = state.buildings[key] + 1;
  const durationSeconds = buildingDurationEstimate(state.buildings, cost);

  if (options.actionUnavailableReason) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: options.actionUnavailableReason,
      targetLevel,
    };
  }

  if (state.queue) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: state.queue.key === key
        ? `Upgrade to Level ${state.queue.targetLevel} in progress`
        : `Building queue occupied by ${state.queue.label}`,
      targetLevel,
    };
  }

  const missingRequirement = unmetBuildingRequirement(state, key);
  if (missingRequirement) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: `Requires ${formatBuildingRequirement(missingRequirement)}`,
      targetLevel,
    };
  }

  if (!canAfford(state.resources, cost)) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: formatMissingResources(state.resources, cost),
      targetLevel,
    };
  }

  return {
    cost,
    disabled: false,
    durationSeconds,
    reason: `Ready for Level ${targetLevel}`,
    targetLevel,
  };
}

export function buildingLevelInfoRows(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  profile?: PlanetProductionProfile | undefined,
  maxLevel = MAX_BUILDING_LEVEL,
): BuildingLevelInfoRow[] {
  const currentLevel = buildings[key];
  const cappedMaxLevel = Math.max(1, maxLevel);

  return Array.from({ length: cappedMaxLevel }, (_, index) => {
    const level = index + 1;
    const rowBuildings = { ...buildings, [key]: level };
    const cost = buildingCost({ ...buildings, [key]: level - 1 }, key);
    const row: BuildingLevelInfoRow = {
      cost,
      current: currentLevel === level,
      level,
      next: currentLevel + 1 === level,
    };

    if (key === "metalMine" || key === "crystalMine" || key === "deuteriumSynthesizer") {
      const resource = productionResourceForBuilding(key);
      row.production = {
        resource,
        perHour: productionCapacityPerHour(rowBuildings, profile)[resource],
      };
      const energyRequired = energyRequiredForBuildingLevel(key, level);
      if (energyRequired !== undefined) {
        row.energyRequired = energyRequired;
      }
      return row;
    }

    if (key === "solarPlant") {
      row.energyProduced = energyBalance(rowBuildings).produced;
      return row;
    }

    if (key === "metalStorage" || key === "crystalStorage" || key === "deuteriumTank") {
      const resource = storageResourceForBuilding(key);
      row.storage = {
        resource,
        capacity: storageCaps(rowBuildings)[resource],
      };
      return row;
    }

    row.effect = speedEffectForBuilding(key, level);
    return row;
  });
}

export function buildingLevelInfoColumns(rows: BuildingLevelInfoRow[]): BuildingLevelInfoColumns {
  return {
    effect: rows.some((row) => row.effect !== undefined),
    energyProduced: rows.some((row) => row.energyProduced !== undefined),
    energyRequired: rows.some((row) => row.energyRequired !== undefined),
    production: rows.some((row) => row.production !== undefined),
    storage: rows.some((row) => row.storage !== undefined),
  };
}

export function formatBuildingRequirements(key: BuildingKey): string {
  const requirements = buildingRequirementsFor(key);
  return requirements.length > 0
    ? requirements.map(formatBuildingRequirement).join(" / ")
    : "None";
}

function formatBuildingRequirement(requirement: ReturnType<typeof buildingRequirementsFor>[number]): string {
  const label = buildingLabel(requirement.key);
  return `${label} ${requirement.level}`;
}

export function buildingEnergyDetail(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
): BuildingEnergyDetail {
  if (key === "solarPlant") {
    const current = energyBalance(buildings).produced;
    const next = energyBalance({ ...buildings, solarPlant: buildings.solarPlant + 1 }).produced;
    return {
      kind: "produces",
      current,
      next,
      delta: next - current,
    };
  }

  const perLevel = buildingEnergyConsumption[key];
  if (!perLevel) {
    return { kind: "none" };
  }

  const current = buildings[key] * perLevel;
  const next = (buildings[key] + 1) * perLevel;
  return {
    kind: "requires",
    current,
    next,
    delta: next - current,
  };
}

export function formatNumber(value: number): string {
  return formatter.format(Math.floor(value));
}

export function formatSigned(value: number): string {
  const rounded = Math.floor(value);
  return rounded > 0 ? `+${formatNumber(rounded)}` : formatNumber(rounded);
}

export function formatCost(cost: Resources): string {
  return resourceEntries(cost)
    .filter(([, value]) => value > 0)
    .map(([resource, value]) => `${resourceLabels[resource]} ${formatNumber(value)}`)
    .join(" / ") || "No resource cost";
}

function formatMissingResources(resources: Resources, cost: Resources): string {
  const missing = resourceEntries(cost)
    .map(([resource, required]) => [resource, required - resources[resource]] as const)
    .filter(([, deficit]) => deficit > 0);

  if (missing.length === 1) {
    const [resource, deficit] = missing[0]!;
    return `Requires ${formatNumber(deficit)} more ${resourceLabels[resource]}`;
  }

  return `Requires ${missing
    .map(([resource, deficit]) => `${formatNumber(deficit)} more ${resourceLabels[resource]}`)
    .join(", ")}`;
}

function resourceEntries(resources: Resources): Array<[keyof Resources, number]> {
  return [
    ["metal", resources.metal],
    ["crystal", resources.crystal],
    ["deuterium", resources.deuterium],
  ];
}

function energyRequiredForBuildingLevel(key: BuildingKey, level: number): number | undefined {
  const perLevel = buildingEnergyConsumption[key];
  return perLevel === undefined ? undefined : perLevel * level;
}

function productionResourceForBuilding(key: BuildingKey): keyof Resources {
  if (key === "metalMine") {
    return "metal";
  }

  if (key === "crystalMine") {
    return "crystal";
  }

  return "deuterium";
}

function storageResourceForBuilding(key: BuildingKey): keyof Resources {
  if (key === "metalStorage") {
    return "metal";
  }

  if (key === "crystalStorage") {
    return "crystal";
  }

  return "deuterium";
}

function speedEffectForBuilding(key: BuildingKey, level: number): string {
  if (key === "shipyard") {
    return `x${formatNumber(level + 1)} ship production`;
  }

  if (key === "researchLab") {
    return `x${formatNumber(level + 1)} research speed`;
  }

  return `x${formatNumber(level + 1)} construction speed`;
}

function buildingLabel(key: BuildingKey): string {
  const labels: Record<BuildingKey, string> = {
    metalMine: "Metal Mine",
    crystalMine: "Crystal Mine",
    deuteriumSynthesizer: "Deuterium Synth",
    solarPlant: "Solar Plant",
    roboticsFactory: "Robotics Factory",
    shipyard: "Shipyard",
    researchLab: "Research Lab",
    metalStorage: "Metal Storage",
    crystalStorage: "Crystal Storage",
    deuteriumTank: "Deuterium Tank",
  };
  return labels[key];
}
