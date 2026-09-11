/** Preserve textual stats such as "Stationary" without changing numeric precision. */
export function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

export function formatResourceAmount(value: string): string {
  return /^-?\d+$/.test(value) ? BigInt(value).toLocaleString() : Number(value).toLocaleString();
}

export function formatScore(value: string | null | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

/** Integer resource displays truncate fractions; textual/unavailable values remain intact. */
export function formatIntegerAmount(value: string | null | undefined): string {
  if (value === null || value === undefined) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toLocaleString("en-US") : value;
  }
}
