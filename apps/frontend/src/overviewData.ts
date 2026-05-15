import type { PlayerQueuesResponse, WalletSettlementResponse } from "./walletFlow";

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
