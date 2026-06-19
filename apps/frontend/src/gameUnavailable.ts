export const DEFAULT_SERVER_RETRY_SECONDS = 10;

export function serverUnavailableRetryMessage(seconds = DEFAULT_SERVER_RETRY_SECONDS): string {
  const wholeSeconds = Math.max(1, Math.round(seconds));
  return `Servers are unavailable. Retrying in ${wholeSeconds} ${wholeSeconds === 1 ? "second" : "seconds"}.`;
}

export const GAME_UNAVAILABLE_TITLE = "Servers unavailable";
export const GAME_UNAVAILABLE_MESSAGE = serverUnavailableRetryMessage();

export function isGameUnavailableMessage(message: string | undefined): boolean {
  if (typeof message !== "string") return false;

  const normalized = message.trim();
  if (!normalized) return false;
  if (normalized === GAME_UNAVAILABLE_MESSAGE) return true;

  return (
    /^servers are unavailable\. retrying in \d+ seconds?\.?$/i.test(normalized)
    || /^game api (is )?unavailable\.?$/i.test(normalized)
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
