import type { Planet } from "./types";

export const DISCONNECTED_HERO_IMAGE = "/assets/game/style-pass/generated/planets/lush-temperate.webp";

export type KnownHeroImage = {
  coordinateKey: string;
  image: string;
};

export function overviewHeroImage(
  homePlanet: Planet | undefined,
  isWalletConnected: boolean,
  lastKnownHeroImage: KnownHeroImage | undefined,
  currentCoordinateKey: string | undefined,
): string | undefined {
  if (homePlanet?.image) return homePlanet.image;
  if (
    lastKnownHeroImage
    && currentCoordinateKey
    && lastKnownHeroImage.coordinateKey === currentCoordinateKey
  ) {
    return lastKnownHeroImage.image;
  }

  return isWalletConnected ? undefined : DISCONNECTED_HERO_IMAGE;
}

export function planetCoordinateKey(
  planet: Pick<Planet, "galaxy" | "system" | "position"> | undefined,
): string | undefined {
  return planet ? `${planet.galaxy}:${planet.system}:${planet.position}` : undefined;
}
