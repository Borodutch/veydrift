import type { Planet } from "./types";

export const DISCONNECTED_HERO_IMAGE = "/assets/game/style-pass/generated/planets/lush-temperate.webp";

export type LastKnownHeroImage = {
  image: string;
  planetKey: string;
};

export function overviewHeroImage(
  homePlanet: Planet | undefined,
  isWalletConnected: boolean,
  lastKnownHeroImage: LastKnownHeroImage | undefined,
  currentPlanetKey: string | undefined,
): string | undefined {
  if (homePlanet?.image) return homePlanet.image;
  if (currentPlanetKey && lastKnownHeroImage?.planetKey === currentPlanetKey) {
    return lastKnownHeroImage.image;
  }
  return isWalletConnected ? undefined : DISCONNECTED_HERO_IMAGE;
}
