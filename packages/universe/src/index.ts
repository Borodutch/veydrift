export type PlanetSlot =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

export type PlanetBiome =
  | "desert"
  | "dry"
  | "normal"
  | "jungle"
  | "water"
  | "ice"
  | "gas";

export type PlanetRarity = "common" | "uncommon" | "rare" | "epic";

export type UniverseCoordinates = {
  galaxyId: number;
  systemId: number;
  slot: PlanetSlot;
};

export type PlanetResourceBias = {
  metalBonusBps: number;
  crystalBonusBps: number;
  deuteriumFormulaBps: number;
  solarSatelliteEnergy: number;
};

export type GeneratedPlanet = UniverseCoordinates & {
  id: string;
  fields: number;
  diameterKm: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  resourceBias: PlanetResourceBias;
  biome: PlanetBiome;
  rarity: PlanetRarity;
  settleable: boolean;
  visualAssetHint: string;
};

export type GeneratedSystem = {
  id: string;
  galaxyId: number;
  systemId: number;
  seedFingerprint: string;
  slots: GeneratedPlanet[];
};

export type GeneratedGalaxy = {
  id: string;
  galaxyId: number;
  systemCount: number;
  seedFingerprint: string;
  systems: GeneratedSystem[];
};

export type GenerateSystemInput = {
  seed: string;
  galaxyId: number;
  systemId: number;
};

export type GenerateGalaxyInput = {
  seed: string;
  galaxyId: number;
  systemCount?: number;
};

export type PlanetSlotProfile = {
  slot: PlanetSlot;
  minFields: number;
  averageFields: number;
  maxFields: number;
  minMaxTemperatureC: number;
  averageMaxTemperatureC: number;
  maxMaxTemperatureC: number;
  crystalBonusBps: number;
  metalBonusBps: number;
};

const SLOT_PROFILES: readonly PlanetSlotProfile[] = [
  slotProfile(1, 96, 134, 172, 220, 240, 260, 4000, 0),
  slotProfile(2, 104, 140, 176, 170, 190, 210, 3000, 0),
  slotProfile(3, 112, 147, 182, 120, 140, 160, 2000, 0),
  slotProfile(4, 118, 163, 208, 70, 90, 110, 0, 0),
  slotProfile(5, 133, 182, 232, 60, 80, 100, 0, 0),
  slotProfile(6, 146, 194, 242, 50, 70, 90, 0, 1700),
  slotProfile(7, 152, 200, 248, 40, 60, 80, 0, 2300),
  slotProfile(8, 156, 204, 252, 30, 50, 70, 0, 3500),
  slotProfile(9, 150, 198, 246, 20, 40, 60, 0, 2300),
  slotProfile(10, 142, 187, 232, 10, 30, 50, 0, 1700),
  slotProfile(11, 136, 173, 210, 0, 20, 40, 0, 0),
  slotProfile(12, 125, 156, 186, -10, 10, 30, 0, 0),
  slotProfile(13, 114, 143, 172, -50, -30, -10, 0, 0),
  slotProfile(14, 100, 134, 168, -90, -70, -50, 0, 0),
  slotProfile(15, 90, 127, 164, -130, -110, -90, 0, 0)
] as const;

const PLANET_SLOTS = SLOT_PROFILES.map((profile) => profile.slot);
const DEFAULT_SYSTEM_COUNT = 499;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export const universeDefaults = {
  systemCount: DEFAULT_SYSTEM_COUNT,
  slotsPerSystem: PLANET_SLOTS.length
} as const;

export function generateGalaxy(input: GenerateGalaxyInput): GeneratedGalaxy {
  const systemCount = input.systemCount ?? DEFAULT_SYSTEM_COUNT;

  assertNonNegativeInteger("galaxyId", input.galaxyId);
  assertPositiveInteger("systemCount", systemCount);

  const systems: GeneratedSystem[] = [];
  for (let systemId = 1; systemId <= systemCount; systemId += 1) {
    systems.push(
      generateSystem({
        seed: input.seed,
        galaxyId: input.galaxyId,
        systemId
      })
    );
  }

  return {
    id: galaxyIdentity(input.seed, input.galaxyId),
    galaxyId: input.galaxyId,
    systemCount,
    seedFingerprint: seedFingerprint(input.seed),
    systems
  };
}

