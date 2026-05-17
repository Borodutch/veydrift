import type { BuildingKey, PlayableState, Resources } from "./playableMvp";
import {
  buildingCost,
  buildingDurationEstimate,
  buildingRequirementsFor,
  canAfford,
  energyBalance,
  unmetBuildingRequirement,
} from "./playableMvp";
export { formatDuration } from "./durationFormat";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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
