import { describe, expect, test } from "bun:test";
import { gameImageSrcSet, gameThumbnailSrc } from "../src/gameImageAssets";

describe("responsive game image helpers", () => {
  test("maps public game art to generated thumbnail paths", () => {
    const src = "/assets/game/style-pass/generated/planets/lush-temperate.webp";

    expect(gameThumbnailSrc(src, 160)).toBe(
      "/assets/game/thumbnails/w160/style-pass/generated/planets/lush-temperate.webp",
    );
    expect(gameImageSrcSet(src, [96, 160])).toBe(
      "/assets/game/thumbnails/w96/style-pass/generated/planets/lush-temperate.webp 96w, /assets/game/thumbnails/w160/style-pass/generated/planets/lush-temperate.webp 160w",
    );
  });

  test("leaves non-game and already-thumbnail paths unchanged", () => {
    expect(gameThumbnailSrc("/assets/miniapp/embed.png", 160)).toBe("/assets/miniapp/embed.png");
    expect(gameImageSrcSet("/assets/miniapp/embed.png", [160])).toBeUndefined();

    const thumbnail = "/assets/game/thumbnails/w160/ships/light-fighter.webp";
    expect(gameThumbnailSrc(thumbnail, 320)).toBe(thumbnail);
    expect(gameImageSrcSet(thumbnail, [320])).toBeUndefined();
  });
});
