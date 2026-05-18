import type { Planet } from "./types";

export const DISCONNECTED_HERO_IMAGE = "/assets/game/style-pass/generated/planets/lush-temperate.webp";

export function overviewHeroImage(
  homePlanet: Planet | undefined,
  isWalletConnected: boolean,
  lastKnownHeroImage: string | undefined,
): string | undefined {
  if (homePlanet?.image) return homePlanet.image;
  if (lastKnownHeroImage) return lastKnownHeroImage;
  return isWalletConnected ? undefined : DISCONNECTED_HERO_IMAGE;
}
