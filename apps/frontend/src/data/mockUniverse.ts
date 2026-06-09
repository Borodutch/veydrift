import { isPlanetSlotPopulated, parsePlanetSlot } from "@veydrift/universe";
import type { DebrisField, MoonChanceReport, OccupiedPlanet, Planet, PlanetType, PublicPlanetState, Resources } from "../types";

const PLANET_IMAGES: Record<PlanetType, string> = {
  "scorching-molten": "/assets/game/style-pass/generated/planets/scorching-molten.webp",
  "hot-desert": "/assets/game/style-pass/generated/planets/hot-desert.webp",
  "warm-terracotta": "/assets/game/style-pass/generated/planets/warm-terracotta.webp",
  "temperate-ocean": "/assets/game/style-pass/generated/planets/temperate-ocean.webp",
  "lush-temperate": "/assets/game/style-pass/generated/planets/lush-temperate.webp",
  "cool-misty-blue": "/assets/game/style-pass/generated/planets/cool-misty-blue.webp",
  "cold-tundra": "/assets/game/style-pass/generated/planets/cold-tundra.webp",
  "frozen-ice": "/assets/game/style-pass/generated/planets/frozen-ice.webp",
  "outer-cryo": "/assets/game/style-pass/generated/planets/outer-cryo.webp",
  "metal-planetoid": "/assets/game/style-pass/generated/planets/metal-planetoid.webp",
  "crystal-violet": "/assets/game/style-pass/generated/planets/crystal-violet.webp",
  "deuterium-blue": "/assets/game/style-pass/generated/planets/deuterium-blue.webp",
};

const PLANET_NAMES = [
  "Aethelgard", "Boros", "Calth", "Draetheus", "Epsilon Prime",
  "Ferron", "Golgotha", "Helios", "Icarion", "Jotunheim",
  "Kronos", "Lyra", "Morpheus", "Nyx", "Orion",
  "Prometheus", "Quantum", "Ragnarok", "Solstice", "Tartarus",
  "Umbra", "Vortex", "Wraith", "Xenon", "Yggdrasil",
  "Zenith", "Aether", "Borealis", "Celestia", "Draconis",
  "Elysium", "Frost", "Gaia", "Hyperion", "Iridium",
  "Jade", "Kepler", "Lumina", "Meridian", "Nebula",
  "Obsidian", "Pulsar", "Quasar", "Rift", "Sable",
  "Titan", "Utopia", "Vega", "Wisp", "Xerxes",
];

const FRONTEND_UNIVERSE_SEED = "veydrift-mainnet-preview";

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pickFromSeed<T>(seed: number, arr: T[]): T {
  const idx = Math.floor(seededRandom(seed) * arr.length);
  return arr[idx]!;
}

function pickPlanetType(position: number, seed: number): PlanetType {
  const hot: PlanetType[] = ["scorching-molten", "hot-desert", "warm-terracotta"];
  const temperate: PlanetType[] = ["temperate-ocean", "lush-temperate"];
  const cool: PlanetType[] = ["cool-misty-blue", "cold-tundra"];
  const cold: PlanetType[] = ["frozen-ice", "outer-cryo"];
  const special: PlanetType[] = ["metal-planetoid", "crystal-violet", "deuterium-blue"];

  const types =
    position <= 3 ? hot
    : position <= 6 ? temperate
    : position <= 9 ? cool
    : position <= 12 ? cold
    : special;

  return pickFromSeed(seed, types);
}

function generateTemperature(position: number, seed: number): { min: number; max: number } {
  const base = position <= 3 ? 120 : position <= 6 ? 60 : position <= 9 ? 20 : position <= 12 ? -40 : -100;
  const spread = Math.floor(seededRandom(seed * 7) * 40) + 10;
  return { min: base - spread, max: base + spread };
}

function generateResources(type: PlanetType): Resources {
  switch (type) {
    case "metal-planetoid":
      return { metal: 250, crystal: 80, deuterium: 30, energy: 0 };
    case "crystal-violet":
      return { metal: 80, crystal: 250, deuterium: 30, energy: 0 };
    case "deuterium-blue":
      return { metal: 80, crystal: 50, deuterium: 220, energy: 0 };
    default:
      return { metal: 150, crystal: 120, deuterium: 80, energy: 0 };
  }
}

type ApiPlanet = {
  key?: string;
  galaxy: number;
  system: number;
  position: number;
  fields?: number;
  temperature?: number;
  metalMultiplierBps?: number;
  crystalMultiplierBps?: number;
  deuteriumMultiplierBps?: number;
  archetype?: PlanetType;
  occupiedBy?: OccupiedPlanet | null;
  publicState?: PublicPlanetState | null;
  debrisField?: {
    metal: string | number;
    crystal: string | number;
  } | null;
  moonChance?: MoonChanceReport | null;
};

