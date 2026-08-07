export function hasPlanetSelectorChoice(
  planets: ReadonlyArray<{ moon?: { exists?: boolean } | null }>,
): boolean {
  return planets.length > 1 || planets.some((planet) => planet.moon?.exists === true);
}

export function isPlanetSelectorParentSelected(
  planetId: string,
  selectedPlanetId: string | undefined,
): boolean {
  return planetId === selectedPlanetId;
}
