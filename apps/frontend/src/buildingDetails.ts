import type { BuildingKey, PlayableState, ResearchKey, Resources } from "./playableMvp";
import {
  buildingEnergyProduction,
  buildingCost,
  buildingDurationEstimate,
  buildingRequirementsFor,
  canAfford,
  allianceDepotSupportCapacity,
  isBinaryBuilding,
  fusionReactorDeuteriumConsumption,
  missileSiloCapacity,
  storageCaps,
  unmetBuildingRequirement,
  type PlanetProductionProfile,
} from "./playableMvp";
import { formatDuration } from "./durationFormat";
// Re-exported for callers that render backend-provided timestamps/durations.
export { formatDuration };

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
  reason: string;
  targetLevel: number;
  // Backend-sourced predicted time to complete the next upgrade (VEY-KANEO-472).
  // Undefined when the backend has not supplied it (e.g. legacy/live-read payloads).
  durationSeconds?: number | undefined;
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

export type FrontendOnlyBuildingRequirementOptions = {
  starterPlanet?: boolean | undefined;
};

export type FrontendOnlyBuildingRequirement = {
  key: BuildingKey;
  level: number;
};

export type BuildingLevelInfoRow = {
  cost: Resources;
  current: boolean;
  // Per-level predicted build time for the reference table (VEY-KANEO-472). This
  // static catalogue already derives cost/energy/storage client-side, so the duration
  // column is restored the same way using the conformance-tested formula helper.
  durationSeconds: number;
  effect?: string;
  energyProduced?: number;
  energyRequired?: number;
  deuteriumConsumed?: number;
  level: number;
  next: boolean;
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
  storage: boolean;
};

export function buildingUpgradeStatus(
  state: PlayableState,
  key: BuildingKey,
  options: {
    actionUnavailableReason?: string | undefined;
    chainCost?: Resources | undefined;
    chainDurationSeconds?: number | undefined;
    now?: number | undefined;
    productionRates?: Resources | undefined;
    spendableResources?: Resources | undefined;
    starterPlanet?: boolean | undefined;
  } = {},
): BuildingUpgradeStatus {
  const cost = options.chainCost ?? buildingCost(state.buildings, key);
  const durationSeconds = options.chainDurationSeconds;
  const spendable = options.spendableResources ?? state.resources;
  const binary = isBinaryBuilding(key);
  const currentLevel = state.buildings[key];
  const targetLevel = binary ? 1 : currentLevel + 1;

  if (binary && currentLevel > 0) {
    return {
      cost,
      disabled: true,
      reason: "Rift bridge built on this planet",
      targetLevel,
      durationSeconds,
    };
  }

  if (options.actionUnavailableReason) {
    return {
      cost,
      disabled: true,
      reason: options.actionUnavailableReason,
      targetLevel,
      durationSeconds,
    };
  }

  if (state.queue?.kind === "building") {
    const queuedBuildingLabel = formatBuildingQueueLabel(state.queue.key, state.queue.label, state.queue.targetLevel);
    const queueReady = state.queue.readyAt <= (options.now ?? Date.now());

    return {
      cost,
      disabled: true,
      reason: queueReady
        ? `${queuedBuildingLabel} is ready to finish`
        : state.queue.key === key
        ? `${queuedBuildingLabel} upgrade in progress`
        : `Another building is currently upgrading: ${queuedBuildingLabel}`,
      targetLevel,
      durationSeconds,
    };
  }

  const starterPrerequisite = missingFrontendOnlyBuildingRequirementFor(state, key, {
    starterPlanet: options.starterPlanet,
  });
  if (starterPrerequisite) {
    return {
      cost,
      disabled: true,
      reason: `Requires ${starterPrerequisite}`,
      targetLevel,
      durationSeconds,
    };
  }

  const missingRequirement = unmetBuildingRequirement(state, key);
  if (missingRequirement) {
    return {
      cost,
      disabled: true,
      reason: `Requires ${formatBuildingRequirement(missingRequirement)}`,
      targetLevel,
      durationSeconds,
    };
  }

  if (!canAfford(spendable, cost)) {
    return {
      cost,
      disabled: true,
      reason: formatMissingResources(spendable, cost, options.productionRates),
      targetLevel,
      durationSeconds,
    };
  }

  return {
    cost,
    disabled: false,
    reason: binary ? "Ready to build Rift bridge" : `Ready for Level ${targetLevel}`,
    targetLevel,
    durationSeconds,
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
      const energyRequired = energyRequiredForBuildingLevel(key, level);
      if (energyRequired !== undefined) {
        row.energyRequired = energyRequired;
      }
      return row;
    }

    if (key === "solarPlant" || key === "fusionReactor") {
      row.energyProduced = buildingEnergyProduction(rowBuildings, key, energyTechnologyLevel, profile);
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
    storage: rows.some((row) => row.storage !== undefined),
  };
}

