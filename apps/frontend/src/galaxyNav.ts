export interface GalaxyNavState {
  galaxy: number;
  system: number;
}

interface GalaxyNavHome {
  galaxy: number;
  system: number;
}

/**
 * Decide whether to initialize the galaxy view to the home system when home
 * coordinates change.
 *
 * The galaxy view should center on the player's home system once, the first
 * time home coordinates become available. After that, background data polls
 * refresh `onChainSettlement`, which churns the derived `homeCoords` reference
 * (and may change its value). Those refreshes must NOT yank the view back to
 * the home system once the user has navigated elsewhere.
 *
 * Returns the next galaxy-nav state to apply, or `null` when the navigation
 * should be left untouched (either because it has already been initialized or
 * because home coordinates are not available yet).
 */
export function resolveInitialGalaxyNav(params: {
  homeCoords: GalaxyNavHome | undefined;
  alreadyInitialized: boolean;
}): GalaxyNavState | null {
  const { homeCoords, alreadyInitialized } = params;

  if (alreadyInitialized) return null;
  if (!homeCoords) return null;

  return { galaxy: homeCoords.galaxy, system: homeCoords.system };
}
