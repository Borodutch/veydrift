export type AccountAssociation = {
  header: string;
  payload: string;
  signature: string;
};

export type HtmlEnv = {
  PUBLIC_SITE_URL: string;
  ROBOTS: string;
  SITE_TITLE: string;
  SITE_DESCRIPTION: string;
  SOCIAL_IMAGE: string;
  MINIAPP_IMAGE: string;
  MINIAPP_SPLASH: string;
  MINIAPP_LAUNCH_URL: string;
};

export type MiniAppSurface = HtmlEnv & {
  domain: string;
  noindex: boolean;
  requiredChains: string[];
};

export type MiniAppEmbed = {
  version: "1";
  imageUrl: string;
  aspectRatio: "3:2";
  button: {
    title: string;
    action: {
      type: "launch_miniapp" | "launch_frame";
      name: string;
      url: string;
      splashImageUrl: string;
      splashBackgroundColor: string;
    };
  };
};

export type MiniAppManifest = {
  accountAssociation: AccountAssociation;
  miniapp: MiniAppManifestConfig;
  frame: MiniAppManifestConfig;
};

export type MiniAppManifestConfig = {
  version: "1";
  name: string;
  homeUrl: string;
  iconUrl: string;
  splashImageUrl: string;
  splashBackgroundColor: string;
  subtitle: string;
  description: string;
  screenshotUrls: string[];
  primaryCategory: "games";
  tags: string[];
  heroImageUrl: string;
  tagline: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  requiredChains: string[];
  requiredCapabilities: string[];
  canonicalDomain: string;
  noindex: boolean;
};

export const productionAccountAssociation = {
  header: "eyJmaWQiOjEzNTYsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg4ZDUwNDRkOWVlN2NlQzQxRUVlQmVGMTJCNzQ5RTYyRTJBYjlGMTMxIn0",
  payload: "eyJkb21haW4iOiJ2ZXlkcmlmdC5jb20ifQ",
  signature: "MHJZj2M8IkOKAaSCi0Tdoos8c6amwogZVNbXDuxAFjN8l3nsu3hUttRVfpwKLzvNOJJ/qW6mCXtZ3ViSVp4HkBw=",
} satisfies AccountAssociation;

export const testAccountAssociation = {
  header: "eyJmaWQiOjEzNTYsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHgyYjA5NDUwQ0MxODAxOWQyYzUwNWJCY0VDYjI3NDg1RTA0NjlCQzJjIn0",
  payload: "eyJkb21haW4iOiJ0ZXN0LnZleWRyaWZ0LmNvbSJ9",
  signature: "AsIOtgQPs7a4wXZAzJOYozUdm8Uqm+c+W75V2JZIw9Uq2pkBgU7MH+3SyRnawK4YQCfdGWfweh9sQNrsIr0QhBs=",
} satisfies AccountAssociation;

export const productionMiniAppSurface = {
  PUBLIC_SITE_URL: "https://veydrift.com",
  ROBOTS: "index,follow",
  SITE_TITLE: "Veydrift",
  SITE_DESCRIPTION: "Onchain space strategy on Base. Settle planets, build fleets and raid rivals in a universe where every planet, fleet and resource is public onchain state.",
  SOCIAL_IMAGE: "https://veydrift.com/assets/og-image.jpg",
  MINIAPP_IMAGE: "https://veydrift.com/assets/miniapp/embed.png",
  MINIAPP_SPLASH: "https://veydrift.com/assets/miniapp/splash.png",
  MINIAPP_LAUNCH_URL: "https://veydrift.com/?miniApp=true",
  domain: "veydrift.com",
  noindex: false,
  requiredChains: [
    "eip155:8453",
  ],
} satisfies MiniAppSurface;

