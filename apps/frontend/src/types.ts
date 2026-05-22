export interface Planet {
  id: string;
  name: string;
  type: PlanetType;
  image: string;
  position: number;
  galaxy: number;
  system: number;
  owner: string | null;
  ownerId: string | null;
  alliance: string | null;
  occupiedBy: OccupiedPlanet | null;
  debrisField: DebrisField | null;
  moonChance: MoonChanceReport | null;
  resources: Resources;
  temperature: { min: number; max: number };
  diameter: number;
  fields: number;
  hasMoon: boolean;
  moonName?: string;
}

export interface OccupiedPlanet {
  planetId: string;
  owner: string;
}

export interface DebrisField {
  metal: number;
  crystal: number;
}

export type MoonChanceStatus = "pending" | "created" | "not_created" | "existing_moon_skipped";

export interface MoonChanceReport {
  battleId: string;
  targetPlanetId: string;
  status: MoonChanceStatus;
  outcomeId?: string;
  chanceBps?: number;
  metalDebris?: string;
  crystalDebris?: string;
  randomnessRequestId?: string;
  moonCreated?: boolean;
  moonFields?: number;
  moonDiameterKm?: number;
}

export interface Resources {
  metal: number;
  crystal: number;
  deuterium: number;
  energy: number;
}

export type PlanetType =
  | "scorching-molten"
  | "hot-desert"
  | "warm-terracotta"
  | "temperate-ocean"
  | "lush-temperate"
  | "cool-misty-blue"
  | "cold-tundra"
  | "frozen-ice"
  | "outer-cryo"
  | "metal-planetoid"
  | "crystal-violet"
  | "deuterium-blue";

export type View = "home" | "universe" | "galaxy" | "planet";

export interface Coordinates {
  galaxy: number;
  system: number;
  position: number;
}