export function generateSystem(input: GenerateSystemInput): GeneratedSystem {
  assertNonNegativeInteger("galaxyId", input.galaxyId);
  assertPositiveInteger("systemId", input.systemId);

  const slots = PLANET_SLOTS.map((slot) =>
    generatePlanet({
      seed: input.seed,
      galaxyId: input.galaxyId,
      systemId: input.systemId,
      slot
    })
  );

  return {
    id: systemIdentity(input.seed, input.galaxyId, input.systemId),
    galaxyId: input.galaxyId,
    systemId: input.systemId,
    seedFingerprint: seedFingerprint(input.seed),
    slots
  };
}

export function generatePlanet(
  seed: string,
  coordinates: UniverseCoordinates
): GeneratedPlanet;
export function generatePlanet(
  input: { seed: string } & UniverseCoordinates
): GeneratedPlanet;
export function generatePlanet(
  seedOrInput: string | ({ seed: string } & UniverseCoordinates),
  maybeCoordinates?: UniverseCoordinates
): GeneratedPlanet {
  const input =
    typeof seedOrInput === "string"
      ? {
          seed: seedOrInput,
          ...mustHaveCoordinates(maybeCoordinates)
        }
      : seedOrInput;

  assertNonNegativeInteger("galaxyId", input.galaxyId);
  assertPositiveInteger("systemId", input.systemId);

  const profile = getSlotProfile(input.slot);
  const stream = rngStream(input.seed, input.galaxyId, input.systemId, input.slot);
  const fields = centeredRange(
    profile.minFields,
    profile.averageFields,
    profile.maxFields,
    stream("fields-low"),
    stream("fields-high")
  );
  const maxTemperatureC = centeredRange(
    profile.minMaxTemperatureC,
    profile.averageMaxTemperatureC,
    profile.maxMaxTemperatureC,
    stream("temp-low"),
    stream("temp-high")
  );
  const minTemperatureC = maxTemperatureC - 40;
  const biome = biomeForSlot(input.slot, input.systemId);
  const rarity = rarityFromRoll(stream("rarity"));
  const visualVariant = intInRange(1, 10, stream("visual-variant"));

  return {
    id: planetIdentity(input.seed, input.galaxyId, input.systemId, input.slot),
    galaxyId: input.galaxyId,
    systemId: input.systemId,
    slot: input.slot,
    fields,
    diameterKm: diameterFromFields(fields),
    minTemperatureC,
    maxTemperatureC,
    resourceBias: {
      metalBonusBps: profile.metalBonusBps,
      crystalBonusBps: profile.crystalBonusBps,
      deuteriumFormulaBps: deuteriumFormulaBps(maxTemperatureC),
      solarSatelliteEnergy: solarSatelliteEnergy(maxTemperatureC)
    },
    biome,
    rarity,
    settleable: true,
    visualAssetHint: `planet-${biome}-${visualVariant}`
  };
}

export function listSlotProfiles(): readonly PlanetSlotProfile[] {
  return SLOT_PROFILES;
}

export function isPlanetSlot(slot: number): slot is PlanetSlot {
  return Number.isInteger(slot) && slot >= 1 && slot <= 15;
}

export function parsePlanetSlot(slot: string | number): PlanetSlot {
  const numericSlot = typeof slot === "string" ? Number.parseInt(slot, 10) : slot;

  if (!isPlanetSlot(numericSlot)) {
    throw new RangeError("Planet slot must be an integer from 1 to 15.");
  }

  return numericSlot;
}

function slotProfile(
  slot: PlanetSlot,
  minFields: number,
  averageFields: number,
  maxFields: number,
  minMaxTemperatureC: number,
  averageMaxTemperatureC: number,
  maxMaxTemperatureC: number,
  crystalBonusBps: number,
  metalBonusBps: number
): PlanetSlotProfile {
  return {
    slot,
    minFields,
    averageFields,
    maxFields,
    minMaxTemperatureC,
    averageMaxTemperatureC,
    maxMaxTemperatureC,
    crystalBonusBps,
    metalBonusBps
  };
}