export const testMiniAppSurface = {
  PUBLIC_SITE_URL: "https://test.veydrift.com",
  ROBOTS: "noindex,nofollow",
  SITE_TITLE: "Veydrift",
  SITE_DESCRIPTION: "Veydrift Base Sepolia test app for injected-wallet first-planet settlement.",
  SOCIAL_IMAGE: "https://test.veydrift.com/assets/miniapp/og-image.jpg",
  MINIAPP_IMAGE: "https://test.veydrift.com/assets/miniapp/embed.png",
  MINIAPP_SPLASH: "https://test.veydrift.com/assets/miniapp/splash.png",
  MINIAPP_LAUNCH_URL: "https://test.veydrift.com/?miniApp=true",
  domain: "test.veydrift.com",
  noindex: true,
  requiredChains: [
    "eip155:84532",
  ],
} satisfies MiniAppSurface;

export function miniAppSurfaceForMode(mode: string): MiniAppSurface {
  return mode === "playable" || mode === "settlement"
    ? testMiniAppSurface
    : productionMiniAppSurface;
}

export function buildMiniAppEmbed(
  surface: MiniAppSurface,
  actionType: MiniAppEmbed["button"]["action"]["type"] = "launch_miniapp",
): MiniAppEmbed {
  return {
    version: "1",
    imageUrl: surface.MINIAPP_IMAGE,
    aspectRatio: "3:2",
    button: {
      title: "Play the open beta",
      action: {
        type: actionType,
        name: "Veydrift",
        url: surface.MINIAPP_LAUNCH_URL,
        splashImageUrl: surface.MINIAPP_SPLASH,
        splashBackgroundColor: "#05070d",
      },
    },
  };
}

export function buildMiniAppManifest(
  surface: MiniAppSurface,
  accountAssociation: AccountAssociation,
): MiniAppManifest {
  const config = buildMiniAppManifestConfig(surface);

  return {
    accountAssociation,
    miniapp: config,
    frame: config,
  };
}

function buildMiniAppManifestConfig(surface: MiniAppSurface): MiniAppManifestConfig {
  return {
    version: "1",
    name: "Veydrift",
    homeUrl: surface.MINIAPP_LAUNCH_URL,
    iconUrl: `${surface.PUBLIC_SITE_URL}/assets/miniapp/icon.png`,
    splashImageUrl: surface.MINIAPP_SPLASH,
    splashBackgroundColor: "#05070d",
    subtitle: "Open beta live on Base",
    description: "Build planets, launch fleets and fight over a persistent universe where every planet, fleet and resource is public onchain state.",
    screenshotUrls: [
      `${surface.PUBLIC_SITE_URL}/assets/miniapp/screenshot-1.jpg`,
    ],
    primaryCategory: "games",
    tags: [
      "space",
      "onchain",
      "base",
      "game",
    ],
    heroImageUrl: `${surface.PUBLIC_SITE_URL}/assets/miniapp/og-image.jpg`,
    tagline: "Space strategy, fully onchain",
    ogTitle: "Veydrift",
    ogDescription: "Onchain space strategy on Base. Settle planets, build fleets, raid rivals.",
    ogImageUrl: `${surface.PUBLIC_SITE_URL}/assets/miniapp/og-image.jpg`,
    requiredChains: surface.requiredChains,
    requiredCapabilities: [
      "actions.ready",
      "wallet.getEthereumProvider",
    ],
    canonicalDomain: surface.domain,
    noindex: surface.noindex,
  };
}

export function accountAssociationDomain(accountAssociation: AccountAssociation): string | undefined {
  try {
    const decoded = decodeBase64UrlJson(accountAssociation.payload);
    return typeof decoded.domain === "string" ? decoded.domain : undefined;
  } catch {
    return undefined;
  }
}

export function assertAccountAssociationDomain(
  accountAssociation: AccountAssociation,
  domain: string,
): void {
  const associatedDomain = accountAssociationDomain(accountAssociation);
  if (associatedDomain !== domain) {
    throw new Error(
      `Farcaster accountAssociation payload domain must be ${domain}; received ${associatedDomain ?? "unknown"}.`,
    );
  }
}

function decodeBase64UrlJson(value: string): { domain?: unknown } {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { domain?: unknown };
}
