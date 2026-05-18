import { listPopulatedPlanetSlots, listSlotProfiles, parsePlanetSlot } from "@veydrift/universe";
import type { PlanetSlot, PlanetSlotProfile } from "@veydrift/universe";

export type Coordinates = {
  galaxy: number;
  system: number;
  position: number;
};

export type PlanetMetadata = Coordinates & {
  key: string;
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
  archetype: PlanetArchetype;
};

export type PlanetArchetype =
  | "frozen-ice"
  | "cold-tundra"
  | "temperate-ocean"
  | "lush-temperate"
  | "warm-terracotta"
  | "hot-desert"
  | "scorching-molten";

export type SystemSnapshot = {
  generatorVersion: "veydrift-universe-v1";
  chainId: number;
  settlementContractAddress: string;
  galaxy: number;
  system: number;
  planets: PlanetMetadata[];
};

export const maxGalaxy = 9;
export const maxSystem = 499;
export const maxPosition = 15;

export function planetMetadata(
  chainId: number,
  settlementContractAddress: string,
  coordinates: Coordinates
): PlanetMetadata {
  validateCoordinates(coordinates);
  const seed = hashSeed(
    `${chainId}:${settlementContractAddress.toLowerCase()}:${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`
  );
  const fields = 160 + Number(seed % 80n);
  const temperature = midpointTemperatureForSlot(
    parsePlanetSlot(coordinates.position),
    seed >> 8n,
    seed >> 24n
  );
  const multipliers = planetMultipliers(temperature, fields);

  return {
    ...coordinates,
    key: `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`,
    fields,
    temperature,
    ...multipliers,
    archetype: planetArchetypeForTemperature(temperature)
  };
}

export function systemSnapshot(
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): SystemSnapshot {
  const seed = universeSeed(chainId, settlementContractAddress);

  return {
    generatorVersion: "veydrift-universe-v1",
    chainId,
    settlementContractAddress,
    galaxy,
    system,
    planets: listPopulatedPlanetSlots({
      seed,
      galaxyId: galaxy,
      systemId: system
    }).map((position) =>
      planetMetadata(chainId, settlementContractAddress, {
        galaxy,
        system,
        position
      })
    )
  };
}

export function populatedPositions(
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): readonly PlanetSlot[] {
  return listPopulatedPlanetSlots({
    seed: universeSeed(chainId, settlementContractAddress),
    galaxyId: galaxy,
    systemId: system
  });
}

export function validateCoordinates(coordinates: Coordinates): void {
  if (
    !Number.isInteger(coordinates.galaxy) ||
    coordinates.galaxy < 1 ||
    coordinates.galaxy > maxGalaxy ||
    !Number.isInteger(coordinates.system) ||
    coordinates.system < 1 ||
    coordinates.system > maxSystem ||
    !Number.isInteger(coordinates.position) ||
    coordinates.position < 1 ||
    coordinates.position > maxPosition
  ) {
    throw new Error("Invalid Veydrift coordinates.");
  }
}

export function planetMultipliers(
  temperature: number,
  fields: number
): Pick<PlanetMetadata, "metalMultiplierBps" | "crystalMultiplierBps" | "deuteriumMultiplierBps"> {
  const temperatureIndex = temperature + 180;
  return {
    metalMultiplierBps: 9500 + ((temperatureIndex * 4) % 1000),
    crystalMultiplierBps: 9600 + ((fields * 3) % 800),
    deuteriumMultiplierBps: 10800 - temperatureIndex * 3
  };
}

export function planetArchetypeForTemperature(temperature: number): PlanetArchetype {
  if (temperature <= -35) return "frozen-ice";
  if (temperature <= -10) return "cold-tundra";
  if (temperature <= 10) return "temperate-ocean";
  if (temperature <= 25) return "lush-temperate";
  if (temperature <= 40) return "warm-terracotta";
  if (temperature <= 55) return "hot-desert";
  return "scorching-molten";
}

function hashSeed(input: string): bigint {
  let hash = 14695981039346656037n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash;
}

function universeSeed(chainId: number, settlementContractAddress: string): string {
  return `${chainId}:${settlementContractAddress.toLowerCase()}`;
}

function midpointTemperatureForSlot(
  position: PlanetSlot,
  lowRoll: bigint,
  highRoll: bigint
): number {
  const maxTemperatureC = centeredMaxTemperatureForSlot(
    slotProfileForPosition(position),
    lowRoll,
    highRoll
  );
  return maxTemperatureC - 20;
}

function centeredMaxTemperatureForSlot(
  profile: PlanetSlotProfile,
  lowRoll: bigint,
  highRoll: bigint
): number {
  if (lowRoll <= highRoll) {
    return intInRange(profile.minMaxTemperatureC, profile.averageMaxTemperatureC, lowRoll);
  }

  return intInRange(profile.averageMaxTemperatureC, profile.maxMaxTemperatureC, highRoll);
}

function slotProfileForPosition(position: PlanetSlot): PlanetSlotProfile {
  const profile = listSlotProfiles()[position - 1];

  if (!profile) {
    throw new RangeError("Planet slot must be an integer from 1 to 15.");
  }

  return profile;
}

function intInRange(min: number, max: number, roll: bigint): number {
  const span = BigInt(max - min + 1);
  return min + Number(roll % span);
}
