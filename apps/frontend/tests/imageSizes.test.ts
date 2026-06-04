import { describe, expect, test } from "bun:test";
import { getImageDimensions, getSrcSet } from "../src/utils/imageSizes";

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
});
