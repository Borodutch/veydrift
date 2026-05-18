import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_HERO_IMAGE,
  overviewHeroImage,
  planetCoordinateKey,
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
    expect(overviewHeroImage(undefined, false, undefined, undefined)).toBe(DISCONNECTED_HERO_IMAGE);
    expect(overviewHeroImage(undefined, true, undefined, undefined)).toBeUndefined();
  });

  test("keeps a real connected home image during same-planet rehydration", () => {
    const coordinateKey = planetCoordinateKey(homePlanet);
    const lastKnownHeroImage = { coordinateKey: coordinateKey!, image: homePlanet.image };

    expect(overviewHeroImage(homePlanet, true, undefined, coordinateKey)).toBe(homePlanet.image);
    expect(overviewHeroImage(undefined, true, lastKnownHeroImage, coordinateKey)).toBe(homePlanet.image);
  });

  test("does not reuse a last-known image for a different connected planet", () => {
    const lastKnownHeroImage = {
      coordinateKey: planetCoordinateKey(homePlanet)!,
      image: homePlanet.image,
    };

    expect(overviewHeroImage(undefined, true, lastKnownHeroImage, "1:42:8")).toBeUndefined();
  });
});
