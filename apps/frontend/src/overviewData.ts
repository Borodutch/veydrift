import type { PlayerQueuesResponse, QueueStateResponse, WalletSettlementResponse } from "./walletFlow";
import {
  buildingCatalog,
  buildingContractIds,
  type BuildingKey,
  type EnergyBalance,
  type Resources,
} from "./playableMvp";
import type { Coordinates } from "./types";

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const FIELD_MIN = 1;
const FIELD_MAX = 1_000;
const TEMPERATURE_MIN = -200;
const TEMPERATURE_MAX = 200;
const RESOURCE_DISPLAY_MAX = 999_999_999_999n;

export type ChainLoadStatus = "local" | "loading" | "ready" | "error";

export type PlanetStatDisplay = {
  fields: string;
  temperature: string;
  diameter: string;
  status: string;
};

export function isWalletPlanetHydrated({
  homeCoords,
  isWalletConnected,
  resources,
  settlement,
  status,
}: {
  homeCoords: Coordinates | undefined;
  isWalletConnected: boolean;
  resources: Resources | undefined;
  settlement: WalletSettlementResponse | undefined;
  status: ChainLoadStatus;
}): boolean {
  if (!isWalletConnected) return true;
  return status === "ready"
    && Boolean(settlement?.homePlanetId)
    && Boolean(settlement?.planet)
    && Boolean(resources)
    && Boolean(homeCoords);
}

export function shouldShowTopBarEnergy(energy: EnergyBalance | undefined): energy is EnergyBalance {
  return Boolean(energy);
}

export function safeResourceNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    if (BigInt(value) > RESOURCE_DISPLAY_MAX) return undefined;
    return value;
  }

  if (!/^\d+$/.test(value)) return undefined;

  const parsed = BigInt(value);
  if (parsed > RESOURCE_DISPLAY_MAX || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(parsed);
}

export function safePlanetFields(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < FIELD_MIN || value > FIELD_MAX) return undefined;
  return value;
}

export function safePlanetTemperature(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < TEMPERATURE_MIN || value > TEMPERATURE_MAX) return undefined;
  return value;
}

export function displayDiameterKm(fields: number | undefined): string {
  if (fields === undefined) return "Unavailable";
  return `${integerFormatter.format(Math.round(Math.sqrt(fields) * 1_000))} km`;
}

export function displayTemperatureRange(temperature: number | undefined): string {
  if (temperature === undefined) return "Unavailable";
  return `${temperature - 20}°C to ${temperature + 20}°C`;
}

export function displayPlanetStats(
  settlement: WalletSettlementResponse | undefined,
  queues: PlayerQueuesResponse | undefined,
  usedFields: number,
  status: ChainLoadStatus,
): PlanetStatDisplay {
  if (status === "loading") {
    return {
      fields: "Loading",
      temperature: "Loading",
      diameter: "Loading",
      status: "Syncing",
    };
  }

  if (status === "error") {
    return {
      fields: "Unavailable",
      temperature: "Unavailable",
      diameter: "Unavailable",
      status: "API error",
    };
  }

  const planet = settlement?.planet;
  if (!planet) {
    return {
      fields: "Unavailable",
      temperature: "Unavailable",
      diameter: "Unavailable",
      status: status === "ready" ? "No game planet" : "Local",
    };
  }

  const fields = safePlanetFields(planet.fields);
  const temperature = safePlanetTemperature(planet.temperature);
  const active = Boolean(queues?.building?.active || queues?.research?.active || queues?.ship?.active);

  return {
    fields: fields === undefined ? "Unavailable" : `${integerFormatter.format(usedFields)} / ${integerFormatter.format(fields)}`,
    temperature: displayTemperatureRange(temperature),
    diameter: displayDiameterKm(fields),
    status: active ? "Active" : "Idle",
  };
}

export function buildingQueueAsset(key: BuildingKey): string | undefined {
  return buildingCatalog.find((building) => building.key === key)?.asset;
}

export function buildingQueueLabel(label: string, targetLevel: number | undefined): string {
  if (label === "Interdimensional Rift Stabilizer") return label;
  return targetLevel ? `${label} Level ${targetLevel}` : label;
}

export function buildingQueuePreview(queue: QueueStateResponse | null | undefined): {
  asset?: string | undefined;
  label: string;
} {
  const building = queue?.itemId === undefined
    ? undefined
    : buildingCatalog.find((item) => buildingContractIds[item.key] === queue.itemId);

  if (building) {
    return {
      asset: building.asset,
      label: buildingQueueLabel(building.label, queue?.targetLevel),
    };
  }

  const kind = queue?.kind === "building" || !queue?.kind ? "Building" : queue.kind;
  return { label: buildingQueueLabel(kind, queue?.targetLevel) };
}

export function queueProgressBarState({
  indeterminate,
  progress,
  remaining,
}: {
  indeterminate?: boolean | undefined;
  progress?: number | undefined;
  remaining: string;
}): {
  indeterminate: boolean;
  progress: number;
} {
  if (remaining === "Ready") {
    return {
      indeterminate: false,
      progress: 1,
    };
  }

  if (indeterminate) {
    return {
      indeterminate: true,
      progress: 0,
    };
  }

  return {
    indeterminate: false,
    progress: Math.min(1, Math.max(0, progress ?? 0)),
  };
}

export function queueProgressFillState({
  indeterminate,
  now,
  progress,
  readyAt,
  remaining,
  startedAt,
}: {
  indeterminate?: boolean | undefined;
  now: number;
  progress?: number | undefined;
  readyAt?: number | undefined;
  remaining: string;
  startedAt?: number | undefined;
}): {
  animated: boolean;
  durationMs: number;
  elapsedMs: number;
  progress: number;
} {
  const progressBar = queueProgressBarState({ indeterminate, progress, remaining });
  if (progressBar.indeterminate) {
    return { animated: false, durationMs: 0, elapsedMs: 0, progress: 0 };
  }

  const durationMs = typeof readyAt === "number" && typeof startedAt === "number"
    ? readyAt - startedAt
    : 0;
  const elapsedMs = typeof startedAt === "number" ? now - startedAt : 0;
  const hasCanonicalTimeline = durationMs > 0 && Number.isFinite(elapsedMs);
  const timelineProgress = hasCanonicalTimeline
    ? Math.min(1, Math.max(0, elapsedMs / durationMs))
    : progressBar.progress;

  return {
    animated: false,
    durationMs: hasCanonicalTimeline ? durationMs : 0,
    elapsedMs: hasCanonicalTimeline ? Math.min(durationMs, Math.max(0, elapsedMs)) : 0,
    progress: remaining === "Ready" ? 1 : timelineProgress,
  };
}
