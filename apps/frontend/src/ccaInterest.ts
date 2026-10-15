import { playableApiUrl } from "./runtimeConfig";

export type CcaInterestTotals = { people: number; amountUsd: number };

export async function submitCcaInterest(body: { amountUsd: unknown; email: unknown; telegram: unknown }): Promise<void> {
  const response = await fetch(`${playableApiUrl}/cca/interest`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "");
}

export async function fetchCcaInterestTotals(): Promise<CcaInterestTotals> {
  const response = await fetch(`${playableApiUrl}/cca/interest`);
  if (!response.ok) throw new Error(`CCA interest totals failed: ${response.status}`);
  return response.json() as Promise<CcaInterestTotals>;
}
