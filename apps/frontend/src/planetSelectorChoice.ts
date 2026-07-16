export function hasPlanetSelectorChoice(
  planets: ReadonlyArray<{ moon?: { exists?: boolean } | null }>,
): boolean {
  return planets.length > 1 || planets.some((planet) => planet.moon?.exists === true);
}
