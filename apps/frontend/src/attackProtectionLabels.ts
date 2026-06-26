export type ProtectionScoreComparisonLike = {
  attackerScore?: string | null;
  defenderScore?: string | null;
};

export function formatProtectionScore(value: string | null | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

export function protectionScoreComparisonLabel(comparison: ProtectionScoreComparisonLike | null | undefined): string | null {
  if (!comparison?.attackerScore || !comparison.defenderScore) return null;
  return `Protection score ${formatProtectionScore(comparison.attackerScore)} vs ${formatProtectionScore(comparison.defenderScore)}`;
}
