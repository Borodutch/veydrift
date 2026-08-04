import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import {
  buildReferralMiniAppEmbed,
  cacheControl,
  canonicalSharePathForRoute,
  injectShareMeta,
  imageRouteForPathname,
  gameAppRouteForPathname,
  inviteAppRouteForPathname,
  ogPng,
  ogSvg,
  referralOgLayout,
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

  test("treats clean invite URLs as app routes", () => {
    expect(inviteAppRouteForPathname("/invite")).toBe(true);
    expect(inviteAppRouteForPathname("/alliance-invites")).toBe(true);
    expect(inviteAppRouteForPathname("/alliance")).toBe(false);
  });

  test("serves every clean page URL through the frontend app", () => {
    const routes = [
      "/overview",
      "/infrastructure",
      "/defenses",
      "/research",
      "/shipyard",
      "/mission-control",
      "/moon",
      "/alliance",
      "/rift",
      "/rankings",
      "/galaxy",
      "/raid-target-finder",
      "/planet",
      "/battle-reports",
    ];

    for (const route of routes) expect(gameAppRouteForPathname(route)).toBe(true);
    expect(gameAppRouteForPathname("/rankings/")).toBe(true);
    expect(gameAppRouteForPathname("/missing")).toBe(false);
  });

  test("keeps referral canonical URLs clean while ignoring Card cache parameters", () => {
    const route = { kind: "referral", code: "borodutch" } as const;
    expect(canonicalSharePathForRoute(
      route,
      new URL("https://veydrift.com/?ref=borodutch&x_card=2&utm_source=x"),
    )).toBe("/?ref=borodutch");
    expect(canonicalSharePathForRoute(
      route,
      new URL("https://veydrift.com/?ref=borodutch&x_card=stale"),
    )).toBe("/?ref=borodutch");
  });

  test("does not expose the retired CCA page or social image routes", () => {
    expect(shareRouteForUrl(new URL("https://veydrift.com/cca"))).toBeNull();
    expect(imageRouteForPathname("/og/cca.png")).toBeNull();
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

  test("builds code-specific metadata and OG routes for referral links", async () => {
    const url = new URL("https://veydrift.com/?ref=SECRET-INVITE-CODE");
    const route = shareRouteForUrl(url);

    expect(route).toEqual({ kind: "referral", code: "secret-invite-code" });
    expect(imageRouteForPathname("/og/referral/secret-invite-code.png"))
      .toEqual({ kind: "referral", code: "secret-invite-code" });

    const meta = await routeMeta(route!);

    expect(meta).toMatchObject({
      kind: "referral",
      title: "Join Veydrift with secret-invite-code",
      description: "Use invite code secret-invite-code. Eligibility and exact benefits are verified in-game before settlement.",
      status: "CODE secret-invite-code",
      supportingCopy: "Use this code to start with 2× resources",
      subtitle: "",
      footer: "veydrift.com",
    });
    expect(JSON.stringify(meta)).toContain("secret-invite-code");

    const svg = await ogSvg(meta);
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain(">Veydrift Invite</text>");
    expect(svg).not.toContain(">Invite link</text>");
    expect(svg).not.toContain(">Veydrift</text>");
    expect(svg).not.toContain("Invite code:");
    expect(svg.match(/>CODE SECRET-INVITE-CODE<\/text>/g)).toHaveLength(1);
    expect(svg.match(/>Use this code to start with 2× resources<\/text>/g)).toHaveLength(1);
    expect(svg).toContain(">veydrift.com</text>");
    expect(svg).not.toContain('clip-path="url(#singlePlanet)"');
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg).toContain(`font-size="${referralOgLayout.titleFontSize}"`);

    expect(referralOgLayout.planetLeft - referralOgLayout.titleSafeRight)
      .toBeGreaterThanOrEqual(referralOgLayout.minimumTitlePlanetGap);
    expect(referralOgLayout.planetLeft - referralOgLayout.codeSafeRight)
      .toBeGreaterThanOrEqual(referralOgLayout.minimumTitlePlanetGap);
    expect(referralOgLayout.planetLeft - referralOgLayout.supportingSafeRight)
      .toBeGreaterThanOrEqual(referralOgLayout.minimumTitlePlanetGap);
    expect(referralOgLayout.titleSafeBottom).toBeLessThan(referralOgLayout.codeTop);
    expect(referralOgLayout.codeBottom).toBeLessThan(referralOgLayout.supportingTop);
    expect(referralOgLayout.supportingBottom).toBeLessThan(referralOgLayout.footerTop);

    const png = await ogPng(meta);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(100_000);

    const titleOnlyPng = await sharp(Buffer.from(await ogSvg(meta, { omitReferralVisual: true })))
      .png()
      .toBuffer();
    const titleOnly = await referralTitlePixels(titleOnlyPng);
    const composite = await referralTitlePixels(png);

    expect(titleOnly.maxX).toBeLessThanOrEqual(referralOgLayout.titleSafeRight);
    expect(composite).toMatchObject({
      minX: titleOnly.minX,
      maxX: titleOnly.maxX,
      minY: titleOnly.minY,
      maxY: titleOnly.maxY,
    });
    expect(Math.abs(composite.count - titleOnly.count)).toBeLessThanOrEqual(16);

    const supportingCopy = await referralTextPixels(png, {
      top: referralOgLayout.supportingTop,
      bottom: referralOgLayout.supportingBottom,
    });
    expect(supportingCopy.count).toBeGreaterThan(1_000);
    expect(supportingCopy.maxX).toBeLessThanOrEqual(referralOgLayout.supportingSafeRight);
    expect(supportingCopy.minY).toBeGreaterThanOrEqual(referralOgLayout.supportingTop);
    expect(supportingCopy.maxY).toBeLessThanOrEqual(referralOgLayout.supportingBottom);

    const wideTitle = await referralTitlePixels(await ogPng({
      ...meta,
      imageTitle: "WWWWWWWWWWWWWWWWWWWWWWWWWW",
    }));
    expect(wideTitle.maxX).toBeLessThanOrEqual(referralOgLayout.titleSafeRight);
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
          <meta property="og:image:alt" content="Veydrift" />
          <meta name="twitter:title" content="Veydrift" />
          <meta name="twitter:description" content="Default" />
          <meta name="twitter:image" content="https://veydrift.com/assets/og-image.jpg" />
          <meta name="twitter:image:alt" content="Veydrift" />
          <meta name="fc:miniapp" content='{}' />
          <meta name="fc:frame" content='{}' />
        </head>
      </html>
    `;

    const output = injectShareMeta(html, {
      canonicalUrl: "https://veydrift.com/?ref=SECRET-INVITE-CODE",
      description: "Open this Veydrift invite. Referral eligibility and exact benefits are verified in-game before settlement.",
      imageUrl: "https://veydrift.com/og/referral/secret-invite-code.png",
      launchUrl: "https://veydrift.com/?ref=SECRET-INVITE-CODE&miniApp=true",
      title: "Join Veydrift with secret-invite-code",
    });

    expect(output).toContain('<meta property="og:image" content="https://veydrift.com/og/referral/secret-invite-code.png" />');
    expect(output).toContain('<meta property="og:image:type" content="image/png" />');
    expect(output).toContain('<meta property="og:image:alt" content="Join Veydrift with secret-invite-code" />');
    expect(output).toContain('<meta name="twitter:image" content="https://veydrift.com/og/referral/secret-invite-code.png" />');
    expect(output).toContain('<meta name="twitter:image:alt" content="Join Veydrift with secret-invite-code" />');
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

async function referralTitlePixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  let count = 0;

  for (let y = 100; y <= 220; y += 1) {
    for (let x = 0; x < referralOgLayout.planetLeft; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset]! <= 220 || data[offset + 1]! <= 220 || data[offset + 2]! <= 220) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  return { minX, maxX, minY, maxY, count };
}

async function referralTextPixels(png: Buffer, bounds: { top: number; bottom: number }) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  let count = 0;

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = 0; x < referralOgLayout.planetLeft; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset]! < 130 || data[offset + 1]! < 140 || data[offset + 2]! < 150) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  return { minX, maxX, minY, maxY, count };
}
