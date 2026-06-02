export type TimestampInput = number | string | Date | null | undefined;

export type FormatUserTimestampOptions = Intl.DateTimeFormatOptions & {
  fallback?: string | undefined;
  locale?: string | string[] | undefined;
};

const CHAIN_SECONDS_THRESHOLD = 10_000_000_000;
const DATE_TIME_DISPLAY_KEYS = new Set([
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
]);

export function timestampToMs(value: TimestampInput): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) return undefined;
    return numeric < CHAIN_SECONDS_THRESHOLD ? numeric * 1_000 : numeric;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function formatUserTimestamp(
  value: TimestampInput,
  {
    fallback = "Unknown",
    locale,
    ...dateTimeOptions
  }: FormatUserTimestampOptions = {},
): string {
  const ms = timestampToMs(value);
  if (ms === undefined) return fallback;

  const hasDisplayOptions = Object.keys(dateTimeOptions).some((key) => DATE_TIME_DISPLAY_KEYS.has(key));
  const options: Intl.DateTimeFormatOptions = hasDisplayOptions
    ? dateTimeOptions
    : { dateStyle: "medium", timeStyle: "short", ...dateTimeOptions };

  return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
}
