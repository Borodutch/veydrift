import type { BuildingKey, PlayableState, ResearchKey, Resources } from "./playableMvp";
import {
  buildingCost,
  buildingDurationEstimate,
  buildingRequirementsFor,
  canAfford,
  energyBalance,
  allianceDepotSupportCapacity,
  isBinaryBuilding,
  fusionReactorDeuteriumConsumption,
  missileSiloCapacity,
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

const solarPrerequisiteMineKeys = new Set<BuildingKey>([
  "metalMine",
  "crystalMine",
  "deuteriumSynthesizer",
]);

export type BuildingLevelInfoRow = {
  cost: Resources;
  current: boolean;
  durationSeconds: number;
  effect?: string;
  energyProduced?: number;
  energyRequired?: number;
  deuteriumConsumed?: number;
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
  constructionTime: boolean;
  effect: boolean;
  deuteriumConsumed: boolean;
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
  const binary = isBinaryBuilding(key);
  const currentLevel = state.buildings[key];
  const targetLevel = binary ? 1 : currentLevel + 1;
  const durationSeconds = buildingDurationEstimate(state.buildings, cost);

  if (binary && currentLevel > 0) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: "Rift bridge built on this planet",
      targetLevel,
    };
  }

  if (options.actionUnavailableReason) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: options.actionUnavailableReason,
      targetLevel,
    };
  }

  if (state.queue?.kind === "building") {
    const queuedBuildingLabel = formatBuildingQueueLabel(state.queue.key, state.queue.label, state.queue.targetLevel);

    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: state.queue.key === key
        ? `${queuedBuildingLabel} upgrade in progress`
        : `Another building is currently upgrading: ${queuedBuildingLabel}`,
      targetLevel,
    };
  }

  const solarPrerequisite = mineSolarPlantPrerequisiteFor(state, key);
  if (solarPrerequisite) {
    return {
      cost,
      disabled: true,
      durationSeconds,
      reason: `Requires ${solarPrerequisite}`,
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
    reason: binary ? "Ready to build Rift bridge" : `Ready for Level ${targetLevel}`,
    targetLevel,
  };
}

