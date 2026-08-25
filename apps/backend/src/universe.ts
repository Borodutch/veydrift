import { getSlotProfile, listPopulatedPlanetSlots } from "@veydrift/universe";
import type { PlanetSlot } from "@veydrift/universe";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";

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
  generatorVersion: "veydrift-universe-v2";
  chainId: number;
  settlementContractAddress: string;
  galaxy: number;
  system: number;
  planets: PlanetMetadata[];
};

export const maxGalaxy = 9;
export const maxSystem = 499;
export const maxPosition = 15;
const planetSeedDomain = keccak256(stringToHex("veydrift.planet.v1"));

export function planetMetadata(
  chainId: number,
  settlementContractAddress: string,
  coordinates: Coordinates
): PlanetMetadata {
  validateCoordinates(coordinates);
  const seed = planetSeed(chainId, coordinates);
  const fields = 160 + Number(seed % 80n);
  const temperature = slotTemperature(
    coordinates.position,
    (seed >> 16n) % 21n,
    (seed >> 24n) % 21n
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
    generatorVersion: "veydrift-universe-v2",
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
  fields;
  const deuteriumMultiplierBps = 12_800 - temperature * 20;
  return {
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: Math.max(0, deuteriumMultiplierBps)
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

function universeSeed(chainId: number, settlementContractAddress: string): string {
  return `${chainId}:${settlementContractAddress.toLowerCase()}`;
}

function planetSeed(chainId: number, coordinates: Coordinates): bigint {
  const encoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint8" }
    ],
    [
      planetSeedDomain,
      BigInt(Math.trunc(chainId)),
      coordinates.galaxy,
      coordinates.system,
      coordinates.position
    ]
  );
  return BigInt(keccak256(encoded));
}

function slotTemperature(
  position: number,
  lowRoll: bigint,
  highRoll: bigint
): number {
  const [minValue, maxValue] = slotMaxTemperatureProfile(position);
  return intInRange(minValue, maxValue, lowRoll + highRoll);
}

function slotMaxTemperatureProfile(position: number): readonly [number, number] {
  const profile = getSlotProfile(position as PlanetSlot);
  return [profile.minMaxTemperatureC, profile.maxMaxTemperatureC];
}

function intInRange(min: number, max: number, roll: bigint): number {
  const span = BigInt(max - min + 1);
  return min + Number(roll % span);
}
