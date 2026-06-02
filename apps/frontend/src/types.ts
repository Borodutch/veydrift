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
  alliance: AllianceIdentity | null;
  occupiedBy: OccupiedPlanet | null;
  debrisField: DebrisField | null;
  moonChance: MoonChanceReport | null;
  publicState?: PublicPlanetState | null;
  resources: Resources;
  temperature: { min: number; max: number };
  diameter: number;
  fields: number;
  hasMoon: boolean;
  moonName?: string;
}

export interface PublicPlanetState {
  resources?: {
    metal: string;
    crystal: string;
    deuterium: string;
  } | null;
  buildings?: Array<{ id: number; level: number }> | null;
  fleet?: Array<{ id: number; count: number }> | null;
  defenses?: Array<{ id: number; count: number }> | null;
  research?: Array<{ id: number; level: number }> | null;
  queues?: {
    building?: PublicQueueState | null;
    defense?: PublicQueueState | null;
    ship?: PublicQueueState | null;
    research?: PublicQueueState | null;
  } | null;
}

export interface PublicQueueState {
  active: boolean;
  kind: string | null;
  itemId?: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string | null;
  startedAt?: string | null;
}

export interface AllianceIdentity {
  allianceId: string;
  tag: string;
  name: string;
}

export interface OccupiedPlanet {
  planetId: string;
  owner: string;
  ownerDisplayName?: string | null;
  alliance?: AllianceIdentity | null;
}

export interface DebrisField {
  metal: number;
  crystal: number;
}

export type MoonChanceStatus =
  | "pending"
  | "created"
  | "not_created"
  | "existing_moon_skipped"
  | "moon_destruction_pending"
  | "moon_destroyed"
  | "moon_survived";

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
  moonDestroyed?: boolean;
  deathstarsDestroyed?: boolean;
  deathstars?: number;
  moonDestructionChanceBps?: number;
  deathstarDestructionChanceBps?: number;
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