export function buildingLevelInfoRows(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  profile?: PlanetProductionProfile | undefined,
  maxLevel = MAX_BUILDING_LEVEL,
  energyTechnologyLevel = 0,
): BuildingLevelInfoRow[] {
  const currentLevel = buildings[key];
  const cappedMaxLevel = Math.max(1, maxLevel);

  return Array.from({ length: cappedMaxLevel }, (_, index) => {
    const level = index + 1;
    const preUpgradeBuildings = { ...buildings, [key]: level - 1 };
    const rowBuildings = { ...buildings, [key]: level };
    const cost = buildingCost(preUpgradeBuildings, key);
    const row: BuildingLevelInfoRow = {
      cost,
      current: currentLevel === level,
      durationSeconds: buildingDurationEstimate(preUpgradeBuildings, cost),
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

    if (key === "solarPlant" || key === "fusionReactor") {
      const energy = energyBalance(rowBuildings, energyTechnologyLevel);
      row.energyProduced = energy.produced;
      if (key === "fusionReactor") {
        row.deuteriumConsumed = fusionReactorDeuteriumConsumption(level);
      }
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
    constructionTime: rows.some((row) => row.durationSeconds !== undefined),
    deuteriumConsumed: rows.some((row) => row.deuteriumConsumed !== undefined),
    effect: rows.some((row) => row.effect !== undefined),
    energyProduced: rows.some((row) => row.energyProduced !== undefined),
    energyRequired: rows.some((row) => row.energyRequired !== undefined),
    production: rows.some((row) => row.production !== undefined),
    storage: rows.some((row) => row.storage !== undefined),
  };
}

export function formatBuildingRequirements(key: BuildingKey): string {
  const requirements = [
    ...frontendOnlyBuildingRequirementsFor(key),
    ...buildingRequirementsFor(key).map(formatBuildingRequirement),
  ];

  return requirements.length > 0
    ? requirements.join(", ")
    : "None";
}

export function mineSolarPlantPrerequisiteFor(
  state: Pick<PlayableState, "buildings">,
  key: BuildingKey,
): string | undefined {
  return solarPrerequisiteMineKeys.has(key) && state.buildings.solarPlant < 1
    ? "Solar Plant level 1"
    : undefined;
}

function frontendOnlyBuildingRequirementsFor(key: BuildingKey): string[] {
  return solarPrerequisiteMineKeys.has(key) ? ["Solar Plant level 1"] : [];
}

function formatBuildingRequirement(requirement: ReturnType<typeof buildingRequirementsFor>[number]): string {
  const label = requirement.type === "building"
    ? buildingLabel(requirement.key)
    : researchLabel(requirement.key);
  return `${label} ${requirement.level}`;
}

export function buildingEnergyDetail(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  energyTechnologyLevel = 0,
): BuildingEnergyDetail {
  if (key === "solarPlant" || key === "fusionReactor") {
    const current = energyBalance(buildings, energyTechnologyLevel).produced;
    const next = energyBalance(
      { ...buildings, [key]: buildings[key] + 1 },
      energyTechnologyLevel,
    ).produced;
    return {
      kind: "produces",
      current,
      next,
      delta: next - current,
    };
  }

  const current = energyRequiredForBuildingLevel(key, buildings[key]);
  const next = energyRequiredForBuildingLevel(key, buildings[key] + 1);
  if (current === undefined || next === undefined) {
    return { kind: "none" };
  }

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
    .join(", ") || "No resource cost";
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

function formatBuildingQueueLabel(key: BuildingKey, label: string, targetLevel: number | undefined): string {
  if (isBinaryBuilding(key)) return label;
  return targetLevel ? `${label} Level ${targetLevel}` : label;
}

function resourceEntries(resources: Resources): Array<[keyof Resources, number]> {
  return [
    ["metal", resources.metal],
    ["crystal", resources.crystal],
    ["deuterium", resources.deuterium],
  ];
}

function energyRequiredForBuildingLevel(key: BuildingKey, level: number): number | undefined {
  if (key === "metalMine" || key === "crystalMine") {
    return scaledLevelValue(10, level);
  }

  if (key === "deuteriumSynthesizer") {
    return scaledLevelValue(20, level);
  }

  return undefined;
}

function scaledLevelValue(base: number, level: number): number {
  if (level === 0) return 0;
  return Math.floor((base * level * (11 ** level)) / (10 ** level));
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
    return `x${formatNumber(Math.max(1, level))} research speed`;
  }

  if (key === "missileSilo") {
    return `${formatNumber(missileSiloCapacity(level))} missile slots`;
  }

  if (key === "allianceDepot") {
    return `${formatNumber(allianceDepotSupportCapacity(level))} Deut. support`;
  }

  if (key === "terraformer") {
    return `+${formatNumber(level * 5)} total fields`;
  }

  if (key === "interdimensionalRiftStabilizer") {
    return level > 0 ? "Rift bridge online" : "Rift bridge locked";
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
    fusionReactor: "Fusion Reactor",
    naniteFactory: "Nanite Factory",
    terraformer: "Terraformer",
    allianceDepot: "Alliance Depot",
    missileSilo: "Missile Silo",
    interdimensionalRiftStabilizer: "Interdimensional Rift Stabilizer",
  };
  return labels[key];
}

function researchLabel(key: ReturnType<typeof buildingRequirementsFor>[number]["key"]): string {
  const labels = {
    energy: "Energy Technology",
    laser: "Laser Technology",
    ion: "Ion Technology",
    combustionDrive: "Combustion Drive",
    computer: "Computer Technology",
    weapons: "Weapons Technology",
    shielding: "Shielding Technology",
    armor: "Armor Technology",
    hyperspace: "Hyperspace Technology",
    impulseDrive: "Impulse Drive",
    hyperspaceDrive: "Hyperspace Drive",
    plasma: "Plasma Technology",
    astrophysics: "Astrophysics",
    intergalacticResearchNetwork: "Intergalactic Research Network",
    graviton: "Graviton Technology",
  };
  return labels[key as keyof typeof labels];
}
