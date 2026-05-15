import type { OccupiedPlanet, Planet, PlanetType, Resources } from "../types";

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
};

export type ApiSystemResponse = {
  galaxy: number;
  system: number;
  planets: ApiPlanet[];
};

export function planetsFromSystemResponse(payload: ApiSystemResponse): Planet[] {
  return payload.planets.map((planet) => planetFromApi(planet));
}

export function generateSystem(galaxy: number, system: number): Planet[] {
  const planets: Planet[] = [];

  for (let position = 1; position <= 15; position++) {
    const seed = galaxy * 10000 + system * 100 + position;
    const type = pickPlanetType(position, seed + 1);
    const nameIdx = Math.floor(seededRandom(seed + 3) * PLANET_NAMES.length);
    const name = `${PLANET_NAMES[nameIdx]}-${galaxy}.${system}.${position}`;
    const hasMoon = seededRandom(seed + 8) > 0.85;
    const temperature = generateTemperature(position, seed + 9);
    const diameter = Math.floor(seededRandom(seed + 10) * 15000) + 5000;
    const fields = Math.floor(seededRandom(seed + 11) * 80) + 160;

    planets.push({
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
      resources: generateResources(type),
      temperature,
      diameter,
      fields,
      hasMoon,
      ...(hasMoon ? { moonName: `${name} Moon` } : {}),
    });
  }

  return planets;
}

function planetFromApi(planet: ApiPlanet): Planet {
  const type = planet.archetype ?? pickPlanetType(planet.position, planet.galaxy * 10000 + planet.system * 100 + planet.position);
  const occupiedBy = planet.occupiedBy ?? null;
  const temperature = planet.temperature ?? 0;
  const fields = planet.fields ?? 180;

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
    alliance: null,
    occupiedBy,
    resources: resourcesFromMultipliers(planet),
    temperature: { min: temperature - 20, max: temperature + 20 },
    diameter: Math.max(5_000, fields * 72),
    fields,
    hasMoon: false,
  };
}

function resourcesFromMultipliers(planet: ApiPlanet): Resources {
  return {
    metal: Math.round((planet.metalMultiplierBps ?? 10_000) / 50),
    crystal: Math.round((planet.crystalMultiplierBps ?? 10_000) / 50),
    deuterium: Math.round((planet.deuteriumMultiplierBps ?? 10_000) / 50),
    energy: 0,
  };
}

export function getPlanet(
  galaxy: number,
  system: number,
  position: number
): Planet | null {
  const planets = generateSystem(galaxy, system);
  return planets.find((p) => p.position === position) || null;
}

export const GALAXY_COUNT = 5;
export const SYSTEM_COUNT = 200;
export const POSITION_COUNT = 15;
