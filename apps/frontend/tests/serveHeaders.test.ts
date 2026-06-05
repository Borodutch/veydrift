import { describe, expect, test } from "bun:test";
import { MINIAPP_ICON_PATH, miniAppIconAliasTarget } from "../iconAliases.mjs";
import { cacheControl, responseHeadersFor } from "../scripts/serve.mjs";

describe("frontend static server headers", () => {
  test("caches responsive game size variants with content type", () => {
    const headers = responseHeadersFor("/assets/game/sizes/64/style-pass/generated/ships/small-cargo.webp");

    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["cache-control"]).toBe("public, max-age=604800");
  });

  test("keeps HTML revalidating and hashed app assets immutable", () => {
    expect(cacheControl("/index.html")).toBe("no-cache");
    expect(cacheControl("/assets/index-a1b2c3.js")).toBe("public, max-age=31536000, immutable");
  });

  test("serves favicon and icon aliases from the generated miniapp icon", () => {
    for (const pathname of [
      "/favicon.ico",
      "/favicon.png",
      "/apple-touch-icon.png",
      "/icon.png",
      "/assets/favicon.ico",
      "/assets/favicon.png",
      "/assets/icon.png",
    ]) {
      expect(miniAppIconAliasTarget(pathname)).toBe(MINIAPP_ICON_PATH);
      expect(responseHeadersFor(pathname)).toEqual({
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      });
    }
  });
});
