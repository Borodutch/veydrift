import type { FleetMissionVisibilityResponse } from "./walletFlow";

// A failed/timed-out visibility request says nothing about whether a mission still exists. The UI
// must retain the last confirmed response until the backend supplies a newer one.
export function confirmedFleetVisibility(
  result: PromiseSettledResult<FleetMissionVisibilityResponse>,
): FleetMissionVisibilityResponse | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

// Mission Control polls continuously. An empty archive is a normal steady state, not a loading
// surface to mount briefly on each poll.
export function shouldRenderMissileStrikeHistory({
  error,
  rowCount,
}: {
  error?: string | undefined;
  rowCount: number;
}): boolean {
  return Boolean(error) || rowCount > 0;
}
