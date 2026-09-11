export const PLANET_ANIMATION_VERSION = "20260911-3";
export const PLANET_ANIMATION_WIDTHS = [64, 256, 512, 1024] as const;
export const PLANET_ANIMATION_BASE = "/assets/game/planet-animations";

export const PLANET_ANIMATION_TYPES = [
  "cold-tundra",
  "cool-misty-blue",
  "crystal-violet",
  "deuterium-blue",
  "frozen-ice",
  "hot-desert",
  "lush-temperate",
  "metal-planetoid",
  "outer-cryo",
  "scorching-molten",
  "temperate-ocean",
  "warm-terracotta",
] as const;

export const MOON_ANIMATION_VERSION = "20260911-1";
export const MOON_ANIMATION_WIDTHS = PLANET_ANIMATION_WIDTHS;
export const MOON_ANIMATION_BASE = "/assets/game/moon-animations";
export const MOON_ANIMATION_MASTER_WIDTH = 1254;

export const MOON_ANIMATION_TYPES = [
  "cold-tundra",
  "cratered-cyan-moon",
  "frozen-ice",
  "hot-desert",
  "lush-temperate",
  "scorching-molten",
  "temperate-ocean",
  "warm-terracotta",
] as const;
