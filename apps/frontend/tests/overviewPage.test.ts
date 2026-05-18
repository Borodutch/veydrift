import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_HERO_IMAGE,
  overviewHeroImage,
} from "../src/overviewHeroImage";
import type { Planet } from "../src/types";

const homePlanet: Planet = {
  alliance: null,
  diameter: 12_000,
  fields: 180,
  galaxy: 1,
  hasMoon: false,
  id: "planet-1",
  image: "/assets/game/style-pass/generated/planets/cold-tundra.webp",
  name: "Vey Prime",
  occupiedBy: null,
  owner: "0x1111111111111111111111111111111111111111",
  ownerId: "0x1111111111111111111111111111111111111111",
  position: 7,
  resources: {
    crystal: 50,
    deuterium: 10,
    energy: 0,
    metal: 100,
  },
  system: 42,
  temperature: {
    max: 8,
    min: -32,
  },
  type: "cold-tundra",
};

describe("overview planet hero image", () => {
  test("uses the disconnected default only for local preview state", () => {
    expect(overviewHeroImage(undefined, false, undefined)).toBe(DISCONNECTED_HERO_IMAGE);
    expect(overviewHeroImage(undefined, true, undefined)).toBeUndefined();
  });

  test("keeps a real connected home image during rehydration", () => {
    expect(overviewHeroImage(homePlanet, true, undefined)).toBe(homePlanet.image);
    expect(overviewHeroImage(undefined, true, homePlanet.image)).toBe(homePlanet.image);
  });
});
