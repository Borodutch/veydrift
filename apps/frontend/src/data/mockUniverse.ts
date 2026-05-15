import type { Planet, PlanetType, Resources } from "../types";

const PLANET_IMAGES: Record<PlanetType, string> = {
  "scorching-molten": "/assets/game/planets/scorching-molten.webp",
  "hot-desert": "/assets/game/planets/hot-desert.webp",
  "warm-terracotta": "/assets/game/planets/warm-terracotta.webp",
  "temperate-ocean": "/assets/game/planets/temperate-ocean.webp",
  "lush-temperate": "/assets/game/planets/lush-temperate.webp",
  "cool-misty-blue": "/assets/game/planets/cool-misty-blue.webp",
  "cold-tundra": "/assets/game/planets/cold-tundra.webp",
  "frozen-ice": "/assets/game/planets/frozen-ice.webp",
  "outer-cryo": "/assets/game/planets/outer-cryo.webp",
  "metal-planetoid": "/assets/game/planets/metal-planetoid.webp",
  "crystal-violet": "/assets/game/planets/crystal-violet.webp",
  "deuterium-blue": "/assets/game/planets/deuterium-blue.webp",
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

const PLAYER_NAMES = [
  "VoidWalker", "StarLord", "NebulaRider", "CosmicDrift", "BaseHunter",
  "ChainVoyager", "OrbitDancer", "AetherMage", "QuantumKnight", "DriftKing",
  null, null, null, null, null,
];

const ALLIANCE_NAMES = [
  "The Consortium", "Void Collective", "Starforged", "Base Cartel",
  "Drift Raiders", null, null, null,
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

export function generateSystem(galaxy: number, system: number): Planet[] {
  const planets: Planet[] = [];

  for (let position = 1; position <= 15; position++) {
    const seed = galaxy * 10000 + system * 100 + position;
    const hasPlanet = seededRandom(seed) > 0.35;
    if (!hasPlanet) continue;

    const type = pickPlanetType(position, seed + 1);
    const nameIdx = Math.floor(seededRandom(seed + 3) * PLANET_NAMES.length);
    const name = `${PLANET_NAMES[nameIdx]}-${galaxy}.${system}.${position}`;
    const player = pickFromSeed(seed + 5, PLAYER_NAMES);
    const alliance = player ? pickFromSeed(seed + 6, ALLIANCE_NAMES) : null;
    const hasMoon = seededRandom(seed + 8) > 0.85;
    const temperature = generateTemperature(position, seed + 9);
    const diameter = Math.floor(seededRandom(seed + 10) * 15000) + 5000;

    planets.push({
      id: `${galaxy}-${system}-${position}`,
      name,
      type,
      image: PLANET_IMAGES[type],
      position,
      galaxy,
      system,
      owner: player,
      ownerId: player ? `0x${seed.toString(16).padStart(40, "0")}` : null,
      alliance,
      resources: generateResources(type),
      temperature,
      diameter,
      hasMoon,
      ...(hasMoon ? { moonName: `${name} Moon` } : {}),
    });
  }

  return planets;
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
