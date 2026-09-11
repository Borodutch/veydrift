import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MOON_ANIMATION_VERSION, PLANET_ANIMATION_VERSION } from "../planetAnimationConfig";
import { moonImageForType } from "../src/gameAssets";
import type { PlanetType } from "../src/types";
import { getImageDimensions, getSizedImageSrc, getSrcSet } from "../src/utils/imageSizes";

const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

describe("responsive image size manifest", () => {
  test("serves srcset candidates from cached generated variants", () => {
    const src = "/assets/game/style-pass/generated/ships/small-cargo.webp";

    expect(getSrcSet(src)).toBe([
      "/assets/game/sizes/64/style-pass/generated/ships/small-cargo.webp 64w",
      "/assets/game/sizes/256/style-pass/generated/ships/small-cargo.webp 256w",
      "/assets/game/sizes/512/style-pass/generated/ships/small-cargo.webp 512w",
      "/assets/game/style-pass/generated/ships/small-cargo.webp 1024w",
    ].join(", "));
    expect(getImageDimensions(src)).toEqual({ width: 1024, height: 1024 });
  });

  test("does not synthesize responsive candidates for assets outside the variant manifest", () => {
    const src = "/assets/game/not-generated.webp";

    expect(getSrcSet(src)).toBe(src);
    expect(getImageDimensions(src)).toBeUndefined();
  });

  test("serves canonical typed moon animations through cached responsive variants", () => {
    const canonicalTypes: PlanetType[] = [
      "frozen-ice",
      "cold-tundra",
      "temperate-ocean",
      "lush-temperate",
      "warm-terracotta",
      "hot-desert",
      "scorching-molten",
    ];

    for (const type of canonicalTypes) {
      const src = moonImageForType(type);

      expect(src).toBe(`/assets/game/moon-animations/${type}.webp`);
      expect(getImageDimensions(src)).toEqual({ width: 1254, height: 1254 });
      expect(existsSync(join(PUBLIC_DIR, src.replace("/assets/", "assets/"))), type).toBe(true);

      for (const width of [64, 256, 512]) {
        expect(getSrcSet(src), type).toContain(`${src}?size=${width}&v=${MOON_ANIMATION_VERSION} ${width}w`);
      }
    }
  });

  test("requests explicit cached widths for animated planets", () => {
    const src = "/assets/game/planet-animations/scorching-molten.webp";

    expect(getSizedImageSrc(src, 256)).toBe(`${src}?size=256&v=${PLANET_ANIMATION_VERSION}`);
    expect(getSrcSet(src)).toBe([
      `${src}?size=64&v=${PLANET_ANIMATION_VERSION} 64w`,
      `${src}?size=256&v=${PLANET_ANIMATION_VERSION} 256w`,
      `${src}?size=512&v=${PLANET_ANIMATION_VERSION} 512w`,
    ].join(", "));
    expect(getImageDimensions(src)).toEqual({ width: 1024, height: 1024 });
    expect(() => getSizedImageSrc(src, 123)).toThrow("Unsupported animation width");
  });

  test("requests explicit cached widths for animated moons", () => {
    const src = "/assets/game/moon-animations/cratered-cyan-moon.webp";

    expect(getSizedImageSrc(src, 256)).toBe(`${src}?size=256&v=${MOON_ANIMATION_VERSION}`);
    expect(getSrcSet(src)).toBe([
      `${src}?size=64&v=${MOON_ANIMATION_VERSION} 64w`,
      `${src}?size=256&v=${MOON_ANIMATION_VERSION} 256w`,
      `${src}?size=512&v=${MOON_ANIMATION_VERSION} 512w`,
    ].join(", "));
    expect(getImageDimensions(src)).toEqual({ width: 1254, height: 1254 });
  });
});
