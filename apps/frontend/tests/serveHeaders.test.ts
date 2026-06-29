import { describe, expect, test } from "bun:test";
import { cacheControl, responseHeadersFor, routeMeta } from "../scripts/serve.mjs";

describe("frontend static server headers", () => {
  test("caches responsive game size variants with content type", () => {
    const headers = responseHeadersFor("/assets/game/sizes/64/style-pass/generated/ships/small-cargo.webp");

    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("keeps HTML revalidating and hashed app assets immutable", () => {
    expect(cacheControl("/index.html")).toBe("no-cache");
    expect(cacheControl("/assets/index-a1b2c3.js")).toBe("public, max-age=31536000, immutable");
  });

  test("serves raw docs markdown with a markdown content type", () => {
    expect(responseHeadersFor("/docs.md")["content-type"]).toBe("text/markdown; charset=utf-8");
  });

  test("falls back quickly when mission share metadata is slow", async () => {
    const originalFetch = globalThis.fetch;
    const originalTimeout = process.env.VEYDRIFT_OG_METADATA_TIMEOUT_MS;
    process.env.VEYDRIFT_OG_METADATA_TIMEOUT_MS = "20";

    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error(`aborted ${String(input)}`)), { once: true });
      });
    }) as typeof fetch;

    try {
      const startedAt = Date.now();
      const meta = await routeMeta({ kind: "mission", id: "609609" });

      expect(Date.now() - startedAt).toBeLessThan(250);
      expect(meta).toMatchObject({
        kind: "mission",
        title: "Mission #609609",
        description: "Veydrift",
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTimeout === undefined) delete process.env.VEYDRIFT_OG_METADATA_TIMEOUT_MS;
      else process.env.VEYDRIFT_OG_METADATA_TIMEOUT_MS = originalTimeout;
    }
  });

  test("builds fallback metadata for moon share routes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    try {
      const meta = await routeMeta({ kind: "moon", galaxy: 6, system: 9, position: 1 });
      expect(meta).toMatchObject({
        kind: "moon",
        title: "Moon 6:9:1",
        status: "MOON",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
