import type { DebrisField, MigrationReservation, MoonChanceReport, OccupiedPlanet, Planet, PlanetType, PublicMoonState, PublicPlanetState, Resources } from "../types";

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

export type ApiPlanet = {
  key?: string;
  name?: string | null | undefined;
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
  migrationReservation?: MigrationReservation | null;
  publicState?: PublicPlanetState | null;
  publicMoonState?: PublicMoonState | null;
  debrisField?: {
    metal: string | number;
    crystal: string | number;
  } | null;
  moonChance?: MoonChanceReport | null;
  hasMoon?: boolean | undefined;
};

export type SettlementPlanetIdentity = {
  planetId: string;
  name?: string | null | undefined;
  owner: string;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
  moon?: {
    exists: boolean;
  } | null;
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

// Planet artwork is a coordinate/slot property. Temperature remains an economic and climate-label
// input, but its absolute Celsius value spans a different range in every classic slot and therefore
// must not select the art family. Prefer coordinates whenever they exist so stale backend archetypes
// from the pre-classic temperature scale cannot make every inner/middle planet look molten.
// Backend archetypes remain a compatibility fallback only for historical records without coordinates.
export function planetArtTypeForCoordinates(
  coords: { galaxy: number; position: number; system: number },
): PlanetType {
  return planetTypeFromCoordinates(coords.galaxy, coords.system, coords.position);
}

// Shared planet-art-type resolution for mission/inspect surfaces. A backend archetype is retained
// only as a last-resort compatibility fallback for incomplete historical records with no coordinates.
// Used by both the Mission Control cards and the Mission detail Route so the two stay in lockstep.
// Returns null only when no planet can be resolved at all (e.g. an attacker with no coordinates).
export function planetArtTypeFromArchetypeOrCoords(
  archetype: PlanetType | null | undefined,
  coords: { galaxy: number; position: number; system: number } | null,
): PlanetType | null {
  return coords ? planetArtTypeForCoordinates(coords) : archetype ?? null;
}

export function formatPlanetType(type: PlanetType): string {
  return type.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// Deterministic planet art-type from coordinates alone. Used only for visuals when a real
// archetype/temperature is unavailable — e.g. uncharted colonization targets — so a card can still
// show planet art by type (VEY-403). It never fabricates planet data such as names, owners,
// resources, or stats; those always come from the live universe API.
export function planetTypeFromCoordinates(galaxy: number, system: number, position: number): PlanetType {
  const seed = galaxy * 10000 + system * 100 + position;
  return pickPlanetType(position, seed + 1);
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

export function mergePlanetAtCoordinates(planets: Planet[], planet: Planet | undefined): Planet[] {
  if (!planet) return planets;

  const withoutExisting = planets.filter((candidate) => !sameCoordinates(candidate, planet));
  return [...withoutExisting, planet].sort((left, right) => left.position - right.position);
}

export function planetFromSettlementPlanet(planet: SettlementPlanetIdentity): Planet {
  const parsed = planetFromApi({
    key: `${planet.galaxy}:${planet.system}:${planet.position}`,
    name: planet.name,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
    fields: planet.fields,
    temperature: planet.temperature,
    metalMultiplierBps: planet.metalMultiplierBps,
    crystalMultiplierBps: planet.crystalMultiplierBps,
    deuteriumMultiplierBps: planet.deuteriumMultiplierBps,
    occupiedBy: {
      planetId: planet.planetId,
      owner: planet.owner,
    },
    hasMoon: Boolean(planet.moon?.exists),
  });

  if (!parsed) {
    throw new Error("Settlement planet identity is missing required live fields.");
  }

  return parsed;
}

export function mergePlanetWithSettlement(planet: Planet, settlement: SettlementPlanetIdentity): Planet {
  const type = planetArtTypeForCoordinates(settlement);
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
    hasMoon: Boolean(settlement.moon?.exists) || planet.hasMoon,
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

  const type = planetArtTypeForCoordinates(planet);
  const occupiedBy = planet.occupiedBy ?? null;
  const alliance = occupiedBy?.alliance ?? null;

  return {
    id: planet.key ?? `${planet.galaxy}-${planet.system}-${planet.position}`,
    name: planet.name?.trim() || `Planet ${planet.galaxy}.${planet.system}.${planet.position}`,
    type,
    image: PLANET_IMAGES[type],
    position: planet.position,
    galaxy: planet.galaxy,
    system: planet.system,
    owner: occupiedBy?.owner ?? null,
    ownerId: occupiedBy?.owner ?? null,
    alliance,
    occupiedBy,
    migrationReservation: planet.migrationReservation ?? null,
    publicState: planet.publicState ?? null,
    publicMoonState: planet.publicMoonState ?? null,
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
    hasMoon: Boolean(planet.hasMoon),
    ...(planet.hasMoon ? { moonName: "Moon" } : {}),
    metalMultiplierBps,
    crystalMultiplierBps,
    deuteriumMultiplierBps,
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

export const GALAXY_COUNT = 9;
export const SYSTEM_COUNT = 499;
export const POSITION_COUNT = 15;

function sameCoordinates(
  planet: Planet,
  coordinates: { galaxy: number; system: number; position: number }
): boolean {
  return planet.galaxy === coordinates.galaxy
    && planet.system === coordinates.system
    && planet.position === coordinates.position;
}