export type SettlementPlanetIdentity = {
  planetId: string;
  owner: string;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
};

export type ApiSystemResponse = {
  galaxy: number;
  system: number;
  planets: ApiPlanet[];
};

export function planetsFromSystemResponse(payload: ApiSystemResponse): Planet[] {
  return payload.planets.flatMap((planet) => {
    const parsed = planetFromApi(planet);
    return parsed ? [parsed] : [];
  });
}

export function planetImageForType(type: PlanetType): string {
  return PLANET_IMAGES[type];
}

export function formatPlanetType(type: PlanetType): string {
  return type.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function planetTypeFromTemperature(temperature: number): PlanetType {
  if (temperature <= -35) return "frozen-ice";
  if (temperature <= -10) return "cold-tundra";
  if (temperature <= 10) return "temperate-ocean";
  if (temperature <= 25) return "lush-temperate";
  if (temperature <= 40) return "warm-terracotta";
  if (temperature <= 55) return "hot-desert";
  return "scorching-molten";
}

// Deterministic planet type for a set of coordinates — the exact derivation `planetFromCoordinates`
// uses, so the art matches the Galaxy thumbnail an uncharted planet shows at those coords (VEY-67).
// Used where only coordinates are known (e.g. Mission Control route cards, VEY-403).
export function planetTypeFromCoordinates(galaxy: number, system: number, position: number): PlanetType {
  const seed = galaxy * 10000 + system * 100 + position;
  return pickPlanetType(position, seed + 1);
}

export function planetImageFromCoordinates(galaxy: number, system: number, position: number): string {
  return planetImageForType(planetTypeFromCoordinates(galaxy, system, position));
}

export function generateSystem(galaxy: number, system: number): Planet[] {
  const planets: Planet[] = [];

  for (let position = 1; position <= 15; position++) {
    if (isFallbackPositionPopulated(galaxy, system, position)) {
      planets.push(planetFromCoordinates(galaxy, system, position));
    }
  }

  return planets;
}

export function ensurePlanetAtCoordinates(
  planets: Planet[],
  coordinates: { galaxy: number; system: number; position: number } | undefined
): Planet[] {
  if (!coordinates) return planets;
  if (planets.some((planet) => sameCoordinates(planet, coordinates))) return planets;

  return [...planets, planetFromCoordinates(coordinates.galaxy, coordinates.system, coordinates.position)]
    .sort((left, right) => left.position - right.position);
}

export function mergePlanetAtCoordinates(planets: Planet[], planet: Planet | undefined): Planet[] {
  if (!planet) return planets;

  const withoutExisting = planets.filter((candidate) => !sameCoordinates(candidate, planet));
  return [...withoutExisting, planet].sort((left, right) => left.position - right.position);
}

export function planetFromSettlementPlanet(planet: SettlementPlanetIdentity): Planet {
  const parsed = planetFromApi({
    key: `${planet.galaxy}:${planet.system}:${planet.position}`,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
    fields: planet.fields,
    temperature: planet.temperature,
    metalMultiplierBps: planet.metalMultiplierBps,
    crystalMultiplierBps: planet.crystalMultiplierBps,
    deuteriumMultiplierBps: planet.deuteriumMultiplierBps,
    archetype: planetTypeFromTemperature(planet.temperature),
    occupiedBy: {
      planetId: planet.planetId,
      owner: planet.owner,
    },
  });

  if (!parsed) {
    throw new Error("Settlement planet identity is missing required live fields.");
  }

  return parsed;
}

export function mergePlanetWithSettlement(planet: Planet, settlement: SettlementPlanetIdentity): Planet {
  const type = planetTypeFromTemperature(settlement.temperature);
  const existingOccupant = planet.occupiedBy?.owner.toLowerCase() === settlement.owner.toLowerCase()
    ? planet.occupiedBy
    : null;
  const alliance = existingOccupant?.alliance ?? planet.alliance ?? null;

  return {
    ...planet,
    type,
    image: planetImageForType(type),
    owner: settlement.owner,
    ownerId: settlement.owner,
    occupiedBy: {
      planetId: settlement.planetId,
      owner: settlement.owner,
      ownerDisplayName: existingOccupant?.ownerDisplayName ?? null,
      alliance,
    },
    alliance,
    fields: settlement.fields,
    temperature: { min: settlement.temperature - 20, max: settlement.temperature + 20 },
    diameter: Math.max(5_000, Math.round(Math.sqrt(settlement.fields) * 1_000)),
    resources: {
      metal: Math.round(settlement.metalMultiplierBps / 50),
      crystal: Math.round(settlement.crystalMultiplierBps / 50),
      deuterium: Math.round(settlement.deuteriumMultiplierBps / 50),
      energy: 0,
    },
  };
}

function planetFromApi(planet: ApiPlanet): Planet | null {
  const fields = finiteApiNumber(planet.fields);
  const temperature = finiteApiNumber(planet.temperature);
  const metalMultiplierBps = finiteApiNumber(planet.metalMultiplierBps);
  const crystalMultiplierBps = finiteApiNumber(planet.crystalMultiplierBps);
  const deuteriumMultiplierBps = finiteApiNumber(planet.deuteriumMultiplierBps);

  if (
    fields === undefined
    || temperature === undefined
    || metalMultiplierBps === undefined
    || crystalMultiplierBps === undefined
    || deuteriumMultiplierBps === undefined
  ) {
    return null;
  }

  const type = planet.archetype
    ?? planetTypeFromTemperature(temperature);
  const occupiedBy = planet.occupiedBy ?? null;
  const alliance = occupiedBy?.alliance ?? null;

  return {
    id: planet.key ?? `${planet.galaxy}-${planet.system}-${planet.position}`,
    name: `Planet ${planet.galaxy}.${planet.system}.${planet.position}`,
    type,
    image: PLANET_IMAGES[type],
    position: planet.position,
    galaxy: planet.galaxy,
    system: planet.system,
    owner: occupiedBy?.owner ?? null,
    ownerId: occupiedBy?.owner ?? null,
    alliance,
    occupiedBy,
    publicState: planet.publicState ?? null,
    debrisField: debrisFieldFromApi(planet.debrisField),
    moonChance: moonChanceFromApi(planet.moonChance),
    resources: resourcesFromMultipliers({
      metalMultiplierBps,
      crystalMultiplierBps,
      deuteriumMultiplierBps,
    }),
    temperature: { min: temperature - 20, max: temperature + 20 },
    diameter: Math.max(5_000, fields * 72),
    fields,
    hasMoon: false,
  };
}

function finiteApiNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value;
}

