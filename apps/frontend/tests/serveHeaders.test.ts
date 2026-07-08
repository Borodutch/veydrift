import { describe, expect, test } from "bun:test";
import {
  buildReferralMiniAppEmbed,
  cacheControl,
  injectShareMeta,
  responseHeadersFor,
  routeMeta,
  shareRouteForUrl,
} from "../scripts/serve.mjs";

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

  test("detects referral invite links without validating or exposing invite state", async () => {
    const url = new URL("https://veydrift.com/?ref=SECRET-INVITE-CODE");
    const route = shareRouteForUrl(url);

    expect(route).toEqual({ kind: "referral" });

    const meta = await routeMeta(route!);

    expect(meta).toMatchObject({
      kind: "referral",
      title: "Join Veydrift with a boosted start",
      description: "Use an invite link for 2x starting resources. Your inviter earns rewards when you settle.",
      status: "INVITE BONUS",
      subtitle: "2x starting resources",
    });
    expect(JSON.stringify(meta)).not.toContain("SECRET-INVITE-CODE");
  });

  test("injects referral OG, Twitter, and Farcaster metadata", () => {
    const html = `
      <html>
        <head>
          <title>Veydrift</title>
          <meta name="description" content="Default" />
          <link rel="canonical" href="https://veydrift.com" />
          <meta property="og:title" content="Veydrift" />
          <meta property="og:description" content="Default" />
          <meta property="og:url" content="https://veydrift.com" />
          <meta property="og:image" content="https://veydrift.com/assets/og-image.jpg" />
          <meta property="og:image:secure_url" content="https://veydrift.com/assets/og-image.jpg" />
          <meta property="og:image:type" content="image/jpeg" />
          <meta name="twitter:title" content="Veydrift" />
          <meta name="twitter:description" content="Default" />
          <meta name="twitter:image" content="https://veydrift.com/assets/og-image.jpg" />
          <meta name="fc:miniapp" content='{}' />
          <meta name="fc:frame" content='{}' />
        </head>
      </html>
    `;

    const output = injectShareMeta(html, {
      canonicalUrl: "https://veydrift.com/?ref=SECRET-INVITE-CODE",
      description: "Use an invite link for 2x starting resources. Your inviter earns rewards when you settle.",
      imageUrl: "https://veydrift.com/og/referral.png",
      launchUrl: "https://veydrift.com/?ref=SECRET-INVITE-CODE&miniApp=true",
      title: "Join Veydrift with a boosted start",
    });

    expect(output).toContain('<meta property="og:image" content="https://veydrift.com/og/referral.png" />');
    expect(output).toContain('<meta property="og:image:type" content="image/png" />');
    expect(output).toContain('<meta name="twitter:image" content="https://veydrift.com/og/referral.png" />');
    expect(output).toContain("Accept invite");
    expect(output).toContain("SECRET-INVITE-CODE&amp;miniApp=true");
    expect(output).not.toContain("valid invite");
    expect(output).not.toContain("expired invite");
    expect(output).not.toContain("used invite");
  });

  test("builds a referral Mini App embed with a generic invite image", () => {
    expect(buildReferralMiniAppEmbed({
      imageUrl: "https://veydrift.com/og/referral.png",
      launchUrl: "https://veydrift.com/?ref=SECRET-INVITE-CODE&miniApp=true",
    })).toMatchObject({
      imageUrl: "https://veydrift.com/og/referral.png",
      button: {
        title: "Accept invite",
        action: {
          type: "launch_miniapp",
          url: "https://veydrift.com/?ref=SECRET-INVITE-CODE&miniApp=true",
        },
      },
    });
  });
});
