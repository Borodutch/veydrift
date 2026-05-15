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
  const temperature = 20 - coordinates.position * 5 + Number((seed >> 8n) % 21n);
  const multipliers = planetMultipliers(temperature, fields);

  return {
    ...coordinates,
    key: `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`,
    fields,
    temperature,
    ...multipliers,
    archetype: archetypeForTemperature(temperature)
  };
}

export function systemSnapshot(
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): SystemSnapshot {
  return {
    generatorVersion: "veydrift-universe-v1",
    chainId,
    settlementContractAddress,
    galaxy,
    system,
    planets: Array.from({ length: maxPosition }, (_, index) =>
      planetMetadata(chainId, settlementContractAddress, {
        galaxy,
        system,
        position: index + 1
      })
    )
  };
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
  const temperatureIndex = temperature + 80;
  return {
    metalMultiplierBps: 9500 + ((temperatureIndex * 4) % 1000),
    crystalMultiplierBps: 9600 + ((fields * 3) % 800),
    deuteriumMultiplierBps: 10800 - temperatureIndex * 3
  };
}

function archetypeForTemperature(temperature: number): PlanetArchetype {
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