function debrisFieldFromApi(debrisField: ApiPlanet["debrisField"]): DebrisField | null {
  if (!debrisField) return null;
  const metal = Number(debrisField.metal);
  const crystal = Number(debrisField.crystal);
  if ((!Number.isFinite(metal) || metal <= 0) && (!Number.isFinite(crystal) || crystal <= 0)) {
    return null;
  }

  return {
    metal: Number.isFinite(metal) ? metal : 0,
    crystal: Number.isFinite(crystal) ? crystal : 0,
  };
}

function moonChanceFromApi(moonChance: ApiPlanet["moonChance"]): MoonChanceReport | null {
  if (!moonChance?.battleId || !moonChance.targetPlanetId || !moonChance.status) return null;
  return moonChance;
}

function resourcesFromMultipliers(planet: {
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
}): Resources {
  return {
    metal: Math.round(planet.metalMultiplierBps / 50),
    crystal: Math.round(planet.crystalMultiplierBps / 50),
    deuterium: Math.round(planet.deuteriumMultiplierBps / 50),
    energy: 0,
  };
}

export function getPlanet(
  galaxy: number,
  system: number,
  position: number
): Planet | null {
  if (!isFallbackPositionPopulated(galaxy, system, position)) return null;
  return planetFromCoordinates(galaxy, system, position);
}

export const GALAXY_COUNT = 9;
export const SYSTEM_COUNT = 499;
export const POSITION_COUNT = 15;

function planetFromCoordinates(galaxy: number, system: number, position: number): Planet {
  const seed = galaxy * 10000 + system * 100 + position;
  const type = pickPlanetType(position, seed + 1);
  const nameIdx = Math.floor(seededRandom(seed + 3) * PLANET_NAMES.length);
  const name = `${PLANET_NAMES[nameIdx]}-${galaxy}.${system}.${position}`;
  const hasMoon = seededRandom(seed + 8) > 0.85;
  const temperature = generateTemperature(position, seed + 9);
  const diameter = Math.floor(seededRandom(seed + 10) * 15000) + 5000;
  const fields = Math.floor(seededRandom(seed + 11) * 80) + 160;

  return {
    id: `${galaxy}-${system}-${position}`,
    name,
    type,
    image: PLANET_IMAGES[type],
    position,
    galaxy,
    system,
    owner: null,
    ownerId: null,
    alliance: null,
    occupiedBy: null,
    debrisField: null,
    moonChance: null,
    resources: generateResources(type),
    temperature,
    diameter,
    fields,
    hasMoon,
    ...(hasMoon ? { moonName: `${name} Moon` } : {}),
  };
}

function isFallbackPositionPopulated(galaxy: number, system: number, position: number): boolean {
  return isPlanetSlotPopulated({
    seed: FRONTEND_UNIVERSE_SEED,
    galaxyId: galaxy,
    systemId: system,
    slot: parsePlanetSlot(position)
  });
}

function sameCoordinates(
  planet: Planet,
  coordinates: { galaxy: number; system: number; position: number }
): boolean {
  return planet.galaxy === coordinates.galaxy
    && planet.system === coordinates.system
    && planet.position === coordinates.position;
}
