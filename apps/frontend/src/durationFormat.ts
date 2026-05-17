const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
const MINUTE_SECONDS = 60;
const MAX_DISPLAY_WEEKS = 99;

export function formatDuration(valueSeconds: number): string {
  if (!Number.isFinite(valueSeconds)) {
    return "unknown";
  }

  const seconds = Math.max(0, Math.ceil(valueSeconds));

  if (seconds >= MAX_DISPLAY_WEEKS * WEEK_SECONDS) {
    return `${MAX_DISPLAY_WEEKS}w+`;
  }

  if (seconds >= WEEK_SECONDS) {
    return formatTwoUnits(seconds, WEEK_SECONDS, "w", DAY_SECONDS, "d");
  }

  if (seconds >= DAY_SECONDS) {
    return formatTwoUnits(seconds, DAY_SECONDS, "d", HOUR_SECONDS, "h");
  }

  if (seconds >= HOUR_SECONDS) {
    return formatTwoUnits(seconds, HOUR_SECONDS, "h", MINUTE_SECONDS, "m");
  }

  if (seconds >= MINUTE_SECONDS) {
    return formatTwoUnits(seconds, MINUTE_SECONDS, "m", 1, "s");
  }

  return `${seconds}s`;
}

export function formatDurationUntil(readyAtMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(readyAtMs)) {
    return "unknown";
  }

  const seconds = Math.max(0, Math.ceil((readyAtMs - nowMs) / 1_000));
  return seconds === 0 ? "Ready" : formatDuration(seconds);
}

function formatTwoUnits(
  seconds: number,
  majorSeconds: number,
  majorLabel: string,
  minorSeconds: number,
  minorLabel: string,
): string {
  const major = Math.floor(seconds / majorSeconds);
  const minor = Math.floor((seconds % majorSeconds) / minorSeconds);
  return minor === 0 ? `${major}${majorLabel}` : `${major}${majorLabel} ${minor}${minorLabel}`;
}
