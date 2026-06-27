export function formatScore(value: string | null | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}
