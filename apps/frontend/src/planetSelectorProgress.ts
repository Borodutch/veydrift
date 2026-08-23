import type { ConstructionProgress } from "./constructionProgress";

/** Research is wallet-global, but its selector progress belongs to the home
 * planet. The queue itself stays a single canonical wallet snapshot. */
export function planetSelectorResearchProgressFor(
  planetId: string,
  researchPlanetId: string | null | undefined,
  researchProgress: ConstructionProgress,
): ConstructionProgress | undefined {
  return researchPlanetId === planetId ? researchProgress : undefined;
}
