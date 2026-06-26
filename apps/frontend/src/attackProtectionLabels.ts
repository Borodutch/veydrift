export type ProtectionScoreComparisonLike = {
  attackerScore?: string | null;
  defenderScore?: string | null;
};

export function formatScore(value: string | null | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

export function scoreComparisonLabel(comparison: ProtectionScoreComparisonLike | null | undefined): string | null {
  if (!comparison?.attackerScore || !comparison.defenderScore) return null;
  return `Score ${formatScore(comparison.attackerScore)} vs ${formatScore(comparison.defenderScore)}`;
}
