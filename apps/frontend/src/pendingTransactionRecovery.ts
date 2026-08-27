export function pendingTransactionRecoveryAgeLabel(submittedAt: number, now = Date.now()): string {
  const elapsedMinutes = Math.max(1, Math.floor((now - submittedAt) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"}`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"}`;
}
