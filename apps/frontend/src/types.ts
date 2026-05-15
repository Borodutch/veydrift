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
