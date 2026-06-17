export const GAME_UNAVAILABLE_TITLE = "Game temporarily unavailable";
export const GAME_UNAVAILABLE_MESSAGE =
  "Veydrift is temporarily unavailable or restarting. Refresh or try again in a few minutes.";

export function isGameUnavailableMessage(message: string | undefined): boolean {
  if (typeof message !== "string") return false;

  const normalized = message.trim();
  if (!normalized) return false;
  if (normalized === GAME_UNAVAILABLE_MESSAGE) return true;

  return (
    /^game api (is )?unavailable\.?$/i.test(normalized)
    || /veydrift backend is temporarily (unavailable|unreachable)/i.test(normalized)
    || /veydrift backend is likely restarting/i.test(normalized)
    || /game api could not be reached from this browser/i.test(normalized)
    || /api deployment|cors settings/i.test(normalized)
    || /deployed game api does not support/i.test(normalized)
    || /backend (configuration|redeploy|connection)/i.test(normalized)
    || /game api is not fully configured/i.test(normalized)
    || /game api (returned|failed:?) 5\d\d/i.test(normalized)
    || /temporarily unavailable because the game api/i.test(normalized)
    || /timed out reading .* from the game api/i.test(normalized)
  );
}