function getSlotProfile(slot: PlanetSlot): PlanetSlotProfile {
  const profile = SLOT_PROFILES[slot - 1];

  if (!profile) {
    throw new RangeError("Planet slot must be an integer from 1 to 15.");
  }

  return profile;
}

function rngStream(
  seed: string,
  galaxyId: number,
  systemId: number,
  slot: PlanetSlot
): (domain: string) => bigint {
  return (domain: string) =>
    hash64(`veydrift:v1:${domain}:${seed}:galaxy:${galaxyId}:system:${systemId}:slot:${slot}`);
}

function centeredRange(
  min: number,
  average: number,
  max: number,
  lowRoll: bigint,
  highRoll: bigint
): number {
  if (lowRoll <= highRoll) {
    return intInRange(min, average, lowRoll);
  }

  return intInRange(average, max, highRoll);
}

function intInRange(min: number, max: number, roll: bigint): number {
  const span = BigInt(max - min + 1);
  return min + Number(roll % span);
}

function biomeForSlot(slot: PlanetSlot, systemId: number): PlanetBiome {
  const oddSystemBiomes: readonly PlanetBiome[] = [
    "dry",
    "dry",
    "dry",
    "normal",
    "normal",
    "jungle",
    "jungle",
    "water",
    "water",
    "ice",
    "ice",
    "gas",
    "gas",
    "normal",
    "normal"
  ];
  const evenSystemBiomes: readonly PlanetBiome[] = [
    "desert",
    "desert",
    "desert",
    "dry",
    "dry",
    "normal",
    "normal",
    "jungle",
    "jungle",
    "water",
    "water",
    "ice",
    "ice",
    "gas",
    "gas"
  ];
  const biomes = systemId % 2 === 0 ? evenSystemBiomes : oddSystemBiomes;
  const biome = biomes[slot - 1];

  if (!biome) {
    throw new RangeError("Planet slot must be an integer from 1 to 15.");
  }

  return biome;
}

function rarityFromRoll(roll: bigint): PlanetRarity {
  const value = Number(roll % 10_000n);

  if (value < 100) {
    return "epic";
  }

  if (value < 700) {
    return "rare";
  }

  if (value < 2_200) {
    return "uncommon";
  }

  return "common";
}

function diameterFromFields(fields: number): number {
  return Math.round(Math.sqrt(fields) * 1_000);
}

function deuteriumFormulaBps(maxTemperatureC: number): number {
  return 12_800 - 20 * maxTemperatureC;
}

function solarSatelliteEnergy(maxTemperatureC: number): number {
  return Math.max(1, Math.min(65, Math.floor((maxTemperatureC + 140) / 6)));
}

function seedFingerprint(seed: string): string {
  return hash64Hex(`veydrift:v1:seed:${seed}`);
}

function galaxyIdentity(seed: string, galaxyId: number): string {
  return `galaxy-${galaxyId}-${hash64Hex(`veydrift:v1:galaxy:${seed}:${galaxyId}`)}`;
}

function systemIdentity(seed: string, galaxyId: number, systemId: number): string {
  return `system-${galaxyId}-${systemId}-${hash64Hex(
    `veydrift:v1:system:${seed}:${galaxyId}:${systemId}`
  )}`;
}

function planetIdentity(
  seed: string,
  galaxyId: number,
  systemId: number,
  slot: PlanetSlot
): string {
  return `planet-${galaxyId}-${systemId}-${slot}-${hash64Hex(
    `veydrift:v1:planet:${seed}:${galaxyId}:${systemId}:${slot}`
  )}`;
}

function hash64Hex(input: string): string {
  return hash64(input).toString(16).padStart(16, "0");
}

function hash64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }

  return hash;
}

function mustHaveCoordinates(
  coordinates: UniverseCoordinates | undefined
): UniverseCoordinates {
  if (!coordinates) {
    throw new TypeError("Universe coordinates are required.");
  }

  return coordinates;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}
