import type { Planet } from "./types";

export type LastKnownHeroImage = {
  image: string;
  planetKey: string;
};

// Resolve the Overview hero image strictly from real planet data. There is no fabricated
// fallback image: when no real planet (or last-known image for the current planet) is available
// the caller renders a skeleton/connect-wallet state instead of inventing a planet (VEY-KANEO-458).
export function overviewHeroImage(
  homePlanet: Planet | undefined,
  lastKnownHeroImage: LastKnownHeroImage | undefined,
  currentPlanetKey: string | undefined,
): string | undefined {
  if (homePlanet?.image) return homePlanet.image;
  if (currentPlanetKey && lastKnownHeroImage?.planetKey === currentPlanetKey) {
    return lastKnownHeroImage.image;
  }
  return undefined;
}