export function formatBuildingRequirements(
  key: BuildingKey,
  options: FrontendOnlyBuildingRequirementOptions = {},
): string {
  const requirements = [
    ...frontendOnlyBuildingRequirementsFor(key, options).map(formatFrontendOnlyBuildingRequirement),
    ...buildingRequirementsFor(key).map(formatBuildingRequirement),
  ];

  return requirements.length > 0
    ? requirements.join(", ")
    : "None";
}

export function mineSolarPlantPrerequisiteFor(
  state: Pick<PlayableState, "buildings">,
  key: BuildingKey,
  options: FrontendOnlyBuildingRequirementOptions = {},
): string | undefined {
  return frontendOnlyBuildingRequirementsFor(key, options).some((requirement) => requirement.key === "solarPlant")
    && state.buildings.solarPlant < 1
    ? "Solar Plant level 1"
    : undefined;
}

export function missingFrontendOnlyBuildingRequirementFor(
  state: Pick<PlayableState, "buildings">,
  key: BuildingKey,
  options: FrontendOnlyBuildingRequirementOptions = {},
): string | undefined {
  const missing = frontendOnlyBuildingRequirementsFor(key, options)
    .find((requirement) => state.buildings[requirement.key] < requirement.level);
  return missing ? formatFrontendOnlyBuildingRequirement(missing) : undefined;
}

export function frontendOnlyBuildingRequirementsFor(
  key: BuildingKey,
  { starterPlanet = false }: FrontendOnlyBuildingRequirementOptions = {},
): FrontendOnlyBuildingRequirement[] {
  if (!starterPlanet) return [];

  if (key === "metalMine") {
    return [{ key: "solarPlant", level: 1 }];
  }

  if (key === "crystalMine") {
    return [
      { key: "metalMine", level: 1 },
      { key: "solarPlant", level: 1 },
    ];
  }

  if (key === "deuteriumSynthesizer") {
    return [
      { key: "metalMine", level: 1 },
      { key: "crystalMine", level: 1 },
      { key: "solarPlant", level: 1 },
    ];
  }

  return [];
}

export function formatFrontendOnlyBuildingRequirement(requirement: FrontendOnlyBuildingRequirement): string {
  return `${buildingLabel(requirement.key)} level ${requirement.level}`;
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
    const current = buildingEnergyProduction(buildings, key, energyTechnologyLevel);
    const next = buildingEnergyProduction(
      { ...buildings, [key]: buildings[key] + 1 },
      key,
      energyTechnologyLevel,
    );
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

export function formatMissingResources(resources: Resources, cost: Resources, productionRates?: Resources | undefined): string {
  const missing = resourceEntries(cost)
    .map(([resource, required]) => [resource, required - resources[resource]] as const)
    .filter(([, deficit]) => deficit > 0);
  const timeToAfford = productionRates ? formatTimeToAfford(missing, productionRates) : "";

  if (missing.length === 1) {
    const [resource, deficit] = missing[0]!;
    return `Requires ${formatNumber(deficit)} more ${resourceLabels[resource]}${timeToAfford}`;
  }

  return `Requires ${missing
    .map(([resource, deficit]) => `${formatNumber(deficit)} more ${resourceLabels[resource]}`)
    .join(", ")}${timeToAfford}`;
}

// VEY-KANEO-481: restore the "affordable in …" ETA appended to the missing-resource
// copy on disabled build/research/defense/shipyard actions. The production rate is now
// backend-sourced (`productionPerHour` on /infrastructure, VEY-KANEO-464) rather than
// client-derived; the ETA is the maximum across each missing resource and falls back to
// the stalled copy when a needed resource has no production.
function formatTimeToAfford(
  missing: Array<readonly [keyof Resources, number]>,
  productionRates: Resources,
): string {
  if (missing.length === 0) return "";

  const blocked = missing
    .filter(([resource]) => productionRates[resource] <= 0)
    .map(([resource]) => resourceLabels[resource]);

  if (blocked.length > 0) {
    return ` (time unavailable: no ${blocked.join(" or ")} production)`;
  }

  const seconds = Math.max(
    ...missing.map(([resource, deficit]) => Math.ceil((deficit / productionRates[resource]) * 3_600)),
  );

  return ` (affordable in ${formatDuration(seconds)})`;
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
